"use client";

/**
 * The rule editor.
 *
 * A rule is one sentence — **when TRIGGER happens, and CONDITIONS match, after
 * DELAY, do ACTION** — so the form is built as that sentence rather than as a
 * list of columns. The live readout at the top is that sentence assembled from
 * whatever is currently selected, in the same words the rules list prints, so
 * an owner can check what they have built without knowing what a "condition"
 * is.
 *
 * ## Why the whole catalogue arrives as a prop
 *
 * The triggers, their condition fields and their tokens all live in
 * `@/lib/automation`, which is `server-only` — it imports Prisma and Resend.
 * A client component that imported it would drag both into the browser bundle,
 * and the `server-only` guard would throw first. So the server page reads the
 * catalogue and passes it down as plain data. That is also why the types below
 * are declared structurally here instead of imported: they describe the wire
 * shape, and nothing is erased at runtime that could surprise anybody.
 *
 * The one thing that would bite here is the **RSC icon trap** CLAUDE.md
 * records: this file draws its own Lucide icons rather than receiving any as
 * props, so there is no function crossing the boundary.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, Clock, Mail, Zap } from "lucide-react";
import { Card, Field, Segmented, SwitchRow } from "@/components/admin/form-kit";
import { DELAY_PRESETS, delaySummary } from "@/components/admin/automation-summary";
import {
  createAutomationRule,
  updateAutomationRule,
} from "@/app/actions/automation";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  The wire shape                                                     */
/* ------------------------------------------------------------------ */

export type ConditionFieldDTO = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};

export type TriggerOptionDTO = {
  key: string;
  label: string;
  blurb: string;
  firesFrom: string;
  conditions: ConditionFieldDTO[];
  tokens: { token: string; describes: string }[];
};

export type TemplateOptionDTO = { id: string; name: string; subject: string };

export type RuleInitial = {
  id?: string;
  name: string;
  trigger: string;
  conditions: Record<string, string>;
  templateId: string;
  recipient: string;
  delayMinutes: number;
  isActive: boolean;
};

type RecipientMode = "customer" | "admin" | "other";

export function AutomationRuleForm({
  triggers,
  templates,
  initial,
}: {
  triggers: TriggerOptionDTO[];
  templates: TemplateOptionDTO[];
  initial?: RuleInitial;
}) {
  const router = useRouter();
  const ruleId = initial?.id;

  const [name, setName] = useState(initial?.name ?? "");
  const [trigger, setTrigger] = useState(initial?.trigger ?? triggers[0]?.key ?? "");
  const [conditions, setConditions] = useState<Record<string, string>>(
    initial?.conditions ?? {}
  );
  const [templateId, setTemplateId] = useState(initial?.templateId ?? "");
  const [delayMinutes, setDelayMinutes] = useState(initial?.delayMinutes ?? 0);
  const [customDelay, setCustomDelay] = useState(
    initial && !DELAY_PRESETS.some((p) => p.value === initial.delayMinutes)
  );
  const [recipientMode, setRecipientMode] = useState<RecipientMode>(
    initial?.recipient === "admin"
      ? "admin"
      : !initial || initial.recipient === "customer"
        ? "customer"
        : "other"
  );
  const [otherEmail, setOtherEmail] = useState(
    initial && initial.recipient !== "customer" && initial.recipient !== "admin"
      ? initial.recipient
      : ""
  );
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spec = useMemo(
    () => triggers.find((t) => t.key === trigger) ?? triggers[0],
    [triggers, trigger]
  );

  const recipient =
    recipientMode === "other" ? otherEmail.trim() : recipientMode;

  /**
   * Switching trigger drops conditions that the new trigger does not declare.
   * Carrying them over would leave a `status` key on a trigger that never sets
   * a status fact — a rule that reads as narrowed and matches nothing, which
   * is the worst of both.
   */
  function pickTrigger(next: string) {
    const nextSpec = triggers.find((t) => t.key === next);
    setTrigger(next);
    setConditions((prev) => {
      const kept: Record<string, string> = {};
      for (const field of nextSpec?.conditions ?? []) {
        const carried = prev[field.key];
        if (carried && field.options.some((o) => o.value === carried)) {
          kept[field.key] = carried;
        }
      }
      return kept;
    });
  }

  const conditionSummary = useMemo(() => {
    const parts: string[] = [];
    for (const field of spec?.conditions ?? []) {
      const value = conditions[field.key];
      if (!value) continue;
      parts.push(
        field.options.find((o) => o.value === value)?.label ?? value
      );
    }
    return parts.length ? parts.join(" · ") : "";
  }, [spec, conditions]);

  const template = templates.find((t) => t.id === templateId);

  /** The rule as one sentence — the only readout that matters on this screen. */
  const sentence = useMemo(() => {
    const who =
      recipientMode === "customer"
        ? "the customer"
        : recipientMode === "admin"
          ? "you"
          : otherEmail.trim() || "…";
    const when = conditionSummary
      ? `${spec?.label ?? "…"} — ${conditionSummary}`
      : (spec?.label ?? "…");
    const delay =
      delayMinutes > 0 ? ` ${delaySummary(delayMinutes).toLowerCase()},` : "";
    return `When ${when.charAt(0).toLowerCase()}${when.slice(1)},${delay} email ${who}${template ? ` the "${template.name}" template` : ""}.`;
  }, [spec, conditionSummary, delayMinutes, recipientMode, otherEmail, template]);

  const missingTemplate = isActive && !templateId;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData();
    fd.append("name", name);
    fd.append("trigger", trigger);
    fd.append("action", "email");
    fd.append("templateId", templateId);
    fd.append("recipient", recipient);
    fd.append("delayMinutes", String(delayMinutes));
    fd.append("isActive", String(isActive));
    // Only the keys this trigger declares are sent; the action rebuilds the
    // JSON from the catalogue again on the server, so this is convenience, not
    // trust.
    for (const field of spec?.conditions ?? []) {
      fd.append(`condition.${field.key}`, conditions[field.key] ?? "");
    }

    const res = ruleId
      ? await updateAutomationRule(ruleId, fd)
      : await createAutomationRule(fd);
    setSaving(false);

    if (res.success) {
      router.push("/admin/automation");
      router.refresh();
    } else {
      setError(res.error ?? "Couldn't save the rule.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="min-w-0 max-w-3xl space-y-4">
      {/* ---- The rule, in one sentence ---- */}
      <div
        className={cn(
          "min-w-0 rounded-2xl border p-4 sm:p-5",
          isActive ? "border-accent/40 bg-accent/5" : "border-border bg-muted/30"
        )}
      >
        <p className="eyebrow text-muted-foreground">
          {isActive ? "This rule will" : "Paused — this rule would"}
        </p>
        <p className="mt-2 break-words font-serif text-lg leading-snug">{sentence}</p>
        {delayMinutes > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            A delayed rule is queued and sent by the scheduled job, not at the
            moment it triggers.
          </p>
        )}
      </div>

      {/* ---- What sets it off ---- */}
      <Card
        title="When"
        tip="The event that sets the rule off. Each trigger has to be called from somewhere in the store's code — the line under each one says where."
      >
        <Field label="Trigger" required>
          {(id) => (
            <select
              id={id}
              value={trigger}
              onChange={(e) => pickTrigger(e.target.value)}
              className="input"
            >
              {triggers.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        {spec && (
          <p className="mt-2 text-sm text-muted-foreground">{spec.blurb}</p>
        )}

        {(spec?.conditions.length ?? 0) > 0 && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <p className="eyebrow text-muted-foreground">Only when</p>
            {spec?.conditions.map((field) => (
              <Field key={field.key} label={field.label}>
                {(id) => (
                  <select
                    id={id}
                    value={conditions[field.key] ?? ""}
                    onChange={(e) =>
                      setConditions((prev) => ({
                        ...prev,
                        [field.key]: e.target.value,
                      }))
                    }
                    className="input"
                  >
                    {field.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ))}
          </div>
        )}
      </Card>

      {/* ---- How long to wait ---- */}
      <Card
        title="Wait"
        tip="Zero sends the moment the trigger fires. Anything else queues the message, and the scheduled job sends it when its time comes — which is the only way a delay can survive on a serverless host."
        aside={
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {delaySummary(delayMinutes)}
          </span>
        }
      >
        <Segmented
          ariaLabel="Delay"
          value={customDelay ? "custom" : String(delayMinutes)}
          onChange={(v) => {
            if (v === "custom") {
              setCustomDelay(true);
            } else {
              setCustomDelay(false);
              setDelayMinutes(Number(v));
            }
          }}
          options={[
            ...DELAY_PRESETS.map((p) => ({
              value: String(p.value),
              label: p.label,
            })),
            { value: "custom", label: "Custom" },
          ]}
        />
        {customDelay && (
          <div className="mt-3">
            <Field label="Minutes" hint="Up to 30 days (43,200 minutes).">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={43200}
                  step={1}
                  value={delayMinutes}
                  onChange={(e) => setDelayMinutes(Number(e.target.value) || 0)}
                  className="input"
                />
              )}
            </Field>
          </div>
        )}
      </Card>

      {/* ---- What it does ---- */}
      <Card
        title="Then"
        tip="Email is the only action this build can carry out. The column behind it is deliberately open, so another channel can be added later without a migration."
        aside={
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5" />
            Send an email
          </span>
        }
      >
        <Field
          label="Template"
          required
          hint={
            <>
              Write and edit templates in{" "}
              <Link
                href="/admin/automation/templates"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Email templates
              </Link>
              .
            </>
          }
        >
          {(id) => (
            <select
              id={id}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="input"
            >
              <option value="">Choose a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        {template && (
          <p className="mt-2 break-words text-sm text-muted-foreground">
            Subject: <span className="text-foreground">{template.subject}</span>
          </p>
        )}

        <div className="mt-4 border-t border-border pt-4">
          <Field label="Send it to">
            <Segmented
              ariaLabel="Recipient"
              value={recipientMode}
              onChange={(v) => setRecipientMode(v)}
              options={[
                { value: "customer", label: "The customer" },
                { value: "admin", label: "You (admin)" },
                { value: "other", label: "Someone else" },
              ]}
            />
          </Field>
          {recipientMode === "other" && (
            <div className="mt-3">
              <Field label="Email address">
                {(id) => (
                  <input
                    id={id}
                    type="email"
                    value={otherEmail}
                    onChange={(e) => setOtherEmail(e.target.value)}
                    placeholder="warehouse@example.com"
                    className="input"
                  />
                )}
              </Field>
            </div>
          )}
          {recipientMode === "customer" && spec?.key === "cart.abandoned" && (
            <p className="mt-2 text-xs text-muted-foreground">
              A guest cart lead often has no email on it. Those jobs are skipped
              with a reason rather than failed.
            </p>
          )}
        </div>
      </Card>

      {/* ---- Name and switch ---- */}
      <Card title="This rule">
        <Field label="Name" required hint="What you'll see in the list.">
          {(id) => (
            <input
              id={id}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nudge abandoned carts after a day"
              maxLength={80}
              className="input"
            />
          )}
        </Field>
        <div className="mt-4">
          <SwitchRow
            label="Rule is on"
            detail={
              isActive
                ? "It will run the next time its trigger fires."
                : "Saved, but nothing will happen until you switch it on."
            }
            checked={isActive}
            onChange={setIsActive}
          />
        </div>
      </Card>

      {/* ---- Where it has to be called from ---- */}
      {spec && (
        <div className="min-w-0 rounded-2xl border border-border bg-muted/30 p-4 sm:p-5">
          <p className="eyebrow flex items-center gap-1.5 text-muted-foreground">
            <Zap className="h-3.5 w-3.5" />
            Where this fires
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="text-foreground">{spec.label}</span> is raised from{" "}
            {spec.firesFrom}. A rule can only run once that call is wired in —
            until then it sits here doing nothing, which is a configuration
            state, not a fault.
          </p>
        </div>
      )}

      {/* ---- Tokens this trigger offers ---- */}
      {spec && (
        <div className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <p className="eyebrow text-muted-foreground">
            Tokens available to this trigger
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Any template used by this rule can use these. A token this trigger
            does not offer renders as nothing.
          </p>
          <ul className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {spec.tokens.map((t) => (
              <li key={t.token} className="min-w-0 text-xs">
                <code className="break-all font-mono text-accent">{`{{${t.token}}}`}</code>
                <span className="ml-1.5 text-muted-foreground">{t.describes}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(error || missingTemplate) && (
        <p className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {error ??
              "Choose an email template, or switch the rule off before saving."}
          </span>
        </p>
      )}

      {/* ---- Save ---- */}
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => router.push("/admin/automation")}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border px-5 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || missingTemplate || !name.trim()}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-foreground px-6 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : ruleId ? "Save changes" : "Create rule"}
        </button>
      </div>
    </form>
  );
}
