"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateReturnDefaults } from "@/app/actions/returns";

/**
 * The store-wide return policy — the single editor for it. The same copy used to
 * live under Branding & settings › Product defaults; it moved here so returns
 * have one owner screen, and that box now links across instead of duplicating
 * the field.
 */
export function ReturnDefaults({
  initial,
}: {
  initial: {
    returnsEnabled: boolean;
    defaultReturnable: boolean;
    returnWindowDays: number;
    defaultReturnsInfo: string;
  };
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    ...initial,
    returnWindowDays: String(initial.returnWindowDays),
  });

  const points = f.defaultReturnsInfo.split("\n").filter((l) => l.trim()).length;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await updateReturnDefaults({
      returnsEnabled: f.returnsEnabled,
      defaultReturnable: f.defaultReturnable,
      returnWindowDays: Number(f.returnWindowDays || 7),
      defaultReturnsInfo: f.defaultReturnsInfo,
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Return policy saved");
      router.refresh();
    } else {
      toast.error(res.error || "Could not save");
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-border bg-card p-5"
    >
      <h2 className="font-serif text-lg">Return policy</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Applies to every product unless that product overrides it under{" "}
        <b>Products → Product information</b>. Personalised pieces are usually the
        exception.
      </p>

      <div className="mt-4 space-y-3">
        <Toggle
          label="Accept return requests"
          description="Master switch. Turning this off hides the request form on every order, whatever an individual product says — use it to close returns during a rush."
          checked={f.returnsEnabled}
          onChange={(v) => setF((p) => ({ ...p, returnsEnabled: v }))}
          icon={f.returnsEnabled ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
        />

        <div
          className={
            f.returnsEnabled ? "space-y-3" : "pointer-events-none space-y-3 opacity-50"
          }
        >
          <Toggle
            label="Products are returnable by default"
            description="Off means nothing is returnable unless a product explicitly opts in."
            checked={f.defaultReturnable}
            onChange={(v) => setF((p) => ({ ...p, defaultReturnable: v }))}
          />

          <label className="block max-w-xs">
            <span className="label">Return window (days after delivery)</span>
            <input
              type="number"
              min={1}
              max={90}
              value={f.returnWindowDays}
              onChange={(e) =>
                setF((p) => ({ ...p, returnWindowDays: e.target.value }))
              }
              className="input"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Counted from the delivery date. Requests are refused after this.
            </span>
          </label>

          <label className="block">
            <span className="label flex items-baseline justify-between gap-2">
              <span>Policy shown to customers</span>
              <span className="text-xs font-normal text-muted-foreground">
                {points === 0
                  ? "hidden on product pages"
                  : `${points} bullet${points === 1 ? "" : "s"}`}
              </span>
            </span>
            <textarea
              rows={5}
              value={f.defaultReturnsInfo}
              onChange={(e) =>
                setF((p) => ({ ...p, defaultReturnsInfo: e.target.value }))
              }
              placeholder="One point per line"
              className="input resize-y font-mono text-xs leading-relaxed"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              This is the <b>Returns &amp; Refunds</b> section on every product page.
              One point per line.
            </span>
          </label>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            "Save policy"
          )}
        </Button>
      </div>
    </form>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  icon,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-border px-4 py-3 text-left text-sm"
    >
      <span>
        <span className="flex items-center gap-2 font-medium">
          {icon}
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      <span
        className={`relative ml-2 h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? "left-0.5 translate-x-5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
