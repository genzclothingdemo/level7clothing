"use client";

/**
 * The one-time code, on screen.
 *
 * Two pieces, because there are two owners of a code:
 *
 * - **`CodeField`** is presentational. Signup uses it, because there the code
 *   is checked by `signup()` itself — the account is created in the same call
 *   that validates the digits, so nothing exists to confirm against beforehand
 *   and the form has to own the value.
 * - **`VerifyContactPanel`** owns the whole exchange for a customer who is
 *   already signed in: send, type, confirm, done. Checkout and the account page
 *   both mount it, so "confirm your email" looks and behaves the same whether
 *   it is reached from an order that stopped or from the profile.
 *
 * ## The rule this file exists to keep
 *
 * **A code that could not be sent says so, here, in the box where the digits
 * would go.** `sent: false` with a `problem` is a real outcome — no SMS gateway
 * exists, or the store's email is misconfigured — and the one thing that must
 * never happen is an input sitting there implying something is on its way.
 */

import { useState } from "react";
import { Loader2, MailCheck, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmMyCode, sendMyCode } from "@/app/actions/otp";

/**
 * Six, matching `OTP_LENGTH` in `lib/otp.ts`.
 *
 * Duplicated as a literal rather than imported: that module is `server-only`,
 * so importing the constant would drag Prisma into the browser bundle. Same
 * trade the checkout modes already make.
 */
const CODE_LENGTH = 6;

/* ------------------------------------------------------------------ */
/*  The field                                                          */
/* ------------------------------------------------------------------ */

export function CodeField({
  label,
  shown,
  value,
  onChange,
  sent,
  problem,
  onResend,
  resending,
  disabled,
}: {
  label: string;
  /** Where it went — an address, or a masked number. */
  shown: string;
  value: string;
  onChange: (v: string) => void;
  /** False when nothing actually carried the code. */
  sent: boolean;
  /** Why it did not arrive. Printed, never hidden behind a tip. */
  problem?: string;
  onResend?: () => void;
  resending?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="mb-4 rounded-xl border border-border bg-muted/30 p-3">
      <label className="block">
        <span className="mb-1.5 flex items-center gap-1.5 text-sm">
          <MailCheck className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <span className="font-medium">{label}</span>
        </span>
        <p className="mb-2 text-xs text-muted-foreground">
          {sent ? (
            <>
              We sent a {CODE_LENGTH}-digit code to{" "}
              <span className="break-all font-medium text-foreground">{shown}</span>
              . It expires in 10 minutes.
            </>
          ) : (
            <>
              This store wants to confirm{" "}
              <span className="break-all font-medium text-foreground">{shown}</span>.
            </>
          )}
        </p>

        {problem && (
          <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-danger/10 px-2.5 py-2 text-xs text-danger">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{problem}</span>
          </p>
        )}

        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          disabled={disabled}
          placeholder={"".padStart(CODE_LENGTH, "0")}
          className="input text-center font-mono text-lg tracking-[0.5em]"
        />
      </label>

      {onResend && (
        <button
          type="button"
          onClick={onResend}
          disabled={resending || disabled}
          className="mt-1 inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {resending && <Loader2 className="h-3 w-3 animate-spin" />}
          Send another code
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  The self-contained panel                                           */
/* ------------------------------------------------------------------ */

export function VerifyContactPanel({
  channel,
  heading,
  reason,
  shown,
  onVerified,
}: {
  channel: "email" | "sms";
  heading: string;
  /** One sentence: what is being asked and why the customer is seeing it. */
  reason: string;
  /** The address or masked number, as the server named it. */
  shown: string;
  /** Called once the account has actually been stamped. */
  onVerified: () => void;
}) {
  const [stage, setStage] = useState<"idle" | "sent" | "done">("idle");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problem, setProblem] = useState("");

  async function send() {
    setBusy(true);
    setError("");
    setProblem("");
    const res = await sendMyCode({ channel });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setStage("sent");
    // `ok` and yet nothing was carried: say it where the digits go.
    if (!res.sent) setProblem(res.problem ?? "The code could not be sent.");
  }

  async function confirm() {
    if (code.length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit code.`);
      return;
    }
    setBusy(true);
    setError("");
    const res = await confirmMyCode({ channel, code });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setStage("done");
    toast.success(res.message);
    onVerified();
  }

  if (stage === "done") {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-success/40 bg-success/10 p-3 text-sm text-success">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          {channel === "sms" ? "Mobile number" : "Email address"} confirmed. You
          can place your order now.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-accent/40 bg-accent/5 p-3 sm:p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <ShieldCheck className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        {heading}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{reason}</p>

      {error && (
        <p className="mt-2 rounded-lg bg-danger/10 px-2.5 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {stage === "idle" ? (
        <Button
          type="button"
          className="mt-3"
          size="sm"
          disabled={busy}
          onClick={send}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Send me a code
        </Button>
      ) : (
        <div className="mt-3">
          <CodeField
            label={channel === "sms" ? "Enter the code we texted" : "Enter the code we emailed"}
            shown={shown}
            value={code}
            onChange={setCode}
            sent={!problem}
            problem={problem || undefined}
            onResend={send}
            resending={busy}
            disabled={busy}
          />
          <Button type="button" size="sm" disabled={busy} onClick={confirm}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm
          </Button>
        </div>
      )}
    </div>
  );
}
