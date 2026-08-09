/**
 * Short blips marking something happening on a stream. They are synthesised
 * with the Web Audio API rather than shipped as assets — each one is a single
 * sine tone, and has to stay quiet enough to sit under a live stream.
 */

/** Each alert gets its own note so they stay distinguishable by ear. */
export type AlertSound = "viewer-join" | "viewer-leave" | "chat-message";

const FREQUENCY_HZ: Record<AlertSound, number> = {
  "viewer-join": 880, // A5
  "viewer-leave": 587.33, // D5 — a step down, so leaving sounds like leaving
  "chat-message": 698.46, // F5
};

const ATTACK_S = 0.015;
const DURATION_S = 0.13;
/** Peak of the gain envelope — deliberately low, this plays over the stream. */
const PEAK_GAIN = 0.05;
/** Events arrive in bursts; collapse those into a single blip. */
const MIN_GAP_MS = 300;

let audioContext: AudioContext | null = null;
let lastPlayedAt = Number.NEGATIVE_INFINITY;

function getAudioContext(): AudioContext | null {
  if (audioContext !== null) {
    return audioContext;
  }
  if (typeof AudioContext === "undefined") {
    return null;
  }

  audioContext = new AudioContext();

  return audioContext;
}

/**
 * Plays a blip. Browsers only allow audio once the page has been interacted
 * with, so the first call should come from a user gesture (switching the
 * setting on) — that unlocks the context for the automatic ones that follow.
 */
export function playAlertSound(sound: AlertSound): void {
  const context = getAudioContext();
  if (context === null) {
    return;
  }

  const playedAt = performance.now();
  if (playedAt - lastPlayedAt < MIN_GAP_MS) {
    return;
  }
  lastPlayedAt = playedAt;

  if (context.state !== "running") {
    // Ask for the context back and drop this blip rather than scheduling it:
    // a suspended context plays everything queued against it the moment it
    // resumes, which would arrive as one burst of stale alerts.
    context.resume().catch(() => {
      // Still locked — the page has not been interacted with yet.
    });
    return;
  }

  const startedAt = context.currentTime;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(FREQUENCY_HZ[sound], startedAt);

  // Ramp both ends of the note so it fades instead of clicking.
  envelope.gain.setValueAtTime(0, startedAt);
  envelope.gain.linearRampToValueAtTime(PEAK_GAIN, startedAt + ATTACK_S);
  envelope.gain.exponentialRampToValueAtTime(0.0001, startedAt + DURATION_S);

  oscillator.connect(envelope).connect(context.destination);
  oscillator.start(startedAt);
  oscillator.stop(startedAt + DURATION_S);
}

/**
 * Plays a preview from a user gesture, waiting for a locked audio context to
 * come back first so the very first preview is audible. Doing this once is
 * what lets the automatic alerts play unprompted afterwards.
 */
export function previewAlertSound(sound: AlertSound): void {
  const context = getAudioContext();
  if (context === null) {
    return;
  }

  if (context.state === "running") {
    playAlertSound(sound);
    return;
  }

  context.resume().then(
    () => playAlertSound(sound),
    () => {
      // Nothing to preview if the browser refuses to unlock audio.
    },
  );
}
