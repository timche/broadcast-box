package chat

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

// Send, TouchSession and GetSession only bump a session's activity timestamp,
// which is atomic, so they run under a read lock and proceed concurrently.
// This exercises them together with Cleanup, which does take the write lock.
func TestStoreConcurrentSessionActivity(t *testing.T) {
	store := NewInMemoryStore(64)

	const sessions = 16
	const iterations = 200

	sessionIDs := make([]string, 0, sessions)
	for i := range sessions {
		sessionIDs = append(sessionIDs, store.Connect(fmt.Sprintf("stream-%d", i), time.Now()))
	}

	var waitGroup sync.WaitGroup
	for _, sessionID := range sessionIDs {
		waitGroup.Add(1)

		go func(sessionID string) {
			defer waitGroup.Done()

			for range iterations {
				now := time.Now()

				if err := store.Send(sessionID, "hello", "someone", now); err != nil {
					t.Errorf("Send() = %v, want nil", err)
					return
				}

				if !store.TouchSession(sessionID, now) {
					t.Errorf("TouchSession() = false, want true")
					return
				}

				if _, ok := store.GetSession(sessionID, now); !ok {
					t.Errorf("GetSession() = false, want true")
					return
				}
			}
		}(sessionID)
	}

	// Concurrent Cleanup with a TTL long enough that nothing is actually
	// reaped, purely to contend the write lock against the readers above.
	waitGroup.Add(1)
	go func() {
		defer waitGroup.Done()

		for range iterations {
			store.Cleanup(time.Now(), time.Hour)
		}
	}()

	waitGroup.Wait()

	for _, sessionID := range sessionIDs {
		if _, ok := store.GetSession(sessionID, time.Now()); !ok {
			t.Fatalf("session %s was reaped but should have survived", sessionID)
		}
	}
}

// A session idle for longer than the TTL is removed; an active one is kept.
func TestStoreCleanupRespectsActivity(t *testing.T) {
	store := NewInMemoryStore(64)
	start := time.Now()

	idle := store.Connect("idle-stream", start)
	active := store.Connect("active-stream", start)

	later := start.Add(2 * time.Hour)
	store.TouchSession(active, later)
	store.Cleanup(later, time.Hour)

	if _, ok := store.GetSession(idle, later); ok {
		t.Error("idle session survived cleanup, want it reaped")
	}

	if _, ok := store.GetSession(active, later); !ok {
		t.Error("active session was reaped, want it kept")
	}
}
