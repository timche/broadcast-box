package session

import (
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
	"unsafe"

	"github.com/glimesh/broadcast-box/internal/webrtc/sessions/whep"
)

func newTestSession() *Session {
	return &Session{
		StreamKey:    "test-stream",
		WHEPSessions: map[string]*whep.WHEPSession{},
	}
}

func (s *Session) addTestViewers(count int) {
	s.WHEPSessionsLock.Lock()
	for viewer := range count {
		s.WHEPSessions["viewer-"+strconv.Itoa(len(s.WHEPSessions)+viewer)] = nil
	}
	s.WHEPSessionsLock.Unlock()
}

func TestGetSessionStatsEventIsCachedWithinTTL(t *testing.T) {
	now := time.Unix(0, 0)

	streamSession := newTestSession()
	streamSession.statsEventCache.Clock = func() time.Time { return now }
	streamSession.addTestViewers(1)

	first := streamSession.GetSessionStatsEvent()
	if !strings.Contains(first, `"viewers":1`) {
		t.Fatalf("expected 1 viewer in %q", first)
	}

	// The underlying data changes, but within the TTL every viewer keeps getting
	// the exact same rendered event, with no re-marshaling.
	streamSession.addTestViewers(9)

	for range 10 {
		next := streamSession.GetSessionStatsEvent()
		if unsafe.StringData(next) != unsafe.StringData(first) {
			t.Fatalf("expected the identical cached string, got a re-rendered %q", next)
		}
	}
}

func TestGetSessionStatsEventRefreshesAfterTTL(t *testing.T) {
	now := time.Unix(0, 0)

	streamSession := newTestSession()
	streamSession.statsEventCache.Clock = func() time.Time { return now }
	streamSession.addTestViewers(1)

	if got := streamSession.GetSessionStatsEvent(); !strings.Contains(got, `"viewers":1`) {
		t.Fatalf("expected 1 viewer in %q", got)
	}

	streamSession.addTestViewers(1)

	now = now.Add(statsEventTTL - time.Nanosecond)
	if got := streamSession.GetSessionStatsEvent(); !strings.Contains(got, `"viewers":1`) {
		t.Fatalf("expected the cached event just before the TTL elapsed, got %q", got)
	}

	now = now.Add(time.Nanosecond)
	if got := streamSession.GetSessionStatsEvent(); !strings.Contains(got, `"viewers":2`) {
		t.Fatalf("expected a refreshed event once the TTL elapsed, got %q", got)
	}
}

func TestGetSessionStatsEventConcurrentReadersRenderOnce(t *testing.T) {
	const readers = 64

	// Freeze the clock so the assertion is about the single flight guard rather
	// than about how long the goroutines took to be scheduled.
	now := time.Unix(0, 0)

	streamSession := newTestSession()
	streamSession.statsEventCache.Clock = func() time.Time { return now }
	streamSession.addTestViewers(3)

	start := make(chan struct{})
	results := make([]string, readers)

	var waitGroup sync.WaitGroup
	for reader := range readers {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			<-start
			results[reader] = streamSession.GetSessionStatsEvent()
		}()
	}

	close(start)
	waitGroup.Wait()

	for reader := range readers {
		if unsafe.StringData(results[reader]) != unsafe.StringData(results[0]) {
			t.Fatalf("reader %d rendered its own copy of the event", reader)
		}
	}
}

func TestGetSessionStatsEventConcurrentWithViewerChurn(t *testing.T) {
	streamSession := newTestSession()

	var waitGroup sync.WaitGroup
	for range 8 {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			for range 200 {
				if got := streamSession.GetSessionStatsEvent(); !strings.HasPrefix(got, "event: status\ndata: ") {
					t.Errorf("malformed status event %q", got)
					return
				}
			}
		}()
	}

	waitGroup.Add(1)
	go func() {
		defer waitGroup.Done()
		for range 200 {
			streamSession.addTestViewers(1)

			streamSession.WHEPSessionsLock.Lock()
			streamSession.WHEPSessions = map[string]*whep.WHEPSession{}
			streamSession.WHEPSessionsLock.Unlock()
		}
	}()

	waitGroup.Wait()
}
