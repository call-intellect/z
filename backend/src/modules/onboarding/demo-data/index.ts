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
  key: string;
  label: string;
  fn: SeedFn;
}

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
