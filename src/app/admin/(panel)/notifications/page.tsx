import Link from "next/link";
import { BellOff } from "lucide-react";
import { PushBroadcast } from "@/components/admin/push-broadcast";
import { countSubscriptions, pushConfigured, PUSH_LIMITS } from "@/lib/push";
import { listPushDevices } from "@/lib/push-devices";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

/** "3 minutes ago" / "2 days ago" — enough to spot a device that went quiet. */
function ago(date: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Admin → Notifications. Read the subscriber count, compose one push, send it.
 *
 * The panel layout already redirects anyone without an admin session, but that
 * is not what protects this: `broadcastPush` re-checks the admin cookie itself,
 * because a server action is reachable by id from anywhere once it exists.
 */
export default async function AdminNotifications() {
  const configured = pushConfigured();
  const [{ total, signedIn }, devices] = await Promise.all([
    countSubscriptions(),
    listPushDevices(),
  ]);

  return (
    <div>
      <div>
        <h1 className="font-serif text-2xl">Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {total} device{total === 1 ? "" : "s"} opted in
          {total > 0 && ` · ${signedIn} linked to an account`}
        </p>
      </div>

      {!configured ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-12 text-center">
          <BellOff className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-serif text-xl">Push isn&apos;t configured</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Set <code className="font-mono text-xs">NEXT_PUBLIC_VAPID_PUBLIC_KEY</code>,{" "}
            <code className="font-mono text-xs">VAPID_PRIVATE_KEY</code> and{" "}
            <code className="font-mono text-xs">VAPID_SUBJECT</code> in the deployment&apos;s
            environment variables, then redeploy. Until then no device can subscribe and
            nothing can be sent.
          </p>
        </div>
      ) : (
        <div className="mt-6">
          <PushBroadcast
            limits={{ title: PUSH_LIMITS.title, body: PUSH_LIMITS.body, url: PUSH_LIMITS.url }}
            deviceCount={total}
            configured={configured}
          />
        </div>
      )}

      {/*
        The device list. A count alone cannot answer the question people
        actually bring to this screen — "is my phone on here?" — so each
        subscription names its platform, whose push service holds it, and when
        it last checked in. The endpoint itself is never rendered: it is a
        capability URL that would let anyone holding it send to that device.
      */}
      {configured && devices.length > 0 && (
        <div className="mt-8 max-w-2xl">
          <h2 className="text-[11px] uppercase leading-none tracking-[0.16em] text-muted-foreground">
            Subscribed devices
          </h2>
          <ul className="mt-3 divide-y divide-border rounded-2xl border border-border">
            {devices.map((device) => (
              <li
                key={device.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
              >
                <span className="text-sm text-foreground">
                  {device.platform}
                  <span className="text-muted-foreground"> · {device.browser}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {device.service} push · {device.signedIn ? "signed in" : "guest"} · last seen{" "}
                  {ago(device.lastSeenAt)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            &ldquo;Last seen&rdquo; is the last time that device opened the store
            with notifications on — not the last notification it received.
            iPhones only appear here once the store is installed to the home
            screen, which is the only place iOS delivers web push.
          </p>
        </div>
      )}

      {/*
        This used to read "Nothing is sent automatically", which was true when
        it was written and stopped being true on 2026-09-26: push became a
        second action on the automation engine, so an order event can now
        notify a phone the same way it emails. Everything on *this* page is
        still a one-off you compose by hand — the distinction is the whole
        point of the sentence, and it has to name where the other kind lives.
      */}
      <p className="mt-6 max-w-2xl text-xs leading-relaxed text-muted-foreground">
        Everything on this page is a one-off you compose and send yourself.
        Notifications that go out <em>on their own</em> — when an order is
        confirmed or shipped, and when a chat message is written in either
        direction — are rules in{" "}
        <Link
          href="/admin/automation"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Automation
        </Link>
        , alongside the emails; &ldquo;Restore shipped rules&rdquo; there adds
        four for exactly that, switched off until you want them. A rule only
        reaches a customer who has installed the store and allowed
        notifications; everyone else is skipped with a reason rather than
        counted as a failure. Subscriptions that a push service reports as gone
        (the customer uninstalled the app or cleared their data) are deleted
        automatically during a send, so the count above stays honest without any
        maintenance.
      </p>

      {/*
        The one fact that decides whether a notification to YOU can work, and
        the one an owner has no way to discover. `recipient: "admin"` resolves
        through Settings → the notify address → a customer account holding it →
        that account's devices. No account, no device, and every such job
        cancels itself with a reason nobody is watching for. Stated here
        because this is the page where the device list lives — the rule editor
        in Automation prints the same number beside the choice.
      */}
      {configured && (
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          A rule that notifies <em>you</em> finds your phone through the
          notify-me address in{" "}
          <Link
            href="/admin/settings?tab=store"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Settings
          </Link>
          : it reaches whichever customer account uses that address. So your
          phone only hears from those rules once you have signed in to the
          storefront with it, installed the store, and allowed notifications.
          Until then those jobs are skipped with that reason rather than
          failing.
        </p>
      )}
    </div>
  );
}
