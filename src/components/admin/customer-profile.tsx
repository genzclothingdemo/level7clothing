import {
  BadgeIndianRupee,
  CreditCard,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { formatINR, whatsappLink } from "@/lib/utils";
import { Block, BtnLink, Line } from "@/components/admin/order-ui";
import { CopyableId } from "@/components/admin/copy-id";
import { InfoTip } from "@/components/store/info-tip";
import { adminLink, type CustomerRecord } from "@/lib/customers";
import { AdminRef, Nothing, Stat, formatDay } from "@/components/admin/customer-ui";

/**
 * The top half of a customer: who they are, what they are worth, and where
 * their money actually is.
 *
 * Everything here is arithmetic over rows that already exist. There is no
 * lifetime-value model, no churn risk and no "engagement score" — the data
 * cannot support them, and a number nobody can check is worse than no number.
 */

/* ------------------------------------------------------------------ */
/*  Contact                                                            */
/* ------------------------------------------------------------------ */

export function CustomerContact({ customer }: { customer: CustomerRecord }) {
  const account = customer.accounts[0] ?? null;
  const extraAccounts = customer.accounts.slice(1);
  const latest = customer.orders[0] ?? null;

  // The freshest shipping address beats the account's saved one: it is where a
  // parcel most recently went.
  const address = latest
    ? [latest.city, latest.state, latest.pincode].filter(Boolean).join(", ")
    : [account?.city, account?.state, account?.pincode].filter(Boolean).join(", ");

  const otherEmails = customer.emails.filter((e) => e !== customer.email);
  const otherPhones = customer.phones.filter((p) => p !== customer.phone);

  return (
    <Block title="Contact" icon={UserRound}>
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
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <a href={`tel:${customer.phone}`} className="hover:text-accent">
              {customer.phone}
            </a>
          </div>
        ) : (
          <Nothing>No phone number on record.</Nothing>
        )}

        {address && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="break-words">
              {address}
              {latest && (
                <span className="block text-[11px]">
                  from order {latest.orderNumber}
                </span>
              )}
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

        <div className="flex flex-wrap gap-1.5 pt-1">
          {customer.email && (
            <BtnLink href={`mailto:${customer.email}`} tone="outline">
              <Mail className="h-3.5 w-3.5" /> Email
            </BtnLink>
          )}
          {customer.phone && (
            <BtnLink
              href={whatsappLink(customer.phone, "")}
              target="_blank"
              rel="noreferrer"
              tone="outline"
            >
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </BtnLink>
          )}
        </div>

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
      </div>
    </Block>
  );
}

/* ------------------------------------------------------------------ */
/*  Payment history                                                    */
/* ------------------------------------------------------------------ */

export function CustomerPayments({ customer }: { customer: CustomerRecord }) {
  const s = customer.stats;
  const nothing = s.orderCount === 0;

  return (
    <Block title="Payment history" icon={CreditCard}>
      {nothing ? (
        <Nothing>
          No orders yet, so there is nothing paid, collected or outstanding.
        </Nothing>
      ) : (
        <div>
          {/* Three lines in their own `space-y`, so the totals block below can
              own its margin without fighting the parent's spacing utility. */}
          <div className="space-y-1.5">
            <Line
              label={
                <span className="inline-flex items-center">
                  Paid online
                  <InfoTip term="Paid online">
                    The sum of each order&apos;s <b>amount paid</b> — money that
                    actually reached the payment gateway, whether that was the
                    full total or a partial advance.
                  </InfoTip>
                </span>
              }
              value={formatINR(s.paidOnline)}
              tone={s.paidOnline > 0 ? "success" : "muted"}
            />
            <Line
              label={
                <span className="inline-flex items-center">
                  Collected on delivery
                  <InfoTip term="Collected on delivery">
                    The balance due on orders the courier has marked{" "}
                    <b>delivered</b>. The database records what was owed, not
                    the moment cash changed hands, so this is inferred from the
                    delivery status — treat it as &ldquo;should have been
                    collected&rdquo;.
                  </InfoTip>
                </span>
              }
              value={formatINR(s.collectedOnDelivery)}
            />
            <Line
              label={
                <span className="inline-flex items-center">
                  Still to collect
                  <InfoTip term="Still to collect">
                    Balance on orders that have not been delivered yet —
                    pending, confirmed or in transit. Cancelled orders are
                    excluded.
                  </InfoTip>
                </span>
              }
              value={formatINR(s.stillDue)}
              tone={s.stillDue > 0 ? "accent" : "muted"}
              strong={s.stillDue > 0}
            />
          </div>

          <div className="mt-2.5 space-y-1.5 border-t border-border pt-2">
            <Line
              label="Lifetime spend"
              value={formatINR(s.lifetimeSpend)}
              tone="foreground"
              strong
            />
            {s.cancelledCount > 0 && (
              <Line
                label={`Cancelled (${s.cancelledCount}, not counted)`}
                value={formatINR(s.cancelledValue)}
              />
            )}
            {s.preferredPaymentMethod && (
              <Line
                label="Usual method"
                value={`${s.preferredPaymentMethod} · ${s.preferredPaymentCount}×`}
              />
            )}
          </div>
        </div>
      )}
    </Block>
  );
}

/* ------------------------------------------------------------------ */
/*  Analytics                                                          */
/* ------------------------------------------------------------------ */

export function CustomerAnalytics({ customer }: { customer: CustomerRecord }) {
  const s = customer.stats;

  return (
    <section aria-label="Analytics">
      <div className="mb-2 flex items-center gap-1">
        <BadgeIndianRupee
          className="h-3.5 w-3.5 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="eyebrow">Analytics</h2>
        <InfoTip term="Analytics">
          Every figure here is arithmetic over this person&apos;s own orders.
          Cancelled orders are excluded from money and averages but still
          counted as orders placed.
        </InfoTip>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Lifetime spend"
          value={formatINR(s.lifetimeSpend)}
          sub={s.cancelledCount > 0 ? `${s.cancelledCount} cancelled excluded` : undefined}
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
        <Stat
          label="Preferred payment"
          value={s.preferredPaymentMethod ?? "—"}
          sub={
            s.preferredPaymentMethod
              ? `${s.preferredPaymentCount} of ${s.countedOrders}`
              : undefined
          }
          tip="The method used on the most orders. A tie goes to the one used most recently."
        />
      </div>
    </section>
  );
}
