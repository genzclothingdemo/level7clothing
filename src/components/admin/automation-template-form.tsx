"use client";

/**
 * The email template editor.
 *
 * ## Why the preview is not optional
 *
 * A template is written once and then sent, unattended, to customers — so the
 * gap between "what I typed" and "what they get" has to close *here*, on this
 * screen, or it closes in somebody's inbox. Three things are shown live:
 *
 * 1. **The rendered text**, with `{{tokens}}` filled in from sample data using
 *    the same `renderTemplate` the engine uses. Not a lookalike: the same
 *    function, so a token that renders blank here renders blank in the email.
 * 2. **Unknown tokens, named.** `renderTemplate` deliberately renders an
 *    unrecognised token as *nothing* — a customer reading "your order  has
 *    shipped" is better served than one reading `{{order.numbr}}`. But a silent
 *    blank is also how a typo ships, so every token the body uses that no
 *    trigger offers is listed as a warning. It never blocks saving: a token
 *    could be legitimate in a build where a trigger was added later.
 * 3. **Subject length**, because an inbox truncates around 60 characters and
 *    nothing else on this screen would ever tell you.
 *
 * The body is plain text on purpose. `sendAutomationEmail` escapes it and wraps
 * it in the store's existing email shell, so no template — however it is
 * edited, and whatever a customer's name contains — can inject markup into an
 * outgoing email.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Lock } from "lucide-react";
import { Card, Field } from "@/components/admin/form-kit";
import {
  createEmailTemplate,
  updateEmailTemplate,
} from "@/app/actions/automation";

export type TokenGroupDTO = {
  label: string;
  tokens: { token: string; describes: string }[];
};

export type TemplateInitial = {
  id?: string;
  name: string;
  subject: string;
  body: string;
  isSystem: boolean;
};

/**
 * A local copy of the engine's substitution.
 *
 * It has to behave identically to `renderTemplate` in `lib/automation.ts`, and
 * it cannot import it: that module is `server-only` because it pulls in Prisma
 * and Resend. The regex and the "unknown renders empty" rule are the whole
 * contract, and they are restated here in four lines rather than dragging a
 * database client into the browser bundle to share them.
 */
function renderPreview(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : ""
  );
}

function tokensUsed(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) found.add(m[1]);
  return [...found];
}

export function AutomationTemplateForm({
  groups,
  sample,
  initial,
}: {
  groups: TokenGroupDTO[];
  sample: Record<string, string>;
  initial?: TemplateInitial;
}) {
  const router = useRouter();
  const templateId = initial?.id;

  const [name, setName] = useState(initial?.name ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewSubject = useMemo(
    () => renderPreview(subject, sample),
    [subject, sample]
  );
  const previewBody = useMemo(() => renderPreview(body, sample), [body, sample]);

  /** Tokens the body or subject uses that nothing in the catalogue provides. */
  const unknown = useMemo(() => {
    const known = new Set(Object.keys(sample));
    return [...new Set([...tokensUsed(subject), ...tokensUsed(body)])].filter(
      (t) => !known.has(t)
    );
  }, [subject, body, sample]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData();
    fd.append("name", name);
    fd.append("subject", subject);
    fd.append("body", body);

    const res = templateId
      ? await updateEmailTemplate(templateId, fd)
      : await createEmailTemplate(fd);
    setSaving(false);

    if (res.success) {
      router.push("/admin/automation/templates");
      router.refresh();
    } else {
      setError(res.error ?? "Couldn't save the template.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="min-w-0 max-w-3xl space-y-4">
      {initial?.isSystem && (
        <div className="flex items-start gap-2 rounded-2xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This is one of the templates the store ships with. Every word of it
            is yours to change — it just can&apos;t be deleted, because a rule
            expects it to exist.
          </span>
        </div>
      )}

      <Card title="The email">
        <Field label="Template name" required hint="What you'll pick from a rule.">
          {(id) => (
            <input
              id={id}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Abandoned cart nudge"
              maxLength={80}
              className="input"
            />
          )}
        </Field>

        <div className="mt-4">
          <Field
            label="Subject"
            required
            hint={
              subject.length > 60
                ? `${subject.length} characters — most inboxes cut off around 60.`
                : "Tokens work here too."
            }
          >
            {(id) => (
              <input
                id={id}
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Still thinking about {{cart.productName}}?"
                maxLength={160}
                className="input"
              />
            )}
          </Field>
        </div>

        <div className="mt-4">
          <Field
            label="Message"
            required
            tip="Plain text. Leave a blank line between paragraphs. It is escaped and wrapped in your store's email design when it sends, so you never have to write HTML — and nothing typed here can break the layout."
          >
            {(id) => (
              <textarea
                id={id}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                placeholder={"Hi {{customer.firstName}},\n\nYou left {{cart.productName}} in your cart.\n\n{{store.name}}"}
                maxLength={8000}
                className="input h-auto py-2.5 font-mono text-xs leading-relaxed"
              />
            )}
          </Field>
        </div>
      </Card>

      {/* ---- What the customer gets ---- */}
      <Card
        title="Preview"
        tip="Rendered with sample data using the same substitution the engine uses. A token that comes out blank here will be blank in the real email."
      >
        <div className="min-w-0 rounded-lg border border-border bg-muted/30 p-4">
          <p className="eyebrow text-muted-foreground">Subject</p>
          <p className="mt-1 break-words font-medium">
            {previewSubject || (
              <span className="text-muted-foreground">(nothing yet)</span>
            )}
          </p>
          <div className="mt-4 border-t border-border pt-4">
            <p className="eyebrow text-muted-foreground">Message</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
              {previewBody || (
                <span className="text-muted-foreground">(nothing yet)</span>
              )}
            </p>
          </div>
        </div>

        {unknown.length > 0 && (
          // `text-accent`, not a warning colour: this design system has no
          // `--warning` token, and an unknown Tailwind class is silently nothing.
          <p className="mt-3 flex items-start gap-2 text-sm text-accent">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              No trigger provides{" "}
              {unknown.map((t, i) => (
                <span key={t}>
                  {i > 0 && ", "}
                  <code className="font-mono">{`{{${t}}}`}</code>
                </span>
              ))}
              . {unknown.length === 1 ? "It" : "They"} will send as nothing —
              check the spelling against the list below.
            </span>
          </p>
        )}
      </Card>

      {/* ---- The token reference ---- */}
      <div className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <p className="eyebrow text-muted-foreground">Tokens you can use</p>
        <p className="mt-1 text-sm text-muted-foreground">
          A template can be used by any rule, so which of these actually have a
          value depends on the trigger the rule uses. Anything the trigger
          doesn&apos;t provide sends as nothing.
        </p>
        <div className="mt-4 space-y-4">
          {groups.map((group) => (
            <div key={group.label} className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-foreground">
                {group.label}
              </p>
              <ul className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                {group.tokens.map((t) => (
                  <li key={t.token} className="min-w-0 text-xs">
                    <code className="break-all font-mono text-accent">{`{{${t.token}}}`}</code>
                    <span className="ml-1.5 text-muted-foreground">
                      {t.describes}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => router.push("/admin/automation/templates")}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border px-5 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !name.trim() || !subject.trim() || !body.trim()}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-foreground px-6 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : templateId ? "Save changes" : "Create template"}
        </button>
      </div>
    </form>
  );
}
