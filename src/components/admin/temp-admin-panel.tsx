"use client";

/**
 * temp-admin-panel — Settings → Access.
 *
 * ## Why the activity log is its own card
 *
 * The log was built and worked from the start — `requireAdminWrite` writes a
 * line for every sign-in, saved change and refused write — and the owner still
 * asked whether it existed. It lived inside each person's collapsed row, so a
 * screen that *had* a log did not look like it had one. So the tab now answers
 * the three questions in the order they are asked, with nothing to expand:
 *
 *   1. **Who has a way in** — each person on one row: name, mode, state, when
 *      they last signed in, and how many activity lines they have. The count is
 *      a link to the log, so every row says the log exists and where it is.
 *   2. **What they did** — the Activity log, across everyone, newest first,
 *      with a person filter once more than one person has lines. One line under
 *      its title says what is recorded and that deleting a person deletes it.
 *   3. **Behind an `(i)`** — what exactly is and is not recorded, what the two
 *      modes mean, and why this is oversight rather than an audit record.
 *
 * Managing someone (dates, note, switch off, delete) is one tap in, behind
 * **Manage** on their row. Adding is rarer still, and is a button.
 *
 * ## One home for a log line
 *
 * A line is printed in exactly one place — the log card. Each person's row used
 * to carry its own copy of their lines as well; with a feed on the same tab
 * that would be the same fact twice, which the owner reads as duplication. The
 * row keeps the count and a jump to their lines instead.
 *
 * ## How the feed stays honest with the rows it was given
 *
 * `listTempAdmins()` hands over each person's newest lines (a bounded window,
 * not their whole trail) plus their true `logCount`. Merging those buckets is
 * exact only down to the oldest loaded line of anyone whose bucket was cut
 * short — below that, a busy person's older lines are missing and the merged
 * list would silently skip them. `buildFeed()` stops at that point and the card
 * says how many of how many it is showing, rather than implying completeness.
 *
 * ## Two things this screen has to be honest about
 *
 * **The controls here are a courtesy, not the permission.** View-only is
 * enforced in `requireAdminWrite` on the server. A view-only viewer is not
 * offered Add, Switch off or Delete at all — controls that cannot apply are
 * absent rather than greyed — and the server would refuse and record them if
 * they were called anyway.
 *
 * **Deleting a person deletes their trail.** `AdminActivityLog` cascades from
 * `TempAdmin`, deliberately. It is printed under the log's title and repeated,
 * with the exact count, in the delete confirmation. An audit record you can
 * erase by deleting its subject is not one, and the screen says so.
 */

import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  CalendarClock,
  ChevronDown,
  Eye,
  History,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { Badge, Btn, type BadgeTone } from "@/components/admin/order-ui";
import { Card, Field, Segmented } from "@/components/admin/form-kit";
import {
  createTempAdmin,
  deleteTempAdmin,
  setTempAdminActive,
} from "@/app/actions/temp-admin";
import { cn } from "@/lib/utils";
// Types only — `lib/temp-admin.ts` is `server-only`, and a type import is
// erased at build time so it never becomes a runtime edge into it.
import type {
  AdminMode,
  TempAdminLogRow,
  TempAdminRow,
  TempAdminState,
} from "@/lib/temp-admin";

/* ------------------------------------------------------------------ */
/*  Labels — the one copy                                              */
/* ------------------------------------------------------------------ */

const MODE_LABEL: Record<AdminMode, string> = {
  readonly: "View only",
  full: "Full access",
};

/** The one-line version, printed under the picker. */
const MODE_SHORT: Record<AdminMode, string> = {
  readonly: "Opens every screen, changes nothing.",
  full: "Everything you can do, including managing admins.",
};

/** The long version, behind the picker's (i). */
const MODE_BLURB: Record<AdminMode, string> = {
  readonly:
    "Opens every screen in the admin and reads everything on it. Every button that would change something is refused by the server — not merely hidden — so it holds even for someone who knows how the site is built.",
  full: "Everything you can do, including adding and removing other temporary admins. Give this only to someone you would hand your own password to.",
};

/**
 * The order the two modes are offered in: the safer one first, and it is the
 * one the form starts on. A permission picker whose default is the powerful
 * option is a permission picker that grants the powerful option.
 */
const MODE_OPTIONS: { value: AdminMode; label: string }[] = [
  { value: "readonly", label: MODE_LABEL.readonly },
  { value: "full", label: MODE_LABEL.full },
];

const STATE_META: Record<TempAdminState, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  disabled: { label: "Switched off", tone: "neutral" },
  expired: { label: "Expired", tone: "warn" },
};

/**
 * The five verbs `lib/temp-admin.ts` writes, as the words the owner reads.
 * The chip used to print the raw verb ("login", "create"); a log read by a
 * shop owner should say "Signed in".
 */
const LOG_VERB: Record<string, { label: string; tone: BadgeTone }> = {
  login: { label: "Signed in", tone: "info" },
  create: { label: "Created", tone: "accent" },
  update: { label: "Changed", tone: "neutral" },
  delete: { label: "Deleted", tone: "danger" },
  blocked: { label: "Refused", tone: "warn" },
};

function verbOf(action: string) {
  return LOG_VERB[action] ?? { label: action, tone: "neutral" as BadgeTone };
}

const lines = (n: number) => `${n} activity line${n === 1 ? "" : "s"}`;

/* ------------------------------------------------------------------ */
/*  Dates                                                              */
/* ------------------------------------------------------------------ */

/**
 * One formatter, pinned to IST and to `en-IN`.
 *
 * `toLocaleString()` with no arguments reads the *runtime's* timezone, which is
 * UTC on the server and the owner's own in the browser — a guaranteed
 * hydration mismatch on a screen that prints a timestamp on every row. Pinning
 * both makes the server render and the client render the same string, and makes
 * it the store's own clock rather than a Vercel region's.
 */
const STAMP = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const DAY = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function stamp(iso: string | null): string {
  return iso ? STAMP.format(new Date(iso)) : "—";
}

function day(iso: string | null): string {
  return iso ? DAY.format(new Date(iso)) : "—";
}

/* ------------------------------------------------------------------ */
/*  The feed                                                           */
/* ------------------------------------------------------------------ */

type FeedLine = TempAdminLogRow & { who: string };

/**
 * Everyone's loaded lines, newest first — cut where the merge stops being
 * complete.
 *
 * Each person's `recent` is their newest N lines. Merging buckets is exact for
 * every line at or after the **cutoff**: the latest "oldest loaded line" among
 * people whose bucket was truncated (`logCount > recent.length`). Above it, no
 * one's lines are missing; below it, a truncated person's older lines are, and
 * showing the merged remainder would present a gap as if it were the history.
 *
 * A truncated person with *no* loaded lines is ignored: their lines are all
 * older than the whole window the server read, and that window is only ever
 * full when someone else was truncated with lines loaded — whose cutoff is
 * later still.
 */
function buildFeed(admins: TempAdminRow[]): { shown: FeedLine[]; total: number } {
  const all: FeedLine[] = [];
  let cutoff = Number.NEGATIVE_INFINITY;
  let total = 0;

  for (const a of admins) {
    total += a.logCount;
    for (const l of a.recent) all.push({ ...l, who: a.name });
    if (a.logCount > a.recent.length && a.recent.length > 0) {
      const oldest = Math.min(...a.recent.map((l) => Date.parse(l.at)));
      cutoff = Math.max(cutoff, oldest);
    }
  }

  all.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  return { shown: all.filter((l) => Date.parse(l.at) >= cutoff), total };
}

/** How many lines the card shows before "View all". */
const PREVIEW = 6;

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

export function TempAdminPanel({
  admins,
  viewerMode,
  viewerTempAdminId,
  todayISO,
}: {
  admins: TempAdminRow[];
  /** The signed-in viewer's own mode. View-only sees this tab and changes nothing. */
  viewerMode: AdminMode;
  /** Set when the viewer is themselves a temporary admin — they cannot act on their own row. */
  viewerTempAdminId: string | null;
  /** Stamped on the server, so the date input's floor cannot hydrate-drift. */
  todayISO: string;
}) {
  const canWrite = viewerMode === "full";
  const [adding, setAdding] = useState(false);
  const [focus, setFocus] = useState<string>("all");
  const logRef = useRef<HTMLDivElement>(null);

  const live = admins.filter((a) => a.state === "active").length;

  /** A person's count on their row is a jump to their lines in the log. */
  function showActivity(id: string) {
    setFocus(id);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    logRef.current?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  }

  return (
    <div className="space-y-4">
      {/* ---- 1. Who has a way in ---- */}
      <Card
        title="People with access"
        tip="Everyone besides you who can sign in at /admin/login. Your own login is not listed here and cannot be changed from this screen."
        aside={
          <span className="text-[11px] text-muted-foreground">
            {admins.length === 0
              ? "Only you"
              : `${live} active of ${admins.length}`}
          </span>
        }
      >
        {admins.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nobody else can sign in.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {admins.map((a) => (
              <PersonRow
                key={a.id}
                admin={a}
                canWrite={canWrite}
                isSelf={viewerTempAdminId === a.id}
                onShowActivity={() => showActivity(a.id)}
              />
            ))}
          </ul>
        )}

        {/* Absent, not disabled, for a view-only viewer. */}
        {canWrite && !adding && (
          <div>
            <Btn tone="solid" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add someone
            </Btn>
          </div>
        )}
      </Card>

      {canWrite && adding && (
        <CreateForm todayISO={todayISO} onDone={() => setAdding(false)} />
      )}

      {/* ---- 2. What they did ---- */}
      <div ref={logRef} className="scroll-mt-20">
        <ActivityLog admins={admins} focus={focus} onFocus={setFocus} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One person                                                         */
/* ------------------------------------------------------------------ */

function PersonRow({
  admin,
  canWrite,
  isSelf,
  onShowActivity,
}: {
  admin: TempAdminRow;
  canWrite: boolean;
  isSelf: boolean;
  onShowActivity: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const panelId = useId();
  const state = STATE_META[admin.state];

  // Acting on your own row is refused by the server too; offering nothing is
  // how the refusal stops being the way you find out.
  const canManage = canWrite && !isSelf;

  function toggle() {
    start(async () => {
      const res = await setTempAdminActive(admin.id, !admin.isActive);
      if (res.ok) toast.success(res.message);
      else toast.error(res.error, { duration: 8000 });
    });
  }

  function remove() {
    setConfirming(false);
    start(async () => {
      const res = await deleteTempAdmin(admin.id);
      if (res.ok) toast.success(res.message);
      else toast.error(res.error, { duration: 8000 });
    });
  }

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-muted-foreground"
        >
          {admin.mode === "full" ? (
            <ShieldCheck className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{admin.name}</span>
            <Badge tone={admin.mode === "full" ? "accent" : "neutral"}>
              {MODE_LABEL[admin.mode]}
            </Badge>
            <Badge tone={state.tone}>{state.label}</Badge>
            {isSelf && <Badge tone="info">You</Badge>}
          </div>

          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            <span className="break-all">{admin.email}</span>
            <span aria-hidden="true"> · </span>
            {admin.lastLoginAt
              ? `Last signed in ${stamp(admin.lastLoginAt)}`
              : "Never signed in"}
          </p>

          {admin.logCount > 0 ? (
            <button
              type="button"
              onClick={onShowActivity}
              className={cn(
                "-ml-1 mt-0.5 inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md px-1 text-[11px] font-medium text-accent transition-colors hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              {lines(admin.logCount)}
              <ArrowDown className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">
              No activity yet
            </p>
          )}
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:min-h-9",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          )}
        >
          {canManage ? "Manage" : "Details"}
          <span className="sr-only"> {admin.name}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "h-4 w-4 transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-180"
            )}
          />
        </button>
      </div>

      {/* Mounted only while open, opacity-only entrance — the same rule as
          `Disclosure` and every other fold in this repo. */}
      {open && (
        <div
          id={panelId}
          className="mt-2 space-y-3 animate-[fadeIn_0.15s_ease-out_both] pl-7 motion-reduce:animate-none"
        >
          <dl className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
            <Row
              label="Expires"
              value={
                admin.expiresAt ? (
                  <span
                    className={cn(
                      admin.state === "expired" &&
                        "text-orange-600 dark:text-orange-400"
                    )}
                  >
                    {day(admin.expiresAt)}
                  </span>
                ) : (
                  "Never — until you switch it off"
                )
              }
            />
            <Row label="Added" value={day(admin.createdAt)} />
            {admin.note && <Row label="Note" value={admin.note} />}
          </dl>

          {isSelf ? (
            <p className="text-xs text-muted-foreground">
              This is the account you are signed in with. Only the store owner
              can switch it off or delete it.
            </p>
          ) : !canWrite ? null : confirming ? (
            <div className="rounded-lg border border-danger/40 bg-danger/5 p-3">
              <p className="text-xs leading-relaxed">
                Delete <strong>{admin.name}</strong>
                {admin.logCount > 0 ? (
                  <>
                    {" "}
                    and their <strong>{lines(admin.logCount)}</strong>
                  </>
                ) : null}
                ? They lose access on their next click, and{" "}
                {admin.logCount > 0
                  ? "the activity cannot be recovered."
                  : "this cannot be undone."}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Btn tone="ghost" onClick={() => setConfirming(false)}>
                  Keep them
                </Btn>
                <Btn tone="danger" onClick={remove}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Delete{admin.logCount > 0 ? " both" : ""}
                </Btn>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Btn tone="outline" disabled={pending} onClick={toggle}>
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {admin.isActive ? "Switch off" : "Switch back on"}
              </Btn>
              <Btn
                tone="danger"
                disabled={pending}
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete
              </Btn>
              <InfoTip term="Switch off or delete">
                Both take effect on their very next click — nothing waits for a
                session to run out. Switching off keeps the person and their
                activity, so you can turn them back on. Deleting removes both
                for good.
              </InfoTip>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border/60 pb-1.5 last:border-0 last:pb-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-xs font-medium">
        {value}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Activity log                                                       */
/* ------------------------------------------------------------------ */

function ActivityLog({
  admins,
  focus,
  onFocus,
}: {
  admins: TempAdminRow[];
  /** `"all"` or a temp admin's id. */
  focus: string;
  onFocus: (focus: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  // The filter is only offered once it can narrow anything. A focus left
  // pointing at someone who has since been deleted falls back to everyone.
  const people = admins.filter((a) => a.logCount > 0);
  const filterable = people.length > 1;
  const person =
    filterable && focus !== "all"
      ? (people.find((a) => a.id === focus) ?? null)
      : null;

  // Not memoised: it is a sort over a few dozen rows at most, and this repo
  // runs the React Compiler, which memoises what is worth memoising itself.
  const { shown, total } = person
    ? {
        shown: person.recent.map((l) => ({ ...l, who: person.name })),
        total: person.logCount,
      }
    : buildFeed(admins);

  const visible = showAll ? shown : shown.slice(0, PREVIEW);

  return (
    <Card
      title="Activity log"
      tip={
        <>
          <b>Recorded:</b> every sign-in, every change a temporary admin saves,
          and every change a view-only account tried and was refused.{" "}
          <b>Not recorded:</b> opening a screen, and anything you do yourself.
          The lines belong to the person — delete them and their lines go too —
          so this is for keeping an eye on people while they have access, not a
          record to rely on afterwards.
        </>
      }
      aside={
        <span className="text-[11px] text-muted-foreground">
          {total === 0 ? "Nothing yet" : lines(total)}
        </span>
      }
    >
      {/* The two facts the owner asked about, printed: that it records, and
          that deleting a person deletes it. */}
      <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">
        Sign-ins, saved changes and refused attempts by temporary admins.
        Deleted along with the person.
      </p>

      {filterable && (
        <Segmented
          ariaLabel="Whose activity to show"
          value={person ? person.id : "all"}
          onChange={(v) => {
            onFocus(v);
            setShowAll(false);
          }}
          options={[
            { value: "all", label: "Everyone" },
            ...people.map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
      )}

      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {admins.length === 0
            ? "Nothing yet. Add someone, and every sign-in and change they make is listed here."
            : total > 0
              ? `${lines(total)} recorded, but they could not be loaded just now — reload to try again.`
              : "Nothing recorded yet."}
        </p>
      ) : (
        <ol className="divide-y divide-border/60">
          {visible.map((log) => (
            <LogLine key={log.id} log={log} showWho={!person} />
          ))}
        </ol>
      )}

      {(shown.length > PREVIEW || total > shown.length) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {shown.length > PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className={cn(
                "inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-sm text-[11px] font-medium uppercase tracking-widest text-accent transition-colors hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              )}
            >
              {showAll ? "Show fewer" : `View all ${shown.length}`}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none",
                  showAll && "rotate-180"
                )}
              />
            </button>
          )}
          {total > shown.length && (
            <span className="text-[11px] text-muted-foreground">
              Newest {shown.length} of {total}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

function LogLine({ log, showWho }: { log: FeedLine; showWho: boolean }) {
  const verb = verbOf(log.action);
  return (
    <li className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
      <Badge tone={verb.tone} className="mt-0.5 min-w-[4.75rem] shrink-0 justify-center">
        {verb.label}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="break-words text-xs">{log.detail || "Changed something"}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-[11px] text-muted-foreground">
          {showWho && <span className="font-medium text-foreground">{log.who}</span>}
          <time dateTime={log.at} className="tabular-nums">
            {stamp(log.at)}
          </time>
          {log.path && <span className="break-all">on {log.path}</span>}
        </p>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Add someone                                                        */
/* ------------------------------------------------------------------ */

function CreateForm({
  todayISO,
  onDone,
}: {
  todayISO: string;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<AdminMode>("readonly");
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");

  // Tomorrow: an expiry of "today" would already be in the past by the time it
  // is saved in most timezones, and the action refuses it. The input should not
  // offer a value the server will reject.
  const min = new Date(new Date(todayISO).getTime() + 86400000)
    .toISOString()
    .slice(0, 10);

  function submit() {
    start(async () => {
      const res = await createTempAdmin({
        name,
        email,
        password,
        mode,
        expiresAt,
        note,
      });
      if (!res.ok) {
        toast.error(res.error, { duration: 8000 });
        return;
      }
      toast.success(res.message, { duration: 10000 });
      onDone();
    });
  }

  return (
    <Card
      title="Add someone"
      tip="A second sign-in for this admin, on the same /admin/login page. There is no invite email: you choose the password here and send it to them yourself."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Their name" required>
          {(id) => (
            <input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="input"
              placeholder="Priya"
            />
          )}
        </Field>

        <Field
          label="Email"
          required
          tip="This is their username. It must be different from your own admin email — yours is checked first at sign-in, so an account sharing it could never be reached."
        >
          {(id) => (
            <input
              id={id}
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="priya@example.com"
            />
          )}
        </Field>
      </div>

      <Field
        label="Password"
        required
        hint="At least 8 characters."
        tip="Send it to them yourself. It is stored hashed, so nobody — you included — can read it back from this screen afterwards."
      >
        {(id) => (
          <div className="relative">
            <KeyRound
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id={id}
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input pl-9"
              placeholder="Choose something they can type"
              autoComplete="off"
            />
          </div>
        )}
      </Field>

      <Field
        label="What they can do"
        required
        tip={
          <>
            <strong>{MODE_LABEL.readonly}:</strong> {MODE_BLURB.readonly}
            <br />
            <br />
            <strong>{MODE_LABEL.full}:</strong> {MODE_BLURB.full}
          </>
        }
        hint={MODE_SHORT[mode]}
      >
        <Segmented
          value={mode}
          onChange={setMode}
          options={MODE_OPTIONS}
          ariaLabel="What they can do"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Expires on"
          tip="Checked when they sign in and again on every request, so an expiry ends a session that is already open, not just their next login. They can work through the whole of the day you pick."
          hint="Optional — blank lasts until you switch it off."
        >
          {(id) => (
            <div className="relative">
              <CalendarClock
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                id={id}
                type="date"
                min={min}
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="input pl-9"
              />
            </div>
          )}
        </Field>

        <Field label="Note" hint="Optional — only you see it.">
          {(id) => (
            <input
              id={id}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              className="input"
              placeholder="Packing help until Diwali"
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Btn tone="solid" disabled={pending} onClick={submit}>
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Create sign-in
        </Btn>
        <Btn tone="ghost" disabled={pending} onClick={onDone}>
          Cancel
        </Btn>
      </div>
    </Card>
  );
}
