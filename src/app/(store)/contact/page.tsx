"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, Phone, MapPin, Send, CheckCircle2 } from "lucide-react";
import { useSettings } from "@/context/settings";
import { Button } from "@/components/ui/button";
import { submitContact } from "@/app/actions/contact";

export default function ContactPage() {
  const s = useSettings();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
  });

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await submitContact(form);
    setLoading(false);
    if (res.ok) {
      setDone(true);
      toast.success("Message sent! We'll be in touch soon.");
      setForm({ name: "", email: "", phone: "", subject: "", message: "" });
    } else {
      toast.error(res.error || "Something went wrong");
    }
  }

  return (
    <div className="container-px mx-auto max-w-6xl py-16">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Say hello
        </p>
        <h1 className="mt-3 font-serif text-5xl">Get in touch</h1>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Questions, custom commissions or bulk orders — we&apos;d love to hear
          from you.
        </p>
      </div>

      <div className="mt-14 grid gap-10 lg:grid-cols-[1fr_1.4fr]">
        {/* Contact info */}
        <div className="space-y-4">
          <InfoCard
            icon={<Mail className="h-5 w-5" />}
            label="Email"
            value={s.contactEmail}
            href={`mailto:${s.contactEmail}`}
          />
          <InfoCard
            icon={<Phone className="h-5 w-5" />}
            label="Phone"
            value={s.contactPhone}
            href={`tel:${s.contactPhone}`}
          />
          {s.address && (
            <InfoCard
              icon={<MapPin className="h-5 w-5" />}
              label="Studio"
              value={s.address}
            />
          )}
        </div>

        {/* Form */}
        <div className="rounded-3xl border border-border bg-card p-6 md:p-8">
          {done ? (
            <div className="flex flex-col items-center py-12 text-center">
              <CheckCircle2 className="h-12 w-12 text-success" />
              <h2 className="mt-4 font-serif text-2xl">Message sent</h2>
              <p className="mt-2 text-muted-foreground">
                Thank you for reaching out. We&apos;ll reply as soon as we can.
              </p>
              <Button
                variant="outline"
                className="mt-6"
                onClick={() => setDone(false)}
              >
                Send another
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm text-muted-foreground">
                  Name *
                </span>
                <input
                  required
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  className="input"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm text-muted-foreground">
                  Email *
                </span>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  className="input"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm text-muted-foreground">
                  Phone
                </span>
                <input
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  className="input"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm text-muted-foreground">
                  Subject
                </span>
                <input
                  value={form.subject}
                  onChange={(e) => set("subject", e.target.value)}
                  className="input"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-sm text-muted-foreground">
                  Message *
                </span>
                <textarea
                  required
                  rows={5}
                  value={form.message}
                  onChange={(e) => set("message", e.target.value)}
                  className="input resize-none"
                  placeholder="Tell us what you have in mind…"
                />
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={loading} size="lg" className="w-full sm:w-auto">
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" /> Send message
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCard({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
}) {
  const inner = (
    <div className="flex items-start gap-4 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-accent">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted gold-text">
        {icon}
      </span>
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 font-medium">{value}</p>
      </div>
    </div>
  );
  return href ? <a href={href}>{inner}</a> : inner;
}
