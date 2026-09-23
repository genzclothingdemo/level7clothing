import Link from "next/link";
import { Heart, HeartOff } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";
import { StatTile, TileGrid, formatCount } from "@/components/admin/finance-ui";
import { formatAgo, formatDayTime } from "@/components/admin/customer-ui";
import { IntentNav } from "@/components/admin/wishlist-nav";
import { WishlistFilters } from "@/components/admin/wishlist-filters";
import { WishlistTable } from "@/components/admin/wishlist-table";
import type {
  WishlistGroupView,
  WishlistPieceView,
  WishlistSaveView,
  WishlistSaverView,
} from "@/components/admin/wishlist-table";
import {
  OrderPagination,
  parsePageParam,
} from "@/components/admin/order-pagination";
import {
  WISHLIST_AVAILABILITY_LABEL,
  availabilityCounts,
  filterSaves,
  getWishlistInsights,
  groupByPerson,
  groupByProduct,
  isWishlistAvailability,
  isWishlistPivot,
  isWishlistSort,
  sortGroups,
  totalsFor,
  type WishlistPiece,
  type WishlistPivot,
  type WishlistSave,
  type WishlistSaver,
  type WishlistSort,
} from "@/lib/wishlist-insights";

export const dynamic = "force-dynamic";
export const metadata = { title: "Wishlists" };

/**
 * Admin → Wishlists — the saved half of Interested customers.
 *
 * Thin on purpose, like the Customers list it borrows its identity from. It
 * reads the URL, asks `lib/wishlist-insights` for every save, filters that one
 * list, groups it whichever way `?by=` asks for, sorts and pages. Every rule
 * about who a person is lives in `lib/customers.ts`; every rule about what a
 * save means lives in `lib/wishlist-insights.ts`. Nothing is decided twice.
 *
 * ── Where this screen lives, and why ─────────────────────────────────────────
 *
 * Its own route, under the *same* sidebar entry as Interested customers, with
 * a two-tab strip switching between them — see `wishlist-nav.tsx` for the full
 * argument. In short: one question, two signals, so one place; but two URLs,
 * so each keeps its own filters and each is a link you can send somebody.
 */

/** 20 cards — a card is taller than a table row, so the page stays one screen-ish. */
const PAGE_SIZE = 20;

/**
 * Wall clock for the "3 days ago" column, read through an async boundary
 * rather than called in the render body: the page is force-dynamic so the
 * value is genuinely per-request, but a bare impure call in a component body
 * is the pattern the purity rule rejects.
 */
async function readClock(): Promise<number> {
  return Date.now();
}

/* ------------------------------------------------------------------ */
/*  Domain → view                                                      */
/* ------------------------------------------------------------------ */

/**
 * Dates become strings here, on the server, where the formatter is pinned to
 * Asia/Kolkata — see the note in `wishlist-table.tsx`. This also keeps the RSC
 * payload to what is drawn: a `CustomerRecord` carries the person's whole
 * order, chat and return history, and none of it belongs on this screen.
 */
function pieceView(p: WishlistPiece): WishlistPieceView {
  return {
    slug: p.slug,
    name: p.name,
    image: p.image,
    href: p.href,
    price: p.price != null ? formatINR(p.price) : null,
    availability: p.availability,
    stockLabel:
      p.id == null
        ? "Not in the catalogue"
        : p.availability === "off"
          ? "Hidden from the store"
          : p.stock && p.stock > 0
            ? `${formatCount(p.stock)} left`
            : "None left",
    category: p.category,
  };
}

function saverView(s: WishlistSaver): WishlistSaverView {
  return {
    id: s.id,
    displayName: s.displayName,
    email: s.email,
    phone: s.phone,
    location: s.location,
    orderCount: s.orderCount,
    href: s.href,
  };
}

function saveView(s: WishlistSave, now: number): WishlistSaveView {
  return {
    id: s.id,
    savedAgo: formatAgo(s.savedAt, now),
    savedAt: formatDayTime(s.savedAt),
    converted: s.converted,
    saver: saverView(s.saver),
    piece: pieceView(s.piece),
  };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function AdminWishlist({
  searchParams,
}: {
  searchParams: Promise<{
    by?: string;
    q?: string;
    category?: string;
    stock?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const now = await readClock();

  const [insights, leadCount] = await Promise.all([
    getWishlistInsights(),
    // The other tab's count. One indexed count, so the strip is honest about
    // what is behind the tab you are not looking at.
    prisma.lead.count().catch(() => 0),
  ]);

  const pivot: WishlistPivot =
    sp.by && isWishlistPivot(sp.by) ? sp.by : "product";
  const sort: WishlistSort =
    sp.sort && isWishlistSort(sp.sort) ? sp.sort : "saves";
  const q = sp.q?.trim() ?? "";
  const category =
    sp.category && insights.categories.includes(sp.category) ? sp.category : null;
  const availability =
    sp.stock && isWishlistAvailability(sp.stock) ? sp.stock : null;

  // The chips count how many of the *current* matches sit in each state, so
  // they stay useful while a search is running. They therefore see the search
  // and the category but not themselves — a chip that counted its own filter
  // would read 0 for every state you are not on.
  const beforeChips = filterSaves(insights.saves, { q, category, availability: null });
  const chipCounts = availabilityCounts(beforeChips);

  const saves = filterSaves(insights.saves, { q, category, availability });

  // Filter first, group second. That ordering is the whole design — see the
  // module header. It is what makes the two pivots two arrangements of one
  // answer rather than two answers.
  const groups: WishlistGroupView[] =
    pivot === "product"
      ? sortGroups(groupByProduct(saves), sort, (g) => g.piece.name).map((g) => ({
          kind: "product" as const,
          id: g.id,
          piece: pieceView(g.piece),
          saves: g.saves.map((s) => saveView(s, now)),
          count: g.savers,
          converted: g.converted,
          lastSavedAgo: formatAgo(g.lastSavedAt, now),
          lastSavedAt: formatDayTime(g.lastSavedAt),
          openValue: formatINR(g.openValue),
        }))
      : sortGroups(groupByPerson(saves), sort, (g) => g.saver.displayName).map(
          (g) => ({
            kind: "person" as const,
            id: g.id,
            saver: saverView(g.saver),
            saves: g.saves.map((s) => saveView(s, now)),
            count: g.pieces,
            converted: g.converted,
            lastSavedAgo: formatAgo(g.lastSavedAt, now),
            lastSavedAt: formatDayTime(g.lastSavedAt),
            openValue: formatINR(g.openValue),
          })
        );

  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  // Clamped, so a stale `?page=4` left over from a wider filter lands on the
  // last page rather than on a blank screen that reads as "nobody saved this".
  const page = Math.min(parsePageParam(sp.page), totalPages);
  const visible = groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Over the filtered saves, so the tiles describe what is on the screen
  // rather than a store-wide figure the reader is not looking at.
  const shown = totalsFor(saves);
  const all = insights.totals;
  const filtered = !!q || !!category || !!availability;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="font-serif text-2xl">Wishlists</h1>
        <p className="text-sm text-muted-foreground">
          {filtered
            ? `${shown.saves} of ${all.saves} save${all.saves === 1 ? "" : "s"} matching`
            : `${all.saves} save${all.saves === 1 ? "" : "s"} · ${all.pieces} piece${
                all.pieces === 1 ? "" : "s"
              } · ${all.people} shopper${all.people === 1 ? "" : "s"}`}
        </p>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Everything shoppers saved for later, read from either end: how many
        people want a piece, or how many pieces one person is waiting on.
        <InfoTip term="How this list is built">
          A save is one shopper against one piece — the store stores it by slug,
          so a piece that is later deleted degrades to its slug instead of
          vanishing. Saving needs an account, so unlike the carts tab everybody
          here is a registered customer with an address you can reach.
          <br />
          <br />
          People are the same records as Admin &rarr; Customers, matched on
          lowercased email then phone, so somebody who ordered as a guest and
          signed up later is one person here too. Filters run on the individual
          saves and the grouping happens afterwards, which is why switching
          between &ldquo;by product&rdquo; and &ldquo;by person&rdquo;
          re-arranges the answer without changing it.
          <br />
          <br />
          &ldquo;Bought&rdquo; means that person has since ordered that exact
          piece on an order that was not cancelled — the save converted, and
          there is nothing left to chase.
        </InfoTip>
      </p>

      <div className="mt-4">
        <IntentNav
          active="wishlist"
          counts={{ carts: leadCount, wishlist: all.saves }}
        />
      </div>

      <div className="mt-3">
        <TileGrid>
          <StatTile
            label="Saves"
            value={formatCount(shown.saves)}
            sub={`${shown.pieces} piece${shown.pieces === 1 ? "" : "s"} · ${shown.people} shopper${
              shown.people === 1 ? "" : "s"
            }`}
            tip="One shopper against one piece. A person can only save a piece once, so this is also the number of rows across both pivots."
            note={
              filtered
                ? `Counting the ${shown.saves} save${shown.saves === 1 ? "" : "s"} that match the current filters, out of ${all.saves} in the store.`
                : undefined
            }
          />
          <StatTile
            label="Still open"
            value={formatINR(shown.openValue)}
            sub={`${shown.saves - shown.converted} not bought yet`}
            good="none"
            tip="List price of every save whose piece the same person has not since ordered."
            note="A ceiling, not a forecast: it assumes every open save becomes one sale at full price, which is not what happens. It is here to put the queue in the same unit as an order."
          />
          <StatTile
            label="Converted"
            value={formatCount(shown.converted)}
            sub={
              shown.saves > 0
                ? `${Math.round((shown.converted / shown.saves) * 100)}% of saves`
                : undefined
            }
            tip="Saves where that person has since ordered that exact piece, on an order that was not cancelled. Matched on the product id inside the order's line items."
            note="A piece deleted from the catalogue has no id left to match, so it can never read as converted. That is honest rather than wrong — there is nothing to compare against."
          />
          <StatTile
            label="Can't be bought"
            value={formatCount(shown.unavailable)}
            good="down"
            // Short enough to survive `StatTile`'s one clipped line at 320px.
            // The three states it covers are spelled out in the (i).
            sub={`of ${formatCount(shown.saves)} save${shown.saves === 1 ? "" : "s"}`}
            tip={`Saves sitting on a piece nobody can buy today — ${WISHLIST_AVAILABILITY_LABEL.out.toLowerCase()}, hidden from the storefront, or gone from the catalogue altogether.`}
            note="This is the actionable figure on the screen. Demand that is already recorded by name is the cheapest reason there is to restock something. Filter to Out of stock to see whose it is."
          />
        </TileGrid>
      </div>

      <div className="mt-3">
        <WishlistFilters
          pivot={pivot}
          counts={chipCounts}
          categories={insights.categories}
        />
      </div>

      {visible.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center">
          {filtered ? (
            <HeartOff className="mx-auto h-8 w-8 text-muted-foreground" />
          ) : (
            <Heart className="mx-auto h-8 w-8 text-muted-foreground" />
          )}
          <p className="mt-3 font-serif text-lg">
            {filtered ? "Nothing matches" : "Nobody has saved anything yet"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {filtered
              ? "Try clearing the search, or widening the stock filter."
              : "The heart on a product page saves it here. It needs an account, so anyone browsing as a guest shows up under the carts tab instead."}
          </p>
          {!filtered && (
            <Link
              href="/admin/leads"
              className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-[11px] font-medium uppercase tracking-wider transition-colors hover:border-accent hover:text-accent sm:min-h-9"
            >
              See who left something in a cart
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <WishlistTable pivot={pivot} groups={visible} />
          <OrderPagination
            page={page}
            totalPages={totalPages}
            total={groups.length}
            pageSize={PAGE_SIZE}
            params={sp}
            basePath="/admin/wishlist"
          />
        </div>
      )}
    </div>
  );
}
