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
let unlocking = false;

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

function scheduleBlip(context: AudioContext, sound: AlertSound): void {
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
 * Browsers keep an audio context locked until the page has been interacted
 * with, and a locked context fires everything queued against it the moment it
 * unlocks. So a blip that arrives early waits for the context and then plays,
 * and only one is ever in flight — the rest are dropped rather than piling up
 * into a burst of stale alerts.
 */
function playWhenUnlocked(context: AudioContext, sound: AlertSound): void {
  if (unlocking) {
    return;
  }
  unlocking = true;

  context.resume().then(
    () => {
      unlocking = false;
      scheduleBlip(context, sound);
    },
    () => {
      unlocking = false;
    },
  );
}

/** Plays a blip, unless one just played or the context is still locked. */
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

  if (context.state === "running") {
    scheduleBlip(context, sound);
    return;
  }

  playWhenUnlocked(context, sound);
}

/**
 * Plays a preview from a user gesture — the click both unlocks audio and shows
 * how loud the alert is. Skips the burst throttle so switching one setting on
 * right after another still previews both.
 */
export function previewAlertSound(sound: AlertSound): void {
  const context = getAudioContext();
  if (context === null) {
    return;
  }

  lastPlayedAt = performance.now();

  if (context.state === "running") {
    scheduleBlip(context, sound);
    return;
  }

  playWhenUnlocked(context, sound);
}
