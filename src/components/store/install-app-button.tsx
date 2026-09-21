"use client";

import { useEffect, useState } from "react";

/**
 * The `beforeinstallprompt` event, which is Chromium-only and therefore not in
 * the DOM lib's type definitions.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * "Install app" CTA.
 *
 * Renders nothing unless the browser actually offers installation — showing a
 * dead button to everyone on iOS Safari and desktop Firefox (neither fires
 * `beforeinstallprompt`) would be worse than showing nothing. It also hides
 * itself once the app is already installed and running standalone.
 */
export function InstallAppButton({ className = "" }: { className?: string }) {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Already running as an installed app — nothing to offer.
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
      return;
    }

    const onPrompt = (e: Event) => {
      // Stop Chrome's own mini-infobar so this button is the single entry point.
      e.preventDefault();
      setPromptEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || !promptEvent) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        // The event is single-use; a dismissed prompt cannot be replayed, so
        // drop the button rather than leaving one that silently does nothing.
        if (outcome === "dismissed" || outcome === "accepted") setPromptEvent(null);
      }}
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-current px-5 text-[11px] font-semibold uppercase tracking-[0.16em] transition-colors hover:bg-accent hover:border-accent hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
      Install app
    </button>
  );
}
