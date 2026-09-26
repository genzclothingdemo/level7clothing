"use client";

/**
 * Forgot password — **type either one**, the link always goes to an email.
 *
 * The number is the identity and the email is the only channel that exists, so
 * the two are not alternatives in the way they look: a mobile number identifies
 * the account, and the reset link then goes to whatever address that account
 * carries. The success line names that address masked (`d••••@gmail.com`) so
 * "nothing arrived" is something the customer can act on.
 *
 * ## The ambiguous case
 *
 * Email stopped being unique, so one address can now reach several accounts.
 * That is not an error and it is not guessed at: the form comes back asking for
 * the mobile number of the one they mean, listing the masked numbers it is
 * choosing between. Never a full number — enough to recognise your own, useless
 * to somebody typing addresses in to see who shops here.
 */

import { useState } from "react";
import Link from "next/link";
import { Loader2, KeyRound, MailCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestPasswordReset } from "@/app/actions/account";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  /** Masked numbers to choose between — set only in the ambiguous case. */
  const [choices, setChoices] = useState<string[] | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await requestPasswordReset({ identifier });
    setLoading(false);

    if (!res.ok) {
      setError(res.error || "Something went wrong");
      return;
    }
    if ("ambiguous" in res && res.ambiguous) {
      setChoices(res.choices);
      setMessage(res.message);
      // The field becomes a mobile field. Clearing it is the point: the email
      // they typed is exactly what could not answer the question.
      setIdentifier("");
      return;
    }
    setChoices(null);
    setDone(true);
    setMessage(res.message);
  }

  return (
    <div className="container-px mx-auto flex min-h-[70dvh] items-center justify-center py-10 sm:py-16">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 sm:p-8">
        {done ? (
          <div className="text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success/10 text-success">
              <MailCheck className="h-5 w-5" />
            </span>
            <h1 className="mt-4 font-serif text-2xl">Check your email</h1>
            <p className="mt-2 text-sm text-muted-foreground">{message}</p>
            <Link
              href="/account/login"
              className="mt-6 inline-block text-sm font-medium text-accent hover:underline"
            >
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="mb-6 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted gold-text">
                {choices ? (
                  <Users className="h-5 w-5" />
                ) : (
                  <KeyRound className="h-5 w-5" />
                )}
              </span>
              <h1 className="mt-4 font-serif text-2xl">
                {choices ? "Which account?" : "Forgot password?"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {choices
                  ? "That email is on more than one account"
                  : "Enter your mobile number or email and we'll send a reset link"}
              </p>
            </div>

            {choices && (
              <div className="mb-4 rounded-xl bg-muted px-4 py-3 text-xs leading-relaxed">
                <p>{message}</p>
                <ul className="mt-2 space-y-0.5 font-mono">
                  {choices.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {error && (
              <p className="mb-4 rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger">
                {error}
              </p>
            )}

            <label className="mb-6 block">
              <span className="mb-1.5 block text-sm text-muted-foreground">
                {choices ? "Mobile number" : "Mobile number or email"}
              </span>
              <input
                required
                type={choices ? "tel" : "text"}
                inputMode={choices ? "numeric" : "text"}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="input"
                placeholder={choices ? "98765 43210" : "98765 43210 or you@example.com"}
              />
            </label>

            <Button type="submit" disabled={loading} className="w-full" size="lg">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                </>
              ) : (
                "Send reset link"
              )}
            </Button>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              <Link
                href="/account/login"
                className="font-medium text-accent hover:underline"
              >
                Back to login
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
