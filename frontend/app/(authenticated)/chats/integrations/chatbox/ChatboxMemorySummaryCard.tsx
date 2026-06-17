"use client";

import Link from "next/link";
import { AlertTriangle, Brain, Loader2 } from "lucide-react";
import useSWR from "swr";

import { chatboxApi } from "@/api/chatbox.api";
import {
  mapMemorySummary,
  type ChatboxMemorySummaryView,
} from "@/domain/chatbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";

type Tone = "neutral" | "info" | "warning" | "danger";

function toneCellClass(tone: Tone): string {
  switch (tone) {
    case "danger":
      return "border-chip-danger-bg bg-chip-danger-bg/40";
    case "warning":
      return "border-chip-warning-bg bg-chip-warning-bg/40";
    case "info":
      return "border-chip-info-bg bg-chip-info-bg/40";
    default:
      return "border-border-subtle bg-bg-card";
  }
}

function toneValueClass(tone: Tone): string {
  switch (tone) {
    case "danger":
      return "text-chip-danger-fg";
    case "warning":
      return "text-chip-warning-fg";
    case "info":
      return "text-chip-info-fg";
    default:
      return "text-fg-primary";
  }
}

type Counter = {
  key: keyof ChatboxMemorySummaryView;
  label: string;
  tone: Tone;
  href?: string;
};

function counters(s: ChatboxMemorySummaryView): Counter[] {
  return [
    { key: "dialogs", label: "Забрано диалогов", tone: "neutral" },
    { key: "analyzed", label: "Проанализировано", tone: "neutral" },
    {
      key: "inProgress",
      label: "В работе",
      tone: s.inProgress > 0 ? "info" : "neutral",
    },
    {
      key: "failed",
      label: "Ошибки",
      tone: s.failed > 0 ? "danger" : "neutral",
    },
    {
      key: "blocks",
      label: "Карточки памяти",
      tone: "neutral",
      href: "/cards",
    },
    { key: "tasks", label: "Задачи", tone: "neutral", href: "/tasks" },
  ];
}

function CounterCell({
  value,
  label,
  tone,
  href,
}: {
  value: number;
  label: string;
  tone: Tone;
  href?: string;
}) {
  const body = (
    <>
      <div className={`text-lg font-semibold ${toneValueClass(tone)}`}>
        {value.toLocaleString("ru-RU")}
      </div>
      <div className="text-xs text-fg-tertiary">{label}</div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`block rounded-lg border p-3 transition-colors hover:border-border-strong ${toneCellClass(
          tone,
        )}`}
      >
        {body}
      </Link>
    );
  }

  return (
    <div className={`rounded-lg border p-3 ${toneCellClass(tone)}`}>{body}</div>
  );
}

export function ChatboxMemorySummaryCard() {
  const { data, error, isLoading } = useSWR(["chatbox-memory-summary"], () =>
    chatboxApi.memorySummary().then(mapMemorySummary),
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain size={16} className="text-accent" />
            Чаты в памяти
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center text-sm text-fg-tertiary">
            <Loader2 size={14} className="mr-2 animate-spin" /> Загружаем…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain size={16} className="text-accent" />
            Чаты в памяти
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-fg-tertiary">
            Не удалось загрузить сводку по памяти.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.configured) {
    return null;
  }

  const showAnalysisOffWarning = !data.analysisEnabled && data.hasData;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain size={16} className="text-accent" />
          Чаты в памяти
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {showAnalysisOffWarning && (
          <div className="flex items-start gap-2 rounded-md bg-chip-warning-bg px-3 py-2 text-sm text-chip-warning-fg">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              Анализ переписки выключен — диалоги копятся, но не превращаются в
              память. Включите AI-анализ выше.
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {counters(data).map((c) => (
            <CounterCell
              key={c.key}
              value={data[c.key] as number}
              label={c.label}
              tone={c.tone}
              href={c.href}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
