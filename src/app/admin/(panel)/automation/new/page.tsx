import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { TRIGGERS } from "@/lib/automation";
import {
  AutomationRuleForm,
  type TriggerOptionDTO,
} from "@/components/admin/automation-rule-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New automation rule" };

export default async function NewAutomationRulePage() {
  const templates = await prisma.emailTemplate
    .findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: { id: true, name: true, subject: true },
    })
    .catch(() => []);

  // The catalogue is read here, on the server, and handed over as plain data —
  // `@/lib/automation` is `server-only` (it imports Prisma and Resend), so the
  // client form cannot reach it. See the note in `automation-rule-form`.
  const triggers: TriggerOptionDTO[] = TRIGGERS.map((t) => ({
    key: t.key,
    label: t.label,
    blurb: t.blurb,
    firesFrom: t.firesFrom,
    conditions: t.conditions,
    tokens: t.tokens,
  }));

  return (
    <div className="min-w-0">
      <Link
        href="/admin/automation"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Automation
      </Link>
      <h1 className="mb-6 break-words font-serif text-2xl">New rule</h1>

      <AutomationRuleForm triggers={triggers} templates={templates} />
    </div>
  );
}
