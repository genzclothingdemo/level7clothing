"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MapPin, Plus, Pencil, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  saveAddress,
  deleteAddress,
  setDefaultAddress,
} from "@/app/actions/addresses";

export type SavedAddress = {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
};

const EMPTY = {
  label: "Home",
  fullName: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  isDefault: false,
};

export function AddressBook({ addresses }: { addresses: SavedAddress[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function startAdd() {
    setForm({ ...EMPTY });
    setEditingId(null);
    setShowForm(true);
  }

  function startEdit(a: SavedAddress) {
    setForm({
      label: a.label,
      fullName: a.fullName,
      phone: a.phone,
      address: a.address,
      city: a.city,
      state: a.state,
      pincode: a.pincode,
      isDefault: a.isDefault,
    });
    setEditingId(a.id);
    setShowForm(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await saveAddress({ ...form, id: editingId ?? undefined });
    setSaving(false);
    if (res.ok) {
      toast.success(editingId ? "Address updated" : "Address saved");
      setShowForm(false);
      setEditingId(null);
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this address?")) return;
    const res = await deleteAddress(id);
    if (res.ok) {
      toast.success("Address deleted");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  async function onMakeDefault(id: string) {
    const res = await setDefaultAddress(id);
    if (res.ok) {
      toast.success("Default address updated");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-2xl">Saved addresses</h2>
        {!showForm && (
          <Button variant="outline" size="sm" onClick={startAdd}>
            <Plus className="h-4 w-4" /> Add address
          </Button>
        )}
      </div>

      {addresses.length === 0 && !showForm && (
        <div className="mt-4 rounded-2xl border border-dashed border-border p-10 text-center">
          <MapPin className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No saved addresses yet. Add one to speed up checkout.
          </p>
        </div>
      )}

      {addresses.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {addresses.map((a) => (
            <li
              key={a.id}
              className="rounded-2xl border border-border bg-card p-4 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{a.label}</span>
                  {a.isDefault && (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">
                      Default
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEdit(a)}
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                    aria-label="Edit address"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(a.id)}
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger cursor-pointer"
                    aria-label="Delete address"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <p className="mt-2 font-medium">{a.fullName}</p>
              <p className="text-muted-foreground">{a.phone}</p>
              <p className="mt-1 text-muted-foreground">
                {a.address}, {a.city}, {a.state} – {a.pincode}
              </p>
              {!a.isDefault && (
                <button
                  onClick={() => onMakeDefault(a.id)}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs text-accent hover:underline cursor-pointer"
                >
                  <Check className="h-3 w-3" /> Set as default
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <form
          onSubmit={onSubmit}
          className="mt-4 grid gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2"
        >
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted-foreground">
              Label
            </span>
            <input
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder="Home"
              className="input"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted-foreground">
              Full name *
            </span>
            <input
              required
              value={form.fullName}
              onChange={(e) => set("fullName", e.target.value)}
              className="input"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted-foreground">
              Phone *
            </span>
            <input
              required
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              className="input"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted-foreground">
              Pincode *
            </span>
            <input
              required
              inputMode="numeric"
              value={form.pincode}
              onChange={(e) => set("pincode", e.target.value)}
              className="input"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm text-muted-foreground">
              Address *
            </span>
            <textarea
              required
              rows={2}
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              className="input resize-none"
              placeholder="Flat / house no, street, landmark"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted-foreground">
              City *
            </span>
            <input
              required
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              className="input"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted-foreground">
              State *
            </span>
            <input
              required
              value={form.state}
              onChange={(e) => set("state", e.target.value)}
              className="input"
            />
          </label>

          <label className="flex cursor-pointer items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => set("isDefault", e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span className="text-sm">Use as my default address</span>
          </label>

          <div className="flex gap-2 sm:col-span-2">
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
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
