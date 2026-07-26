package session

import (
	"log/slog"
	"time"

	"github.com/glimesh/broadcast-box/internal/webrtc/utils"
)

// How long a rendered status event may be reused. Every viewer of a session
// receives the exact same payload, so rendering it once per interval instead of
// once per viewer removes the per viewer locking and marshaling. Kept well below
// the SSE refresh interval so the numbers viewers see are effectively live.
var statsEventTTL = time.Second

// Get SSE String with status about the current session
func (s *Session) GetSessionStatsEvent() string {
	return s.statsEventCache.Get(statsEventTTL, s.renderSessionStatsEvent)
}

func (s *Session) renderSessionStatsEvent() string {
	status, err := utils.ToJSONString(s.GetStreamStatus())
	if err != nil {
		slog.Error("GetSessionStatsJsonString Error", "err", err)
		return ""
	}

	return "event: status\ndata: " + status + "\n\n"
}
