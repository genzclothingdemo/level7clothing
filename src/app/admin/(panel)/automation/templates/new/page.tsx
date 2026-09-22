import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SAMPLE_TOKENS, TRIGGERS } from "@/lib/automation";
import {
  AutomationTemplateForm,
  type TokenGroupDTO,
} from "@/components/admin/automation-template-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New email template" };

/**
 * Tokens, grouped for the reference panel.
 *
 * Grouped by trigger, with the ones every trigger provides pulled out first —
 * repeating `{{store.name}}` under all four triggers would make the list twice
 * as long and say nothing extra.
 */
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

export default function NewEmailTemplatePage() {
  return (
    <div className="min-w-0">
      <Link
        href="/admin/automation/templates"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Email templates
      </Link>
      <h1 className="mb-6 break-words font-serif text-2xl">New template</h1>

      <AutomationTemplateForm groups={tokenGroups()} sample={SAMPLE_TOKENS} />
    </div>
  );
}
