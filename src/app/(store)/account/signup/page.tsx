"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signup } from "@/app/actions/account";

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/account";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signup({ name, email, password });
    if (res.ok) {
      toast.success("Account created 🎉");
      router.push(next);
      router.refresh();
    } else {
      setError(res.error || "Sign up failed");
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm rounded-3xl border border-border bg-card p-8"
    >
      <div className="mb-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted gold-text">
          <Sparkles className="h-5 w-5" />
        </span>
        <h1 className="mt-4 font-serif text-2xl">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Takes 20 seconds — just 3 details
        </p>
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
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
      <label className="mb-4 block">
        <span className="mb-1.5 block text-sm text-muted-foreground">Email</span>
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input"
          placeholder="you@example.com"
          autoComplete="email"
        />
      </label>
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

      <Button type="submit" disabled={loading} className="w-full" size="lg">
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Creating…
          </>
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
    <div className="container-px mx-auto flex min-h-[70vh] items-center justify-center py-16">
      <Suspense>
        <SignupForm />
      </Suspense>
    </div>
  );
}
