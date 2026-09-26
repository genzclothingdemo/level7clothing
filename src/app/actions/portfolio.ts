"use server";

/**
 * Writes for the portfolio editor.
 *
 * Modelled on `actions/promotions.ts`, and for the same reasons — two traps
 * from CLAUDE.md are designed out here rather than guarded against:
 *
 * 1. **"Zod strips anything not in the schema — silently."** The column list
 *    is written once, in `toRow()`, and both `createPortfolioItem` and
 *    `updatePortfolioItem` use it. There is no second place a field can be
 *    forgotten, which is the failure mode that made the Returns control save
 *    nothing.
 * 2. **An optional value must collapse to `null`, not `undefined`.** An
 *    `undefined` in a Prisma `update` means "leave this column alone", so
 *    clearing a URL or unlinking a product by emptying the field would
 *    silently do nothing. Every optional field here resolves to an explicit
 *    `null`.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireAdminWrite } from "@/lib/auth";
import { PORTFOLIO_KINDS, isSafeHref, type PortfolioKind } from "@/lib/portfolio";
import { type SocialProvider } from "@/lib/instagram-resolve";
import { sanitisePortfolioBody } from "@/lib/sanitise-html";
import {
  planHarvest,
  resolveForPortfolio,
  runHarvest,
  type HarvestOutcome,
  type HarvestPlan,
} from "@/lib/portfolio-harvest";

/**
 * Identity **and** permission for every write in this module, routed through
 * the one write gate in `lib/auth.ts`. See the long note there: it is also
 * where a temporary admin's activity is recorded, so a new action that calls
 * this is gated and logged without its author doing anything.
 */
async function requireAdmin(what?: string, opts?: { quiet?: boolean }) {
  return requireAdminWrite(what, opts);
}

/**
 * For the two actions here that only **read** — the body preview and the
 * harvest plan.
 *
 * `requireAdminWrite(…, { quiet: true })` is not the same thing and would be
 * the wrong gate: `quiet` only suppresses the blocked-attempt log, it still
 * throws `AdminReadOnlyError`. A view-only temporary admin is supposed to see
 * every screen; refusing them a preview of what their own paste would become,
 * or a read-only list of which reels are missing, would break the thing that
 * mode exists for. Neither action writes a row.
 */
async function requireAdminRead() {
  return requireAdminSession();
}

export type PortfolioActionResult = { success: boolean; error?: string };

/**
 * The portfolio shows on `/portfolio` and, as a highlights strip, on the
 * homepage. Both are revalidated; the admin list too, so a redirect back to
 * it shows the write that just happened.
 */
function revalidatePortfolio() {
  revalidatePath("/portfolio");
  revalidatePath("/");
  revalidatePath("/admin/portfolio");
}

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

/** Blank, whitespace-only and absent all mean the same thing: not set. */
const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    const s = (v ?? "").trim();
    return s ? s : null;
  });

const portfolioInput = z
  .object({
    title: z
      .string()
      .trim()
      .min(2, "Give this piece a title")
      .max(120, "Keep the title under 120 characters"),
    description: optionalText.pipe(
      z
        .string()
        .max(600, "Keep the description under 600 characters")
        .nullable()
    ),
    kind: z
      .string()
      .refine(
        (v): v is PortfolioKind => (PORTFOLIO_KINDS as readonly string[]).includes(v),
        { message: "Pick what kind of piece this is." }
      ),
    url: optionalText,
    imageUrl: optionalText,
    embedHtml: optionalText.pipe(
      z.string().max(4000, "That embed code is too long to store").nullable()
    ),
    productId: optionalText,

    /* ---- admin-authored page ---- */

    /**
     * Pasted markup. Capped well above a long write-up and well below
     * anything that makes the sanitiser's walk interesting; the sanitiser
     * caps again internally, so this is the friendly error rather than the
     * safety net.
     */
    bodyHtml: optionalText.pipe(
      z
        .string()
        .max(60_000, "That page body is too long to store")
        .nullable()
    ),
    /** Extra photos beyond the cover. Each must be a library path or https. */
    images: z
      .array(z.string())
      .transform((list) =>
        list
          .map((u) => u.trim())
          .filter(Boolean)
          .filter((u, i, all) => all.indexOf(u) === i)
          .slice(0, 12)
      ),
    ctaLabel: optionalText.pipe(
      z.string().max(40, "Keep the button label under 40 characters").nullable()
    ),
    ctaUrl: optionalText,

    // Comma-separated in the form; one tag per chip on the storefront.
    tags: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) =>
        (v ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          // Deduped here rather than in the UI so two tabs open cannot race
          // a duplicate in.
          .filter((t, i, all) => all.indexOf(t) === i)
          .slice(0, 12)
      ),
    sortOrder: z.coerce
      .number()
      .int("Position has to be a whole number")
      .min(0, "Position can't be negative")
      .max(9999, "That position is too large"),
    isFeatured: z.boolean(),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.url && !isSafeHref(v.url)) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message:
          "Use a path on this store (starting with /) or a full https:// address.",
      });
    }
    if (v.imageUrl && !isSafeHref(v.imageUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["imageUrl"],
        message: "Pick a photo from the library, or paste a full https:// image address.",
      });
    }
    for (const url of v.images) {
      if (!isSafeHref(url)) {
        ctx.addIssue({
          code: "custom",
          path: ["images"],
          message:
            "Extra photos have to come from the library or be full https:// addresses.",
        });
        break;
      }
    }
    if (v.ctaUrl && !isSafeHref(v.ctaUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["ctaUrl"],
        message:
          "The button needs a path on this store (starting with /) or a full https:// address.",
      });
    }
    /*
     * A CTA is two halves of one control and neither half works alone: a
     * label with no address is a button that does nothing when pressed, and
     * an address with no label is invisible. `lib/portfolio.ts` drops a
     * half-set pair on read, so without this the owner would fill one field,
     * save successfully, and find no button on the page with nothing saying
     * why.
     */
    if (Boolean(v.ctaLabel) !== Boolean(v.ctaUrl)) {
      ctx.addIssue({
        code: "custom",
        path: v.ctaLabel ? ["ctaUrl"] : ["ctaLabel"],
        message: v.ctaLabel
          ? "Give the button somewhere to go, or clear its label."
          : "Give the button a label, or clear its address.",
      });
    }
    // A tile with no picture, no link, no embed and no page is a title on a
    // grey box. It is not an error the database can catch, so it is caught
    // here — and a written body now counts as something to show, which is
    // what makes a milestone or a bulk-order write-up saveable with no photo.
    if (
      !v.imageUrl &&
      !v.url &&
      !v.embedHtml &&
      !v.productId &&
      !v.bodyHtml &&
      v.images.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message:
          "Give this piece something to show: an image, a link, an embed, a product, or a written page.",
      });
    }
  });

type ParsedPortfolio = z.output<typeof portfolioInput>;

function read(formData: FormData) {
  return {
    title: String(formData.get("title") ?? ""),
    description: formData.get("description"),
    kind: String(formData.get("kind") ?? "instagram"),
    url: formData.get("url"),
    imageUrl: formData.get("imageUrl"),
    embedHtml: formData.get("embedHtml"),
    productId: formData.get("productId"),
    bodyHtml: formData.get("bodyHtml"),
    // One entry per photo rather than a delimited string: a blob URL can
    // contain very nearly anything, and picking a separator is picking a
    // photo filename that silently splits in two.
    images: formData.getAll("images").map(String),
    ctaLabel: formData.get("ctaLabel"),
    ctaUrl: formData.get("ctaUrl"),
    tags: formData.get("tags"),
    sortOrder: formData.get("sortOrder"),
    isFeatured: formData.get("isFeatured") === "true",
    isActive: formData.get("isActive") === "true",
  };
}

/**
 * The single column list. Both writers use it, so a new field cannot be added
 * to one and forgotten in the other.
 */
function toRow(v: ParsedPortfolio) {
  return {
    title: v.title,
    // Explicit `null`, never `undefined` — see note 2 in the header.
    description: v.description,
    kind: v.kind,
    url: v.url,
    imageUrl: v.imageUrl,
    embedHtml: v.embedHtml,
    productId: v.productId,
    /*
     * **Sanitised here, on the way in.** The database holds clean markup, so
     * anything reading `bodyHtml` later — a future export, an email, a
     * different page — gets the cleaned version rather than having to know to
     * clean it. `lib/portfolio.ts` cleans again on the way out, because this
     * is not the only writer: the demo seeder goes straight through Prisma,
     * and rows predating the sanitiser were never checked at all.
     */
    bodyHtml: sanitisePortfolioBody(v.bodyHtml).html || null,
    images: v.images,
    ctaLabel: v.ctaLabel,
    ctaUrl: v.ctaUrl,
    tags: v.tags,
    sortOrder: v.sortOrder,
    isFeatured: v.isFeatured,
    isActive: v.isActive,
    /*
     * `sourceProductId` is deliberately **absent**, and this is the one place
     * in this module where leaving a column out is correct rather than the
     * `undefined` trap in note 2. That column is the harvester's record that
     * it made the row (`lib/portfolio-harvest.ts`); the form does not offer
     * it, so an update must leave whatever is there alone. Listing it here
     * with the form's value would erase the provenance of every harvested row
     * the moment somebody opened it and pressed Save.
     */
  };
}

/** Turns a failure into the one line the admin needs to read. */
function explain(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Check the fields and try again.";
  }
  if (error instanceof Error && error.message === "Unauthorized") {
    return "Your session expired. Sign in again.";
  }
  console.error("[portfolio] write failed:", error);
  return "Couldn't save this piece. Please try again.";
}

/* ------------------------------------------------------------------ */
/*  Writes                                                             */
/* ------------------------------------------------------------------ */

export async function createPortfolioItem(
  formData: FormData
): Promise<PortfolioActionResult> {
  try {
    await requireAdmin("createPortfolioItem");
    const parsed = portfolioInput.parse(read(formData));
    await prisma.portfolioItem.create({ data: toRow(parsed) });
    revalidatePortfolio();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

export async function updatePortfolioItem(
  id: string,
  formData: FormData
): Promise<PortfolioActionResult> {
  try {
    await requireAdmin("updatePortfolioItem");
    const parsed = portfolioInput.parse(read(formData));
    await prisma.portfolioItem.update({ where: { id }, data: toRow(parsed) });
    revalidatePortfolio();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

export async function deletePortfolioItem(
  id: string
): Promise<PortfolioActionResult> {
  try {
    await requireAdmin("deletePortfolioItem");
    await prisma.portfolioItem.delete({ where: { id } });
    revalidatePortfolio();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/* ------------------------------------------------------------------ */
/*  Row switches                                                       */
/* ------------------------------------------------------------------ */

/**
 * Active and Featured are the two edits worth making without opening a form:
 * "take that down now" and "push that to the top" are both one tap from the
 * list, which is where the admin already is when they want them.
 */
export async function setPortfolioFlag(
  id: string,
  field: "isActive" | "isFeatured",
  value: boolean
): Promise<PortfolioActionResult> {
  try {
    await requireAdmin("setPortfolioFlag");
    // The field name is a literal union, so it can never widen into an
    // arbitrary column name coming off the wire.
    await prisma.portfolioItem.update({
      where: { id },
      data: field === "isActive" ? { isActive: value } : { isFeatured: value },
    });
    revalidatePortfolio();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/* ------------------------------------------------------------------ */
/*  Bulk                                                               */
/* ------------------------------------------------------------------ */

/**
 * A `"use server"` module may only export async functions — a `const` array
 * here would fail the build with "Only async functions are allowed to be
 * exported". So the list is module-private and the public surface is a type,
 * which is erased before it ever reaches that rule.
 */
const BULK_ACTIONS = [
  "activate",
  "deactivate",
  "feature",
  "unfeature",
  "delete",
] as const;

export type PortfolioBulkAction = (typeof BULK_ACTIONS)[number];

/**
 * Apply one action to a selection.
 *
 * The ids come from the client, so they are capped and de-duplicated here —
 * the selection the admin sees is bounded by the page, but nothing stops a
 * malformed call. Delete is the only destructive one and is confirmed in the
 * UI before it ever reaches this.
 */
export async function bulkPortfolioAction(
  ids: string[],
  action: PortfolioBulkAction
): Promise<PortfolioActionResult & { count?: number }> {
  try {
    await requireAdmin("bulkPortfolioAction");

    if (!(BULK_ACTIONS as readonly string[]).includes(action)) {
      return { success: false, error: "Unknown action." };
    }
    const unique = [...new Set(ids.filter((id) => typeof id === "string" && id))];
    if (unique.length === 0) {
      return { success: false, error: "Nothing selected." };
    }
    if (unique.length > 500) {
      return { success: false, error: "Too many rows at once — select fewer." };
    }

    const where = { id: { in: unique } };
    let count = 0;

    if (action === "delete") {
      count = (await prisma.portfolioItem.deleteMany({ where })).count;
    } else {
      const data =
        action === "activate"
          ? { isActive: true }
          : action === "deactivate"
            ? { isActive: false }
            : action === "feature"
              ? { isFeatured: true }
              : { isFeatured: false };
      count = (await prisma.portfolioItem.updateMany({ where, data })).count;
    }

    revalidatePortfolio();
    return { success: true, count };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/* ------------------------------------------------------------------ */
/*  Reorder                                                            */
/* ------------------------------------------------------------------ */

/**
 * Persist a new order for the rows the admin can currently see.
 *
 * Two things this deliberately does NOT do:
 *
 * - **It does not patch one row's `sortOrder`.** Swapping two neighbours by
 *   writing two numbers falls apart the moment several rows share a position,
 *   which they all do at first (`sortOrder` defaults to 0). Renumbering the
 *   whole visible list from its new order is idempotent and self-healing.
 * - **It does not renumber rows that were filtered out.** The ids given are
 *   the ones on screen; anything else keeps the number it had, so reordering
 *   a filtered view cannot silently rewrite the rest of the portfolio.
 *
 * One transaction, so a failure halfway cannot leave the list half-renumbered.
 */
export async function reorderPortfolio(
  orderedIds: string[]
): Promise<PortfolioActionResult> {
  try {
    await requireAdmin("reorderPortfolio");

    const unique = [...new Set(orderedIds.filter((id) => typeof id === "string" && id))];
    if (unique.length === 0) return { success: true };
    if (unique.length > 500) {
      return { success: false, error: "Too many rows to reorder at once." };
    }

    await prisma.$transaction(
      unique.map((id, index) =>
        prisma.portfolioItem.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    );

    revalidatePortfolio();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/* ------------------------------------------------------------------ */
/*  Mirroring an Instagram post or a YouTube video                     */
/* ------------------------------------------------------------------ */

export type SocialImportResult =
  | {
      success: true;
      provider: SocialProvider;
      url: string;
      title: string | null;
      /** A Blob address we own, the provider's own poster, or null. */
      imageUrl: string | null;
      embedHtml: string;
      /** Set when the post belongs to a different handle — worth showing. */
      author: string | null;
      /** Non-fatal explanation, e.g. the thumbnail could not be copied. */
      warning?: string;
    }
  | { success: false; error: string };

/**
 * Paste a link, get back everything the form needs to **mirror** it: the
 * caption, a poster we can serve ourselves, and the iframe address the tile
 * plays inline.
 *
 * **The Instagram thumbnail is copied, never linked.**
 * `scontent.cdninstagram.com` addresses carry a signed `oe=` expiry — measured
 * at four days on the posts this was built against — so storing one produces a
 * portfolio that looks right today and is broken images next week, silently.
 * The bytes are fetched once and put in Vercel Blob, and `imageUrl` holds an
 * address we control.
 *
 * **YouTube differs, and the difference is handled rather than flattened.**
 * `i.ytimg.com` posters do not expire and that host is already in
 * `next.config.ts`, so when the blob copy is impossible the poster address is
 * stored as-is and the result is a working, optimised image — not a warning.
 * Copying is still preferred: it takes one third party out of the render path.
 *
 * Failure to copy is deliberately **not** fatal for either provider: the row is
 * still worth saving with a working permalink and embed.
 *
 * **The resolve-and-copy itself lives in `lib/portfolio-harvest.ts`**, because
 * harvesting a product's video links needs byte-for-byte the same behaviour
 * and the same 8 MB bound. Two copies of a size cap is how one of them ends up
 * without it; this action is now the admin-gated door onto the one
 * implementation.
 */
export async function importSocialPost(
  rawUrl: string
): Promise<SocialImportResult> {
  try {
    await requireAdmin("importSocialPost");

    const resolved = await resolveForPortfolio(rawUrl);
    if (!resolved.ok) return { success: false, error: resolved.error };

    return {
      success: true,
      provider: resolved.provider,
      url: resolved.url,
      title: resolved.title,
      imageUrl: resolved.imageUrl,
      embedHtml: resolved.embedHtml,
      author: resolved.author,
      ...(resolved.warning ? { warning: resolved.warning } : {}),
    };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/* ------------------------------------------------------------------ */
/*  The page body                                                      */
/* ------------------------------------------------------------------ */

export type BodyPreviewResult = {
  /** Exactly what will be stored and rendered. */
  html: string;
  /** Short notes on what was taken out — "<script>", "style attribute". */
  removed: string[];
};

/**
 * Show the owner what the sanitiser will do **before** they save.
 *
 * Pasted markup loses things — a `<div class="wrapper">` from a Google Doc, a
 * `style` attribute, a tracking pixel — and a body that comes back looking
 * different with no explanation reads as a bug. This gives the editor the
 * cleaned markup and a plain list of what went, so the loss is a stated
 * outcome rather than a mystery.
 *
 * It is a server action and not a client-side call for one reason that
 * matters: the preview has to be produced by the *same* function that runs on
 * save. A second, client-side sanitiser would be a second answer to "what is
 * safe", and the two would drift.
 */
export async function previewPortfolioBody(
  html: string
): Promise<BodyPreviewResult> {
  await requireAdminRead();
  const { html: clean, removed } = sanitisePortfolioBody(html);
  return { html: clean, removed };
}

/* ------------------------------------------------------------------ */
/*  Harvesting the catalogue's reels                                   */
/* ------------------------------------------------------------------ */

/*
 * **Do not re-export the harvest types from here.**
 *
 * `export type { HarvestPlan, HarvestOutcome }` was written here and it broke
 * this whole module at runtime:
 *
 *   ReferenceError: HarvestPlan is not defined
 *
 * This is the same family as the rule CLAUDE.md already records — *"a
 * `"use server"` file may only export async functions"* — with one extra turn
 * on it. A type **declaration** (`export type PortfolioActionResult = …`
 * above) is erased and is fine. A type **re-export** is not: the server-action
 * transform enumerates a module's exports into a runtime registration table,
 * and a re-exported name lands in that table as a live binding that was
 * erased out from under it.
 *
 * `tsc --noEmit` passes it and `next build` passes it. The only symptom is
 * every action in this file answering 500, which is what happened — the
 * harvest panel simply rendered nothing and looked like a dead feature.
 *
 * The types live in `lib/portfolio-harvest.ts`; importing them from there with
 * `import type` is free on both sides of the boundary.
 */

/**
 * What a sweep would do. Read-only, no network, two queries.
 *
 * The admin screen renders this on load; nothing is created until the owner
 * presses the button. Same draft-first shape as the dispatch panel: a screen
 * that spends money or publishes rows just by being opened is a screen nobody
 * can safely leave open.
 */
export async function getHarvestPlan(): Promise<HarvestPlan> {
  await requireAdminRead();
  return planHarvest();
}

/**
 * Create portfolio rows for catalogue links that have none.
 *
 * `keys` narrows the sweep to the rows the owner ticked. It cannot *widen* it:
 * `runHarvest` recomputes the plan server-side and intersects, so a stale tab
 * or a replayed request creates nothing that a fresh read does not still call
 * a candidate. See the identity rule in `lib/portfolio-harvest.ts` — there is
 * no update path in the sweep at all, so nothing the owner typed can be
 * touched by pressing this twice.
 */
export async function harvestProductVideos(
  keys?: string[]
): Promise<PortfolioActionResult & { outcome?: HarvestOutcome }> {
  try {
    await requireAdmin("harvestProductVideos");
    const outcome = await runHarvest(
      Array.isArray(keys)
        ? keys.filter((k) => typeof k === "string" && k).slice(0, 100)
        : undefined
    );
    if (outcome.created.length) revalidatePortfolio();
    return { success: true, outcome };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/**
 * Re-read one piece's link and overwrite its title, poster and embed.
 *
 * **Separate from the sweep on purpose.** This is the only path that writes
 * over a row that already exists, and it overwrites exactly the three fields
 * the provider owns — never the description, the tags, the section or the
 * position. A caption edited on Instagram is a reason to offer this; it is not
 * a reason for a background sweep to silently undo an afternoon's editing.
 *
 * The description is left alone even when it is empty, because "the owner
 * deleted the caption" and "the owner never wrote one" are the same state here
 * and guessing wrong overwrites their deletion.
 */
export async function refreshPortfolioItem(
  id: string
): Promise<PortfolioActionResult & { warning?: string }> {
  try {
    await requireAdmin("refreshPortfolioItem");

    const item = await prisma.portfolioItem.findUnique({
      where: { id },
      select: { id: true, url: true },
    });
    if (!item) return { success: false, error: "That piece is gone." };
    if (!item.url) {
      return {
        success: false,
        error: "This piece has no link to refresh from.",
      };
    }

    const resolved = await resolveForPortfolio(item.url);
    if (!resolved.ok) return { success: false, error: resolved.error };

    await prisma.portfolioItem.update({
      where: { id },
      data: {
        url: resolved.url,
        // A provider that gave us no title must not blank the one on screen.
        ...(resolved.title ? { title: resolved.title } : {}),
        ...(resolved.imageUrl ? { imageUrl: resolved.imageUrl } : {}),
        ...(resolved.embedHtml ? { embedHtml: resolved.embedHtml } : {}),
      },
    });

    revalidatePortfolio();
    return {
      success: true,
      ...(resolved.warning ? { warning: resolved.warning } : {}),
    };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/*
 * `copyToBlob` used to live here. It now lives in `lib/portfolio-harvest.ts`
 * as `copySocialThumbnail`, unchanged, because harvesting needs the identical
 * bounds — see the note on `importSocialPost` above.
 */
