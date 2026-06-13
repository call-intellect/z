/**
 * Тур №3 «Обзор сайдбара» — обновлён под редизайн кабинета (ТЗ 2026-06-13, Ф0):
 * новое меню «3 ритма + работа + Я + система». Тексты берутся из NAV_HELP.
 *
 * ТЗ: plans/tz/2026-05-29-onboarding-v2.md §5.8 → переработан 2026-06-13.
 */

import type { TourDefinition } from '../types';
import { NAV_HELP } from '@/lib/nav-help';

function help(navKey: string) {
  return NAV_HELP[navKey] ?? { title: navKey, body: '' };
}

export const overviewTour: TourDefinition = {
  id: 'overview',
  steps: [
    // 0 — Intro (по центру)
    {
      id: 'intro',
      target: 'center',
      title: 'Покажу за минуту, что где лежит',
      body: 'Несколько коротких подсказок по разделам. Можно листать кнопкой «Дальше» или закрыть крестиком — все эти подсказки потом всегда доступны при наведении на любой пункт меню.',
      placement: 'center',
      primaryAction: { label: 'Поехали', kind: 'next' },
      secondaryAction: { label: 'Пропустить', kind: 'skip' },
    },
    // 1 — Логотип
    {
      id: 'logo',
      target: '[data-overview-target="overview.logo"]',
      title: help('/dashboard').title,
      body: 'Логотип Коры — кликните, чтобы вернуться на «Сегодня» из любого раздела.',
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 2 — Переключатель компании
    {
      id: 'org-switcher',
      target: '[data-overview-target="overview.org-switcher"]',
      title: 'Переключатель компании',
      body: 'Если у вас несколько компаний — переключайтесь между ними здесь.',
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 3 — Создать
    {
      id: 'create',
      target: '[data-overview-target="overview.create"]',
      title: 'Создать',
      body: 'Один вход для всего: встреча, мысль (быстрая заметка в память), задача, цель.',
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 4 — Сегодня (ритм дня)
    {
      id: 'dashboard',
      target: '[data-overview-target="overview.dashboard"]',
      title: help('/dashboard').title,
      body: help('/dashboard').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 5 — Неделя (ритм недели)
    {
      id: 'week',
      target: '[data-overview-target="overview.week"]',
      title: help('/week').title,
      body: help('/week').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 6 — Итоги месяца (ритм месяца)
    {
      id: 'month',
      target: '[data-overview-target="overview.month"]',
      title: help('/month').title,
      body: help('/month').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 7 — Встречи
    {
      id: 'meetings',
      target: '[data-overview-target="overview.meetings"]',
      title: help('/meetings').title,
      body: help('/meetings').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 8 — Задачи
    {
      id: 'projects',
      target: '[data-overview-target="overview.projects"]',
      title: help('/projects').title,
      body: help('/projects').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 9 — Память
    {
      id: 'memory',
      target: '[data-overview-target="overview.memory"]',
      title: help('/memory').title,
      body: help('/memory').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 10 — Команда
    {
      id: 'team',
      target: '[data-overview-target="overview.team"]',
      title: help('/structure').title,
      body: help('/structure').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 11 — Я
    {
      id: 'me',
      target: '[data-overview-target="overview.me"]',
      title: help('/me').title,
      body: help('/me').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 12 — Настройки
    {
      id: 'settings',
      target: '[data-overview-target="overview.settings"]',
      title: help('/settings').title,
      body: help('/settings').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 13 — Админка
    {
      id: 'admin',
      target: '[data-overview-target="overview.admin"]',
      title: help('/company-admin').title,
      body: help('/company-admin').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 14 — Помощник компании (плавающая кнопка)
    {
      id: 'concierge',
      target: '[data-tour-target="welcome.concierge"]',
      title: help('concierge').title,
      body: help('concierge').body,
      placement: 'left',
      primaryAction: { label: 'Готово', kind: 'complete' },
    },
  ],
};
