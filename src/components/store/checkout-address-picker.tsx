"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Plus, MapPin, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/store/info-tip";
import { saveAddress, type SavedAddress } from "@/app/actions/addresses";
import {
  AddressFields,
  EMPTY_ADDRESS,
  type AddressDraft,
} from "./address-fields";
import { AddressSummary } from "./address-card";

/**
 * Checkout's shipping address step.
 *
 * Checkout used to render its own copy of the address form — a third place the
 * same seven fields were typed, and the only one that saved them nowhere. A
 * signed-in customer retyped an address they had already given us, every time.
 *
 * Now: the saved book is the list, the default is preselected, and a new
 * address is offered back to the book instead of vanishing with the order.
 * Guests (no session) still get the plain form, with no save offer.
 */

/** The address fields the order itself needs — no label, no default flag. */
export type ChosenAddress = {
  fullName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
};

function toChosen(d: AddressDraft | SavedAddress): ChosenAddress {
  return {
    fullName: d.fullName,
    phone: d.phone,
    address: d.address,
    city: d.city,
    state: d.state,
    pincode: d.pincode,
  };
}

function draftIsComplete(d: AddressDraft) {
  return (
    d.fullName.trim().length >= 2 &&
    d.phone.trim().length >= 6 &&
    d.address.trim().length >= 5 &&
    d.city.trim().length >= 2 &&
    d.state.trim().length >= 2 &&
    /^\d{6}$/.test(d.pincode.trim())
  );
}

export function CheckoutAddressPicker({
  addresses,
  loading,
  selectedId,
  onChoose,
  onBookChanged,
  disabled = false,
}: {
  /** Saved addresses, default first. `null` means nobody is signed in. */
  addresses: SavedAddress[] | null;
  loading: boolean;
  /** Which saved address is in use, or null while a typed-in one is. */
  selectedId: string | null;
  /**
   * Fires on every change, not only on confirm: the shipping-rate lookup keys
   * off the pincode, so a half-typed new address still has to reach the parent.
   *
   * `ready` is what the parent gates its submit button on. It is false while a
   * signed-in customer is still typing a new address, so the order cannot be
   * placed around the "Deliver here" button — which is also what performs the
   * save. A guest has nothing to confirm, so their typing is ready at once.
   */
  onChoose: (
    value: ChosenAddress,
    savedId: string | null,
    ready: boolean
  ) => void;
  /** Reload the list after a save, so a new address appears selected. */
  onBookChanged: (selectId: string) => void | Promise<void>;
  disabled?: boolean;
}) {
  const isGuest = addresses === null;
  const book = addresses ?? [];
  const hasBook = book.length > 0;

  // "add" also covers the guest and empty-book cases, where there is nothing
  // to pick from and the form is the whole step.
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<AddressDraft>(EMPTY_ADDRESS);
  const [saveToBook, setSaveToBook] = useState(true);
  const [saving, setSaving] = useState(false);
  // What was selected before "Add a new address" was pressed, so Cancel puts
  // exactly that back rather than guessing at the default.
  const previousId = useRef<string | null>(null);

  const selected = book.find((a) => a.id === selectedId) ?? null;
  const showForm = adding || !hasBook;
  // A guest has no address book, so there is nothing to confirm or save.
  const showConfirm = showForm && !isGuest;

  function updateDraft(next: AddressDraft) {
    setDraft(next);
    onChoose(toChosen(next), null, isGuest);
  }

  function startAdd() {
    previousId.current = selectedId;
    const blank = { ...EMPTY_ADDRESS, isDefault: !hasBook };
    setDraft(blank);
    setSaveToBook(true);
    setAdding(true);
    setExpanded(false);
    onChoose(toChosen(blank), null, false);
  }

  function cancelAdd() {
    setAdding(false);
    // Put the previous address back, so cancelling cannot leave the order
    // pointing at a half-typed one.
    const fallback =
      book.find((a) => a.id === previousId.current) ??
      book.find((a) => a.isDefault) ??
      book[0];
    if (fallback) onChoose(toChosen(fallback), fallback.id, true);
  }

  async function useThisAddress() {
    if (!draftIsComplete(draft)) {
      toast.error("Please complete the address, including a 6-digit pincode.");
      return;
    }

    if (!saveToBook) {
      // Used for this order only — deliberately not written to the book.
      onChoose(toChosen(draft), null, true);
      setAdding(false);
      return;
    }

    setSaving(true);
    const res = await saveAddress(draft);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Address saved to your account");
    onChoose(toChosen(draft), res.id, true);
    setAdding(false);
    await onBookChanged(res.id);
  }

  /* ---------- loading ---------- */
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your saved
        addresses…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ---------- the chosen address, collapsed ---------- */}
      {hasBook && !showForm && !expanded && (
        <div className="rounded-lg border border-foreground bg-muted/40 p-4">
          <div className="flex items-start justify-between gap-3">
            {selected ? (
              <AddressSummary address={selected} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Choose where this order should go.
              </p>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={() => setExpanded(true)}
              className="inline-flex min-h-11 shrink-0 cursor-pointer items-center text-xs uppercase tracking-widest text-accent transition-colors hover:text-foreground"
            >
              Change
            </button>
          </div>
        </div>
      )}

      {/* ---------- the list ---------- */}
      {hasBook && !showForm && expanded && (
        <>
          <ul className="space-y-2">
            {book.map((a) => {
              const active = a.id === selectedId;
              return (
                <li key={a.id}>
                  <div
                    className={cn(
                      "rounded-lg border p-4 transition-colors",
                      active
                        ? "border-foreground bg-muted/40"
                        : "border-border hover:border-foreground/40"
                    )}
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="radio"
                        name="checkout-address"
                        className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
                        checked={active}
                        disabled={disabled}
                        onChange={() => onChoose(toChosen(a), a.id, true)}
                      />
                      <AddressSummary address={a} />
                    </label>
                    <div className="mt-3 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant={active ? "primary" : "outline"}
                        disabled={disabled}
                        onClick={() => {
                          onChoose(toChosen(a), a.id, true);
                          setExpanded(false);
                        }}
                      >
                        {active && <Check className="h-4 w-4" />}
                        Deliver here
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={startAdd}
            >
              <Plus className="h-4 w-4" /> Add a new address
            </Button>
            <Link
              href="/account?tab=addresses"
              className="text-sm text-accent underline-offset-4 hover:underline"
            >
              Manage addresses
            </Link>
          </div>
        </>
      )}

      {/* ---------- add / plain form ----------
          Conditionally rendered, never hidden with a transform. */}
      {showForm && (
        <div className="rounded-lg border border-border p-4 sm:p-5">
          {hasBook && (
            <h3 className="mb-4 font-serif text-lg">Add a new address</h3>
          )}

          <AddressFields
            value={draft}
            onChange={updateDraft}
            disabled={disabled || saving}
            // The book's tags and default flag are meaningless for a guest, or
            // for an address the customer has chosen not to keep.
            showDefaultToggle={!isGuest && saveToBook && hasBook}
            // Optional while a saved address is already carrying the order —
            // native `required` would otherwise block the checkout submit.
            required={!hasBook}
          />

          {!isGuest && (
            <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={saveToBook}
                disabled={disabled || saving}
                onChange={(e) => setSaveToBook(e.target.checked)}
                className="h-5 w-5 shrink-0 accent-[var(--accent)]"
              />
              <span className="text-sm">
                Save this address to my account
                <InfoTip term="Saved addresses">
                  Saved addresses are offered at every future checkout, so you
                  never type this again. You can edit or delete them any time
                  from your account.
                </InfoTip>
              </span>
            </label>
          )}

          {/* Shown for an empty book too, not just when adding on top of one:
              this button is what performs the save, so without it the "save
              this address" offer could never be honoured. A guest has nothing
              to confirm and submits through the checkout button instead. */}
          {showConfirm && (
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={disabled || saving}
                onClick={useThisAddress}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  "Deliver here"
                )}
              </Button>
              {hasBook && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={disabled || saving}
                  onClick={cancelAdd}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------- first-time hint ---------- */}
      {!hasBook && !isGuest && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Keep the box ticked and this address is waiting for you next time —
          you will not have to type it again.
        </p>
      )}
    </div>
  );
}
