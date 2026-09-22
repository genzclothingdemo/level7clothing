import Link from "next/link";
import { ChevronLeft, Lock, Mail, Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { TRIGGERS } from "@/lib/automation";
import { AutomationTemplateActions } from "@/components/admin/automation-template-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email templates" };

/**
 * The template list.
 *
 * The trigger/token table is printed **here as well as beside each editor**,
 * because a template is not bound to a trigger — it is chosen by a rule, and
 * the same template can be used by rules with different triggers. So "which
 * tokens can I use?" has no single answer at the template level, and the honest
 * form of the answer is this table: what each trigger provides, so the writer
 * can see what their template will and will not have.
 */
export default async function AutomationTemplates() {
  const templates = await prisma.emailTemplate
    .findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      include: { _count: { select: { rules: true } } },
    })
    .catch(() => []);

  return (
    <div className="min-w-0 space-y-8">
      <div>
        <Link
          href="/admin/automation"
          className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Automation
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-serif text-2xl">Email templates</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              The words your rules send. {templates.length} template
              {templates.length === 1 ? "" : "s"}.
            </p>
          </div>
          <Link
            href="/admin/automation/templates/new"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-foreground px-5 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Add template
          </Link>
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center sm:p-12">
          <Mail className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-serif text-xl">No templates yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            A rule needs a template before it can send anything.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {templates.map((t) => (
            <li
              key={t.id}
              className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="break-words">{t.name}</span>
                    {t.isSystem && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <Lock className="h-3 w-3" /> Built in
                      </span>
                    )}
                  </p>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {t.subject}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t._count.rules === 0
                      ? "Not used by any rule yet"
                      : `Used by ${t._count.rules} rule${t._count.rules === 1 ? "" : "s"}`}
                  </p>
                </div>
                <AutomationTemplateActions
                  id={t.id}
                  name={t.name}
                  isSystem={t.isSystem}
                  usedBy={t._count.rules}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ---- Which trigger gives which tokens ---- */}
      <section className="min-w-0">
        <h2 className="font-serif text-xl">What each trigger gives you</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A template can be used by any rule, so the tokens that actually have a
          value depend on that rule&apos;s trigger. Anything else sends as
          nothing.
        </p>
        <div className="mt-4 space-y-3">
          {TRIGGERS.map((trigger) => (
            <div
              key={trigger.key}
              className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5"
            >
              <p className="font-medium">{trigger.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <code className="font-mono">{trigger.key}</code> · fires from{" "}
                {trigger.firesFrom}
              </p>
              <ul className="mt-3 grid gap-x-4 gap-y-1.5 border-t border-border pt-3 sm:grid-cols-2">
                {trigger.tokens.map((token) => (
                  <li key={token.token} className="min-w-0 text-xs">
                    <code className="break-all font-mono text-accent">{`{{${token.token}}}`}</code>
                    <span className="ml-1.5 text-muted-foreground">
                      {token.describes}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
