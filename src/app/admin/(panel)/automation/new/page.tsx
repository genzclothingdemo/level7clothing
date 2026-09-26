import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  ACTIONS,
  SAMPLE_TOKENS,
  TRIGGERS,
  renderTemplate,
} from "@/lib/automation";
import { pushCopyFrom, pushReach } from "@/lib/push-dispatch";
import {
  AutomationRuleForm,
  type ChannelOptionDTO,
  type TemplateOptionDTO,
  type TriggerOptionDTO,
} from "@/components/admin/automation-rule-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New automation rule" };

export default async function NewAutomationRulePage() {
  const [rows, reach] = await Promise.all([
    prisma.emailTemplate
      .findMany({
        orderBy: [{ isSystem: "desc" }, { name: "asc" }],
        // `body` is read for the push preview only. It never reaches the
        // browser whole — `pushCopyFrom` reduces it to the two lines a banner
        // shows first, which is all the form renders.
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

  const templates: TemplateOptionDTO[] = rows.map((t) => {
    // Rendered with the same sample values the template editor previews with,
    // so the banner shown here is what a real order would produce.
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

  const channels: ChannelOptionDTO[] = ACTIONS.map((a) => ({
    key: a.key,
    label: a.label,
    short: a.short,
    verb: a.verb,
    caveat: a.caveat,
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

      <AutomationRuleForm
        triggers={triggers}
        templates={templates}
        channels={channels}
        pushReach={reach}
      />
    </div>
  );
}
