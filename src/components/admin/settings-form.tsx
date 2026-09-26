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
 * ## One save bar, three writers
 *
 * The order-pipeline columns moved in from `/admin/orders` and keep their own
 * scoped action; the two cash-handling fees have a third
 * (`updatePaymentFees`, colocated with this route). So a save can dispatch to
 * three places, and it dispatches **only what is dirty**: nothing is
 * round-tripped "unchanged" through an action that does not own it, which is
 * the shape of the `defaultReturnsInfo` lost update CLAUDE.md records. If one
 * group fails the others are still rebased on what the database took, and the
 * toast names which did not land — "saved" over a half-written save is the one
 * outcome worth avoiding.
 *
 * The return policy is a fourth writer and is deliberately NOT here: it is
 * mounted as `ReturnPolicyCard`, which carries its own draft and its own Save.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateOrderPipelineSettings, updateSettings } from "@/app/actions/admin";
import { dispatchModeOf } from "@/lib/orders-pipeline";
import { InfoTip } from "@/components/store/info-tip";
import {
  updatePaymentFees,
  updateVerificationSettings,
} from "@/app/admin/(panel)/settings/actions";
import {
  DEFAULT_TAB,
  FIELD_META,
  SETTINGS_PANEL_ID,
  SaveBar,
  SettingsTabs,
  changedKeys,
  countByTab,
  isFeeKey,
  isPipelineKey,
  isVerifyKey,
  resolveTab,
  tabMeta,
  type DraftKey,
  type SettingsDraft,
  type TabKey,
} from "@/components/admin/settings-ui";
import {
  AccessSection,
  IntegrationsSection,
  OrdersSection,
  PaymentsSection,
  ReturnsSection,
  StoreSection,
  type SectionProps,
  type SettingsFacts,
} from "@/components/admin/settings-sections";

/**
 * One component per tab. `Record<TabKey, …>` is what makes this exhaustive —
 * adding a key to `TABS` without a section here is a type error rather than an
 * empty panel at runtime.
 *
 * `StorefrontSection` and `EmailSection` are gone: their controls moved inside
 * `StoreSection` when the three tabs merged.
 */
const SECTIONS: Record<TabKey, (p: SectionProps) => React.ReactElement> = {
  store: StoreSection,
  orders: OrdersSection,
  payments: PaymentsSection,
  integrations: IntegrationsSection,
  returns: ReturnsSection,
  add_admin: AccessSection,
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
      // Same resolver the server page uses, so a back/forward step onto a
      // retired `?tab=storefront` entry lands on the tab that absorbed it
      // rather than on whatever the default happens to be.
      setTab(resolveTab(new URLSearchParams(window.location.search).get("tab")));
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

    /**
     * A view-only holder is refused here so they are told *before* three
     * actions each refuse separately and toast three times.
     *
     * This is emphatically **not** the permission. All three writers route
     * through `requireAdminWrite` on the server, which refuses and records the
     * attempt whatever the browser chooses to send — a server action is a
     * public endpoint addressable by its id, so a check in this function is
     * worth exactly as much as a hidden button. It is here to give an honest
     * message, not to enforce one.
     */
    if (facts.viewerMode !== "full") {
      toast.error(
        "View-only access: this account can read every screen but cannot change anything. Ask the store owner for full access.",
        { duration: 10000 }
      );
      return;
    }

    /**
     * The one combination checkout cannot survive, refused before anything is
     * written.
     *
     * With "Direct" withdrawn there is no fourth mode to fall back to, so all
     * three off does not mean "pay the owner instead" — it means checkout has
     * nothing to offer and every order is refused. The server's own guard still
     * exists behind this, but it is phrased around the old four-method world;
     * this is the message that names what is actually about to happen.
     */
    if (!draft.codEnabled && !draft.prepaidEnabled && !draft.partialEnabled) {
      toast.error(
        "Leave at least one payment method on. With all three off, checkout has nothing to offer and every order is refused.",
        { duration: 10000 }
      );
      return;
    }

    setSaving(true);

    // Split by owner. A group with nothing dirty is not sent at all, so the
    // action that owns those columns is not even called — nothing is ever
    // round-tripped "unchanged" through a writer that does not own it.
    const pipelineDirty = dirty.some(isPipelineKey);
    const feesDirty = dirty.some(isFeeKey);
    const verifyDirty = dirty.some(isVerifyKey);
    const settingsDirty = dirty.some(
      (k) => !isPipelineKey(k) && !isFeeKey(k) && !isVerifyKey(k)
    );

    // Starts as the last-known-good baseline. Each group that lands overwrites
    // its own slice, so a group that fails is simply left at its old value and
    // stays listed as unsaved.
    let next: SettingsDraft = { ...saved };
    const failures: string[] = [];

    if (pipelineDirty) {
      // Q1 goes as the enum. The action derives the legacy `autoShipOnConfirm`
      // boolean from it and writes both columns in step, so this form never
      // sends that boolean — one decision, one value, one writer.
      const res = await updateOrderPipelineSettings({
        orderConfirmMode: draft.orderConfirmMode,
        autoConfirmPrepaid: draft.autoConfirmPrepaid,
        autoConfirmPartial: draft.autoConfirmPartial,
        autoConfirmCod: draft.autoConfirmCod,
        dispatchOnConfirm: draft.dispatchOnConfirm,
        autoShipCourier: draft.autoShipCourier,
      });
      if (res.ok) {
        // Rebased field by field rather than spread: `PipelineSettings` carries
        // `autoShipOnConfirm`, which is not part of this draft, and its
        // `dispatchOnConfirm` is optional for the migration — `dispatchModeOf`
        // is the one reader that resolves it, exactly as every other caller
        // does.
        next = {
          ...next,
          orderConfirmMode: res.settings.orderConfirmMode,
          autoConfirmPrepaid: res.settings.autoConfirmPrepaid,
          autoConfirmPartial: res.settings.autoConfirmPartial,
          autoConfirmCod: res.settings.autoConfirmCod,
          dispatchOnConfirm: dispatchModeOf(res.settings),
          autoShipCourier: res.settings.autoShipCourier,
        };
      } else {
        failures.push(res.error || "Order automation could not be saved");
      }
    }

    if (feesDirty) {
      // Its own action, its own two columns. `updateSettings` does not accept
      // them and Zod would strip them without a word, so routing matters here
      // as much as it does for the pipeline group.
      const res = await updatePaymentFees({
        codFeeAmount: draft.codFeeAmount.trim() ? Number(draft.codFeeAmount) : 0,
        partialFeeAmount: draft.partialFeeAmount.trim()
          ? Number(draft.partialFeeAmount)
          : 0,
      });
      if (res.ok) {
        next = {
          ...next,
          codFeeAmount: String(res.settings.codFeeAmount),
          partialFeeAmount: String(res.settings.partialFeeAmount),
        };
      } else {
        failures.push(res.error || "Payment fees could not be saved");
      }
    }

    if (verifyDirty) {
      // Third writer, same rule: these four columns are not in
      // `settingsSchema`, so sending them to `updateSettings` would be a green
      // toast over a write that never happened.
      const res = await updateVerificationSettings({
        requireSignupEmailOtp: draft.requireSignupEmailOtp,
        requireSignupPhoneOtp: draft.requireSignupPhoneOtp,
        requireVerifiedEmailToOrder: draft.requireVerifiedEmailToOrder,
        requireVerifiedPhoneToOrder: draft.requireVerifiedPhoneToOrder,
      });
      if (res.ok) {
        next = { ...next, ...res.settings };
      } else {
        failures.push(res.error || "Verification settings could not be saved");
      }
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
      // DEAD, and pinned false rather than dropped.
      //
      // `settingsSchema` still declares `directEnabled` with `.default(true)`,
      // so omitting it would write `true` on every save — reviving a column the
      // whole change exists to retire. Sending `false` retires it in the
      // database too, and has a second, useful effect: the server's existing
      // "all four methods off" guard now fires exactly when all *three* real
      // ones are off, which is the rule we want.
      directEnabled: false,
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
  const meta = tabMeta(tab);

  return (
    <div className="max-w-3xl">
      <SettingsTabs tab={tab} onChange={selectTab} dirtyByTab={dirtyByTab} />

      <div
        id={SETTINGS_PANEL_ID}
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        className="mt-4 min-w-0"
      >
        {/*
          The heading used to be `sr-only`, which left a sighted owner looking
          at a row of nouns in a tab bar with nothing to choose between them. It is
          printed now: the heading names the group, the blurb says in a few
          words what the tab is FOR, and the long version is behind the (i) —
          the same three levels the sections below already use.
        */}
        <div className="mb-3 flex min-h-8 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 className="eyebrow">{meta.heading}</h2>
          <p className="min-w-0 text-xs text-muted-foreground">{meta.blurb}</p>
          <InfoTip term={meta.heading}>{meta.guide}</InfoTip>
        </div>

        <Section f={draft} set={set} isDirty={isDirty} facts={facts} />
      </div>

      <SaveBar keys={dirty} saving={saving} onSave={save} onDiscard={discard} />
    </div>
  );
}
