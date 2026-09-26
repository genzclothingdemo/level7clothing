"use client";

/**
 * Create an account: name, mobile, email, password — **all four required**.
 *
 * The mobile is the identity, so it is the second field and it is not
 * optional. The `+91` is a fixed affix rather than a country picker: this store
 * ships inside India and NimbusPost only quotes Indian pincodes, so offering a
 * choice would be offering something the store cannot honour.
 *
 * ## Two answers that are not errors
 *
 * The form has two states that look like failures and are not, and keeping them
 * apart is most of this file:
 *
 * - **The email is already on another account.** A warning, in amber, naming
 *   the masked number it belongs to. The button becomes "Create account
 *   anyway" and the next press goes through. Email is contact information, not
 *   identity; two people may share one inbox.
 * - **A code is wanted.** The store can ask for an emailed code before the
 *   account exists. The form keeps everything typed and resubmits with the
 *   digits, so nothing half-made is ever written.
 *
 * Only a taken *mobile* is a wall, and it offers both ways out — sign in, or
 * reset the password.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeField } from "@/components/store/auth-code-panel";
import { signup, type SignupPrompt } from "@/app/actions/account";
import { resendSignupCode } from "@/app/actions/otp";

/** The fixed prefix. Mirrors `PHONE_PREFIX` in lib/phone.ts. */
const PREFIX = "+91";

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/account";

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /** Amber, not red: the email is in use and they may carry on anyway. */
  const [emailWarning, setEmailWarning] = useState("");
  /** True once they have accepted that warning — sent on every later submit. */
  const [emailOk, setEmailOk] = useState(false);
  /** Taken number: the one hard stop, and it gets its own way out. */
  const [numberTaken, setNumberTaken] = useState(false);

  const [prompt, setPrompt] = useState<SignupPrompt | null>(null);
  const [emailCode, setEmailCode] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [resending, setResending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNumberTaken(false);

    const res = await signup({
      name,
      phone,
      email,
      password,
      emailAcknowledged: emailOk,
      emailCode: emailCode || undefined,
      phoneCode: phoneCode || undefined,
    });

    if (res.ok) {
      toast.success("Account created 🎉");
      // A phone code was asked for and there is no way to send one. The account
      // exists; saying nothing would leave them thinking it was confirmed.
      if (res.notice) toast.warning(res.notice, { duration: 12000 });
      router.push(next);
      router.refresh();
      return;
    }

    setLoading(false);

    if ("emailInUse" in res && res.emailInUse) {
      setEmailWarning(res.error);
      // The next press is the acknowledgement — nothing else changes.
      setEmailOk(true);
      return;
    }
    if ("phoneTaken" in res && res.phoneTaken) {
      setNumberTaken(true);
      setError(res.error);
      return;
    }
    if ("verify" in res && res.verify) {
      setPrompt(res.verify);
      setError(res.error ?? "");
      return;
    }
    setError(res.error || "Sign up failed");
  }

  async function resend(channel: "email" | "sms") {
    setResending(true);
    const res = await resendSignupCode({
      channel,
      target: channel === "sms" ? phone : email,
    });
    setResending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setPrompt((p) => ({
      ...p,
      [channel === "sms" ? "phone" : "email"]: {
        shown: res.shown,
        sent: res.sent,
        problem: res.problem,
      },
    }));
    if (res.sent) toast.success(`Code sent to ${res.shown}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 sm:p-8"
    >
      <div className="mb-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted gold-text">
          <Sparkles className="h-5 w-5" />
        </span>
        <h1 className="mt-4 font-serif text-2xl">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your mobile number is how you sign in
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger">
          <p>{error}</p>
          {numberTaken && (
            <p className="mt-1.5 flex flex-wrap gap-x-3">
              <Link href="/account/login" className="font-medium underline">
                Log in
              </Link>
              <Link href="/account/forgot" className="font-medium underline">
                Reset your password
              </Link>
            </p>
          )}
        </div>
      )}

      <label className="mb-4 block">
        <span className="mb-1.5 block text-sm text-muted-foreground">
          Full name
        </span>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
          placeholder="Your name"
          autoComplete="name"
        />
      </label>

      {/* Mobile — the identity. The prefix is a static affix inside the field's
          own border, so the input still looks like one control. */}
      <label className="mb-4 block">
        <span className="mb-1.5 block text-sm text-muted-foreground">
          Mobile number
        </span>
        <div className="flex items-stretch gap-2">
          <span className="inline-flex h-11 shrink-0 items-center rounded-lg border border-border bg-muted px-3 text-sm text-muted-foreground">
            {PREFIX}
          </span>
          <input
            required
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={10}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
            className="input"
            placeholder="98765 43210"
          />
        </div>
      </label>

      <div className="mb-4">
        <label className="block">
          <span className="mb-1.5 block text-sm text-muted-foreground">Email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              // A different address is a different question — drop the old
              // warning rather than leaving it pointing at an address they have
              // since changed.
              setEmailWarning("");
              setEmailOk(false);
            }}
            className="input"
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>
        {/* Amber, and the same orange the admin badges use — this is not an
            error and must not be red. */}
        {emailWarning && (
          <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-orange-500/10 px-3 py-2.5 text-xs leading-relaxed text-orange-700 dark:text-orange-300">
            <TriangleAlert
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>{emailWarning}</span>
          </p>
        )}
      </div>

      <label className="mb-6 block">
        <span className="mb-1.5 block text-sm text-muted-foreground">
          Password
        </span>
        <input
          required
          type="password"
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
          placeholder="At least 6 characters"
          autoComplete="new-password"
        />
      </label>

      {/* ---- Codes, when the store asks for them ---- */}
      {prompt?.email && (
        <CodeField
          label="Confirm your email"
          shown={prompt.email.shown}
          value={emailCode}
          onChange={setEmailCode}
          sent={prompt.email.sent}
          problem={prompt.email.problem}
          onResend={() => resend("email")}
          resending={resending}
          disabled={loading}
        />
      )}
      {prompt?.phone && (
        <CodeField
          label="Confirm your mobile"
          shown={prompt.phone.shown}
          value={phoneCode}
          onChange={setPhoneCode}
          sent={prompt.phone.sent}
          problem={prompt.phone.problem}
          onResend={() => resend("sms")}
          resending={resending}
          disabled={loading}
        />
      )}

      <Button type="submit" disabled={loading} className="w-full" size="lg">
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Creating…
          </>
        ) : prompt ? (
          "Confirm & create account"
        ) : emailWarning ? (
          "Create account anyway"
        ) : (
          "Create account"
        )}
      </Button>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={`/account/login${next !== "/account" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-medium text-accent hover:underline"
        >
          Log in
        </Link>
      </p>
    </form>
  );
}

export default function SignupPage() {
  return (
    <div className="container-px mx-auto flex min-h-[70dvh] items-center justify-center py-10 sm:py-16">
      <Suspense>
        <SignupForm />
      </Suspense>
    </div>
  );
}
