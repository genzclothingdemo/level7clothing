"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { login } from "@/app/actions/account";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/account";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await login({ email, password });
    if (res.ok) {
      toast.success("Welcome back!");
      router.push(next);
      router.refresh();
    } else {
      setError(res.error || "Login failed");
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 sm:p-8"
    >
      <div className="mb-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted gold-text">
          <User className="h-5 w-5" />
        </span>
        <h1 className="mt-4 font-serif text-2xl">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Log in to track your orders
        </p>
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      <label className="mb-4 block">
        <span className="mb-1.5 block text-sm text-muted-foreground">Email</span>
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input"
          placeholder="you@example.com"
        />
      </label>
      <label className="mb-2 block">
        <span className="mb-1.5 block text-sm text-muted-foreground">
          Password
        </span>
        <input
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
          placeholder="••••••••"
        />
      </label>

      {/* `min-h-11` + a negative margin: the link keeps its optical position at
          the field's right edge, but the thing a thumb has to hit is a full
          44px tall instead of a 16px line of 12px text. */}
      <div className="mb-4 flex justify-end">
        <Link
          href="/account/forgot"
          className="-mr-2 -my-1 inline-flex min-h-11 items-center px-2 text-xs text-muted-foreground transition-colors hover:text-accent"
        >
          Forgot password?
        </Link>
      </div>

      <Button type="submit" disabled={loading} className="w-full" size="lg">
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Logging in…
          </>
        ) : (
          "Log in"
        )}
      </Button>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link
          href={`/account/signup${next !== "/account" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-medium text-accent hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="container-px mx-auto flex min-h-[70dvh] items-center justify-center py-10 sm:py-16">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
