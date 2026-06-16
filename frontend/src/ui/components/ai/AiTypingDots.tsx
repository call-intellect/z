"use client";

import { motion } from "motion/react";

export function AiTypingDots() {
  return (
    <div
      className="flex items-center gap-1.5 px-1 py-2"
      aria-label="Кора обрабатывает запрос"
    >
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block h-1.5 w-1.5 rounded-full bg-accent"
          animate={{ y: [0, -4, 0], opacity: [0.6, 1, 0.6] }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.08,
          }}
        />
      ))}
    </div>
  );
}
