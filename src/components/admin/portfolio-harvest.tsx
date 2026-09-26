"use client";

/**
 * "There are reels in your catalogue that aren't in the portfolio."
 *
 * ## Why this is a panel and not a background job
 *
 * `Product.videos` already holds Instagram reels and YouTube films, and
 * re-typing each into the portfolio is a chore that does not get done. The
 * obvious fix — publish them automatically — is the one this codebase already
 * tried and deleted: `lib/portfolio.ts` records that `productVideoEntries()`
 * read the catalogue on every render and published a tile per link, and that
 * the owner then had **no way to take one down**.
 *
 * So the detection is automatic and the publishing is a press. The panel loads
 * a read-only plan (two queries, no network, nothing written), says exactly
 * what would be added, and creates rows only when the owner asks. Same
 * draft-first shape as the NimbusPost dispatch panel, and for the same reason:
 * a screen that publishes to a public page just by being opened is a screen
 * nobody can safely leave open.
 *
 * ## Three states, and none of them is an error
 *
 * - **Missing** — links with no portfolio row. Tickable, then Add.
 * - **Already in the portfolio** — the interesting one. A link is "covered"
 *   whether the row was harvested *or* typed by hand, which is what stops a
 *   reel the owner already wrote up from being duplicated underneath itself.
 *   Shown so the absence of a row in the list above is explained rather than
 *   mysterious.
 * - **No longer in the catalogue** — rows we made whose link has since left
 *   the product. Never deleted automatically: by now the row may carry a
 *   description nobody else has. It is listed, and the owner decides.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Clapperboard,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { MiniButton } from "@/components/admin/form-kit";
import { getHarvestPlan, harvestProductVideos } from "@/app/actions/portfolio";
import type { HarvestPlan } from "@/lib/portfolio-harvest";
import { cn } from "@/lib/utils";

const PROVIDER_LABEL: Record<string, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
};

/**
 * `initialPlan` comes from the server page, already resolved.
 *
 * It used to be fetched in a mount effect, which was wrong twice over: it
 * flashed "Checking your catalogue…" on every single visit to a screen the
 * owner opens constantly, and it added a second server round trip for a read
 * the page had already made a request for. Reading it in the page is the same
 * two queries inside the request that is already open — and it is one fewer
 * `set-state-in-effect` on the pile CLAUDE.md records.
 *
 * `null` means the read failed. The banner then simply does not appear, which
 * is the right failure for a suggestion: a dead portfolio harvester must not
 * put an error across a working list.
 */
export function PortfolioHarvest({
  initialPlan,
}: {
  initialPlan: HarvestPlan | null;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<HarvestPlan | null>(initialPlan);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  /** Ticked keys. `null` means "everything" until the owner unticks one. */
  const [picked, setPicked] = useState<Set<string> | null>(null);

  /** Re-read after a sweep, or when the owner presses Check again. */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getHarvestPlan();
      setPlan(next);
      setPicked(null);
    } catch {
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const candidates = plan?.candidates ?? [];
  const orphans = plan?.orphans ?? [];
  const covered = plan?.covered ?? [];

  const isPicked = (key: string) => (picked ? picked.has(key) : true);
  const pickedCount = picked ? picked.size : candidates.length;

  function toggle(key: string) {
    setPicked((prev) => {
      const next = new Set(prev ?? candidates.map((c) => c.key));
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function run() {
    const keys = candidates.filter((c) => isPicked(c.key)).map((c) => c.key);
    if (keys.length === 0) return;

    setRunning(true);
    const res = await harvestProductVideos(keys);
    setRunning(false);

    if (!res.success) {
      toast.error(res.error ?? "Couldn't add those.");
      return;
    }

    const out = res.outcome;
    const made = out?.created.length ?? 0;
    if (made > 0) {
      toast.success(`${made} added to the portfolio`);
    }

    /*
     * Rows that arrived without a stored cover.
     *
     * Said once, as a count, rather than once per row: the cause is the same
     * for all of them (Instagram's poster expires, so it is copied into our
     * own storage or not stored), and five identical toasts is how a real
     * message gets dismissed unread. The tiles are not broken — they fall back
     * to the linked garment's photo — so this is a "you can do better", not an
     * error, and it is not red.
     */
    const coverless = (out?.created ?? []).filter((c) => c.warning);
    if (coverless.length > 0) {
      toast.message(
        `${coverless.length} of them came in without their own cover photo`,
        {
          description:
            "They are showing the linked product's photo for now. Open one and pick a still, or set BLOB_READ_WRITE_TOKEN so Instagram covers can be copied in automatically.",
        }
      );
    }
    // Each failure gets its own line: they fail for different reasons (a
    // private post, a rate limit) and one merged "3 failed" tells the owner
    // nothing they can act on.
    for (const f of out?.failed ?? []) toast.error(f.error);
    if (made === 0 && (out?.failed.length ?? 0) === 0) {
      toast.message("Nothing to add — those are already in the portfolio.");
    }

    await load();
    router.refresh();
  }

  /* ---- Nothing to say ---- */
  if (!plan) {
    // Either the read failed, or a re-read is in flight and cleared it. Both
    // are silent: this panel is a suggestion, and a suggestion that cannot be
    // made is best not announced.
    return loading ? (
      <div className="mt-6 flex items-center gap-2 rounded-2xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Checking your catalogue for reels…
      </div>
    ) : null;
  }
  if (candidates.length === 0 && orphans.length === 0) {
    // Covered-only is not worth a panel on a screen the owner opens daily —
    // "everything is already here" is best said by saying nothing.
    if (covered.length === 0) return null;
    return (
      <div className="mt-6 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        <Check className="h-4 w-4 shrink-0 text-success" aria-hidden />
        All {covered.length} video link
        {covered.length === 1 ? "" : "s"} in your catalogue {covered.length === 1 ? "is" : "are"} already in the portfolio.
        <MiniButton onClick={load} className="ml-auto h-11 sm:h-9">
          <RefreshCw className="h-3.5 w-3.5" /> Check again
        </MiniButton>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mt-6 min-w-0 rounded-2xl border p-4 sm:p-5",
        candidates.length > 0
          ? "border-accent/40 bg-accent/5"
          : "border-border bg-muted/20"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-1.5 text-muted-foreground">
            <Clapperboard className="h-3.5 w-3.5" aria-hidden /> From your catalogue
          </p>
          <p className="mt-2 break-words font-serif text-lg leading-snug">
            {candidates.length > 0
              ? `${candidates.length} video link${
                  candidates.length === 1 ? "" : "s"
                } on your products ${
                  candidates.length === 1 ? "isn't" : "aren't"
                } in the portfolio yet.`
              : `${orphans.length} piece${
                  orphans.length === 1 ? "" : "s"
                } came from a product link that has since changed.`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <MiniButton onClick={load} className="h-11 sm:h-9">
            <RefreshCw className="h-3.5 w-3.5" /> Check again
          </MiniButton>
          <MiniButton
            onClick={() => setOpen((o) => !o)}
            active={open}
            className="h-11 sm:h-9"
          >
            {open ? "Hide" : "Review"}
          </MiniButton>
        </div>
      </div>

      {open && (
        <div className="mt-4 min-w-0 space-y-4 border-t border-border/60 pt-4">
          {/* ---- Missing ---- */}
          {candidates.length > 0 && (
            <div className="min-w-0 space-y-2">
              <p className="eyebrow text-muted-foreground">Not in the portfolio</p>
              <ul className="space-y-2">
                {candidates.map((c) => (
                  <li
                    key={c.key}
                    className="flex min-w-0 flex-wrap items-start gap-2 rounded-xl border border-border bg-card p-2 sm:flex-nowrap sm:items-center sm:gap-3 sm:p-3"
                  >
                    <label className="flex min-h-11 shrink-0 cursor-pointer items-center sm:min-h-0">
                      <input
                        type="checkbox"
                        checked={isPicked(c.key)}
                        onChange={() => toggle(c.key)}
                        className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
                        aria-label={`Add ${c.productName}'s ${
                          PROVIDER_LABEL[c.provider]
                        } link`}
                      />
                    </label>
                    <div className="min-w-0 flex-1 basis-32">
                      <p className="flex flex-wrap items-center gap-x-2 text-sm">
                        <span className="text-accent">
                          {PROVIDER_LABEL[c.provider]}
                        </span>
                        <span aria-hidden>·</span>
                        <Link
                          href={`/admin/products?q=${encodeURIComponent(c.productName)}`}
                          className="min-w-0 break-words font-medium hover:underline"
                        >
                          {c.productName}
                        </Link>
                        {c.alsoOn.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            (also on {c.alsoOn.join(", ")})
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                        {c.url}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={run}
                  disabled={running || pickedCount === 0}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg bg-foreground px-5 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {running ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {running
                    ? "Adding…"
                    : `Add ${pickedCount} to the portfolio`}
                </button>
                <p className="text-xs text-muted-foreground">
                  They land under Reels &amp; films, hidden from nobody, and are
                  ordinary pieces afterwards — edit or delete them freely.
                </p>
              </div>
            </div>
          )}

          {/* ---- Orphans ---- */}
          {orphans.length > 0 && (
            <div className="min-w-0 space-y-2">
              <p className="eyebrow flex items-center gap-1.5 text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> No longer in
                the catalogue
              </p>
              <p className="text-xs text-muted-foreground">
                These were added from a product link that has since been removed
                or retired. Nothing was deleted — by now they may say something
                the product page never did.
              </p>
              <ul className="space-y-2">
                {orphans.map((o) => (
                  <li
                    key={o.itemId}
                    className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2 sm:gap-3 sm:p-3"
                  >
                    <div className="min-w-0 flex-1 basis-32">
                      <p className="min-w-0 break-words text-sm font-medium">
                        {o.itemTitle}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {o.reason === "product-gone"
                          ? "the product was deleted"
                          : o.reason === "product-inactive"
                            ? `${o.productName} is hidden`
                            : `the link was removed from ${o.productName}`}
                        {!o.isActive && " · already hidden here"}
                      </p>
                    </div>
                    <Link
                      href={`/admin/portfolio/${o.itemId}/edit`}
                      className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border px-3 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted sm:min-h-9"
                    >
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ---- Covered ---- */}
          {covered.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {covered.length} other catalogue link
              {covered.length === 1 ? " is" : "s are"} already in the portfolio
              and will never be added twice — a link is matched by its Instagram
              shortcode or YouTube id, so the same reel pasted in three
              different shapes is still one piece.
            </p>
          )}

          {/* ---- Unrecognised ---- */}
          {(plan.unrecognised?.length ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              {plan.unrecognised.length} video link
              {plan.unrecognised.length === 1 ? "" : "s"} on your products
              {plan.unrecognised.length === 1 ? " is" : " are"} not Instagram or
              YouTube, so {plan.unrecognised.length === 1 ? "it is" : "they are"}{" "}
              left alone. Add {plan.unrecognised.length === 1 ? "it" : "them"} by
              hand if {plan.unrecognised.length === 1 ? "it belongs" : "they belong"}{" "}
              here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
