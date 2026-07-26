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

		// Unix nanoseconds of the last PLI forwarded to the publisher, used to
		// rate limit keyframe requests. Zero means "never sent".
		lastPLISent atomic.Int64

		PeerConnectionLock sync.RWMutex
		PeerConnection     *webrtc.PeerConnection

		// Protects VideoTrack, VideoTimestamp, VideoPacketsWritten, VideoSequenceNumber,
		// and auto video layer selection state.
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
		VideoLayerCurrent       atomic.Value
		videoLayerPriority      int
		videoLayerExplicit      bool

		// Audio RTP packets are forwarded to the viewer untouched, so the audio
		// send path only needs the track pointer and a counter. Both are atomic
		// so no lock is taken per packet per viewer. AudioTrack is set to nil by
		// Close() to stop further writes.
		AudioTrack          atomic.Pointer[codecs.TrackMultiCodec]
		AudioPacketsWritten atomic.Uint64
		AudioLayerCurrent   atomic.Value

		ChatManager *chat.Manager
	}
)
