package manager

import (
	"sync"

	"github.com/glimesh/broadcast-box/internal/chat"
	"github.com/glimesh/broadcast-box/internal/webrtc/sessions/session"
	"github.com/glimesh/broadcast-box/internal/webrtc/sessions/whep"
	"github.com/pion/webrtc/v4"
)

var (
	SessionsManager *SessionManager

	APIWHIP *webrtc.API
	APIWHEP *webrtc.API
)

type SessionManager struct {
	sessionsLock sync.RWMutex
	sessions     map[string]*session.Session

	// Index of WHEP session ID -> owning session, kept in sync with every
	// session's WHEPSessions map by the hooks installed in addSession. It turns
	// WHEP lookups into a single map read instead of a scan over every live
	// stream that also takes each stream's WHEPSessionsLock.
	//
	// Lock ordering: Session.WHEPSessionsLock is always acquired before
	// whepSessionsLock, never the other way around.
	whepSessionsLock sync.RWMutex
	whepSessions     map[string]whepSessionEntry

	ChatManager *chat.Manager
}

type whepSessionEntry struct {
	session     *session.Session
	whepSession *whep.WHEPSession
}
