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
import { getAdminSession } from "@/lib/auth";
import { PORTFOLIO_KINDS, isSafeHref, type PortfolioKind } from "@/lib/portfolio";

async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) throw new Error("Unauthorized");
  return session;
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
    // A tile with no picture, no link and no embed is a title on a grey box.
    // It is not an error the database can catch, so it is caught here.
    if (!v.imageUrl && !v.url && !v.embedHtml && !v.productId) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message:
          "Give this piece something to show: an image, a link, an embed, or a product.",
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
    tags: v.tags,
    sortOrder: v.sortOrder,
    isFeatured: v.isFeatured,
    isActive: v.isActive,
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
    await requireAdmin();
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
    await requireAdmin();
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
    await requireAdmin();
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
    await requireAdmin();
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
    await requireAdmin();

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
    await requireAdmin();

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
