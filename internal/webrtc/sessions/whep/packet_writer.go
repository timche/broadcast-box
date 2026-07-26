package whep

import (
	"errors"
	"io"
	"log/slog"
	"time"

	"github.com/glimesh/broadcast-box/internal/webrtc/codecs"
)

// Sends provided audio packet to the WHEP session
func (w *WHEPSession) SendAudioPacket(packet codecs.TrackPacket) {
	if w.IsSessionClosed.Load() {
		return
	}

	audioTrack := w.AudioTrack.Load()
	if audioTrack == nil {
		return
	}

	w.AudioPacketsWritten.Add(1)

	// Audio packets are forwarded unmodified, no timestamp/sequence rewrite.
	if err := audioTrack.WriteRTP(packet.Packet, packet.Codec); err != nil {
		if errors.Is(err, io.ErrClosedPipe) {
			slog.Info("WHEPSession.SendAudioPacket.ConnectionDropped")
			w.closeAsync()
		} else {
			slog.Error("WHEPSession.SendAudioPacket.Error", "err", err)
		}
	}
}

// Sends provided video packet to the WHEP session
func (w *WHEPSession) SendVideoPacket(packet codecs.TrackPacket) {
	if w.IsSessionClosed.Load() {
		return
	}

	if w.IsWaitingForKeyframe.Load() {
		if !packet.IsKeyframe {
			w.SendPLI()
			return
		}

		w.IsWaitingForKeyframe.Store(false)
	}

	w.VideoLock.Lock()
	w.VideoBytesWritten += len(packet.Packet.Payload)
	w.VideoPacketsWritten += 1
	w.VideoSequenceNumber = uint16(w.VideoSequenceNumber) + uint16(packet.SequenceDiff)
	w.VideoTimestamp = uint32(int64(w.VideoTimestamp) + packet.TimeDiff)
	w.updateVideoBitrateLocked(time.Now())
	videoSequenceNumber := w.VideoSequenceNumber
	videoTimestamp := w.VideoTimestamp
	videoTrack := w.VideoTrack
	w.VideoLock.Unlock()

	if videoTrack == nil {
		return
	}

	packet.Packet.SequenceNumber = videoSequenceNumber
	packet.Packet.Timestamp = videoTimestamp

	if err := videoTrack.WriteRTP(packet.Packet, packet.Codec); err != nil {
		w.VideoPacketsDropped.Add(1)

		if errors.Is(err, io.ErrClosedPipe) {
			slog.Info("WHEPSession.SendVideoPacket.ConnectionDropped")
			w.closeAsync()
		} else {
			slog.Error("WHEPSession.SendVideoPacket.Error", "err", err)
		}
	}
}
