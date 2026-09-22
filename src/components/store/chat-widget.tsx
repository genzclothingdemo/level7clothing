"use client";

import { playNotificationSound } from "@/lib/notification-sound";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  CheckCheck,
  Clock3,
  FileText,
  Loader2,
  MessageCircle,
  Paperclip,
  Phone,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyboardOpen } from "@/hooks/use-keyboard-open";
import type {
  ChatAttachment,
  ChatMessageDTO,
  ChatPollResponse,
  ChatStatus,
} from "@/lib/chat";

/**
 * Customer side of the direct chat.
 *
 * The provider owns the conversation and the polling; the launcher (in the
 * navbar, where the theme toggle used to be) and the panel are both thin
 * consumers. They are split that way because the launcher has to show an
 * unread badge from a component that is rendered somewhere else entirely.
 *
 * Polling rules, per the brief and per this app being serverless:
 *
 * - Panel closed: nothing. Not a slow poll, nothing.
 * - Open and visible: every 5s.
 * - Open but the tab is hidden: every 30s, and an immediate catch-up the
 *   moment it comes back.
 * - Each request carries the newest message the client already holds, so the
 *   server replies with the delta, not the conversation.
 */

/* ------------------------------------------------------------------ */
/*  Config + types                                                     */
/* ------------------------------------------------------------------ */

export type ChatConfig = {
  brandName: string;
  /** From `getSettings().contactPhone` — never hardcode a number. */
  contactPhone: string;
  maxLength: number;
  maxBytes: number;
  /** `accept` list for the file picker, derived from the server allowlist. */
  accept: string;
};

/** An attachment that the upload route has signed. */
type SignedAttachment = ChatAttachment & { token: string };

/**
 * A message that exists only in this browser, for as long as its request is
 * in flight. It is not a `ChatMessageDTO` and has no `status` field, because
 * "pending" is not a delivery state the database knows about.
 */
type Outbound = {
  tempId: string;
  body: string;
  attachment: SignedAttachment | null;
  createdAt: string;
  error: string | null;
};

const POLL_VISIBLE_MS = 5_000;
const POLL_HIDDEN_MS = 30_000;

/**
 * Marks that this browser has a conversation, so the widget knows whether a
 * cold page load is worth one bootstrap request. Without it, every visitor
 * who never chats would still cost a database round trip on every page — and
 * on this store a query from the US function region to the Mumbai database is
 * a quarter of a second (see CLAUDE.md).
 */
const MARKER_KEY = "level7_chat_active";

function readMarker(): boolean {
  try {
    return window.localStorage.getItem(MARKER_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMarker() {
  try {
    window.localStorage.setItem(MARKER_KEY, "1");
  } catch {
    /* private mode — the badge just waits until the panel is opened */
  }
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

type ChatStore = {
  config: ChatConfig;
  open: boolean;
  setOpen: (open: boolean) => void;
  messages: ChatMessageDTO[];
  outbox: Outbound[];
  unread: number;
  isClosed: boolean;
  signedIn: boolean;
  hasContact: boolean;
  loading: boolean;
  error: string | null;
  send: (input: {
    body: string;
    attachment: SignedAttachment | null;
    name?: string;
    email?: string;
  }) => Promise<boolean>;
  retry: (tempId: string) => void;
  discard: (tempId: string) => void;
};

const ChatContext = createContext<ChatStore | null>(null);

/** Null outside the store layout, so the launcher can simply not render. */
function useChatStore(): ChatStore | null {
  return useContext(ChatContext);
}

function sortMessages(list: ChatMessageDTO[]): ChatMessageDTO[] {
  return [...list].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

function mergeMessages(
  current: ChatMessageDTO[],
  incoming: ChatMessageDTO[],
  statuses: { id: string; status: ChatStatus }[]
): ChatMessageDTO[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  for (const patch of statuses) {
    const existing = byId.get(patch.id);
    if (existing && existing.status !== patch.status) {
      byId.set(patch.id, { ...existing, status: patch.status });
    }
  }
  return sortMessages([...byId.values()]);
}

export function ChatProvider({
  config,
  children,
}: {
  config: ChatConfig;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [outbox, setOutbox] = useState<Outbound[]>([]);
  const [unread, setUnread] = useState(0);
  const [isClosed, setIsClosed] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [hasContact, setHasContact] = useState(false);
  // True until the first poll of the session comes back; after that the panel
  // always has something to show, cached or empty.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The cursor lives on a ref, not in state, so `poll` can stay referentially
  // stable — a changing callback would tear down and rebuild the interval on
  // every single message.
  const messagesRef = useRef<ChatMessageDTO[]>([]);

  const commit = useCallback(
    (incoming: ChatMessageDTO[], statuses: { id: string; status: ChatStatus }[]) => {
      const merged = mergeMessages(messagesRef.current, incoming, statuses);

      // Chime only for a genuinely new message from the store, and only for
      // real arrivals — `incoming` is empty on the overwhelming majority of
      // polls, and status-only updates (sent → delivered → seen) must stay
      // silent or every message would sound three times.
      //
      // Skipped on the first load: `messagesRef.current` is empty then, and
      // replaying a chime for history the shopper has already read would be
      // startling rather than helpful.
      const firstLoad = messagesRef.current.length === 0;
      const fromAdmin = incoming.some((m) => m.sender === "admin");
      if (!firstLoad && fromAdmin) playNotificationSound();

      messagesRef.current = merged;
      setMessages(merged);
    },
    []
  );

  const poll = useCallback(async (opts: { seen?: boolean } = {}) => {
    const last = messagesRef.current[messagesRef.current.length - 1];
    const qs = new URLSearchParams();
    if (last) {
      qs.set("afterAt", last.createdAt);
      qs.set("afterId", last.id);
    }
    if (opts.seen) qs.set("seen", "1");
    const query = qs.toString();

    try {
      const res = await fetch(`/api/chat${query ? `?${query}` : ""}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as ChatPollResponse;

      commit(data.messages, data.statuses);
      setUnread(data.unread);
      setIsClosed(data.isClosed);
      setSignedIn(data.signedIn);
      setHasContact(data.hasContact);
      setError(null);
      if (data.threadId) writeMarker();
    } catch {
      setError("Can't reach the store right now — still trying.");
    }
  }, [commit]);

  /**
   * One catch-up request on a cold load, and only for a browser that has
   * chatted before. That is what puts the unread dot on the launcher without
   * making every visitor pay for a query they did not ask for.
   */
  useEffect(() => {
    if (!readMarker()) return;
    // Deferred by a tick so the request is not issued during hydration, and
    // so the effect body itself never triggers a render.
    const id = setTimeout(() => void poll(), 0);
    return () => clearTimeout(id);
  }, [poll]);

  /** The interval itself: open only, with a hidden-tab backoff. */
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const visible = document.visibilityState === "visible";
      // `seen` is gated on real visibility, not on the panel being mounted:
      // a backgrounded tab has not read anything.
      await poll({ seen: visible });
      if (cancelled) return;
      // The spinner is only ever shown before the first reply lands, so it is
      // cleared here rather than being toggled from the effect body.
      setLoading(false);
      timer = setTimeout(tick, visible ? POLL_VISIBLE_MS : POLL_HIDDEN_MS);
    };

    void tick();

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [open, poll]);

  /**
   * POST one outbox item. The optimistic bubble is already on screen with a
   * clock; this either swaps it for the stored message or pins an error and a
   * Retry onto it. Nothing is ever silently dropped.
   */
  const deliver = useCallback(
    async (
      item: Outbound,
      contact?: { name?: string; email?: string }
    ): Promise<boolean> => {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: item.body,
            attachment: item.attachment,
            // Name/email ride along and are only used to fill blanks the
            // thread does not already have.
            name: contact?.name,
            email: contact?.email,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          message?: ChatMessageDTO;
          threadId?: string;
          error?: string;
        };
        if (!res.ok || !data.message) {
          throw new Error(data.error || "Message not sent.");
        }
        commit([data.message], []);
        writeMarker();
        if (contact?.name || contact?.email) setHasContact(true);
        setOutbox((list) => list.filter((o) => o.tempId !== item.tempId));
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Message not sent.";
        setOutbox((list) =>
          list.map((o) => (o.tempId === item.tempId ? { ...o, error: message } : o))
        );
        return false;
      }
    },
    [commit]
  );

  const outboxRef = useRef<Outbound[]>([]);
  useEffect(() => {
    outboxRef.current = outbox;
  }, [outbox]);

  const send = useCallback<ChatStore["send"]>(
    async ({ body, attachment, name, email }) => {
      const item: Outbound = {
        tempId: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        body,
        attachment,
        createdAt: new Date().toISOString(),
        error: null,
      };
      setOutbox((list) => [...list, item]);
      return deliver(item, { name, email });
    },
    [deliver]
  );

  const retry = useCallback(
    (tempId: string) => {
      const item = outboxRef.current.find((o) => o.tempId === tempId);
      if (!item) return;
      setOutbox((list) =>
        list.map((o) => (o.tempId === tempId ? { ...o, error: null } : o))
      );
      void deliver({ ...item, error: null });
    },
    [deliver]
  );

  const discard = useCallback((tempId: string) => {
    setOutbox((list) => list.filter((o) => o.tempId !== tempId));
  }, []);

  // Memoised so a 5-second poll that changes nothing does not re-render the
  // navbar (and everything else under the provider) along with the panel.
  const value = useMemo<ChatStore>(
    () => ({
      config,
      open,
      setOpen,
      messages,
      outbox,
      unread,
      isClosed,
      signedIn,
      hasContact,
      loading,
      error,
      send,
      retry,
      discard,
    }),
    [
      config,
      open,
      messages,
      outbox,
      unread,
      isClosed,
      signedIn,
      hasContact,
      loading,
      error,
      send,
      retry,
      discard,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

/* ------------------------------------------------------------------ */
/*  Launcher (navbar)                                                  */
/* ------------------------------------------------------------------ */

/**
 * Sits in the navbar where the theme toggle used to be. Same 40px circle, so
 * the header's rhythm is unchanged.
 */
export function ChatLauncherButton({ className }: { className?: string }) {
  const chat = useChatStore();
  if (!chat) return null;

  return (
    <button
      type="button"
      onClick={() => chat.setOpen(!chat.open)}
      aria-label={
        chat.unread > 0 ? `Chat with us (${chat.unread} new)` : "Chat with us"
      }
      aria-expanded={chat.open}
      className={cn(
        // 44px touch target, and colour-change only: CLAUDE.md records that
        // hover-bounce/scale was stripped from this store deliberately.
        "relative grid h-11 w-11 place-items-center rounded-full border border-border",
        "transition-colors hover:border-primary/40 hover:bg-primary/5 cursor-pointer",
        chat.open && "border-accent/50 bg-accent/10 text-accent",
        className
      )}
    >
      <MessageCircle className="h-[18px] w-[18px]" />
      {chat.unread > 0 && (
        <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-medium text-accent-foreground">
          {chat.unread > 9 ? "9+" : chat.unread}
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Message rendering                                                  */
/* ------------------------------------------------------------------ */

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
});
const dayFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
});

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }
  return dayFormat.format(date);
}

/**
 * WhatsApp's ladder, with one extra rung that never reaches the server:
 * clock (in flight) -> tick (stored) -> double tick (fetched) -> violet double
 * tick (read).
 */
function StatusTicks({ status }: { status: ChatStatus | "pending" }) {
  if (status === "pending") {
    return (
      <Clock3
        aria-label="Sending"
        className="h-3.5 w-3.5 shrink-0 text-current opacity-60"
      />
    );
  }
  if (status === "sent") {
    return (
      <Check aria-label="Sent" className="h-3.5 w-3.5 shrink-0 opacity-70" />
    );
  }
  return (
    <CheckCheck
      aria-label={status === "seen" ? "Seen" : "Delivered"}
      className={cn(
        "h-3.5 w-3.5 shrink-0",
        // "gold-text" is violet in this design system; the accent token is the
        // same electric violet, and it reads on both bubble colours.
        status === "seen" ? "text-accent" : "opacity-70"
      )}
    />
  );
}

function AttachmentBlock({
  url,
  name,
  type,
  mine,
}: {
  url: string;
  name: string;
  type: string | null;
  mine: boolean;
}) {
  const isImage = (type || "").startsWith("image/");

  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-1 block">
        {/* A plain <img>: chat files have unknown dimensions and are one-off,
            so there is nothing for next/image's optimiser to amortise. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          loading="lazy"
          className="max-h-60 w-full rounded-lg object-cover"
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "mt-1 flex min-h-11 items-center gap-2 rounded-lg px-2.5 py-2 text-xs underline-offset-2 hover:underline",
        mine ? "bg-white/10" : "bg-background"
      )}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="truncate">{name}</span>
    </a>
  );
}

function Bubble({
  mine,
  body,
  createdAt,
  status,
  attachmentUrl,
  attachmentName,
  attachmentType,
  error,
  onRetry,
  onDiscard,
}: {
  mine: boolean;
  body: string;
  createdAt: string;
  status: ChatStatus | "pending";
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentType?: string | null;
  error?: string | null;
  onRetry?: () => void;
  onDiscard?: () => void;
}) {
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] min-w-0 rounded-2xl px-3 py-2 text-sm leading-relaxed",
          mine
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-muted text-foreground"
        )}
      >
        {attachmentUrl && (
          <AttachmentBlock
            url={attachmentUrl}
            name={attachmentName || "Attachment"}
            type={attachmentType ?? null}
            mine={mine}
          />
        )}

        {/* Rendered as a text node. Never dangerouslySetInnerHTML: this is
            untrusted input from either side of the conversation. */}
        {body && (
          <p className="whitespace-pre-wrap break-words">{body}</p>
        )}

        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1 text-[10px] tabular-nums",
            mine ? "text-primary-foreground/70" : "text-muted-foreground"
          )}
        >
          <span>{timeFormat.format(new Date(createdAt))}</span>
          {mine && <StatusTicks status={status} />}
        </div>

        {error && (
          <div className="mt-1 flex items-center gap-2 text-[11px] text-danger">
            <span className="truncate">{error}</span>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1 underline underline-offset-2 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" /> Retry
              </button>
            )}
            {onDiscard && (
              <button
                type="button"
                onClick={onDiscard}
                className="underline underline-offset-2 cursor-pointer"
              >
                Discard
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

function ChatPanel({ chat }: { chat: ChatStore }) {
  const { config } = chat;
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [attachment, setAttachment] = useState<SignedAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * The on-screen keyboard shrinks the *visual* viewport and leaves the layout
   * viewport alone, so a full-screen `inset-0` sheet ends up half-buried. On
   * phones the sheet is therefore pinned to the visual viewport instead.
   * `100dvh` is the fallback when visualViewport is unavailable.
   */
  const [sheet, setSheet] = useState<{ top: number; height: number } | null>(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setSheet({ top: vv.offsetTop, height: vv.height });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  /** Full-screen on a phone means the page behind must not scroll with it. */
  useEffect(() => {
    if (!narrow) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [narrow]);

  const messageCount = chat.messages.length + chat.outbox.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messageCount]);

  const { setOpen } = chat;
  useEffect(() => {
    // Escape closes, like every other overlay in this repo.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setOpen]);

  function growTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    // A courtesy check so the shopper gets an instant answer. The server runs
    // the same rules again and is the one that decides.
    if (file.size > config.maxBytes) {
      setNotice(
        `Files must be under ${Math.round(config.maxBytes / (1024 * 1024))} MB.`
      );
      return;
    }

    setUploading(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/chat/upload", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as Partial<SignedAttachment> & {
        error?: string;
      };
      if (!res.ok || !data.url || !data.token) {
        throw new Error(data.error || "Upload failed.");
      }
      setAttachment({
        url: data.url,
        name: data.name || file.name,
        type: data.type || file.type,
        token: data.token,
      });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    const body = draft.trim();
    if (!body && !attachment) return;
    if (body.length > config.maxLength) {
      setNotice(`Messages are limited to ${config.maxLength} characters.`);
      return;
    }
    setSending(true);
    setNotice(null);

    const payload = {
      body,
      attachment,
      name: name.trim() || undefined,
      email: email.trim() || undefined,
    };
    // Clear optimistically — the bubble is already on screen with a clock.
    setDraft("");
    setAttachment(null);
    requestAnimationFrame(growTextarea);

    await chat.send(payload);
    setSending(false);
  }

  const needsContact = !chat.signedIn && !chat.hasContact;
  const overLimit = draft.length > config.maxLength;
  const phoneHref = `tel:${config.contactPhone.replace(/[^\d+]/g, "")}`;

  /**
   * Day separators, worked out up front. Computing them with a `let` that the
   * map reassigns mutates state during render, which React Compiler rightly
   * rejects — each row only needs to compare itself with the row before it.
   */
  const rows = chat.messages.map((message, i) => {
    const label = dayLabel(message.createdAt);
    const previous = i === 0 ? null : dayLabel(chat.messages[i - 1].createdAt);
    return { message, separator: label === previous ? null : label };
  });

  const panel = (
    <div
      // On desktop this wrapper must not swallow clicks on the page behind the
      // corner card, so it stops taking pointer events and only the card does.
      className="fixed inset-0 z-[70] flex justify-end sm:pointer-events-none sm:items-end sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`Chat with ${config.brandName}`}
    >
      {/* Backdrop: phones only. On desktop the panel is a corner card and the
          page behind stays live. */}
      <button
        type="button"
        aria-label="Close chat"
        onClick={() => chat.setOpen(false)}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm sm:hidden"
      />

      <div
        style={
          narrow && sheet
            ? { top: sheet.top, height: sheet.height }
            : undefined
        }
        className={cn(
          "relative flex w-full flex-col overflow-hidden bg-card shadow-2xl",
          // Phone: full-bleed sheet, height pinned to the visual viewport.
          "absolute inset-x-0 top-0 h-[100dvh]",
          // Desktop: a 360px card that never outgrows the window.
          "sm:pointer-events-auto sm:static sm:h-[min(34rem,calc(100dvh-8rem))] sm:w-[22.5rem] sm:rounded-2xl sm:border sm:border-border",
          "animate-[fadeIn_0.15s_ease-out_both] motion-reduce:animate-none"
        )}
      >
        {/* ── Header ── */}
        <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] sm:pt-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
            <MessageCircle className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-serif text-base leading-tight">
              {config.brandName}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {chat.error
                ? chat.error
                : chat.isClosed
                  ? "Archived — send a message to reopen"
                  : "Usually replies within a few hours"}
            </p>
          </div>

          {/* Requirement: dial the store. Number comes from site settings. */}
          <a
            href={phoneHref}
            aria-label={`Call ${config.brandName} on ${config.contactPhone}`}
            title={config.contactPhone}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground transition-colors hover:bg-muted hover:text-accent"
          >
            <Phone className="h-[18px] w-[18px]" />
          </a>
          <button
            type="button"
            onClick={() => chat.setOpen(false)}
            aria-label="Close chat"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground transition-colors hover:bg-muted cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* ── Conversation ── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
          {chat.loading && chat.messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : messageCount === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <span className="eyebrow">Live chat</span>
              <p className="mt-2 font-serif text-lg">Say hello</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Sizing, an order, a return — ask us anything and we&apos;ll
                answer right here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map(({ message: m, separator }) => (
                <div key={m.id}>
                  {separator && (
                    <p className="my-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
                      {separator}
                    </p>
                  )}
                  <Bubble
                    mine={m.sender === "user"}
                    body={m.body}
                    createdAt={m.createdAt}
                    status={m.status}
                    attachmentUrl={m.attachmentUrl}
                    attachmentName={m.attachmentName}
                    attachmentType={m.attachmentType}
                  />
                </div>
              ))}
              {chat.outbox.map((o) => (
                <Bubble
                  key={o.tempId}
                  mine
                  body={o.body}
                  createdAt={o.createdAt}
                  status="pending"
                  attachmentUrl={o.attachment?.url}
                  attachmentName={o.attachment?.name}
                  attachmentType={o.attachment?.type}
                  error={o.error}
                  onRetry={() => chat.retry(o.tempId)}
                  onDiscard={() => chat.discard(o.tempId)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Composer ── */}
        <div className="border-t border-border bg-card px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
          {needsContact && (
            <div className="mb-2 grid grid-cols-2 gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (optional)"
                autoComplete="name"
                // h-11, not h-10: 44px is the tap-target floor.
                className="input h-11 text-sm"
              />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email (optional)"
                type="email"
                autoComplete="email"
                className="input h-11 text-sm"
              />
            </div>
          )}

          {attachment && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs">
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                aria-label="Remove attachment"
                className="grid h-11 w-11 -my-2 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-danger cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {notice && (
            <p className="mb-2 text-[11px] text-danger">{notice}</p>
          )}

          <div className="flex items-end gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept={config.accept}
              onChange={onPickFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Attach a file"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 cursor-pointer"
            >
              {uploading ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" />
              ) : (
                <Paperclip className="h-[18px] w-[18px]" />
              )}
            </button>

            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                growTextarea();
              }}
              onKeyDown={(e) => {
                // Enter sends on a keyboard; on a touch device Enter has to
                // stay a newline, because there is no Shift to hold.
                if (e.key !== "Enter" || e.shiftKey) return;
                if (window.matchMedia("(pointer: coarse)").matches) return;
                e.preventDefault();
                void submit();
              }}
              rows={1}
              placeholder="Write a message…"
              aria-label="Message"
              className="input min-h-11 flex-1 resize-none py-2.5 leading-snug"
            />

            <button
              type="button"
              onClick={() => void submit()}
              disabled={sending || uploading || overLimit || (!draft.trim() && !attachment)}
              aria-label="Send message"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer"
            >
              <Send className="h-[18px] w-[18px]" />
            </button>
          </div>

          <p
            className={cn(
              "mt-1 text-right text-[10px] tabular-nums",
              overLimit ? "text-danger" : "text-muted-foreground/60"
            )}
          >
            {draft.length > config.maxLength - 200
              ? `${draft.length} / ${config.maxLength}`
              : " "}
          </p>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(panel, document.body);
}

/* ------------------------------------------------------------------ */
/*  Widget (floating launcher + panel)                                 */
/* ------------------------------------------------------------------ */

export function ChatWidget() {
  const chat = useChatStore();
  const keyboardOpen = useKeyboardOpen();
  if (!chat) return null;

  return (
    <>
      {/* Conditionally rendered, never parked offscreen with a transform —
          CLAUDE.md's "Modal pattern" note. */}
      {chat.open && <ChatPanel chat={chat} />}

      {/*
        No floating launcher on purpose.
        `ChatLauncherButton` in the navbar is the single entry point — that is
        the control that replaced the theme toggle, the navbar is sticky so it
        is always reachable, and it carries the same unread badge. A second FAB
        stacked above the WhatsApp button gave two controls for one panel and
        three floating circles over the bottom tab bar on a phone.
      */}
    </>
  );
}
