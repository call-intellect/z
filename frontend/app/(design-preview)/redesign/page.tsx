"use client";

import {
  Activity,
  Bell,
  Brain,
  CalendarClock,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";

import {
  AiCard,
  AreaTrend,
  Avatar,
  BarTrend,
  CHART,
  DonutCard,
  GaugeCard,
  GRAD,
  Heatmap,
  MODERN_PAGE_BG,
  ModernTable,
  ProgressBar,
  RadarCard,
  StatCard,
  StatusPill,
  type ModernTableColumn,
} from "@/ui/components/dashboard/modern";

const SPARK_UP = [4, 6, 5, 8, 7, 10, 9, 12, 14].map((v, i) => ({ i, v }));
const SPARK_DOWN = [12, 11, 11, 9, 8, 8, 6, 5, 4].map((v, i) => ({ i, v }));

const REVENUE = [
  { m: "Июл", plan: 42, fact: 38 },
  { m: "Авг", plan: 48, fact: 52 },
  { m: "Сен", plan: 55, fact: 49 },
  { m: "Окт", plan: 60, fact: 64 },
  { m: "Ноя", plan: 68, fact: 72 },
  { m: "Дек", plan: 74, fact: 88 },
];

const RADAR = [
  { k: "Продукт", v: 80 },
  { k: "Продажи", v: 65 },
  { k: "Найм", v: 50 },
  { k: "Финансы", v: 72 },
  { k: "Процессы", v: 58 },
];

const DONUT = [
  { name: "Решения", value: 42, c: CHART.mint },
  { name: "Идеи", value: 28, c: CHART.violet },
  { name: "Риски", value: 18, c: CHART.amber },
  { name: "Вопросы", value: 12, c: CHART.blue },
];

const WEEK = [
  { d: "Пн", v: 12 },
  { d: "Вт", v: 18 },
  { d: "Ср", v: 9 },
  { d: "Чт", v: 22 },
  { d: "Пт", v: 16 },
  { d: "Сб", v: 5 },
  { d: "Вс", v: 3 },
];

interface Person {
  n: string;
  r: string;
  p: number;
  s: "ok" | "warning" | "risk";
}

const PEOPLE: Person[] = [
  { n: "Анна Ковалёва", r: "Продукт", p: 92, s: "ok" },
  { n: "Иван Петров", r: "Продажи", p: 64, s: "warning" },
  { n: "Олег Смирнов", r: "Найм", p: 38, s: "risk" },
  { n: "Мария Линь", r: "Финансы", p: 81, s: "ok" },
];

const PEOPLE_COLUMNS: ModernTableColumn<Person>[] = [
  {
    header: "Сотрудник",
    cell: (p) => (
      <div className="flex items-center gap-3">
        <Avatar name={p.n} grad={GRAD.violet} />
        {p.n}
      </div>
    ),
  },
  {
    header: "Направление",
    cell: (p) => <span style={{ color: CHART.dim }}>{p.r}</span>,
  },
  {
    header: "Выполнено обещаний",
    cell: (p) => <ProgressBar percent={p.p} />,
  },
  {
    header: "Статус",
    align: "right",
    cell: (p) => <StatusPill status={p.s} />,
  },
];

const HEATMAP_ROWS = ["Утро", "День", "Вечер"];
const HEATMAP_COLS = ["Пн", "Вт", "Ср", "Чт", "Пт"];
const HEATMAP_GRID = [
  [0.2, 0.6, 0.3, 0.8, 0.5],
  [0.5, 0.9, 0.7, 1, 0.6],
  [0.3, 0.4, 0.2, 0.5, 0.7],
];

export default function RedesignPreviewPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        color: CHART.text,
        background: MODERN_PAGE_BG,
        fontFamily: "Geist, system-ui, sans-serif",
      }}
    >
      <div className="mx-auto max-w-[1280px] px-6 py-7 lg:px-10">
        <TopBar />
        <PageHeading />

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={<Users size={18} />}
            grad={GRAD.violet}
            label="Активные участники"
            value="382"
            delta="+12%"
            up
            spark={SPARK_UP}
            tone={CHART.violet}
          />
          <StatCard
            icon={<Target size={18} />}
            grad={GRAD.teal}
            label="Выполнено обещаний"
            value="86%"
            delta="+5%"
            up
            spark={SPARK_UP}
            tone={CHART.mint}
          />
          <StatCard
            icon={<Activity size={18} />}
            grad={GRAD.amber}
            label="Открытые блокеры"
            value="3"
            delta="-2"
            up={false}
            spark={SPARK_DOWN}
            tone={CHART.amber}
          />
          <StatCard
            icon={<Brain size={18} />}
            grad={GRAD.blue}
            label="Новые карточки знаний"
            value="128"
            delta="+34"
            up
            spark={SPARK_UP}
            tone={CHART.blue}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AreaTrend
              title="Движение к целям"
              titleIcon={<TrendingUp size={16} />}
              titleGrad={GRAD.teal}
              data={REVENUE}
              xKey="m"
              series={[
                {
                  key: "plan",
                  color: CHART.violet,
                  label: "План",
                  fillOpacity: 0.3,
                },
                {
                  key: "fact",
                  color: CHART.mint,
                  label: "Факт",
                  strokeWidth: 2.5,
                },
              ]}
              headline={{
                value: "+24.6%",
                sub: "за 6 месяцев",
                subColor: CHART.mint,
              }}
            />
          </div>
          <GaugeCard
            title="Индекс здоровья"
            icon={<Activity size={16} />}
            grad={GRAD.violet}
            value={72}
            max={100}
            footer={[
              { t: "Настроение", v: "78", c: CHART.mint },
              { t: "Темп", v: "64", c: CHART.cyan },
              { t: "Риск", v: "низкий", c: CHART.violet },
            ]}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <RadarCard
            title="Баланс направлений"
            icon={<Target size={16} />}
            grad={GRAD.pink}
            data={RADAR}
          />
          <DonutCard
            title="Структура памяти"
            icon={<Sparkles size={16} />}
            grad={GRAD.blue}
            data={DONUT}
            centerValue="100"
            centerLabel="всего"
          />
          <AiCard
            title="AI-сводка за неделю"
            text="Команда ускорилась на найме, но риск по финансам вырос. Три блокера ждут решения дольше 5 дней. Стоит разобрать висящие вопросы по продукту."
            ctaLabel="Открыть разбор"
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <BarTrend
              title="Активность встреч"
              icon={<CalendarClock size={16} />}
              grad={GRAD.amber}
              data={WEEK}
              xKey="d"
              dataKey="v"
            />
          </div>
          <Heatmap
            title="Тепловая карта дня"
            icon={<Activity size={16} />}
            grad={GRAD.teal}
            rows={HEATMAP_ROWS}
            cols={HEATMAP_COLS}
            grid={HEATMAP_GRID}
          />
        </div>

        <div className="mt-5">
          <ModernTable<Person>
            title="План-факт по людям"
            titleIcon={<Users size={16} />}
            titleGrad={GRAD.blue}
            columns={PEOPLE_COLUMNS}
            rows={PEOPLE}
            getKey={(p) => p.n}
          />
        </div>

        <p className="mt-8 text-center text-xs" style={{ color: CHART.faint }}>
          Витрина нового визуального языка · /redesign · мок-данные
        </p>
      </div>
    </div>
  );
}

function TopBar() {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div
          className="grid h-10 w-10 place-items-center rounded-2xl text-sm font-bold"
          style={{ background: GRAD.teal, color: "oklch(0.2 0.03 200)" }}
        >
          К
        </div>
        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {["Обзор", "Операции", "Память", "Команда"].map((t, i) => (
            <span
              key={t}
              className="rounded-full px-4 py-2 text-sm"
              style={
                i === 0
                  ? { background: "oklch(1 0 0 / 0.08)", color: CHART.text }
                  : { color: CHART.dim }
              }
            >
              {t}
            </span>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <div
          className="hidden items-center gap-2 rounded-full px-4 py-2 sm:flex"
          style={{
            background: "oklch(1 0 0 / 0.06)",
            border: "1px solid oklch(1 0 0 / 0.07)",
          }}
        >
          <Search size={15} style={{ color: CHART.faint }} />
          <span className="text-sm" style={{ color: CHART.faint }}>
            Поиск
          </span>
        </div>
        <button
          type="button"
          className="relative grid h-10 w-10 place-items-center rounded-full"
          style={{
            background: "oklch(1 0 0 / 0.06)",
            border: "1px solid oklch(1 0 0 / 0.07)",
          }}
        >
          <Bell size={16} style={{ color: CHART.dim }} />
          <span
            className="absolute right-2 top-2 h-2 w-2 rounded-full"
            style={{ background: CHART.mint }}
          />
        </button>
        <div
          className="h-10 w-10 rounded-full"
          style={{ background: GRAD.violet }}
        />
      </div>
    </header>
  );
}

function PageHeading() {
  return (
    <div className="mt-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">
          Пульс компании
        </h1>
        <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
          Срез знаний и операций за неделю
        </p>
      </div>
      <div
        className="flex items-center gap-1 rounded-full p-1"
        style={{
          background: "oklch(1 0 0 / 0.06)",
          border: "1px solid oklch(1 0 0 / 0.07)",
        }}
      >
        {["Неделя", "Месяц", "Квартал"].map((t, i) => (
          <span
            key={t}
            className="rounded-full px-4 py-1.5 text-sm"
            style={
              i === 0
                ? {
                    background: GRAD.violet,
                    color: CHART.text,
                    boxShadow: "0 6px 18px -8px oklch(0.6 0.2 290 / 0.9)",
                  }
                : { color: CHART.dim }
            }
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
