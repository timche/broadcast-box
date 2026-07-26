package whep

import (
	"sync"
	"sync/atomic"
	"testing"

	"github.com/glimesh/broadcast-box/internal/webrtc/codecs"
	"github.com/pion/interceptor"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

// countingWriteStream is a webrtc.TrackLocalWriter that only records how many
// RTP packets reached the wire.
type countingWriteStream struct {
	writes atomic.Uint64
}

func (c *countingWriteStream) WriteRTP(header *rtp.Header, payload []byte) (int, error) {
	c.writes.Add(1)
	return len(payload), nil
}

func (c *countingWriteStream) Write(b []byte) (int, error) {
	c.writes.Add(1)
	return len(b), nil
}

// fakeTrackLocalContext lets a test bind a TrackMultiCodec without a full
// PeerConnection negotiation.
type fakeTrackLocalContext struct {
	writeStream webrtc.TrackLocalWriter
}

func (f *fakeTrackLocalContext) CodecParameters() []webrtc.RTPCodecParameters {
	return []webrtc.RTPCodecParameters{{
		PayloadType: 111,
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:  webrtc.MimeTypeOpus,
			ClockRate: 48_000,
			Channels:  2,
		},
	}}
}

func (f *fakeTrackLocalContext) HeaderExtensions() []webrtc.RTPHeaderExtensionParameter {
	return nil
}
func (f *fakeTrackLocalContext) SSRC() webrtc.SSRC                       { return 1234 }
func (f *fakeTrackLocalContext) SSRCRetransmission() webrtc.SSRC         { return 0 }
func (f *fakeTrackLocalContext) SSRCForwardErrorCorrection() webrtc.SSRC { return 0 }
func (f *fakeTrackLocalContext) WriteStream() webrtc.TrackLocalWriter    { return f.writeStream }
func (f *fakeTrackLocalContext) ID() string                              { return "audio" }
func (f *fakeTrackLocalContext) RTCPReader() interceptor.RTCPReader      { return nil }

func opusCodec() codecs.TrackCodeType {
	return codecs.GetAudioTrackCodec(webrtc.MimeTypeOpus)
}

// Creates a bound audio track plus the write stream it feeds.
func newBoundAudioTrack(t *testing.T) (*codecs.TrackMultiCodec, *countingWriteStream) {
	t.Helper()

	track := codecs.CreateTrackMultiCodec("audio", "pion", "stream-key", webrtc.RTPCodecTypeAudio, opusCodec())
	writeStream := &countingWriteStream{}

	if _, err := track.Bind(&fakeTrackLocalContext{writeStream: writeStream}); err != nil {
		t.Fatalf("failed to bind audio track: %v", err)
	}

	return track, writeStream
}

func newTestWHEPSession(t *testing.T, audioTrack *codecs.TrackMultiCodec) *WHEPSession {
	t.Helper()

	peerConnection, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("failed to create PeerConnection: %v", err)
	}
	t.Cleanup(func() {
		_ = peerConnection.Close()
	})

	return CreateNewWHEP("session-id", "stream-key", audioTrack, nil, peerConnection, func() {}, nil)
}

func newAudioPacket(sequenceNumber uint16) codecs.TrackPacket {
	return codecs.TrackPacket{
		Layer: codecs.AudioTrackLabelDefault,
		Codec: opusCodec(),
		Packet: &rtp.Packet{
			Header:  rtp.Header{Version: 2, SequenceNumber: sequenceNumber, Timestamp: uint32(sequenceNumber) * 960},
			Payload: []byte{0x01, 0x02, 0x03},
		},
	}
}

func TestSendAudioPacketCountsConcurrentSenders(t *testing.T) {
	track, writeStream := newBoundAudioTrack(t)
	session := newTestWHEPSession(t, track)

	const senders = 8
	const packetsPerSender = 500

	var waitGroup sync.WaitGroup
	start := make(chan struct{})

	for sender := range senders {
		waitGroup.Add(1)
		go func(sender int) {
			defer waitGroup.Done()
			<-start
			for packet := range packetsPerSender {
				session.SendAudioPacket(newAudioPacket(uint16(sender*packetsPerSender + packet)))
			}
		}(sender)
	}

	close(start)
	waitGroup.Wait()

	expected := uint64(senders * packetsPerSender)
	if written := session.AudioPacketsWritten.Load(); written != expected {
		t.Fatalf("AudioPacketsWritten = %d, want %d", written, expected)
	}

	if writes := writeStream.writes.Load(); writes != expected {
		t.Fatalf("RTP writes = %d, want %d", writes, expected)
	}

	status := session.GetWHEPSessionStatus()
	if status.AudioPacketsWritten != expected {
		t.Fatalf("status.AudioPacketsWritten = %d, want %d", status.AudioPacketsWritten, expected)
	}
	if status.AudioTimestamp != audioTimestampReported {
		t.Fatalf("status.AudioTimestamp = %d, want %d", status.AudioTimestamp, audioTimestampReported)
	}
	if status.AudioSequenceNumber != audioSequenceNumberReported {
		t.Fatalf("status.AudioSequenceNumber = %d, want %d", status.AudioSequenceNumber, audioSequenceNumberReported)
	}
}

func TestSendAudioPacketAfterTrackClearedDoesNotWrite(t *testing.T) {
	track, writeStream := newBoundAudioTrack(t)
	session := newTestWHEPSession(t, track)

	session.SendAudioPacket(newAudioPacket(1))
	if writes := writeStream.writes.Load(); writes != 1 {
		t.Fatalf("RTP writes before clearing = %d, want 1", writes)
	}

	// Clearing only the track (session still open) must not panic or write.
	session.AudioTrack.Store(nil)
	session.SendAudioPacket(newAudioPacket(2))

	if writes := writeStream.writes.Load(); writes != 1 {
		t.Fatalf("RTP writes after clearing track = %d, want 1", writes)
	}
	if written := session.AudioPacketsWritten.Load(); written != 1 {
		t.Fatalf("AudioPacketsWritten after clearing track = %d, want 1", written)
	}
}

func TestSendAudioPacketConcurrentWithCloseDoesNotPanic(t *testing.T) {
	track, _ := newBoundAudioTrack(t)
	session := newTestWHEPSession(t, track)

	var waitGroup sync.WaitGroup
	start := make(chan struct{})

	for range 4 {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			<-start
			for packet := range 500 {
				session.SendAudioPacket(newAudioPacket(uint16(packet)))
			}
		}()
	}

	waitGroup.Add(1)
	go func() {
		defer waitGroup.Done()
		<-start
		session.Close()
	}()

	// A status reader racing the send path and teardown.
	waitGroup.Add(1)
	go func() {
		defer waitGroup.Done()
		<-start
		for range 200 {
			_ = session.GetWHEPSessionStatus()
		}
	}()

	close(start)
	waitGroup.Wait()

	if session.AudioTrack.Load() != nil {
		t.Fatal("AudioTrack should be nil after Close")
	}

	// Post-close sends are dropped entirely.
	writtenAfterClose := session.AudioPacketsWritten.Load()
	session.SendAudioPacket(newAudioPacket(1))
	if session.AudioPacketsWritten.Load() != writtenAfterClose {
		t.Fatal("SendAudioPacket wrote after Close")
	}
}
