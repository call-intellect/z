"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  CheckCheck,
  FileCheck2,
  Lightbulb,
  ListChecks,
  MessageSquareText,
} from "lucide-react";

import type { DirectorDashboardValueStripDomain } from "@/domain/director-dashboard";
import { CHART, GRAD } from "@/ui/components/dashboard/modern";

type ValueCell = {
  key: string;
  icon: ReactNode;
  grad: string;
  tone: string;
  label: string;
  value: number;
  href: string;
};

export function PeriodValue({
  data,
}: {
  data: DirectorDashboardValueStripDomain;
}) {
  const cells: ValueCell[] = [
    {
      key: "meetings",
      icon: <FileCheck2 size={17} />,
      grad: GRAD.violet,
      tone: CHART.violet,
      label: "Встреч запротоколировано",
      value: data.meetingsProtocoled,
      href: "/meetings",
    },
    {
      key: "tasks-extracted",
      icon: <ListChecks size={17} />,
      grad: GRAD.teal,
      tone: CHART.teal,
      label: "Задач извлечено",
      value: data.tasksExtracted,
      href: "/tasks",
    },
    {
      key: "tasks-resolved",
      icon: <CheckCheck size={17} />,
      grad: GRAD.blue,
      tone: CHART.blue,
      label: "Задач решено",
      value: data.tasksResolved,
      href: "/tasks",
    },
    {
      key: "answered",
      icon: <MessageSquareText size={17} />,
      grad: GRAD.pink,
      tone: CHART.pink,
      label: "Ответов из памяти",
      value: data.questionsAnsweredByMemory,
      href: "/memory",
    },
    {
      key: "ideas",
      icon: <Lightbulb size={17} />,
      grad: GRAD.amber,
      tone: CHART.amber,
      label: "Идей собрано",
      value: data.ideasCollected,
      href: "/ideas",
    },
  ];

  return (
    <section>
      <div className="mb-3 flex items-center gap-2.5">
        <h3
          className="text-[15px] font-semibold"
          style={{ color: CHART.text }}
        >
          Польза Коры за период
        </h3>
        <span className="text-[13px] font-medium" style={{ color: CHART.faint }}>
          · за неделю
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cells.map((cell) => (
          <Link
            key={cell.key}
            href={cell.href}
            aria-label={`${cell.label}: ${cell.value} — открыть источник`}
            className="block cursor-pointer rounded-2xl p-4 transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ background: "var(--surface-inset)" }}
          >
            <div
              className="grid h-9 w-9 place-items-center rounded-xl"
              style={{
                background: cell.grad,
                color: CHART.text,
                boxShadow: `0 10px 24px -12px ${cell.tone}`,
              }}
            >
              {cell.icon}
            </div>
            <div
              className="mt-3 text-[26px] font-semibold leading-none tracking-tight tabular-nums"
              style={{ color: CHART.text }}
            >
              {cell.value}
            </div>
            <div className="mt-1.5 text-[12px]" style={{ color: CHART.dim }}>
              {cell.label}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
