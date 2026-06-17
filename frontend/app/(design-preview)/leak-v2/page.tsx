"use client";

import { motion } from "motion/react";
import {
  Briefcase,
  Users,
  ListChecks,
  Brain,
  FileText,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";

import { fadeIn, slideUp } from "@/ui/motion";
import { PreviewSwitcher } from "../leak-shared";

type Leak = {
  icon: LucideIcon;
  leak: string;
  fix: string;
};

const LEAKS: Leak[] = [
  {
    icon: Briefcase,
    leak: "Обещания клиентам теряются на встречах",
    fix: "Кора слышит и помнит каждое — задача появляется сама",
  },
  {
    icon: Users,
    leak: "Знания уходят вместе с сотрудниками",
    fix: "Цифровой двойник остаётся, отвечает за человека",
  },
  {
    icon: ListChecks,
    leak: "Задачи проваливаются между совещаний",
    fix: "Трекер собирает их из встреч и переписок сам",
  },
  {
    icon: Brain,
    leak: "Принимаете решения — забываете причины",
    fix: "Все решения в общей памяти со ссылкой на источник",
  },
  {
    icon: FileText,
    leak: "Совещания заканчиваются без итогов",
    fix: "AI-отчёт под тип встречи через минуту",
  },
];

export default function LeakV2Page() {
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

      <PreviewSwitcher current="v2" />

      <section className="relative z-10 mx-auto max-w-6xl px-6 py-24 md:px-10 md:py-32">
        {}
        <motion.div
          variants={fadeIn}
          initial="initial"
          animate="animate"
          className="mb-4 inline-flex items-center gap-3 text-xs font-medium uppercase tracking-[0.22em] text-accent"
        >
          <span className="h-px w-10 bg-accent" />5 дыр · 1 инструмент
        </motion.div>
        <motion.h2
          variants={slideUp}
          initial="initial"
          animate="animate"
          className="max-w-4xl text-3xl font-semibold tracking-tight md:text-5xl"
        >
          Найди дырки, через которые{" "}
          <span className="font-medium italic text-accent">
            утекает выручка
          </span>{" "}
          твоей компании. А Кора их затыкает.
        </motion.h2>
        <motion.p
          variants={slideUp}
          initial="initial"
          animate="animate"
          transition={{ delay: 0.05 }}
          className="mt-5 max-w-2xl text-lg text-fg-secondary"
        >
          Пять источников потерь в любой команде. Под каждый — конкретный
          инструмент, который её закрывает.
        </motion.p>

        {}
        <div className="mt-12 grid gap-3">
          {LEAKS.map((leak, i) => (
            <LeakRow key={leak.leak} {...leak} delay={i * 0.05} />
          ))}
        </div>
      </section>

      <aside className="relative z-10 mx-auto max-w-3xl px-6 pb-24 text-center md:px-10">
        <div className="rounded-xl border border-border-subtle bg-bg-card/40 p-6 text-sm text-fg-tertiary backdrop-blur-glass">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
            Design preview · v2
          </div>
          Вариант 2 — «дырки и заплатки». Конкретные боли привязаны к нашим
          инструментам. Сильнее убеждает, чем манифест: показывает не «что мы
          умеем», а «какую дырку затыкаем». Длиннее на ~600px по высоте.
        </div>
      </aside>
    </main>
  );
}

function LeakRow({ icon: Icon, leak, fix, delay }: Leak & { delay: number }) {
  return (
    <motion.div
      variants={slideUp}
      initial="initial"
      whileInView="animate"
      viewport={{ once: true, margin: "-50px" }}
      transition={{ delay }}
      className="grid items-center gap-4 rounded-xl border border-border-subtle bg-bg-card/40 px-5 py-5 backdrop-blur-glass transition-colors hover:border-accent-border md:grid-cols-[auto_1fr_auto_1fr] md:gap-6 md:px-7"
    >
      {}
      <div className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center">
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border border-dashed border-danger/40"
        />
        <Icon size={18} strokeWidth={1.75} className="text-danger/80" />
      </div>

      {}
      <div className="text-base font-medium text-fg-primary md:text-lg">
        {leak}
      </div>

      {}
      <ArrowRight
        size={18}
        strokeWidth={1.75}
        className="hidden text-accent md:block"
      />

      {}
      <div className="text-base leading-snug text-accent md:text-lg">{fix}</div>
    </motion.div>
  );
}
