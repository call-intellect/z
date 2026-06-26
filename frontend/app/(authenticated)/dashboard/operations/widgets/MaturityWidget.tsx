"use client";

import { Gauge } from "lucide-react";
import Link from "next/link";

import { getCompanyStageLabel } from "@/lib/cause-category-presentation";
import type { MaturitySnapshotDomain } from "@/domain/operations-dashboard";
import {
  BarTrend,
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
  RadarCard,
} from "@/ui/components/dashboard/modern";

export function MaturityWidget(props: { maturity: MaturitySnapshotDomain }) {
  const { maturity } = props;

  if (maturity.score === null) {
    return (
      <GlassCard>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <CardTitle icon={<Gauge size={16} />} grad={GRAD.teal}>
            Зрелость компании
          </CardTitle>
          <Link
            href="/maturity"
            className="text-xs hover:underline"
            style={{ color: CHART.cyan }}
          >
            Подробнее →
          </Link>
        </div>
        <p
          className="rounded-xl p-3 text-sm"
          style={{ background: "var(--surface-inset)", color: CHART.dim }}
        >
          Расчёт зрелости — каждое утро в 05:00 UTC. Проверьте позже.
        </p>
      </GlassCard>
    );
  }

  const percent = maturity.scorePercent ?? 0;
  const stageLabel = getCompanyStageLabel(maturity.stage);

  const domainAxes = (() => {
    const seen = new Set<string>();
    const axes: { k: string; v: number }[] = [];
    for (const d of [...maturity.weakestDomains, ...maturity.topDomains]) {
      if (seen.has(d.slug)) continue;
      seen.add(d.slug);
      axes.push({ k: d.name, v: d.completenessPercent });
    }
    return axes;
  })();

  return (
    <GlassCard>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <CardTitle icon={<Gauge size={16} />} grad={GRAD.teal}>
          Зрелость компании
        </CardTitle>
        <Link
          href="/maturity"
          className="text-xs hover:underline"
          style={{ color: CHART.cyan }}
        >
          Подробнее →
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center justify-center">
          <ScoreRing percent={percent} />
          <div className="mt-2 text-center">
            <div
              className="text-xs uppercase tracking-wide"
              style={{ color: CHART.faint }}
            >
              Стадия
            </div>
            <div className="text-sm font-medium" style={{ color: CHART.text }}>
              {stageLabel}
            </div>
            {maturity.lastCalcAt ? (
              <div className="mt-1 text-[10px]" style={{ color: CHART.faint }}>
                обновлено{" "}
                {maturity.lastCalcAt.toLocaleString("ru-RU", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </div>
            ) : null}
          </div>
        </div>
        {}
        {domainAxes.length === 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DomainList
              title="Слабые места"
              items={maturity.weakestDomains}
              tone="danger"
            />
            <DomainList
              title="Сильные стороны"
              items={maturity.topDomains}
              tone="success"
            />
          </div>
        ) : domainAxes.length >= 3 ? (
          <RadarCard
            title="Зрелость по доменам"
            icon={<Gauge size={16} />}
            grad={GRAD.violet}
            data={domainAxes}
          />
        ) : (
          <BarTrend
            title="Зрелость по доменам"
            icon={<Gauge size={16} />}
            grad={GRAD.violet}
            data={domainAxes}
            xKey="k"
            dataKey="v"
          />
        )}
      </div>
    </GlassCard>
  );
}

function ScoreRing({ percent }: { percent: number }) {
  const size = 88;
  const radius = 36;
  const stroke = 8;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Зрелость компании ${clamped}%`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="var(--border-inset)"
        strokeWidth={stroke}
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={CHART.mint}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill={CHART.text}
        className="text-xl font-bold"
      >
        {clamped}%
      </text>
    </svg>
  );
}

function DomainList(props: {
  title: string;
  items: Array<{ slug: string; name: string; completenessPercent: number }>;
  tone: "danger" | "success";
}) {
  const dotColor = props.tone === "danger" ? CHART.red : CHART.mint;
  return (
    <div>
      <h3
        className="mb-2 text-xs uppercase tracking-wide"
        style={{ color: CHART.faint }}
      >
        {props.title}
      </h3>
      {props.items.length === 0 ? (
        <p className="text-xs" style={{ color: CHART.faint }}>
          Накапливаем данные
        </p>
      ) : (
        <ul className="space-y-1.5">
          {props.items.slice(0, 3).map((d) => (
            <li
              key={d.slug}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: dotColor }}
                  aria-hidden
                />
                <span className="truncate" style={{ color: CHART.text }}>
                  {d.name}
                </span>
              </span>
              <span
                className="shrink-0 tabular-nums text-xs"
                style={{ color: CHART.faint }}
              >
                {d.completenessPercent}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
