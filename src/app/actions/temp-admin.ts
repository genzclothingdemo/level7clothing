"use server";

/**
 * Creating, switching off and removing temporary admins.
 *
 * ## Only async functions live here
 *
 * A `"use server"` file may export nothing but async functions — CLAUDE.md
 * records a `export const CHECKOUT_MODES = [...]` in `actions/orders.ts` taking
 * out every server action in that module at runtime, with `tsc` and
 * `next build` both passing. So the modes, the labels and the row shapes are in
 * `lib/temp-admin.ts`; this file is the four verbs and nothing else.
 *
 * ## Every verb here is itself a write
 *
 * Which means every one of them goes through `requireAdminWrite`. That is not a
 * formality: without it, a **view-only** temporary admin could call
 * `createTempAdmin` by id and mint themselves a full-access account. A
 * permission system whose own controls are unguarded is decoration.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { hashPassword, requireAdminWrite, type AdminSession } from "@/lib/auth";
import {
  ADMIN_MODES,
  AdminReadOnlyError,
  logAdminActivity,
} from "@/lib/temp-admin";

export type TempAdminResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * The write gate, with its refusal turned into a result the panel can print.
 *
 * `requireAdminWrite` throws, which is right for the forty actions whose
 * callers already surface a thrown error. These four report through a result
 * object, so the refusal is caught here and returned as the sentence the guard
 * wrote — a view-only holder gets told *why*, not "something went wrong".
 */
async function guard(
  what: string
): Promise<{ ok: true; session: AdminSession } | { ok: false; error: string }> {
  try {
    return { ok: true, session: await requireAdminWrite(what) };
  } catch (err) {
    if (err instanceof AdminReadOnlyError) return { ok: false, error: err.message };
    return { ok: false, error: "You are not signed in as an admin." };
  }
}

/** Who did it, for the line written onto the target's trail. */
function actor(session: AdminSession): string {
  return session.name ? `${session.name} (${session.email})` : session.email;
}

/* ------------------------------------------------------------------ */
/*  Create                                                             */
/* ------------------------------------------------------------------ */

const createSchema = z.object({
  name: z.string().trim().min(2, "Enter their name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  // Eight, not the six `changeAdminPassword` allows. This is a password typed
  // once by one person and handed to another, on an account that can empty the
  // catalogue — the weakest it should ever be is longer than the owner's floor.
  password: z.string().min(8, "Use at least 8 characters"),
  mode: z.enum(ADMIN_MODES),
  /** "" or YYYY-MM-DD from a date input. */
  expiresAt: z.string().trim().default(""),
  note: z.string().trim().max(200, "Keep the note under 200 characters").default(""),
});

export type CreateTempAdminInput = z.input<typeof createSchema>;

/**
 * A `YYYY-MM-DD` from a date input as the **last** moment of that day.
 *
 * "Expires 30 September" has to mean they can still work on the 30th, which is
 * what someone typing that date means. Interpreted in the server's clock (UTC
 * in production, the owner's own in dev), so an IST owner gets until 05:29 the
 * following morning — erring generous, which is the right direction for an
 * expiry the owner can end early at any time with the Off switch.
 */
function parseExpiry(value: string): Date | null | "invalid" {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return "invalid";
  const date = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    23,
    59,
    59,
    999
  );
  if (Number.isNaN(date.getTime())) return "invalid";
  if (date.getTime() <= Date.now()) return "invalid";
  return date;
}

export async function createTempAdmin(
  input: CreateTempAdminInput
): Promise<TempAdminResult> {
  const gate = await guard("createTempAdmin");
  if (!gate.ok) return gate;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { name, email, password, mode, note } = parsed.data;

  const expiresAt = parseExpiry(parsed.data.expiresAt);
  if (expiresAt === "invalid") {
    return { ok: false, error: "Pick an expiry date in the future, or leave it blank." };
  }

  try {
    // `authenticateAdmin` checks AdminUser first, so a temporary account on the
    // owner's address could never be reached — it would silently never work and
    // look like a wrong password. Refused with the reason instead.
    const clash = await prisma.adminUser.findUnique({
      where: { email },
      select: { id: true },
    });
    if (clash) {
      return {
        ok: false,
        error: "That address is already the store owner's login. Use a different one.",
      };
    }

    const existing = await prisma.tempAdmin.findUnique({
      where: { email },
      select: { id: true, name: true },
    });
    if (existing) {
      return {
        ok: false,
        error: `${existing.name} already has access on that address. Switch it off or delete it first.`,
      };
    }

    const created = await prisma.tempAdmin.create({
      data: {
        name,
        email,
        passwordHash: await hashPassword(password),
        mode,
        isActive: true,
        expiresAt,
        note: note || null,
      },
      select: { id: true, name: true },
    });

    // The first line of their trail, so the list always says where an account
    // came from and who let them in.
    await logAdminActivity({
      tempAdminId: created.id,
      action: "create",
      path: "/admin/settings?tab=add_admin",
      detail: `Account created by ${actor(gate.session)} with ${
        mode === "full" ? "full" : "view-only"
      } access`,
    });
  } catch (err) {
    console.error("[temp-admin] createTempAdmin failed:", err);
    return { ok: false, error: "Could not create the account — please try again." };
  }

  revalidatePath("/admin/settings");
  return {
    ok: true,
    message: `${name} can now sign in at /admin/login with ${
      mode === "full" ? "full access" : "view-only access"
    }.`,
  };
}

/* ------------------------------------------------------------------ */
/*  Switch off / on                                                    */
/* ------------------------------------------------------------------ */

/**
 * Turn access off or back on.
 *
 * Off takes effect on their **next request**, not when their token expires:
 * `getAdminSession` re-reads this row every time, so a session minted before
 * the switch was flipped stops working immediately. Nothing has to be revoked
 * because nothing was trusted from the cookie.
 */
export async function setTempAdminActive(
  id: string,
  active: boolean
): Promise<TempAdminResult> {
  const gate = await guard(active ? "enableTempAdmin" : "disableTempAdmin");
  if (!gate.ok) return gate;

  if (!id) return { ok: false, error: "Missing account" };
  if (gate.session.tempAdminId === id) {
    return {
      ok: false,
      error: "You cannot switch your own access off — ask the store owner.",
    };
  }

  try {
    const row = await prisma.tempAdmin.update({
      where: { id },
      data: { isActive: active },
      select: { name: true },
    });

    await logAdminActivity({
      tempAdminId: id,
      action: "update",
      path: "/admin/settings?tab=add_admin",
      detail: `Access ${active ? "switched back on" : "switched off"} by ${actor(gate.session)}`,
    });

    revalidatePath("/admin/settings");
    return {
      ok: true,
      message: active
        ? `${row.name} can sign in again.`
        : `${row.name} is switched off — they stop working on their next click.`,
    };
  } catch (err) {
    console.error("[temp-admin] setTempAdminActive failed:", err);
    return { ok: false, error: "Could not change that account — please try again." };
  }
}

/* ------------------------------------------------------------------ */
/*  Delete                                                             */
/* ------------------------------------------------------------------ */

/**
 * Remove the person **and their whole trail**.
 *
 * `AdminActivityLog.tempAdminId` cascades, which is what was asked for and is
 * why this screen says so before you press it, with the count. It is what makes
 * this an operational log for the owner's oversight rather than an audit
 * record: after a delete there is nothing left to check anything against.
 *
 * The count is read here as well as shown on screen, so the confirmation the
 * owner gets back names what actually went rather than what the page last saw.
 */
export async function deleteTempAdmin(id: string): Promise<TempAdminResult> {
  const gate = await guard("deleteTempAdmin");
  if (!gate.ok) return gate;

  if (!id) return { ok: false, error: "Missing account" };
  if (gate.session.tempAdminId === id) {
    return { ok: false, error: "You cannot delete your own access." };
  }

  try {
    const row = await prisma.tempAdmin.findUnique({
      where: { id },
      select: { name: true, _count: { select: { logs: true } } },
    });
    if (!row) return { ok: false, error: "That account has already been removed." };

    await prisma.tempAdmin.delete({ where: { id } });

    revalidatePath("/admin/settings");
    return {
      ok: true,
      message:
        row._count.logs > 0
          ? `${row.name} removed, along with ${row._count.logs} activity ${
              row._count.logs === 1 ? "line" : "lines"
            }.`
          : `${row.name} removed.`,
    };
  } catch (err) {
    console.error("[temp-admin] deleteTempAdmin failed:", err);
    return { ok: false, error: "Could not remove that account — please try again." };
  }
}
