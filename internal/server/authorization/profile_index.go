package authorization

import (
	"log/slog"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/glimesh/broadcast-box/internal/environment"
)

// profileIndex keeps an in memory view of the file names in the stream profile
// directory so that resolving a profile is a map hit instead of a full
// directory scan. Profiles are stored as files named "<streamKey>_<token>", so
// the file names alone are enough to answer every lookup; the file contents are
// still read from disk on every access.
//
// Staleness strategy: an operator may add, remove or rename profile files out
// of band by editing the directory directly, so the index is never trusted
// blindly.
//
//  1. Every lookup stats the profile directory (a single syscall) and rebuilds
//     the index when the directory changed. Creating, removing and renaming a
//     file all bump the directory mtime, so out of band mutations are picked up
//     without a scan.
//  2. A directory mtime is only trusted once it has settled, see
//     dirModTimeSettleWindow, because a change made in the same clock tick as
//     the mtime the index was built from would be invisible.
//  3. A lookup that misses forces one rebuild before it reports "not found", so
//     a profile that exists on disk can never be missed because of filesystem
//     mtime granularity or a lost race.
//
// A hit therefore costs one os.Stat instead of an os.ReadDir plus a linear
// scan, and a miss costs exactly what the previous implementation cost.
type profileIndex struct {
	mu sync.RWMutex

	loaded     bool
	path       string
	modTime    time.Time
	hasModTime bool

	// names holds every non directory entry of the profile directory, in the
	// order os.ReadDir returns them (sorted by file name). Lookups that are
	// not exact matches (prefix and suffix tests) scan this slice, which keeps
	// their semantics identical while removing the syscalls.
	names []string

	// byStreamKey maps foldKey(name up to the first "_") to the first matching
	// file name in ReadDir order. byToken maps foldKey(name after the last
	// "_") the same way. "First in ReadDir order" reproduces exactly which
	// entry the previous linear scans returned when several files matched.
	byStreamKey map[string]string
	byToken     map[string]string

	// rebuilds counts how often the profile directory had to be read. Tests
	// assert on it to make sure the cache is really doing its job.
	rebuilds uint64
}

var profileFiles = &profileIndex{}

const profileFileSeparator = "_"

// dirModTimeSettleWindow is how long a directory mtime has to be in the past
// before the index built from it may be trusted. File timestamps come from a
// coarse clock, so a change made shortly after the index was built can end up
// with the very same mtime and would otherwise stay invisible. Until the mtime
// has settled every lookup re-reads the directory, which is what the code did
// before the index existed. It is a variable only so that tests can shrink it.
var dirModTimeSettleWindow = time.Second

// profileStreamKeySegment returns the part of a profile file name that
// getProfileFileNameByStreamKey compares against, i.e. strings.Split(name, "_")[0].
func profileStreamKeySegment(name string) string {
	if i := strings.Index(name, profileFileSeparator); i >= 0 {
		return name[:i]
	}

	return name
}

// profileTokenSegment returns the part of a profile file name that
// getProfileFileNameByBearerToken compares against, i.e. everything after the
// last "_" (the whole name when there is no separator, matching the original
// strings.LastIndex based slicing).
func profileTokenSegment(name string) string {
	splitIndex := strings.LastIndex(name, profileFileSeparator)
	return name[splitIndex+len(profileFileSeparator):]
}

// foldRune returns the smallest rune that is equivalent to r under simple
// Unicode case folding.
func foldRune(r rune) rune {
	smallest := r
	for f := unicode.SimpleFold(r); f != r; f = unicode.SimpleFold(f) {
		if f < smallest {
			smallest = f
		}
	}

	return smallest
}

// foldKey canonicalizes s so that foldKey(a) == foldKey(b) exactly when
// strings.EqualFold(a, b) is true. strings.EqualFold compares rune by rune
// using the simple case folding orbit, so mapping every rune to the smallest
// member of its orbit is equivalent. This is what keeps the map based lookups
// case insensitive in precisely the same way the previous EqualFold scans were
// (strings.ToLower would not be: it differs for runes such as U+0130).
func foldKey(s string) string {
	var builder strings.Builder
	builder.Grow(len(s))

	for _, r := range s {
		builder.WriteRune(foldRune(r))
	}

	return builder.String()
}

func profilePath() string {
	return os.Getenv(environment.StreamProfilePath)
}

func profileDirModTime(path string) (time.Time, bool) {
	info, err := os.Stat(path)
	if err != nil {
		return time.Time{}, false
	}

	return info.ModTime(), true
}

// ensure makes sure the index describes the current profile directory. It
// reports whether the index was rebuilt from disk during this call.
func (idx *profileIndex) ensure(force bool) (bool, error) {
	path := profilePath()

	if !force {
		if modTime, ok := profileDirModTime(path); ok {
			idx.mu.RLock()
			fresh := idx.loaded &&
				idx.path == path &&
				idx.hasModTime &&
				idx.modTime.Equal(modTime) &&
				time.Now().After(modTime.Add(dirModTimeSettleWindow))
			idx.mu.RUnlock()

			if fresh {
				return false, nil
			}
		}
	}

	return true, idx.rebuild(path)
}

// rebuild reloads the index from disk.
//
// The directory is read while the write lock is held. That is deliberate: it
// serialises rebuilds against each other and against the in place updates done
// by CreateProfile, RemoveProfile and ResetProfileToken, so a scan started
// before a mutation can never install its stale snapshot over a newer state.
// Getting that wrong would let a token that was just reset keep resolving.
// The directory is stated before it is read, so a change racing the read is
// seen as a change by the next lookup rather than being swallowed.
func (idx *profileIndex) rebuild(path string) error {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	idx.rebuilds++

	modTime, hasModTime := profileDirModTime(path)

	entries, err := os.ReadDir(path)
	if err != nil {
		slog.Error("Authorization: Error reading profile directory", "err", err)

		idx.loaded = false
		idx.hasModTime = false
		idx.names = nil
		idx.byStreamKey = nil
		idx.byToken = nil

		return err
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			names = append(names, entry.Name())
		}
	}

	idx.loaded = true
	idx.path = path
	idx.modTime = modTime
	idx.hasModTime = hasModTime
	idx.names = names
	idx.rebuildMapsLocked()

	return nil
}

func (idx *profileIndex) rebuildMapsLocked() {
	idx.byStreamKey = make(map[string]string, len(idx.names))
	idx.byToken = make(map[string]string, len(idx.names))

	for _, name := range idx.names {
		streamKey := foldKey(profileStreamKeySegment(name))
		if _, ok := idx.byStreamKey[streamKey]; !ok {
			idx.byStreamKey[streamKey] = name
		}

		token := foldKey(profileTokenSegment(name))
		if _, ok := idx.byToken[token]; !ok {
			idx.byToken[token] = name
		}
	}
}

func (idx *profileIndex) fileNameByStreamKey(streamKey string) (string, bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	name, ok := idx.byStreamKey[foldKey(streamKey)]
	return name, ok
}

func (idx *profileIndex) fileNameByToken(token string) (string, bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	name, ok := idx.byToken[foldKey(token)]
	return name, ok
}

func (idx *profileIndex) anyNameHasPrefix(prefix string) bool {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	for _, name := range idx.names {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}

	return false
}

func (idx *profileIndex) anyNameHasSuffix(suffix string) bool {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	for _, name := range idx.names {
		if strings.HasSuffix(name, suffix) {
			return true
		}
	}

	return false
}

// find resolves a profile file name, rebuilding once on a miss so that a file
// created out of band is still found.
func (idx *profileIndex) find(lookup func(*profileIndex) (string, bool)) (string, bool, error) {
	rebuilt, err := idx.ensure(false)
	if err != nil {
		return "", false, err
	}

	if name, ok := lookup(idx); ok {
		return name, true, nil
	}

	if rebuilt {
		return "", false, nil
	}

	if _, err := idx.ensure(true); err != nil {
		return "", false, err
	}

	name, ok := lookup(idx)
	return name, ok, nil
}

// has answers a boolean predicate, rebuilding once on a negative answer so that
// a file created out of band is still seen.
func (idx *profileIndex) has(predicate func(*profileIndex) bool) bool {
	rebuilt, err := idx.ensure(false)
	if err != nil {
		return false
	}

	if predicate(idx) {
		return true
	}

	if rebuilt {
		return false
	}

	if _, err := idx.ensure(true); err != nil {
		return false
	}

	return predicate(idx)
}

// beginMutationLocked reports whether the in memory state can be updated in
// place. It returns false when the index does not currently describe the
// profile directory, in which case the next lookup rebuilds it from disk.
//
// Mutations are applied as deltas and are idempotent, so it does not matter
// whether the snapshot they are applied to already reflects the change on disk.
func (idx *profileIndex) beginMutationLocked() bool {
	if !idx.loaded || idx.path != profilePath() {
		idx.loaded = false
		idx.hasModTime = false
		return false
	}

	return true
}

// endMutationLocked records the directory mtime that the freshly mutated index
// corresponds to, so the update is not immediately thrown away by the next
// freshness check.
func (idx *profileIndex) endMutationLocked() {
	idx.rebuildMapsLocked()
	idx.modTime, idx.hasModTime = profileDirModTime(idx.path)
}

// addName records a profile file that was just created.
func (idx *profileIndex) addName(name string) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	if !idx.beginMutationLocked() {
		return
	}

	idx.insertNameLocked(name)
	idx.endMutationLocked()
}

// removeName forgets a profile file that was just deleted.
func (idx *profileIndex) removeName(name string) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	if !idx.beginMutationLocked() {
		return
	}

	idx.deleteNameLocked(name)
	idx.endMutationLocked()
}

// renameName records a profile file that was just renamed, reflecting both the
// old and the new name.
func (idx *profileIndex) renameName(oldName, newName string) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	if !idx.beginMutationLocked() {
		return
	}

	idx.deleteNameLocked(oldName)
	idx.insertNameLocked(newName)
	idx.endMutationLocked()
}

// insertNameLocked keeps names sorted by byte order, which is the order
// os.ReadDir returns entries in.
func (idx *profileIndex) insertNameLocked(name string) {
	i := sort.SearchStrings(idx.names, name)
	if i < len(idx.names) && idx.names[i] == name {
		return
	}

	idx.names = append(idx.names, "")
	copy(idx.names[i+1:], idx.names[i:])
	idx.names[i] = name
}

func (idx *profileIndex) deleteNameLocked(name string) {
	i := sort.SearchStrings(idx.names, name)
	if i >= len(idx.names) || idx.names[i] != name {
		return
	}

	idx.names = append(idx.names[:i], idx.names[i+1:]...)
}
