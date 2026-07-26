package whep

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func newPLITestSession(counter *atomic.Int64) *WHEPSession {
	w := &WHEPSession{
		SessionID: "test-session",
		pliSender: func() {
			counter.Add(1)
		},
	}

	w.IsSessionClosed.Store(false)
	return w
}

func TestSendPLIIsRateLimited(t *testing.T) {
	sent := atomic.Int64{}
	w := newPLITestSession(&sent)

	const callCount = 10000
	for i := 0; i < callCount; i++ {
		w.SendPLI()
	}

	got := sent.Load()
	if got < 1 {
		t.Fatalf("expected at least one PLI to be sent, got %d", got)
	}

	// The whole loop runs well inside a single minPLIInterval window, so only
	// the very first call should have made it through the gate.
	if got > 2 {
		t.Fatalf("expected PLIs to be rate limited, got %d sends for %d calls", got, callCount)
	}
}

func TestSendPLIFirstCallIsImmediate(t *testing.T) {
	sent := atomic.Int64{}
	w := newPLITestSession(&sent)

	if last := w.lastPLISent.Load(); last != 0 {
		t.Fatalf("expected zero valued lastPLISent, got %d", last)
	}

	w.SendPLI()

	if got := sent.Load(); got != 1 {
		t.Fatalf("expected the first PLI to be sent immediately, got %d sends", got)
	}
}

func TestSendPLISendsAgainAfterInterval(t *testing.T) {
	sent := atomic.Int64{}
	w := newPLITestSession(&sent)

	w.SendPLI()
	w.SendPLI()

	if got := sent.Load(); got != 1 {
		t.Fatalf("expected 1 send before the interval elapsed, got %d", got)
	}

	// Simulate the interval elapsing rather than sleeping for it.
	w.lastPLISent.Store(time.Now().Add(-2 * minPLIInterval).UnixNano())

	w.SendPLI()

	if got := sent.Load(); got != 2 {
		t.Fatalf("expected a second send after the interval elapsed, got %d", got)
	}
}

func TestSendPLIConcurrentCallersOnlySendOnce(t *testing.T) {
	sent := atomic.Int64{}
	w := newPLITestSession(&sent)

	const goroutines = 32
	const callsPerGoroutine = 100

	start := make(chan struct{})
	wg := sync.WaitGroup{}
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			<-start
			for j := 0; j < callsPerGoroutine; j++ {
				w.SendPLI()
			}
		}()
	}

	close(start)
	wg.Wait()

	if got := sent.Load(); got != 1 {
		t.Fatalf("expected exactly 1 send from %d concurrent calls, got %d", goroutines*callsPerGoroutine, got)
	}
}

func TestSendPLINowBypassesRateLimit(t *testing.T) {
	sent := atomic.Int64{}
	w := newPLITestSession(&sent)

	const callCount = 10
	for i := 0; i < callCount; i++ {
		w.sendPLINow()
	}

	if got := sent.Load(); got != callCount {
		t.Fatalf("expected %d forced sends, got %d", callCount, got)
	}
}

func TestSendPLINowResetsTheRateLimitWindow(t *testing.T) {
	sent := atomic.Int64{}
	w := newPLITestSession(&sent)

	w.sendPLINow()
	w.SendPLI()

	if got := sent.Load(); got != 1 {
		t.Fatalf("expected the forced send to start a new rate limit window, got %d sends", got)
	}
}

func TestSendPLIIsSkippedForClosedSessions(t *testing.T) {
	sent := atomic.Int64{}
	w := newPLITestSession(&sent)
	w.IsSessionClosed.Store(true)

	w.SendPLI()
	w.sendPLINow()

	if got := sent.Load(); got != 0 {
		t.Fatalf("expected no sends for a closed session, got %d", got)
	}
}
