"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AdminSection } from "@/ui/components/admin/AdminSection";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";

import { AdminEmpty } from "../../AdminStateViews";

type WeekRange = "4w" | "12w" | "26w";

const WEEK_RANGE_LABELS: Record<WeekRange, string> = {
  "4w": "За 4 недели",
  "12w": "За 12 недель",
  "26w": "За 26 недель",
};

export function MeetingsAnalyticsClient() {
  const [range, setRange] = useState<WeekRange>("12w");

  const placeholderTypeData: Array<{ type: string; count: number }> = [];
  const placeholderDurationData: Array<{ week: string; avgMin: number }> = [];

  return (
    <AdminSection
      title="Встречи"
      description="Длительность, типы встреч, кол-во участников, retention использования. Все числа — read-only, для управления используйте раздел «Все встречи»."
      actions={
        <Select value={range} onValueChange={(v) => setRange(v as WeekRange)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="4w">{WEEK_RANGE_LABELS["4w"]}</SelectItem>
            <SelectItem value="12w">{WEEK_RANGE_LABELS["12w"]}</SelectItem>
            <SelectItem value="26w">{WEEK_RANGE_LABELS["26w"]}</SelectItem>
          </SelectContent>
        </Select>
      }
    >
      <div className="space-y-6">
        <AdminEmpty
          title="Эндпоинт появится в Фазе 7"
          description="GET /api/v1/admin/analytics/meetings ещё не реализован. Дашборд ниже — каркас с пустыми графиками."
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Встречи по типам</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={placeholderTypeData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="type" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Bar
                      dataKey="count"
                      fill="var(--accent)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Средняя длительность по неделям, мин
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={placeholderDurationData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="week" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="avgMin"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminSection>
  );
}
