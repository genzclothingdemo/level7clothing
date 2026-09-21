"use client";

/**
 * settings-form — the shell of Admin → Settings.
 *
 * It owns one draft of every editable column and hands slices of it to the
 * section on screen. The tab is presentation only.
 *
 * Why that matters: the screen used to be one long form, and the sections that
 * moved out of it (returns, refunds, the order pipeline) left behind fields
 * that were still round-tripped through the payload. A tabbed form that
 * mounted only the visible tab would make that worse — every save would write
 * back whatever the unmounted tabs were initialised with. Here there is one
 * state object, one baseline, and a save bar that names every field that
 * differs. What you see listed is exactly what will be written.
 *
 * The tab lives in `?tab=` so a section can be linked to and the back button
 * behaves, but it is changed with `window.history.replaceState` rather than
 * `router.replace`: Next integrates that with the router without re-running
 * the server component, so switching tabs costs nothing and — the real point —
 * cannot remount the form and drop an unsaved edit.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateSettings } from "@/app/actions/admin";
import {
  DEFAULT_TAB,
  FIELD_META,
  SETTINGS_PANEL_ID,
  SaveBar,
  SettingsTabs,
  TABS,
  changedKeys,
  countByTab,
  isTabKey,
  type DraftKey,
  type SettingsDraft,
  type TabKey,
} from "@/components/admin/settings-ui";
import {
  BrandSection,
  ContactSection,
  CopySection,
  EmailSection,
  PaymentsSection,
  ProductSection,
  ShippingSection,
  type SectionProps,
  type SettingsFacts,
} from "@/components/admin/settings-sections";

const SECTIONS: Record<TabKey, (p: SectionProps) => React.ReactElement> = {
  brand: BrandSection,
  contact: ContactSection,
  copy: CopySection,
  payments: PaymentsSection,
  shipping: ShippingSection,
  product: ProductSection,
  email: EmailSection,
};

export function SettingsForm({
  initial,
  facts,
  initialTab,
}: {
  initial: SettingsDraft;
  facts: SettingsFacts;
  /** Read from `?tab=` on the server, so the first paint is already correct. */
  initialTab: TabKey;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [saving, setSaving] = useState(false);

  // `saved` is the last value known to be in the database; `draft` is what is
  // being edited. Comparing the two is what makes the dirty list honest — and
  // `saved` is rebased from the action's response, not from what was typed.
  const [saved, setSaved] = useState<SettingsDraft>(initial);
  const [draft, setDraft] = useState<SettingsDraft>(initial);

  const dirty = useMemo(() => changedKeys(draft, saved), [draft, saved]);
  const dirtyByTab = useMemo(() => countByTab(dirty), [dirty]);
  const dirtySet = useMemo(() => new Set(dirty), [dirty]);

  const set = useCallback(
    <K extends DraftKey>(key: K, value: SettingsDraft[K]) => {
      setDraft((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
    },
    []
  );

  const isDirty = useCallback((key: DraftKey) => dirtySet.has(key), [dirtySet]);

  /* ---- Tab ↔ URL ------------------------------------------------- */

  function selectTab(next: TabKey) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === DEFAULT_TAB) url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  // Back/forward still move between tabs, because the URL is the record even
  // though it was written without a navigation.
  useEffect(() => {
    function onPop() {
      const q = new URLSearchParams(window.location.search).get("tab");
      setTab(isTabKey(q ?? undefined) ? (q as TabKey) : DEFAULT_TAB);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /* ---- Don't lose an edit to a stray click ----------------------- */

  // The tab bar cannot drop an edit (nothing unmounts), but the sidebar and
  // the browser can. Keyed on the boolean rather than the count, so the
  // listener is attached once when the form first goes dirty instead of being
  // rebuilt on every keystroke.
  const hasUnsaved = dirty.length > 0;
  useEffect(() => {
    if (!hasUnsaved) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Required by Chrome; the string itself is never displayed.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsaved]);

  /* ---- Save ------------------------------------------------------ */

  async function save() {
    if (dirty.length === 0 || saving) return;
    setSaving(true);

    const res = await updateSettings({
      brandName: draft.brandName,
      tagline: draft.tagline,
      logoUrl: draft.logoUrl || null,
      announcement: draft.announcement || null,
      heroHeadline: draft.heroHeadline,
      heroSubtext: draft.heroSubtext,
      aboutText: draft.aboutText,
      contactEmail: draft.contactEmail,
      contactPhone: draft.contactPhone,
      whatsapp: draft.whatsapp || null,
      address: draft.address || null,
      instagram: draft.instagram || null,
      facebook: draft.facebook || null,
      adminNotifyEmail: draft.adminNotifyEmail,
      freeShippingThreshold: draft.freeShippingThreshold.trim()
        ? Number(draft.freeShippingThreshold)
        : null,
      codEnabled: draft.codEnabled,
      prepaidEnabled: draft.prepaidEnabled,
      partialEnabled: draft.partialEnabled,
      directEnabled: draft.directEnabled,
      razorpayEnabled: draft.razorpayEnabled,
      nimbusEnabled: draft.nimbusEnabled,
      defaultMaterialsCare: draft.defaultMaterialsCare,
      defaultShippingInfo: draft.defaultShippingInfo,
    });

    setSaving(false);

    if (!res.ok) {
      toast.error(res.error || "Could not save");
      return;
    }

    // Rebase on what the database actually holds. The server trims and
    // normalises, so echoing the draft back would leave a field looking
    // unsaved forever — trailing space in, trailing space never matched.
    const s = res.settings;
    const next: SettingsDraft = {
      brandName: s.brandName,
      tagline: s.tagline,
      logoUrl: s.logoUrl ?? "",
      announcement: s.announcement ?? "",
      heroHeadline: s.heroHeadline,
      heroSubtext: s.heroSubtext,
      aboutText: s.aboutText,
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone,
      whatsapp: s.whatsapp ?? "",
      address: s.address ?? "",
      instagram: s.instagram ?? "",
      facebook: s.facebook ?? "",
      adminNotifyEmail: s.adminNotifyEmail,
      freeShippingThreshold:
        s.freeShippingThreshold == null ? "" : String(s.freeShippingThreshold),
      codEnabled: s.codEnabled,
      prepaidEnabled: s.prepaidEnabled,
      partialEnabled: s.partialEnabled,
      directEnabled: s.directEnabled,
      razorpayEnabled: s.razorpayEnabled,
      nimbusEnabled: s.nimbusEnabled,
      defaultMaterialsCare: s.defaultMaterialsCare,
      defaultShippingInfo: s.defaultShippingInfo,
    };
    setSaved(next);
    setDraft(next);

    toast.success(
      dirty.length === 1
        ? `${FIELD_META[dirty[0]].label} saved`
        : `${dirty.length} settings saved`
    );
    router.refresh();
  }

  function discard() {
    setDraft(saved);
  }

  const Section = SECTIONS[tab];
  const heading = TABS.find((t) => t.key === tab)?.heading ?? "";

  return (
    <div className="max-w-3xl">
      <SettingsTabs tab={tab} onChange={selectTab} dirtyByTab={dirtyByTab} />

      <div
        id={SETTINGS_PANEL_ID}
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        className="mt-4 min-w-0"
      >
        <h2 className="sr-only">{heading}</h2>
        <Section f={draft} set={set} isDirty={isDirty} facts={facts} />
      </div>

      <SaveBar keys={dirty} saving={saving} onSave={save} onDiscard={discard} />
    </div>
  );
}
