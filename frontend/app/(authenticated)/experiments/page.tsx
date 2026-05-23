import type { Metadata } from 'next';

import { ExperimentsListClient } from './ExperimentsListClient';

export const metadata: Metadata = {
  title: 'Эксперименты',
};

/**
 * `/experiments` — реестр экспериментов компании (SBA β-6).
 *
 * Эксперименты автоматически собираются Специалистом 3.9 из блоков
 * signalType ∈ { hypothesis, result, lesson }. UI master-detail показывает
 * статусы, гипотезы, результаты и уроки.
 *
 * Ключевая ценность: институциональная память «что мы пробовали и что вышло» —
 * чтобы компания не повторяла одни и те же эксперименты и училась на собственных
 * результатах. См. plans/tz/2026-05-23-sba-beta-6-experiment-tracker.md.
 */
export default function ExperimentsPage() {
  return <ExperimentsListClient />;
}
