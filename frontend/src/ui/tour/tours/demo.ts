/**
 * Демо-тур — 5 шагов после загрузки демо-воркспейса «ТехноСтрим».
 * Показывает ключевые разделы: дашборд, канбан, AI-отчёт, граф знаний, клоны.
 *
 * ТЗ: plans/tz/2026-05-28-demo-workspace.md §4.6
 */

import type { TourDefinition } from '../types';

export const demoTour: TourDefinition = {
  id: 'demo',
  steps: [
    // Шаг 1 — Дашборд
    {
      id: 'dashboard',
      target: '[data-tour-target="demo.dashboard"]',
      title: 'Дашборд директора',
      body: 'Видите пульс компании за 30 секунд: метрики, блокеры, загрузка команды. Все данные — из встреч и чатов, без ручного ввода.',
      placement: 'bottom',
      primaryAction: { label: 'Дальше', kind: 'navigate', href: '/projects' },
      secondaryAction: { label: 'Пропустить тур', kind: 'skip' },
    },
    // Шаг 2 — Канбан-доска
    {
      id: 'board',
      target: '[data-tour-target="demo.board"]',
      title: 'Канбан-доска проекта',
      body: 'Перетаскивайте задачи между колонками. У каждой — приоритет, исполнитель, чек-лист и комментарии. Задачи создаются автоматически из AI-отчётов встреч.',
      placement: 'bottom',
      primaryAction: { label: 'Дальше', kind: 'navigate', href: '/meetings' },
    },
    // Шаг 3 — AI-отчёт встречи
    {
      id: 'meeting-result',
      target: '[data-tour-target="demo.meeting"]',
      title: 'AI-отчёт по встрече',
      body: 'Решения, задачи, риски — автоматически из записи звонка. Транскрипт с разделением по спикерам и главы по темам.',
      placement: 'bottom',
      primaryAction: { label: 'Дальше', kind: 'navigate', href: '/themes' },
    },
    // Шаг 4 — Граф знаний
    {
      id: 'themes',
      target: '[data-tour-target="demo.themes"]',
      title: 'Граф знаний компании',
      body: 'AI нашёл 7 тем из 7 встреч. Риски, решения, инсайты — всё связано. Кликните на тему, чтобы увидеть источники.',
      placement: 'bottom',
      primaryAction: { label: 'Дальше', kind: 'navigate', href: '/clones' },
    },
    // Шаг 5 — Клоны
    {
      id: 'clones',
      target: '[data-tour-target="demo.clones"]',
      title: 'Цифровые двойники сотрудников',
      body: 'Спросите у клона Tech Lead, что он думает о безопасности. Клон отвечает на основе реальных встреч и решений сотрудника.',
      placement: 'bottom',
      primaryAction: { label: 'Готово!', kind: 'complete' },
    },
  ],
};
