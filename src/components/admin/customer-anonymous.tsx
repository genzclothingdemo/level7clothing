import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { LEAD_STATUS_LABEL, isLeadStatus } from "@/lib/leads";
import { adminLink, type CustomerDirectory } from "@/lib/customers";
import { AdminRef, formatAgo } from "@/components/admin/customer-ui";
import { InfoTip } from "@/components/store/info-tip";

/**
 * "6 records left out."
 *
 * Some cart leads and guest chats carry neither an email nor a phone number.
 * There is nothing to match them on, so the resolver counts them rather than
 * inventing them into people — and the list has always said so, which is the
 * right call: a total that quietly disagrees with the leads screen is how an
 * owner stops trusting a report.
 *
 * What it did not do is give anybody a way to *act* on that honesty. The link
 * went to the whole leads screen, 300 rows deep, with no way to tell which six
 * were the ones being talked about. So the note now opens: each skipped lead
 * is named by the product it was about and links to that product's rows on the
 * leads screen, which is the only handle a contact-less row has.
 *
 * A `<details>` rather than a toggle: the footnote is closed by default, opens
 * without a line of client JavaScript, and is keyboard-operable for free.
 */
export function AnonymousLeads({
  anonymous,
  now,
}: {
  anonymous: CustomerDirectory["anonymous"];
  now: number;
}) {
  const total = anonymous.leads + anonymous.threads;
  if (total === 0) return null;

  const shown = anonymous.leadRows;
  const hidden = anonymous.leads - shown.length;

  return (
    <section className="mt-4 rounded-lg border border-dashed border-border p-3">
      {/* One line, not a paragraph plus a second line of links. The sentence
          explaining *why* they are left out is true forever and read once, so
          it sits behind the (i) like every other explanation in this admin. */}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="font-medium text-foreground">
            {total} record{total === 1 ? "" : "s"} left out
          </span>
          <InfoTip term="Records left out">
            These have no email and no phone number, so there is nothing to
            match them on. They are counted here rather than invented into
            people — guessing would merge two strangers or split one shopper in
            half, and both are worse than an honest gap.
          </InfoTip>
        </span>
        {anonymous.leads > 0 && (
          <AdminRef href="/admin/leads">
            {anonymous.leads} cart lead{anonymous.leads === 1 ? "" : "s"}
          </AdminRef>
        )}
        {anonymous.threads > 0 && (
          <AdminRef href={adminLink.chat()}>
            {anonymous.threads} chat{anonymous.threads === 1 ? "" : "s"}
          </AdminRef>
        )}
      </p>

      {shown.length > 0 && (
        <details className="group mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-9">
            <ChevronDown
              className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
            Which carts
          </summary>

          <ul className="mt-1 space-y-1 border-t border-border pt-2">
            {shown.map((l) => {
              const status = isLeadStatus(l.status) ? l.status : null;
              return (
                <li
                  key={l.id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
                >
                  <span className="min-w-0 flex-1">
                    {/*
                      The leads screen searches product name, so this lands on
                      the rows for this piece. The row itself has no contact
                      detail to search by — that is the whole reason it is here.
                    */}
                    <AdminRef
                      href={adminLink.lead(l.productName)}
                      title="Find this on the interested-customers screen"
                    >
                      {l.productName}
                    </AdminRef>
                    <span className="text-muted-foreground">
                      {" "}
                      × {l.quantity}
                      {l.price != null ? ` · ${formatINR(l.price)}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {status ? LEAD_STATUS_LABEL[status] : l.status} ·{" "}
                    {formatAgo(l.createdAt, now)}
                  </span>
                </li>
              );
            })}
          </ul>

          {hidden > 0 && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {hidden} more not listed —{" "}
              <Link href="/admin/leads" className="underline hover:text-accent">
                see them all
              </Link>
              .
            </p>
          )}
        </details>
      )}
    </section>
  );
}
