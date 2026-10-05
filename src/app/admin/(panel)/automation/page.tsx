import Link from "next/link";
import { ArrowUpRight, Lock } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  IMPLEMENTED_ACTIONS,
  SYSTEM_RULES,
  describeConditions,
  jobBacklog,
  readConditions,
  triggerLabel,
} from "@/lib/automation";
import { emailHealth } from "@/lib/email";
import {
  CONFIRM_MODE_LABEL,
  DISPATCH_MODE_DETAIL,
  DISPATCH_MODE_LABEL,
  courierChoiceLabel,
  dispatchModeOf,
  normalisePipelineSettings,
} from "@/lib/orders-pipeline";
import { smsGateway } from "@/lib/otp";
import {
  ALWAYS_SENT,
  SMS_UNAVAILABLE,
  buildNotificationMatrix,
  composeFallbackLabel,
  orderedChannels,
  whatsappGateway,
  type ChannelFact,
  type RuleRow,
} from "@/lib/notification-channels";
import { InfoTip } from "@/components/store/info-tip";
import { Disclosure } from "@/components/store/disclosure";
import { DeliveryHealth, type QueueOutcome } from "@/components/admin/automation-health";
import {
  DeliveryHistory,
  type HistoryFilter,
  type JobRow,
} from "@/components/admin/automation-queue";
import { NotificationPostureStrip } from "@/components/admin/notification-matrix";

export const dynamic = "force-dynamic";
export const metadata = { title: "Automation" };

const PAGE = 20;
const FILTER_KEYS: HistoryFilter[] = ["all", "failed", "pending", "sent", "cancelled"];

/** "the customer" / "you" — how a history row names who it went to. */
function toWord(recipient: string): string {
  if (recipient === "customer") return "the customer";
  if (recipient === "admin") return "you";
  return recipient;
}

function isFilter(v: string | undefined): v is HistoryFilter {
  return FILTER_KEYS.includes(v as HistoryFilter);
}

/**
 * Admin → Automation — **what the store did on its own, and what happened to
 * each message.**
 *
 * It no longer switches anything. Whether an alert is on is decided on
 * Settings → Alerts and nowhere else; this screen used to carry a second
 * editor for the same rows (create, pause, delete, edit), and two editors for
 * one switch is how one event came to send two emails. So, in order of what
 * the owner comes here for:
 *
 * 1. **Can mail leave at all** — one line, with the evidence folded.
 * 2. **Delivery history** — every job, filterable, with the engine's own
 *    reason for each failure or skip. The debugging surface.
 * 3. **What is switched on** — read-only, counted from the same rows the grid
 *    draws, with one link to the grid. Never a control here.
 * 4. **Message wording** — the one thing still edited from here: the words.
 * 5. **Also automatic** — the order pipeline, the mail no switch can stop, and
 *   the schedule — folded, because they are looked up, not worked in.
 */
export default async function AdminAutomation({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const filter: HistoryFilter = isFilter(sp.status) ? sp.status : "all";
  const limit = Math.min(200, Math.max(PAGE, Number.parseInt(sp.limit ?? "", 10) || PAGE));

  const [rules, settingsRow, backlog, jobs, groups, templateCount, lastSentJob, lastFailedJob] =
    await Promise.all([
      prisma.automationRule
        .findMany({
          select: {
            id: true,
            name: true,
            trigger: true,
            conditions: true,
            action: true,
            recipient: true,
            delayMinutes: true,
            isActive: true,
            templateId: true,
          },
        })
        .catch(() => []),
      prisma.siteSettings.findFirst().catch(() => null),
      jobBacklog().catch(() => ({ pending: 0, due: 0 })),
      prisma.automationJob
        .findMany({
          where: filter === "all" ? {} : { status: filter },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          select: {
            id: true,
            status: true,
            runAt: true,
            sentAt: true,
            error: true,
            subjectType: true,
            payload: true,
            rule: { select: { name: true, action: true, recipient: true } },
          },
        })
        .catch(() => []),
      prisma.automationJob
        .groupBy({ by: ["status"], _count: { _all: true } })
        .catch(() => [] as { status: string; _count: { _all: number } }[]),
      prisma.emailTemplate.count().catch(() => 0),
      prisma.automationJob
        .findFirst({
          where: { status: "sent" },
          orderBy: { sentAt: "desc" },
          select: { sentAt: true, rule: { select: { name: true } } },
        })
        .catch(() => null),
      prisma.automationJob
        .findFirst({
          where: { status: "failed" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, error: true, rule: { select: { name: true } } },
        })
        .catch(() => null),
    ]);

  /* ---- Who each job was about, resolved in one query per kind ---- */
  const visible = jobs.slice(0, limit);
  const idsOf = (type: string) =>
    visible
      .filter((j) => j.subjectType === type)
      .map((j) => String((j.payload as { entityId?: unknown } | null)?.entityId ?? ""))
      .filter(Boolean);
  const [orders, returns, threads, leads, variants] = await Promise.all([
    prisma.order
      .findMany({
        where: { id: { in: idsOf("order") } },
        select: { id: true, orderNumber: true, customerName: true },
      })
      .catch(() => []),
    prisma.returnRequest
      .findMany({ where: { id: { in: idsOf("return") } }, select: { id: true, requestNumber: true } })
      .catch(() => []),
    prisma.chatThread
      .findMany({
        where: { id: { in: idsOf("chat") } },
        select: { id: true, name: true, email: true, user: { select: { name: true } } },
      })
      .catch(() => []),
    prisma.lead
      .findMany({ where: { id: { in: idsOf("lead") } }, select: { id: true, productName: true } })
      .catch(() => []),
    prisma.productVariant
      .findMany({
        where: { id: { in: idsOf("variant") } },
        select: { id: true, sku: true, product: { select: { name: true } } },
      })
      .catch(() => []),
  ]);
  const labelFor = new Map<string, string>([
    ...orders.map((o) => [o.id, `Order ${o.orderNumber} · ${o.customerName}`] as const),
    ...returns.map((r) => [r.id, `Return ${r.requestNumber}`] as const),
    ...threads.map(
      (t) => [t.id, `Chat · ${t.name || t.user?.name || t.email || "a visitor"}`] as const
    ),
    ...leads.map((l) => [l.id, `Cart · ${l.productName}`] as const),
    ...variants.map((v) => [v.id, `Stock · ${v.product.name} (${v.sku})`] as const),
  ]);

  const jobRows: JobRow[] = visible.map((j) => {
    const entityId = String((j.payload as { entityId?: unknown } | null)?.entityId ?? "");
    return {
      id: j.id,
      ruleName: j.rule.name,
      channel: j.rule.action,
      to: toWord(j.rule.recipient),
      about: labelFor.get(entityId) ?? `${j.subjectType} (no longer exists)`,
      status: j.status,
      runAt: j.runAt.toISOString(),
      sentAt: j.sentAt?.toISOString() ?? null,
      note: j.error,
    };
  });

  const counts = Object.fromEntries(FILTER_KEYS.map((k) => [k, 0])) as Record<HistoryFilter, number>;
  for (const g of groups) {
    if (isFilter(g.status)) counts[g.status] = g._count._all;
    counts.all += g._count._all;
  }

  /* ---- What is switched on: the grid's own numbers, read-only here ---- */
  const channels: ChannelFact[] = orderedChannels([
    ...IMPLEMENTED_ACTIONS,
    ...rules.map((r) => r.action),
  ]).map((key) => ({
    channel: key,
    supported: (IMPLEMENTED_ACTIONS as readonly string[]).includes(key),
    healthy: true,
    detail: key === "sms" ? SMS_UNAVAILABLE : key === "whatsapp" ? whatsappGateway().detail : "",
  }));
  const ruleRows: RuleRow[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    trigger: r.trigger,
    conditions: readConditions(r.conditions),
    action: r.action,
    recipient: r.recipient,
    delayMinutes: r.delayMinutes,
    isActive: r.isActive,
    hasTemplate: r.templateId !== null,
  }));
  const matrix = buildNotificationMatrix({
    catalogue: SYSTEM_RULES,
    rules: ruleRows,
    facts: channels,
    labelFor: (trigger, conditions) =>
      composeFallbackLabel(triggerLabel(trigger), describeConditions(trigger, conditions)),
  });

  const health = emailHealth();
  const queueOutcome: QueueOutcome = {
    lastSentAt: lastSentJob?.sentAt?.toISOString() ?? null,
    lastSentRule: lastSentJob?.rule.name ?? null,
    lastFailedAt: lastFailedJob?.createdAt.toISOString() ?? null,
    lastFailedRule: lastFailedJob?.rule.name ?? null,
    lastFailedError: lastFailedJob?.error ?? null,
    failedCount: counts.failed,
  };

  const pipeline = normalisePipelineSettings(settingsRow);
  const dispatch = dispatchModeOf(pipeline);
  const smsReady = smsGateway().ready;

  return (
    <div className="min-w-0 space-y-8">
      {/* ---------------- Header ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-1 font-serif text-2xl">
            Automation
            <InfoTip term="Automation">
              What your store sends on its own, and what happened to each message.
              Whether an alert goes at all is switched on Settings → Alerts — the one
              place it can be, so one event can never be set up twice. This screen
              is the record: every email, phone alert and bell entry, with the reason
              when one failed or was skipped.
            </InfoTip>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What was sent, what&rsquo;s waiting, and why anything didn&rsquo;t go.
          </p>
        </div>
        <Link
          href="/admin/automation/templates"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted"
        >
          Message wording
        </Link>
      </div>

      {/* ---------------- Can mail leave at all ---------------- */}
      <DeliveryHealth health={health} queue={queueOutcome} />

      {/* ---------------- What happened ---------------- */}
      <DeliveryHistory
        jobs={jobRows}
        counts={counts}
        filter={filter}
        hasMore={jobs.length > limit}
        nextLimit={limit + PAGE}
        due={backlog.due}
        pending={backlog.pending}
      />

      {/* ---------------- What is switched on — read-only ---------------- */}
      <NotificationPostureStrip
        byChannel={matrix.byChannel}
        channels={channels}
        total={Object.values(matrix.byChannel).reduce((a, b) => a + b, 0)}
      />

      {/* ---------------- The words ---------------- */}
      <section className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1 font-serif text-lg leading-none">
            Message wording
            <InfoTip term="Message wording">
              Each alert sends one message, and the same words serve every channel it
              goes out on — the subject becomes a phone alert&rsquo;s title and the
              bell entry&rsquo;s headline. Edit the words here; switch the alert on or
              off on Settings → Alerts.
            </InfoTip>
          </h2>
          <Link
            href="/admin/automation/templates"
            className="inline-flex min-h-11 items-center gap-1 text-[11px] font-medium uppercase tracking-widest text-accent transition-opacity hover:opacity-80"
          >
            Edit wording <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {templateCount} message{templateCount === 1 ? "" : "s"}, one per event.
        </p>
      </section>

      {/* ---------------- Also automatic — looked up, not worked in ---------------- */}
      <section className="min-w-0 rounded-2xl border border-border bg-card px-4 py-1 sm:px-5">
        <Disclosure label="The order pipeline" summary={CONFIRM_MODE_LABEL[pipeline.orderConfirmMode]}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="eyebrow text-muted-foreground">When an order is placed</dt>
              <dd className="mt-1 font-medium">{CONFIRM_MODE_LABEL[pipeline.orderConfirmMode]}</dd>
            </div>
            <div className="min-w-0">
              <dt className="eyebrow text-muted-foreground">When an order is confirmed</dt>
              <dd className="mt-1 font-medium">{DISPATCH_MODE_LABEL[dispatch]}</dd>
              <dd className="mt-0.5 text-xs text-muted-foreground">{DISPATCH_MODE_DETAIL[dispatch]}</dd>
            </div>
            {dispatch === "book" && (
              <div className="min-w-0">
                <dt className="eyebrow text-muted-foreground">Courier for an unattended booking</dt>
                <dd className="mt-1 font-medium">{courierChoiceLabel(pipeline.autoShipCourier)}</dd>
              </div>
            )}
          </dl>
          <Link
            href="/admin/settings?tab=orders"
            className="mt-2 inline-flex min-h-11 items-center gap-1 text-[11px] font-medium uppercase tracking-widest text-accent transition-opacity hover:opacity-80"
          >
            Change in Settings → Orders <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </Disclosure>

        <div className="border-t border-border">
          <Disclosure label="Always sent" summary={`${ALWAYS_SENT.length} · can't be switched off`}>
            <ul className="space-y-1.5 text-sm">
              {ALWAYS_SENT.map((mail) => (
                <li key={mail.key} className="flex min-w-0 items-start gap-2">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0">
                    <span className="font-medium">{mail.name}</span>
                    <span className="text-muted-foreground"> → {mail.to.toLowerCase()} · {mail.when.toLowerCase()}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href="/admin/settings?tab=alerts"
              className="mt-2 inline-flex min-h-11 items-center gap-1 text-[11px] font-medium uppercase tracking-widest text-accent transition-opacity hover:opacity-80"
            >
              Listed in Settings → Alerts <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Disclosure>
        </div>

        <div className="border-t border-border">
          <Disclosure label="Schedule" summary="cron-job.org · every 15–60 min">
            <ul className="divide-y divide-border text-sm">
              {[
                {
                  name: "Automation pass",
                  when: "Every 15–30 minutes",
                  what: "Sends every delayed message that is due, notices returns the courier moved, and checks tracked sizes against their low-stock line.",
                },
                {
                  name: "Sync with NimbusPost",
                  when: "Every 30–60 minutes",
                  what: "Pulls AWBs and courier scans back for orders and return pickups.",
                },
                {
                  name: "Purge unused media",
                  when: "Weekly",
                  what: "Clears uploaded photos nothing points at any more.",
                },
              ].map((job) => (
                <li
                  key={job.name}
                  className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{job.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{job.what}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{job.when}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Called from cron-job.org, not from this app, with{" "}
              <code className="font-mono">CRON_SECRET</code> — if that is unset every
              call is refused and nothing runs.
              {!smsReady && " SMS and WhatsApp have no gateway, so nothing is ever sent on them."}
            </p>
          </Disclosure>
        </div>
      </section>
    </div>
  );
}
