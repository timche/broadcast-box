package whip

import (
	"testing"

	"github.com/glimesh/broadcast-box/internal/webrtc/codecs"
	"github.com/pion/rtp"
)

func TestIsPacketKeyframe(t *testing.T) {
	for _, test := range []struct {
		name     string
		payload  []byte
		expected bool
	}{
		{"SingleNALU_IDR", []byte{0x65, 0x88, 0x84}, true},
		{"SingleNALU_NonIDR", []byte{0x41, 0x9a, 0x00}, false},
		{"SingleNALU_SPS", []byte{0x67, 0x42, 0x00, 0x1f}, true},
		{"SingleNALU_PPS", []byte{0x68, 0xce, 0x3c, 0x80}, true},
		{"SingleNALU_SEI", []byte{0x06, 0x05, 0x01}, false},
		{"SingleNALU_OnlyHeader_IDR", []byte{0x65}, true},

		// STAP-A: header, then (2 byte size, NALU)*
		{"StapA_SPS_PPS", []byte{
			0x78,
			0x00, 0x04, 0x67, 0x42, 0x00, 0x1f,
			0x00, 0x04, 0x68, 0xce, 0x3c, 0x80,
		}, true},
		{"StapA_SPS_NotFirst", []byte{
			0x78,
			0x00, 0x03, 0x06, 0x05, 0x01,
			0x00, 0x04, 0x67, 0x42, 0x00, 0x1f,
		}, true},
		{"StapA_NoKeyframe", []byte{
			0x78,
			0x00, 0x03, 0x41, 0x9a, 0x00,
			0x00, 0x02, 0x01, 0x9b,
		}, false},
		{"StapA_Empty", []byte{0x78}, false},
		{"StapA_TruncatedSize", []byte{0x78, 0x00}, false},
		{"StapA_SizeOverrunsPayload", []byte{0x78, 0x00, 0x10, 0x67, 0x42}, false},
		{"StapA_ZeroSize", []byte{0x78, 0x00, 0x00, 0x67, 0x42}, false},

		// FU-A: FU indicator, FU header (S=0x80, E=0x40), then the fragment.
		{"FuA_StartOfIDR", []byte{0x7c, 0x85, 0x88, 0x84}, true},
		{"FuA_StartOfNonIDR", []byte{0x7c, 0x81, 0x9a, 0x00}, false},
		{"FuA_Middle", []byte{0x7c, 0x05, 0x88, 0x84}, false},
		{"FuA_End", []byte{0x7c, 0x45, 0x88, 0x84}, false},
		{"FuA_HeaderOnly", []byte{0x7c}, false},
		{"FuB_StartOfIDR", []byte{0x7d, 0x85, 0x00, 0x00, 0x88}, true},
		{"FuB_Middle", []byte{0x7d, 0x05, 0x00, 0x00, 0x88}, false},

		{"Empty", []byte{}, false},
		{"Nil", nil, false},
		{"ForbiddenZeroType", []byte{0x00, 0x00}, false},
		{"ReservedType30", []byte{0x1e, 0x00}, false},
		{"ReservedType31", []byte{0x1f, 0x00}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			pkt := &rtp.Packet{Payload: test.payload}
			if actual := isPacketKeyframe(pkt, codecs.VideoTrackCodecH264); actual != test.expected {
				t.Fatalf("isPacketKeyframe(%#v) = %t, want %t", test.payload, actual, test.expected)
			}
		})
	}
}

func TestIsPacketKeyframeNonH264(t *testing.T) {
	for _, codec := range []codecs.TrackCodeType{
		codecs.VideoTrackCodecH265,
		codecs.VideoTrackCodecVP8,
		codecs.VideoTrackCodecVP9,
		codecs.VideoTrackCodecAV1,
	} {
		pkt := &rtp.Packet{Payload: []byte{0x41, 0x9a, 0x00}}
		if !isPacketKeyframe(pkt, codec) {
			t.Fatalf("isPacketKeyframe with codec %v = false, want true", codec)
		}
	}
}

// TestIsPacketKeyframeDoesNotAllocate guards the property the benchmark
// measures: keyframe probing runs on every video packet and must stay
// allocation free.
func TestIsPacketKeyframeDoesNotAllocate(t *testing.T) {
	payloads := [][]byte{
		{0x65, 0x88, 0x84},
		{0x41, 0x9a, 0x00},
		{0x78, 0x00, 0x04, 0x67, 0x42, 0x00, 0x1f, 0x00, 0x04, 0x68, 0xce, 0x3c, 0x80},
		{0x7c, 0x85, 0x88, 0x84},
		{},
	}

	pkt := &rtp.Packet{}
	allocs := testing.AllocsPerRun(1000, func() {
		for _, payload := range payloads {
			pkt.Payload = payload
			isPacketKeyframe(pkt, codecs.VideoTrackCodecH264)
		}
	})

	if allocs != 0 {
		t.Fatalf("isPacketKeyframe allocated %v times per run, want 0", allocs)
	}
}

func BenchmarkIsPacketKeyframe(b *testing.B) {
	for _, bench := range []struct {
		name    string
		payload []byte
	}{
		{"SingleNALU", []byte{0x65, 0x88, 0x84, 0x00, 0x11, 0x22, 0x33}},
		{"StapA", []byte{
			0x78,
			0x00, 0x04, 0x67, 0x42, 0x00, 0x1f,
			0x00, 0x04, 0x68, 0xce, 0x3c, 0x80,
		}},
		{"FuA", []byte{0x7c, 0x85, 0x88, 0x84, 0x00, 0x11, 0x22, 0x33}},
	} {
		b.Run(bench.name, func(b *testing.B) {
			pkt := &rtp.Packet{Payload: bench.payload}

			b.ReportAllocs()
			b.ResetTimer()

			for b.Loop() {
				sink = isPacketKeyframe(pkt, codecs.VideoTrackCodecH264)
			}
		})
	}
}

var sink bool
