/**
 * A short two-tone chime for in-app alerts.
 *
 * Synthesised with WebAudio rather than shipped as an mp3: no network request,
 * no 20 KB asset, nothing to cache, and it cannot fail to load. Two soft sine
 * tones a fifth apart with a quick exponential decay — a notification sound
 * should be noticed and then gone, not a ringtone.
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

/** One decaying sine tone. */
function tone(ac: AudioContext, freq: number, startAt: number, seconds: number) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();

  osc.type = "sine";
  osc.frequency.value = freq;

  // Peak is deliberately low (0.06). This plays while someone is reading, not
  // across a room, and a loud in-app chime is the fastest way to get muted.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.06, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + seconds);

  osc.connect(gain).connect(ac.destination);
  osc.start(startAt);
  osc.stop(startAt + seconds + 0.02);
}

/**
 * Play the chime. Safe to call from anywhere — it never throws and never
 * blocks, and it stays silent when the tab is hidden (the OS notification
 * already covers that case, and two sounds for one event is worse than one).
 */
export function playNotificationSound(): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return;
  }

  const ac = context();
  if (!ac) return;

  try {
    // Suspended is the normal state before the first gesture; resuming is a
    // no-op when it is already running.
    if (ac.state === "suspended") void ac.resume();
    const now = ac.currentTime;
    tone(ac, 880, now, 0.14); // A5
    tone(ac, 1318.5, now + 0.1, 0.18); // E6 — a fifth above, slightly later
  } catch {
    /* audio unavailable — silence is an acceptable outcome for a chime */
  }
}
