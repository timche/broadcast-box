package whep

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/glimesh/broadcast-box/internal/chat"
	"github.com/glimesh/broadcast-box/internal/webrtc/codecs"
	"github.com/pion/webrtc/v4"
)

type (
	WHEPSession struct {
		SessionID            string
		StreamKey            string
		IsWaitingForKeyframe atomic.Bool
		IsSessionClosed      atomic.Bool

		SessionClose sync.Once
		onClose      func(string)
		pliSender    func()

		PeerConnectionLock sync.RWMutex
		PeerConnection     *webrtc.PeerConnection

		// Protects VideoTrack, VideoTimestamp, VideoPacketsWritten, VideoSequenceNumber,
		// and mutations of the video layer selection state.
		VideoLock               sync.RWMutex
		VideoTrack              *codecs.TrackMultiCodec
		VideoTimestamp          uint32
		VideoBitrate            atomic.Uint64
		VideoBytesWritten       int
		videoBitrateWindowStart time.Time
		videoBitrateWindowBytes int
		VideoPacketsWritten     uint64
		VideoPacketsDropped     atomic.Uint64
		VideoSequenceNumber     uint16

		// videoLayer holds an immutable snapshot of the video layer selection state.
		// It is written only while VideoLock is held, but may be read lock-free by
		// the packet fan-out hot path (see GetVideoLayerOrDefault). Because the whole
		// selection state lives behind a single pointer, a lock-free reader always
		// observes a consistent (layer, priority, explicit) triple.
		videoLayer atomic.Pointer[videoLayerState]

		// Protects AudioTrack, AudioTimestamp, AudioPacketsWritten, AudioSequenceNumber
		AudioLock           sync.RWMutex
		AudioTrack          *codecs.TrackMultiCodec
		AudioTimestamp      uint32
		AudioPacketsWritten uint64
		AudioSequenceNumber uint16
		AudioLayerCurrent   atomic.Pointer[string]

		ChatManager *chat.Manager
	}

	// videoLayerState is an immutable snapshot of the video layer selection state.
	// Never mutate an instance once it has been published via WHEPSession.videoLayer,
	// always publish a replacement.
	videoLayerState struct {
		// layer is the simulcast layer currently being forwarded ("" when unset).
		layer string
		// priority is the simulcast priority of layer (lower is better, 0 is unset).
		priority int
		// explicit reports whether layer was chosen by the viewer, in which case
		// it must not be overridden by automatic priority based selection.
		explicit bool
	}
)
