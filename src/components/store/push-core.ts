"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { sendTestPush, subscribeToPush, unsubscribeFromPush } from "@/app/actions/push";

/**
 * Web push — the browser half.
 *
 * One hook backs every push control on the store, so "are notifications on?"
 * has a single answer however the shopper got there.
 *
 * The rules that shaped this, in order of how expensive they are to get wrong:
 *
 * 1. **`Notification.requestPermission()` is never called on load.** Chrome
 *    and Firefox both penalise sites that do, and shoppers read it as spam.
 *    It is only ever reached from `enable()`, which only ever runs from a
 *    click.
 * 2. **The permission call happens before any `await`.** Safari requires it to
 *    run inside the user gesture, and awaiting the service worker first spends
 *    that activation — the prompt then silently never appears on iOS.
 * 3. **`support` distinguishes "can't" from "not yet".** iOS Safari does not
 *    define `PushManager` until the site is installed to the home screen, so a
 *    plain "unsupported" would be a lie on the one platform where the fix is a
 *    single tap. `"needs-install"` is that case.
 */

/** Inlined at build time. Empty when the store has no VAPID keys configured. */
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** Re-register a live subscription at most once per tab session. */
const RESYNC_KEY = "l7:push-resynced";

/**
 * `applicationServerKey` wants raw bytes; VAPID keys travel as base64url.
 * `atob` only speaks standard base64, hence the character swap and padding.
 *
 * The array is built over an explicit `ArrayBuffer` and the return type is
 * left to inference on purpose: a plain `Uint8Array` annotation widens to
 * `ArrayBufferLike`, which since TypeScript 5.7 is no longer assignable to
 * `BufferSource` — it could be a `SharedArrayBuffer`, which `subscribe()`
 * will not take.
 */
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Was this subscription minted with the key this deployment signs with?
 *
 * Rotating VAPID keys does not invalidate the subscriptions a browser already
 * holds — `getSubscription()` keeps returning one signed for the *old* key, the
 * UI keeps saying notifications are on, and every send is rejected by the push
 * service with a 403 that nobody sees. That is a silent, total outage on every
 * device that subscribed before the rotation.
 *
 * So a mismatch is treated as "not subscribed": pressing Turn on drops the dead
 * subscription and mints a fresh one.
 *
 * Safari does not always expose `options.applicationServerKey`. A missing key
 * is answered `true` — refusing to trust a subscription we cannot check would
 * re-subscribe an iPhone on every single visit.
 */
function appServerKeyMatches(sub: PushSubscription, expected: Uint8Array): boolean {
  const raw = sub.options?.applicationServerKey;
  if (!raw) return true;
  const have = new Uint8Array(raw);
  if (have.length !== expected.length) return false;
  return have.every((byte, i) => byte === expected[i]);
}

/** True for iPhone/iPad, including iPadOS, which reports itself as a Mac. */
function isApplePhoneOrTablet(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/** Running as an installed app rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS predates the display-mode media query for installed web apps.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export type PushSupport =
  /** Still working it out — render nothing rather than flicker. */
  | "unknown"
  /** Subscribing will work. */
  | "ready"
  /** iOS Safari: push exists, but only once the app is on the home screen. */
  | "needs-install"
  /**
   * An **installed** iPhone app whose iOS is older than 16.4 — Apple shipped
   * web push in that release and not before. The shopper has already done the
   * one thing `needs-install` asks for, so telling them to install again would
   * be a dead end; the only way forward is a system update.
   */
  | "needs-ios-update"
  /** No keys on this deployment, or the browser has no Push API at all. */
  | "unsupported";

export type PushPermission = "default" | "granted" | "denied";

export type PushState = {
  support: PushSupport;
  permission: PushPermission;
  standalone: boolean;
  /** An iOS device, which changes the advice we give. */
  apple: boolean;
  /** True when this browser holds a live subscription. */
  subscribed: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
};

export type PushControls = PushState & {
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  test: () => Promise<void>;
  clearMessages: () => void;
};

const readPermission = (): PushPermission =>
  typeof Notification === "undefined" ? "default" : (Notification.permission as PushPermission);

/**
 * Resolve the active registration without hanging.
 *
 * `navigator.serviceWorker.ready` is a promise that simply never settles when
 * nothing is registered — which is every local dev session, because
 * `PwaRegister` deliberately unregisters the worker outside production. A
 * bare await there leaves the button spinning forever.
 */
async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  const existing = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (!existing) return null;
  if (existing.active) return existing;

  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);
}

/**
 * The registration to subscribe against, registering the worker if it is not
 * there yet.
 *
 * **This closes a first-visit race.** `PwaRegister` registers `/sw.js` on the
 * `load` event, deliberately, to keep the worker off the critical path for
 * first paint. But the bell renders as soon as React mounts, which is *before*
 * `load` — so a shopper who arrives and presses Turn on straight away hit
 * "The app isn't ready yet. Reload and try again." on a perfectly healthy
 * store. Asking for notifications is a deliberate act; it should not depend on
 * how fast someone taps.
 *
 * Registering here is safe to duplicate: `register()` with the same script and
 * scope resolves to the registration that already exists rather than making a
 * second one.
 *
 * **Production only**, matching `PwaRegister`. In dev that file unregisters the
 * worker on every mount — it sits in front of Turbopack's HMR assets and serves
 * stale chunks — so self-registering here would fight it and break the dev
 * server instead of fixing anything. `enable()` says so in words rather than
 * failing with a shrug.
 */
async function ensureRegistration(): Promise<ServiceWorkerRegistration | null> {
  const existing = await activeRegistration();
  if (existing) return existing;
  if (process.env.NODE_ENV !== "production") return null;

  try {
    await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  } catch {
    return null; // blocked by policy, private mode, or no worker available
  }

  return activeRegistration();
}

export function usePush(): PushControls {
  const [state, setState] = useState<PushState>({
    support: "unknown",
    permission: "default",
    standalone: false,
    apple: false,
    subscribed: false,
    busy: false,
    error: null,
    notice: null,
  });

  const patch = useCallback(
    (next: Partial<PushState>) => setState((prev) => ({ ...prev, ...next })),
    []
  );

  // Read the browser's actual state once on mount. Nothing here prompts.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const apple = isApplePhoneOrTablet();
      const standalone = isStandalone();
      const hasApi =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

      if (!hasApi || !VAPID_PUBLIC_KEY) {
        // Three different "no" answers, because only one of them is final.
        // On iOS the Push API genuinely appears only after installation, so
        // "install first" is the truthful message rather than "unsupported" —
        // and an iPhone that is *already* installed and still has no
        // PushManager is running something older than iOS 16.4, where the way
        // out is a system update, not another install.
        let support: PushSupport = "unsupported";
        if (VAPID_PUBLIC_KEY && apple) {
          support = standalone ? "needs-ios-update" : "needs-install";
        }
        if (!cancelled) patch({ support, standalone, apple });
        return;
      }

      const registration = await activeRegistration();
      const existing = registration
        ? await registration.pushManager.getSubscription().catch(() => null)
        : null;

      if (cancelled) return;

      // A subscription signed for a key this deployment no longer holds is a
      // dead subscription, however healthy it looks — see `appServerKeyMatches`.
      // Reporting it as "on" would leave the shopper with a switch that is
      // already in the position they want and a phone that never rings.
      const live =
        existing !== null &&
        appServerKeyMatches(existing, urlBase64ToUint8Array(VAPID_PUBLIC_KEY));

      patch({
        support: "ready",
        permission: readPermission(),
        standalone,
        apple,
        subscribed: live,
      });

      // Keep the stored row alive and correctly attributed: a customer who
      // subscribed as a guest and later signed in gets their subscription
      // claimed onto the account here. Once per tab, so this never becomes a
      // database write on every navigation.
      if (existing && live && readPermission() === "granted") {
        try {
          if (sessionStorage.getItem(RESYNC_KEY) === "1") return;
          sessionStorage.setItem(RESYNC_KEY, "1");
        } catch {
          return; // private mode — skip rather than resync on every load
        }
        void subscribeToPush(existing.toJSON()).catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [patch]);

  const enable = useCallback(async () => {
    // Step 1, before any await: Safari only honours this inside the gesture.
    let permission: PushPermission;
    try {
      permission = (await Notification.requestPermission()) as PushPermission;
    } catch {
      patch({ error: "This browser wouldn't show the permission prompt." });
      return;
    }

    patch({ permission, busy: true, error: null, notice: null });

    if (permission !== "granted") {
      patch({
        busy: false,
        error:
          permission === "denied"
            ? "Notifications are blocked for this site."
            : "Permission wasn't given, so nothing has changed.",
      });
      return;
    }

    try {
      const registration = await ensureRegistration();
      if (!registration) {
        patch({
          busy: false,
          error:
            process.env.NODE_ENV === "production"
              ? "The app isn't ready yet. Reload and try again."
              : // Dev has no service worker on purpose (PwaRegister unregisters
                // it), so this is not a fault to go hunting for.
                "Notifications need a production build — run `next build && next start`.",
        });
        return;
      }

      const serverKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

      // Reuse an existing subscription rather than rotating it — a fresh
      // endpoint would orphan the row already stored for this device. The one
      // exception is a subscription minted for a different VAPID key: that one
      // is unusable, so it is dropped here *and* at the server, otherwise the
      // dead row sits in the table failing every broadcast forever.
      let existing = await registration.pushManager.getSubscription();
      if (existing && !appServerKeyMatches(existing, serverKey)) {
        const stale = existing.endpoint;
        await existing.unsubscribe().catch(() => {});
        await unsubscribeFromPush(stale).catch(() => {});
        existing = null;
      }

      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: serverKey,
        }));

      const result = await subscribeToPush(subscription.toJSON());
      if (!result.ok) {
        patch({ busy: false, error: result.error ?? "Couldn't save your preference." });
        return;
      }

      patch({ busy: false, subscribed: true, notice: "Notifications are on." });
    } catch {
      patch({ busy: false, error: "Couldn't turn notifications on. Try again." });
    }
  }, [patch]);

  const disable = useCallback(async () => {
    patch({ busy: true, error: null, notice: null });
    try {
      const registration = await activeRegistration();
      const subscription = registration
        ? await registration.pushManager.getSubscription()
        : null;

      if (subscription) {
        const { endpoint } = subscription;
        // Drop it locally first. If the server call then fails, the device is
        // already silent, which is what the shopper asked for; the row is
        // pruned on the next send when the push service returns 410.
        await subscription.unsubscribe().catch(() => {});
        await unsubscribeFromPush(endpoint).catch(() => {});
      }

      patch({ busy: false, subscribed: false, notice: "Notifications are off." });
    } catch {
      patch({ busy: false, error: "Couldn't turn notifications off. Try again." });
    }
  }, [patch]);

  const test = useCallback(async () => {
    patch({ busy: true, error: null, notice: null });
    try {
      const registration = await activeRegistration();
      const subscription = registration
        ? await registration.pushManager.getSubscription()
        : null;

      if (!subscription) {
        patch({ busy: false, subscribed: false, error: "Turn notifications on first." });
        return;
      }

      const result = await sendTestPush(subscription.endpoint);
      patch(
        result.ok
          ? { busy: false, notice: "Sent — it should appear in a moment." }
          : { busy: false, error: result.error ?? "Couldn't send the test." }
      );
    } catch {
      patch({ busy: false, error: "Couldn't send the test. Try again." });
    }
  }, [patch]);

  const clearMessages = useCallback(() => patch({ error: null, notice: null }), [patch]);

  return { ...state, enable, disable, test, clearMessages };
}

/* ------------------------------------------------------------------ */
/*  Dismissal                                                          */
/* ------------------------------------------------------------------ */

const DISMISS_KEY = "l7:push-prompt-dismissed";

/**
 * Whether the opt-in bar has already been waved away.
 *
 * Persisted rather than held in component state: "never nags twice" has to
 * survive a reload, and an installed app is relaunched constantly. Every
 * access is wrapped, because storage throws outright in some privacy modes —
 * and a storage error fails *closed* (treated as dismissed), so a browser that
 * cannot remember the dismissal is not asked again on every single launch.
 */
function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return true;
  }
}

const dismissListeners = new Set<() => void>();

function subscribeDismissed(onChange: () => void): () => void {
  dismissListeners.add(onChange);
  // `storage` fires in *other* tabs, which is what keeps a dismissal in one
  // window from leaving the bar sitting in another.
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === DISMISS_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    dismissListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Read the dismissal through `useSyncExternalStore` rather than an effect.
 *
 * `localStorage` is exactly what that hook is for: an external store React
 * does not own. It also removes the alternative — a `useState` seeded in an
 * effect — which triggers a cascading render on every mount and is the
 * `react-hooks/set-state-in-effect` pattern this repo is already carrying too
 * much of.
 *
 * The server snapshot is `true`, so the bar is never in the server-rendered
 * HTML and there is nothing to mismatch on hydration.
 */
export function usePromptDismissed(): boolean {
  return useSyncExternalStore(subscribeDismissed, readDismissed, () => true);
}

export function dismissPrompt(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* private mode — `readDismissed` already fails closed, so the bar stays shut */
  }
  for (const listener of dismissListeners) listener();
}
