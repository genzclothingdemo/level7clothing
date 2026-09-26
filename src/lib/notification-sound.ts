/**
 * A short two-tone chime for in-app alerts.
 *
 * Synthesised with WebAudio rather than shipped as an mp3: no network request,
 * no 20 KB asset, nothing to cache, and it cannot fail to load. A three-note
 * major arpeggio, struck and damped in under half a second — a notification
 * sound should be noticed and then gone, not a ringtone.
 *
 * ## Why this is in-app only
 *
 * A *push* notification's sound belongs to the operating system. The Web
 * Notifications `sound` option was removed from the spec and is ignored by
 * every current browser, and a service worker cannot play audio — there is no
 * document, and autoplay policy would block it anyway. So a delivered push
 * uses the device's own notification sound, which is correct: it respects the
 * user's silent mode, Do Not Disturb and per-app volume.
 *
 * This covers the other half — something arriving while the shopper is
 * actually looking at the page, where the OS plays nothing at all.
 *
 * Two callers: the chat widget, when the store replies to an open thread, and
 * `lib/push-chime.ts`, which is how a delivered push reaches this file. The
 * worker cannot call it directly (no document, no audio context, and autoplay
 * policy would block it anyway) — it posts a message to visible clients and a
 * page plays the sound. That indirection is the whole mechanism.
 */

/**
 * Browsers refuse to start audio until the user has interacted with the page.
 * One shared context, created lazily on first play, keeps us from allocating
 * one per sound and from constructing it before a gesture exists.
 */
let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    return ctx;
  } catch {
    return null; // blocked by policy, or no audio device
  }
}

/**
 * One struck tone: a sine fundamental with a quiet octave above it.
 *
 * The partial is what makes it read as a small bell rather than a test tone —
 * a bare sine is clean and completely characterless. It is a quarter the
 * amplitude and decays faster, which is roughly what a real struck bar does.
 *
 * `peak` is deliberately low. This plays while someone is reading the page it
 * belongs to, not across a room, and a loud in-app chime is the fastest route
 * to being muted for good.
 */
function tone(
  ac: AudioContext,
  destination: AudioNode,
  freq: number,
  startAt: number,
  seconds: number,
  peak: number
) {
  for (const [ratio, level, scale] of [
    [1, peak, 1],
    [2, peak * 0.25, 0.6],
  ] as const) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = "sine";
    osc.frequency.value = freq * ratio;

    const length = seconds * scale;
    // A 12ms attack instead of an instant one: a hard edge on a sine is heard
    // as a click before it is heard as a note.
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(level, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + length);

    osc.connect(gain).connect(destination);
    osc.start(startAt);
    osc.stop(startAt + length + 0.02);
  }
}

/**
 * A5 → C♯6 → E6, an A-major arpeggio struck quickly.
 *
 * Rising, major and over in under half a second: "something arrived", not
 * "something is wrong". A descending figure reads as a dismissal and a single
 * tone reads as an error beep — both were tried. The notes overlap slightly
 * (72ms apart, each ringing ~200ms) so it lands as one gesture rather than
 * three separate bleeps, and the last note rings longest.
 */
const CHIME: ReadonlyArray<readonly [freq: number, offset: number, length: number, peak: number]> =
  [
    [880.0, 0, 0.18, 0.05], // A5
    [1108.7, 0.072, 0.2, 0.045], // C#6
    [1318.5, 0.144, 0.34, 0.055], // E6
  ];

/**
 * Play the chime. Safe to call from anywhere — it never throws and never
 * blocks, and it stays silent when the tab is hidden (the OS notification
 * already covers that case, and two sounds for one event is worse than one).
 *
 * The scheduling is done **after** the context has resumed, not before. A
 * suspended context's `currentTime` does not advance, so scheduling against it
 * and resuming afterwards collapses all three notes onto the same instant and
 * the chime arrives as one flat chord. That bug is invisible on a page the
 * shopper has already clicked and appears on every first play.
 */
export function playNotificationSound(): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return;
  }

  const ac = context();
  if (!ac) return;

  void (async () => {
    try {
      // Suspended is the normal state before the first gesture; resuming is a
      // no-op when it is already running.
      if (ac.state === "suspended") await ac.resume();
      if (ac.state !== "running") return; // still blocked — stay silent

      // One shared lowpass takes the glassy top off the octave partials. 6 kHz
      // is above every note here, so it shapes the timbre without dulling it.
      const filter = ac.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 6000;
      filter.connect(ac.destination);

      const now = ac.currentTime + 0.01;
      for (const [freq, offset, length, peak] of CHIME) {
        tone(ac, filter, freq, now + offset, length, peak);
      }
    } catch {
      /* audio unavailable — silence is an acceptable outcome for a chime */
    }
  })();
}
