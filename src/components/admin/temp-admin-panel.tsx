"use client";

/**
 * temp-admin-panel — Settings → Access.
 *
 * Three levels, the same as every other tab on this screen:
 *
 *   1. **On top** — who currently has a way in, and what kind. That is the
 *      question the owner opens this tab to answer, and it is answerable
 *      without expanding anything: a name, a mode, a state, when they were last
 *      seen.
 *   2. **Behind a fold** — one person's detail and their activity, and the form
 *      for adding someone. Adding is rare; checking is not.
 *   3. **Behind an `(i)`** — what the two modes actually mean, and what happens
 *      to the trail when an account is deleted.
 *
 * ## Two things this screen has to be honest about
 *
 * **The controls here are a courtesy, not the permission.** View-only is
 * enforced in `requireAdminWrite` on the server, which is why this panel
 * disables its buttons for a view-only viewer *and* why that disabling is not
 * what stops them: the four actions refuse and record the attempt regardless of
 * what the browser sends.
 *
 * **Deleting a person deletes their trail.** `AdminActivityLog` cascades from
 * `TempAdmin`, deliberately. So this says so where the trail is printed, and
 * the delete confirmation names the number of lines that go with it. It is an
 * operational log for the owner's oversight — not an audit record, because an
 * audit record you can erase by deleting its subject is not one.
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  CalendarClock,
  Eye,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { Disclosure } from "@/components/store/disclosure";
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

const LOG_TONE: Record<string, BadgeTone> = {
  login: "info",
  create: "accent",
  update: "neutral",
  delete: "danger",
  blocked: "warn",
};

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

  const live = admins.filter((a) => a.state === "active").length;

  return (
    <div className="space-y-4">
      {!canWrite && (
        <p className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-3 text-xs leading-relaxed text-orange-700 dark:text-orange-300">
          You are signed in with <strong>view-only</strong> access. You can read
          this tab, and every control on it is refused by the server.
        </p>
      )}

      {/* ---- Who has a way in ---- */}
      <Card
        title="People with access"
        tip="Everyone who can sign in at /admin/login besides you. Your own login is not listed here and cannot be changed from this screen."
        aside={
          <span className="text-[11px] text-muted-foreground">
            {admins.length === 0
              ? "Nobody yet"
              : `${live} active of ${admins.length}`}
          </span>
        }
      >
        {admins.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Nobody else can sign in. Add someone below when you need help running
            the store, and switch them off again when you don&apos;t.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {admins.map((a) => (
              <li key={a.id}>
                <AdminRow
                  admin={a}
                  canWrite={canWrite}
                  isSelf={viewerTempAdminId === a.id}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---- Add someone ---- */}
      {adding ? (
        <CreateForm
          todayISO={todayISO}
          disabled={!canWrite}
          onDone={() => setAdding(false)}
        />
      ) : (
        <Btn
          tone="solid"
          disabled={!canWrite}
          onClick={() => setAdding(true)}
          title={canWrite ? undefined : "View-only access cannot add an admin"}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add someone
        </Btn>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One person                                                         */
/* ------------------------------------------------------------------ */

function AdminRow({
  admin,
  canWrite,
  isSelf,
}: {
  admin: TempAdminRow;
  canWrite: boolean;
  isSelf: boolean;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const state = STATE_META[admin.state];

  // Acting on your own row is refused by the server too; the button is disabled
  // so the refusal is not the way you find out.
  const actionable = canWrite && !isSelf && !pending;

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
    <div className="py-1">
      <Disclosure
        label={admin.name}
        icon={
          admin.mode === "full" ? (
            <ShieldCheck className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )
        }
        summary={
          <span className="inline-flex items-center gap-1.5">
            <Badge tone={admin.mode === "full" ? "accent" : "neutral"}>
              {MODE_LABEL[admin.mode]}
            </Badge>
            <Badge tone={state.tone}>{state.label}</Badge>
          </span>
        }
      >
        <div className="space-y-3 pl-1">
          <dl className="space-y-1.5">
            <Row label="Email" value={admin.email} />
            <Row
              label="Last signed in"
              value={admin.lastLoginAt ? stamp(admin.lastLoginAt) : "Never"}
            />
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
                  "No expiry — until you switch it off"
                )
              }
            />
            <Row label="Added" value={day(admin.createdAt)} />
            {admin.note && <Row label="Note" value={admin.note} />}
          </dl>

          {/* ---- Activity ---- */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <h4 className="eyebrow">Activity</h4>
              <span className="text-[11px] text-muted-foreground">
                {admin.logCount === 0
                  ? "nothing yet"
                  : `${admin.logCount} line${admin.logCount === 1 ? "" : "s"}${
                      admin.logCount > admin.recent.length
                        ? ` · newest ${admin.recent.length}`
                        : ""
                    }`}
              </span>
              <InfoTip term="Activity">
                Sign-ins and changes, newest first. Opening a screen is not
                recorded — a list of every page view is a list nobody reads.
                &ldquo;Refused&rdquo; lines are attempts a view-only account made
                to change something. This list is deleted with the person, so it
                is here for your own oversight rather than as a record to rely on
                afterwards.
              </InfoTip>
            </div>

            {admin.recent.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                They have not signed in yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {admin.recent.map((log) => (
                  <LogLine key={log.id} log={log} />
                ))}
              </ul>
            )}
          </div>

          {/* ---- Controls ---- */}
          {isSelf ? (
            <p className="text-xs text-muted-foreground">
              This is the account you are signed in with — switch it off or
              delete it from the owner&apos;s login.
            </p>
          ) : confirming ? (
            <div className="rounded-lg border border-danger/40 bg-danger/5 p-3">
              <p className="text-xs leading-relaxed">
                Delete <strong>{admin.name}</strong>
                {admin.logCount > 0 ? (
                  <>
                    {" "}
                    and the{" "}
                    <strong>
                      {admin.logCount} activity{" "}
                      {admin.logCount === 1 ? "line" : "lines"}
                    </strong>{" "}
                    underneath them
                  </>
                ) : null}
                ? They stop working immediately, and the activity cannot be
                recovered.
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
              <Btn tone="outline" disabled={!actionable} onClick={toggle}>
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {admin.isActive ? "Switch off" : "Switch back on"}
              </Btn>
              <Btn
                tone="danger"
                disabled={!actionable}
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete
              </Btn>
              {admin.isActive && (
                <span className="text-[11px] text-muted-foreground">
                  Switching off stops them on their next click.
                </span>
              )}
            </div>
          )}
        </div>
      </Disclosure>
    </div>
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

function LogLine({ log }: { log: TempAdminLogRow }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      <Badge tone={LOG_TONE[log.action] ?? "neutral"}>
        {log.action === "blocked" ? "Refused" : log.action}
      </Badge>
      <span className="min-w-0 flex-1 break-words">
        {log.detail || "Changed something"}
        {log.path && (
          <span className="text-muted-foreground"> · {log.path}</span>
        )}
      </span>
      <time
        dateTime={log.at}
        className="shrink-0 tabular-nums text-[11px] text-muted-foreground"
      >
        {stamp(log.at)}
      </time>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Add someone                                                        */
/* ------------------------------------------------------------------ */

function CreateForm({
  todayISO,
  disabled,
  onDone,
}: {
  todayISO: string;
  disabled: boolean;
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
      tip="Creates a second sign-in for this admin. They use the same /admin/login page. Choose the password yourself and send it to them — there is no invite email, and nothing here can show it to you again afterwards."
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
        hint="At least 8 characters. Send it to them yourself — it is stored hashed and cannot be read back."
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
        hint={MODE_BLURB[mode]}
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
          tip="Leave blank for access that lasts until you switch it off. An expiry is checked when they sign in and again on every request, so it ends their session too, not just their next login."
          hint="Optional. They can work through the whole of this day."
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

        <Field
          label="Note"
          hint="Optional — for you, not for them."
        >
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
        <Btn tone="solid" disabled={disabled || pending} onClick={submit}>
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
