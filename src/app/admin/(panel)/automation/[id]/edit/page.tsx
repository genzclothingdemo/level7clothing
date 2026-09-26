import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  ACTIONS,
  SAMPLE_TOKENS,
  TRIGGERS,
  readConditions,
  renderTemplate,
} from "@/lib/automation";
import { pushCopyFrom, pushReach } from "@/lib/push-dispatch";
import {
  AutomationRuleForm,
  type ChannelOptionDTO,
  type RuleInitial,
  type TemplateOptionDTO,
  type TriggerOptionDTO,
} from "@/components/admin/automation-rule-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit automation rule" };

export default async function EditAutomationRulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [rule, rows, reach] = await Promise.all([
    prisma.automationRule.findUnique({ where: { id } }),
    prisma.emailTemplate
      .findMany({
        orderBy: [{ isSystem: "desc" }, { name: "asc" }],
        // `body` feeds the push preview only — see the note on the new-rule page.
        select: { id: true, name: true, subject: true, body: true },
      })
      .catch(() => []),
    pushReach().catch(() => ({
      configured: false,
      totalDevices: 0,
      reachableDevices: 0,
      adminEmail: "",
      adminDevices: 0,
    })),
  ]);

  if (!rule) notFound();

  const templates: TemplateOptionDTO[] = rows.map((t) => {
    const copy = pushCopyFrom(
      renderTemplate(t.subject, SAMPLE_TOKENS),
      renderTemplate(t.body, SAMPLE_TOKENS)
    );
    return {
      id: t.id,
      name: t.name,
      subject: t.subject,
      pushTitle: copy.title,
      pushBody: copy.body,
    };
  });

  const triggers: TriggerOptionDTO[] = TRIGGERS.map((t) => ({
    key: t.key,
    label: t.label,
    blurb: t.blurb,
    firesFrom: t.firesFrom,
    conditions: t.conditions,
    tokens: t.tokens,
  }));

  const channels: ChannelOptionDTO[] = ACTIONS.map((a) => ({
    key: a.key,
    label: a.label,
    short: a.short,
    verb: a.verb,
    caveat: a.caveat,
  }));

  // `conditions` is a `Json` column, so it is narrowed on the server rather
  // than cast in the form — the row could predate a trigger's condition list.
  const initial: RuleInitial = {
    id: rule.id,
    name: rule.name,
    trigger: rule.trigger,
    conditions: readConditions(rule.conditions),
    // `action` is a free string in the database. A row carrying a channel this
    // build cannot send falls back to the picker's first option rather than
    // rendering an empty control — and the save would be refused by the schema
    // anyway, which is where that rule belongs.
    action: rule.action,
    templateId: rule.templateId ?? "",
    recipient: rule.recipient,
    delayMinutes: rule.delayMinutes,
    isActive: rule.isActive,
  };

  return (
    <div className="min-w-0">
      <Link
        href="/admin/automation"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Automation
      </Link>
      <h1 className="mb-6 break-words font-serif text-2xl">Edit rule</h1>

      <AutomationRuleForm
        triggers={triggers}
        templates={templates}
        channels={channels}
        pushReach={reach}
        initial={initial}
      />
    </div>
  );
}
