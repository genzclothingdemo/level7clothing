import { Mail } from "lucide-react";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = { title: "Newsletter" };

export default async function AdminNewsletter() {
  const subscribers = await prisma.newsletterSubscriber
    .findMany({ orderBy: { createdAt: "desc" } })
    .catch(() => []);

  const active = subscribers.filter((s) => !s.unsubscribed);

  return (
    <div>
      <div>
        <h1 className="font-serif text-3xl">Newsletter</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {active.length} active subscriber{active.length === 1 ? "" : "s"}
          {subscribers.length !== active.length &&
            ` · ${subscribers.length - active.length} unsubscribed`}
        </p>
      </div>

      {subscribers.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-12 text-center">
          <Mail className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-serif text-xl">No subscribers yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Emails collected from the &quot;Join the club&quot; form will appear
            here.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {subscribers.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">{s.email}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {s.source}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs ${
                            s.unsubscribed
                              ? "bg-muted text-muted-foreground"
                              : "bg-success/15 text-success"
                          }`}
                        >
                          {s.unsubscribed ? "Unsubscribed" : "Active"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {s.createdAt.toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <details className="mt-6 rounded-2xl border border-border bg-card p-5">
            <summary className="cursor-pointer text-sm font-medium">
              Copy all active emails
            </summary>
            <textarea
              readOnly
              rows={4}
              value={active.map((s) => s.email).join(", ")}
              className="input mt-3 resize-none font-mono text-xs"
            />
          </details>
        </>
      )}
    </div>
  );
}
