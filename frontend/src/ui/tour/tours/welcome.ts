/**
 * Тур №1 «Знакомство при первом входе». 8 шагов.
 *
 * Source: plans/tz/2026-05-27-tracker-onboarding-tour.md §"Тур №1".
 */

import type { TourDefinition } from '../types';

export const welcomeTour: TourDefinition = {
  id: 'welcome',
  steps: [
    {
      id: 'logo',
      target: '[data-tour-target="welcome.sidebar-logo"]',
      title: 'Привет! Это Кора',
      body: 'Память вашей компании. Покажу основные разделы за 90 секунд.',
      placement: 'right',
      primaryAction: { label: 'Поехали', kind: 'next' },
      secondaryAction: { label: 'Пропустить', kind: 'skip' },
    },
    {
      id: 'home',
      target: '[data-tour-target="welcome.sidebar-home"]',
      title: 'Главная',
      body: 'Ваш дашборд: что важно сегодня.',
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
      secondaryAction: { label: 'Пропустить', kind: 'skip' },
    },
    {
      id: 'meetings',
      target: '[data-tour-target="welcome.sidebar-meetings"]',
      title: 'Встречи',
      body: 'Все встречи с записью и AI-отчётом. Можно стартовать видеовстречу прямо отсюда.',
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
      secondaryAction: { label: 'Пропустить', kind: 'skip' },
    },
    {
      id: 'cards',
      target: '[data-tour-target="welcome.sidebar-cards"]',
      title: 'Карточки',
      body: 'Карточки клиентов и сделок. Встречи привязываются к карточке.',
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
      secondaryAction: { label: 'Пропустить', kind: 'skip' },
    },
    {
      id: 'projects',
      target: '[data-tour-target="welcome.sidebar-projects"]',
      title: 'Проекты',
      body: 'Задачи команды: доски, циклы, исполнители.',
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
      secondaryAction: { label: 'Пропустить', kind: 'skip' },
    },
    {
      id: 'intake',
      target: '[data-tour-target="welcome.sidebar-intake"]',
      title: 'Входящие',
      body: 'Сюда падают задачи, в которых вас отметили или назначили.',
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
      secondaryAction: { label: 'Пропустить', kind: 'skip' },
    },
    {
      id: 'chat',
      target: '[data-tour-target="welcome.sidebar-chat"]',
      title: 'Помощник компании',
      body: 'AI-чат, который знает всё из встреч и решений компании.',
      placement: 'right',
      primaryAction: { label: 'Дальше', kind: 'next' },
      secondaryAction: { label: 'Пропустить', kind: 'skip' },
    },
    {
      id: 'concierge',
      target: '[data-tour-target="welcome.concierge"]',
      title: 'Концьерж',
      body: 'Здесь можно задать любой вопрос: создать задачу, найти встречу, написать в чат.',
      placement: 'left',
      primaryAction: { label: 'Готово', kind: 'complete' },
    },
  ],
};
