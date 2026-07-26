package chat

import (
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

type subscriber struct {
	ch chan Event
}

type room struct {
	mu           sync.Mutex
	subscribers  map[string]*subscriber
	history      []Event
	nextEventID  uint64
	lastActivity time.Time
}

// The stored form of a chat session. lastActivity is atomic so that the hot
// paths (send, touch, lookup), which only need to bump it, can hold a read lock
// on the store instead of an exclusive one.
type storedSession struct {
	id           string
	streamKey    string
	lastActivity atomic.Int64
}

func (s *storedSession) touch(now time.Time) {
	s.lastActivity.Store(now.UnixNano())
}

func (s *storedSession) snapshot() *Session {
	return &Session{
		ID:           s.id,
		StreamKey:    s.streamKey,
		LastActivity: time.Unix(0, s.lastActivity.Load()),
	}
}

type InMemoryStore struct {
	mu         sync.RWMutex
	rooms      map[string]*room
	sessions   map[string]*storedSession
	maxHistory int
	maxReplay  int
}

func NewInMemoryStore(maxHistory int) *InMemoryStore {
	return NewInMemoryStoreWithReplay(maxHistory, DefaultMaxReplay)
}

func NewInMemoryStoreWithReplay(maxHistory int, maxReplay int) *InMemoryStore {
	if maxHistory <= 0 {
		maxHistory = DefaultMaxHistory
	}

	if maxReplay <= 0 {
		maxReplay = DefaultMaxReplay
	}

	// Replaying more than is retained is not meaningful.
	if maxReplay > maxHistory {
		maxReplay = maxHistory
	}

	return &InMemoryStore{
		rooms:      make(map[string]*room),
		sessions:   make(map[string]*storedSession),
		maxHistory: maxHistory,
		maxReplay:  maxReplay,
	}
}

// Builds the backlog handed to a newly subscribed client. Callers must hold the
// room lock.
//
// A client reconnecting with lastEventID gets everything it missed, so no
// message is lost across a dropped connection. A fresh client gets only the
// most recent maxReplay events: retention exists so reconnects can be filled,
// not so that every new viewer is served the entire history.
func (r *room) replayLocked(lastEventID uint64, maxReplay int) []Event {
	start := 0

	if lastEventID > 0 {
		// history is append-only with ascending IDs, so the first event newer
		// than lastEventID marks the start of what the client missed.
		start = sort.Search(len(r.history), func(i int) bool {
			return r.history[i].ID > lastEventID
		})
	} else if len(r.history) > maxReplay {
		start = len(r.history) - maxReplay
	}

	if start >= len(r.history) {
		return nil
	}

	history := make([]Event, len(r.history)-start)
	copy(history, r.history[start:])

	return history
}

// Looks up a session and bumps its activity timestamp under a read lock.
func (s *InMemoryStore) lookupAndTouch(sessionID string, now time.Time) (*storedSession, bool) {
	s.mu.RLock()
	session, ok := s.sessions[sessionID]
	s.mu.RUnlock()

	if !ok {
		return nil, false
	}

	session.touch(now)

	return session, true
}

// Returns an existing room under a read lock, falling back to the write lock
// only when the room has to be created.
func (s *InMemoryStore) getOrCreateRoom(streamKey string, now time.Time) *room {
	s.mu.RLock()
	r, ok := s.rooms[streamKey]
	s.mu.RUnlock()

	if ok {
		r.mu.Lock()
		r.lastActivity = now
		r.mu.Unlock()

		return r
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	return s.getOrCreateRoomLocked(streamKey, now)
}

func (s *InMemoryStore) Connect(streamKey string, now time.Time) string {
	sessionID := uuid.New().String()
	session := &storedSession{
		id:        sessionID,
		streamKey: streamKey,
	}
	session.touch(now)

	s.mu.Lock()
	s.sessions[sessionID] = session
	s.getOrCreateRoomLocked(streamKey, now)
	s.mu.Unlock()

	return sessionID
}

func (s *InMemoryStore) GetSession(sessionID string, now time.Time) (*Session, bool) {
	session, ok := s.lookupAndTouch(sessionID, now)
	if !ok {
		return nil, false
	}

	return session.snapshot(), true
}

func (s *InMemoryStore) TouchSession(sessionID string, now time.Time) bool {
	_, ok := s.lookupAndTouch(sessionID, now)

	return ok
}

func (s *InMemoryStore) Subscribe(sessionID string, lastEventID uint64, now time.Time) (chan Event, func(), []Event, error) {
	session, ok := s.lookupAndTouch(sessionID, now)
	if !ok {
		return nil, nil, nil, fmt.Errorf("invalid session")
	}

	s.mu.RLock()
	r, ok := s.rooms[session.streamKey]
	s.mu.RUnlock()

	if !ok {
		return nil, nil, nil, fmt.Errorf("room not found")
	}

	return s.subscribeToRoom(r, lastEventID, now)
}

func (s *InMemoryStore) SubscribeStream(streamKey string, lastEventID uint64, now time.Time) (chan Event, func(), []Event, error) {
	return s.subscribeToRoom(s.getOrCreateRoom(streamKey, now), lastEventID, now)
}

func (s *InMemoryStore) Send(sessionID string, text string, displayName string, now time.Time) error {
	session, ok := s.lookupAndTouch(sessionID, now)
	if !ok {
		return fmt.Errorf("invalid session")
	}

	s.mu.RLock()
	r, ok := s.rooms[session.streamKey]
	s.mu.RUnlock()

	if !ok {
		return fmt.Errorf("room not found")
	}

	s.sendToRoom(r, text, displayName, now)

	return nil
}

func (s *InMemoryStore) SendToStream(streamKey string, text string, displayName string, now time.Time) error {
	s.sendToRoom(s.getOrCreateRoom(streamKey, now), text, displayName, now)

	return nil
}

func (s *InMemoryStore) Cleanup(now time.Time, ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for id, session := range s.sessions {
		if now.Sub(time.Unix(0, session.lastActivity.Load())) > ttl {
			delete(s.sessions, id)
		}
	}

	for key, r := range s.rooms {
		r.mu.Lock()
		if len(r.subscribers) == 0 && now.Sub(r.lastActivity) > ttl {
			delete(s.rooms, key)
		}
		r.mu.Unlock()
	}
}

func (s *InMemoryStore) subscribeToRoom(r *room, lastEventID uint64, now time.Time) (chan Event, func(), []Event, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.lastActivity = now
	subID := uuid.New().String()
	ch := make(chan Event, 100)
	r.subscribers[subID] = &subscriber{ch: ch}

	history := r.replayLocked(lastEventID, s.maxReplay)

	cleanup := func() {
		r.mu.Lock()
		defer r.mu.Unlock()

		sub, ok := r.subscribers[subID]
		if !ok {
			return
		}

		delete(r.subscribers, subID)
		close(sub.ch)
	}

	return ch, cleanup, history, nil
}

func (s *InMemoryStore) sendToRoom(r *room, text string, displayName string, now time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.lastActivity = now
	event := Event{
		ID:   r.nextEventID,
		Type: EventTypeMessage,
		Message: Message{
			ID:          uuid.New().String(),
			TS:          now.UnixMilli(),
			Text:        text,
			DisplayName: displayName,
		},
	}
	r.nextEventID++

	if len(r.history) >= s.maxHistory {
		r.history = append(r.history[1:], event)
	} else {
		r.history = append(r.history, event)
	}

	for _, sub := range r.subscribers {
		select {
		case sub.ch <- event:
		default:
		}
	}
}

func (s *InMemoryStore) getOrCreateRoomLocked(streamKey string, now time.Time) *room {
	r, ok := s.rooms[streamKey]
	if ok {
		r.lastActivity = now
		return r
	}

	r = &room{
		subscribers:  make(map[string]*subscriber),
		history:      make([]Event, 0, s.maxHistory),
		nextEventID:  1,
		lastActivity: now,
	}
	s.rooms[streamKey] = r

	return r
}
