package authorization

import "testing"

func TestIsValidStreamKey(t *testing.T) {
	valid := []string{
		"alice",
		"alice-2",
		"alice_2",
		"ALICE",
		"123",
		"café",
		"日本語",
	}

	for _, streamKey := range valid {
		if !isValidStreamKey(streamKey) {
			t.Errorf("isValidStreamKey(%q) = false, want true", streamKey)
		}
	}

	// Stream keys are concatenated into a profile filename, so anything that
	// could escape the profile directory or split the "<key>_<token>" format
	// has to be rejected outright.
	invalid := []string{
		"",
		"../evil",
		"../../etc/passwd",
		"foo/bar",
		"foo bar",
		"foo.bar",
		"foo\x00bar",
		"foo\nbar",
	}

	for _, streamKey := range invalid {
		if isValidStreamKey(streamKey) {
			t.Errorf("isValidStreamKey(%q) = true, want false", streamKey)
		}
	}
}
