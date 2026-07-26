package environment

import "testing"

// resolveWith clears every environment variable the resolver reads, applies the
// supplied overrides, and takes a fresh snapshot. The snapshot is restored once
// the test finishes.
func resolveWith(t *testing.T, overrides map[string]string) {
	t.Helper()

	// Registered first so it runs last: t.Setenv restores the environment, then
	// this re-snapshots it.
	t.Cleanup(ResolveEnvironmentVariables)

	for _, key := range []string{
		DisableStatus, FrontendDisabled, WebhookURL, StreamProfilePolicy,
		FrontendAdminToken, LoggingAPIEnabled, LoggingAPIKey, AppendCandidate,
		STUNServers, DebugIncomingAPIRequest, DebugPrintSSEMessages,
		DebugPrintOffer, DebugPrintAnswer,
	} {
		t.Setenv(key, "")
	}

	for key, value := range overrides {
		t.Setenv(key, value)
	}

	ResolveEnvironmentVariables()
}

// The "isSet" accessors treat any non-empty value as true. In particular
// DISABLE_STATUS=false disables the status endpoint. That is surprising, but it
// is the pre-existing behaviour and is asserted here so it cannot regress
// silently.
func TestIsSetAccessorsTreatAnyNonEmptyValueAsTrue(t *testing.T) {
	tests := []struct {
		name     string
		value    string
		expected bool
	}{
		{name: "unset", value: "", expected: false},
		{name: "true", value: "true", expected: true},
		{name: "TRUE", value: "TRUE", expected: true},
		{name: "false is still truthy", value: "false", expected: true},
		{name: "zero is still truthy", value: "0", expected: true},
		{name: "arbitrary value", value: "yes", expected: true},
	}

	for _, test := range tests {
		t.Run("DisableStatus/"+test.name, func(t *testing.T) {
			resolveWith(t, map[string]string{DisableStatus: test.value})

			if got := IsStatusDisabled(); got != test.expected {
				t.Fatalf("IsStatusDisabled() with %q = %v, want %v", test.value, got, test.expected)
			}
		})

		t.Run("FrontendDisabled/"+test.name, func(t *testing.T) {
			resolveWith(t, map[string]string{FrontendDisabled: test.value})

			if got := IsFrontendDisabled(); got != test.expected {
				t.Fatalf("IsFrontendDisabled() with %q = %v, want %v", test.value, got, test.expected)
			}
		})
	}
}

// The "isTrue" accessors only accept a case-insensitive "true". Anything else,
// including "false" and other non-empty values, is false.
func TestIsTrueAccessorsOnlyAcceptTrue(t *testing.T) {
	tests := []struct {
		name     string
		value    string
		expected bool
	}{
		{name: "unset", value: "", expected: false},
		{name: "true", value: "true", expected: true},
		{name: "TRUE", value: "TRUE", expected: true},
		{name: "mixed case True", value: "True", expected: true},
		{name: "false", value: "false", expected: false},
		{name: "one is not true", value: "1", expected: false},
		{name: "arbitrary value", value: "yes", expected: false},
	}

	accessors := map[string]struct {
		key      string
		accessor func() bool
	}{
		"IsLoggingAPIEnabled":           {LoggingAPIEnabled, IsLoggingAPIEnabled},
		"ShouldDebugIncomingAPIRequest": {DebugIncomingAPIRequest, ShouldDebugIncomingAPIRequest},
		"ShouldDebugPrintSSEMessages":   {DebugPrintSSEMessages, ShouldDebugPrintSSEMessages},
		"ShouldDebugPrintOffer":         {DebugPrintOffer, ShouldDebugPrintOffer},
		"ShouldDebugPrintAnswer":        {DebugPrintAnswer, ShouldDebugPrintAnswer},
	}

	for name, accessor := range accessors {
		for _, test := range tests {
			t.Run(name+"/"+test.name, func(t *testing.T) {
				resolveWith(t, map[string]string{accessor.key: test.value})

				if got := accessor.accessor(); got != test.expected {
					t.Fatalf("%s() with %q = %v, want %v", name, test.value, got, test.expected)
				}
			})
		}
	}
}

// String accessors are returned verbatim, with no truthiness interpretation.
func TestStringAccessorsReturnValueVerbatim(t *testing.T) {
	accessors := map[string]struct {
		key      string
		accessor func() string
	}{
		"GetWebhookURL":          {WebhookURL, GetWebhookURL},
		"GetStreamProfilePolicy": {StreamProfilePolicy, GetStreamProfilePolicy},
		"GetFrontendAdminToken":  {FrontendAdminToken, GetFrontendAdminToken},
		"GetLoggingAPIKey":       {LoggingAPIKey, GetLoggingAPIKey},
		"GetAppendCandidate":     {AppendCandidate, GetAppendCandidate},
		"GetSTUNServers":         {STUNServers, GetSTUNServers},
	}

	for name, accessor := range accessors {
		t.Run(name+"/unset", func(t *testing.T) {
			resolveWith(t, nil)

			if got := accessor.accessor(); got != "" {
				t.Fatalf("%s() unset = %q, want empty string", name, got)
			}
		})

		t.Run(name+"/set", func(t *testing.T) {
			const value = "some-Value|with-Case"
			resolveWith(t, map[string]string{accessor.key: value})

			if got := accessor.accessor(); got != value {
				t.Fatalf("%s() = %q, want %q", name, got, value)
			}
		})
	}
}

// Accessors serve the snapshot, not the live environment. A change made after
// resolution is only observed once the environment is resolved again.
func TestAccessorsServeSnapshotUntilResolved(t *testing.T) {
	resolveWith(t, map[string]string{WebhookURL: "https://example.test/first"})

	if got := GetWebhookURL(); got != "https://example.test/first" {
		t.Fatalf("GetWebhookURL() = %q, want the resolved value", got)
	}

	t.Setenv(WebhookURL, "https://example.test/second")

	if got := GetWebhookURL(); got != "https://example.test/first" {
		t.Fatalf("GetWebhookURL() = %q, want the snapshot to be unchanged", got)
	}

	ResolveEnvironmentVariables()

	if got := GetWebhookURL(); got != "https://example.test/second" {
		t.Fatalf("GetWebhookURL() = %q, want the re-resolved value", got)
	}
}
