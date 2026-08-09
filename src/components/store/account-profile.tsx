"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateProfile } from "@/app/actions/account";

export function AccountProfile({
  name,
  email,
  phone,
  address,
  city,
  state,
  pincode,
}: {
  name: string;
  email: string;
  phone: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({
    name,
    phone: phone ?? "",
    address: address ?? "",
    city: city ?? "",
    state: state ?? "",
    pincode: pincode ?? "",
  });
  const [loading, setLoading] = useState(false);

  function set(key: keyof typeof f, value: string) {
    setF((p) => ({ ...p, [key]: value }));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await updateProfile(f);
    setLoading(false);
    if (res.ok) {
      toast.success("Profile updated");
      setEditing(false);
      router.refresh();
    } else {
      toast.error(res.error || "Failed to update");
    }
  }

  const addressLine = [address, city, state, pincode].filter(Boolean).join(", ");

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-xl">Profile</h2>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-sm text-accent hover:underline"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={onSave} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm text-muted-foreground">
                Full name
              </span>
              <input
                required
                value={f.name}
                onChange={(e) => set("name", e.target.value)}
                className="input"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm text-muted-foreground">
                Phone
              </span>
              <input
                value={f.phone}
                onChange={(e) => set("phone", e.target.value)}
                className="input"
                placeholder="Optional"
              />
            </label>
          </div>
          <p className="border-t border-border pt-4 text-xs uppercase tracking-wider text-muted-foreground">
            Saved shipping address (prefilled at checkout)
          </p>
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted-foreground">
              Address
            </span>
            <input
              value={f.address}
              onChange={(e) => set("address", e.target.value)}
              className="input"
              placeholder="House no, street, area"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-sm text-muted-foreground">
                City
              </span>
              <input
                value={f.city}
                onChange={(e) => set("city", e.target.value)}
                className="input"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm text-muted-foreground">
                State
              </span>
              <input
                value={f.state}
                onChange={(e) => set("state", e.target.value)}
                className="input"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm text-muted-foreground">
                Pincode
              </span>
              <input
                value={f.pincode}
                onChange={(e) => set("pincode", e.target.value)}
                className="input"
              />
            </label>
          </div>
          <div className="flex gap-3">
            <Button type="submit" disabled={loading} size="sm">
              {loading ? (
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
              size="sm"
              onClick={() => {
                setEditing(false);
                setF({
                  name,
                  phone: phone ?? "",
                  address: address ?? "",
                  city: city ?? "",
                  state: state ?? "",
                  pincode: pincode ?? "",
                });
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium">{email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Phone</dt>
            <dd className="font-medium">{phone || "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="shrink-0 text-muted-foreground">Address</dt>
            <dd className="text-right font-medium">{addressLine || "—"}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
