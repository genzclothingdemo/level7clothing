import Link from "next/link";
import { ChevronLeft, Lock, Pencil } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { TRIGGERS, describeConditions, readConditions, triggerLabel } from "@/lib/automation";
import {
  channelShort,
  composeFallbackLabel,
  eventLabel,
  eventKeyOf,
  recipientGroupLabel,
} from "@/lib/notification-channels";
import { InfoTip } from "@/components/store/info-tip";
import { Disclosure } from "@/components/store/disclosure";

export const dynamic = "force-dynamic";
export const metadata = { title: "Message wording" };

/**
 * The words every alert sends — **edited here, switched on elsewhere.**
 *
 * Each template is one message, and each alert that uses it sends those words
 * on its channel (the subject becomes a phone alert's title and the bell
 * entry's headline). So every card says which events it is sent for, read off
 * the rules, and none of them offers a switch: whether an alert goes is
 * Settings → Alerts, the only screen that can change it.
 *
 * There is no "new template" and no delete. Every alert the store can send
 * ships with its own message, and no screen can point an alert at a different
 * one — a new template could never be sent, and a deleted one would silence
 * an alert without saying so.
 */
export default async function AutomationTemplates() {
  const templates = await prisma.emailTemplate
    .findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      include: {
        rules: {
          select: { trigger: true, conditions: true, recipient: true, action: true, isActive: true },
        },
      },
    })
    .catch(() => []);

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <Link
          href="/admin/automation"
          className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Automation
        </Link>
        <h1 className="flex items-center gap-1 font-serif text-2xl">
          Message wording
          <InfoTip term="Message wording">
            The words each alert sends. One message serves every channel an alert goes
            out on, so there is one place to change a sentence. Switching an alert on or
            off is on Settings → Alerts.
          </InfoTip>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {templates.length} message{templates.length === 1 ? "" : "s"}. Tap one to change its words.
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <p className="font-serif text-lg">No messages yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            They are added with the alerts that use them —{" "}
            <Link href="/admin/settings?tab=alerts" className="text-accent underline-offset-2 hover:underline">
              Settings → Alerts
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {templates.map((t) => {
            // One line per event the words are sent for, with its channels.
            const events = new Map<string, { label: string; channels: string[]; live: boolean }>();
            for (const r of t.rules) {
              const conditions = readConditions(r.conditions);
              const key = eventKeyOf(r.trigger, conditions, r.recipient);
              const entry = events.get(key) ?? {
                label: `${eventLabel(
                  r.trigger,
                  conditions,
                  composeFallbackLabel(triggerLabel(r.trigger), describeConditions(r.trigger, conditions))
                )} · ${recipientGroupLabel(r.recipient).toLowerCase()}`,
                channels: [],
                live: false,
              };
              entry.channels.push(channelShort(r.action));
              entry.live ||= r.isActive;
              events.set(key, entry);
            }
            const live = [...events.values()].some((e) => e.live);
            return (
              <li key={t.id} className="min-w-0">
                <Link
                  href={`/admin/automation/templates/${t.id}/edit`}
                  className="flex min-w-0 items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="break-words">{t.name}</span>
                      {t.isSystem && (
                        <Lock className="h-3 w-3 text-muted-foreground" aria-label="Ships with the store" />
                      )}
                      <span
                        className={
                          live
                            ? "rounded-md bg-success/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-success"
                            : "rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                        }
                      >
                        {live ? "Being sent" : "Not sent"}
                      </span>
                    </p>
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">{t.subject}</p>
                    {events.size > 0 && (
                      <p className="mt-1 break-words text-[11px] text-muted-foreground">
                        {[...events.values()]
                          .map((e) => `${e.label} (${e.channels.join(", ")})`)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <Pencil className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* The token reference, folded — looked up while writing, not read. */}
      <section className="min-w-0 rounded-2xl border border-border bg-card px-4 py-1 sm:px-5">
        <Disclosure label="What each event can fill in" summary={`${TRIGGERS.length} events`}>
          <p className="mb-3 text-xs text-muted-foreground">
            A <code className="font-mono">{"{{token}}"}</code> is replaced with the real value
            when the message goes. One the event does not provide is sent as nothing.
          </p>
          <div className="space-y-3">
            {TRIGGERS.map((trigger) => (
              <div key={trigger.key} className="min-w-0 border-t border-border pt-3 first:border-t-0 first:pt-0">
                <p className="text-xs font-medium">{trigger.label}</p>
                <ul className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  {trigger.tokens.map((token) => (
                    <li key={token.token} className="min-w-0 text-[11px]">
                      <code className="break-all font-mono text-accent">{`{{${token.token}}}`}</code>
                      <span className="ml-1.5 text-muted-foreground">{token.describes}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Disclosure>
      </section>
    </div>
  );
}
