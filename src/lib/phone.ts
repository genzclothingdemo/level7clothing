/**
 * Indian mobile numbers, one canonical form.
 *
 * This exists because the phone number became the **identity** on 2026-09-26,
 * and an identity that four screens spell four different ways is not an
 * identity. The live database already held all four:
 *
 *   "+91 90000 11111"   "09313112610"   "9104499432"   null
 *
 * Every one of those is the same kind of thing typed by a different person, and
 * a `findUnique({ where: { phone } })` against any of them misses the other
 * three. So: **store E.164 (`+919104499432`), display it grouped, and compare
 * only the canonical form.**
 *
 * Deliberately not a general-purpose phone library. This store ships inside
 * India, NimbusPost only quotes Indian pincodes, and a 30 kB dependency to
 * parse numbers we will never see is not a trade worth making. If that changes,
 * `libphonenumber-js` is the swap and this module is the seam.
 */

/** India. The only country this store currently sells into. */
const CC = "91";

/**
 * A valid Indian mobile subscriber number: ten digits starting 6–9.
 * Landlines and service numbers are deliberately rejected — this field is used
 * for delivery contact and (later) OTP, and neither works on a landline.
 */
const NSN = /^[6-9]\d{9}$/;

/**
 * Strip a number to its ten national digits, or `null` if it cannot be one.
 *
 * Handles every shape seen in the wild here: spaces and dashes, a leading `0`
 * (the domestic trunk prefix), `+91`, `0091`, and a bare `91` prefix on a
 * 12-digit string.
 */
function nationalDigits(raw: string): string | null {
  let d = raw.replace(/[^\d]/g, "");

  if (d.startsWith("00" + CC)) d = d.slice(2 + CC.length);
  else if (d.startsWith(CC) && d.length === 10 + CC.length) d = d.slice(CC.length);
  else if (d.startsWith("0") && d.length === 11) d = d.slice(1);

  return NSN.test(d) ? d : null;
}

/**
 * Canonical storage form: `+919104499432`.
 *
 * **Every write of a phone number goes through this**, and every lookup
 * compares against its output. Returns `null` for anything that is not a valid
 * Indian mobile, so a caller cannot accidentally store "1234" as somebody's
 * identity.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = nationalDigits(String(raw));
  return d ? `+${CC}${d}` : null;
}

/** True when this is a storable Indian mobile. */
export function isValidPhone(raw: string | null | undefined): boolean {
  return normalisePhone(raw) !== null;
}

/** `+91 91044 99432` — grouped for reading, never for storing or comparing. */
export function formatPhone(raw: string | null | undefined): string {
  const e164 = normalisePhone(raw);
  if (!e164) return raw ? String(raw) : "";
  const d = e164.slice(1 + CC.length);
  return `+${CC} ${d.slice(0, 5)} ${d.slice(5)}`;
}

/**
 * `••••• •9432` — enough to recognise your own number, not enough to dial
 * somebody else's.
 *
 * Used in one specific place: telling a signup that the email they typed is
 * already attached to another account. That message has to be useful to the
 * person who owns both accounts and useless to someone probing for whose
 * address it is, so it shows the **last four digits only**.
 */
export function maskPhone(raw: string | null | undefined): string {
  const e164 = normalisePhone(raw);
  if (!e164) return "•••••";
  return `••••• •${e164.slice(-4)}`;
}

/**
 * What the signup field should start with. The `+91` is fixed rather than
 * editable: offering a country picker this store cannot ship to is a promise
 * it will not keep.
 */
export const PHONE_PREFIX = `+${CC}`;

/** For `<input inputMode="numeric" maxLength={10}>` — the national part only. */
export const PHONE_NATIONAL_LENGTH = 10;
