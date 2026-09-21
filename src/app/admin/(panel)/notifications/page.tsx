import { BellOff } from "lucide-react";
import { PushBroadcast } from "@/components/admin/push-broadcast";
import { countSubscriptions, pushConfigured, PUSH_LIMITS } from "@/lib/push";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

/**
 * Admin → Notifications. Read the subscriber count, compose one push, send it.
 *
 * The panel layout already redirects anyone without an admin session, but that
 * is not what protects this: `broadcastPush` re-checks the admin cookie itself,
 * because a server action is reachable by id from anywhere once it exists.
 */
export default async function AdminNotifications() {
  const configured = pushConfigured();
  const { total, signedIn } = await countSubscriptions();

  return (
    <div>
      <div>
        <h1 className="font-serif text-3xl">Notifications</h1>
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

      <p className="mt-6 max-w-2xl text-xs leading-relaxed text-muted-foreground">
        Subscriptions that a push service reports as gone (the customer
        uninstalled the app or cleared their data) are deleted automatically
        during a send, so the count above stays honest without any maintenance.
      </p>
    </div>
  );
}
