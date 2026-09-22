"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MapPin, Plus, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/store/info-tip";
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
 */
export function AccountProfile({
  name,
  email,
  phone,
  defaultAddress,
  addressCount,
  onManageAddresses,
}: {
  name: string;
  email: string;
  phone: string | null;
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
                  Phone
                </span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="Optional"
                  className="input"
                />
              </label>
            </div>
            {/* Email is the account key and the login, so it is shown but not
                editable here — changing it would orphan past orders. */}
            <p className="text-xs text-muted-foreground">
              Signed in as {email}. Contact us to change the email on your
              account.
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
          <dl className="mt-4 space-y-3 text-sm">
            <Row term="Name" desc={name} />
            <Row term="Email" desc={email} />
            <Row term="Phone" desc={phone || "Not added"} />
          </dl>
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

function Row({ term, desc }: { term: string; desc: string }) {
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
      <dd className="min-w-0 break-all text-right font-medium">{desc}</dd>
    </div>
  );
}
