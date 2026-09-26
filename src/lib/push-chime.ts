"use client";

import { useEffect } from "react";
import { playNotificationSound } from "@/lib/notification-sound";

/**
 * Play the in-app chime when a push lands on a tab that is already open.
 *
 * ## What this is, and what it is not
 *
 * **A web page cannot choose the sound a push notification makes.** That sound
 * belongs to the operating system: iOS plays the user's notification tone,
 * Android plays the channel's, and both respect silent mode, Do Not Disturb and
 * per-app volume. The `sound` option was cut from the Notifications spec years
 * ago and is ignored everywhere; a service worker has no document and no audio
 * context, so it could not play one even if the option existed. Any claim to
 * have "set the notification sound" from a web app is wrong.
 *
 * What *is* ours is the gap that leaves: a push arriving while the shopper is
 * looking at the store. Every platform treats that case differently and several
 * play nothing at all, on the reasonable theory that you are already here. So
 * `public/sw.js` posts an `L7_PUSH` message to every **visible** client, and
 * this hook turns that into the two-tone chime in `lib/notification-sound.ts`.
 *
 * Only visible clients are messaged (the worker checks, not this file), because
 * a backgrounded tab would chime *underneath* the OS notification sound and two
 * sounds for one event is worse than one.
 *
 * ## Why it is a hook rather than a listener in the worker registration
 *
 * `navigator.serviceWorker`'s `message` event only fires at a document, and the
 * listener has to be torn down with the component that owns it. Mounted once,
 * from `PushPrompt`, which is already in the root layout by way of
 * `PwaRegister` — so this costs one listener and no new mount point.
 *
 * Browsers will not start audio before the first user gesture. That is handled
 * inside `playNotificationSound`, which resumes a suspended context and returns
 * silently when it cannot: a missed chime is an acceptable outcome, an
 * exception in a push path is not.
 */
export function usePushChime(): void {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      // The worker is same-origin by definition, but the handler is still
      // written to ignore anything that is not the exact shape we send — a
      // `message` listener on `navigator.serviceWorker` is a public surface.
      const data = event.data as { type?: unknown } | null;
      if (!data || typeof data !== "object" || data.type !== "L7_PUSH") return;
      playNotificationSound();
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);
}
