package utils

import (
	"strconv"
	"sync"
	"testing"
	"time"
	"unsafe"
)

// countingGenerator returns a generate function producing a unique string per
// call, together with a pointer to the number of times it ran.
func countingGenerator() (func() string, *int) {
	calls := 0
	return func() string {
		calls++
		return "value-" + strconv.Itoa(calls)
	}, &calls
}

func TestCachedStringReusesValueWithinTTL(t *testing.T) {
	cache := &CachedString{}
	generate, calls := countingGenerator()

	first := cache.Get(time.Minute, generate)
	for range 10 {
		next := cache.Get(time.Minute, generate)
		if next != first {
			t.Fatalf("expected cached value %q, got %q", first, next)
		}
		if unsafe.StringData(next) != unsafe.StringData(first) {
			t.Fatal("expected the cached value to be the identical string, not a re-rendered copy")
		}
	}

	if *calls != 1 {
		t.Fatalf("expected 1 generation, got %d", *calls)
	}
}

func TestCachedStringRefreshesAfterTTL(t *testing.T) {
	now := time.Unix(0, 0)
	cache := &CachedString{Clock: func() time.Time { return now }}
	generate, calls := countingGenerator()

	first := cache.Get(time.Second, generate)

	// Just short of the TTL the cached value is still served.
	now = now.Add(999 * time.Millisecond)
	if got := cache.Get(time.Second, generate); got != first {
		t.Fatalf("expected cached value %q before the TTL elapsed, got %q", first, got)
	}
	if *calls != 1 {
		t.Fatalf("expected 1 generation before the TTL elapsed, got %d", *calls)
	}

	// Once the TTL has elapsed the value is rebuilt.
	now = now.Add(time.Millisecond)
	second := cache.Get(time.Second, generate)
	if second == first {
		t.Fatal("expected a fresh value once the TTL elapsed")
	}
	if *calls != 2 {
		t.Fatalf("expected 2 generations after the TTL elapsed, got %d", *calls)
	}

	// And the fresh value is then cached for its own TTL window.
	if got := cache.Get(time.Second, generate); got != second {
		t.Fatalf("expected cached value %q, got %q", second, got)
	}
	if *calls != 2 {
		t.Fatalf("expected the refreshed value to be cached, got %d generations", *calls)
	}
}

func TestCachedStringNonPositiveTTLNeverExpiresOnItsOwn(t *testing.T) {
	now := time.Unix(0, 0)
	cache := &CachedString{Clock: func() time.Time { return now }}
	generate, calls := countingGenerator()

	first := cache.Get(0, generate)

	now = now.Add(24 * time.Hour)
	if got := cache.Get(0, generate); got != first {
		t.Fatalf("expected cached value %q, got %q", first, got)
	}
	if *calls != 1 {
		t.Fatalf("expected 1 generation, got %d", *calls)
	}

	cache.Invalidate()

	second := cache.Get(0, generate)
	if second == first {
		t.Fatal("expected a fresh value after Invalidate")
	}
	if *calls != 2 {
		t.Fatalf("expected 2 generations after Invalidate, got %d", *calls)
	}
}

func TestCachedStringGeneratesOnceForConcurrentReaders(t *testing.T) {
	const readers = 64

	cache := &CachedString{}

	var callsLock sync.Mutex
	calls := 0

	start := make(chan struct{})
	results := make([]string, readers)

	var waitGroup sync.WaitGroup
	for reader := range readers {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			<-start
			results[reader] = cache.Get(time.Minute, func() string {
				callsLock.Lock()
				calls++
				value := "value-" + strconv.Itoa(calls)
				callsLock.Unlock()

				// Widen the window in which other readers can observe a stale
				// cache, so a missing single flight guard would be caught.
				time.Sleep(time.Millisecond)

				return value
			})
		}()
	}

	close(start)
	waitGroup.Wait()

	callsLock.Lock()
	got := calls
	callsLock.Unlock()

	if got != 1 {
		t.Fatalf("expected exactly 1 generation for %d concurrent readers, got %d", readers, got)
	}

	for reader := range readers {
		if results[reader] != results[0] {
			t.Fatalf("reader %d got %q, want %q", reader, results[reader], results[0])
		}
	}
}

// A value rendered from data that changed while it was being rendered must not
// survive in the cache.
func TestCachedStringInvalidateDuringGenerationDiscardsValue(t *testing.T) {
	cache := &CachedString{}

	generating := make(chan struct{})
	invalidated := make(chan struct{})

	go func() {
		<-generating
		cache.Invalidate()
		close(invalidated)
	}()

	generateCalls := 0
	stale := cache.Get(0, func() string {
		generateCalls++
		close(generating)
		// Invalidate blocks until this generation completes, so we only need to
		// know it has been called; the cache serializes the rest.
		return "stale"
	})
	if stale != "stale" {
		t.Fatalf("expected the in flight generation to return its own value, got %q", stale)
	}

	<-invalidated

	fresh := cache.Get(0, func() string {
		generateCalls++
		return "fresh"
	})
	if fresh != "fresh" {
		t.Fatalf("expected the stale value to be discarded, got %q", fresh)
	}
	if generateCalls != 2 {
		t.Fatalf("expected 2 generations, got %d", generateCalls)
	}
}

func TestCachedStringConcurrentGetAndInvalidate(t *testing.T) {
	cache := &CachedString{}

	var waitGroup sync.WaitGroup
	for range 16 {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			for range 200 {
				if got := cache.Get(0, func() string { return "value" }); got != "value" {
					t.Errorf("unexpected value %q", got)
					return
				}
			}
		}()

		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			for range 200 {
				cache.Invalidate()
			}
		}()
	}

	waitGroup.Wait()
}
