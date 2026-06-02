/**
 * Тур №3 «Обзор сайдбара» — 17 шагов + intro.
 * Тексты берутся из NAV_HELP.
 *
 * ТЗ: plans/tz/2026-05-29-onboarding-v2.md §5.8
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
      body: '17 коротких подсказок по разделам. Можно листать кнопкой «Дальше» или закрыть крестиком — все эти подсказки потом всегда доступны при наведении на любой пункт меню.',
      placement: 'center',
      primaryAction: { label: 'Поехали', kind: 'next' },
      secondaryAction: { label: 'Пропустить', kind: 'skip' },
    },
    // 1 — Логотип
    {
      id: 'logo',
      target: '[data-overview-target="overview.logo"]',
      title: help('/dashboard').title,
      body: 'Логотип Коры — кликните, чтобы вернуться на главную из любого раздела.',
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
    // 3 — Создать встречу
    {
      id: 'create-meeting',
      target: '[data-overview-target="overview.create-meeting"]',
      title: help('/meetings/create').title,
      body: help('/meetings/create').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 4 — Главная
    {
      id: 'dashboard',
      target: '[data-overview-target="overview.dashboard"]',
      title: help('/dashboard').title,
      body: help('/dashboard').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 5 — Встречи
    {
      id: 'meetings',
      target: '[data-overview-target="overview.meetings"]',
      title: help('/meetings').title,
      body: help('/meetings').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 6 — Дамп
    {
      id: 'dump',
      target: '[data-overview-target="overview.dump"]',
      title: help('/dump').title,
      body: help('/dump').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 7 — Карточки
    {
      id: 'cards',
      target: '[data-overview-target="overview.cards"]',
      title: help('/cards').title,
      body: help('/cards').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 8 — Проекты
    {
      id: 'projects',
      target: '[data-overview-target="overview.projects"]',
      title: help('/projects').title,
      body: help('/projects').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 9 — Входящие
    {
      id: 'intake',
      target: '[data-overview-target="overview.intake"]',
      title: help('/intake').title,
      body: help('/intake').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 10 — Помощник
    {
      id: 'chat',
      target: '[data-overview-target="overview.chat"]',
      title: help('/chat').title,
      body: help('/chat').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 11 — Моё пространство
    {
      id: 'me',
      target: '[data-overview-target="overview.me"]',
      title: help('/me').title,
      body: help('/me').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 12 — Память компании (группа — центр экрана, т.к. нет единого target)
    {
      id: 'memory',
      target: 'center',
      title: help('/memory').title,
      body: help('/memory').body,
      placement: 'center',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 13 — Управление
    {
      id: 'operations',
      target: '[data-overview-target="overview.operations"]',
      title: help('/dashboard/operations').title,
      body: help('/dashboard/operations').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 14 — Справочник (раскрываем группу)
    {
      id: 'reference',
      target: 'center',
      title: help('/company').title,
      body: 'Справочник — структура и метаданные компании: отделы, должности, сотрудники, документы. Группа свёрнута по умолчанию.',
      placement: 'center',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 15 — Настройки
    {
      id: 'settings',
      target: '[data-overview-target="overview.settings"]',
      title: help('/settings').title,
      body: help('/settings').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 16 — Админка
    {
      id: 'admin',
      target: '[data-overview-target="overview.admin"]',
      title: help('/company-admin').title,
      body: help('/company-admin').body,
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
    },
    // 17 — Концьерж
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
