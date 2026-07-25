package whip

import (
	"encoding/json"
	"log/slog"
)

// Returns all available Video and Audio layers of the provided stream key.
//
// The payload is identical for every viewer of the stream and only changes when
// tracks are added or removed, so it is rendered once and reused until
// invalidateAvailableLayersEvent is called.
func (w *WHIPSession) GetAvailableLayersEvent() string {
	return w.availableLayersEventCache.Get(0, w.renderAvailableLayersEvent)
}

// Drops the cached layers event, forcing the next reader to render it again.
// Must be called after releasing TracksLock: the cache serializes regeneration
// against invalidation, and rendering acquires TracksLock.
func (w *WHIPSession) invalidateAvailableLayersEvent() {
	w.availableLayersEventCache.Invalidate()
}

func (w *WHIPSession) renderAvailableLayersEvent() string {
	videoLayers := []simulcastLayerResponse{}
	audioLayers := []simulcastLayerResponse{}

	w.TracksLock.RLock()

	// Add available video layers
	for track := range w.VideoTracks {
		videoLayers = append(videoLayers, simulcastLayerResponse{
			EncodingID: w.VideoTracks[track].Rid,
		})
	}

	// Add available audio layers
	for track := range w.AudioTracks {
		audioLayers = append(audioLayers, simulcastLayerResponse{
			EncodingID: w.AudioTracks[track].Rid,
		})
	}

	w.TracksLock.RUnlock()

	resp := map[string]map[string][]simulcastLayerResponse{
		"1": {
			"layers": videoLayers,
		},
		"2": {
			"layers": audioLayers,
		},
	}

	jsonResult, err := json.Marshal(resp)
	if err != nil {
		slog.Error("Error converting response to Json", "resp", resp, "err", err)
	}

	return "event: layers\ndata: " + string(jsonResult) + "\n\n"
}
