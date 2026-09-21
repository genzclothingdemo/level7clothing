/**
 * Instagram glyph.
 *
 * `lucide-react` at the version pinned here does NOT export an `Instagram`
 * icon (importing one is a build error), which is why this SVG was already
 * hand-rolled inside footer.tsx and instagram-section.tsx. One shared copy
 * instead of a third.
 */
export function InstagramIcon({
  className,
  strokeWidth = 2,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}
