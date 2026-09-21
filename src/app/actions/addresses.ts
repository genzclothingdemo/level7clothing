"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getUserSession } from "@/lib/user-auth";

/* ---------------------------------------------------------------------------
   THE ADDRESS BOOK IS THE SINGLE SOURCE OF TRUTH.

   Why this file keeps talking about "legacy" columns
   --------------------------------------------------
   `User.address / city / state / pincode` are four inline columns that predate
   the `Address` table, and for a while BOTH were live:

     1. the profile form wrote the inline `User` columns,
     2. the address book wrote `Address` rows,
     3. checkout typed a third copy and saved it to neither.

   So one customer could hold three different "current" addresses with nothing
   to say which one a parcel would actually use. From now on:

   * **Only `Address` is written.** Nothing writes the inline `User` columns any
     more — `updateProfile` in `src/app/actions/account.ts` was narrowed to name
     and phone for exactly this reason. Do not add them back.
   * **The inline columns are a read-ONCE fallback.** The first time a customer
     who has inline values and an empty address book opens their account or the
     checkout, `migrateLegacyInlineAddress` copies them into a single `Address`
     labelled "Home" and marked default. After that they are never read again.
   * They are deliberately not dropped. Removing the columns is a schema change
     and `prisma/schema.prisma` is out of scope here; they are inert as long as
     nothing writes them.
--------------------------------------------------------------------------- */

/** The address shape every component in the store renders. */
export type SavedAddress = {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
};

/**
 * `Address.label` is free text in the database (the column predates the three
 * fixed tags), so an old row can hold anything. Anything unrecognised is
 * normalised to "Other": the UI offers exactly three tags and the cards key
 * their icon off them, so an unknown label would render as a blank chip.
 */
const LABELS = ["Home", "Work", "Other"] as const;

function normaliseLabel(value: string | undefined): string {
  const v = (value ?? "").trim();
  const hit = LABELS.find((l) => l.toLowerCase() === v.toLowerCase());
  return hit ?? "Other";
}

const addressSchema = z.object({
  label: z.string().trim().max(30).optional(),
  fullName: z.string().trim().min(2, "Please enter a name").max(80),
  phone: z.string().trim().min(6, "Please enter a phone number").max(20),
  address: z.string().trim().min(5, "Please enter the full address").max(300),
  city: z.string().trim().min(2, "Please enter a city").max(80),
  state: z.string().trim().min(2, "Please enter a state").max(80),
  pincode: z.string().trim().regex(/^\d{6}$/, "Pincode must be 6 digits"),
  isDefault: z.boolean().optional(),
});

export type AddressInput = z.input<typeof addressSchema>;

function toSaved(row: {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}): SavedAddress {
  return {
    id: row.id,
    label: normaliseLabel(row.label),
    fullName: row.fullName,
    phone: row.phone,
    address: row.address,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    isDefault: row.isDefault,
  };
}

/** Default first, then most recently touched — the order every list uses. */
const ORDER = [{ isDefault: "desc" as const }, { updatedAt: "desc" as const }];

/**
 * Copy the legacy inline `User` address into the address book, once.
 *
 * Only runs when the book is empty, so it can never duplicate a real entry and
 * can never overwrite one. Returns the created row, or null when there was
 * nothing worth migrating.
 */
async function migrateLegacyInlineAddress(userId: string) {
  const u = await prisma.user
    .findUnique({
      where: { id: userId },
      select: {
        name: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        // Re-checked here rather than trusted from the caller: this is the
        // guard that makes the migration idempotent.
        addresses: { select: { id: true }, take: 1 },
      },
    })
    .catch(() => null);

  if (!u || u.addresses.length > 0) return null;
  // A partial legacy address is worse than none — it would fail checkout
  // validation and look like a saved address that does not work.
  if (!u.address?.trim() || !u.city?.trim() || !u.state?.trim() || !u.pincode?.trim()) {
    return null;
  }

  return prisma.address
    .create({
      data: {
        userId,
        label: "Home",
        fullName: u.name,
        phone: u.phone ?? "",
        address: u.address.trim(),
        city: u.city.trim(),
        state: u.state.trim(),
        pincode: u.pincode.trim(),
        isDefault: true,
      },
    })
    .catch(() => null);
}

/**
 * Guarantee the invariant the whole feature rests on: an account with any
 * addresses has exactly one default.
 *
 * Cheap in the normal case (one indexed read that finds a default and stops),
 * and the only place that repairs a book left defaultless by an edit.
 */
async function ensureSingleDefault(userId: string) {
  const defaults = await prisma.address.findMany({
    where: { userId, isDefault: true },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });

  if (defaults.length === 1) return;

  if (defaults.length > 1) {
    // Keep the most recently touched one, demote the rest.
    await prisma.address.updateMany({
      where: { userId, id: { notIn: [defaults[0].id] } },
      data: { isDefault: false },
    });
    return;
  }

  // None: promote the oldest surviving address.
  const next = await prisma.address.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (next) {
    await prisma.address.update({
      where: { id: next.id },
      data: { isDefault: true },
    });
  }
}

function revalidate() {
  revalidatePath("/account");
  revalidatePath("/checkout");
}

/**
 * Every saved address for the signed-in customer, default first.
 *
 * Returns `null` — not `[]` — when nobody is signed in, so the checkout can
 * tell "guest, show the plain form and do not offer to save" apart from
 * "signed in with an empty book".
 */
export async function listMyAddresses(): Promise<SavedAddress[] | null> {
  const session = await getUserSession();
  if (!session) return null;

  const rows = await prisma.address
    .findMany({ where: { userId: session.id }, orderBy: ORDER })
    .catch(() => []);

  // Steady state costs one query: the legacy fallback is only consulted for an
  // account that has never saved an address.
  if (rows.length === 0) {
    const migrated = await migrateLegacyInlineAddress(session.id);
    return migrated ? [toSaved(migrated)] : [];
  }

  // Repair a book left with no default at all. The old edit path let a
  // customer untick "default" on their only default, which stranded the
  // account in that state; every display already falls back to the first row,
  // but the invariant should be true in the database too. Fires once, then
  // never again.
  if (!rows.some((r) => r.isDefault)) {
    const oldest = rows.reduce((a, b) =>
      a.createdAt <= b.createdAt ? a : b
    );
    await prisma.address
      .update({ where: { id: oldest.id }, data: { isDefault: true } })
      .catch(() => null);
    return rows
      .map((r) => toSaved({ ...r, isDefault: r.id === oldest.id }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }

  return rows.map(toSaved);
}

export async function saveAddress(input: AddressInput & { id?: string }) {
  const session = await getUserSession();
  if (!session) return { ok: false as const, error: "Please log in first." };

  const parsed = addressSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }

  const data = {
    ...parsed.data,
    label: normaliseLabel(parsed.data.label),
    isDefault: parsed.data.isDefault ?? false,
  };

  let savedId: string;

  try {
    if (input.id) {
      // Scope the lookup to this user so an id from elsewhere can't be edited.
      const owned = await prisma.address.findFirst({
        where: { id: input.id, userId: session.id },
        select: { id: true, isDefault: true },
      });
      if (!owned) return { ok: false as const, error: "Address not found." };

      // A default can be moved but not simply switched off — unticking the box
      // while editing the current default used to leave the account with no
      // default at all. Promoting a different address is the only way out, and
      // the form disables the checkbox to say so.
      const isDefault = data.isDefault || owned.isDefault;

      if (isDefault) {
        await prisma.address.updateMany({
          where: { userId: session.id },
          data: { isDefault: false },
        });
      }

      await prisma.address.update({
        where: { id: owned.id },
        data: { ...data, isDefault },
      });
      savedId = owned.id;
    } else {
      const count = await prisma.address.count({ where: { userId: session.id } });
      const isDefault = data.isDefault || count === 0;

      if (isDefault && count > 0) {
        await prisma.address.updateMany({
          where: { userId: session.id },
          data: { isDefault: false },
        });
      }

      const created = await prisma.address.create({
        data: { ...data, isDefault, userId: session.id },
      });
      savedId = created.id;
    }

    await ensureSingleDefault(session.id);
  } catch {
    return { ok: false as const, error: "Could not save the address." };
  }

  revalidate();
  return { ok: true as const, id: savedId };
}

export async function deleteAddress(id: string) {
  const session = await getUserSession();
  if (!session) return { ok: false as const, error: "Please log in first." };

  try {
    const owned = await prisma.address.findFirst({
      where: { id, userId: session.id },
      select: { id: true },
    });
    if (!owned) return { ok: false as const, error: "Address not found." };

    await prisma.address.delete({ where: { id: owned.id } });
    // Deleting the default promotes another rather than leaving none.
    await ensureSingleDefault(session.id);
  } catch {
    return { ok: false as const, error: "Could not delete the address." };
  }

  revalidate();
  return { ok: true as const };
}

export async function setDefaultAddress(id: string) {
  const session = await getUserSession();
  if (!session) return { ok: false as const, error: "Please log in first." };

  try {
    const owned = await prisma.address.findFirst({
      where: { id, userId: session.id },
      select: { id: true },
    });
    if (!owned) return { ok: false as const, error: "Address not found." };

    await prisma.address.updateMany({
      where: { userId: session.id },
      data: { isDefault: false },
    });
    await prisma.address.update({
      where: { id: owned.id },
      data: { isDefault: true },
    });
  } catch {
    return { ok: false as const, error: "Could not update the default." };
  }

  revalidate();
  return { ok: true as const };
}
