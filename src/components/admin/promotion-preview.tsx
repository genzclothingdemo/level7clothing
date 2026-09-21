"use client";

/**
 * What the shopper will actually see.
 *
 * The two surfaces are rendered with the **real** storefront components
 * (`PromoBannerShell`, `PromoPopupPanel`) in an `inert` mode that strips the
 * behaviour and leaves the markup. A hand-drawn mock-up would be a second
 * thing to keep in step with the first, and the whole point of a preview is
 * that it cannot be wrong.
 *
 * The banner preview includes the **real** `AnnouncementBar` above it and a
 * stand-in for the navbar below, because the thing an admin most needs to
 * judge is not the banner on its own — it is whether the top of the store
 * still looks composed with both bars stacked.
 */

import { AnnouncementBar } from "@/components/store/announcement-bar";
import { PromoBannerShell } from "@/components/store/promo-banner";
import { PromoPopupPanel } from "@/components/store/promo-popup";
import { useSettings } from "@/context/settings";
import type { PromotionKind } from "@/lib/promotions";
import { promotionDismissSummary } from "@/components/admin/promotion-summary";

/** Placeholders so an empty form previews as a shape, not as a broken bar. */
const PLACEHOLDER_TITLE = "Your offer, in a few words";
const PLACEHOLDER_BODY = "One line of detail underneath.";

function Frame({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="eyebrow text-muted-foreground">{label}</p>
      <div className="mt-2 min-w-0 overflow-hidden rounded-lg border border-border">
        {children}
      </div>
    </div>
  );
}

export function PromotionPreview({
  title,
  body,
  ctaLabel,
  ctaHref,
  kind,
  dismissDays,
}: {
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  kind: PromotionKind;
  dismissDays: number;
}) {
  const { brandName } = useSettings();

  const shownTitle = title.trim() || PLACEHOLDER_TITLE;
  const shownBody = body.trim() || PLACEHOLDER_BODY;
  // Mirrors the storefront rule: a label without a destination, or the other
  // way round, renders as no call to action at all.
  const label = ctaLabel.trim();
  const href = ctaHref.trim();
  const cta = label && href ? { label, href } : null;

  const showBanner = kind === "banner" || kind === "both";
  const showPopup = kind === "popup" || kind === "both";

  return (
    <div className="min-w-0 space-y-4">
      {showBanner && (
        <Frame label="Top of every page">
          {/* The real announcement bar, so the stack is honest. */}
          <AnnouncementBar />
          <PromoBannerShell
            inert
            title={shownTitle}
            body={shownBody}
            ctaLabel={cta?.label}
            ctaHref={cta?.href}
          />
          {/* Stand-in for the navbar — enough to show what sits underneath. */}
          <div className="flex h-12 items-center justify-between bg-background px-4">
            <span className="font-serif text-sm">{brandName}</span>
            <span className="flex gap-1.5" aria-hidden="true">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
            </span>
          </div>
        </Frame>
      )}

      {showPopup && (
        <Frame label="After a few seconds, once per visitor">
          <div className="grid place-items-center bg-foreground/70 p-4 sm:p-6">
            <PromoPopupPanel
              inert
              title={shownTitle}
              body={shownBody}
              ctaLabel={cta?.label}
              ctaHref={cta?.href}
              className="max-w-sm"
            />
          </div>
        </Frame>
      )}

      <p className="text-xs text-muted-foreground">
        {promotionDismissSummary(dismissDays)}. Neither surface appears on
        checkout or on an order page, and the popup also stays away from the
        cart and account.
      </p>
    </div>
  );
}
