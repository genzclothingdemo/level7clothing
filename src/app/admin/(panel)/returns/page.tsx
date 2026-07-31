import { RotateCcw } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ReturnStatusSelect } from "./return-status-select";

export const dynamic = "force-dynamic";
export const metadata = { title: "Returns" };

const statusColor: Record<string, string> = {
  requested: "bg-accent/15 text-accent",
  approved: "bg-blue-500/15 text-blue-500",
  rejected: "bg-danger/15 text-danger",
  completed: "bg-success/15 text-success",
};

export default async function AdminReturns() {
  const requests = await prisma.returnRequest
    .findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] })
    .catch(() => []);

  const openCount = requests.filter((r) => r.status === "requested").length;

  return (
    <div>
      <div>
        <h1 className="font-serif text-3xl">Returns &amp; exchanges</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {requests.length} request{requests.length === 1 ? "" : "s"}
          {openCount > 0 && ` · ${openCount} awaiting review`}
        </p>
      </div>

      {requests.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-12 text-center">
          <RotateCcw className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-serif text-xl">No requests yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Return and exchange requests raised by customers from their account
            will appear here.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {requests.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3 align-top">
                      <p className="font-mono font-medium">{r.orderNumber}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {r.createdAt.toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top capitalize">
                      {r.kind}
                      {r.exchangeSize && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          → size {r.exchangeSize}
                        </span>
                      )}
                    </td>
                    <td className="max-w-xs px-4 py-3 align-top">
                      <p>{r.reason}</p>
                      {r.details && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {r.details}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-muted-foreground">
                      {r.email}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs capitalize ${
                          statusColor[r.status] ?? "bg-muted"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <ReturnStatusSelect id={r.id} status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
