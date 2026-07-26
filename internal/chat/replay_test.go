package chat

import (
	"testing"
	"time"
)

func sendN(t *testing.T, store *InMemoryStore, streamKey string, count int) {
	t.Helper()

	for i := range count {
		if err := store.SendToStream(streamKey, "message", "sender", time.Now()); err != nil {
			t.Fatalf("SendToStream(%d) = %v, want nil", i, err)
		}
	}
}

// A first-time subscriber gets at most maxReplay events, however much history
// the room has retained.
func TestSubscribeStreamCapsReplayForNewClient(t *testing.T) {
	const maxHistory = 500
	const maxReplay = 20

	store := NewInMemoryStoreWithReplay(maxHistory, maxReplay)
	sendN(t, store, "stream", 100)

	_, cleanup, history, err := store.SubscribeStream("stream", 0, time.Now())
	if err != nil {
		t.Fatalf("SubscribeStream() = %v, want nil", err)
	}
	defer cleanup()

	if len(history) != maxReplay {
		t.Fatalf("len(history) = %d, want %d", len(history), maxReplay)
	}

	// The cap must keep the NEWEST events, not the oldest.
	if history[len(history)-1].ID != 100 {
		t.Errorf("last replayed event ID = %d, want 100", history[len(history)-1].ID)
	}

	if history[0].ID != 81 {
		t.Errorf("first replayed event ID = %d, want 81", history[0].ID)
	}
}

// A reconnecting client is caught up on everything it missed, even when that
// exceeds maxReplay, so no message is lost across a dropped connection.
func TestSubscribeStreamReplaysAllMissedEventsOnReconnect(t *testing.T) {
	store := NewInMemoryStoreWithReplay(500, 20)
	sendN(t, store, "stream", 100)

	_, cleanup, history, err := store.SubscribeStream("stream", 10, time.Now())
	if err != nil {
		t.Fatalf("SubscribeStream() = %v, want nil", err)
	}
	defer cleanup()

	if len(history) != 90 {
		t.Fatalf("len(history) = %d, want 90 (all events after ID 10)", len(history))
	}

	if history[0].ID != 11 {
		t.Errorf("first replayed event ID = %d, want 11", history[0].ID)
	}
}

// A client already up to date receives nothing.
func TestSubscribeStreamReplaysNothingWhenCaughtUp(t *testing.T) {
	store := NewInMemoryStoreWithReplay(500, 20)
	sendN(t, store, "stream", 10)

	_, cleanup, history, err := store.SubscribeStream("stream", 10, time.Now())
	if err != nil {
		t.Fatalf("SubscribeStream() = %v, want nil", err)
	}
	defer cleanup()

	if len(history) != 0 {
		t.Fatalf("len(history) = %d, want 0", len(history))
	}
}

func TestNewInMemoryStoreWithReplayClampsConfiguration(t *testing.T) {
	// Replaying more than is retained is meaningless, so it is clamped.
	if store := NewInMemoryStoreWithReplay(50, 5000); store.maxReplay != 50 {
		t.Errorf("maxReplay = %d, want 50 (clamped to maxHistory)", store.maxReplay)
	}

	// Non-positive values fall back to the defaults.
	store := NewInMemoryStoreWithReplay(0, 0)
	if store.maxHistory != DefaultMaxHistory {
		t.Errorf("maxHistory = %d, want %d", store.maxHistory, DefaultMaxHistory)
	}

	if store.maxReplay != DefaultMaxReplay {
		t.Errorf("maxReplay = %d, want %d", store.maxReplay, DefaultMaxReplay)
	}
}

// Replay must stay correct once the room has wrapped past maxHistory and the
// oldest events have been evicted.
func TestReplayAfterHistoryWraps(t *testing.T) {
	const maxHistory = 50

	store := NewInMemoryStoreWithReplay(maxHistory, 10)
	sendN(t, store, "stream", 200)

	_, cleanup, history, err := store.SubscribeStream("stream", 0, time.Now())
	if err != nil {
		t.Fatalf("SubscribeStream() = %v, want nil", err)
	}
	defer cleanup()

	if len(history) != 10 {
		t.Fatalf("len(history) = %d, want 10", len(history))
	}

	if history[len(history)-1].ID != 200 {
		t.Errorf("last replayed event ID = %d, want 200", history[len(history)-1].ID)
	}

	// Asking for events older than anything still retained yields only what
	// survives, not a panic or a negative slice.
	_, cleanup2, missed, err := store.SubscribeStream("stream", 1, time.Now())
	if err != nil {
		t.Fatalf("SubscribeStream() = %v, want nil", err)
	}
	defer cleanup2()

	if len(missed) != maxHistory {
		t.Fatalf("len(missed) = %d, want %d (everything still retained)", len(missed), maxHistory)
	}
}
