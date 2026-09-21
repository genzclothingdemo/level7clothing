/**
 * Session cookie names, in a module with no server-only imports so the edge
 * proxy (src/proxy.ts) and the Node auth helpers can share one definition.
 *
 * These were previously re-declared in each consumer, which let src/proxy.ts
 * and src/lib/auth.ts drift onto different names — the login route set one
 * cookie and the admin gate looked for another, so every admin login bounced
 * straight back to the login page. Import from here; never re-declare.
 */
export const ADMIN_COOKIE = "level7_admin";
export const USER_COOKIE = "level7_user";

/**
 * Guest contact captured by the add-to-cart mini sign-up (name + phone).
 *
 * Same hazard as the two above: it was declared separately in
 * `src/app/actions/account.ts` and `src/context/cart.tsx`, so a rename in one
 * would silently strand the other — logout would stop clearing the guest's
 * details, or the cart would stop seeing them. The signed-in account is the
 * source of truth for identity; this cookie only stands in for a guest, and
 * login overwrites it from the account.
 */
export const LEAD_COOKIE = "level7_lead";
