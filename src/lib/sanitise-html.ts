/**
 * An allow-list HTML sanitiser, with no dependencies.
 *
 * This exists because `PortfolioItem.bodyHtml` is **markup the owner pasted**.
 * A bulk-order write-up or an achievement page is prose with headings, links
 * and photos in it, so unlike `embedHtml` — which `lib/portfolio.ts` refuses to
 * render at all, extracting a single iframe `src` instead — a body genuinely
 * has to reach the page as markup. That is the same stored-XSS surface that
 * note warns about, on a page every shopper loads, so the markup has to be
 * reduced to something provably safe first.
 *
 * ## Allow-list, never block-list
 *
 * A block-list ("strip `<script>`") loses on the first thing nobody thought
 * of: `<img src=x onerror=alert(1)>`, `<a href="javascript:…">`,
 * `<svg><animate onbegin=…>`, `<style>` with a `position:fixed` overlay,
 * `<form>` posting a shopper's typing somewhere else, `<iframe>` pointing at
 * an attacker's page. Every one of those is a *different* trick, and the list
 * of tricks only ever grows.
 *
 * So nothing is enumerated as dangerous. A tag survives only if it is in
 * `ALLOWED`, an attribute survives only if it is listed for *that* tag, and a
 * URL survives only if its scheme is in `HREF_SCHEMES`. Anything unrecognised
 * — including anything invented after this was written — is dropped by
 * default. There is no `on*` check anywhere in this file, and that is the
 * point: event handlers are not blocked, they are simply never allowed.
 *
 * ## Three decisions worth keeping
 *
 * 1. **No `<iframe>`, ever, even though the portfolio embeds video.**
 *    Embedding is already a solved, narrower problem here: `embedHtml` is
 *    parsed for one `src` and checked against `EMBED_HOSTS`. Allowing an
 *    iframe in a body would be a second, weaker door to the same room, with no
 *    host check on it. A body that wants a video gets the embed field.
 *
 * 2. **No `class`, `id` or `style` attribute.** `style` is not cosmetic: it is
 *    `position:fixed;inset:0;z-index:9999` over the checkout button, which is
 *    a working clickjack with no script involved. `class` and `id` let pasted
 *    markup reach into the store's own stylesheet and collide with real
 *    element ids. The storefront styles a body by element selector inside its
 *    own wrapper, so the owner still gets headings, lists and quotes.
 *
 * 3. **Unknown tags are unwrapped, not deleted.** Pasted markup is full of
 *    `<section>`, `<article>`, `<font>`, `<o:p>` and Google Docs wrappers. The
 *    tag goes; the words inside it stay. Deleting the subtree instead would
 *    silently eat the paragraph the owner actually wrote — the failure that
 *    makes people give up and ask for the sanitiser to be turned off.
 *    `DROP_SUBTREE` is the short list where the *contents* really are the
 *    danger (a script body, a stylesheet) and those are discarded whole.
 *
 * ## Run it on the way in AND on the way out
 *
 * `actions/portfolio.ts` sanitises before storing, so the database holds clean
 * markup and the admin can be shown exactly what was removed. `lib/portfolio.ts`
 * sanitises **again** when it builds an entry, because storing is not the only
 * way a row is written: `scripts/seed-portfolio-demo.mjs` and any future script
 * go straight through Prisma, and rows written before this file existed were
 * never checked at all. The render-time pass is what makes the storefront's
 * `dangerouslySetInnerHTML` safe no matter how the row got there. It is a
 * single linear walk over a capped string, so paying for it twice is cheap.
 */

/* ------------------------------------------------------------------ */
/*  The allow-list                                                     */
/* ------------------------------------------------------------------ */

/** Tag → the attributes that survive on it. Everything else is dropped. */
const ALLOWED: Record<string, readonly string[]> = {
  // Structure
  p: [],
  br: [],
  hr: [],
  div: [],
  span: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  blockquote: [],
  figure: [],
  figcaption: [],
  // Inline
  a: ["href", "title"],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  s: [],
  small: [],
  mark: [],
  sup: [],
  sub: [],
  code: [],
  pre: [],
  // Lists
  ul: [],
  ol: ["start"],
  li: [],
  dl: [],
  dt: [],
  dd: [],
  // Media
  img: ["src", "alt", "width", "height"],
  // Tables
  table: [],
  thead: [],
  tbody: [],
  tfoot: [],
  tr: [],
  th: ["colspan", "rowspan"],
  td: ["colspan", "rowspan"],
  caption: [],
};

/** No closing tag, and never a parent. */
const VOID = new Set(["br", "hr", "img"]);

/**
 * Elements whose **children go too**.
 *
 * Everything not in `ALLOWED` is unwrapped (tag dropped, text kept) — which is
 * right for a stray `<section>` and catastrophic for a `<script>`, whose body
 * would then be printed on the page as the owner's prose. These are the ones
 * where the contents are the payload, so the whole subtree is skipped.
 */
const DROP_SUBTREE = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "noscript",
  "template",
  "svg",
  "math",
  "canvas",
  "audio",
  "video",
  "source",
  "track",
  "form",
  "input",
  "button",
  "select",
  "option",
  "optgroup",
  "textarea",
  "label",
  "fieldset",
  "legend",
  "head",
  "title",
  "base",
  "link",
  "meta",
  "map",
  "area",
  "portal",
  "dialog",
  "slot",
  "xmp",
  "plaintext",
  "listing",
]);

/** Schemes an `href` may carry. Everything else — `javascript:`, `data:`,
 *  `vbscript:`, `file:`, an unknown app scheme — is dropped. */
const HREF_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/** An `<img src>` is loaded automatically, so it is stricter: no plaintext
 *  http (mixed content on an https store) and no `data:` payloads. */
const SRC_SCHEMES = new Set(["https:"]);

/* ------------------------------------------------------------------ */
/*  Bounds                                                             */
/* ------------------------------------------------------------------ */

/** Generous for a page of prose, small enough that a paste-bomb cannot make
 *  this loop interesting. Truncation is reported, never silent. */
const MAX_INPUT = 60_000;
const MAX_OUTPUT = 80_000;
/** Deeply nested markup is a rendering hazard on the storefront, not here. */
const MAX_DEPTH = 32;
const MAX_ATTRS = 24;

export type SanitiseResult = {
  /** Safe to render with `dangerouslySetInnerHTML`. `""` when nothing survived. */
  html: string;
  /**
   * Short, human, de-duplicated notes on what was taken out — "<script>",
   * "style attribute", "javascript: link". The admin preview prints these, so
   * a paste that loses half its formatting says why instead of looking broken.
   */
  removed: string[];
};

/* ------------------------------------------------------------------ */
/*  Entities                                                           */
/* ------------------------------------------------------------------ */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Decode an attribute value before it is inspected.
 *
 * This is not a nicety — it is the check. `href="&#106;avascript:alert(1)"` is
 * a working `javascript:` URL that a raw string compare reads as starting with
 * `&`. The scheme test only means anything once the value says what the
 * browser will see.
 */
function decodeEntities(value: string): string {
  return value.replace(
    /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,30});?/g,
    (whole, body: string) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return NAMED[body.toLowerCase()] ?? whole;
    }
  );
}

/** Escape for a text node, leaving already-valid entities alone. */
function escapeText(text: string): string {
  return text
    .replace(/&(?!(?:#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,30});)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape for a double-quoted attribute value. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ------------------------------------------------------------------ */
/*  URLs                                                               */
/* ------------------------------------------------------------------ */

/**
 * Strip what the browser ignores but a naive scheme check does not.
 *
 * `java\tscript:`, a leading newline and a `\0` in the middle are all still a
 * `javascript:` URL by the time the browser parses it. Control characters go
 * before the colon is looked for, never after.
 */
function normaliseUrl(raw: string): string {
  // The control characters in this class are the point, not an oversight:
  // stripping them is what makes the scheme check below mean anything.
  return decodeEntities(raw).replace(/[\u0000- \u007f-\u009f]/g, "").trim();
}

/**
 * `null` when the address must not be emitted.
 *
 * Same shape as `isSafeHref` in `lib/portfolio.ts`, and the same explicit
 * refusal of `//host` — it *looks* relative and is not, so it silently leaves
 * the site. A bare `#anchor` and a site-relative `/path` are both fine.
 *
 * `rooted` is for `<img src>`: a document-relative `src="a.png"` resolves
 * against whatever URL the body happens to be rendered at, so the same stored
 * body shows a different image on `/portfolio` than on `/portfolio/<id>`. An
 * address has to say where it points, so it must start with `/` or be
 * absolute — which is also the rule `isOptimisableImage` already applies.
 */
function safeUrl(
  raw: string,
  schemes: Set<string>,
  { rooted = false }: { rooted?: boolean } = {}
): string | null {
  const value = normaliseUrl(raw);
  if (!value) return null;
  if (value.startsWith("//")) return null;
  if (value.startsWith("/")) return value;
  if (value.startsWith("#")) return rooted ? null : value;
  // No colon before the first `/`, `?` or `#` means it is a relative path.
  const colon = value.indexOf(":");
  const slash = value.search(/[/?#]/);
  if (colon === -1 || (slash !== -1 && slash < colon)) return rooted ? null : value;
  const scheme = value.slice(0, colon + 1).toLowerCase();
  return schemes.has(scheme) ? value : null;
}

/** Absolute links leave the store, so they get `target` and `rel`. */
function isAbsolute(url: string): boolean {
  return /^(?:https?|mailto|tel):/i.test(url);
}

/* ------------------------------------------------------------------ */
/*  The walk                                                           */
/* ------------------------------------------------------------------ */

type Attr = { name: string; value: string };

/**
 * Read a tag's attributes starting just after its name.
 *
 * Hand-rolled rather than a regex because attribute syntax is genuinely
 * irregular — bare values, single quotes, no value at all, a `/` before the
 * `>` — and a regex that half-handles it is exactly how a sanitiser grows a
 * hole. Returns where the tag ended so the caller can carry on.
 */
function readAttrs(
  html: string,
  from: number
): { attrs: Attr[]; end: number; selfClosing: boolean } {
  const attrs: Attr[] = [];
  let i = from;
  let selfClosing = false;

  while (i < html.length) {
    while (i < html.length && /\s/.test(html[i])) i++;
    if (i >= html.length) break;

    if (html[i] === ">") {
      i++;
      break;
    }
    if (html[i] === "/" && html[i + 1] === ">") {
      selfClosing = true;
      i += 2;
      break;
    }
    if (html[i] === "/") {
      i++;
      continue;
    }

    const nameStart = i;
    while (i < html.length && !/[\s/>=]/.test(html[i])) i++;
    const name = html.slice(nameStart, i).toLowerCase();
    if (!name) {
      i++;
      continue;
    }

    while (i < html.length && /\s/.test(html[i])) i++;
    let value = "";
    if (html[i] === "=") {
      i++;
      while (i < html.length && /\s/.test(html[i])) i++;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        i++;
        const valueStart = i;
        while (i < html.length && html[i] !== quote) i++;
        value = html.slice(valueStart, i);
        i++; // closing quote
      } else {
        const valueStart = i;
        while (i < html.length && !/[\s>]/.test(html[i])) i++;
        value = html.slice(valueStart, i);
      }
    }

    if (attrs.length < MAX_ATTRS) attrs.push({ name, value });
  }

  return { attrs, end: i, selfClosing };
}

/** Skip a `DROP_SUBTREE` element's contents and its closing tag. */
function skipSubtree(html: string, from: number, tag: string): number {
  const close = new RegExp(`</\\s*${tag}\\b[^>]*>`, "i");
  const rest = html.slice(from);
  const hit = close.exec(rest);
  // Unclosed `<script>` swallows the rest, which is what a browser does too —
  // and refusing to guess where it ends is the safe direction here.
  return hit ? from + hit.index + hit[0].length : html.length;
}

export type SanitiseOptions = {
  /** Override the tag allow-list. Defaults to `ALLOWED`. */
  allowed?: Record<string, readonly string[]>;
  /** Cap the input. Anything past it is cut and reported. */
  maxInput?: number;
};

/**
 * Reduce arbitrary markup to the allow-list above.
 *
 * Never throws and never returns anything it did not build itself — the output
 * is assembled tag by tag from values that passed a check, rather than being
 * the input with bad parts spliced out. That difference is why a parser
 * disagreement ("is `<img/src=x>` one tag or two?") cannot produce a hole:
 * whatever this reads, it writes back in one canonical spelling.
 */
export function sanitiseHtml(
  input: string | null | undefined,
  options: SanitiseOptions = {}
): SanitiseResult {
  const allowed = options.allowed ?? ALLOWED;
  const maxInput = options.maxInput ?? MAX_INPUT;

  const removedSet = new Set<string>();
  const note = (what: string) => removedSet.add(what);

  let html = (input ?? "").toString();
  if (!html.trim()) return { html: "", removed: [] };
  if (html.length > maxInput) {
    html = html.slice(0, maxInput);
    note("text past the length limit");
  }

  const out: string[] = [];
  /** Open elements, innermost last — used to close them and to cap depth. */
  const open: string[] = [];
  let i = 0;

  const push = (chunk: string) => {
    if (out.length < 200_000) out.push(chunk);
  };

  while (i < html.length) {
    const lt = html.indexOf("<", i);

    if (lt === -1) {
      push(escapeText(html.slice(i)));
      break;
    }
    if (lt > i) push(escapeText(html.slice(i, lt)));

    // ---- comments, doctype, processing instructions ----
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? html.length : end + 3;
      note("comment");
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    // ---- closing tag ----
    if (html[lt + 1] === "/") {
      // No `\s*`: HTML starts a tag only when an ASCII letter follows `<` or
      // `</` immediately. Allowing whitespace here is how `width < height`
      // gets read as an element called `height` and eats the rest of the
      // sentence — silently, because nothing errors.
      const m = /^<\/([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt));
      if (!m) {
        push("&lt;");
        i = lt + 1;
        continue;
      }
      const end = html.indexOf(">", lt);
      i = end === -1 ? html.length : end + 1;
      const tag = m[1].toLowerCase();
      // Close it only if it is actually open, innermost first. A stray `</p>`
      // with nothing to close is dropped rather than emitted, which is what
      // stops pasted markup from tearing open the page's own layout.
      const at = open.lastIndexOf(tag);
      if (at !== -1) {
        for (let k = open.length - 1; k >= at; k--) push(`</${open[k]}>`);
        open.length = at;
      }
      continue;
    }

    // ---- opening tag ----
    const m = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt));
    if (!m) {
      // A bare `<` in prose ("width < height"). Emit it as text.
      push("&lt;");
      i = lt + 1;
      continue;
    }

    const tag = m[1].toLowerCase();
    const { attrs, end, selfClosing } = readAttrs(html, lt + m[0].length);

    if (DROP_SUBTREE.has(tag)) {
      note(`<${tag}>`);
      i = VOID.has(tag) || selfClosing ? end : skipSubtree(html, end, tag);
      continue;
    }

    const allowedAttrs = allowed[tag];
    if (!allowedAttrs) {
      // Unwrap: the tag goes, the words inside it stay. See note 3 above.
      note(`<${tag}>`);
      i = end;
      continue;
    }

    if (!VOID.has(tag) && open.length >= MAX_DEPTH) {
      note("markup nested too deeply");
      i = end;
      continue;
    }

    // ---- attributes ----
    const kept: string[] = [];
    let href: string | null = null;

    for (const attr of attrs) {
      if (!allowedAttrs.includes(attr.name)) {
        // Named individually because these are the ones worth explaining.
        note(
          attr.name === "style"
            ? "style attribute"
            : attr.name === "class" || attr.name === "id"
              ? `${attr.name} attribute`
              : attr.name.startsWith("on")
                ? "event handler"
                : `${attr.name} attribute`
        );
        continue;
      }

      if (attr.name === "href" || attr.name === "src") {
        const url = safeUrl(
          attr.value,
          attr.name === "src" ? SRC_SCHEMES : HREF_SCHEMES,
          { rooted: attr.name === "src" }
        );
        if (!url) {
          const scheme = /^\s*([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(
            normaliseUrl(attr.value)
          )?.[1];
          note(scheme ? `${scheme.toLowerCase()}: link` : `unsafe ${attr.name}`);
          continue;
        }
        if (attr.name === "href") href = url;
        kept.push(`${attr.name}="${escapeAttr(url)}"`);
        continue;
      }

      if (
        attr.name === "width" ||
        attr.name === "height" ||
        attr.name === "colspan" ||
        attr.name === "rowspan" ||
        attr.name === "start"
      ) {
        // Digits only: a `width` is a number, and anything else in it is
        // somebody trying to end the attribute early.
        const digits = /^\d{1,5}$/.exec(decodeEntities(attr.value).trim())?.[0];
        if (digits) kept.push(`${attr.name}="${digits}"`);
        continue;
      }

      kept.push(`${attr.name}="${escapeAttr(decodeEntities(attr.value))}"`);
    }

    // ---- forced safety attributes ----
    if (tag === "a") {
      if (!href) {
        // A link with nowhere to go is a link that looks clickable and is not.
        note("link with no address");
        i = end;
        continue;
      }
      if (isAbsolute(href)) {
        kept.push(`target="_blank"`, `rel="noopener noreferrer"`);
      }
    }
    if (tag === "img") {
      if (!kept.some((a) => a.startsWith("src="))) {
        note("image with no address");
        i = end;
        continue;
      }
      if (!kept.some((a) => a.startsWith("alt="))) kept.push(`alt=""`);
      kept.push(`loading="lazy"`, `decoding="async"`);
    }

    push(`<${tag}${kept.length ? " " + kept.join(" ") : ""}>`);
    if (!VOID.has(tag) && !selfClosing) open.push(tag);
    i = end;
  }

  // Anything the owner left open, closed innermost-first. Without this a
  // forgotten `</div>` swallows the rest of the page into the body.
  for (let k = open.length - 1; k >= 0; k--) out.push(`</${open[k]}>`);

  let result = out.join("");
  if (result.length > MAX_OUTPUT) {
    result = result.slice(0, MAX_OUTPUT);
    note("text past the length limit");
  }
  // All-whitespace markup (`<p> </p><br>`) is not content; treat it as empty
  // so "has a body" is a question with one answer everywhere.
  if (!result.replace(/<[^>]*>/g, "").trim() && !/<img\b/i.test(result)) {
    return { html: "", removed: [...removedSet] };
  }

  return { html: result, removed: [...removedSet] };
}

/* ------------------------------------------------------------------ */
/*  Portfolio profile                                                  */
/* ------------------------------------------------------------------ */

/**
 * The one entry point the portfolio uses, on the way in and on the way out.
 *
 * A named wrapper rather than callers passing options: if the body profile
 * ever needs to differ from the default allow-list, it changes here and every
 * caller — the writer, the reader and the admin preview — moves together. Two
 * readers of one rule is the lost-update shape CLAUDE.md keeps recording.
 */
export function sanitisePortfolioBody(
  input: string | null | undefined
): SanitiseResult {
  return sanitiseHtml(input);
}

/**
 * Markup → one line of plain text.
 *
 * For a meta description, a card excerpt or a list preview, where markup would
 * have to be escaped anyway. Runs the sanitiser first so a `<script>` body is
 * gone rather than becoming the excerpt.
 */
export function htmlToText(input: string | null | undefined, limit = 200): string {
  const { html } = sanitisePortfolioBody(input);
  if (!html) return "";
  const text = decodeEntities(
    html.replace(/<(?:br|\/p|\/h[1-6]|\/li|\/div)[^>]*>/gi, " ").replace(/<[^>]*>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}
