import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PushBroadcast } from "@/components/admin/push-broadcast";
import { InfoTip } from "@/components/store/info-tip";
import { countSubscriptions, pushConfigured, PUSH_LIMITS } from "@/lib/push";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Send a push" };

/**
 * Admin → Notifications → Send a push.
 *
 * A screen of its own, one step from the feed, because a broadcast is the
 * rarest thing anyone does in Notifications and the only one that lands on
 * real lock screens. The subtitle states the stakes before the form does:
 * how many devices, straight away, no recall.
 *
 * Reached directly with nothing to send to (push not configured, or no device
 * opted in), it says so and points back rather than rendering a form whose
 * button could never work. The reason lives once, on the Notifications page.
 */
export default async function SendPushPage() {
  const configured = pushConfigured();
  const [{ total }, settings] = await Promise.all([countSubscriptions(), getSettings()]);
  const canSend = configured && total > 0;

  return (
    <div className="min-w-0 max-w-4xl">
      <Link
        href="/admin/notifications"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden /> Notifications
      </Link>

      <h1 className="flex items-center gap-1 font-serif text-2xl">
        Send a push
        <InfoTip term="Send a push">
          A one-off message to every device that has allowed notifications from
          your store — a new drop, a delay, a sale. Use it sparingly: each one
          lands on somebody&apos;s lock screen, and too many is how people turn
          notifications off.
        </InfoTip>
      </h1>

      {canSend ? (
        <>
          {/* One string, not text around an expression: the JSX transform
              drops the leading space of a text chunk that wraps onto a second
              line, which rendered "1 devicethe moment". */}
          <p className="mt-1 text-sm text-muted-foreground">
            {`Goes to ${total} device${total === 1 ? "" : "s"} the moment you confirm. A push can’t be recalled.`}
          </p>
          <div className="mt-6">
            <PushBroadcast
              limits={{ title: PUSH_LIMITS.title, body: PUSH_LIMITS.body, url: PUSH_LIMITS.url }}
              deviceCount={total}
              appName={settings.brandName}
            />
          </div>
        </>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
          <p className="font-serif text-xl">Nobody to send to yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {configured
              ? "No device has allowed notifications from the store."
              : "Push isn’t set up on this deployment."}
          </p>
          <Link
            href="/admin/notifications"
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-5 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted"
          >
            Back to notifications
          </Link>
        </div>
      )}
    </div>
  );
}
