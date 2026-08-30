import { useCallback, useEffect, useRef, useState } from "react";

interface ReconnectOptions {
  /** Delay before the first retry; doubles with every attempt after it. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Attempts before giving up and leaving it to a manual retry. */
  maxAttempts?: number;
  /** Fraction of the delay added or removed at random, spreading viewers out. */
  jitterRatio?: number;
}

export interface ReconnectController {
  /** A retry is waiting to start, or is in flight. */
  isReconnecting: boolean;
  /** Every attempt has been spent; only a manual retry goes any further. */
  isExhausted: boolean;
  /** Queues the next attempt, or gives up once the attempts run out. */
  schedule(): void;
  /** Reconnects straight away and starts the attempt count over. */
  retryNow(): void;
  /** Marks the connection healthy again. */
  reset(): void;
  /** Drops whatever is pending without reconnecting. */
  cancel(): void;
}

function backoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterRatio: number,
): number {
  const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  const jitter = delay * jitterRatio * (Math.random() * 2 - 1);

  return Math.max(0, Math.round(delay + jitter));
}

/**
 * Paces retries after a connection drops: exponential backoff with jitter, so
 * everyone watching a stream that went down does not come back in lockstep, and
 * a cap so a permanently broken stream stops costing the server anything.
 */
export function useReconnectController(
  reconnect: () => void,
  options: ReconnectOptions = {},
): ReconnectController {
  const { baseDelayMs = 1_000, maxDelayMs = 30_000, maxAttempts = 8, jitterRatio = 0.25 } = options;

  const reconnectRef = useRef(reconnect);
  reconnectRef.current = reconnect;

  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onlineRef = useRef<(() => void) | null>(null);

  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isExhausted, setIsExhausted] = useState(false);

  const clearPending = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = undefined;

    if (onlineRef.current !== null) {
      window.removeEventListener("online", onlineRef.current);
      onlineRef.current = null;
    }
  }, []);

  const run = useCallback(() => {
    clearPending();
    reconnectRef.current();
  }, [clearPending]);

  const schedule = useCallback(() => {
    clearPending();

    // A device with no network at all would spend every attempt on failures it
    // can do nothing about, so wait for the network instead of counting them.
    if (!navigator.onLine) {
      onlineRef.current = run;
      window.addEventListener("online", run);
      setIsReconnecting(true);

      return;
    }

    const attempt = attemptRef.current + 1;

    if (attempt > maxAttempts) {
      setIsReconnecting(false);
      setIsExhausted(true);

      return;
    }

    attemptRef.current = attempt;
    setIsReconnecting(true);
    timerRef.current = setTimeout(run, backoffDelay(attempt, baseDelayMs, maxDelayMs, jitterRatio));
  }, [baseDelayMs, clearPending, jitterRatio, maxAttempts, maxDelayMs, run]);

  const retryNow = useCallback(() => {
    attemptRef.current = 0;
    setIsExhausted(false);
    setIsReconnecting(true);
    run();
  }, [run]);

  const reset = useCallback(() => {
    clearPending();
    attemptRef.current = 0;
    setIsReconnecting(false);
    setIsExhausted(false);
  }, [clearPending]);

  const cancel = useCallback(() => {
    clearPending();
    setIsReconnecting(false);
  }, [clearPending]);

  useEffect(() => clearPending, [clearPending]);

  return { isReconnecting, isExhausted, schedule, retryNow, reset, cancel };
}
