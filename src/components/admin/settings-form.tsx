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
 *
 * ## One save bar, two writers
 *
 * The order-pipeline columns moved in from `/admin/orders`, and they keep their
 * own scoped action. So a save can dispatch to two places, and it dispatches
 * **only what is dirty**: nothing is round-tripped "unchanged" through an
 * action that does not own it, which is the shape of the `defaultReturnsInfo`
 * lost update CLAUDE.md records. If one half fails the other is still rebased
 * on what the database took, and the toast names which half did not land —
 * "saved" over a half-written save is the one outcome worth avoiding.
 *
 * The return policy is a third writer and is deliberately NOT here: it is
 * mounted as `ReturnPolicyCard`, which carries its own draft and its own Save.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateOrderPipelineSettings, updateSettings } from "@/app/actions/admin";
import {
  DEFAULT_TAB,
  FIELD_META,
  SETTINGS_PANEL_ID,
  SaveBar,
  SettingsTabs,
  TABS,
  changedKeys,
  countByTab,
  isPipelineKey,
  isTabKey,
  type DraftKey,
  type SettingsDraft,
  type TabKey,
} from "@/components/admin/settings-ui";
import {
  EmailSection,
  OrdersSection,
  PaymentsSection,
  ReturnsSection,
  ShippingSection,
  StoreSection,
  StorefrontSection,
  type SectionProps,
  type SettingsFacts,
} from "@/components/admin/settings-sections";

const SECTIONS: Record<TabKey, (p: SectionProps) => React.ReactElement> = {
  store: StoreSection,
  orders: OrdersSection,
  payments: PaymentsSection,
  shipping: ShippingSection,
  returns: ReturnsSection,
  storefront: StorefrontSection,
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

    // Split by owner. A group with nothing dirty is not sent at all, so the
    // action that owns those columns is not even called — nothing is ever
    // round-tripped "unchanged" through a writer that does not own it.
    const pipelineDirty = dirty.some(isPipelineKey);
    const settingsDirty = dirty.some((k) => !isPipelineKey(k));

    // Starts as the last-known-good baseline. Each group that lands overwrites
    // its own slice, so a group that fails is simply left at its old value and
    // stays listed as unsaved.
    let next: SettingsDraft = { ...saved };
    const failures: string[] = [];

    if (pipelineDirty) {
      const res = await updateOrderPipelineSettings({
        orderConfirmMode: draft.orderConfirmMode,
        autoConfirmPrepaid: draft.autoConfirmPrepaid,
        autoConfirmPartial: draft.autoConfirmPartial,
        autoConfirmCod: draft.autoConfirmCod,
        autoShipOnConfirm: draft.autoShipOnConfirm,
        autoShipCourier: draft.autoShipCourier,
      });
      if (res.ok) next = { ...next, ...res.settings };
      else failures.push(res.error || "Order automation could not be saved");
    }

    if (!settingsDirty) {
      finish(next, failures);
      return;
    }

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

    if (!res.ok) {
      failures.push(res.error || "Branding & payments could not be saved");
    } else {
      // Rebase on what the database actually holds. The server trims and
      // normalises, so echoing the draft back would leave a field looking
      // unsaved forever — trailing space in, trailing space never matched.
      const s = res.settings;
      next = {
        ...next,
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
    }

    finish(next, failures);
  }

  /**
   * Land whichever groups succeeded and report honestly.
   *
   * On a clean save `draft` is rebased on `next` — the *server's* values, not
   * what was typed, so a trimmed trailing space doesn't leave a field looking
   * unsaved forever.
   *
   * On a partial failure the draft is left exactly as the operator typed it and
   * only `saved` moves. The dirty comparison then reports precisely the fields
   * that did not land, the save bar keeps naming them, and pressing Save again
   * retries only those. A green "saved" over a half-written save is the one
   * outcome worth going out of the way to avoid.
   */
  function finish(next: SettingsDraft, failures: string[]) {
    setSaving(false);
    setSaved(next);

    if (failures.length > 0) {
      toast.error(failures.join(" · "), { duration: 12000 });
      router.refresh();
      return;
    }

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
