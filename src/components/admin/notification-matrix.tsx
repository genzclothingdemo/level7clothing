"use client";

/**
 * The notification matrix — *which events tell whom, on which channel.*
 *
 * ## The problem this shape solves
 *
 * There are 19 events and four channels, so the honest data is a 76-cell grid.
 * A 76-row list of switches is a spreadsheet, and nobody configures a
 * spreadsheet; they open it once, fail to find the line they want, and close
 * it. Four decisions turn it back into a settings screen:
 *
 * 1. **The channel is not a row, it is a column.** One row is "an order
 *    shipped, told to the customer" and its cells are the ways of telling
 *    them. That is the sentence an owner thinks in — *when this happens, tell
 *    them* — and it collapses 76 switches into 19 questions.
 * 2. **Each family is a fold with a live summary.** Closed, the whole posture
 *    is four lines: "Orders · 5 of 28 on". That is the five-second read. Open,
 *    it is the seven rows of one errand, not all nineteen.
 * 3. **Recipient is a heading, not a column.** "To your customer" and "To you"
 *    are what the owner is actually choosing between, and putting it above the
 *    rows removes a column from a grid that has no room for one.
 * 4. **A group can be set in one tap.** "Stop emailing customers about
 *    returns" is one errand and was eight taps; the group row does it once.
 *
 * ## Unavailable channels are drawn, disabled, and explained
 *
 * SMS and WhatsApp have no gateway. They are **present and unticket-able**,
 * with the reason on the control, because a missing checkbox reads as a
 * missing feature while a disabled one that says why teaches what would have
 * to happen. The store already does this where the mobile one-time code is
 * switched on. Whether a channel is offered comes from `IMPLEMENTED_ACTIONS`
 * by way of the server — the same list the sender cancels an unknown action
 * against — so a cell cannot be tickable and unsendable.
 *
 * ## Why there is no Save button here
 *
 * Every other control on this screen is a `SiteSettings` column and rides the
 * shared save bar. These are not: a tick is `AutomationRule.isActive`, a
 * different table with a different writer, and putting rule state into
 * `SettingsDraft` would give one column two editors — the exact trap CLAUDE.md
 * records for `defaultReturnsInfo`. So each tick saves on its own, optimistic
 * and reverted on failure, and the card says so on its face. The Returns tab
 * already sets that precedent with its own Save.
 *
 * The response is the **database's** answer, not the browser's guess: the
 * action returns the rule ids the cell now governs, which is how a rule
 * created by the first tick lands in the cell without a page refresh.
 */

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BellRing,
  Clock,
  Mail,
  MessageCircle,
  MessageSquare,
  Radio,
} from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { Disclosure } from "@/components/store/disclosure";
import { Badge } from "@/components/admin/order-ui";
import {
  setNotificationChannel,
  setNotificationChannelForRows,
} from "@/app/actions/notification-settings";
import {
  channelLabel,
  channelShort,
  channelSpec,
  type ChannelFact,
  type MatrixGroup,
  type MatrixRow,
  type NotificationMatrix,
} from "@/lib/notification-channels";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

/**
 * One glyph per channel, so the grid is not read by colour alone.
 *
 * Mapped here rather than carried on `NOTIFY_CHANNELS` because a Lucide icon
 * is a `forwardRef` **object**, and an object with a function in it cannot
 * cross the server/client boundary — see the RSC trap in CLAUDE.md, which took
 * down live admin pages twice. `lib/notification-channels.ts` is read by the
 * server page, so it holds strings only.
 */
const CHANNEL_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  push: BellRing,
  inapp: Bell,
  sms: MessageSquare,
  whatsapp: MessageCircle,
};

/**
 * A channel the engine grew and this screen has not been taught still gets a
 * column, so it needs a glyph. `Radio` is deliberately generic — an unnamed
 * channel should look unnamed rather than borrow another one's identity.
 */
function iconFor(channel: string): React.ComponentType<{ className?: string }> {
  return CHANNEL_ICON[channel] ?? Radio;
}

/* ------------------------------------------------------------------ */
/*  Local state                                                        */
/* ------------------------------------------------------------------ */

/** `eventKey::channel` — the identity of one cell, for the override map. */
function cellId(eventKey: string, channel: string): string {
  return `${eventKey}::${channel}`;
}

/**
 * What a cell looks like *now*, given the server's render and everything
 * this session has changed since.
 *
 * An overlay rather than a copy of the whole matrix, for one reason: the props
 * are re-rendered by the server whenever anything else on this screen saves,
 * and a component that copied them into state would either ignore that render
 * or need an effect to re-sync — and `set-state-in-effect` is already the
 * biggest source of lint noise in this repo. An overlay is correct under both:
 * every entry in it came back from the database, so it is never a guess, and a
 * real page load clears it.
 */
type Override = { ruleIds: string[]; on: boolean };

export function NotificationMatrixCard({
  matrix,
  channels,
  canWrite,
}: {
  matrix: NotificationMatrix;
  channels: ChannelFact[];
  /** False for a view-only admin. The server refuses them either way. */
  canWrite: boolean;
}) {
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();

  const factOf = useMemo(() => {
    const map = new Map<string, ChannelFact>();
    for (const f of channels) map.set(f.channel, f);
    return map;
  }, [channels]);

  /** The live state of one cell: the override if this session moved it. */
  const stateOf = useCallback(
    (eventKey: string, channel: string, row: MatrixRow) => {
      const base = row.cells.find((c) => c.channel === channel);
      const over = overrides[cellId(eventKey, channel)];
      if (over) {
        return {
          on: over.on,
          mixed: false,
          count: over.ruleIds.length,
          broken: false,
        };
      }
      return {
        on: base?.on ?? false,
        mixed: base?.doubleSend ?? false,
        count: base?.ruleIds.length ?? 0,
        broken: base?.broken ?? false,
      };
    },
    [overrides]
  );

  /** Every live "on" count, recomputed from the render plus the overrides. */
  const counts = useMemo(() => {
    const byChannel: Record<string, number> = Object.fromEntries(
      matrix.channels.map((c) => [c, 0])
    );
    const byFamily: Record<string, { on: number; available: number }> = {};

    for (const family of matrix.families) {
      const tally = { on: 0, available: 0 };
      for (const group of family.groups) {
        for (const row of group.rows) {
          for (const channel of matrix.channels) {
            const fact = factOf.get(channel);
            const live = stateOf(row.key, channel, row);
            if (live.on || live.mixed) byChannel[channel] += 1;
            if (!fact?.supported) continue;
            tally.available += 1;
            if (live.on || live.mixed) tally.on += 1;
          }
        }
      }
      byFamily[family.key] = tally;
    }
    return { byChannel, byFamily };
  }, [matrix, factOf, stateOf]);

  /* ---- Writes --------------------------------------------------- */

  function guard(): boolean {
    if (canWrite) return true;
    toast.error(
      "View-only access: this account can read every screen but cannot change anything. Ask the store owner for full access.",
      { duration: 8000 }
    );
    return false;
  }

  function toggleCell(row: MatrixRow, channel: string, next: boolean) {
    if (!guard()) return;
    const id = cellId(row.key, channel);
    if (busy[id]) return;

    // Optimistic: the tick moves now, and is put back if the server says no.
    const before = overrides[id];
    setOverrides((prev) => ({
      ...prev,
      [id]: { ruleIds: prev[id]?.ruleIds ?? [], on: next },
    }));
    setBusy((prev) => ({ ...prev, [id]: true }));

    startTransition(async () => {
      const res = await setNotificationChannel({
        eventKey: row.key,
        channel,
        enabled: next,
      });
      setBusy((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });

      if (!res.ok) {
        // Back to whatever it was — the server's render if this session had
        // not touched it, otherwise the last answer the server gave.
        setOverrides((prev) => {
          const copy = { ...prev };
          if (before) copy[id] = before;
          else delete copy[id];
          return copy;
        });
        toast.error(res.error, { duration: 9000 });
        return;
      }

      // Rebase on the database's answer, ids included.
      applyCells(res.cells);
    });
  }

  function toggleGroup(group: MatrixGroup, channel: string, next: boolean) {
    if (!guard()) return;
    const rows = group.rows.filter((r) => r.creatable || !next);
    if (rows.length === 0) return;

    const ids = rows.map((r) => cellId(r.key, channel));
    if (ids.some((id) => busy[id])) return;

    const before: Record<string, Override | undefined> = {};
    for (const id of ids) before[id] = overrides[id];

    setOverrides((prev) => {
      const copy = { ...prev };
      for (const id of ids) copy[id] = { ruleIds: prev[id]?.ruleIds ?? [], on: next };
      return copy;
    });
    setBusy((prev) => {
      const copy = { ...prev };
      for (const id of ids) copy[id] = true;
      return copy;
    });

    startTransition(async () => {
      const res = await setNotificationChannelForRows({
        eventKeys: rows.map((r) => r.key),
        channel,
        enabled: next,
      });
      setBusy((prev) => {
        const copy = { ...prev };
        for (const id of ids) delete copy[id];
        return copy;
      });

      if (!res.ok) {
        setOverrides((prev) => {
          const copy = { ...prev };
          for (const id of ids) {
            const prior = before[id];
            if (prior) copy[id] = prior;
            else delete copy[id];
          }
          return copy;
        });
        toast.error(res.error, { duration: 9000 });
        return;
      }

      // A partial result is the normal case here: a row with no message to
      // send is skipped rather than failing the other eleven. Anything the
      // server did not answer for goes back to where it was, so the screen
      // never shows a tick that was not written.
      const answered = new Set(res.cells.map((c) => cellId(c.eventKey, c.channel)));
      setOverrides((prev) => {
        const copy = { ...prev };
        for (const id of ids) {
          if (answered.has(id)) continue;
          const prior = before[id];
          if (prior) copy[id] = prior;
          else delete copy[id];
        }
        return copy;
      });
      applyCells(res.cells);

      const skipped = ids.length - res.cells.length;
      if (skipped > 0) {
        toast.warning(
          `${res.cells.length} changed · ${skipped} skipped because they have no message to send yet.`,
          { duration: 8000 }
        );
      }
    });
  }

  function applyCells(cells: { eventKey: string; channel: string; ruleIds: string[]; on: boolean }[]) {
    setOverrides((prev) => {
      const copy = { ...prev };
      for (const c of cells) {
        copy[cellId(c.eventKey, c.channel)] = { ruleIds: c.ruleIds, on: c.on };
      }
      return copy;
    });
  }

  /* ---- Render ---------------------------------------------------- */

  const liveTotal = matrix.channels.reduce(
    (sum, c) => sum + (counts.byChannel[c] ?? 0),
    0
  );

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="flex min-w-0 items-center gap-1 font-serif text-lg leading-none">
          Who gets told what
          <InfoTip term="Who gets told what">
            Every alert this store can send, and who it goes to. A tick means
            that event sends on that channel; clearing it means the message
            genuinely stops, not that it is hidden. These are the same rules
            Admin → Automation lists — this screen is the short way to change
            the one thing you came for, and that screen is where you rewrite
            the wording or the timing.
          </InfoTip>
        </h2>
        <Badge tone="neutral" title="There is no Save button for this card">
          Saves as you tick
        </Badge>
      </div>

      {/* ---- The whole posture, in four lines ---- */}
      <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {matrix.channels.map((channel) => {
          const fact = factOf.get(channel);
          const on = counts.byChannel[channel] ?? 0;
          const Icon = iconFor(channel);
          const spec = channelSpec(channel);
          const unavailable = !fact?.supported;
          return (
            <li
              key={channel}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2",
                unavailable
                  ? "border-dashed border-border bg-muted/20"
                  : on > 0
                    ? "border-accent/40 bg-accent/5"
                    : "border-border"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  unavailable
                    ? "text-muted-foreground"
                    : on > 0
                      ? "text-accent"
                      : "text-muted-foreground"
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-xs font-medium">
                  {channelLabel(channel)}
                  {spec && (
                    <InfoTip term={spec.label}>{spec.blurb}</InfoTip>
                  )}
                </p>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {unavailable
                    ? fact?.detail
                    : on === 0
                      ? "No alerts go out this way."
                      : `${on} alert${on === 1 ? "" : "s"} go out this way.`}
                </p>
              </div>
              {unavailable ? (
                <Badge tone="neutral">Unavailable</Badge>
              ) : !fact?.healthy ? (
                <Badge tone="warn" title={fact?.detail}>
                  Check it
                </Badge>
              ) : null}
            </li>
          );
        })}
      </ul>

      {matrix.brokenCount > 0 && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-danger/40 bg-danger/10 p-2.5 text-xs leading-relaxed text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {matrix.brokenCount} alert{matrix.brokenCount === 1 ? " is" : "s are"}{" "}
            switched on with no message attached, so {matrix.brokenCount === 1 ? "it" : "they"}{" "}
            cannot send.{" "}
            <Link href="/admin/automation" className="underline">
              Fix in Automation
            </Link>
            .
          </span>
        </p>
      )}

      {/* ---- The grid ---- */}
      <div className="mt-4 min-w-0 divide-y divide-border rounded-xl border border-border">
        {matrix.families.map((family, i) => {
          const tally = counts.byFamily[family.key] ?? { on: 0, available: 0 };
          return (
            <div key={family.key} className="min-w-0 px-3">
              <Disclosure
                label={family.label}
                // The first family opens so the card does not read as an empty
                // list of headings; the rest stay closed so one screen is one
                // errand. Nineteen rows open at once is the spreadsheet again.
                defaultOpen={i === 0}
                summary={
                  <span
                    className={cn(
                      tally.on === 0 && "text-muted-foreground",
                      tally.on > 0 && "text-foreground"
                    )}
                  >
                    {family.events} event{family.events === 1 ? "" : "s"} ·{" "}
                    <span className={cn(tally.on > 0 && "font-medium text-accent")}>
                      {tally.on} of {tally.available} on
                    </span>
                  </span>
                }
              >
                <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
                  {family.blurb}
                </p>
                <div className="space-y-4">
                  {family.groups.map((group) => (
                    <Group
                      key={`${family.key}:${group.recipient}`}
                      group={group}
                      channels={channels}
                      stateOf={stateOf}
                      busy={busy}
                      canWrite={canWrite}
                      onCell={toggleCell}
                      onGroup={toggleGroup}
                    />
                  ))}
                </div>
              </Disclosure>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        {liveTotal === 0
          ? "Nothing is switched on — this store sends no alerts at all."
          : `${liveTotal} alert${liveTotal === 1 ? "" : "s"} switched on.`}{" "}
        Each tick is one rule in{" "}
        <Link
          href="/admin/automation"
          className="text-accent underline-offset-2 hover:underline"
        >
          Automation
        </Link>
        , where its wording and timing live.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  One recipient group                                                */
/* ------------------------------------------------------------------ */

function Group({
  group,
  channels,
  stateOf,
  busy,
  canWrite,
  onCell,
  onGroup,
}: {
  group: MatrixGroup;
  channels: ChannelFact[];
  stateOf: (
    eventKey: string,
    channel: string,
    row: MatrixRow
  ) => { on: boolean; mixed: boolean; count: number; broken: boolean };
  busy: Record<string, boolean>;
  canWrite: boolean;
  onCell: (row: MatrixRow, channel: string, next: boolean) => void;
  onGroup: (group: MatrixGroup, channel: string, next: boolean) => void;
}) {
  // A bulk row earns its space at three rows and not at two: below that it is
  // the same number of taps and one more thing to read.
  const showBulk = group.rows.length >= 3;

  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1.5 text-muted-foreground">{group.label}</p>

      <ul className="min-w-0 space-y-1">
        {showBulk && (
          // No horizontal padding: the bulk row's checkboxes have to line up
          // exactly with the rows underneath, and at 375px an inset of even
          // 8px is the difference between "WhatsApp" fitting and being cut to
          // "Whats…". The tint alone is enough to mark it as the header.
          <li className="min-w-0 rounded-lg bg-muted/40 py-1.5">
            <Row
              label="All of these"
              muted
              channels={channels}
              cells={channels.map((fact) => {
                const states = group.rows.map((r) =>
                  stateOf(r.key, fact.channel, r)
                );
                const onCount = states.filter((s) => s.on || s.mixed).length;
                return {
                  channel: fact.channel,
                  on: onCount === states.length && onCount > 0,
                  indeterminate: onCount > 0 && onCount < states.length,
                  count: 0,
                  broken: false,
                  disabled:
                    !canWrite ||
                    group.rows.some((r) => busy[cellId(r.key, fact.channel)]),
                  onChange: (next: boolean) => onGroup(group, fact.channel, next),
                };
              })}
            />
          </li>
        )}

        {group.rows.map((row) => (
          <li key={row.key} className="min-w-0">
            <Row
              label={row.label}
              note={row.delay}
              custom={row.custom}
              channels={channels}
              cells={channels.map((fact) => {
                const live = stateOf(row.key, fact.channel, row);
                return {
                  channel: fact.channel,
                  on: live.on,
                  indeterminate: live.mixed,
                  count: live.count,
                  broken: live.broken,
                  disabled:
                    !canWrite ||
                    busy[cellId(row.key, fact.channel)] ||
                    // A row with no message anywhere cannot have a new cell
                    // created, so the empty ones are shown disabled rather
                    // than offered and then refused.
                    (!row.creatable && live.count === 0),
                  onChange: (next: boolean) => onCell(row, fact.channel, next),
                };
              })}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One row                                                            */
/* ------------------------------------------------------------------ */

type CellProps = {
  channel: string;
  on: boolean;
  indeterminate: boolean;
  count: number;
  broken: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
};

/**
 * Label on the left, one checkbox per channel on the right — and it **wraps
 * rather than scrolls**.
 *
 * At 375px there is about 280px inside the card, which is nowhere near enough
 * for a label and five labelled controls on one line. The alternative to
 * wrapping is a horizontal scroller, and a scroller hides checkboxes behind an
 * edge on the one screen whose whole point is seeing every tick at once. So
 * the label takes the full width below `lg` and the cells sit under it as a
 * two- or three-column block; from `lg` they are a fixed-width row, which
 * lines them up into real columns down the group and gives back the matrix
 * reading a laptop has room for.
 *
 * **Every checkbox carries its channel's name, at every width.** There is no
 * column-header row to scroll away from, and no icon-only cell whose meaning
 * depends on remembering a legend — each control says what it is, which is
 * what makes this usable by an owner on a phone between parcels.
 */
function Row({
  label,
  note,
  custom,
  muted,
  channels,
  cells,
}: {
  label: string;
  note?: string | null;
  custom?: boolean;
  muted?: boolean;
  channels: ChannelFact[];
  cells: CellProps[];
}) {
  const factOf = new Map(channels.map((f) => [f.channel, f]));

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      <div className="min-w-0 basis-full lg:flex-1 lg:basis-0">
        <p
          className={cn(
            "min-w-0 break-words text-xs",
            muted ? "font-medium text-muted-foreground" : "text-foreground"
          )}
        >
          {label}
          {custom && (
            <span className="ml-1.5 align-middle">
              <Badge tone="info" title="Made by hand in Automation, not shipped with the store">
                Yours
              </Badge>
            </span>
          )}
        </p>
        {note && (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" aria-hidden />
            {note}
          </p>
        )}
      </div>

      {/* Three columns even at 375px, not two: five channels over two columns
          is three rows of controls under every one of nineteen events, which
          doubles the length of the screen. Three columns is two rows, and the
          chip is still 44px tall and 100px wide — inside the tap-target floor
          with room for the longest label. */}
      <div className="grid w-full shrink-0 grid-cols-3 gap-1 lg:flex lg:w-auto">
        {cells.map((cell) => {
          const fact = factOf.get(cell.channel);
          const unavailable = !fact?.supported;
          const disabled = cell.disabled || unavailable;
          const reason = unavailable
            ? fact?.detail
            : cell.disabled
              ? "This alert has no message to send yet — add one in Automation."
              : undefined;

          return (
            <label
              key={cell.channel}
              title={reason}
              className={cn(
                // `gap-1 px-1.5` is measured, not taste: at 375px the column
                // is 92px and "WHATSAPP" needs 59 of them, which only fits
                // once the padding and the gap give it back. A truncated
                // channel name on a checkbox is a control nobody can identify.
                "flex min-h-11 min-w-0 items-center gap-1 rounded-lg border px-1.5 lg:w-[6.5rem]",
                disabled
                  ? "cursor-not-allowed border-dashed border-border bg-muted/20 text-muted-foreground opacity-70"
                  : "cursor-pointer border-border hover:bg-muted/50",
                !disabled &&
                  (cell.on || cell.indeterminate) &&
                  "border-accent/50 bg-accent/10"
              )}
            >
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed"
                checked={cell.on}
                disabled={disabled}
                // `indeterminate` is a DOM property and not an attribute, so a
                // ref is the only way to set it — the same reason `Check` in
                // form-kit reaches for one.
                ref={(el) => {
                  if (el) el.indeterminate = cell.indeterminate && !cell.on;
                }}
                aria-label={
                  reason
                    ? `${channelLabel(cell.channel)} — ${reason}`
                    : `${channelLabel(cell.channel)} · ${label}`
                }
                onChange={(e) => cell.onChange(e.target.checked)}
              />
              {/* Sentence case, not the house uppercase. Two reasons, and the
                  second is the real one: "WHATSAPP" is 57px wide and the 92px
                  column at 375px has 53 to give, while "WhatsApp" fits with
                  room to spare — and uppercasing a brand name whose own
                  capital is the point reads as a typo. The uppercase style
                  belongs to buttons and eyebrows; this is a checkbox label. */}
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                {channelShort(cell.channel)}
              </span>
              {cell.count > 1 && (
                <span
                  title={`${cell.count} rules match this — they switch together`}
                  className="shrink-0 text-[10px] font-semibold text-accent"
                >
                  ×{cell.count}
                </span>
              )}
              {cell.broken && (
                <AlertTriangle
                  className="h-3 w-3 shrink-0 text-danger"
                  aria-label="switched on but has no message"
                />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  The strip other screens show instead of this card                  */
/* ------------------------------------------------------------------ */

/**
 * A read-only summary of the matrix, with one link back to it.
 *
 * The pattern CLAUDE.md already names for Returns and the order pipeline: the
 * decision has one editor, and every other screen that needs to *state* it
 * shows the value and a way to reach that editor. Never a control — a second
 * editable copy is how two tabs open become a silent lost update.
 *
 * On Admin → Automation it sits above the rule list, which is the honest
 * relationship between the two screens: the grid is the short way to switch
 * one alert on or off, and the list underneath is where a rule's wording,
 * timing and conditions actually live.
 */
export function NotificationPostureStrip({
  byChannel,
  channels,
  total,
}: {
  byChannel: Record<string, number>;
  channels: ChannelFact[];
  total: number;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-dashed border-border bg-muted/20 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="flex min-w-0 items-center gap-1 font-serif text-lg leading-none">
          Who gets told what
        </h3>
        <Link
          href="/admin/settings?tab=alerts"
          className="inline-flex min-h-11 items-center gap-1 text-xs font-medium uppercase tracking-widest text-accent transition-opacity hover:opacity-80"
        >
          Open the grid <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {channels.map((fact) => {
          const Icon = iconFor(fact.channel);
          return (
            <li
              key={fact.channel}
              className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="font-medium text-foreground">
                {channelShort(fact.channel)}
              </span>
              <span>
                {!fact.supported
                  ? "unavailable"
                  : `${byChannel[fact.channel] ?? 0} on`}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
        {/* `{" "}` is load-bearing: the JSX transform strips the leading space
            of a multi-line text chunk, which rendered "21 alertsswitched". */}
        {total} alert{total === 1 ? "" : "s"}{" "}
        switched on in total, counted from
        the rules below. Settings &rarr; Alerts is the grid view of the same
        rows — the quick way to switch one event on or off, and the only place
        the whole posture is visible at once. Shown here read-only.
      </p>
    </div>
  );
}
