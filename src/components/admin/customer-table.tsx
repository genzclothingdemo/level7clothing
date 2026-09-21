import Link from "next/link";
import { ChevronRight, Mail, Phone } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { TableScroll } from "@/components/admin/form-kit";
import { adminLink, type CustomerRecord } from "@/lib/customers";
import {
  CustomerStatusBadge,
  SourceLine,
  formatAgo,
  formatDayTime,
} from "@/components/admin/customer-ui";

/**
 * The customer list, twice: a table from `md` up and stacked cards below it.
 *
 * Duplicated markup rather than a table squeezed into 320px, because the two
 * want opposite things. A table wants a row to be scannable across six
 * columns; a phone wants the name and the money first and the rest folded
 * underneath. Both render the same data from the same record, so there is no
 * second source of truth — only a second arrangement.
 */
export function CustomerTable({
  customers,
  now,
}: {
  customers: CustomerRecord[];
  /** Read once per request by the page, so the cells stay pure. */
  now: number;
}) {
  return (
    <>
      {/* ---------------- phones: stacked cards ---------------- */}
      <ul className="space-y-2 md:hidden">
        {customers.map((c) => (
          <li key={c.id}>
            <Link
              href={adminLink.customer(c.id)}
              className="block rounded-lg border border-border bg-card p-3 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.displayName}</p>
                  <SourceLine
                    parts={c.sourceParts}
                    className="mt-0.5 block max-w-full text-[11px] text-muted-foreground"
                  />
                </div>
                <CustomerStatusBadge status={c.status} />
              </div>

              <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {c.email && (
                  <p className="flex items-center gap-1.5">
                    <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{c.email}</span>
                  </p>
                )}
                {c.phone && (
                  <p className="flex items-center gap-1.5">
                    <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{c.phone}</span>
                  </p>
                )}
              </div>

              <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-border pt-2.5">
                <MiniStat label="Orders" value={c.stats.orderCount} />
                <MiniStat label="Spend" value={formatINR(c.stats.lifetimeSpend)} />
                <MiniStat
                  label="Last seen"
                  value={formatAgo(c.stats.lastActivityAt, now)}
                />
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* ---------------- md and up: the table ---------------- */}
      <TableScroll className="hidden bg-card md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <Th>Customer</Th>
              <Th>Contact</Th>
              <Th>Status</Th>
              <Th align="right">Orders</Th>
              <Th align="right">Spend</Th>
              <Th align="right">Last activity</Th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {customers.map((c) => (
              <tr key={c.id} className="align-top hover:bg-muted/40">
                <td className="max-w-64 px-3 py-3">
                  <Link
                    href={adminLink.customer(c.id)}
                    className="block truncate font-medium transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {c.displayName}
                  </Link>
                  <SourceLine
                    parts={c.sourceParts}
                    className="mt-0.5 block max-w-full text-xs text-muted-foreground"
                  />
                </td>

                <td className="max-w-56 px-3 py-3 text-xs text-muted-foreground">
                  {c.email && (
                    <a
                      href={`mailto:${c.email}`}
                      className="block truncate hover:text-accent"
                      title={c.email}
                    >
                      {c.email}
                    </a>
                  )}
                  {c.phone && (
                    <a
                      href={`tel:${c.phone}`}
                      className="block truncate hover:text-accent"
                    >
                      {c.phone}
                    </a>
                  )}
                  {!c.email && !c.phone && <span>—</span>}
                  {c.location && (
                    <span className="block truncate">{c.location}</span>
                  )}
                </td>

                <td className="px-3 py-3">
                  <CustomerStatusBadge status={c.status} />
                </td>

                <td className="px-3 py-3 text-right tabular-nums">
                  {c.stats.orderCount}
                  {c.stats.cancelledCount > 0 && (
                    <span
                      className="block text-[11px] text-muted-foreground"
                      title="Cancelled orders are excluded from spend"
                    >
                      {c.stats.cancelledCount} cancelled
                    </span>
                  )}
                </td>

                <td className="px-3 py-3 text-right font-medium tabular-nums">
                  {formatINR(c.stats.lifetimeSpend)}
                  {c.stats.stillDue > 0 && (
                    <span className="block text-[11px] font-normal text-orange-600 dark:text-orange-400">
                      {formatINR(c.stats.stillDue)} due
                    </span>
                  )}
                </td>

                <td
                  className="whitespace-nowrap px-3 py-3 text-right text-xs text-muted-foreground"
                  title={formatDayTime(c.stats.lastActivityAt)}
                >
                  {formatAgo(c.stats.lastActivityAt, now)}
                </td>

                <td className="px-2 py-3 text-right">
                  <Link
                    href={adminLink.customer(c.id)}
                    aria-label={`Open ${c.displayName}`}
                    className="inline-grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </>
  );
}

function Th({
  children,
  align = "left",
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow truncate">{label}</p>
      <p className="mt-0.5 truncate text-xs font-medium tabular-nums">{value}</p>
    </div>
  );
}
