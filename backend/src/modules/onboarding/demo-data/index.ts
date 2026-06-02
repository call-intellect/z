/**
 * Демо-данные «ТехноСтрим» — единая точка запуска всех seed-модулей.
 *
 * Один порядок вызовов используется из ТРЁХ мест:
 *   1. `OnboardingService.seedDemoWorkspace` (HTTP-эндпоинт /admin/demo + super-admin)
 *   2. `backend/scripts/patch-create-reference-demo-org.ts` (prod-bootstrap эталона)
 *   3. `backend/scripts/seed-demo-workspace.ts` (CLI dev/staging)
 *
 * Любое изменение списка (добавили новый seed-модуль) делается ТОЛЬКО здесь.
 *
 * Порядок зависимостей (см. ТЗ 2026-05-31-demo-content-expansion-pulse §5):
 *   users → org-structure → process-templates → vendors → tracker → meetings →
 *   knowledge-graph → goals-clones → regulations → ideas → documents →
 *   calendar → experiments → brand-voice → probe-events → operations →
 *   pulse-snapshots → helpfulness → referrals → feedback → chat-notifications →
 *   polish.
 *
 * Источник правды: ТЗ 2026-06-01-demo-shared-org-model §4.7 (Gap fix).
 */
import { seedChatNotifications } from './chat-notifications';
import {
  seedBrandVoice,
  seedCalendar,
  seedDocuments,
  seedExperiments,
  seedFeedback,
  seedIdeas,
  seedProbeEvents,
  seedReferrals,
  seedRegulations,
  seedVendors,
} from './extras';
import { seedGoalsClones } from './goals-clones';
import { seedHelpfulness } from './helpfulness';
import { seedKnowledgeGraph } from './knowledge-graph';
import { seedMeetings } from './meetings';
import { seedOperations } from './operations';
import { seedOrgStructure } from './org-structure';
import { seedPolish } from './polish';
import { seedProcessTemplates } from './process-templates';
import { seedPulseSnapshots } from './pulse-snapshots';
import { seedTracker } from './tracker';
import type { IdMap, SeedContext, SeedFn } from './types';
import { seedUsers } from './users';

export interface DemoSeedStep {
  /** Стабильный ключ для логов и метрик. */
  key: string;
  /** Человеко-читаемое имя. */
  label: string;
  fn: SeedFn;
}

/**
 * Полный упорядоченный список шагов сидинга «ТехноСтрим». Если добавляешь
 * новый seed-модуль — вставь его сюда в правильное место зависимостей.
 */
export const DEMO_SEED_STEPS: ReadonlyArray<DemoSeedStep> = [
  { key: 'users', label: 'Демо-User-ы', fn: seedUsers },
  { key: 'org-structure', label: 'Орг-структура', fn: seedOrgStructure },
  { key: 'process-templates', label: 'ProcessTemplate', fn: seedProcessTemplates },
  { key: 'vendors', label: 'Vendor-ы', fn: seedVendors },
  { key: 'tracker', label: 'Трекер', fn: seedTracker },
  { key: 'meetings', label: 'Встречи', fn: seedMeetings },
  { key: 'knowledge-graph', label: 'Граф знаний', fn: seedKnowledgeGraph },
  { key: 'goals-clones', label: 'Цели и клоны', fn: seedGoalsClones },
  { key: 'regulations', label: 'Регламенты', fn: seedRegulations },
  { key: 'ideas', label: 'Идеи + кластеры', fn: seedIdeas },
  { key: 'documents', label: 'Документы', fn: seedDocuments },
  { key: 'calendar', label: 'Календарь', fn: seedCalendar },
  { key: 'experiments', label: 'Эксперименты', fn: seedExperiments },
  { key: 'brand-voice', label: 'BrandVoice', fn: seedBrandVoice },
  { key: 'probe-events', label: 'Probe-события', fn: seedProbeEvents },
  { key: 'operations', label: 'Чек-ины и дайджесты', fn: seedOperations },
  { key: 'pulse-snapshots', label: 'Pulse-снапшоты', fn: seedPulseSnapshots },
  { key: 'helpfulness', label: 'Helpfulness/Contribution', fn: seedHelpfulness },
  { key: 'referrals', label: 'Реф-программа', fn: seedReferrals },
  { key: 'feedback', label: 'Feedback (обратная связь)', fn: seedFeedback },
  { key: 'chat-notifications', label: 'Чат и уведомления', fn: seedChatNotifications },
  { key: 'polish', label: 'Полировка', fn: seedPolish },
];

/**
 * Прогоняет все seed-модули последовательно. Между шагами `await`'ит каждый,
 * чтобы зависимости (ProcessTemplate перед FrictionReport и т.п.) точно были
 * созданы. Опциональный `onStep` колбэк используется CLI / patch-скриптами
 * для пошагового вывода в stdout.
 */
export async function runAllSeedSteps(
  ctx: SeedContext,
  ids: IdMap,
  onStep?: (step: DemoSeedStep, index: number, total: number) => void,
): Promise<void> {
  const total = DEMO_SEED_STEPS.length;
  for (let i = 0; i < total; i++) {
    const step = DEMO_SEED_STEPS[i]!;
    onStep?.(step, i, total);
    await step.fn(ctx, ids);
  }
}
