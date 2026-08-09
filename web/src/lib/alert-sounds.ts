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
/** Interactions that count as the gesture browsers wait for before allowing audio. */
const UNLOCK_GESTURES = ["pointerup", "keydown"] as const;

/** `navigator.audioSession` is iOS 17+ and not in the DOM types yet. */
type NavigatorWithAudioSession = Navigator & { audioSession?: { type: string } };

let audioContext: AudioContext | null = null;
let lastPlayedAt = Number.NEGATIVE_INFINITY;
let playbackSessionClaimed = false;

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
 * iOS plays Web Audio through the "ambient" audio session, which the ringer
 * switch silences — so a phone on silent hears nothing however loud the blip
 * is. Claiming the "playback" session opts out of that switch.
 *
 * It is claimed on the first blip rather than up front because the session is
 * exclusive: a viewer with both alerts off should never have whatever they are
 * listening to interrupted by a page that is not going to make a sound.
 */
function claimPlaybackAudioSession(): void {
  if (playbackSessionClaimed) {
    return;
  }

  const { audioSession } = navigator as NavigatorWithAudioSession;
  if (audioSession === undefined) {
    return;
  }

  audioSession.type = "playback";
  playbackSessionClaimed = true;
}

function scheduleBlip(context: AudioContext, sound: AlertSound): void {
  claimPlaybackAudioSession();

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
 * Browsers keep an audio context suspended until the page has been interacted
 * with, and iOS only honours a resume made from inside the gesture itself —
 * one asked for at any other moment is left hanging forever. So every gesture
 * on the page is taken as a chance to get the context back to running, which
 * also covers iOS re-suspending it whenever the page is backgrounded.
 */
function unlockOnGesture(): void {
  const context = getAudioContext();
  if (context === null || context.state === "running") {
    return;
  }

  context.resume().catch(() => undefined);
}

for (const gesture of UNLOCK_GESTURES) {
  window.addEventListener(gesture, unlockOnGesture, { passive: true });
}

/** Plays a blip, unless one just played or audio is still locked. */
export function playAlertSound(sound: AlertSound): void {
  const context = getAudioContext();
  // Locked, or interrupted by iOS. The next gesture unlocks it; this alert is
  // dropped rather than held back, since a blip for an event that has scrolled
  // out of view is worse than no blip at all.
  if (context === null || context.state !== "running") {
    return;
  }

  const playedAt = performance.now();
  if (playedAt - lastPlayedAt < MIN_GAP_MS) {
    return;
  }
  lastPlayedAt = playedAt;

  scheduleBlip(context, sound);
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

  // Called straight out of the click, which is the one moment iOS lets a
  // suspended context start, so the preview is what unlocks every later blip.
  context.resume().then(
    () => scheduleBlip(context, sound),
    () => undefined,
  );
}
