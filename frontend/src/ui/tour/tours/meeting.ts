import type { TourDefinition } from "../types";

export const meetingTour: TourDefinition = {
  id: "meeting",
  steps: [
    {
      id: "transcript",
      target: '[data-tour-target="meeting.transcript"]',
      title: "Транскрипт",
      body: "Полная запись с тайм-кодами и разделением по спикерам.",
      placement: "bottom",
      primaryAction: { label: "Дальше", kind: "next" },
      secondaryAction: { label: "Пропустить", kind: "skip" },
    },
    {
      id: "ai-report",
      target: '[data-tour-target="meeting.ai-report"]',
      title: "AI-отчёт",
      body: "Кратко: что обсудили, какие решения, какие задачи.",
      placement: "bottom",
      primaryAction: { label: "Дальше", kind: "next" },
      secondaryAction: { label: "Пропустить", kind: "skip" },
    },
    {
      id: "tasks",
      target: '[data-tour-target="meeting.tasks"]',
      title: "Извлечённые задачи",
      body: "AI нашёл действия из встречи. Подтвердите — попадут во «Входящие».",
      placement: "bottom",
      primaryAction: { label: "Дальше", kind: "next" },
      secondaryAction: { label: "Пропустить", kind: "skip" },
    },
    {
      id: "card-link",
      target: '[data-tour-target="meeting.card-link"]',
      title: "Привязка к карточке",
      body: "Прикрепите встречу к карточке клиента, чтобы вся история была в одном месте.",
      placement: "top",
      primaryAction: { label: "Готово", kind: "complete" },
    },
  ],
};
