"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Clock3,
  FileText,
  Loader2,
  Mail,
  MessagesSquare,
  Paperclip,
  Phone,
  Send,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatThreadActions } from "@/components/admin/message-actions";
import type {
  AdminThreadDTO,
  ChatAttachment,
  ChatMessageDTO,
  ChatStatus,
} from "@/lib/chat";

/**
 * The store's side of the conversation — replaces the read-only contact-form
 * inbox that used to live at /admin/messages.
 *
 * Two lists, one poll each: the thread list refreshes slowly (10s) because a
 * new conversation is not urgent, while the open conversation refreshes at 5s.
 * Both back off hard when the tab is hidden and both send the newest message
 * they already hold, so a quiet inbox costs almost nothing to keep open all
 * day.
 */

type SignedAttachment = ChatAttachment & { token: string };

type Outbound = {
  tempId: string;
  body: string;
  attachment: SignedAttachment | null;
  createdAt: string;
  error: string | null;
};

const THREADS_VISIBLE_MS = 10_000;
const THREADS_HIDDEN_MS = 45_000;
const MESSAGES_VISIBLE_MS = 5_000;
const MESSAGES_HIDDEN_MS = 30_000;

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
});

function shortAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return dateFormat.format(new Date(iso));
}

function threadTitle(t: AdminThreadDTO): string {
  return t.name?.trim() || t.email?.trim() || "Guest visitor";
}

function StatusTicks({ status }: { status: ChatStatus | "pending" }) {
  if (status === "pending") {
    return <Clock3 aria-label="Sending" className="h-3.5 w-3.5 opacity-60" />;
  }
  if (status === "sent") {
    return <Check aria-label="Sent" className="h-3.5 w-3.5 opacity-70" />;
  }
  return (
    <CheckCheck
      aria-label={status === "seen" ? "Seen" : "Delivered"}
      className={cn("h-3.5 w-3.5", status === "seen" ? "text-accent" : "opacity-70")}
    />
  );
}

function Attachment({
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
  if ((type || "").startsWith("image/")) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-1 block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          loading="lazy"
          className="max-h-56 w-full rounded-lg object-cover"
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
        "mt-1 flex min-h-11 items-center gap-2 rounded-lg px-2.5 py-2 text-xs hover:underline",
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
}: {
  mine: boolean;
  body: string;
  createdAt: string;
  status: ChatStatus | "pending";
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentType?: string | null;
  error?: string | null;
}) {
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] min-w-0 rounded-2xl px-3 py-2 text-sm leading-relaxed",
          mine
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-muted text-foreground"
        )}
      >
        {attachmentUrl && (
          <Attachment
            url={attachmentUrl}
            name={attachmentName || "Attachment"}
            type={attachmentType ?? null}
            mine={mine}
          />
        )}
        {/* Text node only — a customer's message is untrusted input. */}
        {body && <p className="whitespace-pre-wrap break-words">{body}</p>}
        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1 text-[10px] tabular-nums",
            mine ? "text-primary-foreground/70" : "text-muted-foreground"
          )}
        >
          <span>{timeFormat.format(new Date(createdAt))}</span>
          {mine && <StatusTicks status={status} />}
        </div>
        {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
      </div>
    </div>
  );
}

export function ChatInbox({
  maxLength,
  maxBytes,
  accept,
}: {
  maxLength: number;
  maxBytes: number;
  accept: string;
}) {
  const [threads, setThreads] = useState<AdminThreadDTO[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [outbox, setOutbox] = useState<Outbound[]>([]);

  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<SignedAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessageDTO[]>([]);
  const activeRef = useRef<string | null>(null);

  const active = threads.find((t) => t.id === activeId) ?? null;

  /* ---------------- thread list ---------------- */

  const loadThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/admin", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { threads: AdminThreadDTO[] };
      setThreads(data.threads);
    } catch {
      /* transient — the next tick tries again */
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      await loadThreads();
      if (cancelled) return;
      timer = setTimeout(
        tick,
        document.visibilityState === "visible"
          ? THREADS_VISIBLE_MS
          : THREADS_HIDDEN_MS
      );
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
  }, [loadThreads]);

  /* ---------------- open conversation ---------------- */

  const commit = useCallback(
    (incoming: ChatMessageDTO[], statuses: { id: string; status: ChatStatus }[]) => {
      const byId = new Map(messagesRef.current.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      for (const p of statuses) {
        const existing = byId.get(p.id);
        if (existing && existing.status !== p.status) {
          byId.set(p.id, { ...existing, status: p.status });
        }
      }
      const merged = [...byId.values()].sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
      messagesRef.current = merged;
      setMessages(merged);
    },
    []
  );

  const pollMessages = useCallback(
    async (threadId: string, opts: { seen?: boolean } = {}) => {
      const last = messagesRef.current[messagesRef.current.length - 1];
      const qs = new URLSearchParams({ threadId });
      if (last) {
        qs.set("afterAt", last.createdAt);
        qs.set("afterId", last.id);
      }
      if (opts.seen) qs.set("seen", "1");
      try {
        const res = await fetch(`/api/chat/admin?${qs.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          messages: ChatMessageDTO[];
          statuses: { id: string; status: ChatStatus }[];
          unread: number;
        };
        // A late response from the thread we just navigated away from must not
        // be merged into the one now on screen.
        if (activeRef.current !== threadId) return;
        commit(data.messages, data.statuses);
        if (data.unread === 0) {
          setThreads((list) =>
            list.map((t) => (t.id === threadId ? { ...t, adminUnread: 0 } : t))
          );
        }
      } catch {
        /* transient */
      }
    },
    [commit]
  );

  /** Switching threads resets the cursor, the draft and the composer. */
  function openThread(id: string | null) {
    activeRef.current = id;
    messagesRef.current = [];
    setActiveId(id);
    setMessages([]);
    setOutbox([]);
    setDraft("");
    setAttachment(null);
    setNotice(null);
    setLoadingMessages(Boolean(id));
  }

  useEffect(() => {
    if (!activeId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const visible = document.visibilityState === "visible";
      // "seen" only when the admin can actually see the panel.
      await pollMessages(activeId, { seen: visible });
      if (cancelled) return;
      setLoadingMessages(false);
      timer = setTimeout(tick, visible ? MESSAGES_VISIBLE_MS : MESSAGES_HIDDEN_MS);
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
  }, [activeId, pollMessages]);

  const messageCount = messages.length + outbox.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messageCount, activeId]);

  /* ---------------- composing ---------------- */

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > maxBytes) {
      setNotice(`Files must be under ${Math.round(maxBytes / (1024 * 1024))} MB.`);
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

  async function reply() {
    if (!activeId) return;
    const body = draft.trim();
    if (!body && !attachment) return;
    if (body.length > maxLength) {
      setNotice(`Replies are limited to ${maxLength} characters.`);
      return;
    }

    const item: Outbound = {
      tempId: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      body,
      attachment,
      createdAt: new Date().toISOString(),
      error: null,
    };
    setOutbox((list) => [...list, item]);
    setDraft("");
    setAttachment(null);
    setNotice(null);
    setSending(true);

    try {
      const res = await fetch("/api/chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: activeId,
          body: item.body,
          attachment: item.attachment,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: ChatMessageDTO;
        error?: string;
      };
      if (!res.ok || !data.message) throw new Error(data.error || "Reply not sent.");
      commit([data.message], []);
      setOutbox((list) => list.filter((o) => o.tempId !== item.tempId));
      // Sending is reading: clear this thread's badge and float it to the top.
      setThreads((list) =>
        list.map((t) =>
          t.id === activeId
            ? {
                ...t,
                adminUnread: 0,
                isClosed: false,
                lastMessage: item.body || `Attachment: ${item.attachment?.name ?? ""}`,
                lastMessageAt: data.message!.createdAt,
              }
            : t
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Reply not sent.";
      setOutbox((list) =>
        list.map((o) => (o.tempId === item.tempId ? { ...o, error: message } : o))
      );
    } finally {
      setSending(false);
    }
  }

  const totalUnread = threads.reduce((n, t) => n + t.adminUnread, 0);

  /* ---------------- render ---------------- */

  return (
    <div className="grid h-full min-h-0 overflow-hidden rounded-2xl border border-border bg-card lg:grid-cols-[19rem_1fr]">
      {/* ── Thread list. Collapses away on phones once a thread is open. ── */}
      <aside
        className={cn(
          "min-h-0 flex-col border-border lg:flex lg:border-r",
          activeId ? "hidden lg:flex" : "flex"
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="eyebrow">Conversations</span>
          {totalUnread > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-medium text-accent-foreground">
              {totalUnread}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingThreads ? (
            <div className="grid h-32 place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : threads.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <MessagesSquare className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                No conversations yet. They start when a shopper opens the chat
                on the storefront.
              </p>
            </div>
          ) : (
            <ul>
              {threads.map((t) => {
                const selected = t.id === activeId;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => openThread(t.id)}
                      className={cn(
                        "flex w-full min-h-[3.75rem] items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors cursor-pointer",
                        selected ? "bg-accent/10" : "hover:bg-muted"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "truncate text-sm",
                              t.adminUnread > 0 ? "font-semibold" : "font-medium"
                            )}
                          >
                            {threadTitle(t)}
                          </span>
                          {t.isClosed && (
                            <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              Archived
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {t.lastMessage || "No messages yet"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {shortAgo(t.lastMessageAt)}
                        </span>
                        {t.adminUnread > 0 && (
                          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-medium text-accent-foreground">
                            {t.adminUnread}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* ── Conversation ── */}
      <section
        className={cn(
          "min-h-0 flex-col lg:flex",
          activeId ? "flex" : "hidden lg:flex"
        )}
      >
        {!active ? (
          <div className="grid flex-1 place-items-center px-6 text-center">
            <div>
              <MessagesSquare className="mx-auto h-9 w-9 text-muted-foreground" />
              <p className="mt-3 font-serif text-lg">Pick a conversation</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Replies land in the shopper&apos;s chat panel straight away.
              </p>
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <button
                type="button"
                onClick={() => openThread(null)}
                aria-label="Back to conversations"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-muted lg:hidden cursor-pointer"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {threadTitle(active)}
                  {active.registered && (
                    <span className="ml-2 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-success">
                      Account
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                  {active.email && (
                    <a
                      href={`mailto:${active.email}`}
                      className="inline-flex items-center gap-1 hover:text-accent"
                    >
                      <Mail className="h-3 w-3" />
                      <span className="truncate">{active.email}</span>
                    </a>
                  )}
                  {active.phone && (
                    <a
                      href={`tel:${active.phone}`}
                      className="inline-flex items-center gap-1 hover:text-accent"
                    >
                      <Phone className="h-3 w-3" /> {active.phone}
                    </a>
                  )}
                </div>
              </div>

              <ChatThreadActions
                threadId={active.id}
                isClosed={active.isClosed}
                onClosedChange={(closed) =>
                  setThreads((list) =>
                    list.map((t) =>
                      t.id === active.id ? { ...t, isClosed: closed } : t
                    )
                  )
                }
                onDeleted={() => {
                  setThreads((list) => list.filter((t) => t.id !== active.id));
                  openThread(null);
                }}
              />
            </header>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {loadingMessages && messages.length === 0 ? (
                <div className="grid h-full place-items-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : messageCount === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No messages in this conversation.
                </p>
              ) : (
                <div className="space-y-2">
                  {messages.map((m) => (
                    <Bubble
                      key={m.id}
                      mine={m.sender === "admin"}
                      body={m.body}
                      createdAt={m.createdAt}
                      status={m.status}
                      attachmentUrl={m.attachmentUrl}
                      attachmentName={m.attachmentName}
                      attachmentType={m.attachmentType}
                    />
                  ))}
                  {outbox.map((o) => (
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
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-border px-3 py-2.5">
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
              {notice && <p className="mb-2 text-[11px] text-danger">{notice}</p>}

              <div className="flex items-end gap-1.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept={accept}
                  onChange={onPickFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  aria-label="Attach a file"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 cursor-pointer"
                >
                  {uploading ? (
                    <Loader2 className="h-[18px] w-[18px] animate-spin" />
                  ) : (
                    <Paperclip className="h-[18px] w-[18px]" />
                  )}
                </button>

                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.shiftKey) return;
                    if (window.matchMedia("(pointer: coarse)").matches) return;
                    e.preventDefault();
                    void reply();
                  }}
                  rows={1}
                  placeholder="Write a reply…"
                  aria-label="Reply"
                  className="input min-h-11 max-h-32 flex-1 resize-y py-2.5 leading-snug"
                />

                <button
                  type="button"
                  onClick={() => void reply()}
                  disabled={
                    sending || uploading || (!draft.trim() && !attachment)
                  }
                  aria-label="Send reply"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 cursor-pointer"
                >
                  <Send className="h-[18px] w-[18px]" />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
