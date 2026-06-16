"use client";

import { motion } from "motion/react";

import { fadeIn, slideUp } from "@/ui/motion";
import { PreviewSwitcher } from "../leak-shared";

export default function LeakV1Page() {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-bg-base text-fg-primary">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-0"
        style={{
          background:
            "radial-gradient(circle at 18% 8%, rgba(94,234,212,0.12), transparent 55%), radial-gradient(circle at 85% 78%, rgba(94,234,212,0.07), transparent 60%)",
        }}
      />

      <PreviewSwitcher current="v1" />

      {}
      <section className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-6 py-32 text-center md:px-10 md:py-40">
        <motion.div
          variants={fadeIn}
          initial="initial"
          animate="animate"
          className="mb-8 inline-flex items-center gap-3 text-xs font-medium uppercase tracking-[0.22em] text-accent"
        >
          <span className="h-px w-10 bg-accent" />
          Главное
          <span className="h-px w-10 bg-accent" />
        </motion.div>

        <motion.h2
          variants={slideUp}
          initial="initial"
          animate="animate"
          className="max-w-5xl text-4xl font-semibold tracking-tight md:text-7xl"
        >
          Найди дырки, через которые{" "}
          <span className="font-medium italic text-accent">
            утекает выручка
          </span>{" "}
          твоей компании.
        </motion.h2>

        <motion.p
          variants={slideUp}
          initial="initial"
          animate="animate"
          transition={{ delay: 0.1 }}
          className="mt-10 max-w-3xl text-xl leading-relaxed text-fg-secondary md:text-2xl"
        >
          А Кора их затыкает — слышит каждое обещание, помнит каждое решение,
          держит каждую задачу.
        </motion.p>

        <motion.div
          variants={fadeIn}
          initial="initial"
          animate="animate"
          transition={{ delay: 0.3 }}
          className="mt-16 h-px w-24 bg-accent/40"
        />
      </section>

      <PreviewNote
        variant="v1"
        note="Вариант 1 — Манифест. Только типографика, никаких иконок и карточек. Самый лаконичный, работает за счёт ритма и веса слов. Хорошо, если хотите сохранить editorial-тон лендинга."
      />
    </main>
  );
}

function PreviewNote({ variant, note }: { variant: string; note: string }) {
  return (
    <aside className="relative z-10 mx-auto max-w-3xl px-6 pb-24 text-center md:px-10">
      <div className="rounded-xl border border-border-subtle bg-bg-card/40 p-6 text-sm text-fg-tertiary backdrop-blur-glass">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
          Design preview · {variant}
        </div>
        {note}
      </div>
    </aside>
  );
}
