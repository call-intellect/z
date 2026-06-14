'use client';

import type { ReactNode } from 'react';
import {
  CheckCircle2,
  FileCheck2,
  HandshakeIcon,
  ListChecks,
  MessageSquareText,
} from 'lucide-react';

import type { DirectorDashboardValueStripDomain } from '@/domain/director-dashboard';
import { CHART, GRAD, glass } from '@/ui/components/dashboard/modern';

/**
 * ТЗ-2 Ф1 — «Полоса пользы» (Value Strip): первая строка главной директора.
 *
 * 5 твёрдых счётчиков снятой Корой рутины за период. Это НЕ мягкие оценки и
 * НЕ тренды — только факт «сколько работы Кора сделала». Поэтому здесь нет
 * дельта-плашек и спарклайнов (их нет в данных — фабриковать тренд нельзя).
 * Всё-ноль — валидное состояние («0 за период»), рисуем как есть.
 *
 * Современный визуальный язык: одна стеклянная карточка с 5 ячейками,
 * у каждой — градиентная иконка, крупное число и подпись. Токены из `modern/`.
 */

type ValueCell = {
  key: string;
  icon: ReactNode;
  grad: string;
  /** Тень-свечение под иконкой (тон из палитры графиков). */
  tone: string;
  label: string;
  value: number;
};

export function ValueStripWidget({
  data,
}: {
  data: DirectorDashboardValueStripDomain;
}) {
  const cells: ValueCell[] = [
    {
      key: 'meetings',
      icon: <FileCheck2 size={18} />,
      grad: GRAD.violet,
      tone: CHART.violet,
      label: 'Встречи запротоколированы',
      value: data.meetingsProtocoled,
    },
    {
      key: 'tasks',
      icon: <ListChecks size={18} />,
      grad: GRAD.blue,
      tone: CHART.blue,
      label: 'Задачи извлечены',
      value: data.tasksExtracted,
    },
    {
      key: 'decisions',
      icon: <CheckCircle2 size={18} />,
      grad: GRAD.teal,
      tone: CHART.teal,
      label: 'Решения зафиксированы',
      value: data.decisionsExtracted,
    },
    {
      key: 'answered',
      icon: <MessageSquareText size={18} />,
      grad: GRAD.amber,
      tone: CHART.amber,
      label: 'Вопросов отвечено памятью',
      value: data.questionsAnsweredByMemory,
    },
    {
      key: 'commitments',
      icon: <HandshakeIcon size={18} />,
      grad: GRAD.pink,
      tone: CHART.pink,
      label: 'Договорённостей удержано',
      value: data.commitmentsKept,
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
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cells.map((cell) => (
          <div
            key={cell.key}
            className="rounded-2xl p-4"
            style={{ background: 'var(--surface-inset)' }}
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
          </div>
        ))}
      </div>
    </div>
  );
}
