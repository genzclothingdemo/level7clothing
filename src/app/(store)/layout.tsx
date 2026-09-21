import { Navbar } from "@/components/store/navbar";
import { Footer } from "@/components/store/footer";
import { CartDrawer } from "@/components/store/cart-drawer";
import { AnnouncementBar } from "@/components/store/announcement-bar";
import { BackToTop } from "@/components/store/back-to-top";
import { ChatProvider, ChatWidget } from "@/components/store/chat-widget";
import { getUserSession } from "@/lib/user-auth";
import { getSettings } from "@/lib/settings";
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
  const session = await getUserSession();
  const account = session ? { name: session.name } : null;
  // Already memoised per request by React `cache()`, so this is free here.
  const settings = await getSettings();

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
      <BackToTop />
    </ChatProvider>
  );
}
