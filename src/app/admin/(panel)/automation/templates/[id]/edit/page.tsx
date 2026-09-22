import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { SAMPLE_TOKENS, TRIGGERS } from "@/lib/automation";
import {
  AutomationTemplateForm,
  type TokenGroupDTO,
} from "@/components/admin/automation-template-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit email template" };

/** Same grouping as the create page — common tokens once, then per trigger. */
function tokenGroups(): TokenGroupDTO[] {
  const common = TRIGGERS.reduce<{ token: string; describes: string }[]>(
    (acc, trigger, index) =>
      index === 0
        ? trigger.tokens
        : acc.filter((t) => trigger.tokens.some((o) => o.token === t.token)),
    []
  );
  const commonKeys = new Set(common.map((t) => t.token));

  return [
    { label: "Always available", tokens: common },
    ...TRIGGERS.map((trigger) => ({
      label: trigger.label,
      tokens: trigger.tokens.filter((t) => !commonKeys.has(t.token)),
    })).filter((group) => group.tokens.length > 0),
  ];
}

export default async function EditEmailTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const template = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!template) notFound();

  return (
    <div className="min-w-0">
      <Link
        href="/admin/automation/templates"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Email templates
      </Link>
      <h1 className="mb-6 break-words font-serif text-2xl">Edit template</h1>

      <AutomationTemplateForm
        groups={tokenGroups()}
        sample={SAMPLE_TOKENS}
        initial={{
          id: template.id,
          name: template.name,
          subject: template.subject,
          body: template.body,
          isSystem: template.isSystem,
        }}
      />
    </div>
  );
}
