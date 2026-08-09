"use client";

/**
 * Store-wide page transition. Next.js remounts a template.tsx on every route
 * change, so each page glides in with a soft fade + rise instead of snapping.
 * Kept fast (0.45s) so navigation never feels sluggish, and the motion is
 * subtle enough to sit under the per-section <Reveal> animations.
 */

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export default function StoreTemplate({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
