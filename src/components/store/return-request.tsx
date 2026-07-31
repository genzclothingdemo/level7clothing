"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestReturn } from "@/app/actions/returns";

const REASONS = [
  "Wrong size / doesn't fit",
  "Not as described",
  "Damaged or defective",
  "Received wrong item",
  "Changed my mind",
  "Other",
];

const SIZES = ["S", "M", "L", "XL", "2XL"];

export type ExistingRequest = {
  kind: string;
  status: string;
  createdAt: string;
};

export function ReturnRequest({
  orderId,
  orderStatus,
  existing,
}: {
  orderId: string;
  orderStatus: string;
  existing?: ExistingRequest | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    kind: "return" as "return" | "exchange",
    reason: REASONS[0],
    details: "",
    exchangeSize: "M",
  });

  if (existing) {
    return (
      <div className="mt-4 rounded-xl border border-border p-4 text-sm">
        <p className="font-medium capitalize">
          {existing.kind} request · {existing.status}
        </p>
        <p className="mt-1 text-muted-foreground">
          Submitted{" "}
          {new Date(existing.createdAt).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
          . We&apos;ll be in touch by email.
        </p>
      </div>
    );
  }

  // Only offer this once the parcel has actually landed.
  if (orderStatus !== "delivered") return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await requestReturn({
      orderId,
      kind: form.kind,
      reason: form.reason,
      details: form.details || undefined,
      exchangeSize: form.exchangeSize,
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Request submitted — we'll email you shortly.");
      setOpen(false);
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <div className="mt-4">
      {!open ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <RotateCcw className="h-4 w-4" /> Request return / exchange
        </Button>
      ) : (
        <form
          onSubmit={onSubmit}
          className="space-y-3 rounded-xl border border-border p-4"
        >
          <div className="flex gap-2">
            {(["return", "exchange"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setForm((f) => ({ ...f, kind: k }))}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize transition-colors ${
                  form.kind === k
                    ? "border-accent bg-accent/10"
                    : "border-border hover:border-foreground/40"
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs text-muted-foreground">
              Reason
            </span>
            <select
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              className="input"
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          {form.kind === "exchange" && (
            <label className="block">
              <span className="mb-1.5 block text-xs text-muted-foreground">
                Replacement size
              </span>
              <select
                value={form.exchangeSize}
                onChange={(e) =>
                  setForm((f) => ({ ...f, exchangeSize: e.target.value }))
                }
                className="input"
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="mb-1.5 block text-xs text-muted-foreground">
              Anything else? (optional)
            </span>
            <textarea
              rows={3}
              value={form.details}
              onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))}
              className="input resize-none"
              placeholder="Tell us a bit more so we can sort this quickly."
            />
          </label>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
                </>
              ) : (
                "Submit request"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
