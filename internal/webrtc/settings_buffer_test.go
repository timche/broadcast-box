package webrtc

import (
	"testing"

	"github.com/glimesh/broadcast-box/internal/environment"
	"github.com/pion/ice/v4"
)

func TestSetupUDPMuxBuffers(t *testing.T) {
	tests := []struct {
		name      string
		readSize  string
		writeSize string
		wantOpts  int
	}{
		{name: "unset adds no options"},
		{name: "read only", readSize: "1048576", wantOpts: 1},
		{name: "write only", writeSize: "1048576", wantOpts: 1},
		{name: "both", readSize: "1048576", writeSize: "524288", wantOpts: 2},
		{name: "non-numeric is ignored", readSize: "big"},
		{name: "negative is ignored", readSize: "-1"},
		{name: "zero is ignored", readSize: "0"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv(environment.UDPMuxReadBufferSize, test.readSize)
			t.Setenv(environment.UDPMuxWriteBufferSize, test.writeSize)

			var opts []ice.UDPMuxFromPortOption
			setupUDPMuxBuffers(&opts)

			if len(opts) != test.wantOpts {
				t.Fatalf("len(opts) = %d, want %d", len(opts), test.wantOpts)
			}
		})
	}
}

// An invalid value must not clobber a valid one alongside it.
func TestSetupUDPMuxBuffersIgnoresOnlyTheInvalidValue(t *testing.T) {
	t.Setenv(environment.UDPMuxReadBufferSize, "nonsense")
	t.Setenv(environment.UDPMuxWriteBufferSize, "1048576")

	var opts []ice.UDPMuxFromPortOption
	setupUDPMuxBuffers(&opts)

	if len(opts) != 1 {
		t.Fatalf("len(opts) = %d, want 1 (write only)", len(opts))
	}
}
