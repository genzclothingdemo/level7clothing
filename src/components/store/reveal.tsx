"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Scroll-in reveal: a short fade with a small rise. Deliberately no blur —
 * blur-in reads as an effect, and it also forces the browser to rasterise the
 * whole subtree, which softened product photography on entry.
 */
export function Reveal({
  children,
  delay = 0,
  y = 14,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
