import "server-only";

/**
 * temp-admin — everything about a *temporary* admin: the two modes, whether an
 * account is still alive, and the activity trail.
 *
 * ## Why this file imports nothing from `lib/auth.ts`
 *
 * `auth.ts` needs this module (a session has to be re-checked against the
 * TempAdmin row on every request) and the guard needs `getAdminSession()`. If
 * both imported each other the cycle would only work by accident — ESM tolerates
 * it while neither side *uses* an imported binding during module evaluation, and
 * `auth.ts` evaluates `resolveSecret()` at the top level. So the dependency runs
 * one way only: **`auth.ts` → `temp-admin.ts`, never back.** The guards
 * (`requireAdminWrite` / `requireAdminSession`) therefore live in `auth.ts`,
 * beside `getAdminSession`, which is where admin identity is already
 * established.
 *
 * `import type { AdminSession }` below is erased at build time, so it is not a
 * runtime edge and cannot form a cycle — the same reason CLAUDE.md gives for
 * importing a type from a `"use client"` module being safe.
 *
 * ## This is an operational log, not an audit record
 *
 * `AdminActivityLog.tempAdminId` cascades on delete. Removing the person
 * removes their entire trail, deliberately — the owner asked to be able to
 * clear someone out completely. That means nothing here survives to be relied
 * on afterwards, so the panel says so before a delete and prints the number of
 * lines that are about to go with it.
 */

import { prisma } from "./prisma";
import type { AdminSession } from "./auth";

/* ------------------------------------------------------------------ */
/*  Modes                                                              */
/* ------------------------------------------------------------------ */

/**
 * The two levels of access, and the only two.
 *
 * `full` is "same as the owner". `readonly` sees every screen and changes
 * nothing — and that has to be true in the server actions, because a server
 * action is a public endpoint addressable by id. A hidden button is a courtesy;
 * `requireAdminWrite` is the permission.
 */
export const ADMIN_MODES = ["readonly", "full"] as const;

export type AdminMode = (typeof ADMIN_MODES)[number];

export function isAdminMode(v: unknown): v is AdminMode {
  return typeof v === "string" && (ADMIN_MODES as readonly string[]).includes(v);
}

// The human labels for a mode and a state are deliberately NOT here. This
// module is `server-only`, so a client component cannot import them, and a
// second copy of a label is a label that drifts. They live once, in
// `components/admin/temp-admin-panel.tsx`, which is the only thing that prints
// them — the sentences this file writes into the log are log sentences, not the
// same string wearing a different hat.

/**
 * What a refused write says. One sentence, and it names the fix — an
 * unexpected refusal has to explain itself, because the person seeing it may
 * not know they were given view-only access.
 */
export const READ_ONLY_MESSAGE =
  "View-only access: this account can read every screen but cannot change anything. Ask the store owner for full access.";

/**
 * Thrown by `requireAdminWrite` when a view-only holder attempts a write.
 *
 * A distinct class rather than a bare `Error` so a caller that wants to turn a
 * refusal into a returned `{ ok: false }` can tell it apart from a genuine
 * failure. Nothing does yet — every admin action already surfaces a thrown
 * error as a toast — but the alternative (matching on the message string) is
 * the kind of thing that breaks silently when the wording changes.
 */
export class AdminReadOnlyError extends Error {
  readonly readOnly = true;
  constructor(message = READ_ONLY_MESSAGE) {
    super(message);
    this.name = "AdminReadOnlyError";
  }
}

/* ------------------------------------------------------------------ */
/*  Liveness                                                           */
/* ------------------------------------------------------------------ */

export type TempAdminState = "active" | "disabled" | "expired";

/**
 * Whether an account may sign in *right now*.
 *
 * Deliberately pure and deliberately not a stored column: an `expired` flag
 * would need something to flip it, and whatever that was — a cron, a login
 * hook — would be a second source of truth that can lag. Comparing `expiresAt`
 * against the clock cannot lag.
 *
 * Switched off is reported ahead of expired because it is the one a human did
 * on purpose, and it is the more useful thing to read back.
 */
export function tempAdminState(
  row: { isActive: boolean; expiresAt: Date | null },
  now: Date = new Date()
): TempAdminState {
  if (!row.isActive) return "disabled";
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

/** The columns a session needs. Nothing here is a secret. */
export type LiveTempAdmin = {
  id: string;
  name: string;
  email: string;
  mode: AdminMode;
  state: TempAdminState;
  expiresAt: Date | null;
};

/**
 * Re-read a temporary admin from the database.
 *
 * **This is the "on every request" half of the requirement.** The JWT carries a
 * mode, but the database decides: a session minted while someone had full
 * access stops being a full-access session the moment the row says otherwise,
 * and a session minted while they were active stops working the moment they are
 * switched off, expire, or are deleted. Nothing has to be revoked, because
 * nothing is trusted from the cookie except *which row to read*.
 *
 * A failed read returns `null`, which signs the holder out. Failing **closed**
 * is the only safe direction for a permission gate — a database blip briefly
 * logging a temporary admin out is a nuisance; a database blip granting them
 * access is not something to trade for it. The permanent owner is unaffected:
 * their token carries no `tempAdminId`, so this is never called for them and
 * the admin costs zero extra queries.
 */
export async function readLiveTempAdmin(
  id: string,
  now: Date = new Date()
): Promise<LiveTempAdmin | null> {
  const row = await prisma.tempAdmin
    .findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        mode: true,
        isActive: true,
        expiresAt: true,
      },
    })
    .catch(() => null);

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    // An unrecognised string in the column is treated as the *narrower* mode.
    // The column is a plain `String`, so nothing at the database level stops a
    // typo getting in; resolving it to `full` would turn a typo into a
    // promotion.
    mode: isAdminMode(row.mode) ? row.mode : "readonly",
    state: tempAdminState(row, now),
    expiresAt: row.expiresAt,
  };
}

/* ------------------------------------------------------------------ */
/*  The trail                                                          */
/* ------------------------------------------------------------------ */

export const LOG_ACTIONS = [
  "login",
  "create",
  "update",
  "delete",
  "blocked",
] as const;

export type LogAction = (typeof LOG_ACTIONS)[number];

/**
 * A camelCase action name as a sentence: `deleteProduct` → "Delete product".
 *
 * A lookup table mapping every action to a hand-written phrase was the other
 * option and is worse: it is a second list of every server action in the app,
 * kept in step by nothing, and a new action added without a row in it logs
 * *nothing readable* rather than something slightly clumsy. Splitting the name
 * cannot fall out of date.
 */
export function humaniseAction(name: string): string {
  const words = name
    // Drop the suffix the codebase uses to disambiguate an action from the
    // library function it wraps — "Sync order from nimbus action" reads badly.
    .replace(/Action$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.]+/g, " ")
    .trim()
    .toLowerCase();
  if (!words) return "Changed something";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Which of the five verbs an action name is, for the coloured chip in the list.
 *
 * Only ever cosmetic. The readable sentence is `humaniseAction`; this is the
 * one-word grouping that lets the owner scan a column for deletions.
 */
export function verbFor(name: string): LogAction {
  const n = name.toLowerCase();
  if (/^(delete|remove|cancel|purge|clear)/.test(n)) return "delete";
  if (/^(create|add|import|draft|book|restore)/.test(n)) return "create";
  return "update";
}

/**
 * Write one line to a temporary admin's trail.
 *
 * Awaited rather than fired and forgotten: this runs in a serverless function
 * that may be frozen the instant its response is sent, and a log that lands
 * only when the platform feels generous is not oversight. It is one indexed
 * insert, and it only ever runs for a temporary admin — the owner's own actions
 * are not logged, because there is nobody to be accountable to.
 *
 * It never throws. A failed insert must not turn a successful write into an
 * error the operator has to interpret, and it must not turn a *refusal* into a
 * 500 either — a refusal has already done its job by the time we get here.
 */
export async function logAdminActivity(input: {
  tempAdminId: string;
  action: LogAction;
  path?: string | null;
  detail?: string | null;
}): Promise<void> {
  try {
    await prisma.adminActivityLog.create({
      data: {
        tempAdminId: input.tempAdminId,
        action: input.action,
        path: input.path?.slice(0, 200) || null,
        detail: input.detail?.slice(0, 300) || null,
      },
    });
  } catch (err) {
    console.error("[temp-admin] could not write the activity log:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Permission                                                         */
/* ------------------------------------------------------------------ */

/**
 * The single rule, stated once: may this session write?
 *
 * Takes the session rather than fetching it, so this module stays free of
 * `auth.ts`. `requireAdminWrite` in `auth.ts` is the only caller and is what
 * every admin action routes through.
 */
export function canWrite(session: Pick<AdminSession, "mode">): boolean {
  return session.mode === "full";
}

/* ------------------------------------------------------------------ */
/*  Reading the panel                                                  */
/* ------------------------------------------------------------------ */

/** One temporary admin as the Settings panel renders them. */
export type TempAdminRow = {
  id: string;
  name: string;
  email: string;
  mode: AdminMode;
  state: TempAdminState;
  isActive: boolean;
  /** ISO, or null. Serialised because this crosses to a client component. */
  expiresAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  note: string | null;
  /** Every line in this person's trail — the number the delete warning names. */
  logCount: number;
  recent: TempAdminLogRow[];
};

export type TempAdminLogRow = {
  id: string;
  action: string;
  path: string | null;
  detail: string | null;
  at: string;
};

/** How many recent lines each person's fold shows. */
const RECENT_PER_ADMIN = 12;

/**
 * Everyone, with their counts and their latest activity.
 *
 * Three queries, not one per person: the list, one `groupBy` for the totals and
 * one windowed read of the logs, which is then grouped in memory. `bom1` is
 * beside the database now (CLAUDE.md, "Why pages feel slow") but a query per
 * row is still a query per row, and this screen is one the owner opens to
 * *check on* people — it should not get slower as they hire more of them.
 *
 * Dates are handed over as ISO strings because this is read by a server
 * component and rendered by a client one.
 */
export async function listTempAdmins(): Promise<TempAdminRow[]> {
  const rows = await prisma.tempAdmin
    .findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] })
    .catch(() => null);

  if (!rows || rows.length === 0) return [];

  const ids = rows.map((r) => r.id);

  const [counts, logs] = await Promise.all([
    prisma.adminActivityLog
      .groupBy({
        by: ["tempAdminId"],
        where: { tempAdminId: { in: ids } },
        _count: { _all: true },
      })
      .catch(() => []),
    prisma.adminActivityLog
      .findMany({
        where: { tempAdminId: { in: ids } },
        orderBy: { at: "desc" },
        // Enough that everyone's fold is full even when one person has been
        // busy, without reading a trail that could be thousands of rows.
        take: RECENT_PER_ADMIN * Math.max(rows.length, 1) * 2,
      })
      .catch(() => []),
  ]);

  const countBy = new Map(counts.map((c) => [c.tempAdminId, c._count._all]));
  const recentBy = new Map<string, TempAdminLogRow[]>();
  for (const log of logs) {
    const bucket = recentBy.get(log.tempAdminId) ?? [];
    if (bucket.length >= RECENT_PER_ADMIN) continue;
    bucket.push({
      id: log.id,
      action: log.action,
      path: log.path,
      detail: log.detail,
      at: log.at.toISOString(),
    });
    recentBy.set(log.tempAdminId, bucket);
  }

  const now = new Date();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    mode: isAdminMode(r.mode) ? r.mode : "readonly",
    state: tempAdminState(r, now),
    isActive: r.isActive,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    note: r.note,
    logCount: countBy.get(r.id) ?? 0,
    recent: recentBy.get(r.id) ?? [],
  }));
}
