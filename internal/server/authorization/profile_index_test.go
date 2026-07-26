package authorization

import (
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode"

	"github.com/glimesh/broadcast-box/internal/environment"
	"github.com/stretchr/testify/require"
)

// resetProfileIndex drops any state the package level index kept from a
// previous test so every test starts from a cold cache.
func resetProfileIndex() {
	profileFiles.mu.Lock()
	defer profileFiles.mu.Unlock()

	profileFiles.loaded = false
	profileFiles.hasModTime = false
	profileFiles.path = ""
	profileFiles.names = nil
	profileFiles.byStreamKey = nil
	profileFiles.byToken = nil
}

// useProfileDir points the package at a fresh empty profile directory.
func useProfileDir(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	t.Setenv(environment.StreamProfilePath, dir)
	resetProfileIndex()
	t.Cleanup(resetProfileIndex)

	return dir
}

func indexedNames(t *testing.T) []string {
	t.Helper()

	profileFiles.mu.RLock()
	defer profileFiles.mu.RUnlock()

	return append([]string(nil), profileFiles.names...)
}

func indexRebuilds(t *testing.T) uint64 {
	t.Helper()

	profileFiles.mu.RLock()
	defer profileFiles.mu.RUnlock()

	return profileFiles.rebuilds
}

func onlyProfileFileName(t *testing.T, dir string) string {
	t.Helper()

	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	require.Len(t, entries, 1)

	return entries[0].Name()
}

//
// Legacy implementations, copied verbatim from the pre-index helpers.go, used
// as an oracle to prove the matching semantics are unchanged.
//

func legacyHasExistingStreamKey(streamKey string) bool {
	profilePath := os.Getenv(environment.StreamProfilePath)
	files, err := os.ReadDir(profilePath)

	if err != nil {
		return false
	}

	filePrefix := streamKey + "_"
	for _, file := range files {
		if !file.IsDir() && strings.HasPrefix(file.Name(), filePrefix) {
			return true
		}
	}

	return false
}

func legacyHasExistingBearerToken(bearerToken string) bool {
	profilePath := os.Getenv(environment.StreamProfilePath)

	files, err := os.ReadDir(profilePath)
	if err != nil {
		return false
	}

	for _, file := range files {
		if !file.IsDir() && strings.HasSuffix(file.Name(), bearerToken) {
			return true
		}
	}

	return false
}

func legacyGetProfileFileNameByStreamKey(streamKey string) (string, error) {
	profilePath := os.Getenv(environment.StreamProfilePath)

	files, err := os.ReadDir(profilePath)
	if err != nil {
		return "", err
	}

	for _, file := range files {
		fileToken := strings.Split(file.Name(), "_")

		if !file.IsDir() && strings.EqualFold(streamKey, fileToken[0]) {
			return file.Name(), nil
		}
	}

	return "", fmt.Errorf("could not find profile file")
}

func legacyGetProfileFileNameByBearerToken(bearerToken string) (string, error) {
	profilePath := os.Getenv(environment.StreamProfilePath)

	files, err := os.ReadDir(profilePath)
	if err != nil {
		return "", err
	}

	separator := "_"
	for _, file := range files {
		splitIndex := strings.LastIndex(file.Name(), separator)
		fileToken := file.Name()[splitIndex+len(separator):]

		if !file.IsDir() && strings.EqualFold(bearerToken, fileToken) {
			return file.Name(), nil
		}
	}

	return "", fmt.Errorf("could not find profile file")
}

func TestFoldKeyIsEquivalentToEqualFold(t *testing.T) {
	// foldKey is only correct as a map key if it collapses exactly the strings
	// strings.EqualFold considers equal, no more and no less.
	for r := rune(0); r < 0x3000; r++ {
		for _, other := range []rune{foldRune(r), unicode.SimpleFold(r), unicode.ToUpper(r), unicode.ToLower(r)} {
			a, b := string(r), string(other)
			require.Equalf(t, strings.EqualFold(a, b), foldKey(a) == foldKey(b), "runes %U and %U", r, other)
		}
	}

	pairs := [][2]string{
		{"abc", "ABC"},
		{"abc", "abd"},
		{"k", "K"},            // Kelvin sign folds with ASCII k
		{"s", "ſ"},            // long s folds with ASCII s
		{"i", "İ"},            // dotted capital I does NOT simple fold with i
		{"i", "ı"},            // dotless i does NOT simple fold with i
		{"straße", "STRASSE"}, // simple folding is not full folding
		{"", ""},
		{"", "a"},
		{"\xff", "�"},
	}
	for _, pair := range pairs {
		require.Equalf(t, strings.EqualFold(pair[0], pair[1]), foldKey(pair[0]) == foldKey(pair[1]), "%q vs %q", pair[0], pair[1])
	}
}

// TestMatchesLegacySemantics compares every lookup helper against a verbatim
// copy of the previous directory scanning implementation over randomly
// generated profile directories.
func TestMatchesLegacySemantics(t *testing.T) {
	segments := []string{"a", "A", "b", "B", "k", "K", "K", "_", "-", "0", "é", "É"}
	rnd := rand.New(rand.NewSource(20260725))

	randomName := func() string {
		var builder strings.Builder
		for i := 0; i < 1+rnd.Intn(6); i++ {
			builder.WriteString(segments[rnd.Intn(len(segments))])
		}

		return builder.String()
	}

	queries := []string{"", "a", "A", "a_b", "A_B", "b", "k", "K", "K", "_", "-", "0", "é", "É", "ab", "a_", "zzz"}

	for round := 0; round < 200; round++ {
		// A fresh directory per round, so the index is always rebuilt and the
		// comparison is about matching semantics rather than cache freshness.
		dir := filepath.Join(t.TempDir(), "profiles")
		require.NoError(t, os.MkdirAll(dir, 0o755))
		t.Setenv(environment.StreamProfilePath, dir)
		resetProfileIndex()

		created := map[string]bool{}
		for i := 0; i < rnd.Intn(8); i++ {
			name := randomName()
			if created[name] || name == "." || name == ".." || strings.Contains(name, "/") {
				continue
			}
			created[name] = true

			if rnd.Intn(6) == 0 {
				require.NoError(t, os.Mkdir(filepath.Join(dir, name), 0o755))
				continue
			}
			require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte("{}"), 0o644))
		}

		names := make([]string, 0, len(created))
		for name := range created {
			names = append(names, name)
		}

		for _, query := range append(queries, names...) {
			require.Equalf(t, legacyHasExistingStreamKey(query), hasExistingStreamKey(query),
				"hasExistingStreamKey(%q) round %d files %v", query, round, names)
			require.Equalf(t, legacyHasExistingBearerToken(query), hasExistingBearerToken(query),
				"hasExistingBearerToken(%q) round %d files %v", query, round, names)

			wantName, wantErr := legacyGetProfileFileNameByStreamKey(query)
			gotName, gotErr := getProfileFileNameByStreamKey(query)
			require.Equalf(t, wantName, gotName, "getProfileFileNameByStreamKey(%q) round %d files %v", query, round, names)
			require.Equalf(t, wantErr != nil, gotErr != nil, "getProfileFileNameByStreamKey(%q) error round %d", query, round)

			wantName, wantErr = legacyGetProfileFileNameByBearerToken(query)
			gotName, gotErr = getProfileFileNameByBearerToken(query)
			require.Equalf(t, wantName, gotName, "getProfileFileNameByBearerToken(%q) round %d files %v", query, round, names)
			require.Equalf(t, wantErr != nil, gotErr != nil, "getProfileFileNameByBearerToken(%q) error round %d", query, round)
		}
	}
}

func TestCreateLookupRemoveRoundTrip(t *testing.T) {
	dir := useProfileDir(t)

	const streamKey = "roundtrip"
	token, err := CreateProfile(streamKey)
	require.NoError(t, err)
	require.NotEmpty(t, token)

	fileName := streamKey + "_" + token
	require.Equal(t, []string{fileName}, indexedNames(t), "index should know the created file without rescanning")

	require.True(t, hasExistingStreamKey(streamKey))
	require.True(t, hasExistingBearerToken(token))

	resolved, err := getProfileFileNameByBearerToken(token)
	require.NoError(t, err)
	require.Equal(t, fileName, resolved)

	resolved, err = getProfileFileNameByStreamKey(streamKey)
	require.NoError(t, err)
	require.Equal(t, fileName, resolved)

	// Case insensitivity of the resolving helpers is preserved.
	resolved, err = getProfileFileNameByBearerToken(strings.ToUpper(token))
	require.NoError(t, err)
	require.Equal(t, fileName, resolved)

	resolved, err = getProfileFileNameByStreamKey(strings.ToUpper(streamKey))
	require.NoError(t, err)
	require.Equal(t, fileName, resolved)

	profile, err := GetPersonalProfile(token)
	require.NoError(t, err)
	require.Equal(t, streamKey, profile.StreamKey)

	// Rewriting the contents leaves the file name, and so the index, untouched.
	require.NoError(t, UpdateProfile(token, "hello", false))
	require.Equal(t, []string{fileName}, indexedNames(t))

	profile, err = GetPersonalProfile(token)
	require.NoError(t, err)
	require.Equal(t, "hello", profile.MOTD)
	require.False(t, profile.IsPublic)

	removed, err := RemoveProfile(streamKey)
	require.NoError(t, err)
	require.True(t, removed)

	require.Empty(t, indexedNames(t))
	require.False(t, hasExistingStreamKey(streamKey))
	require.False(t, hasExistingBearerToken(token))

	_, err = getProfileFileNameByBearerToken(token)
	require.Error(t, err)
	_, err = GetPersonalProfile(token)
	require.Error(t, err)

	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	require.Empty(t, entries)
}

func TestResetProfileTokenUpdatesIndex(t *testing.T) {
	dir := useProfileDir(t)

	const streamKey = "resettable"
	oldToken, err := CreateProfile(streamKey)
	require.NoError(t, err)

	require.NoError(t, ResetProfileToken(streamKey))

	newFileName := onlyProfileFileName(t, dir)
	newToken := strings.TrimPrefix(newFileName, streamKey+"_")
	require.NotEqual(t, oldToken, newToken)

	// Both the old and the new name are reflected without touching the disk.
	require.Equal(t, []string{newFileName}, indexedNames(t))

	resolved, err := getProfileFileNameByBearerToken(newToken)
	require.NoError(t, err)
	require.Equal(t, newFileName, resolved)

	_, err = getProfileFileNameByBearerToken(oldToken)
	require.Error(t, err, "the old token must no longer resolve")
	require.False(t, hasExistingBearerToken(oldToken))

	profile, err := GetPersonalProfile(newToken)
	require.NoError(t, err)
	require.Equal(t, streamKey, profile.StreamKey)

	_, err = GetPersonalProfile(oldToken)
	require.Error(t, err)
}

func TestLookupOfUnknownKeyAndToken(t *testing.T) {
	useProfileDir(t)

	_, err := CreateProfile("known")
	require.NoError(t, err)

	_, err = getProfileFileNameByStreamKey("unknown")
	require.Error(t, err)

	_, err = getProfileFileNameByBearerToken("00000000-0000-0000-0000-000000000000")
	require.Error(t, err)

	require.False(t, hasExistingStreamKey("unknown"))
	require.False(t, hasExistingBearerToken("00000000-0000-0000-0000-000000000000"))

	_, err = GetPublicProfile("00000000-0000-0000-0000-000000000000")
	require.Error(t, err)

	require.False(t, IsProfileReserved("unknown"))
	require.True(t, IsProfileReserved("known"))
}

func TestOutOfBandFileCreationIsDiscovered(t *testing.T) {
	dir := useProfileDir(t)

	// Warm the index up so a stale cache would hide the file written below.
	_, err := CreateProfile("warmup")
	require.NoError(t, err)
	require.True(t, hasExistingStreamKey("warmup"))

	const streamKey = "manual"
	const token = "11111111-2222-3333-4444-555555555555"
	fileName := streamKey + "_" + token
	require.NoError(t, os.WriteFile(filepath.Join(dir, fileName), []byte(`{"IsPublic":true,"MOTD":"manual"}`), 0o644))

	resolved, err := getProfileFileNameByBearerToken(token)
	require.NoError(t, err, "a profile added out of band must still be found")
	require.Equal(t, fileName, resolved)

	resolved, err = getProfileFileNameByStreamKey(streamKey)
	require.NoError(t, err)
	require.Equal(t, fileName, resolved)

	require.True(t, hasExistingStreamKey(streamKey))
	require.True(t, hasExistingBearerToken(token))

	profile, err := GetPublicProfile(token)
	require.NoError(t, err)
	require.Equal(t, "manual", profile.MOTD)
}

func TestOutOfBandFileRemovalIsDiscovered(t *testing.T) {
	dir := useProfileDir(t)

	const streamKey = "deleted"
	token, err := CreateProfile(streamKey)
	require.NoError(t, err)
	require.True(t, hasExistingStreamKey(streamKey))

	require.NoError(t, os.Remove(filepath.Join(dir, streamKey+"_"+token)))

	// Whatever the freshness check concludes, a removed profile must never
	// authenticate.
	_, err = GetPersonalProfile(token)
	require.Error(t, err)

	_, err = getProfileFileNameByBearerToken(token)
	require.Error(t, err)

	require.False(t, hasExistingBearerToken(token))
	require.False(t, hasExistingStreamKey(streamKey))
}

// TestLookupRescansWhenDirModTimeLies pins down the second half of the
// staleness strategy: even if the directory mtime cannot tell the index it is
// out of date, a lookup that misses re-reads the directory before giving up.
func TestLookupRescansWhenDirModTimeLies(t *testing.T) {
	dir := useProfileDir(t)

	// Trust the mtime immediately, so only the miss fallback can save us.
	previousWindow := dirModTimeSettleWindow
	dirModTimeSettleWindow = 0
	t.Cleanup(func() { dirModTimeSettleWindow = previousWindow })

	_, err := CreateProfile("warmup")
	require.NoError(t, err)
	require.True(t, hasExistingStreamKey("warmup"))

	const streamKey = "invisible"
	const token = "99999999-8888-7777-6666-555555555555"
	fileName := streamKey + "_" + token
	require.NoError(t, os.WriteFile(filepath.Join(dir, fileName), []byte(`{"IsPublic":true}`), 0o644))

	// Pretend the filesystem reported no change at all for the write above.
	modTime, ok := profileDirModTime(dir)
	require.True(t, ok)

	profileFiles.mu.Lock()
	profileFiles.modTime = modTime
	profileFiles.hasModTime = true
	staleNames := append([]string(nil), profileFiles.names...)
	profileFiles.mu.Unlock()

	require.NotContains(t, staleNames, fileName, "the index must be stale for this test to mean anything")

	resolved, err := getProfileFileNameByBearerToken(token)
	require.NoError(t, err, "a miss must rescan the directory before reporting not found")
	require.Equal(t, fileName, resolved)

	resolved, err = getProfileFileNameByStreamKey(streamKey)
	require.NoError(t, err)
	require.Equal(t, fileName, resolved)

	require.True(t, hasExistingStreamKey(streamKey))
	require.True(t, hasExistingBearerToken(token))
}

// TestSettledIndexIsServedFromMemory documents the point of the whole change:
// once the directory mtime has settled, a lookup that hits no longer reads the
// directory at all.
func TestSettledIndexIsServedFromMemory(t *testing.T) {
	useProfileDir(t)

	previousWindow := dirModTimeSettleWindow
	dirModTimeSettleWindow = 0
	t.Cleanup(func() { dirModTimeSettleWindow = previousWindow })

	const streamKey = "cached"
	token, err := CreateProfile(streamKey)
	require.NoError(t, err)
	fileName := streamKey + "_" + token

	resolved, err := getProfileFileNameByBearerToken(token)
	require.NoError(t, err)
	require.Equal(t, fileName, resolved)

	before := indexRebuilds(t)
	for i := 0; i < 50; i++ {
		resolved, err = getProfileFileNameByBearerToken(token)
		require.NoError(t, err)
		require.Equal(t, fileName, resolved)

		resolved, err = getProfileFileNameByStreamKey(streamKey)
		require.NoError(t, err)
		require.Equal(t, fileName, resolved)

		require.True(t, hasExistingStreamKey(streamKey))
		require.True(t, hasExistingBearerToken(token))
	}

	require.Equal(t, before, indexRebuilds(t), "hits on a settled index must not read the directory")

	// A miss still pays for one directory read before it gives up, which is
	// what the previous implementation cost on every single call.
	before = indexRebuilds(t)
	_, err = getProfileFileNameByBearerToken("00000000-0000-0000-0000-000000000000")
	require.Error(t, err)
	require.Equal(t, before+1, indexRebuilds(t))
}

func TestConcurrentLookups(t *testing.T) {
	// Both halves of the staleness strategy are exercised concurrently: with a
	// zero window lookups are answered from the cached index, with the default
	// window the churn keeps forcing rebuilds.
	for _, window := range []time.Duration{0, time.Second} {
		t.Run(fmt.Sprintf("settle-window-%s", window), func(t *testing.T) {
			previousWindow := dirModTimeSettleWindow
			dirModTimeSettleWindow = window
			t.Cleanup(func() { dirModTimeSettleWindow = previousWindow })

			runConcurrentLookups(t)
		})
	}
}

func runConcurrentLookups(t *testing.T) {
	useProfileDir(t)

	const stable = "stable"
	stableToken, err := CreateProfile(stable)
	require.NoError(t, err)
	stableFileName := stable + "_" + stableToken

	var wg sync.WaitGroup

	for reader := 0; reader < 8; reader++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			for i := 0; i < 100; i++ {
				name, err := getProfileFileNameByBearerToken(stableToken)
				if err != nil || name != stableFileName {
					t.Errorf("token lookup failed: %v %q", err, name)
					return
				}

				name, err = getProfileFileNameByStreamKey(stable)
				if err != nil || name != stableFileName {
					t.Errorf("stream key lookup failed: %v %q", err, name)
					return
				}

				if !hasExistingStreamKey(stable) || !hasExistingBearerToken(stableToken) {
					t.Errorf("existing profile reported as missing")
					return
				}

				if _, err := getProfileFileNameByBearerToken("no-such-token"); err == nil {
					t.Errorf("unknown token resolved")
					return
				}

				if hasExistingStreamKey("no-such-stream-key") {
					t.Errorf("unknown stream key reported as existing")
					return
				}
			}
		}()
	}

	for writer := 0; writer < 4; writer++ {
		wg.Add(1)
		go func(writer int) {
			defer wg.Done()

			for i := 0; i < 20; i++ {
				streamKey := fmt.Sprintf("churn-%d-%d", writer, i)

				if _, err := CreateProfile(streamKey); err != nil {
					t.Errorf("CreateProfile: %v", err)
					return
				}

				if err := ResetProfileToken(streamKey); err != nil {
					t.Errorf("ResetProfileToken: %v", err)
					return
				}

				if _, err := RemoveProfile(streamKey); err != nil {
					t.Errorf("RemoveProfile: %v", err)
					return
				}
			}
		}(writer)
	}

	wg.Wait()
}
