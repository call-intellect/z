'use client';

import { useEffect, useState } from 'react';

import {
  CountUp,
  MiniBarRow,
  MiniDonut,
  MiniHeatCell,
  MiniSparkline,
  MiniStackedBar,
  type ChartTone,
} from '@/ui/components/dashboard/charts';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';

/**
 * Preview-страница библиотеки мини-визуализаций (Фаза 2 ТЗ
 * `plans/tz/2026-06-01-dashboards-wow-polish.md`).
 *
 * Маршрут: `/charts` (внутри route group `(design-preview)`, без AppShell
 * и без авторизации). Используется для визуальной приёмки компонентов.
 *
 * Каждая секция показывает 3 варианта (тон/размер/значение), чтобы можно
 * было сразу сверить с эталоном (`BottleneckHeatmapWidget`, `SprintWeeklyPanel`).
 */
export default function ChartsPreviewPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6 lg:p-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-fg-primary">
          Библиотека мини-визуализаций
        </h1>
        <p className="text-sm text-fg-secondary">
          Шесть переиспользуемых компонентов для дашбордов Z: спарклайн,
          горизонтальная полоса, stacked-полоса, donut, тепловая ячейка и
          счётчик с анимацией. Цвета — через CSS-переменные темы.
        </p>
      </header>

      <SparklineSection />
      <BarRowSection />
      <StackedBarSection />
      <DonutSection />
      <HeatCellSection />
      <CountUpSection />
    </div>
  );
}

const TONES: ChartTone[] = ['accent', 'success', 'warning', 'danger', 'neutral'];

function SparklineSection() {
  const rising = [3, 4, 4, 6, 5, 7, 8, 9, 11, 12];
  const falling = [12, 11, 10, 8, 7, 7, 5, 4, 3, 2];
  const wave = [5, 7, 4, 9, 3, 8, 6, 10, 5, 8];

  return (
    <SectionCard
      title="MiniSparkline"
      description="60×20 SVG. Тренд из произвольного массива чисел. Тон — через `var(--{tone}-fg)`."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Variant label="Рост (success)">
          <MiniSparkline data={rising} tone="success" />
        </Variant>
        <Variant label="Падение (danger)">
          <MiniSparkline data={falling} tone="danger" />
        </Variant>
        <Variant label="Колебание (accent)">
          <MiniSparkline data={wave} tone="accent" />
        </Variant>
        <Variant label="Без заливки (warning)">
          <MiniSparkline data={wave} tone="warning" filled={false} />
        </Variant>
        <Variant label="Размер 120×32 (neutral)">
          <MiniSparkline data={wave} tone="neutral" width={120} height={32} />
        </Variant>
        <Variant label="Плоская линия">
          <MiniSparkline data={[5, 5, 5, 5, 5]} tone="accent" />
        </Variant>
      </div>
    </SectionCard>
  );
}

function BarRowSection() {
  return (
    <SectionCard
      title="MiniBarRow"
      description="Горизонтальная полоса прогресса. Если тон не передан — выбирается автоматически по доле."
    >
      <div className="space-y-3">
        <MiniBarRow label="ROI встречи" value={92} max={100} suffix="%" />
        <MiniBarRow label="Прогресс цели" value={45} max={100} suffix="%" />
        <MiniBarRow label="Заполнение ёмкости" value={12} max={100} suffix="%" />
        <MiniBarRow
          label="Активность спикеров"
          value={7}
          max={10}
          tone="accent"
        />
        <MiniBarRow
          label="Решения за неделю"
          value={3}
          max={12}
          tone="warning"
        />
        <MiniBarRow label="Пустой max" value={0} max={0} />
      </div>
    </SectionCard>
  );
}

function StackedBarSection() {
  return (
    <SectionCard
      title="MiniStackedBar"
      description="Recharts horizontal stacked. Hover-tooltip показывает label + value."
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Variant label="Распределение участников">
          <MiniStackedBar
            segments={[
              { value: 5, tone: 'success', label: 'Эксперты' },
              { value: 3, tone: 'warning', label: 'Продвинутые' },
              { value: 2, tone: 'danger', label: 'Новички' },
            ]}
          />
        </Variant>
        <Variant label="Top-3 contributors">
          <MiniStackedBar
            segments={[
              { value: 45, tone: 'accent', label: 'Анна К.' },
              { value: 30, tone: 'success', label: 'Иван П.' },
              { value: 25, tone: 'warning', label: 'Олег С.' },
            ]}
            height={20}
          />
        </Variant>
        <Variant label="Severity (5 сегментов)">
          <MiniStackedBar
            segments={[
              { value: 8, tone: 'danger', label: 'High' },
              { value: 4, tone: 'warning', label: 'Medium' },
              { value: 12, tone: 'success', label: 'Low' },
              { value: 3, tone: 'neutral', label: 'Unknown' },
            ]}
            height={28}
          />
        </Variant>
      </div>
    </SectionCard>
  );
}

function DonutSection() {
  return (
    <SectionCard
      title="MiniDonut"
      description="Тонкое кольцо. centerLabel — текст в центре. Тон по умолчанию автоматический."
    >
      <div className="flex flex-wrap items-end gap-6">
        <Variant label="Health 85%">
          <MiniDonut value={0.85} centerLabel="85%" size={48} />
        </Variant>
        <Variant label="ROI 45%">
          <MiniDonut value={0.45} centerLabel="45%" size={48} />
        </Variant>
        <Variant label="Coverage 22%">
          <MiniDonut value={0.22} centerLabel="22%" size={48} />
        </Variant>
        <Variant label="Размер 80px (accent)">
          <MiniDonut value={0.62} tone="accent" centerLabel="62%" size={80} />
        </Variant>
        <Variant label="Маленький (28px)">
          <MiniDonut value={0.7} size={28} />
        </Variant>
        <Variant label="Без данных">
          <MiniDonut value={Number.NaN} size={48} />
        </Variant>
      </div>
    </SectionCard>
  );
}

function HeatCellSection() {
  return (
    <SectionCard
      title="MiniHeatCell"
      description="Квадратная ячейка с заливкой по интенсивности. Тон по умолчанию — danger (как в BottleneckHeatmap)."
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs text-fg-tertiary">Тон danger (стандарт)</p>
          <div className="flex gap-1">
            {[0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1].map((r) => (
              <MiniHeatCell key={r} ratio={r} value={Math.round(r * 10)} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs text-fg-tertiary">Тон success</p>
          <div className="flex gap-1">
            {[0, 0.2, 0.4, 0.6, 0.8, 1].map((r) => (
              <MiniHeatCell key={r} ratio={r} tone="success" value={`${Math.round(r * 100)}%`} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs text-fg-tertiary">Размер 48px, тон accent</p>
          <div className="flex gap-2">
            {[0.3, 0.6, 0.9].map((r) => (
              <MiniHeatCell key={r} ratio={r} tone="accent" size={48} value={r.toFixed(1)} />
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function CountUpSection() {
  const [n, setN] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setN(1234), 200);
    return () => clearTimeout(t);
  }, []);

  return (
    <SectionCard
      title="CountUp"
      description="Анимация числа requestAnimationFrame, easing easeOutCubic. Уважает prefers-reduced-motion."
    >
      <div className="flex flex-wrap items-baseline gap-8">
        <Variant label="Целое">
          <span className="text-2xl font-semibold text-fg-primary">
            <CountUp to={n} />
          </span>
        </Variant>
        <Variant label="С процентом">
          <span className="text-2xl font-semibold text-accent">
            <CountUp to={0.876} format={(v) => `${(v * 100).toFixed(0)}%`} />
          </span>
        </Variant>
        <Variant label="Рубли">
          <span className="text-2xl font-semibold text-chip-success-fg">
            <CountUp
              to={48250}
              format={(v) => `${Math.round(v).toLocaleString('ru-RU')} ₽`}
            />
          </span>
        </Variant>
        <button
          type="button"
          onClick={() => setN((prev) => (prev > 0 ? 0 : 1234))}
          className="rounded-md border border-border-subtle bg-bg-card px-3 py-1.5 text-xs text-fg-secondary hover:bg-bg-subtle"
        >
          Перезапустить
        </button>
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Вспомогательные обёртки                                            */
/* ------------------------------------------------------------------ */

type SectionProps = {
  title: string;
  description: string;
  children: React.ReactNode;
};

function SectionCard({ title, description, children }: SectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-fg-tertiary">{description}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Variant({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-fg-tertiary">{label}</p>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
