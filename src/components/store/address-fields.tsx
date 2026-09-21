"use client";

import { useId } from "react";
import { Home, Briefcase, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SavedAddress } from "@/app/actions/addresses";

/**
 * THE address form. There is exactly one.
 *
 * Before this existed the same seven fields were written out three times — in
 * the profile panel, in the address book, and again in checkout-client — and
 * the three copies had drifted apart (different labels, different required
 * flags, different validation). Anything that needs to collect an address
 * renders `AddressFields`; the surrounding chrome (buttons, headings, whether
 * it saves to the book) is the caller's business.
 */

/** The three tags the customer can file an address under. */
export const ADDRESS_LABELS = ["Home", "Work", "Other"] as const;
export type AddressLabel = (typeof ADDRESS_LABELS)[number];

const LABEL_ICON: Record<AddressLabel, typeof Home> = {
  Home,
  Work: Briefcase,
  Other: MapPin,
};

/** What the form holds. Mirrors `Address` minus the id and timestamps. */
export type AddressDraft = {
  label: string;
  fullName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
};

export const EMPTY_ADDRESS: AddressDraft = {
  label: "Home",
  fullName: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  isDefault: false,
};

export function toDraft(a: SavedAddress): AddressDraft {
  return {
    label: a.label,
    fullName: a.fullName,
    phone: a.phone,
    address: a.address,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    isDefault: a.isDefault,
  };
}

/** "12 MG Road, Indiranagar, Bengaluru, Karnataka 560038" */
export function formatAddressLine(a: {
  address: string;
  city: string;
  state: string;
  pincode: string;
}): string {
  return `${a.address}, ${a.city}, ${a.state} ${a.pincode}`;
}

/** The tag pill shown on a saved address card. */
export function AddressLabelTag({ label }: { label: string }) {
  const known = (ADDRESS_LABELS as readonly string[]).includes(label)
    ? (label as AddressLabel)
    : "Other";
  const Icon = LABEL_ICON[known];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}

export function AddressFields({
  value,
  onChange,
  /**
   * True while editing the account's current default. The box is shown ticked
   * and disabled: a default can be moved to another address but not switched
   * off, or the account would be left with none.
   */
  lockedDefault = false,
  /** Hidden at checkout when the customer has chosen not to save the address. */
  showDefaultToggle = true,
  /**
   * Off when these fields sit inside a larger form they must not block — the
   * checkout's "add a new address" panel is optional while a saved address is
   * already selected, so native `required` there would refuse the order.
   * Those callers validate on their own confirm button instead.
   */
  required = true,
  disabled = false,
}: {
  value: AddressDraft;
  onChange: (next: AddressDraft) => void;
  lockedDefault?: boolean;
  showDefaultToggle?: boolean;
  required?: boolean;
  disabled?: boolean;
}) {
  const uid = useId();
  const set = <K extends keyof AddressDraft>(k: K, v: AddressDraft[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Label picker — radios, not a <select>, so the three choices are one
          tap each on a phone. 44px tall to stay above the touch minimum. */}
      <fieldset className="sm:col-span-2">
        <legend className="eyebrow mb-2 text-muted-foreground">
          Save this as
        </legend>
        <div className="flex flex-wrap gap-2">
          {ADDRESS_LABELS.map((l) => {
            const Icon = LABEL_ICON[l];
            const active = value.label === l;
            return (
              <label
                key={l}
                className={cn(
                  "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm transition-colors",
                  active
                    ? "border-foreground bg-muted/60 text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                  disabled && "pointer-events-none opacity-50"
                )}
              >
                <input
                  type="radio"
                  name={`${uid}-label`}
                  className="sr-only"
                  checked={active}
                  disabled={disabled}
                  onChange={() => set("label", l)}
                />
                <Icon className="h-4 w-4" aria-hidden="true" />
                {l}
              </label>
            );
          })}
        </div>
      </fieldset>

      <Field label="Full name" required htmlFor={`${uid}-name`}>
        <input
          id={`${uid}-name`}
          required={required}
          disabled={disabled}
          autoComplete="name"
          value={value.fullName}
          onChange={(e) => set("fullName", e.target.value)}
          className="input"
        />
      </Field>

      <Field label="Phone" required htmlFor={`${uid}-phone`}>
        <input
          id={`${uid}-phone`}
          required={required}
          disabled={disabled}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={value.phone}
          onChange={(e) => set("phone", e.target.value)}
          className="input"
        />
      </Field>

      <Field
        label="Address"
        required
        htmlFor={`${uid}-address`}
        className="sm:col-span-2"
      >
        <textarea
          id={`${uid}-address`}
          required={required}
          rows={2}
          disabled={disabled}
          autoComplete="street-address"
          value={value.address}
          onChange={(e) => set("address", e.target.value)}
          placeholder="Flat / house no, street, landmark"
          className="input resize-none"
        />
      </Field>

      <Field label="Pincode" required htmlFor={`${uid}-pincode`}>
        <input
          id={`${uid}-pincode`}
          required={required}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          value={value.pincode}
          // Digits only: the server rejects anything else and a stray space
          // pasted from a contact card is the usual cause.
          onChange={(e) => set("pincode", e.target.value.replace(/\D/g, ""))}
          className="input"
        />
      </Field>

      <Field label="City" required htmlFor={`${uid}-city`}>
        <input
          id={`${uid}-city`}
          required={required}
          disabled={disabled}
          autoComplete="address-level2"
          value={value.city}
          onChange={(e) => set("city", e.target.value)}
          className="input"
        />
      </Field>

      <Field
        label="State"
        required
        htmlFor={`${uid}-state`}
        className="sm:col-span-2"
      >
        <input
          id={`${uid}-state`}
          required={required}
          disabled={disabled}
          autoComplete="address-level1"
          value={value.state}
          onChange={(e) => set("state", e.target.value)}
          className="input"
        />
      </Field>

      {showDefaultToggle && (
        <label
          className={cn(
            "flex min-h-11 items-center gap-2.5 sm:col-span-2",
            lockedDefault || disabled ? "cursor-default" : "cursor-pointer"
          )}
        >
          <input
            type="checkbox"
            checked={lockedDefault || value.isDefault}
            disabled={lockedDefault || disabled}
            onChange={(e) => set("isDefault", e.target.checked)}
            className="h-5 w-5 shrink-0 accent-[var(--accent)]"
          />
          <span className="text-sm">
            {lockedDefault ? (
              <>
                This is your default address
                <span className="block text-xs text-muted-foreground">
                  Set another address as default to move it.
                </span>
              </>
            ) : (
              "Use this as my default address"
            )}
          </span>
        </label>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  htmlFor,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("block min-w-0", className)}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-sm text-muted-foreground"
      >
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children}
    </div>
  );
}
