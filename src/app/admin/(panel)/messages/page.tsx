import { Mail, Phone } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ChatInbox } from "@/components/admin/chat-inbox";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_LENGTH,
} from "@/lib/chat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages" };

/**
 * Two-way chat with shoppers, in the slot that used to hold the read-only
 * contact-form inbox.
 *
 * The page itself stays a thin server shell: the inbox polls, so rendering
 * threads here would only serve a snapshot that is stale a second later, and
 * on this store every DB query from the function region costs ~250ms.
 *
 * Contact-form submissions still land in the `Message` table (the /contact
 * page writes there and emails the store), so they are kept below as a
 * read-only archive rather than being quietly hidden.
 */
export default async function AdminMessages() {
  const legacy = await prisma.message
    .findMany({ orderBy: { createdAt: "desc" }, take: 50 })
    .catch(() => []);

  return (
    <div className="flex min-h-0 flex-col">
      <div>
        <h1 className="font-serif text-3xl">Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Chat directly with shoppers. Replies appear in their chat panel on the
          storefront.
        </p>
      </div>

      <div className="mt-6 h-[calc(100dvh-16rem)] min-h-[30rem]">
        <ChatInbox
          maxLength={MAX_MESSAGE_LENGTH}
          maxBytes={MAX_ATTACHMENT_BYTES}
          accept={ATTACHMENT_ACCEPT}
        />
      </div>

      {legacy.length > 0 && (
        <details className="mt-6 rounded-2xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Contact-form inquiries{" "}
            <span className="text-muted-foreground">
              ({legacy.length} archived)
            </span>
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            Sent before chat existed, or from the contact page. Read-only —
            reply by email or phone.
          </p>
          <ul className="mt-4 space-y-3">
            {legacy.map((m) => (
              <li key={m.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="text-sm font-medium">{m.name}</span>
                  <a
                    href={`mailto:${m.email}`}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-accent"
                  >
                    <Mail className="h-3 w-3" /> {m.email}
                  </a>
                  {m.phone && (
                    <a
                      href={`tel:${m.phone}`}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-accent"
                    >
                      <Phone className="h-3 w-3" /> {m.phone}
                    </a>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {m.createdAt.toLocaleString("en-IN")}
                  </span>
                </div>
                {m.subject && (
                  <p className="mt-2 text-sm font-medium">{m.subject}</p>
                )}
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {m.message}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
