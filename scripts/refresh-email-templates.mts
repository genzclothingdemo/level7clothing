/**
 * Move the store's improved email copy into the live database — without
 * touching a word the owner has written.
 *
 *     npx tsx scripts/refresh-email-templates.mts           # dry run: prints the plan, writes nothing
 *     npx tsx scripts/refresh-email-templates.mts --apply   # does it
 *
 * **Why this exists.** `syncSystemAutomation` is additive by design: it creates
 * a missing template and never rewrites one that is there, because the stored
 * copy is the owner's to edit. That is right, and it also means improved
 * wording in `src/lib/email-templates.ts` never reaches a store that already
 * has the old wording. This script is the one careful way across.
 *
 * ## What it decides, per template the store ships
 *
 * | stored copy is…                                   | action                |
 * |---------------------------------------------------|-----------------------|
 * | the same as the current shipped copy              | nothing — up to date  |
 * | the same as a copy this store shipped **before**  | **updated**           |
 * | anything else                                     | **reported, left alone** — somebody edited it |
 * | not stored at all                                 | **created**, like the sync would |
 *
 * "Shipped before" means any version of `SYSTEM_TEMPLATES` in this repository's
 * git history — in `src/lib/email-templates.ts`, or in `src/lib/automation.ts`
 * where the list lived until 2026-09-28. Only line endings are ignored when
 * comparing (a browser textarea saves `\r\n`); one changed character anywhere
 * in the subject or body and the template counts as edited.
 *
 * Templates in the database that the store does not ship — ones the owner made
 * in the admin — are listed and never touched. A template's `name` is updated
 * only while it is still a shipped name, so a template the owner renamed keeps
 * the owner's name even when its words are refreshed.
 *
 * ## How it writes
 *
 * - Every stored template is saved to `scripts/tmp/` before anything is
 *   written (gitignored, like every other snapshot here).
 * - Each update is a compare-and-set on the subject and body it read, so an
 *   edit made in the admin while this runs is not overwritten — it is
 *   reported instead.
 * - Nothing else is touched: no rule, no `isActive`, no other table.
 *
 * Safe to run again. A second run reports everything as up to date.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { SYSTEM_TEMPLATES, type SystemTemplate } from "../src/lib/email-templates";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

/* ------------------------------------------------------------------ */
/*  Every version the store has shipped                                */
/* ------------------------------------------------------------------ */

const norm = (s: string) => s.replace(/\r\n?/g, "\n");
const same = (a: { subject: string; body: string }, b: { subject: string; body: string }) =>
  norm(a.subject) === norm(b.subject) && norm(a.body) === norm(b.body);

/**
 * Pull the `SYSTEM_TEMPLATES` literal out of one version of a source file.
 *
 * The list is plain object literals with backtick bodies and no `${…}` in
 * them, so it can be evaluated on its own; a version that ever interpolated
 * something would fail here and is skipped with a warning rather than guessed.
 * It only ever evaluates this repository's own history.
 */
function extract(source: string, label: string): SystemTemplate[] {
  const start = source.indexOf("export const SYSTEM_TEMPLATES");
  if (start < 0) return [];
  const open = source.indexOf("[", source.indexOf("=", start));
  const close = source.indexOf("\n];", open);
  if (open < 0 || close < 0) return [];
  try {
    const list = new Function(`return ${source.slice(open, close + 2)}`)() as SystemTemplate[];
    return Array.isArray(list) ? list.filter((t) => t && typeof t.key === "string") : [];
  } catch (err) {
    console.warn(`  (skipped ${label}: ${err instanceof Error ? err.message : String(err)})`);
    return [];
  }
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

const SOURCES = ["src/lib/email-templates.ts", "src/lib/automation.ts"];
type Version = SystemTemplate & { from: string };
const history: Version[] = [];
const commits = (git(["log", "--format=%H %cs", "--", ...SOURCES]) ?? "").trim().split("\n").filter(Boolean);
for (const line of commits) {
  const [sha, date] = line.split(" ");
  for (const file of SOURCES) {
    const source = git(["show", `${sha}:${file}`]);
    if (!source) continue;
    for (const t of extract(source, `${sha.slice(0, 7)}:${file}`)) {
      history.push({ ...t, from: `${sha.slice(0, 7)} (${date})` });
    }
  }
}
if (!commits.length) {
  console.warn("No git history found — only the current copy counts as shipped, so every other stored copy is treated as edited.");
}

const current = new Map(SYSTEM_TEMPLATES.map((t) => [t.key, t]));
const shippedNames = new Map<string, Set<string>>();
for (const t of [...history, ...SYSTEM_TEMPLATES]) {
  if (!shippedNames.has(t.key)) shippedNames.set(t.key, new Set());
  shippedNames.get(t.key)!.add(t.name);
}

/* ------------------------------------------------------------------ */
/*  The plan                                                           */
/* ------------------------------------------------------------------ */

const prisma = new PrismaClient();
const stored = await prisma.emailTemplate.findMany({ orderBy: { key: "asc" } });

type Plan =
  | { kind: "current"; key: string }
  | { kind: "update"; key: string; id: string; was: { subject: string; body: string }; matched: string; name?: string }
  | { kind: "edited"; key: string; differs: string; updatedAt: Date }
  | { kind: "create"; key: string }
  | { kind: "custom"; key: string };

const plan: Plan[] = [];
for (const row of stored) {
  const target = current.get(row.key);
  if (!target) {
    plan.push({ kind: "custom", key: row.key });
    continue;
  }
  if (same(row, target)) {
    plan.push({ kind: "current", key: row.key });
    continue;
  }
  const match = history.find((v) => v.key === row.key && same(row, v));
  if (match) {
    const renameOk = shippedNames.get(row.key)?.has(row.name) && row.name !== target.name;
    plan.push({
      kind: "update",
      key: row.key,
      id: row.id,
      was: { subject: row.subject, body: row.body },
      matched: match.from,
      name: renameOk ? target.name : undefined,
    });
    continue;
  }
  // Nearest shipped version, to say *what* was changed.
  const latest = [...history].reverse().find((v) => v.key === row.key) ?? target;
  const differs = [
    norm(row.subject) !== norm(latest.subject) ? "subject" : "",
    norm(row.body) !== norm(latest.body) ? "body" : "",
  ]
    .filter(Boolean)
    .join(" and ");
  plan.push({ kind: "edited", key: row.key, differs: differs || "wording", updatedAt: row.updatedAt });
}
for (const t of SYSTEM_TEMPLATES) {
  if (!stored.some((r) => r.key === t.key)) plan.push({ kind: "create", key: t.key });
}

/* ------------------------------------------------------------------ */
/*  Report                                                             */
/* ------------------------------------------------------------------ */

const count = (k: Plan["kind"]) => plan.filter((p) => p.kind === k).length;
console.log(
  `${APPLY ? "APPLY" : "DRY RUN"} — ${stored.length} templates stored, ${SYSTEM_TEMPLATES.length} shipped, ${new Set(history.map((h) => h.from)).size} shipped versions found in git history.\n`
);
for (const p of plan) {
  if (p.kind === "update") {
    const t = current.get(p.key)!;
    const subjectChange = norm(p.was.subject) !== norm(t.subject) ? `\n      subject: "${p.was.subject}"\n            → "${t.subject}"` : "\n      subject: unchanged";
    const lines = (s: string) => norm(s).split("\n").length;
    console.log(
      `  update   ${p.key.padEnd(24)} stored copy = shipped ${p.matched}${p.name ? `; name → "${p.name}"` : ""}${subjectChange}\n      body: ${lines(p.was.body)} lines → ${lines(t.body)} lines`
    );
  } else if (p.kind === "create") {
    console.log(`  create   ${p.key.padEnd(24)} "${current.get(p.key)!.subject}"`);
  } else if (p.kind === "edited") {
    console.log(`  EDITED   ${p.key.padEnd(24)} ${p.differs} differ from every shipped version (last saved ${p.updatedAt.toISOString()}) — left alone`);
  } else if (p.kind === "custom") {
    console.log(`  custom   ${p.key.padEnd(24)} made in the admin, not shipped — left alone`);
  } else {
    console.log(`  current  ${p.key}`);
  }
}
console.log(
  `\n${count("update")} to update · ${count("create")} to create · ${count("current")} already current · ${count("edited")} edited by the owner (left alone) · ${count("custom")} owner-made (left alone)`
);

if (!APPLY) {
  console.log("\nNothing written. Run again with --apply to do this.");
  await prisma.$disconnect();
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/*  Apply                                                              */
/* ------------------------------------------------------------------ */

const backupDir = path.join(ROOT, "scripts", "tmp");
mkdirSync(backupDir, { recursive: true });
const backup = path.join(backupDir, `email-templates-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(backup, JSON.stringify(stored, null, 2));
console.log(`\nBacked up ${stored.length} stored templates → ${path.relative(ROOT, backup)}`);

let updated = 0;
let created = 0;
const raced: string[] = [];
for (const p of plan) {
  if (p.kind === "update") {
    const t = current.get(p.key)!;
    // Compare-and-set: only if the row still holds exactly what was read.
    const res = await prisma.emailTemplate.updateMany({
      where: { id: p.id, subject: p.was.subject, body: p.was.body },
      data: { subject: t.subject, body: t.body, ...(p.name ? { name: p.name } : {}) },
    });
    if (res.count === 1) updated += 1;
    else raced.push(p.key);
  } else if (p.kind === "create") {
    const t = current.get(p.key)!;
    try {
      await prisma.emailTemplate.create({ data: { key: t.key, name: t.name, subject: t.subject, body: t.body, isSystem: true } });
      created += 1;
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") raced.push(`${p.key} (created meanwhile)`);
      else throw err;
    }
  }
}

// Read back and prove it.
const after = await prisma.emailTemplate.findMany({ where: { key: { in: SYSTEM_TEMPLATES.map((t) => t.key) } } });
const wrong = plan
  .filter((p) => p.kind === "update" || p.kind === "create")
  .filter((p) => !raced.some((r) => r.startsWith(p.key)))
  .filter((p) => {
    const row = after.find((r) => r.key === p.key);
    return !row || !same(row, current.get(p.key)!);
  })
  .map((p) => p.key);

console.log(`Updated ${updated}, created ${created}.`);
if (raced.length) console.log(`Changed while this ran, so left alone: ${raced.join(", ")}`);
if (wrong.length) {
  console.error(`Read-back mismatch for: ${wrong.join(", ")}`);
  await prisma.$disconnect();
  process.exit(1);
}
console.log("Read back: every refreshed template now matches the shipped copy.");
await prisma.$disconnect();
