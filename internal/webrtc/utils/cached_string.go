package utils

import (
	"sync"
	"sync/atomic"
	"time"
)

// CachedString memoizes a lazily rendered string (an SSE event payload, for
// example) so that a value shared by many readers is only built once instead of
// once per reader.
//
// The zero value is ready to use. It must not be copied after first use.
//
// Two expiry strategies are supported and can be mixed:
//   - Time based: pass a positive ttl to Get. The value is rebuilt on the first
//     read that happens after the ttl has elapsed.
//   - Explicit: pass a non positive ttl to Get and call Invalidate whenever the
//     underlying data changes. The cached value then never expires on its own.
//
// Regeneration is single flighted: when N readers find the cache stale at the
// same time, exactly one of them runs the generate function and the rest
// receive its result.
type CachedString struct {
	// Clock is an optional time source, mainly useful for tests. It defaults to
	// time.Now when nil and must be set before the cache is used concurrently.
	Clock func() time.Time

	// regenerateLock serializes regeneration and Invalidate so that a generate
	// call can never store a value that was already superseded by Invalidate.
	regenerateLock sync.Mutex
	current        atomic.Pointer[cachedStringValue]
}

type cachedStringValue struct {
	value     string
	createdAt time.Time
}

// Get returns the cached string, calling generate only when no usable value is
// cached. A positive ttl additionally expires values older than the ttl.
func (c *CachedString) Get(ttl time.Duration, generate func() string) string {
	if cached := c.load(ttl); cached != nil {
		return cached.value
	}

	c.regenerateLock.Lock()
	defer c.regenerateLock.Unlock()

	// Another reader may have regenerated the value while we waited for the lock.
	if cached := c.load(ttl); cached != nil {
		return cached.value
	}

	value := generate()
	c.current.Store(&cachedStringValue{
		value:     value,
		createdAt: c.now(),
	})

	return value
}

// Invalidate drops the cached value so the next Get regenerates it. It blocks
// while a regeneration is in flight, which guarantees that a value generated
// from now stale data is discarded rather than kept.
func (c *CachedString) Invalidate() {
	c.regenerateLock.Lock()
	c.current.Store(nil)
	c.regenerateLock.Unlock()
}

func (c *CachedString) load(ttl time.Duration) *cachedStringValue {
	cached := c.current.Load()
	if cached == nil {
		return nil
	}

	if ttl > 0 && c.now().Sub(cached.createdAt) >= ttl {
		return nil
	}

	return cached
}

func (c *CachedString) now() time.Time {
	if c.Clock != nil {
		return c.Clock()
	}

	return time.Now()
}
