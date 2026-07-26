package whip

import (
	"errors"
	"io"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/glimesh/broadcast-box/internal/webrtc/codecs"
	"github.com/glimesh/broadcast-box/internal/webrtc/sessions/whep"
	"github.com/pion/rtp"
	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

func (w *WHIPSession) audioWriter(remoteTrack *webrtc.TrackRemote, streamKey string) {
	id := remoteTrack.RID()

	if id == "" {
		id = codecs.AudioTrackLabelDefault
	}

	codec := codecs.GetAudioTrackCodec(remoteTrack.Codec().MimeType)
	track, err := w.addAudioTrack(id, streamKey, codec)
	if err != nil {
		slog.Error("AudioWriter.AddTrack.Error", "err", err)
		return
	}

	rtpPkt := &rtp.Packet{}
	rtpBuf := make([]byte, 1500)
	for {
		rtpRead, _, err := remoteTrack.Read(rtpBuf)
		if err != nil {
			if errors.Is(err, io.EOF) {
				slog.Info("WHIPSession.AudioWriter.RtpPkt.EndOfStream")
				return
			} else {
				slog.Error("WHIPSession.AudioWriter.RtpPkt.Err", "err", err)
			}
		}

		track.PacketsReceived.Add(1)

		err = rtpPkt.Unmarshal(rtpBuf[:rtpRead])
		if err != nil {
			slog.Error("WHIPSession.AudioWriter.RtpPkt.Error", "err", err)
			continue
		}

		var sessions map[string]*whep.WHEPSession
		if sessionsAny := w.WHEPSessionsSnapshot.Load(); sessionsAny != nil {
			sessions = sessionsAny.(map[string]*whep.WHEPSession)
		}

		packet := codecs.TrackPacket{
			Layer:  id,
			Packet: rtpPkt,
			Codec:  codec,
		}

		for _, whepSession := range sessions {
			whepSession.SendAudioPacket(packet)
		}
	}
}

func (w *WHIPSession) videoWriter(remoteTrack *webrtc.TrackRemote, streamKey string, peerConnection *webrtc.PeerConnection) {
	id := remoteTrack.RID()

	if id == "" {
		id = codecs.VideoTrackLabelDefault
	}

	codec := codecs.GetVideoTrackCodec(remoteTrack.Codec().MimeType)
	track, err := w.addVideoTrack(id, streamKey, codec)
	if err != nil {
		slog.Error("WHIPSession.VideoWriter.AddTrack.Error", "err", err)
		return
	}
	track.Priority = w.getPrioritizedStreamingLayer(id, peerConnection.CurrentRemoteDescription().SDP)
	track.MediaSSRC.Store(uint32(remoteTrack.SSRC()))

	switch codec {
	case codecs.VideoTrackCodecH264, codecs.VideoTrackCodecH265, codecs.VideoTrackCodecVP8,
		codecs.VideoTrackCodecVP9, codecs.VideoTrackCodecAV1:
	default:
		slog.Error("WHIPSession.VideoWriter.Codec: Unsupported video codec", "codec", codec)
	}

	lastTimestamp := uint32(0)
	lastTimestampSet := false

	lastSequenceNumber := uint16(0)
	lastSequenceNumberSet := false

	bitrateWindowStart := time.Now()
	bitrateWindowBytes := uint64(0)

	rtpPkt := &rtp.Packet{}
	pktBuf := make([]byte, 1500)
	for {
		rtpRead, _, err := remoteTrack.Read(pktBuf)
		if err != nil {
			if errors.Is(err, io.EOF) {
				slog.Info("WHIPSession.VideoWriter.RtpPkt.EndOfStream")
				w.notifyClosed()
				return
			} else {
				slog.Error("WHIPSession.VideoWriter.RtpPkt.Err", "err", err)
			}
		}

		if rtpRead == 0 {
			continue
		}

		err = rtpPkt.Unmarshal(pktBuf[:rtpRead])
		if err != nil {
			slog.Error("WHIPSession.VideoWriter.RtpPkt.Unmarshal", "err", err)
			continue
		}

		rtpPkt.Extension = false
		rtpPkt.Extensions = nil

		track.PacketsReceived.Add(1)
		bitrateWindowBytes += uint64(rtpRead)

		// Read once per packet and reused for the keyframe stamp, the bitrate
		// window and every viewer's bitrate window below. time.Now is cheap but
		// it is not free, and the fan-out multiplies it by the viewer count.
		now := time.Now()

		isKeyframe := isPacketKeyframe(rtpPkt, codec)
		if isKeyframe {
			track.LastKeyFrame.Store(now)
		}

		if elapsed := now.Sub(bitrateWindowStart); elapsed >= time.Second {
			track.Bitrate.Store(uint64(float64(bitrateWindowBytes) / elapsed.Seconds()))
			bitrateWindowStart = now
			bitrateWindowBytes = 0
		}

		timeDiff := int64(rtpPkt.Timestamp) - int64(lastTimestamp)
		switch {
		case !lastTimestampSet:
			timeDiff = 0
			lastTimestampSet = true
		case timeDiff < -(math.MaxUint32 / 10):
			timeDiff += (math.MaxUint32 + 1)
		}

		sequenceDiff := int(rtpPkt.SequenceNumber) - int(lastSequenceNumber)
		switch {
		case !lastSequenceNumberSet:
			lastSequenceNumberSet = true
			sequenceDiff = 0
		case sequenceDiff < -(math.MaxUint16 / 10):
			sequenceDiff += (math.MaxUint16 + 1)
		}

		lastTimestamp = rtpPkt.Timestamp
		lastSequenceNumber = rtpPkt.SequenceNumber

		var sessions map[string]*whep.WHEPSession
		if sessionsAny := w.WHEPSessionsSnapshot.Load(); sessionsAny != nil {
			sessions = sessionsAny.(map[string]*whep.WHEPSession)
		}

		for _, whepSession := range sessions {
			if whepSession.GetVideoLayerOrDefault(id, track.Priority) != id {
				continue
			}

			whepSession.SendVideoPacket(codecs.TrackPacket{
				Layer:        id,
				Packet:       rtpPkt,
				Codec:        codec,
				IsKeyframe:   isKeyframe,
				TimeDiff:     timeDiff,
				SequenceDiff: sequenceDiff,
				ReceivedAt:   now,
			})
		}
	}
}

const (
	naluTypeBitmask = 0x1f
	fuStartBitmask  = 0x80

	idrNALUType = 5
	spsNALUType = 7
	ppsNALUType = 8

	stapaNALUType = 24
	fuaNALUType   = 28
	fubNALUType   = 29

	// A STAP-A aggregation unit is prefixed with a 2 byte big endian size.
	stapaHeaderSize = 1
	stapaNALULength = 2

	// FU indicator + FU header.
	fuHeaderSize = 2
)

// isKeyframeNALUType reports whether a NAL unit type indicates the start of a
// keyframe. Parameter sets (SPS/PPS) count because encoders emit them
// immediately before an IDR.
func isKeyframeNALUType(naluType byte) bool {
	return naluType == idrNALUType || naluType == spsNALUType || naluType == ppsNALUType
}

// isPacketKeyframe inspects an RTP payload in place to decide whether it starts
// a keyframe. It deliberately avoids rtp.Depacketizer: depacketizing allocates a
// new buffer for every packet (Annex-B start codes are prepended) and mutates
// shared fragment-reassembly state, neither of which is wanted for a read-only
// probe running on every video packet.
//
// The payload is untrusted, so every index is bounds checked.
func isPacketKeyframe(pkt *rtp.Packet, codec codecs.TrackCodeType) bool {
	if codec != codecs.VideoTrackCodecH264 {
		return true
	}

	payload := pkt.Payload
	if len(payload) < 1 {
		return false
	}

	switch naluType := payload[0] & naluTypeBitmask; {
	// Single NAL unit packet, the payload is the NAL unit itself (RFC 6184 5.6).
	case naluType >= 1 && naluType <= 23:
		return isKeyframeNALUType(naluType)

	// Single-time aggregation packet, walk each aggregated NAL unit (RFC 6184 5.7.1).
	case naluType == stapaNALUType:
		for offset := stapaHeaderSize; offset+stapaNALULength <= len(payload); {
			naluSize := int(payload[offset])<<8 | int(payload[offset+1])
			offset += stapaNALULength

			if naluSize < 1 || offset+naluSize > len(payload) {
				return false
			}

			if isKeyframeNALUType(payload[offset] & naluTypeBitmask) {
				return true
			}

			offset += naluSize
		}

		return false

	// Fragmentation unit, the fragmented type lives in the FU header (RFC 6184 5.8).
	// Only the fragment carrying the start bit begins the NAL unit.
	case naluType == fuaNALUType || naluType == fubNALUType:
		if len(payload) < fuHeaderSize || payload[1]&fuStartBitmask == 0 {
			return false
		}

		return isKeyframeNALUType(payload[1] & naluTypeBitmask)
	}

	return false
}

// Helper function for getting the simulcast order and using as priority for consumers
// This example will order from left to right with highest to lowest priority
// a=simulcast:send High,Mid,Low
func (w *WHIPSession) getPrioritizedStreamingLayer(layer string, sdpDescription string) int {
	var sessionDescription sdp.SessionDescription
	err := sessionDescription.Unmarshal([]byte(sdpDescription))
	if err != nil {
		slog.Error("Track.getPrioritizedStreamingLayer Error", "layer", layer, "err", err)
		return 100
	}

	var priority = 1
	for _, description := range sessionDescription.MediaDescriptions {
		for _, attribute := range description.Attributes {
			if attribute.Key == "simulcast" && strings.HasPrefix(attribute.Value, "send ") {
				layers := strings.TrimPrefix(attribute.Value, "send")
				slog.Info("WHIPSession.VideoWriter.TrackPriority", "layers", layers)
				for simulcastLayer := range strings.SplitSeq(strings.TrimSpace(layers), ";") {
					if simulcastLayer != "" && strings.EqualFold(simulcastLayer, layer) {
						slog.Info("WHIPSession.VideoWriter.TrackPriority", "layer", layer)
						return priority
					} else {
						priority++
					}
				}
			}
		}
	}

	return 100
}
