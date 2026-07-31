"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { CartItem } from "@/lib/types";
import { makeLineId } from "@/lib/options";
import { MiniSignupModal } from "@/components/store/mini-signup-modal";

type NewCartItem = Omit<CartItem, "quantity" | "lineId">;

const STORAGE_KEY = "level7_cart";
const VISITOR_KEY = "level7_vid";
const LEAD_COOKIE = "level7_lead";
const LEAD_MAX_AGE = 60 * 60 * 24 * 180; // 180 days

export type LeadInfo = { name: string; phone: string };
type PendingAdd = {
  item: NewCartItem;
  qty: number;
  checkout?: boolean; // Buy Now: continue straight to checkout after capture
};

type CartContextType = {
  items: CartItem[];
  count: number;
  subtotal: number;
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  addItem: (item: NewCartItem, qty?: number) => void;
  buyNow: (item: NewCartItem, qty?: number) => void;
  removeItem: (lineId: string) => void;
  updateQty: (lineId: string, qty: number) => void;
  clear: () => void;
  // Mini lead capture (name + phone) gate for add-to-cart
  leadInfo: LeadInfo | null;
  pendingAdd: PendingAdd | null;
  submitLead: (info: LeadInfo) => void;
  cancelLead: () => void;
};

const CartContext = createContext<CartContextType | null>(null);

function getVisitorId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

function readLeadCookie(): LeadInfo | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${LEAD_COOKIE}=([^;]+)`)
  );
  if (!match) return null;
  const raw = match[1];
  // The cookie may be percent-encoded (client/server) or raw — try both.
  const candidates = [raw];
  try {
    candidates.push(decodeURIComponent(raw));
  } catch {
    /* ignore */
  }
  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate);
      if (obj && typeof obj.name === "string" && obj.name) {
        return { name: obj.name, phone: typeof obj.phone === "string" ? obj.phone : "" };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function writeLeadCookie(info: LeadInfo) {
  if (typeof document === "undefined") return;
  const value = encodeURIComponent(JSON.stringify(info));
  document.cookie = `${LEAD_COOKIE}=${value}; path=/; max-age=${LEAD_MAX_AGE}; samesite=lax`;
}

export function CartProvider({
  children,
  initialLead,
}: {
  children: React.ReactNode;
  // When the shopper is logged in, their account name/phone is passed from the
  // server so the mini sign-up never prompts them.
  initialLead?: { name: string; phone: string } | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<CartItem[]>([]);
  const [isOpen, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [leadInfo, setLeadInfo] = useState<LeadInfo | null>(
    initialLead && initialLead.name ? initialLead : null
  );
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);

  // Mirror the latest cart items into a ref so we can reliably tell whether a
  // product is new WITHOUT depending on the async setItems updater timing.
  const itemsRef = useRef<CartItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Load cart + saved lead contact on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CartItem[];
        // Backfill lineId for carts saved before options existed.
        setItems(
          parsed.map((i) => ({
            ...i,
            lineId: i.lineId || makeLineId(i.productId, i.options),
          }))
        );
      }
    } catch {
      /* ignore */
    }
    // Prefer the logged-in account contact (initialLead); fall back to the
    // guest cookie. Never clear a server-provided lead with a missing cookie.
    const cookieLead = readLeadCookie();
    if (cookieLead) setLeadInfo(cookieLead);
    else if (initialLead && initialLead.name) setLeadInfo(initialLead);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist cart
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items, hydrated]);

  const recordLead = useCallback(
    (item: NewCartItem, qty: number, contact: LeadInfo | null) => {
      // Fire-and-forget: log an "interested customer" lead + notify admin.
      try {
        fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: item.productId,
            productName: item.name,
            productImage: item.image,
            quantity: qty,
            price: item.price,
            visitorId: getVisitorId(),
            name: contact?.name,
            phone: contact?.phone,
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* ignore */
      }
    },
    []
  );

  // Actually add to cart + record the lead (contact already known).
  const commitAdd = useCallback(
    (
      item: NewCartItem,
      qty: number,
      contact: LeadInfo | null,
      opts: { drawer?: boolean } = {}
    ) => {
      const lineId = makeLineId(item.productId, item.options);
      // Decide new-vs-existing from the live ref (reliable, sync).
      const isNew = !itemsRef.current.some((i) => i.lineId === lineId);
      setItems((prev) => {
        const existing = prev.find((i) => i.lineId === lineId);
        if (existing) {
          return prev.map((i) =>
            i.lineId === lineId
              ? { ...i, quantity: Math.min(i.quantity + qty, i.stock || 99) }
              : i
          );
        }
        return [...prev, { ...item, lineId, quantity: qty }];
      });
      // Only record a lead the first time a product/variant is added.
      if (isNew) recordLead(item, qty, contact);
      if (opts.drawer !== false) {
        toast.success("Added to cart", { description: item.name });
        setOpen(true);
      }
    },
    [recordLead]
  );

  const addItem = useCallback(
    (item: NewCartItem, qty = 1) => {
      // Gate: first add ever needs a quick name + phone (mini sign-up).
      if (!leadInfo) {
        setPendingAdd({ item, qty });
        return;
      }
      commitAdd(item, qty, leadInfo);
    },
    [leadInfo, commitAdd]
  );

  // Buy Now: put the item in the cart and continue straight to checkout.
  const buyNow = useCallback(
    (item: NewCartItem, qty = 1) => {
      if (!leadInfo) {
        setPendingAdd({ item, qty, checkout: true });
        return;
      }
      commitAdd(item, qty, leadInfo, { drawer: false });
      router.push("/checkout");
    },
    [leadInfo, commitAdd, router]
  );

  // Called from the mini sign-up modal once name + phone are entered.
  const submitLead = useCallback(
    (info: LeadInfo) => {
      writeLeadCookie(info);
      setLeadInfo(info);
      if (pendingAdd) {
        commitAdd(pendingAdd.item, pendingAdd.qty, info, {
          drawer: !pendingAdd.checkout,
        });
        if (pendingAdd.checkout) router.push("/checkout");
        setPendingAdd(null);
      }
    },
    [pendingAdd, commitAdd, router]
  );

  const cancelLead = useCallback(() => setPendingAdd(null), []);

  const removeItem = useCallback((lineId: string) => {
    setItems((prev) => prev.filter((i) => i.lineId !== lineId));
  }, []);

  const updateQty = useCallback((lineId: string, qty: number) => {
    setItems((prev) =>
      prev
        .map((i) =>
          i.lineId === lineId
            ? { ...i, quantity: Math.max(0, Math.min(qty, i.stock || 99)) }
            : i
        )
        .filter((i) => i.quantity > 0)
    );
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const count = items.reduce((n, i) => n + i.quantity, 0);
  const subtotal = items.reduce((n, i) => n + i.price * i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        count,
        subtotal,
        isOpen,
        setOpen,
        addItem,
        buyNow,
        removeItem,
        updateQty,
        clear,
        leadInfo,
        pendingAdd,
        submitLead,
        cancelLead,
      }}
    >
      {children}
      <MiniSignupModal />
    </CartContext.Provider>
  );
}

export function useCart(): CartContextType {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
