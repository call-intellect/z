import type { Metadata } from 'next';

import { SignalTypeMonitorClient } from './SignalTypeMonitorClient';

export const metadata: Metadata = {
  title: 'Signal-type monitor — Z-Admin',
};

/**
 * G.2 KC-Temporal (2026-05-25) — `/admin/ai/signal-type-monitor`.
 *
 * Мониторинг classifier'а signalType: для каждой Org показывает распределение
 * за 7 дней + матрицу переходов (от какого signalType к какому в рамках
 * одного rawEvent). Используется для отслеживания «дрейфа» классификатора
 * после правки промптов block-distill.
 *
 * Источник данных: `SignalTypeStatsCron` (`0 2 * * *`) → `AdminSetting{
 * key=signal_type_transition_matrix:<orgId>}` → `SignalTypeMonitorController`.
 */
export default function AdminSignalTypeMonitorPage() {
  return <SignalTypeMonitorClient />;
}
