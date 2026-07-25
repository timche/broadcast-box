package whip

import (
	"strings"
	"sync"
	"testing"
	"unsafe"

	"github.com/glimesh/broadcast-box/internal/webrtc/codecs"
	"github.com/pion/webrtc/v4"
)

func newTestWHIPSession() *WHIPSession {
	return &WHIPSession{
		ID:          "test-whip-session",
		AudioTracks: make(map[string]*AudioTrack),
		VideoTracks: make(map[string]*VideoTrack),
	}
}

func TestGetAvailableLayersEventIsCached(t *testing.T) {
	whipSession := newTestWHIPSession()
	if _, err := whipSession.addVideoTrack("high", "streamKey", codecs.VideoTrackCodecH264); err != nil {
		t.Fatalf("addVideoTrack: %v", err)
	}

	first := whipSession.GetAvailableLayersEvent()
	if !strings.Contains(first, `"encodingId":"high"`) {
		t.Fatalf("expected the video layer in the event, got %q", first)
	}

	for range 10 {
		next := whipSession.GetAvailableLayersEvent()
		if unsafe.StringData(next) != unsafe.StringData(first) {
			t.Fatalf("expected the identical cached string, got a re-rendered %q", next)
		}
	}
}

func TestGetAvailableLayersEventInvalidatedOnTrackChange(t *testing.T) {
	whipSession := newTestWHIPSession()

	empty := whipSession.GetAvailableLayersEvent()
	if strings.Contains(empty, "encodingId") {
		t.Fatalf("expected no layers, got %q", empty)
	}

	if _, err := whipSession.addVideoTrack("high", "streamKey", codecs.VideoTrackCodecH264); err != nil {
		t.Fatalf("addVideoTrack: %v", err)
	}
	withVideo := whipSession.GetAvailableLayersEvent()
	if !strings.Contains(withVideo, `"encodingId":"high"`) {
		t.Fatalf("expected the added video layer to be visible immediately, got %q", withVideo)
	}

	if _, err := whipSession.addAudioTrack("audio", "streamKey", codecs.GetAudioTrackCodec(webrtc.MimeTypeOpus)); err != nil {
		t.Fatalf("addAudioTrack: %v", err)
	}
	withAudio := whipSession.GetAvailableLayersEvent()
	if !strings.Contains(withAudio, `"encodingId":"audio"`) {
		t.Fatalf("expected the added audio layer to be visible immediately, got %q", withAudio)
	}

	// Adding a track that already exists is a no-op, but must not lose layers.
	if _, err := whipSession.addVideoTrack("high", "streamKey", codecs.VideoTrackCodecH264); err != nil {
		t.Fatalf("addVideoTrack: %v", err)
	}
	if got := whipSession.GetAvailableLayersEvent(); got != withAudio {
		t.Fatalf("expected %q after a duplicate add, got %q", withAudio, got)
	}

	whipSession.RemoveTracks()
	if got := whipSession.GetAvailableLayersEvent(); got != empty {
		t.Fatalf("expected the empty layers event after RemoveTracks, got %q", got)
	}
}

func TestGetAvailableLayersEventConcurrentWithTrackChanges(t *testing.T) {
	whipSession := newTestWHIPSession()

	var waitGroup sync.WaitGroup
	for range 8 {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			for range 200 {
				if got := whipSession.GetAvailableLayersEvent(); !strings.HasPrefix(got, "event: layers\ndata: ") {
					t.Errorf("malformed layers event %q", got)
					return
				}
			}
		}()
	}

	waitGroup.Add(1)
	go func() {
		defer waitGroup.Done()
		for range 200 {
			if _, err := whipSession.addVideoTrack("high", "streamKey", codecs.VideoTrackCodecH264); err != nil {
				t.Errorf("addVideoTrack: %v", err)
				return
			}
			if _, err := whipSession.addAudioTrack("audio", "streamKey", codecs.GetAudioTrackCodec(webrtc.MimeTypeOpus)); err != nil {
				t.Errorf("addAudioTrack: %v", err)
				return
			}
			whipSession.RemoveTracks()
		}
	}()

	waitGroup.Wait()

	// After the writer settled on an empty track set the cache must agree.
	if got := whipSession.GetAvailableLayersEvent(); strings.Contains(got, "encodingId") {
		t.Fatalf("expected no layers once all tracks were removed, got %q", got)
	}
}
