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
        // On iOS the Push API genuinely appears only after installation, so
        // "install first" is the truthful message rather than "unsupported".
        const support: PushSupport =
          apple && !standalone && VAPID_PUBLIC_KEY ? "needs-install" : "unsupported";
        if (!cancelled) patch({ support, standalone, apple });
        return;
      }

      const registration = await activeRegistration();
      const existing = registration
        ? await registration.pushManager.getSubscription().catch(() => null)
        : null;

      if (cancelled) return;

      patch({
        support: "ready",
        permission: readPermission(),
        standalone,
        apple,
        subscribed: Boolean(existing),
      });

      // Keep the stored row alive and correctly attributed: a customer who
      // subscribed as a guest and later signed in gets their subscription
      // claimed onto the account here. Once per tab, so this never becomes a
      // database write on every navigation.
      if (existing && readPermission() === "granted") {
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
      const registration = await activeRegistration();
      if (!registration) {
        patch({ busy: false, error: "The app isn't ready yet. Reload and try again." });
        return;
      }

      // Reuse an existing subscription rather than rotating it — a fresh
      // endpoint would orphan the row already stored for this device.
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
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
