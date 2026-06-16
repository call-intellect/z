"use client";

import { useEffect, useState } from "react";
import type { Transition, Variants } from "motion/react";

export const SPRING_DEFAULT: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 30,
};

export const SPRING_BOUNCY: Transition = {
  type: "spring",
  stiffness: 400,
  damping: 22,
};

export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

export const DURATION_FAST = 0.12;
export const DURATION_DEFAULT = 0.2;

export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: DURATION_DEFAULT, ease: EASE_OUT_EXPO },
  },
  exit: { opacity: 0, transition: { duration: DURATION_FAST } },
};

export const slideUp: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.24, ease: EASE_OUT_EXPO },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: DURATION_FAST },
  },
};
