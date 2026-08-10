/**
 * Short chimes marking something happening on a stream. They are synthesised
 * with the Web Audio API rather than shipped as assets — each one is a little
 * two-note motif in the shape of a chat app's join and leave chimes, mellow but
 * loud enough to carry over the stream's own audio.
 */

/** Each alert gets its own motif so they stay distinguishable by ear. */
export type AlertSound = "viewer-join" | "viewer-leave" | "chat-message";

interface Note {
  frequencyHz: number;
  /** Seconds between the start of the motif and the start of this note. */
  offsetS: number;
}

const NOTE_GAP_S = 0.09;

const NOTES: Record<AlertSound, Note[]> = {
  // A rising fifth for arriving, and the same two notes reversed for leaving,
  // so a departure sounds like an arrival played backwards.
  "viewer-join": [
    { frequencyHz: 587.33, offsetS: 0 }, // D5
    { frequencyHz: 880, offsetS: NOTE_GAP_S }, // A5
  ],
  "viewer-leave": [
    { frequencyHz: 880, offsetS: 0 }, // A5
    { frequencyHz: 587.33, offsetS: NOTE_GAP_S }, // D5
  ],
  // One note rather than two, so a message never reads as someone coming or
  // going even when the volume is low.
  "chat-message": [{ frequencyHz: 1046.5, offsetS: 0 }], // C6
};

/**
 * Partials making up a single note, as multiples of its frequency and their
 * share of the note's gain. A bare sine sounds thin at any volume; the octave
 * above gives it the bell-like body that carries over a stream.
 */
const PARTIALS = [
  { ratio: 1, level: 1 },
  { ratio: 2, level: 0.18 },
] as const;

const ATTACK_S = 0.008;
/** How long a note takes to decay to silence once it has peaked. */
const RELEASE_S = 0.32;
/** Peak gain of a note at full volume, headroom left for the partials. */
const MAX_GAIN = 0.5;
/** A note is over by here; anything scheduled after this is a separate motif. */
const MOTIF_S = NOTE_GAP_S + ATTACK_S + RELEASE_S;
/** Events arrive in bursts; collapse those into a single chime. */
const MIN_GAP_MS = MOTIF_S * 1000;
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
 * switch silences — so a phone on silent hears nothing however loud the chime
 * is. Claiming the "playback" session opts out of that switch.
 *
 * It is claimed on the first chime rather than up front because the session is
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

function scheduleNote(
  context: AudioContext,
  note: Note,
  motifStartedAt: number,
  peakGain: number,
): void {
  const startedAt = motifStartedAt + note.offsetS;
  const endedAt = startedAt + ATTACK_S + RELEASE_S;

  // Ramp both ends of the note so it swells and fades instead of clicking.
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0, startedAt);
  envelope.gain.linearRampToValueAtTime(peakGain, startedAt + ATTACK_S);
  envelope.gain.exponentialRampToValueAtTime(0.0001, endedAt);
  envelope.connect(context.destination);

  for (const partial of PARTIALS) {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(note.frequencyHz * partial.ratio, startedAt);

    const partialGain = context.createGain();
    partialGain.gain.setValueAtTime(partial.level, startedAt);

    oscillator.connect(partialGain).connect(envelope);
    oscillator.start(startedAt);
    oscillator.stop(endedAt);
  }
}

function scheduleMotif(context: AudioContext, sound: AlertSound, volume: number): void {
  claimPlaybackAudioSession();

  const motifStartedAt = context.currentTime;

  for (const note of NOTES[sound]) {
    scheduleNote(context, note, motifStartedAt, MAX_GAIN * volume);
  }
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

/**
 * Plays a chime at `volume` (0 to 1), unless one just played, the viewer has
 * turned the volume all the way down, or audio is still locked.
 */
export function playAlertSound(sound: AlertSound, volume: number): void {
  if (volume <= 0) {
    return;
  }

  const context = getAudioContext();
  // Locked, or interrupted by iOS. The next gesture unlocks it; this alert is
  // dropped rather than held back, since a chime for an event that has scrolled
  // out of view is worse than no chime at all.
  if (context === null || context.state !== "running") {
    return;
  }

  const playedAt = performance.now();
  if (playedAt - lastPlayedAt < MIN_GAP_MS) {
    return;
  }
  lastPlayedAt = playedAt;

  scheduleMotif(context, sound, volume);
}

/**
 * Plays a preview from a user gesture — the click both unlocks audio and shows
 * how loud the alert is. Skips the burst throttle so switching one setting on
 * right after another still previews both.
 */
export function previewAlertSound(sound: AlertSound, volume: number): void {
  if (volume <= 0) {
    return;
  }

  const context = getAudioContext();
  if (context === null) {
    return;
  }

  lastPlayedAt = performance.now();

  if (context.state === "running") {
    scheduleMotif(context, sound, volume);
    return;
  }

  // Called straight out of the click, which is the one moment iOS lets a
  // suspended context start, so the preview is what unlocks every later chime.
  context.resume().then(
    () => scheduleMotif(context, sound, volume),
    () => undefined,
  );
}
