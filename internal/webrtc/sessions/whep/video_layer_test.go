package whep

import (
	"sync"
	"sync/atomic"
	"testing"
)

func newTestSession(t *testing.T) (*WHEPSession, *atomic.Int64) {
	t.Helper()

	pliCount := &atomic.Int64{}
	session := CreateNewWHEP(
		"test-session",
		"test-stream-key",
		nil,
		nil,
		nil,
		func() { pliCount.Add(1) },
		nil,
	)

	return session, pliCount
}

func assertVideoLayerState(t *testing.T, w *WHEPSession, layer string, priority int, explicit bool) {
	t.Helper()

	state := w.loadVideoLayer()
	if state.layer != layer || state.priority != priority || state.explicit != explicit {
		t.Fatalf("unexpected video layer state, got %+v want {layer:%q priority:%d explicit:%t}", state, layer, priority, explicit)
	}
}

func TestGetVideoLayerOrDefaultSelectsFirstLayer(t *testing.T) {
	session, _ := newTestSession(t)
	session.IsWaitingForKeyframe.Store(false)

	if got := session.GetVideoLayerOrDefault("mid", 2); got != "mid" {
		t.Fatalf("expected first layer to be selected, got %q", got)
	}

	assertVideoLayerState(t, session, "mid", 2, false)

	if !session.IsWaitingForKeyframe.Load() {
		t.Fatal("expected IsWaitingForKeyframe to be set when a layer is selected")
	}

	if got := session.GetVideoLayerCurrent(); got != "mid" {
		t.Fatalf("expected GetVideoLayerCurrent to be %q, got %q", "mid", got)
	}
}

func TestGetVideoLayerOrDefaultIsStableForSameLayer(t *testing.T) {
	session, _ := newTestSession(t)

	if got := session.GetVideoLayerOrDefault("high", 1); got != "high" {
		t.Fatalf("expected %q, got %q", "high", got)
	}

	session.IsWaitingForKeyframe.Store(false)

	for i := 0; i < 10; i++ {
		if got := session.GetVideoLayerOrDefault("high", 1); got != "high" {
			t.Fatalf("expected %q, got %q", "high", got)
		}
	}

	if session.IsWaitingForKeyframe.Load() {
		t.Fatal("expected IsWaitingForKeyframe to stay unset when the selection does not change")
	}

	assertVideoLayerState(t, session, "high", 1, false)
}

func TestGetVideoLayerOrDefaultUpdatesPriorityForSameLayer(t *testing.T) {
	session, _ := newTestSession(t)

	if got := session.GetVideoLayerOrDefault("high", 5); got != "high" {
		t.Fatalf("expected %q, got %q", "high", got)
	}

	session.IsWaitingForKeyframe.Store(false)

	// The publisher re-announced the same layer with a different priority, the
	// priority must be adopted without forcing a new keyframe.
	if got := session.GetVideoLayerOrDefault("high", 3); got != "high" {
		t.Fatalf("expected %q, got %q", "high", got)
	}

	assertVideoLayerState(t, session, "high", 3, false)

	if session.IsWaitingForKeyframe.Load() {
		t.Fatal("expected IsWaitingForKeyframe to stay unset when only the priority changes")
	}
}

func TestGetVideoLayerOrDefaultBetterPriorityWins(t *testing.T) {
	session, _ := newTestSession(t)

	if got := session.GetVideoLayerOrDefault("low", 3); got != "low" {
		t.Fatalf("expected %q, got %q", "low", got)
	}

	session.IsWaitingForKeyframe.Store(false)

	// Lower numeric priority is a better layer, it must take over.
	if got := session.GetVideoLayerOrDefault("high", 1); got != "high" {
		t.Fatalf("expected %q to win, got %q", "high", got)
	}

	assertVideoLayerState(t, session, "high", 1, false)

	if !session.IsWaitingForKeyframe.Load() {
		t.Fatal("expected IsWaitingForKeyframe to be set when the layer switches")
	}

	session.IsWaitingForKeyframe.Store(false)

	// A worse layer must not take over.
	if got := session.GetVideoLayerOrDefault("low", 3); got != "high" {
		t.Fatalf("expected %q to be kept, got %q", "high", got)
	}

	assertVideoLayerState(t, session, "high", 1, false)

	if session.IsWaitingForKeyframe.Load() {
		t.Fatal("expected IsWaitingForKeyframe to stay unset when a worse layer is offered")
	}
}

func TestGetVideoLayerOrDefaultUnsetPriorityIsReplaced(t *testing.T) {
	session, _ := newTestSession(t)

	// Priority 0 means "unknown", so any later layer replaces the selection.
	if got := session.GetVideoLayerOrDefault("low", 0); got != "low" {
		t.Fatalf("expected %q, got %q", "low", got)
	}

	assertVideoLayerState(t, session, "low", 0, false)

	if got := session.GetVideoLayerOrDefault("high", 100); got != "high" {
		t.Fatalf("expected %q to replace a layer with unset priority, got %q", "high", got)
	}

	assertVideoLayerState(t, session, "high", 100, false)
}

func TestSetVideoLayerIsNotOverriddenByPriority(t *testing.T) {
	session, pliCount := newTestSession(t)

	if got := session.GetVideoLayerOrDefault("low", 3); got != "low" {
		t.Fatalf("expected %q, got %q", "low", got)
	}

	session.SetVideoLayer("mid")

	if pliCount.Load() != 1 {
		t.Fatalf("expected SetVideoLayer to send a PLI, got %d", pliCount.Load())
	}

	if !session.IsWaitingForKeyframe.Load() {
		t.Fatal("expected IsWaitingForKeyframe to be set by SetVideoLayer")
	}

	assertVideoLayerState(t, session, "mid", 0, true)

	session.IsWaitingForKeyframe.Store(false)

	// A better priority layer must not steal an explicitly chosen layer, and the
	// explicit selection must not be mutated by the automatic selection.
	if got := session.GetVideoLayerOrDefault("high", 1); got != "mid" {
		t.Fatalf("expected explicit layer %q to stick, got %q", "mid", got)
	}

	if got := session.GetVideoLayerOrDefault("low", 3); got != "mid" {
		t.Fatalf("expected explicit layer %q to stick, got %q", "mid", got)
	}

	assertVideoLayerState(t, session, "mid", 0, true)

	if session.IsWaitingForKeyframe.Load() {
		t.Fatal("expected IsWaitingForKeyframe to stay unset while an explicit layer is held")
	}
}

func TestSetVideoLayerEmptyRestoresAutomaticSelection(t *testing.T) {
	session, _ := newTestSession(t)

	session.SetVideoLayer("mid")
	assertVideoLayerState(t, session, "mid", 0, true)

	session.SetVideoLayer("")
	assertVideoLayerState(t, session, "", 0, false)

	if got := session.GetVideoLayerOrDefault("high", 1); got != "high" {
		t.Fatalf("expected automatic selection to resume, got %q", got)
	}

	assertVideoLayerState(t, session, "high", 1, false)
}

func TestSetAudioLayer(t *testing.T) {
	session, pliCount := newTestSession(t)

	if got := session.GetAudioLayerCurrent(); got != "" {
		t.Fatalf("expected empty audio layer, got %q", got)
	}

	session.SetAudioLayer("audio-high")

	if got := session.GetAudioLayerCurrent(); got != "audio-high" {
		t.Fatalf("expected %q, got %q", "audio-high", got)
	}

	if pliCount.Load() != 1 {
		t.Fatalf("expected SetAudioLayer to send a PLI, got %d", pliCount.Load())
	}
}

func TestResetForNewPublisherClearsState(t *testing.T) {
	session, _ := newTestSession(t)

	session.SetAudioLayer("audio-high")
	session.SetVideoLayer("mid")
	assertVideoLayerState(t, session, "mid", 0, true)

	session.IsWaitingForKeyframe.Store(false)
	session.ResetForNewPublisher()

	assertVideoLayerState(t, session, "", 0, false)

	if got := session.GetAudioLayerCurrent(); got != "" {
		t.Fatalf("expected audio layer to be cleared, got %q", got)
	}

	if !session.IsWaitingForKeyframe.Load() {
		t.Fatal("expected IsWaitingForKeyframe to be set by ResetForNewPublisher")
	}

	// Automatic selection restarts from scratch.
	if got := session.GetVideoLayerOrDefault("low", 3); got != "low" {
		t.Fatalf("expected %q, got %q", "low", got)
	}

	assertVideoLayerState(t, session, "low", 3, false)
}

func TestGetWHEPSessionStatusReportsLayers(t *testing.T) {
	session, _ := newTestSession(t)

	session.SetAudioLayer("audio-high")
	session.SetVideoLayer("mid")

	status := session.GetWHEPSessionStatus()
	if status.AudioLayerCurrent != "audio-high" {
		t.Fatalf("expected audio layer %q, got %q", "audio-high", status.AudioLayerCurrent)
	}

	if status.VideoLayerCurrent != "mid" {
		t.Fatalf("expected video layer %q, got %q", "mid", status.VideoLayerCurrent)
	}
}

// Hammers the layer selection from many goroutines, intended to be run with -race.
func TestGetVideoLayerOrDefaultConcurrent(t *testing.T) {
	session, _ := newTestSession(t)

	layers := []struct {
		id       string
		priority int
	}{
		{"high", 1},
		{"mid", 2},
		{"low", 3},
	}

	valid := map[string]bool{"": true}
	for _, layer := range layers {
		valid[layer.id] = true
	}

	const (
		readers    = 16
		iterations = 20000
	)

	stop := make(chan struct{})
	readerGroup := sync.WaitGroup{}
	writerGroup := sync.WaitGroup{}

	for i := 0; i < readers; i++ {
		layer := layers[i%len(layers)]

		readerGroup.Add(1)
		go func() {
			defer readerGroup.Done()

			for j := 0; j < iterations; j++ {
				got := session.GetVideoLayerOrDefault(layer.id, layer.priority)
				if !valid[got] {
					t.Errorf("unexpected layer %q", got)
					return
				}
			}
		}()
	}

	// Writers racing against the readers above.
	writerGroup.Add(1)
	go func() {
		defer writerGroup.Done()

		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			default:
			}

			switch i % 4 {
			case 0:
				session.SetVideoLayer(layers[i%len(layers)].id)
			case 1:
				session.SetVideoLayer("")
			case 2:
				session.ResetForNewPublisher()
			case 3:
				session.SetAudioLayer(layers[i%len(layers)].id)
			}
		}
	}()

	writerGroup.Add(1)
	go func() {
		defer writerGroup.Done()

		for {
			select {
			case <-stop:
				return
			default:
			}

			status := session.GetWHEPSessionStatus()
			if !valid[status.VideoLayerCurrent] {
				t.Errorf("unexpected layer in status %q", status.VideoLayerCurrent)
				return
			}
		}
	}()

	readerGroup.Wait()
	close(stop)
	writerGroup.Wait()
}

func BenchmarkGetVideoLayerOrDefault(b *testing.B) {
	session := CreateNewWHEP("bench-session", "bench-stream-key", nil, nil, nil, func() {}, nil)
	session.GetVideoLayerOrDefault("high", 1)

	b.ReportAllocs()
	b.ResetTimer()

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			if session.GetVideoLayerOrDefault("high", 1) != "high" {
				b.Fatal("unexpected layer")
			}
		}
	})
}
