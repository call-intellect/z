"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  FileCheck2,
  ListChecks,
  MessageSquareText,
} from "lucide-react";

import type { DirectorDashboardValueStripDomain } from "@/domain/director-dashboard";
import { CHART, GRAD, glass } from "@/ui/components/dashboard/modern";

type ValueCell = {
  key: string;
  icon: ReactNode;
  grad: string;
  tone: string;
  label: string;
  value: number;
  href: string;
};

export function ValueStripWidget({
  data,
}: {
  data: DirectorDashboardValueStripDomain;
}) {
  const cells: ValueCell[] = [
    {
      key: "meetings",
      icon: <FileCheck2 size={18} />,
      grad: GRAD.violet,
      tone: CHART.violet,
      label: "Встречи запротоколированы",
      value: data.meetingsProtocoled,
      href: "/meetings",
    },
    {
      key: "tasks",
      icon: <ListChecks size={18} />,
      grad: GRAD.blue,
      tone: CHART.blue,
      label: "Задачи извлечены",
      value: data.tasksExtracted,
      href: "/tasks",
    },
    {
      key: "decisions",
      icon: <CheckCircle2 size={18} />,
      grad: GRAD.teal,
      tone: CHART.teal,
      label: "Решения зафиксированы",
      value: data.decisionsExtracted,
      href: "/decisions",
    },
    {
      key: "answered",
      icon: <MessageSquareText size={18} />,
      grad: GRAD.amber,
      tone: CHART.amber,
      label: "Вопросов отвечено памятью",
      value: data.questionsAnsweredByMemory,
      href: "/memory",
    },
  ];

  return (
    <div style={glass({ borderRadius: 22 })} className="p-6">
      <h3 className="text-[15px] font-semibold" style={{ color: CHART.text }}>
        Польза за период
      </h3>
      <p className="mt-0.5 text-sm" style={{ color: CHART.dim }}>
        Рутина, которую Кора сняла с команды — твёрдые факты, не оценки.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
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
    </div>
  );
}
