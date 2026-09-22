import Link from "next/link";
import { ArrowUpRight, Mail, Plus, Zap } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  describeConditions,
  jobBacklog,
  readConditions,
  recipientLabel,
  triggerLabel,
} from "@/lib/automation";
import {
  CONFIRM_MODE_LABEL,
  DISPATCH_MODE_DETAIL,
  DISPATCH_MODE_LABEL,
  courierChoiceLabel,
  dispatchModeOf,
  normalisePipelineSettings,
} from "@/lib/orders-pipeline";
import {
  RuleStatusPill,
  delaySummary,
  relativeTime,
} from "@/components/admin/automation-summary";
import { AutomationRowActions } from "@/components/admin/automation-row-actions";
import { AutomationQueue, type JobRow } from "@/components/admin/automation-queue";

export const dynamic = "force-dynamic";
export const metadata = { title: "Automation" };

/**
 * Admin → Automation.
 *
 * The screen answers one question — **what does this store do on its own?** —
 * and it is only a real answer if it lists *everything*, including the parts it
 * does not own. So the page has three registers, and the difference between
 * them is the point:
 *
 * 1. **Rules** — created, edited and paused here.
 * 2. **The order pipeline** — read-only, with a link. Those columns belong to
 *    Settings → Orders and stay there. CLAUDE.md records exactly what happens
 *    when a setting gets a second editable control: `defaultReturnsInfo` had
 *    two writers, and two tabs open meant a silent lost update with no error
 *    anywhere. Showing a value is not owning it; **never add an input here.**
 * 3. **Scheduled jobs** — the three Vercel crons, stated as facts. They are
 *    automation by any reading, and an owner hunting for "why did that happen
 *    at 2am" has nowhere else to look.
 */
export default async function AdminAutomation() {
  const [rules, settingsRow, backlog, jobs] = await Promise.all([
    prisma.automationRule
      .findMany({
        orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
        include: {
          template: { select: { name: true } },
          _count: { select: { jobs: { where: { status: "pending" } } } },
        },
      })
      .catch(() => []),
    prisma.siteSettings.findFirst().catch(() => null),
    jobBacklog().catch(() => ({ pending: 0, due: 0 })),
    prisma.automationJob
      .findMany({
        orderBy: [{ createdAt: "desc" }],
        take: 25,
        include: { rule: { select: { name: true } } },
      })
      .catch(() => []),
  ]);

  const pipeline = normalisePipelineSettings(settingsRow);
  const dispatch = dispatchModeOf(pipeline);
  const active = rules.filter((r) => r.isActive).length;

  const jobRows: JobRow[] = jobs.map((j) => ({
    id: j.id,
    ruleName: j.rule.name,
    status: j.status,
    runAt: j.runAt.toISOString(),
    sentAt: j.sentAt?.toISOString() ?? null,
    error: j.error,
    subjectType: j.subjectType,
    subjectId: j.subjectId,
  }));

  /** How a confirmation decision is currently made, in one line. */
  const confirmLine =
    pipeline.orderConfirmMode === "manual"
      ? "Nothing confirms itself — every order waits for you."
      : pipeline.orderConfirmMode === "auto"
        ? "Every order confirms itself."
        : [
            pipeline.autoConfirmPrepaid ? "prepaid" : null,
            pipeline.autoConfirmPartial ? "part-paid" : null,
            pipeline.autoConfirmCod ? "cash-on-delivery" : null,
          ].filter(Boolean).length === 0
          ? "By payment method — but no method is switched on, so nothing confirms itself."
          : `Confirms itself when the order is ${[
              pipeline.autoConfirmPrepaid ? "prepaid" : null,
              pipeline.autoConfirmPartial ? "part-paid" : null,
              pipeline.autoConfirmCod ? "cash-on-delivery" : null,
            ]
              .filter(Boolean)
              .join(", ")}.`;

  return (
    <div className="min-w-0 space-y-10">
      {/* ---------------- Header ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl">Automation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What your store does without you. {active} of {rules.length} rule
            {rules.length === 1 ? "" : "s"} switched on.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/admin/automation/templates"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted"
          >
            <Mail className="h-4 w-4" /> Email templates
          </Link>
          <Link
            href="/admin/automation/new"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-foreground px-5 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Add rule
          </Link>
        </div>
      </div>

      {/* ---------------- Rules ---------------- */}
      <section className="min-w-0">
        <h2 className="font-serif text-xl">Your rules</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          When something happens, and your conditions match, send an email.
        </p>

        {rules.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border p-10 text-center sm:p-12">
            <Zap className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-4 font-serif text-xl">No rules yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Nudge a cart someone left behind, or tell a customer their order is
              on its way — without opening your laptop.
            </p>
            <Link
              href="/admin/automation/new"
              className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-foreground px-5 text-[11px] font-medium uppercase tracking-widest text-background"
            >
              <Plus className="h-4 w-4" /> Add rule
            </Link>
          </div>
        ) : (
          <>
            {/* ---- Phone: one card per rule. ---- */}
            <ul className="mt-4 space-y-3 md:hidden">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className="min-w-0 rounded-2xl border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 break-words font-medium">{rule.name}</p>
                    <RuleStatusPill isActive={rule.isActive} />
                  </div>
                  <p className="mt-2 break-words text-sm text-muted-foreground">
                    When {triggerLabel(rule.trigger).toLowerCase()} ·{" "}
                    {describeConditions(rule.trigger, readConditions(rule.conditions))}
                  </p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 text-xs">
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Wait</dt>
                      <dd className="mt-0.5">{delaySummary(rule.delayMinutes)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Sends to</dt>
                      <dd className="mt-0.5 break-words">
                        {recipientLabel(rule.recipient)}
                      </dd>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <dt className="text-muted-foreground">Template</dt>
                      <dd className="mt-0.5 break-words">
                        {rule.template?.name ?? (
                          <span className="text-danger">None chosen</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-2 border-t border-border pt-1">
                    <AutomationRowActions
                      id={rule.id}
                      name={rule.name}
                      isActive={rule.isActive}
                      queued={rule._count.jobs}
                    />
                  </div>
                </li>
              ))}
            </ul>

            {/* ---- Laptop: the table. ---- */}
            <div className="mt-4 hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
              <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Rule</th>
                      <th className="px-4 py-3 font-medium">When</th>
                      <th className="px-4 py-3 font-medium">Wait</th>
                      <th className="px-4 py-3 font-medium">Sends</th>
                      <th className="px-4 py-3 font-medium">Ran</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rules.map((rule) => (
                      <tr key={rule.id} className="align-top hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <p className="max-w-[18rem] font-medium">{rule.name}</p>
                          {rule._count.jobs > 0 && (
                            <p className="mt-0.5 text-xs text-accent">
                              {rule._count.jobs} queued
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <p className="max-w-[16rem] text-foreground">
                            {triggerLabel(rule.trigger)}
                          </p>
                          <p className="mt-0.5 max-w-[16rem]">
                            {describeConditions(
                              rule.trigger,
                              readConditions(rule.conditions)
                            )}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                          {delaySummary(rule.delayMinutes)}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <p className="max-w-[14rem] break-words">
                            {rule.template?.name ?? (
                              <span className="text-danger">No template</span>
                            )}
                          </p>
                          <p className="mt-0.5">→ {recipientLabel(rule.recipient)}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                          {rule.runCount === 0
                            ? "Never"
                            : `${rule.runCount}× · ${relativeTime(rule.lastRunAt)}`}
                        </td>
                        <td className="px-4 py-3">
                          <RuleStatusPill isActive={rule.isActive} />
                        </td>
                        <td className="px-4 py-3">
                          <AutomationRowActions
                            id={rule.id}
                            name={rule.name}
                            isActive={rule.isActive}
                            queued={rule._count.jobs}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ---------------- The queue ---------------- */}
      <AutomationQueue jobs={jobRows} due={backlog.due} pending={backlog.pending} />

      {/* ---------------- Owned elsewhere ---------------- */}
      <section className="min-w-0">
        <h2 className="font-serif text-xl">Also running, set up elsewhere</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These are automatic too. They live on other screens and are shown here
          read-only, so this page is the whole picture.
        </p>

        <div className="mt-4 min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-serif text-lg">The order pipeline</h3>
            <Link
              href="/admin/settings?tab=orders"
              className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-widest text-accent transition-opacity hover:opacity-80"
            >
              Edit in Settings <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="eyebrow text-muted-foreground">
                When an order is placed
              </dt>
              <dd className="mt-1 text-sm">
                <span className="font-medium">
                  {CONFIRM_MODE_LABEL[pipeline.orderConfirmMode]}
                </span>
                <span className="mt-0.5 block text-muted-foreground">
                  {confirmLine}
                </span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="eyebrow text-muted-foreground">
                When an order is confirmed
              </dt>
              <dd className="mt-1 text-sm">
                <span className="font-medium">{DISPATCH_MODE_LABEL[dispatch]}</span>
                <span className="mt-0.5 block text-muted-foreground">
                  {DISPATCH_MODE_DETAIL[dispatch]}
                </span>
              </dd>
            </div>
            {dispatch === "book" && (
              <div className="min-w-0">
                <dt className="eyebrow text-muted-foreground">
                  Courier for an unattended booking
                </dt>
                <dd className="mt-1 text-sm font-medium">
                  {courierChoiceLabel(pipeline.autoShipCourier)}
                </dd>
              </div>
            )}
          </dl>

          <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
            Settings owns these. They are not editable here on purpose — one
            setting, one editor.
          </p>
        </div>

        {/* ---- The crons ---- */}
        <div className="mt-3 min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <h3 className="font-serif text-lg">Scheduled jobs</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Run by the host on a timer, defined in{" "}
            <code className="font-mono text-xs">vercel.json</code>. Changing a
            schedule is a code change, not a setting.
          </p>
          <ul className="mt-4 divide-y divide-border text-sm">
            {[
              {
                name: "Drain the automation queue",
                when: "Daily, 02:30",
                what: "Sends every delayed message whose time has come — the rules above.",
              },
              {
                name: "Sync with NimbusPost",
                when: "Daily, midnight",
                what: "Pulls AWBs and courier scans back for orders and return pickups.",
              },
              {
                name: "Purge unused media",
                when: "Weekly, Sunday midnight",
                what: "Clears uploaded photos nothing points at any more.",
              },
            ].map((job) => (
              <li
                key={job.name}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{job.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{job.what}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {job.when}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
