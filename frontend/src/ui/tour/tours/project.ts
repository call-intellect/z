/**
 * Тур №2 «Знакомство с проектом». 5 шагов. Запускается при первом
 * открытии любой страницы `/projects/[slug]/*`.
 *
 * Source: plans/tz/2026-05-27-tracker-onboarding-tour.md §"Тур №2".
 */

import type { TourDefinition } from '../types';

export const projectTour: TourDefinition = {
  id: 'project',
  steps: [
    {
      id: 'overview-tab',
      target: '[data-tour-target="project.overview-tab"]',
      title: 'Обзор проекта',
      body: 'Пульс проекта одним взглядом.',
      placement: 'bottom',
      primaryAction: { label: 'Дальше', kind: 'next' },
      secondaryAction: { label: 'Пропустить', kind: 'skip' },
    },
    {
      id: 'boards-sidebar',
      target: '[data-tour-target="project.boards-sidebar"]',
      title: 'Доски проекта',
      body: 'Несколько досок в одном проекте. Создайте доску для каждого направления.',
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
      secondaryAction: { label: 'Пропустить', kind: 'skip' },
    },
    {
      id: 'board-column',
      target: '[data-tour-target="project.board-column"]',
      title: 'Канбан-колонки',
      body: 'Перетащите задачу между колонками, чтобы сменить статус.',
      placement: 'top',
      primaryAction: { label: 'Дальше', kind: 'next' },
      secondaryAction: { label: 'Пропустить', kind: 'skip' },
    },
    {
      id: 'quick-add',
      target: '[data-tour-target="project.quick-add"]',
      title: '+ Задача',
      body: 'Введите название и нажмите Enter. Без модалок.',
      placement: 'top',
      primaryAction: { label: 'Дальше', kind: 'next' },
      secondaryAction: { label: 'Пропустить', kind: 'skip' },
    },
    {
      id: 'concierge',
      target: '[data-tour-target="welcome.concierge"]',
      title: 'Концьерж',
      body: 'Скажите словами: «создай задачу для Иванова на завтра по объекту Тверская» — Кора разберёт.',
      placement: 'left',
      primaryAction: { label: 'Готово', kind: 'complete' },
    },
  ],
};
