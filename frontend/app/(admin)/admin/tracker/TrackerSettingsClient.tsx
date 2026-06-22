"use client";

import type { JSX } from "react";
import { z } from "zod";

import {
  DomainSettingsClient,
  type SettingsGroup,
} from "@/ui/components/admin/DomainSettings";

const GROUPS: SettingsGroup[] = [
  {
    title: "Поиск исполнителя",
    description:
      "Как Кора находит сотрудника по имени при постановке задачи (учёт склонений и опечаток).",
    specs: [
      {
        key: "tracker.assigneeMatchMaxEdits",
        label: "Допуск склонений/опечаток в имени",
        description:
          "Насколько имя может отличаться от записи в команде (расстояние на общей основе слова): ловит «поставь задачу Сергею» → сотрудник «Сергей». По умолчанию 2, диапазон 0–4. 0 — только точное совпадение.",
        schema: z.number().int().min(0).max(4),
        defaultValue: 2,
      },
    ],
  },
  {
    title: "Авто-черновик прогресса",
    description:
      "Воркер собирает черновик обновления прогресса из графа знаний; человек подтверждает (авто-публикации нет).",
    specs: [
      {
        key: "tracker.progressAutoDraftEnabled",
        label: "Авто-черновик прогресса",
        description:
          "Рубильник воркера авто-черновика прогресса задач. Выкл — черновики не создаются. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "tracker.progressAutoDraftMinSignals",
        label: "Минимум сигналов для черновика",
        description:
          "Сколько дельта-сигналов по задаче нужно, чтобы Кора собрала черновик прогресса. По умолчанию 2 (минимум 1).",
        schema: z.number().int().min(1),
        defaultValue: 2,
      },
      {
        key: "tracker.progressAutoDraftCron",
        label: "Расписание (cron) авто-черновика",
        description:
          "Когда запускается воркер авто-черновика прогресса. По умолчанию ежедневно в 07:00 UTC.",
        schema: z.string().min(1),
        defaultValue: "0 7 * * *",
      },
    ],
  },
  {
    title: "Авто-закрытие задач",
    description:
      "Когда из разговора звучит «сделал X», Кора находит открытую задачу и собирает обратимый кандидат на закрытие; человек подтверждает (авто-закрытия нет).",
    specs: [
      {
        key: "taskClosure.enabled",
        label: "Петля авто-закрытия задач",
        description:
          "Рубильник петли авто-закрытия. Выкл — кандидаты на закрытие не создаются. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "taskClosure.matchThreshold",
        label: "Порог близости сигнала к задаче",
        description:
          "Минимальная смысловая близость сигнала к открытой задаче (0–1), при которой задача считается найденной. По умолчанию 0.85. Ниже — пробуется совпадение по словам.",
        schema: z.number().min(0).max(1),
        defaultValue: 0.85,
      },
      {
        key: "taskClosure.lexicalFallbackMinOverlap",
        label: "Минимум совпадения по словам (запасной поиск)",
        description:
          "Когда смысловая близость не дотянула до порога, доля слов названия задачи, которые должны встретиться в тексте сигнала (0–1). По умолчанию 0.5. Итоговое решение всё равно проверяет AI-верификатор.",
        schema: z.number().min(0).max(1),
        defaultValue: 0.5,
      },
      {
        key: "taskClosure.embedTimeoutMs",
        label: "Таймаут расчёта вектора (мс)",
        description:
          "Сколько ждать расчёта смыслового вектора текста сигнала. По умолчанию 2500 мс. Таймаут — сигнал пропускается.",
        schema: z.number().int().positive(),
        defaultValue: 2500,
      },
      {
        key: "taskClosure.candidateTtlDays",
        label: "Срок жизни кандидата (дни)",
        description:
          "Через сколько дней неподтверждённый кандидат на закрытие автоматически очищается. По умолчанию 14.",
        schema: z.number().int().positive(),
        defaultValue: 14,
      },
    ],
  },
  {
    title: "Сводка изменений",
    description:
      "AI-сводка «что произошло по задаче» по запросу пользователя (catch-up).",
    specs: [
      {
        key: "tracker.activityDigestEnabled",
        label: "Сводка изменений по задаче",
        description:
          "Рубильник кнопки «Что произошло по задаче». Выкл — сводка недоступна. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
    ],
  },
  {
    title: "Автоматизации",
    description:
      "Рубильник пользовательских автоматизаций трекера (правила «если — то»). По умолчанию включён (Ship-On).",
    specs: [
      {
        key: "tracker.automationsEnabled",
        label: "Автоматизации трекера",
        description:
          "Рубильник движка пользовательских правил «если — то». Выкл — ни одно правило не применяется. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
    ],
  },
  {
    title: "Повторения",
    description:
      "Повторяющиеся задачи материализуются по расписанию из снимка-шаблона.",
    specs: [
      {
        key: "tracker.recurrenceEnabled",
        label: "Повторяющиеся задачи",
        description:
          "Рубильник воркера материализации повторений. Выкл — новые задачи из повторений не создаются. По умолчанию вкл (Ship-On).",
        schema: z.boolean(),
        defaultValue: true,
      },
      {
        key: "tracker.recurrenceCronCadence",
        label: "Расписание (cron) повторений",
        description:
          "Когда запускается воркер материализации повторяющихся задач. По умолчанию ежедневно в 06:00 UTC.",
        schema: z.string().min(1),
        defaultValue: "0 6 * * *",
      },
    ],
  },
];

export function TrackerSettingsClient(): JSX.Element {
  return (
    <DomainSettingsClient
      breadcrumbLabel="Трекер"
      title="Трекер"
      description="Рубильники и параметры задачного трекера."
      groups={GROUPS}
    />
  );
}
