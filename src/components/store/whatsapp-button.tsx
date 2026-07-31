"use client";

import { useSettings } from "@/context/settings";
import { useKeyboardOpen } from "@/hooks/use-keyboard-open";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413" />
    </svg>
  );
}

export function WhatsAppButton() {
  const s = useSettings();
  const keyboardOpen = useKeyboardOpen();

  if (!s.whatsapp) return null;
  const number = s.whatsapp.replace(/[^0-9]/g, "");
  if (!number) return null;
  // While typing, a floating button just covers the field being filled in.
  if (keyboardOpen) return null;

  const message = encodeURIComponent(
    `Hi ${s.brandName}, I'd love to know more about your tees and hoodies.`
  );

  // bottom-24 clears the fixed mobile tab bar; md+ has no tab bar so the
  // button drops back to the usual FAB offset.
  return (
    <a
      href={`https://wa.me/${number}?text=${message}`}
      target="_blank"
      rel="noreferrer"
      aria-label="Chat on WhatsApp"
      className="group fixed bottom-24 right-5 z-30 grid h-13 w-13 place-items-center rounded-full bg-[#25D366] text-white shadow-lg shadow-black/15 transition-colors hover:bg-[#1FB855] md:bottom-5"
    >
      {/* No perpetual ping ring — the label on hover is enough of an invitation. */}
      <WhatsAppIcon className="relative h-6 w-6" />
      <span className="pointer-events-none absolute right-15 whitespace-nowrap rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground opacity-0 shadow-lg transition-opacity duration-300 group-hover:opacity-100">
        Chat with us
      </span>
    </a>
  );
}
