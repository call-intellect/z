/**
 * Тур №2 (Блок B) — Action-тур «Настройка компании».
 * 6 шагов с kind: 'navigate' — переводят пользователя на нужную страницу.
 *
 * ТЗ: plans/tz/2026-05-29-onboarding-v2.md §5.6
 */

import type { TourDefinition } from '../types';

export const welcomeTour: TourDefinition = {
  id: 'welcome',
  steps: [
    // B1 — Компания
    {
      id: 'company',
      target: '[data-tour-target="welcome.company"]',
      title: 'Расскажите Коре о компании',
      body: 'Логотип, юридические данные, контакты, миссия — основа для отчётов и ИИ-помощника.',
      placement: 'right',
      primaryAction: { label: 'Заполнить сейчас', kind: 'navigate', href: '/company' },
      secondaryAction: { label: 'Пропустить', kind: 'next' },
    },
    // B2 — Отделы
    {
      id: 'departments',
      target: '[data-tour-target="welcome.departments"]',
      title: 'Добавьте отделы вашей компании',
      body: 'Для команды на 20–30 человек обычно 3–5 отделов. Мы подготовили шаблон для вашей отрасли.',
      placement: 'right',
      primaryAction: { label: 'Добавить отделы', kind: 'navigate', href: '/departments' },
      secondaryAction: { label: 'Пропустить', kind: 'next' },
    },
    // B3 — Должности
    {
      id: 'roles',
      target: '[data-tour-target="welcome.roles"]',
      title: 'Заведите должности по отделам',
      body: 'Кора создаст цифровых двойников — можно спросить «как обычно работает маркетолог», даже если он в отпуске.',
      placement: 'right',
      primaryAction: { label: 'Добавить должности', kind: 'navigate', href: '/roles' },
      secondaryAction: { label: 'Пропустить', kind: 'next' },
    },
    // B4 — Команда
    {
      id: 'team',
      target: '[data-tour-target="welcome.structure"]',
      title: 'Пригласите команду',
      body: 'Каждый получит письмо с логином, паролем и инструкцией по входу.',
      placement: 'right',
      primaryAction: { label: 'Пригласить сотрудников', kind: 'navigate', href: '/structure' },
      secondaryAction: { label: 'Пропустить', kind: 'next' },
    },
    // B5 — Первый спринт
    {
      id: 'sprint',
      target: '[data-tour-target="welcome.sprints"]',
      title: 'Поставьте первую цель уже на этой неделе',
      body: 'Спринт — недельный цикл с одной целью. Кора будет следить из встреч и чатов, реально ли команда идёт к цели.',
      placement: 'right',
      primaryAction: { label: 'Создать спринт', kind: 'navigate', href: '/sprints/new' },
      secondaryAction: { label: 'Пропустить', kind: 'next' },
    },
    // B6 — Первая встреча
    {
      id: 'meeting',
      target: '[data-tour-target="welcome.create-meeting"]',
      title: 'Проведите первую встречу',
      body: 'Через две минуты после звонка — расшифровка и ИИ-отчёт. Гостю не нужна регистрация — отправьте ссылку.',
      placement: 'right',
      primaryAction: { label: 'Создать встречу', kind: 'navigate', href: '/meetings/create' },
      secondaryAction: { label: 'Закончить', kind: 'complete' },
    },
  ],
};
