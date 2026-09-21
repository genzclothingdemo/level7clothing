"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MapPin, Plus, Pencil, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/store/info-tip";
import {
  saveAddress,
  deleteAddress,
  setDefaultAddress,
  type SavedAddress,
} from "@/app/actions/addresses";
import {
  AddressFields,
  EMPTY_ADDRESS,
  toDraft,
  type AddressDraft,
} from "./address-fields";
import { AddressSummary } from "./address-card";

/**
 * The address book — the one place a customer's delivery addresses are
 * created, edited and deleted. `Address` rows are the source of truth; the
 * profile panel only mirrors the default, and checkout only picks from this
 * list. See the header comment in `src/app/actions/addresses.ts`.
 */

// Re-exported so existing imports keep working now that the canonical type
// lives next to the queries that produce it.
export type { SavedAddress };

export function AddressBook({ addresses }: { addresses: SavedAddress[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AddressDraft>(EMPTY_ADDRESS);
  const [saving, setSaving] = useState(false);
  // Two-step delete. An inline confirm rather than `window.confirm`, which is
  // easy to dismiss by accident on a phone and cannot be styled.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const editingDefault =
    editingId !== null &&
    addresses.find((a) => a.id === editingId)?.isDefault === true;

  function startAdd() {
    setForm({
      ...EMPTY_ADDRESS,
      // First address in an empty book is the default, and the server enforces
      // it anyway — showing it ticked stops that looking like a surprise.
      isDefault: addresses.length === 0,
    });
    setEditingId(null);
    setShowForm(true);
  }

  function startEdit(a: SavedAddress) {
    setForm(toDraft(a));
    setEditingId(a.id);
    setShowForm(true);
    setConfirmingId(null);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await saveAddress({ ...form, id: editingId ?? undefined });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(editingId ? "Address updated" : "Address saved");
    closeForm();
    startTransition(() => router.refresh());
  }

  async function onDelete(id: string) {
    setBusyId(id);
    const res = await deleteAddress(id);
    setBusyId(null);
    setConfirmingId(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Address deleted");
    if (editingId === id) closeForm();
    startTransition(() => router.refresh());
  }

  async function onMakeDefault(id: string) {
    setBusyId(id);
    const res = await setDefaultAddress(id);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Default address updated");
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Saved here once, offered at every checkout.
          <InfoTip term="Default address">
            The address checkout starts on. You can still switch to any other
            saved address before you place an order.
          </InfoTip>
        </p>
        {!showForm && (
          <Button variant="outline" size="sm" onClick={startAdd}>
            <Plus className="h-4 w-4" /> Add address
          </Button>
        )}
      </div>

      {addresses.length === 0 && !showForm && (
        <div className="mt-4 rounded-lg border border-dashed border-border p-8 text-center sm:p-10">
          <MapPin className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No saved addresses yet. Add one and checkout fills itself in.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Button size="sm" onClick={startAdd}>
              <Plus className="h-4 w-4" /> Add an address
            </Button>
            {/* No dead end: nothing to manage yet, so offer the way forward. */}
            <Link
              href="/shop"
              className="text-sm text-accent underline-offset-4 hover:underline"
            >
              Browse the shop
            </Link>
          </div>
        </div>
      )}

      {addresses.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {addresses.map((a) => (
            <li
              key={a.id}
              className="flex flex-col rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <AddressSummary address={a} />
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => startEdit(a)}
                    className="grid h-11 w-11 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={`Edit ${a.label} address`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(a.id)}
                    className="grid h-11 w-11 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                    aria-label={`Delete ${a.label} address`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {confirmingId === a.id ? (
                <div className="mt-3 rounded-md border border-danger/30 bg-danger/5 p-3">
                  <p className="text-xs text-muted-foreground">
                    Delete this address?
                    {a.isDefault && " Another address becomes your default."}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={busyId === a.id}
                      onClick={() => onDelete(a.id)}
                    >
                      {busyId === a.id ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Deleting…
                        </>
                      ) : (
                        "Delete"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmingId(null)}
                    >
                      Keep
                    </Button>
                  </div>
                </div>
              ) : (
                !a.isDefault && (
                  <button
                    type="button"
                    disabled={busyId === a.id}
                    onClick={() => onMakeDefault(a.id)}
                    className="mt-auto inline-flex min-h-11 cursor-pointer items-center gap-1.5 self-start text-xs uppercase tracking-widest text-accent transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    {busyId === a.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Set as default
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Conditionally rendered, never parked offscreen with a transform —
          see the "Modal pattern" note in CLAUDE.md. */}
      {showForm && (
        <form
          onSubmit={onSubmit}
          className="mt-4 rounded-lg border border-border bg-card p-4 sm:p-5"
        >
          <h3 className="font-serif text-lg">
            {editingId ? "Edit address" : "Add a new address"}
          </h3>
          <div className="mt-4">
            <AddressFields
              value={form}
              onChange={setForm}
              lockedDefault={editingDefault}
              disabled={saving}
            />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : editingId ? (
                "Update address"
              ) : (
                "Save address"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={closeForm}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
