package session

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/glimesh/broadcast-box/internal/chat"
	"github.com/glimesh/broadcast-box/internal/webrtc/sessions/whep"
	"github.com/glimesh/broadcast-box/internal/webrtc/sessions/whip"
	"github.com/glimesh/broadcast-box/internal/webrtc/utils"
)

type Session struct {

	// Protects StreamKey, MOTD, HasHost, IsPublic
	StatusLock sync.RWMutex
	StreamKey  string

	MOTD        string
	HasHost     atomic.Bool
	IsPublic    bool
	StreamStart time.Time

	Host atomic.Pointer[whip.WHIPSession]

	closeOnce sync.Once
	onClose   func()

	// Protects WHEPSessions and isClosed
	WHEPSessionsLock sync.RWMutex
	WHEPSessions     map[string]*whep.WHEPSession
	isClosed         bool

	// Hooks that let the owner of this session (the session manager) keep an
	// index of WHEP sessions in sync with WHEPSessions. They are invoked while
	// WHEPSessionsLock is held, so they must never call back into the session.
	onWHEPSessionAdded   func(whepSessionID string, whepSession *whep.WHEPSession)
	onWHEPSessionRemoved func(whepSessionID string)

	ChatManager *chat.Manager

	// Caches the rendered status SSE event, which is identical for every viewer
	// of this session. See GetSessionStatsEvent.
	statsEventCache utils.CachedString
}
