"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import { Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateSettings } from "@/app/actions/admin";
import type { SettingsDTO } from "@/lib/types";

export function SettingsForm({ initial }: { initial: SettingsDTO }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [f, setF] = useState({
    ...initial,
    freeShippingThreshold:
      initial.freeShippingThreshold != null
        ? String(initial.freeShippingThreshold)
        : "",
    logoUrl: initial.logoUrl ?? "",
    whatsapp: initial.whatsapp ?? "",
    address: initial.address ?? "",
    instagram: initial.instagram ?? "",
    facebook: initial.facebook ?? "",
    announcement: initial.announcement ?? "",
    razorpayEnabled: initial.razorpayEnabled ?? false,
    nimbusEnabled: initial.nimbusEnabled ?? false,
  });

  function set<K extends keyof typeof f>(key: K, value: (typeof f)[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
  }

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok && data.url) set("logoUrl", data.url);
      else toast.error(data.error || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await updateSettings({
      brandName: f.brandName,
      tagline: f.tagline,
      logoUrl: f.logoUrl || null,
      heroHeadline: f.heroHeadline,
      heroSubtext: f.heroSubtext,
      aboutText: f.aboutText,
      contactEmail: f.contactEmail,
      contactPhone: f.contactPhone,
      whatsapp: f.whatsapp || null,
      address: f.address || null,
      instagram: f.instagram || null,
      facebook: f.facebook || null,
      adminNotifyEmail: f.adminNotifyEmail,
      currency: f.currency,
      freeShippingThreshold: f.freeShippingThreshold
        ? Number(f.freeShippingThreshold)
        : null,
      codEnabled: f.codEnabled,
      prepaidEnabled: f.prepaidEnabled,
      partialEnabled: f.partialEnabled,
      directEnabled: f.directEnabled,
      razorpayEnabled: f.razorpayEnabled,
      nimbusEnabled: f.nimbusEnabled,
      announcement: f.announcement || null,
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Settings saved");
      router.refresh();
    } else {
      toast.error(res.error || "Could not save");
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-6">
      <Card title="Brand identity">
        <Text label="Brand name" value={f.brandName} onChange={(v) => set("brandName", v)} />
        <Text label="Tagline" value={f.tagline} onChange={(v) => set("tagline", v)} />

        <div>
          <span className="label">Logo</span>
          <div className="flex items-center gap-4">
            {f.logoUrl ? (
              <div className="relative h-14 w-40 overflow-hidden rounded-lg border border-border bg-muted">
                <Image
                  src={f.logoUrl}
                  alt="Logo"
                  fill
                  sizes="160px"
                  className="object-contain p-1"
                />
                <button
                  type="button"
                  onClick={() => set("logoUrl", "")}
                  className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                No logo — your brand name is shown as text.
              </span>
            )}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted">
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Upload logo
              <input
                type="file"
                accept="image/*"
                onChange={onLogo}
                className="hidden"
                disabled={uploading}
              />
            </label>
          </div>
          <input
            type="text"
            value={f.logoUrl}
            onChange={(e) => set("logoUrl", e.target.value)}
            placeholder="…or paste an image URL / local path (e.g. /level7-logo.png)"
            className="input mt-2"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Uploading needs a Vercel Blob store configured — pasting a URL or a
            path to a file in <code>/public</code> always works.
          </p>
        </div>

        <Text
          label="Announcement bar (leave empty to hide)"
          value={f.announcement}
          onChange={(v) => set("announcement", v)}
        />
      </Card>

      <Card title="Homepage content">
        <Text
          label="Hero headline"
          value={f.heroHeadline}
          onChange={(v) => set("heroHeadline", v)}
        />
        <Area
          label="Hero subtext"
          value={f.heroSubtext}
          onChange={(v) => set("heroSubtext", v)}
        />
        <Area
          label="About text"
          value={f.aboutText}
          onChange={(v) => set("aboutText", v)}
        />
      </Card>

      <Card title="Contact information">
        <div className="grid gap-4 sm:grid-cols-2">
          <Text
            label="Contact email"
            type="email"
            value={f.contactEmail}
            onChange={(v) => set("contactEmail", v)}
          />
          <Text
            label="Contact phone"
            value={f.contactPhone}
            onChange={(v) => set("contactPhone", v)}
          />
          <Text
            label="WhatsApp number (with country code)"
            value={f.whatsapp}
            onChange={(v) => set("whatsapp", v)}
          />
          <Text
            label="Studio address"
            value={f.address}
            onChange={(v) => set("address", v)}
          />
          <Text
            label="Instagram URL"
            value={f.instagram}
            onChange={(v) => set("instagram", v)}
          />
          <Text
            label="Facebook URL"
            value={f.facebook}
            onChange={(v) => set("facebook", v)}
          />
        </div>
      </Card>

      <Card title="Orders & notifications">
        <Text
          label="Send order & lead emails to"
          type="email"
          value={f.adminNotifyEmail}
          onChange={(v) => set("adminNotifyEmail", v)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Text
            label="Free shipping above (₹, optional)"
            type="number"
            value={f.freeShippingThreshold}
            onChange={(v) => set("freeShippingThreshold", v)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Shipping is now set per product (Free / Fixed / NimbusPost + markup) —
          edit it on each product&apos;s page under &quot;Shipping settings &amp; parcel
          size&quot;.
        </p>
      </Card>

      <Card title="Payment methods">
        <p className="text-sm text-muted-foreground">
          Turn each checkout method on or off for the whole store. A method
          appears at checkout only when it&apos;s ON here <b>and</b> the product
          allows it (set per product in the product editor).
        </p>
        <Toggle
          label="Cash on Delivery"
          description="Customer pays in full when the order is delivered."
          checked={f.codEnabled}
          onChange={(v) => set("codEnabled", v)}
        />
        <Toggle
          label="Prepaid — Pay Online"
          description="Full payment online via Razorpay. Requires Razorpay turned on below."
          checked={f.prepaidEnabled}
          onChange={(v) => set("prepaidEnabled", v)}
        />
        <Toggle
          label="Advance Payment (Advance + COD)"
          description="Customer pays a non-refundable advance online; balance is collected on delivery. Requires Razorpay."
          checked={f.partialEnabled}
          onChange={(v) => set("partialEnabled", v)}
        />
        <Toggle
          label="Customised Order (Pay to Owner)"
          description="No online payment — the order is placed as a request and you arrange payment directly. Non-refundable."
          checked={f.directEnabled}
          onChange={(v) => set("directEnabled", v)}
        />
      </Card>

      <Card title="Integrations">
        <p className="text-sm text-muted-foreground">
          Master switches for the payment gateway and courier. Prepaid & Advance
          methods need Razorpay ON; automated dispatch needs NimbusPost ON.
        </p>
        <Toggle
          label="Razorpay online payments"
          description="Powers Prepaid & Advance payment at checkout. Requires Razorpay keys in the environment."
          checked={f.razorpayEnabled}
          onChange={(v) => set("razorpayEnabled", v)}
        />
        <Toggle
          label="NimbusPost automated shipping"
          description="Create shipments + AWB from order cards. Requires NimbusPost credentials in the environment."
          checked={f.nimbusEnabled}
          onChange={(v) => set("nimbusEnabled", v)}
        />
      </Card>

      <div className="sticky bottom-4 flex justify-end">
        <Button type="submit" disabled={saving} size="lg" className="shadow-lg">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            "Save settings"
          )}
        </Button>
      </div>
    </form>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-4 font-serif text-lg">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input"
      />
    </label>
  );
}

function Area({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input resize-none"
      />
    </label>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-xl border border-border px-4 py-3 text-sm text-left"
    >
      <span>
        <span className="block font-medium">{label}</span>
        {description && (
          <span className="block text-xs text-muted-foreground mt-0.5">
            {description}
          </span>
        )}
      </span>
      <span
        className={`relative ml-4 h-6 w-11 shrink-0 rounded-full transition-colors ${
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
