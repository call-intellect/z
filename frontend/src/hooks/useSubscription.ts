'use client';

/**
 * Хук `useSubscription` — тонкая реэкспорт-обёртка над SubscriptionContext.
 *
 * Компоненты используют этот хук вместо прямого импорта контекста.
 * Единая точка доступа к статусу подписки и управлению PaywallModal.
 *
 * ТЗ: plans/tz/2026-05-28-paywall-no-trial.md §4.
 */

export { useSubscription } from '@/contexts/subscription-context';
