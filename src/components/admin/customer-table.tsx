import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { TableScroll } from "@/components/admin/form-kit";
import {
  adminLink,
  customerSignals,
  type CustomerRecord,
} from "@/lib/customers";
import {
  ContactActions,
  CustomerKindBadge,
  CustomerStatusBadge,
  MergeTip,
  SignalIcons,
  formatAgo,
  formatDayTime,
  sourceSummary,
} from "@/components/admin/customer-ui";

/**
 * The customer list, twice: a table from `md` up and stacked cards below it.
 *
 * Duplicated markup rather than a table squeezed into 320px, because the two
 * want opposite things. A table wants a row to be scannable across six
 * columns; a phone wants the name and the money first and the rest folded
 * underneath. Both render the same record, so there is no second source of
 * truth — only a second arrangement.
 *
 * ── What a row is for ────────────────────────────────────────────────────────
 *
 * Five questions, in the order somebody actually asks them: **who**, **how do
 * I reach them**, **did they buy**, **how much**, **how recently** — plus a
 * sixth column for anything that wants doing about them.
 *
 * What is deliberately *not* here is the provenance line ("Account + 4 account
 * orders + 1 cart lead + 1 chat + 1 return"). It was the longest string on
 * every row and it answers a second-impression question: *how do you know this
 * is one person?* It now lives behind the "(i)" beside the name, and only on
 * records that actually merged something.
 *
 * ── Why the card is not one big link ─────────────────────────────────────────
 *
 * It used to be, which made the email and the phone number un-tappable: an
 * `<a>` inside an `<a>` is invalid, so they had to render as dead text on the
 * screen where reaching someone matters most. The card is a plain container
 * now, with the name, each contact detail and the chevron as separate targets.
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
        {customers.map((c) => {
          const signals = customerSignals(c);
          return (
            <li
              key={c.id}
              className="rounded-lg border border-border bg-card p-3"
            >
              <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <Link
                    href={adminLink.customer(c.id)}
                    title={sourceSummary(c)}
                    className="min-w-0 max-w-full truncate text-sm font-medium transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {c.displayName}
                  </Link>
                  {/* Renders nothing for someone with an account — see the
                      note on the component. A search can cross both lists, so
                      this is how you tell which half a hit came from. */}
                  <CustomerKindBadge kind={c.kind} />
                  <CustomerStatusBadge status={c.status} />
                  <MergeTip customer={c} />
                </div>
                <Link
                  href={adminLink.customer(c.id)}
                  aria-label={`Open ${c.displayName}`}
                  className="-mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>

              {/* Reach + where, on one line.
                  This was two full-width rows printing the whole email and the
                  whole phone number — 88px of the longest strings on the card,
                  above the money. They are actions, so they are buttons now;
                  the address is in the `title` and on the detail page. */}
              <div className="mt-1 flex items-center gap-2">
                <ContactActions email={c.email} phone={c.phone} />
                {c.location && (
                  <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{c.location}</span>
                  </p>
                )}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border pt-2">
                <MiniStat
                  label={c.stats.orderCount > 0 ? "Spend" : "Status"}
                  value={
                    c.stats.orderCount > 0
                      ? formatINR(c.stats.lifetimeSpend)
                      : "Never ordered"
                  }
                  sub={
                    c.stats.orderCount > 0
                      ? `${c.stats.orderCount} order${c.stats.orderCount === 1 ? "" : "s"}`
                      : undefined
                  }
                />
                <MiniStat
                  label="Last seen"
                  value={formatAgo(c.stats.lastActivityAt, now)}
                />
              </div>

              {signals.length > 0 && (
                <SignalIcons signals={signals} className="mt-2" />
              )}
            </li>
          );
        })}
      </ul>

      {/* ---------------- md and up: the table ---------------- */}
      <TableScroll className="hidden bg-card md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <Th>Customer</Th>
              <Th>Reach</Th>
              <Th align="right">Spend</Th>
              <Th>Needs attention</Th>
              <Th align="right">Last seen</Th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {customers.map((c) => {
              const signals = customerSignals(c);
              return (
                <tr key={c.id} className="align-top hover:bg-muted/40">
                  <td className="max-w-60 px-3 py-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                      <Link
                        href={adminLink.customer(c.id)}
                        title={sourceSummary(c)}
                        className="min-w-0 max-w-full truncate font-medium transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {c.displayName}
                      </Link>
                      <MergeTip customer={c} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <CustomerKindBadge kind={c.kind} />
                      <CustomerStatusBadge status={c.status} />
                      {/* Where they are is identity, not contact — it helps you
                          recognise which "Jay Patel" this is, so it stays on
                          the name. The email and the phone are actions and
                          moved to the next column. */}
                      {c.location && (
                        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                          {c.location}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="w-px whitespace-nowrap px-3 py-3">
                    <ContactActions email={c.email} phone={c.phone} />
                  </td>

                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    {c.stats.orderCount > 0 ? (
                      <>
                        <span className="font-medium">
                          {formatINR(c.stats.lifetimeSpend)}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {c.stats.orderCount} order
                          {c.stats.orderCount === 1 ? "" : "s"}
                          {c.stats.cancelledCount > 0 &&
                            ` · ${c.stats.cancelledCount} cancelled`}
                        </span>
                      </>
                    ) : (
                      <span
                        className="text-muted-foreground"
                        title="No order has ever been placed, so there is nothing to total."
                      >
                        —
                      </span>
                    )}
                  </td>

                  <td className="max-w-48 px-3 py-3">
                    <SignalIcons signals={signals} />
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
              );
            })}
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

function MiniStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="eyebrow truncate">{label}</p>
      <p className="mt-0.5 truncate text-xs font-medium tabular-nums">{value}</p>
      {sub && (
        <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}
