import Link from "next/link";
import { BellOff, Laptop, Send, Smartphone, Tablet } from "lucide-react";
import { AutomationFeed } from "@/components/admin/automation-feed";
import { formatStoreDateTime } from "@/components/admin/coupon-summary";
import { Disclosure } from "@/components/store/disclosure";
import { InfoTip } from "@/components/store/info-tip";
import { channelShort } from "@/lib/notification-channels";
import { prisma } from "@/lib/prisma";
import { countSubscriptions, pushConfigured } from "@/lib/push";
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
 * A glyph for the platform label `listPushDevices` derives. An element, never
 * a component: this is a server page and the icon may cross into a client
 * `Disclosure` (the RSC note in CLAUDE.md).
 */
function deviceIcon(platform: string) {
  const cls = "h-4 w-4";
  if (platform.startsWith("iPad")) return <Tablet className={cls} />;
  if (platform === "Mac" || platform === "Windows" || platform === "Linux") {
    return <Laptop className={cls} />;
  }
  return <Smartphone className={cls} />;
}

/**
 * Admin → Notifications.
 *
 * ## One job per screen, in the order the owner asks the questions
 *
 * 1. **What has happened?** The feed, first and alone above the fold. It is
 *    what somebody opens this screen to see, many times a day.
 * 2. **Which devices get push?** One tap away, behind a `Disclosure`. It is a
 *    diagnostic — "is my phone on here?" — not something to read every visit.
 * 3. **Broadcast.** A link in the header to `/admin/notifications/send`. It is
 *    rare, and it reaches real lock screens, so it is a deliberate step away
 *    rather than a form sitting open under the feed. The link is absent — not
 *    disabled — when there is nobody to send to.
 *
 * Every explanation (refresh cadence, iOS install rules, why the sound cannot
 * be chosen, what "last visit" means) is behind an `(i)`.
 *
 * ## Not a second place to configure alerts
 *
 * **Which events land in this feed is decided in exactly one place:
 * Settings → Alerts.** This page names that column and links to it, and says
 * so plainly when nothing is switched on — a feed that stays empty for ever
 * with no reason given reads as broken. It has no switch of its own, and must
 * never grow one.
 *
 * The panel layout redirects anyone without an admin session, but that is not
 * what protects the broadcast: `broadcastPush` re-checks the session itself
 * (`requireAdminWrite`), because a server action is reachable by id from
 * anywhere once it exists.
 */
export default async function AdminNotifications() {
  const configured = pushConfigured();
  const [{ total }, devices, bellAlerts] = await Promise.all([
    countSubscriptions(),
    listPushDevices(),
    // The same filter `listNotifications` reads the feed with, as a count —
    // read-only, and only ever used to explain an empty feed.
    prisma.automationRule
      .count({ where: { isActive: true, action: "inapp", recipient: "admin" } })
      .catch(() => null),
  ]);

  const canBroadcast = configured && total > 0;
  const bell = channelShort("inapp");
  const alertsLink = (
    <Link
      href="/admin/settings?tab=alerts"
      className="font-medium text-foreground underline underline-offset-2 hover:text-accent"
    >
      Settings → Alerts
    </Link>
  );

  return (
    <div className="min-w-0 max-w-2xl">
      {/* ---------------- Header ----------------
          The title and the broadcast link share a row and the subtitle runs
          underneath both. Beside a two-line block the link wrapped onto its
          own full-width row at 375px, which made the rarest action on the
          page the biggest thing above the feed. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="flex min-w-0 items-center gap-1 font-serif text-2xl">
          Notifications
          <InfoTip term="Notifications">
            Everything your store has told you, newest first. The list
            refreshes by itself every 30 seconds, and straight away when you
            come back to this tab. Read marks are kept per browser, so your
            phone keeps its own.
          </InfoTip>
        </h1>
        {canBroadcast && (
          <Link
            href="/admin/notifications/send"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-border px-4 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted"
          >
            <Send className="h-4 w-4" aria-hidden /> Send a push
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        What&apos;s happened in your store, newest first.
      </p>

      {/* ---------------- The feed ---------------- */}
      <div className="mt-6">
        <AutomationFeed />
        {/* Read-only, one link. The on/off for every alert lives in
            Settings → Alerts and nowhere else. */}
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {bellAlerts === 0 ? (
            <>
              Nothing is switched on in the {bell} column of {alertsLink}, so
              nothing will show up here.
            </>
          ) : (
            <>
              What shows up here is the {bell} column in {alertsLink}.
            </>
          )}
        </p>
      </div>

      {/* ---------------- Devices ----------------
          The endpoint is never rendered: it is a capability URL that would
          let anyone holding it send to that device. `listPushDevices` does
          not even return it. */}
      <section aria-labelledby="push-devices-heading" className="mt-10">
        <h2
          id="push-devices-heading"
          className="flex items-center gap-1 text-[11px] font-medium uppercase leading-none tracking-[0.16em] text-muted-foreground"
        >
          Push notifications
          <InfoTip term="Push notifications">
            Devices that have allowed notifications from your store — a push
            can only reach these. &ldquo;Last visit&rdquo; is when a device last
            opened the store, not when it last received a push. The alert sound
            is the device&apos;s own; a web app can&apos;t choose it.
          </InfoTip>
        </h2>

        <div className="mt-3 rounded-2xl border border-border bg-card px-4">
          {!configured ? (
            <p className="flex min-h-12 flex-wrap items-center gap-x-1.5 py-3 text-sm text-muted-foreground">
              <BellOff className="h-4 w-4 shrink-0" aria-hidden />
              Push isn&apos;t set up on this deployment.
              <InfoTip term="Setting up push">
                Set <code className="font-mono">NEXT_PUBLIC_VAPID_PUBLIC_KEY</code>,{" "}
                <code className="font-mono">VAPID_PRIVATE_KEY</code> and{" "}
                <code className="font-mono">VAPID_SUBJECT</code>{" "}
                in the deployment&apos;s environment variables, then redeploy. Until
                then no device can subscribe and nothing can be sent. The list
                above works either way.
              </InfoTip>
            </p>
          ) : total === 0 ? (
            <p className="flex min-h-12 flex-wrap items-center gap-x-1 py-3 text-sm text-muted-foreground">
              No device has allowed notifications yet.
              <PhoneHelp />
            </p>
          ) : (
            <Disclosure
              label="Devices"
              icon={<Smartphone className="h-4 w-4" />}
              summary={`${total} opted in`}
            >
              <ul className="divide-y divide-border border-t border-border">
                {devices.map((device) => (
                  <li key={device.id} className="flex items-start gap-3 py-3">
                    <span aria-hidden className="mt-0.5 shrink-0 text-muted-foreground">
                      {deviceIcon(device.platform)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <p className="min-w-0 break-words text-sm text-foreground">
                          {device.platform}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Last visit{" "}
                          <time
                            dateTime={device.lastSeenAt.toISOString()}
                            title={formatStoreDateTime(device.lastSeenAt)}
                          >
                            {ago(device.lastSeenAt)}
                          </time>
                        </p>
                      </div>
                      <p className="mt-0.5 break-words text-xs text-muted-foreground">
                        {device.browser} · {device.service} push ·{" "}
                        {device.signedIn ? "signed in" : "guest"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {total > devices.length && (
                <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                  Showing the {devices.length} most recently active of {total}.
                </p>
              )}
              <p className="flex flex-wrap items-center gap-x-1 border-t border-border pt-2 text-xs text-muted-foreground">
                Phone not getting alerts?
                <PhoneHelp />
              </p>
            </Disclosure>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * The three reasons a phone that should get push does not, in the order they
 * bite. One tip, used by both the empty state and the device list, so the
 * explanation has one wording.
 */
function PhoneHelp() {
  return (
    <InfoTip term="Phone setup">
      On an iPhone, add the store to the Home Screen first (Share → Add to Home
      Screen, iOS 16.4 or later), open it from there and allow notifications —
      a Safari tab never gets push. Alerts meant for you only reach a device
      signed in with the account that uses your alert address in Settings →
      Alerts. A device that deletes the app or clears its data drops off this
      list after the next send.
    </InfoTip>
  );
}
