import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { TRIGGERS, readConditions } from "@/lib/automation";
import {
  AutomationRuleForm,
  type RuleInitial,
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

  const [rule, templates] = await Promise.all([
    prisma.automationRule.findUnique({ where: { id } }),
    prisma.emailTemplate
      .findMany({
        orderBy: [{ isSystem: "desc" }, { name: "asc" }],
        select: { id: true, name: true, subject: true },
      })
      .catch(() => []),
  ]);

  if (!rule) notFound();

  const triggers: TriggerOptionDTO[] = TRIGGERS.map((t) => ({
    key: t.key,
    label: t.label,
    blurb: t.blurb,
    firesFrom: t.firesFrom,
    conditions: t.conditions,
    tokens: t.tokens,
  }));

  // `conditions` is a `Json` column, so it is narrowed on the server rather
  // than cast in the form — the row could predate a trigger's condition list.
  const initial: RuleInitial = {
    id: rule.id,
    name: rule.name,
    trigger: rule.trigger,
    conditions: readConditions(rule.conditions),
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
        initial={initial}
      />
    </div>
  );
}
