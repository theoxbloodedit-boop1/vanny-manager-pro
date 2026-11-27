"use client";

import { motion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

/**
 * ADR-0026 — Système d'animations (style SaaS US).
 *
 * Des apparitions fluides au scroll (fade + lift), un stagger pour les
 * grilles de cartes, et un hover lift sur les surfaces. Discrets mais
 * perceptibles : le SaaS paraît vivant, sans être lourd.
 */

/** Variantes par défaut — fade + translation vers le haut. */
const FADE_UP: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
  },
};

/** Variantes d'apparition pure (fade sans déplacement). */
const FADE: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.5, ease: "easeOut" } },
};

interface RevealProps {
  children: ReactNode;
  delay?: number;
  variant?: "fade-up" | "fade";
  as?: "div" | "section" | "li" | "span";
  className?: string;
}

/**
 * Composant d'apparition au scroll. S'affiche quand il entre dans la
 * viewport (whileInView) — parfait pour les sections et les cartes.
 */
export function Reveal({
  children,
  delay = 0,
  variant = "fade-up",
  as = "div",
  className,
}: RevealProps) {
  const MotionTag = motion[as];
  const variants = variant === "fade" ? FADE : FADE_UP;
  return (
    <MotionTag
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.15 }}
      transition={{ delay }}
    >
      {children}
    </MotionTag>
  );
}

/**
 * Conteneur de stagger : les enfants (Reveal) apparaissent en cascade.
 * Utiliser avec <Reveal staggerChild /> à l'intérieur.
 */
const STAGGER: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

export function StaggerGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={STAGGER}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.1 }}
    >
      {children}
    </motion.div>
  );
}

/** Effet de survol sur une surface (carte, bouton). */
export const HOVER_LIFTE = {
  whileHover: { y: -3 },
  transition: { type: "spring", stiffness: 400, damping: 22 },
} as const;

/** Variante de carte qui s'anime au hover (lift + ombre accentuée). */
export const CARD_HOVER: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
  hover: {
    y: -4,
    boxShadow: "0 12px 32px rgb(11 18 32 / 0.14), 0 4px 10px rgb(11 18 32 / 0.08)",
    transition: { type: "spring", stiffness: 400, damping: 22 },
  },
};
