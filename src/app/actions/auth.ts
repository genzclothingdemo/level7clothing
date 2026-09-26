"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import {
  authenticateAdmin,
  setAdminCookie,
  clearAdminCookie,
} from "@/lib/auth";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export async function login(input: { email: string; password: string }) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }

  const result = await authenticateAdmin(
    parsed.data.email,
    parsed.data.password
  );

  // `authenticateAdmin` now answers with a *reason* rather than `null`, because
  // "switched off" and "expired" are not the same refusal as a wrong password
  // and a temporary admin who is told the first when it is the second will keep
  // retyping their password. The distinction is only ever reached after the
  // password has been verified, so it discloses nothing to someone guessing.
  if (!result.ok) {
    return { ok: false as const, error: result.reason };
  }

  await setAdminCookie(result.session);
  return { ok: true as const };
}

export async function logout() {
  await clearAdminCookie();
  redirect("/admin/login");
}
