"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { subscribeToNewsletter } from "@/app/actions/newsletter";

export function NewsletterForm({
  source = "footer",
  className,
}: {
  source?: string;
  className?: string;
}) {
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await subscribeToNewsletter({ email, source });
    setSaving(false);
    if (res.ok) {
      setDone(true);
      setEmail("");
      toast.success("You're on the list! Watch out for early drops.");
    } else {
      toast.error(res.error);
    }
  }

  if (done) {
    return (
      <p className={`flex items-center gap-2 text-sm text-success ${className ?? ""}`}>
        <Check className="h-4 w-4" /> You&apos;re subscribed — welcome to the club.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className={`flex flex-col gap-2 sm:flex-row ${className ?? ""}`}>
      <label className="relative flex-1">
        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-label="Email address"
          className="input pl-9"
        />
      </label>
      <Button type="submit" disabled={saving} className="sm:w-auto">
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Joining…
          </>
        ) : (
          "Join the club"
        )}
      </Button>
    </form>
  );
}
