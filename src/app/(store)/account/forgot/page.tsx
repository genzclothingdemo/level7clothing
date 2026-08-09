"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, KeyRound, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestPasswordReset } from "@/app/actions/account";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await requestPasswordReset({ email });
    setLoading(false);
    if (res.ok) {
      setDone(true);
      setMessage(res.message);
    } else {
      setMessage(res.error || "Something went wrong");
    }
  }

  return (
    <div className="container-px mx-auto flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-8">
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
                <KeyRound className="h-5 w-5" />
              </span>
              <h1 className="mt-4 font-serif text-2xl">Forgot password?</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter your email and we&apos;ll send you a reset link
              </p>
            </div>

            {message && (
              <p className="mb-4 rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger">
                {message}
              </p>
            )}

            <label className="mb-6 block">
              <span className="mb-1.5 block text-sm text-muted-foreground">
                Email
              </span>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@example.com"
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
