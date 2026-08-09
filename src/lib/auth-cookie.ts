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
