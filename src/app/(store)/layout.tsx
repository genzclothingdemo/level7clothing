import { Navbar } from "@/components/store/navbar";
import { Footer } from "@/components/store/footer";
import { CartDrawer } from "@/components/store/cart-drawer";
import { AnnouncementBar } from "@/components/store/announcement-bar";
import { BackToTop } from "@/components/store/back-to-top";
import { ChatProvider, ChatWidget } from "@/components/store/chat-widget";
import { PromoBanner } from "@/components/store/promo-banner";
import { PromoPopup } from "@/components/store/promo-popup";
import { getUserSession } from "@/lib/user-auth";
import { getSettings } from "@/lib/settings";
import { getLivePromotion } from "@/lib/promotions";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_LENGTH,
} from "@/lib/chat";

export default async function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /*
   * Fetched together rather than in sequence. `getSettings` and
   * `getUserSession` are usually already resolved from the root layout's
   * React `cache()`, but `getLivePromotion` is new work — and with
   * `connection_limit=1` every awaited query is a serialised round trip to
   * Mumbai (see CLAUDE.md), so it must not become a fourth one in a row.
   */
  const [session, settings, promotion] = await Promise.all([
    getUserSession(),
    getSettings(),
    getLivePromotion(),
  ]);
  const account = session ? { name: session.name } : null;

  return (
    /*
     * ChatProvider wraps the navbar as well as the widget: the launcher that
     * replaced the theme toggle lives in the header, and the panel is mounted
     * down here, so they need one shared store between them.
     *
     * The limits are passed as props rather than imported by the client,
     * because `@/lib/chat` pulls in Prisma. One source of truth, no client
     * bundle bloat.
     */
    <ChatProvider
      config={{
        brandName: settings.brandName,
        contactPhone: settings.contactPhone,
        maxLength: MAX_MESSAGE_LENGTH,
        maxBytes: MAX_ATTACHMENT_BYTES,
        accept: ATTACHMENT_ACCEPT,
      }}
    >
      <AnnouncementBar />
      {/*
        Stacking, decided deliberately: announcement bar → promo banner →
        navbar.

        The announcement bar is permanent chrome and keeps the top edge, so the
        store's silhouette doesn't change for a two-week sale. The promo banner
        is temporary and dismissible, so it sits under the permanent thing and
        collapses cleanly when it goes, with nothing above it moving. They are
        also drawn differently on purpose — inverted ink above, a tonal violet
        strip below — because two identical full-width bars read as a template.

        `settings.announcement` goes in so the banner can stand down entirely
        if the admin has typed the same line into both places.
      */}
      <PromoBanner promotion={promotion} announcement={settings.announcement} />
      <Navbar account={account} />
      <main className="flex-1 mobile-bottom-pad">{children}</main>
      <Footer />
      <CartDrawer />
      {/*
        The floating WhatsApp button is gone: in-app chat replaced it as the
        global "talk to us" channel, and two competing contact FABs over the
        bottom tab bar was the clutter. WhatsApp survives where it is
        contextual rather than ambient — the order confirmation page still
        offers "message us about this order", and the number is in the footer.
      */}
      <ChatWidget />
      {/*
        Mounted with the other overlays, not with the chrome: it portals to
        <body> and waits for the shopper to show some intent before it exists
        at all. It also stands down on checkout, cart, account and order pages.
      */}
      <PromoPopup promotion={promotion} />
      <BackToTop />
    </ChatProvider>
  );
}
