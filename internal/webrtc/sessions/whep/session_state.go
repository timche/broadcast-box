package whep

// Unlike the video path, the WHEP session forwards audio RTP packets exactly as
// they arrive from the publisher, so it never tracks an outbound audio
// timestamp or sequence number of its own. These constants preserve the values
// the status API has always reported for those fields so the API contract
// (and its consumers in web/src) stays unchanged.
const (
	audioTimestampReported      = 5000
	audioSequenceNumberReported = 0
)

type SessionState struct {
	ID string `json:"id"`

	AudioLayerCurrent   string `json:"audioLayerCurrent"`
	AudioTimestamp      uint32 `json:"audioTimestamp"`
	AudioPacketsWritten uint64 `json:"audioPacketsWritten"`
	AudioSequenceNumber uint64 `json:"audioSequenceNumber"`

	VideoLayerCurrent   string `json:"videoLayerCurrent"`
	VideoTimestamp      uint32 `json:"videoTimestamp"`
	VideoBitrate        uint64 `json:"videoBitrate"`
	VideoPacketsDropped uint64 `json:"videoPacketsDropped"`
	VideoPacketsWritten uint64 `json:"videoPacketsWritten"`
	VideoSequenceNumber uint64 `json:"videoSequenceNumber"`
}
