import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeIndianRupee,
  Heart,
  History,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  PackageX,
  Phone,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  UserRound,
  XCircle,
} from "lucide-react";
import { formatINR, whatsappLink } from "@/lib/utils";
import { Block, BtnLink } from "@/components/admin/order-ui";
import { CopyableId } from "@/components/admin/copy-id";
import { InfoTip } from "@/components/store/info-tip";
import {
  adminLink,
  customerSignals,
  customerTimeline,
  type CustomerEventKind,
  type CustomerRecord,
} from "@/lib/customers";
import {
  AdminRef,
  CustomerStatusBadge,
  MergeTip,
  Nothing,
  SignalBadges,
  Stat,
  formatAgo,
  formatDay,
  formatDayTime,
  sourceSummary,
} from "@/components/admin/customer-ui";

/**
 * The header and the Overview of one person.
 *
 * Two rules hold this file together:
 *
 * **One fact, one home.** Lifetime spend is a tile here and nowhere else; the
 * payment split lives on Payments; the order list lives on Orders. The old
 * single-scroll page stated lifetime spend twice, the preferred payment method
 * twice, the cancelled count twice and the order count three times — and
 * because each copy was computed in its own component, they were three chances
 * to disagree.
 *
 * **Nothing is restated that has a screen of its own.** Every reference is a
 * link to the thing rather than a copy of it.
 */

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */

/**
 * Who this is and how to reach them — rendered by the layout, so it stays put
 * while the sections change underneath it.
 *
 * It holds the contact *actions*; the addresses themselves live once, in the
 * identity card on Overview. Putting the button here means a reply is one tap
 * away from the payments ledger and the chat history alike, which is where
 * somebody actually decides to send one.
 */
export function CustomerHeader({
  customer,
  now,
}: {
  customer: CustomerRecord;
  now: number;
}) {
  return (
    <header className="min-w-0">
      <Link
        href="/admin/customers"
        className="inline-flex min-h-11 items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> All customers
      </Link>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="min-w-0 break-words font-serif text-2xl sm:text-3xl">
          {customer.displayName}
        </h1>
        {/*
          One "(i)" here, not two. The merge explanation lives in Identity &
          contact, beside the addresses it is actually about — which is also
          where somebody goes when they doubt that these records are one
          person.
        */}
        <CustomerStatusBadge status={customer.status} withTip />
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p
          className="text-xs text-muted-foreground"
          title={formatDayTime(customer.stats.lastActivityAt)}
        >
          Last seen {formatAgo(customer.stats.lastActivityAt, now)}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {customer.email && (
            <BtnLink href={`mailto:${customer.email}`} tone="outline">
              <Mail className="h-3.5 w-3.5" /> Email
            </BtnLink>
          )}
          {customer.phone && (
            <>
              <BtnLink
                href={whatsappLink(customer.phone, "")}
                target="_blank"
                rel="noreferrer"
                tone="outline"
              >
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </BtnLink>
              <BtnLink href={`tel:${customer.phone}`} tone="outline">
                <Phone className="h-3.5 w-3.5" /> Call
              </BtnLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  Attention                                                          */
/* ------------------------------------------------------------------ */

/**
 * The only part of this page that asks for an action.
 *
 * Unanswered messages, a payment that failed, money still owed, an open
 * return, a cart nobody followed up. Each one links to the section that deals
 * with it, so the strip is a to-do list rather than a status light.
 *
 * It renders its own reassurance when there is nothing: "no alerts" and "no
 * alert system" look identical otherwise, and only one of them is good news.
 */
export function CustomerAttention({ customer }: { customer: CustomerRecord }) {
  const signals = customerSignals(customer);

  if (signals.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        Nothing needs attention — no unanswered messages, no failed payment, no
        money outstanding, no open return.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2">
      <span className="inline-flex items-center gap-1.5">
        <AlertTriangle
          className="h-3.5 w-3.5 shrink-0 text-accent"
          aria-hidden="true"
        />
        <span className="eyebrow">Needs attention</span>
      </span>
      <SignalBadges signals={signals} linked />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Identity and contact                                               */
/* ------------------------------------------------------------------ */

/**
 * Everything that identifies the person: names, every address and number they
 * have used, where the last parcel went, and the account if there is one.
 *
 * This is the *only* place any of those strings appear. The header carries the
 * buttons, this carries the values.
 */
export function CustomerIdentity({ customer }: { customer: CustomerRecord }) {
  const account = customer.accounts[0] ?? null;
  const extraAccounts = customer.accounts.slice(1);
  const latest = customer.orders[0] ?? null;

  // The freshest shipping address beats the account's saved one: it is where a
  // parcel most recently went.
  const shipped = latest
    ? [latest.city, latest.state, latest.pincode].filter(Boolean).join(", ")
    : "";

  const otherEmails = customer.emails.filter((e) => e !== customer.email);
  const otherPhones = customer.phones.filter((p) => p !== customer.phone);

  return (
    <Block
      title="Identity & contact"
      icon={<UserRound />}
      aside={<MergeTip customer={customer} />}
    >
      <div className="space-y-2 text-sm">
        <p className="break-words font-medium">{customer.displayName}</p>

        {customer.email ? (
          <a
            href={`mailto:${customer.email}`}
            className="flex items-start gap-2 break-all text-xs text-muted-foreground hover:text-accent"
          >
            <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {customer.email}
          </a>
        ) : (
          <Nothing>No email on record.</Nothing>
        )}

        {customer.phone ? (
          <a
            href={`tel:${customer.phone}`}
            className="flex items-start gap-2 text-xs text-muted-foreground hover:text-accent"
          >
            <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {customer.phone}
          </a>
        ) : (
          <Nothing>No phone number on record.</Nothing>
        )}

        {shipped && latest && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="break-words">
              {shipped}
              <span className="block text-[11px]">
                last shipped to, on order{" "}
                <AdminRef href={adminLink.order(latest.orderNumber)} mono>
                  {latest.orderNumber}
                </AdminRef>
              </span>
            </span>
          </p>
        )}

        {/* Alternates are worth showing: they are the reason two records
            became one, and support will be asked about them. */}
        {(otherEmails.length > 0 || otherPhones.length > 0) && (
          <p className="break-all text-[11px] text-muted-foreground">
            <span className="font-medium">Also seen as:</span>{" "}
            {[...otherEmails, ...otherPhones].join(" · ")}
          </p>
        )}

        {/* ---- Account ---- */}
        <div className="mt-1 border-t border-border pt-2">
          {account ? (
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs">
                <ShieldCheck
                  className="h-3.5 w-3.5 shrink-0 text-success"
                  aria-hidden="true"
                />
                <span>
                  Registered account · joined {formatDay(account.createdAt)}
                </span>
              </p>
              {account.address && (
                <p className="break-words text-[11px] text-muted-foreground">
                  Saved address: {account.address}
                  {account.city ? `, ${account.city}` : ""}
                  {account.pincode ? ` ${account.pincode}` : ""}
                </p>
              )}
              {/*
                There is no per-account admin route — an account IS this page.
                So the link that matters is the one to everything it bought,
                and the id, which is what gets pasted into a DB lookup.
              */}
              <p className="text-[11px]">
                <AdminRef href={adminLink.orderSearch(account.email)}>
                  All orders on this account
                </AdminRef>
              </p>
              <CopyableId id={account.id} label="Account ID" />
              {extraAccounts.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {extraAccounts.length} further account
                  {extraAccounts.length === 1 ? "" : "s"} share this contact:{" "}
                  {extraAccounts.map((a) => a.email).join(", ")}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No store account — everything here was done as a guest.
            </p>
          )}
        </div>

        {/*
          The provenance, stated plainly. On a list row this is noise and hides
          behind the "(i)"; here there is room, and this card is exactly where
          somebody arrives when they want to know whether these really are one
          person. The "(i)" in the header explains the matching rule.
        */}
        {customer.sourceParts.length > 0 && (
          <p className="border-t border-border pt-2 text-[11px] text-muted-foreground">
            {sourceSummary(customer)}.
          </p>
        )}
      </div>
    </Block>
  );
}

/* ------------------------------------------------------------------ */
/*  Value                                                              */
/* ------------------------------------------------------------------ */

/**
 * What this person is worth, and nothing about *how* they paid — that is the
 * Payments section's job and stating it twice is how two numbers drift apart.
 *
 * Every figure is arithmetic over their own orders. No lifetime-value model,
 * no churn risk, no engagement score: the data cannot support them, and a
 * number nobody can check is worse than no number.
 */
export function CustomerValue({ customer }: { customer: CustomerRecord }) {
  const s = customer.stats;

  if (s.orderCount === 0) {
    return (
      <Block title="Value" icon={<BadgeIndianRupee />}>
        <Nothing>
          Never ordered, so there is nothing to total. What they have shown
          interest in is under{" "}
          <AdminRef href={adminLink.customerActivity(customer.id)}>
            Activity
          </AdminRef>
          .
        </Nothing>
      </Block>
    );
  }

  return (
    <section aria-label="Value">
      <div className="mb-2 flex items-center gap-1">
        <BadgeIndianRupee
          className="h-3.5 w-3.5 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="eyebrow">Value</h2>
        <InfoTip term="Value">
          Arithmetic over this person&apos;s own orders. Cancelled orders are
          excluded from the money and the average but still counted as orders
          placed. How the money was actually taken — online, on delivery, or
          still owed — is under Payments.
        </InfoTip>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label="Lifetime spend"
          value={formatINR(s.lifetimeSpend)}
          sub={
            s.cancelledCount > 0
              ? `${formatINR(s.cancelledValue)} cancelled, excluded`
              : undefined
          }
          tone="accent"
        />
        <Stat
          label="Orders"
          value={s.orderCount}
          sub={
            s.countedOrders === s.orderCount
              ? undefined
              : `${s.countedOrders} counted`
          }
        />
        <Stat
          label="Avg order"
          value={formatINR(s.averageOrderValue)}
          tip="Lifetime spend divided by the number of orders that were not cancelled."
        />
        <Stat
          label="First order"
          value={s.firstOrderAt ? formatDay(s.firstOrderAt) : "—"}
        />
        <Stat
          label="Last order"
          value={s.lastOrderAt ? formatDay(s.lastOrderAt) : "—"}
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Timeline                                                           */
/* ------------------------------------------------------------------ */

/**
 * Six tables in date order.
 *
 * This is the one view the old page had no version of: whether the chat came
 * before or after the failed payment is the difference between "they asked a
 * question" and "they asked because their card was declined", and the answer
 * used to mean scrolling between two blocks comparing timestamps.
 *
 * Every line is the *event*, not its detail — the detail is one link away in
 * the section or the screen that owns it.
 */
const EVENT_META: Record<
  CustomerEventKind,
  { verb: string; icon: React.ReactNode; tone?: string }
> = {
  order: { verb: "Ordered", icon: <ShoppingBag /> },
  payment_failed: {
    verb: "Payment failed on",
    icon: <XCircle />,
    tone: "text-danger",
  },
  return: { verb: "Raised return", icon: <PackageX /> },
  chat: { verb: "Messaged", icon: <MessageSquare /> },
  cart: { verb: "Added to cart", icon: <ShoppingCart /> },
  wishlist: { verb: "Saved", icon: <Heart /> },
  account: { verb: "Opened an account", icon: <ShieldCheck /> },
};

export function CustomerTimeline({
  customer,
  now,
  limit = 8,
}: {
  customer: CustomerRecord;
  now: number;
  limit?: number;
}) {
  const all = customerTimeline(customer);
  const events = all.slice(0, limit);

  return (
    <Block
      title="Recent activity"
      icon={<History />}
      aside={
        <InfoTip term="Recent activity">
          Orders, failed payments, returns, chats, cart additions, saved items
          and the day the account was opened — all six tables in one date order,
          newest first. Each line links to the screen that holds the detail.
        </InfoTip>
      }
    >
      {events.length === 0 ? (
        <Nothing>Nothing recorded yet.</Nothing>
      ) : (
        <>
          <ul className="space-y-1.5">
            {events.map((e) => {
              const meta = EVENT_META[e.kind];
              return (
                <li key={e.id} className="flex items-start gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center text-muted-foreground [&>svg]:h-3.5 [&>svg]:w-3.5 ${meta.tone ?? ""}`}
                  >
                    {meta.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={meta.tone ?? "text-muted-foreground"}>
                      {meta.verb}
                    </span>{" "}
                    {e.href ? (
                      // Monospace for reference numbers only. A product name
                      // or a slug set in mono reads as a code the reader is
                      // supposed to recognise, and it is not one.
                      <AdminRef
                        href={e.href}
                        mono={
                          e.kind === "order" ||
                          e.kind === "payment_failed" ||
                          e.kind === "return"
                        }
                      >
                        {e.subject}
                      </AdminRef>
                    ) : (
                      <span className="break-words">{e.subject}</span>
                    )}
                    {e.amount != null && e.amount > 0 && (
                      <span className="text-muted-foreground tabular-nums">
                        {" · "}
                        {formatINR(e.amount)}
                      </span>
                    )}
                  </span>
                  <span
                    className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground"
                    title={formatDayTime(e.at)}
                  >
                    {formatAgo(e.at, now)}
                  </span>
                </li>
              );
            })}
          </ul>

          {all.length > events.length && (
            <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
              {all.length - events.length} older entries — see{" "}
              <AdminRef href={adminLink.customerOrders(customer.id)}>
                Orders
              </AdminRef>{" "}
              and{" "}
              <AdminRef href={adminLink.customerActivity(customer.id)}>
                Activity
              </AdminRef>
              .
            </p>
          )}
        </>
      )}
    </Block>
  );
}
