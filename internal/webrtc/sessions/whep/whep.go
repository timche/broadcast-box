package whep

import (
	"log/slog"
	"time"

	"github.com/glimesh/broadcast-box/internal/chat"
	"github.com/glimesh/broadcast-box/internal/webrtc/codecs"
	"github.com/pion/webrtc/v4"
)

// Create and start a new WHEP session
func CreateNewWHEP(
	whepSessionID string,
	streamKey string,
	audioTrack *codecs.TrackMultiCodec,
	videoTrack *codecs.TrackMultiCodec,
	peerConnection *webrtc.PeerConnection,
	pliSender func(),
	chatManager *chat.Manager,
) (w *WHEPSession) {
	slog.Debug("WHEPSession.CreateNewWHEP", "whepSessionID", whepSessionID)

	w = &WHEPSession{
		SessionID:               whepSessionID,
		StreamKey:               streamKey,
		AudioTrack:              audioTrack,
		VideoTrack:              videoTrack,
		AudioTimestamp:          5000,
		VideoTimestamp:          5000,
		PeerConnection:          peerConnection,
		pliSender:               pliSender,
		videoBitrateWindowStart: time.Now(),
		ChatManager:             chatManager,
	}

	w.storeAudioLayer("")
	w.storeVideoLayer(videoLayerState{})
	w.IsWaitingForKeyframe.Store(true)
	w.IsSessionClosed.Store(false)
	return w
}

// Lock-free read of the currently selected audio layer.
func (w *WHEPSession) GetAudioLayerCurrent() string {
	if layer := w.AudioLayerCurrent.Load(); layer != nil {
		return *layer
	}

	return ""
}

func (w *WHEPSession) storeAudioLayer(encodingID string) {
	w.AudioLayerCurrent.Store(&encodingID)
}

// Lock-free read of the currently selected video layer.
func (w *WHEPSession) GetVideoLayerCurrent() string {
	return w.loadVideoLayer().layer
}

// Lock-free read of the whole video layer selection state. The returned value is
// always internally consistent, it is published as a single atomic pointer.
func (w *WHEPSession) loadVideoLayer() videoLayerState {
	if state := w.videoLayer.Load(); state != nil {
		return *state
	}

	return videoLayerState{}
}

// Publishes a new video layer selection state. Callers must hold VideoLock.
func (w *WHEPSession) storeVideoLayer(state videoLayerState) {
	w.videoLayer.Store(&state)
}

// Closes down the WHEP session completely
func (w *WHEPSession) Close() {
	// Close WHEP channels
	w.SessionClose.Do(func() {
		slog.Debug("WHEPSession.Close")
		w.IsSessionClosed.Store(true)

		// Close PeerConnection
		slog.Debug("WHEPSession.Close.PeerConnection.GracefulClose")
		err := w.PeerConnection.Close()
		if err != nil {
			slog.Error("WHEPSession.Close.PeerConnection.Error", "err", err)
		}
		slog.Debug("WHEPSession.Close.PeerConnection.GracefulClose.Completed")

		// Empty tracks
		w.AudioLock.Lock()
		w.VideoLock.Lock()

		w.AudioTrack = nil
		w.VideoTrack = nil

		w.VideoLock.Unlock()
		w.AudioLock.Unlock()

		if w.onClose != nil {
			w.onClose(w.SessionID)
		}
	})
}

func (w *WHEPSession) SetOnClose(onClose func(string)) {
	w.onClose = onClose
}

// Get the current status of the WHEP session
func (w *WHEPSession) GetWHEPSessionStatus() (state SessionState) {
	currentAudioLayer := w.GetAudioLayerCurrent()
	currentVideoLayer := w.GetVideoLayerCurrent()

	w.AudioLock.RLock()
	w.VideoLock.Lock()
	w.updateVideoBitrateLocked(time.Now())

	state = SessionState{
		ID: w.SessionID,

		AudioLayerCurrent:   currentAudioLayer,
		AudioTimestamp:      w.AudioTimestamp,
		AudioPacketsWritten: w.AudioPacketsWritten,
		AudioSequenceNumber: uint64(w.AudioSequenceNumber),

		VideoLayerCurrent:   currentVideoLayer,
		VideoTimestamp:      w.VideoTimestamp,
		VideoBitrate:        w.VideoBitrate.Load(),
		VideoPacketsWritten: w.VideoPacketsWritten,
		VideoPacketsDropped: w.VideoPacketsDropped.Load(),
		VideoSequenceNumber: uint64(w.VideoSequenceNumber),
	}

	w.VideoLock.Unlock()
	w.AudioLock.RUnlock()

	return
}

// Sets the requested audio layer for this WHEP session.
func (w *WHEPSession) SetAudioLayer(encodingID string) {
	slog.Debug("Setting Audio Layer")
	w.storeAudioLayer(encodingID)
	w.IsWaitingForKeyframe.Store(true)
	w.SendPLI()
}

// Sets the requested video layer for this WHEP session.
func (w *WHEPSession) SetVideoLayer(encodingID string) {
	slog.Debug("Setting Video Layer")

	w.IsWaitingForKeyframe.Store(true)

	w.VideoLock.Lock()
	w.storeVideoLayer(videoLayerState{
		layer:    encodingID,
		priority: 0,
		explicit: encodingID != "",
	})
	w.VideoLock.Unlock()

	w.SendPLI()
}

func (w *WHEPSession) SendPLI() {
	if w.IsSessionClosed.Load() {
		return
	}

	w.pliSender()
}

// Reset per-publisher delivery state when a new WHIP publisher connects.
func (w *WHEPSession) ResetForNewPublisher() {
	w.VideoLock.Lock()
	defer w.VideoLock.Unlock()

	w.IsWaitingForKeyframe.Store(true)
	w.storeAudioLayer("")
	w.storeVideoLayer(videoLayerState{})
}

func (w *WHEPSession) updateVideoBitrateLocked(now time.Time) {
	if w.videoBitrateWindowStart.IsZero() {
		w.videoBitrateWindowStart = now
		return
	}

	elapsed := now.Sub(w.videoBitrateWindowStart)
	if elapsed < time.Second {
		return
	}

	bytesDiff := w.VideoBytesWritten - w.videoBitrateWindowBytes
	if bytesDiff < 0 {
		bytesDiff = 0
	}

	w.VideoBitrate.Store(uint64(float64(bytesDiff) / elapsed.Seconds()))
	w.videoBitrateWindowStart = now
	w.videoBitrateWindowBytes = w.VideoBytesWritten
}

// Returns the simulcast layer this session should be fed, selecting defaultLayer
// automatically when the session has no better choice yet.
//
// This is called once per RTP packet per viewer, so the steady state (the
// selection is already settled and nothing needs to change) is handled by a
// lock-free fast path: a single atomic pointer load plus comparisons. VideoLock
// is only taken on the paths that actually mutate the selection state.
func (w *WHEPSession) GetVideoLayerOrDefault(defaultLayer string, defaultPriority int) string {
	if state := w.videoLayer.Load(); state != nil {
		// The viewer picked a layer, it always wins and never mutates state.
		if state.explicit {
			return state.layer
		}

		// The selection already matches what this caller would have stored,
		// so taking the lock would be a no-op write.
		if state.layer != "" && state.layer == defaultLayer && state.priority == defaultPriority {
			return state.layer
		}
	}

	w.VideoLock.Lock()
	defer w.VideoLock.Unlock()

	state := w.loadVideoLayer()
	if state.explicit {
		return state.layer
	}

	if state.layer == "" {
		w.IsWaitingForKeyframe.Store(true)
		w.storeVideoLayer(videoLayerState{layer: defaultLayer, priority: defaultPriority})
		return defaultLayer
	}

	if state.layer == defaultLayer {
		if state.priority != defaultPriority {
			w.storeVideoLayer(videoLayerState{layer: defaultLayer, priority: defaultPriority})
		}
		return state.layer
	}

	// Lower numeric priority value means a better simulcast layer.
	if state.priority == 0 || defaultPriority < state.priority {
		w.IsWaitingForKeyframe.Store(true)
		w.storeVideoLayer(videoLayerState{layer: defaultLayer, priority: defaultPriority})
		return defaultLayer
	}

	return state.layer
}
