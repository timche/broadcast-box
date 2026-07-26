package webrtc

import (
	"testing"

	"github.com/glimesh/broadcast-box/internal/environment"
	"github.com/pion/webrtc/v4"
)

func TestSetupNetworkTypes(t *testing.T) {
	defaults := []webrtc.NetworkType{webrtc.NetworkTypeUDP4, webrtc.NetworkTypeUDP6}

	tests := []struct {
		name         string
		networkTypes string
		tcpMuxForce  string
		want         []webrtc.NetworkType
	}{
		{
			name: "unset falls back to UDP defaults",
			want: defaults,
		},
		{
			name:         "a single requested type is honoured",
			networkTypes: "tcp4",
			want:         []webrtc.NetworkType{webrtc.NetworkTypeTCP4},
		},
		{
			name:         "multiple requested types are honoured in order",
			networkTypes: "udp4|tcp4|tcp6",
			want:         []webrtc.NetworkType{webrtc.NetworkTypeUDP4, webrtc.NetworkTypeTCP4, webrtc.NetworkTypeTCP6},
		},
		{
			name:         "unrecognised entries are skipped, valid ones kept",
			networkTypes: "udp4|nonsense|tcp4",
			want:         []webrtc.NetworkType{webrtc.NetworkTypeUDP4, webrtc.NetworkTypeTCP4},
		},
		{
			name:         "an entirely unusable list falls back to defaults",
			networkTypes: "nonsense|garbage",
			want:         defaults,
		},
		{
			name:        "TCP mux force overrides everything",
			tcpMuxForce: "true",
			want:        []webrtc.NetworkType{webrtc.NetworkTypeTCP4, webrtc.NetworkTypeTCP6},
		},
		{
			name:         "TCP mux force wins over requested types",
			networkTypes: "udp4|udp6",
			tcpMuxForce:  "true",
			want:         []webrtc.NetworkType{webrtc.NetworkTypeTCP4, webrtc.NetworkTypeTCP6},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv(environment.NetworkTypes, test.networkTypes)
			t.Setenv(environment.TCPMuxForce, test.tcpMuxForce)

			got := setupNetworkTypes()

			if len(got) != len(test.want) {
				t.Fatalf("setupNetworkTypes() = %v, want %v", got, test.want)
			}

			for i := range got {
				if got[i] != test.want[i] {
					t.Fatalf("setupNetworkTypes() = %v, want %v", got, test.want)
				}
			}
		})
	}
}
