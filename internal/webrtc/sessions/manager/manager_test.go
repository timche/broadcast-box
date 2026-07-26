package manager

import (
	"fmt"
	"sync"
	"testing"

	"github.com/glimesh/broadcast-box/internal/server/authorization"
	"github.com/glimesh/broadcast-box/internal/webrtc/codecs"
	"github.com/glimesh/broadcast-box/internal/webrtc/sessions/session"
	"github.com/pion/webrtc/v4"
)

func newTestManager(t *testing.T) *SessionManager {
	t.Helper()

	m := &SessionManager{}
	m.Setup()

	return m
}

// Creates a WHEP session on the given stream session, wired up the same way
// internal/webrtc.WHEP wires it up. Safe to call from any goroutine.
func addWHEPSession(s *session.Session, whepSessionID string) error {
	peerConnection, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		return fmt.Errorf("failed to create peer connection: %w", err)
	}

	audioTrack, videoTrack := codecs.GetDefaultTracks(s.StreamKey)

	if _, err = peerConnection.AddTrack(audioTrack); err != nil {
		_ = peerConnection.Close()
		return fmt.Errorf("failed to add audio track: %w", err)
	}

	videoRTCPSender, err := peerConnection.AddTrack(videoTrack)
	if err != nil {
		_ = peerConnection.Close()
		return fmt.Errorf("failed to add video track: %w", err)
	}

	if err = s.AddWHEP(whepSessionID, peerConnection, audioTrack, videoTrack, videoRTCPSender, func() {
		s.SendPLIToHost(whepSessionID)
	}); err != nil {
		_ = peerConnection.Close()
		return fmt.Errorf("failed to add WHEP session: %w", err)
	}

	return nil
}

func addTestWHEPSession(t *testing.T, s *session.Session, whepSessionID string) {
	t.Helper()

	if err := addWHEPSession(s, whepSessionID); err != nil {
		t.Fatal(err)
	}
}

func (m *SessionManager) whepIndexLen() int {
	m.whepSessionsLock.RLock()
	defer m.whepSessionsLock.RUnlock()

	return len(m.whepSessions)
}

func (m *SessionManager) sessionsLen() int {
	m.sessionsLock.RLock()
	defer m.sessionsLock.RUnlock()

	return len(m.sessions)
}

func TestGetSessionAndWHEPByIDFindsRegisteredSession(t *testing.T) {
	m := newTestManager(t)

	streamSession, err := m.addSession(authorization.PublicProfile{StreamKey: "stream-key"})
	if err != nil {
		t.Fatalf("failed to add session: %v", err)
	}

	t.Cleanup(streamSession.Close)

	addTestWHEPSession(t, streamSession, "whep-session-id")

	foundStreamSession, foundWHEPSession, ok := m.GetSessionAndWHEPByID("whep-session-id")
	if !ok {
		t.Fatal("expected the WHEP session to be found")
	}

	if foundStreamSession != streamSession {
		t.Fatal("expected the owning stream session to be returned")
	}

	if foundWHEPSession == nil || foundWHEPSession.SessionID != "whep-session-id" {
		t.Fatalf("expected the WHEP session to be returned, got %v", foundWHEPSession)
	}

	if _, ok = m.GetWHEPSessionByID("whep-session-id"); !ok {
		t.Fatal("expected GetWHEPSessionByID to find the WHEP session")
	}

	if _, _, ok = m.GetSessionAndWHEPByID("unknown-whep-session-id"); ok {
		t.Fatal("expected an unknown WHEP session id to miss")
	}
}

func TestWHEPIndexEntryRemovedWhenWHEPSessionCloses(t *testing.T) {
	m := newTestManager(t)

	streamSession, err := m.addSession(authorization.PublicProfile{StreamKey: "stream-key"})
	if err != nil {
		t.Fatalf("failed to add session: %v", err)
	}

	t.Cleanup(streamSession.Close)

	addTestWHEPSession(t, streamSession, "whep-session-a")
	addTestWHEPSession(t, streamSession, "whep-session-b")

	whepSession, ok := m.GetWHEPSessionByID("whep-session-a")
	if !ok {
		t.Fatal("expected the WHEP session to be indexed")
	}

	whepSession.Close()

	if _, _, ok = m.GetSessionAndWHEPByID("whep-session-a"); ok {
		t.Fatal("expected the closed WHEP session to be removed from the index")
	}

	if _, _, ok = m.GetSessionAndWHEPByID("whep-session-b"); !ok {
		t.Fatal("expected the remaining WHEP session to stay indexed")
	}

	if got := m.whepIndexLen(); got != 1 {
		t.Fatalf("expected 1 indexed WHEP session, got %d", got)
	}
}

// Closing the stream session bulk-removes its WHEP sessions, which must not
// leave entries behind in the index.
func TestWHEPIndexEmptyAfterStreamSessionCloses(t *testing.T) {
	m := newTestManager(t)

	streamSession, err := m.addSession(authorization.PublicProfile{StreamKey: "stream-key"})
	if err != nil {
		t.Fatalf("failed to add session: %v", err)
	}

	addTestWHEPSession(t, streamSession, "whep-session-a")
	addTestWHEPSession(t, streamSession, "whep-session-b")

	if got := m.whepIndexLen(); got != 2 {
		t.Fatalf("expected 2 indexed WHEP sessions, got %d", got)
	}

	streamSession.Close()

	if _, _, ok := m.GetSessionAndWHEPByID("whep-session-a"); ok {
		t.Fatal("expected whep-session-a to be removed from the index")
	}

	if _, _, ok := m.GetSessionAndWHEPByID("whep-session-b"); ok {
		t.Fatal("expected whep-session-b to be removed from the index")
	}

	if got := m.whepIndexLen(); got != 0 {
		t.Fatalf("expected the WHEP index to be empty, got %d entries", got)
	}

	if got := m.sessionsLen(); got != 0 {
		t.Fatalf("expected the session to be removed, got %d sessions", got)
	}
}

// A WHEP session added to an already closed stream session would never be
// removed again, so it must be rejected instead of leaking into the index.
func TestAddWHEPOnClosedSessionIsRejected(t *testing.T) {
	m := newTestManager(t)

	streamSession, err := m.addSession(authorization.PublicProfile{StreamKey: "stream-key"})
	if err != nil {
		t.Fatalf("failed to add session: %v", err)
	}

	streamSession.Close()

	peerConnection, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("failed to create peer connection: %v", err)
	}
	defer func() {
		_ = peerConnection.Close()
	}()

	audioTrack, videoTrack := codecs.GetDefaultTracks(streamSession.StreamKey)
	if _, err = peerConnection.AddTrack(audioTrack); err != nil {
		t.Fatalf("failed to add audio track: %v", err)
	}

	videoRTCPSender, err := peerConnection.AddTrack(videoTrack)
	if err != nil {
		t.Fatalf("failed to add video track: %v", err)
	}

	if err = streamSession.AddWHEP("whep-session-id", peerConnection, audioTrack, videoTrack, videoRTCPSender, func() {}); err == nil {
		t.Fatal("expected AddWHEP on a closed session to fail")
	}

	if got := m.whepIndexLen(); got != 0 {
		t.Fatalf("expected the WHEP index to be empty, got %d entries", got)
	}
}

func TestSendPLIToHostWithoutHost(t *testing.T) {
	m := newTestManager(t)

	streamSession, err := m.addSession(authorization.PublicProfile{StreamKey: "stream-key"})
	if err != nil {
		t.Fatalf("failed to add session: %v", err)
	}

	// No host has been added yet, this must be a no-op rather than a panic.
	streamSession.SendPLIToHost("whep-session-id")
}

func TestWHEPIndexConcurrentAddRemoveLookup(t *testing.T) {
	m := newTestManager(t)

	const (
		workers    = 8
		iterations = 5
	)

	var (
		writers sync.WaitGroup
		readers sync.WaitGroup
	)

	stopReaders := make(chan struct{})
	for reader := 0; reader < 2; reader++ {
		readers.Add(1)
		go func() {
			defer readers.Done()
			for {
				select {
				case <-stopReaders:
					return
				default:
					for worker := 0; worker < workers; worker++ {
						m.GetSessionAndWHEPByID(fmt.Sprintf("whep-%d-0", worker))
						m.GetSessionByHostSessionID("host-session-id")
						m.GetSessionStates(true)
					}
				}
			}
		}()
	}

	for worker := 0; worker < workers; worker++ {
		writers.Add(1)
		go func(worker int) {
			defer writers.Done()

			for iteration := 0; iteration < iterations; iteration++ {
				streamKey := fmt.Sprintf("stream-%d-%d", worker, iteration)
				whepSessionID := fmt.Sprintf("whep-%d-%d", worker, iteration)

				streamSession, err := m.GetOrAddSession(authorization.PublicProfile{StreamKey: streamKey}, false)
				if err != nil {
					t.Errorf("failed to add session: %v", err)
					return
				}

				if err := addWHEPSession(streamSession, whepSessionID); err != nil {
					t.Error(err)
					return
				}

				whepSession, ok := m.GetWHEPSessionByID(whepSessionID)
				if !ok {
					t.Errorf("expected %q to be indexed", whepSessionID)
					return
				}

				whepSession.Close()

				if _, _, ok := m.GetSessionAndWHEPByID(whepSessionID); ok {
					t.Errorf("expected %q to be removed from the index", whepSessionID)
					return
				}
			}
		}(worker)
	}

	writers.Wait()
	close(stopReaders)
	readers.Wait()

	if got := m.whepIndexLen(); got != 0 {
		t.Fatalf("expected the WHEP index to be empty, got %d entries", got)
	}

	if got := m.sessionsLen(); got != 0 {
		t.Fatalf("expected all sessions to be closed, got %d sessions", got)
	}
}
