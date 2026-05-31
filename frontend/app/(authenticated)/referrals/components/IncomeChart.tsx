'use client';

import { TrendingUp } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  monthLabel,
  type MonthlyPointDomain,
} from '@/domain/referral';
import { Card } from '@/ui/shadcn/card';

interface Props {
  points: MonthlyPointDomain[];
}

/**
 * IncomeChart — график дохода и активных клиентов за 12 месяцев (ТЗ §8.1 C).
 *
 * Двойная ось Y:
 *   - Левая (тёплый accent) — доход в рублях.
 *   - Правая (бирюзовый) — количество активных клиентов.
 *
 * 12 точек гарантированно приходят с backend (`getIncomeChart`),
 * включая месяцы с нулями — это сразу нормализованный для recharts
 * datapoint, дополнительные преобразования не нужны.
 *
 * Цвета взяты как CSS-переменные, чтобы переключение темы работало.
 */
export function IncomeChart({ points }: Props) {
  const data = points.map((p) => ({
    month: p.month,
    label: monthLabel(p.month),
    income: p.incomeRub,
    active: p.activeClients,
  }));

  return (
    <Card className="space-y-4 p-6">
      <header className="flex items-center gap-2">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-muted text-accent"
          aria-hidden="true"
        >
          <TrendingUp className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-fg-primary">
            Доход и активные клиенты за 12 месяцев
          </h2>
          <p className="text-xs text-fg-tertiary">
            Слева — доход в рублях, справа — сколько клиентов платят.
          </p>
        </div>
      </header>

      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
          >
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              stroke="var(--text-tertiary)"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-subtle)' }}
            />
            <YAxis
              yAxisId="left"
              stroke="var(--accent)"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-subtle)' }}
              tickFormatter={(v: number) =>
                v >= 1000 ? `${(v / 1000).toFixed(0)} тыс` : String(v)
              }
              width={56}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="var(--info)"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-subtle)' }}
              allowDecimals={false}
              width={32}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: 'var(--text-primary)' }}
              formatter={(value, name) => {
                const num = typeof value === 'number' ? value : Number(value);
                const label = String(name);
                if (label === 'Доход') {
                  return [`${num.toLocaleString('ru-RU')} ₽`, label];
                }
                return [String(num), label];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }}
              iconType="circle"
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="income"
              name="Доход"
              stroke="var(--accent)"
              strokeWidth={2.5}
              dot={{ r: 3, fill: 'var(--accent)' }}
              activeDot={{ r: 5 }}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="active"
              name="Активные клиенты"
              stroke="var(--info)"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={{ r: 3, fill: 'var(--info)' }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
