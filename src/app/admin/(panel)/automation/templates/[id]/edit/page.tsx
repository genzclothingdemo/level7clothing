import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  SAMPLE_TOKENS,
  TRIGGERS,
  describeConditions,
  readConditions,
  triggerLabel,
} from "@/lib/automation";
import {
  channelShort,
  composeFallbackLabel,
  eventKeyOf,
  eventLabel,
  recipientGroupLabel,
} from "@/lib/notification-channels";
import {
  AutomationTemplateForm,
  type TokenGroupDTO,
} from "@/components/admin/automation-template-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit message" };

/** Tokens for the reference panel — the ones every event provides once, then per event. */
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
  const template = await prisma.emailTemplate.findUnique({
    where: { id },
    include: { rules: { select: { trigger: true, conditions: true, recipient: true, action: true } } },
  });
  if (!template) notFound();

  // Where these words appear, read off the alerts that use them.
  const events = new Map<string, { label: string; channels: string[] }>();
  for (const r of template.rules) {
    const conditions = readConditions(r.conditions);
    const key = eventKeyOf(r.trigger, conditions, r.recipient);
    const entry = events.get(key) ?? {
      label: `${eventLabel(
        r.trigger,
        conditions,
        composeFallbackLabel(triggerLabel(r.trigger), describeConditions(r.trigger, conditions))
      ).toLowerCase()} ${recipientGroupLabel(r.recipient).toLowerCase()}`,
      channels: [],
    };
    entry.channels.push(channelShort(r.action));
    events.set(key, entry);
  }
  const usedFor = [...events.values()].map((e) => `${e.label} (${e.channels.join(", ")})`);

  return (
    <div className="min-w-0">
      <Link
        href="/admin/automation/templates"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Message wording
      </Link>
      <h1 className="mb-4 break-words font-serif text-2xl">{template.name}</h1>

      <AutomationTemplateForm
        groups={tokenGroups()}
        sample={SAMPLE_TOKENS}
        usedFor={usedFor}
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
