"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BadgeCheck,
  Loader2,
  MapPin,
  Plus,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/store/info-tip";
import { VerifyContactPanel } from "@/components/store/auth-code-panel";
import { updateProfile } from "@/app/actions/account";
import type { SavedAddress } from "@/app/actions/addresses";
import { AddressSummary } from "./address-card";

/**
 * Identity, and a read-only glance at where parcels go.
 *
 * This panel used to carry a second, fully editable copy of the address —
 * writing the inline `User.address / city / state / pincode` columns while the
 * address book wrote `Address` rows, so the two could disagree and neither
 * could be called correct. It now shows the default address as a SUMMARY and
 * sends every change to the Addresses tab. One editor, one source of truth.
 *
 * ## The mobile number reads first
 *
 * It is the identity — the unique column, the thing that signs this person in —
 * so it is the first line of the summary and the email sits under it as contact
 * detail. Each carries a small confirmed / not-confirmed mark, and the
 * unconfirmed one offers to fix itself right there. That is not decoration: if
 * the store ever switches on "confirm your email before ordering", this is the
 * screen that makes it fixable *before* somebody meets it at checkout with a
 * full basket.
 */
export function AccountProfile({
  name,
  email,
  phone,
  emailVerified,
  phoneVerified,
  defaultAddress,
  addressCount,
  onManageAddresses,
}: {
  name: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  /** The account's default `Address`, or null when the book is empty. */
  defaultAddress: SavedAddress | null;
  addressCount: number;
  /** Switches the account view to the Addresses tab. */
  onManageAddresses: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name, phone: phone ?? "" });
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [, startTransition] = useTransition();

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await updateProfile(form);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || "Failed to update");
      return;
    }
    toast.success("Profile updated");
    // A changed number is a different number, so its old confirmation is gone.
    // Said out loud, because the mark on the summary changes underneath them.
    if ("unverified" in res && res.unverified) {
      toast.warning(
        "Your new number isn't confirmed yet — the old confirmation was for the old number.",
        { duration: 10000 }
      );
    }
    setEditing(false);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      {/* ── Identity ── */}
      <section className="rounded-lg border border-border bg-card p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-serif text-lg sm:text-xl">Your details</h3>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="-mr-2 inline-flex min-h-11 cursor-pointer items-center px-2 text-xs uppercase tracking-widest text-accent transition-colors hover:text-foreground"
            >
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <form onSubmit={onSave} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block min-w-0">
                <span className="mb-1.5 block text-sm text-muted-foreground">
                  Full name <span className="text-danger">*</span>
                </span>
                <input
                  required
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input"
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-1.5 block text-sm text-muted-foreground">
                  Mobile number{" "}
                  {phone && <span className="text-danger">*</span>}
                </span>
                {/* The prefix is an affix, not an editable field — this store
                    ships inside India only. See lib/phone.ts. */}
                <div className="flex items-stretch gap-2">
                  <span className="inline-flex h-11 shrink-0 items-center rounded-lg border border-border bg-muted px-3 text-sm text-muted-foreground">
                    +91
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={10}
                    value={form.phone.replace(/^\+?91/, "")}
                    onChange={(e) =>
                      setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })
                    }
                    placeholder="98765 43210"
                    className="input"
                  />
                </div>
              </label>
            </div>
            {/* The email is contact information, not the login, and it is not
                editable here — every past order was confirmed to it. */}
            <p className="text-xs text-muted-foreground">
              We write to {email}. Contact us to change the email on your
              account; your mobile number is what signs you in.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  "Save"
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setForm({ name, phone: phone ?? "" });
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            {/* Mobile first — it is the identity. Each contact carries its own
                confirmed mark rather than one badge for the account, because
                the two channels are confirmed separately and a single mark
                could not say which. */}
            <dl className="mt-4 space-y-3 text-sm">
              <Row term="Name" desc={name} />
              <Row
                term="Mobile"
                desc={phone || "Not added"}
                mark={
                  phone ? (
                    <VerifiedMark verified={phoneVerified} />
                  ) : undefined
                }
              />
              <Row
                term="Email"
                desc={email}
                mark={<VerifiedMark verified={emailVerified} />}
              />
            </dl>

            {/* One offer at a time, and only for the channel that can actually
                be confirmed today: there is no SMS gateway, so a "confirm your
                mobile" button would send nothing. `sendMyCode` refuses it on
                the server too — this just avoids offering it. */}
            {!emailVerified && (
              <div className="mt-4">
                {verifying ? (
                  <VerifyContactPanel
                    channel="email"
                    heading="Confirm your email"
                    reason="It takes one code and means order updates definitely reach you. Some stores also ask for it before an order can be placed."
                    shown={email}
                    onVerified={() => startTransition(() => router.refresh())}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setVerifying(true)}
                  >
                    <BadgeCheck className="h-4 w-4" /> Confirm my email
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Default address: a summary, never a second editor ── */}
      <section className="rounded-lg border border-border bg-card p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-serif text-lg sm:text-xl">
            Delivery address
            <InfoTip term="Default address">
              The address your checkout starts on. Your other saved addresses
              are still one tap away when you order.
            </InfoTip>
          </h3>
          {defaultAddress && (
            <button
              type="button"
              onClick={onManageAddresses}
              className="-mr-2 inline-flex min-h-11 shrink-0 cursor-pointer items-center px-2 text-xs uppercase tracking-widest text-accent transition-colors hover:text-foreground"
            >
              Change
            </button>
          )}
        </div>

        {defaultAddress ? (
          <>
            <div className="mt-4 rounded-lg border border-border p-4">
              <AddressSummary address={defaultAddress} />
            </div>
            <button
              type="button"
              onClick={onManageAddresses}
              className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs uppercase tracking-widest text-accent transition-colors hover:text-foreground"
            >
              <MapPin className="h-3.5 w-3.5" />
              {addressCount > 1
                ? `Manage all ${addressCount} addresses`
                : "Manage addresses"}
            </button>
          </>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No delivery address saved yet.
            </p>
            <Button
              className="mt-4"
              type="button"
              onClick={onManageAddresses}
            >
              <Plus className="h-4 w-4" /> Add an address
            </Button>
          </div>
        )}
      </section>

      {/*
        What is left of the old "App & notifications" card: one line.

        The controls themselves moved to the strip at the top of every page
        (`AppQuickActions`), where they cost two icons instead of ~40% of this
        screen. This line exists only because moving them costs discoverability
        — the account page is where people look for their own settings, and a
        pointer is cheap. It is a sentence, not a section: no border, no
        heading, no card.
      */}
      <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-muted-foreground">
        <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Install the app and switch order notifications on or off from the two
          icons at the very top of the screen.
        </span>
      </p>
    </div>
  );
}

/** Confirmed / not yet — a mark, never a sentence. The offer is below. */
function VerifiedMark({ verified }: { verified: boolean }) {
  return verified ? (
    <span
      title="Confirmed with a one-time code"
      className="inline-flex items-center gap-1 text-[11px] font-medium text-success"
    >
      <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      Confirmed
    </span>
  ) : (
    <span
      title="Not confirmed yet"
      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
    >
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      Not confirmed
    </span>
  );
}

function Row({
  term,
  desc,
  mark,
}: {
  term: string;
  desc: string;
  mark?: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{term}</dt>
      {/*
        `min-w-0` is the load-bearing part. A flex item's default `min-width:
        auto` refuses to shrink below its content, so `break-words` never got
        the chance to break anything — an email address simply ran out past the
        card's right edge at 320px. `break-all` on top of it, because
        `overflow-wrap: break-word` will not split inside a long token that has
        no break opportunity at all, which is exactly what an email is.
      */}
      <dd className="min-w-0 text-right">
        <span className="block break-all font-medium">{desc}</span>
        {mark && <span className="mt-0.5 block">{mark}</span>}
      </dd>
    </div>
  );
}
