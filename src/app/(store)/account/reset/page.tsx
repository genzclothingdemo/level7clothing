"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resetPassword } from "@/app/actions/account";

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    setError("");
    const res = await resetPassword({ token, password });
    if (res.ok) {
      toast.success("Password updated — you're logged in");
      router.push("/account");
      router.refresh();
    } else {
      setError(res.error || "Reset failed");
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
          <KeyRound className="h-5 w-5" />
        </span>
        <h1 className="mt-4 font-serif text-2xl">Set a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a new password for your account
        </p>
      </div>

      {!token && (
        <p className="mb-4 rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger">
          This reset link is missing its token. Please use the link from your
          email, or{" "}
          <Link href="/account/forgot" className="underline">
            request a new one
          </Link>
          .
        </p>
      )}
      {error && (
        <p className="mb-4 rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      <label className="mb-4 block">
        <span className="mb-1.5 block text-sm text-muted-foreground">
          New password
        </span>
        <input
          required
          type="password"
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
          placeholder="At least 6 characters"
        />
      </label>
      <label className="mb-6 block">
        <span className="mb-1.5 block text-sm text-muted-foreground">
          Confirm password
        </span>
        <input
          required
          type="password"
          minLength={6}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="input"
          placeholder="Re-enter password"
        />
      </label>

      <Button
        type="submit"
        disabled={loading || !token}
        className="w-full"
        size="lg"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Updating…
          </>
        ) : (
          "Update password"
        )}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="container-px mx-auto flex min-h-[70vh] items-center justify-center py-16">
      <Suspense>
        <ResetForm />
      </Suspense>
    </div>
  );
}
