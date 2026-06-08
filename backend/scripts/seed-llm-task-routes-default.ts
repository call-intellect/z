/**
 * Фаза A.4 — Seed дефолтных цепочек моделей для всех `LlmTaskType`-ов.
 *
 * Источник: `docs/reference/llm-models-playbook.md` §2.1 «Дефолтная маршрутизация
 * taskType → primary → fallback (2026-05)». Расширено taskType'ами competitor-parity
 * (sub-TZ B/C/D/E): `behavior-refine`, `meeting-quality-score`, `transcript-clean-refine`
 * и т.п.
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - Записи с `editedByAdmin=true` НЕ перезаписываются.
 *   - Если для taskType уже есть хотя бы одна запись в `LlmTaskRouteChange` —
 *     считаем, что админ менял маршрут вручную: пропускаем (нужен `--force`).
 *   - С флагом `--force` — переписываем ВСЁ (для CI или ручной починки).
 *
 * Запуск (Docker должен быть запущен для prisma push, у нас сейчас выключен):
 *   bun run scripts/seed-llm-task-routes-default.ts
 *   bun run scripts/seed-llm-task-routes-default.ts --force
 *
 * Совместимость: одна нормализованная запись = ОДИН провайдер + tier + priority.
 * Старая JSON-форма `providers` остаётся `null` в новых записях. Legacy-записи
 * (с `providers JSON`) роутер продолжает понимать через fallback.
 */

import { PrismaClient, type LlmRouteTier } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

/** Один уровень цепочки. */
interface TierEntry {
  tier: LlmRouteTier;
  providerName: string;
  model: string;
  priority?: number;
}

/** Цепочка для одного taskType. Минимум 1 уровень, максимум — сколько нужно. */
interface TaskRouteSeed {
  taskType: string;
  /** Группа для отображения в `/admin/ai-models` (knowledge-core / ai-pipeline / competitor-parity). */
  group: 'ai-pipeline' | 'knowledge-core' | 'competitor-parity';
  /** Раздел playbook'а, на который ссылается комментарий рядом с цепочкой. */
  playbookSection: string;
  chain: TierEntry[];
}

// Цепочки выровнены под playbook §2.1. Согласно §11 — Anthropic в дефолтных
// цепочках НЕ присутствует (super_admin может добавить вручную). Tertiary с
// 2026-06-05 — kie:gemini-3.1-pro (универсальный fallback); ollama убран из
// дефолтных кодовых цепочек (остаётся опц. локальный safety-net через UI/БД).
const ROUTES: TaskRouteSeed[] = [
  // ─── AI-pipeline встреч (legacy taskType'ы) ───
  {
    taskType: 'summary',
    group: 'ai-pipeline',
    playbookSection: '§2.1 summary-v2',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.5' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'tasks',
    group: 'ai-pipeline',
    playbookSection: '§2.1 task-extract-v2',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'chapters',
    group: 'ai-pipeline',
    playbookSection: '§2.1 chapter-extract-v2',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'chat',
    group: 'ai-pipeline',
    playbookSection: '§2.1 chat-v2',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'regenerate-section',
    group: 'ai-pipeline',
    playbookSection: '§11 generalPurpose',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'custom-prompt',
    group: 'ai-pipeline',
    playbookSection: '§11 generalPurpose',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'follow-up',
    group: 'ai-pipeline',
    playbookSection: '§11 generalPurpose',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'clip-title',
    group: 'ai-pipeline',
    playbookSection: '§11 classifier',
    chain: [
      { tier: 'primary', providerName: 'openai-via-proxy', model: 'gpt-5.4-nano' },
      { tier: 'secondary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'card-rollup',
    group: 'ai-pipeline',
    playbookSection: '§2.1 card-rollup-v2',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'card-chat',
    group: 'ai-pipeline',
    playbookSection: '§2.1 chat-v2',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },

  // ─── Knowledge-core ───
  {
    taskType: 'block-ingest',
    group: 'knowledge-core',
    playbookSection: '§2.1 block-ingest',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'block-distill',
    group: 'knowledge-core',
    playbookSection: '§2.1 block-distill',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-nano' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'block-linker',
    group: 'knowledge-core',
    playbookSection: '§2.1 block-linker',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-nano' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'entity-resolver',
    group: 'knowledge-core',
    playbookSection: '§2.1 entity-resolver',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-nano' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'entity-merge-arbiter',
    group: 'knowledge-core',
    playbookSection: '§2.1 entity-merge-arbiter',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'entity-graph-builder',
    group: 'knowledge-core',
    playbookSection: '§11 generalPurpose',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'theme-classify',
    group: 'knowledge-core',
    playbookSection: '§2.1 theme-classify',
    chain: [
      { tier: 'primary', providerName: 'openai-via-proxy', model: 'gpt-5.4-nano' },
      { tier: 'secondary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'reframing',
    group: 'knowledge-core',
    playbookSection: '§2.1 reframing',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'card-rollup-v2',
    group: 'knowledge-core',
    playbookSection: '§2.1 card-rollup-v2',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'task-extract-v2',
    group: 'knowledge-core',
    playbookSection: '§2.1 task-extract-v2',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'chapter-extract-v2',
    group: 'knowledge-core',
    playbookSection: '§2.1 chapter-extract-v2',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'summary-v2',
    group: 'knowledge-core',
    playbookSection: '§2.1 summary-v2 (heavyReasoning)',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.5' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'chat-v2',
    group: 'knowledge-core',
    playbookSection: '§2.1 chat-v2',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'goal-alignment',
    group: 'knowledge-core',
    playbookSection: '§2.1 goal-alignment (heavyReasoning)',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.5' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'dashboard-summary',
    group: 'knowledge-core',
    playbookSection: '§2.1 dashboard-summary',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'role-profile-build',
    group: 'knowledge-core',
    playbookSection: '§2.1 role-profile',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  // TZ-1 Фаза 1 (daily-value-engine) — Радар клиентов под риском.
  // ТОЛЬКО финальная формулировка подсказки (агрегация — SQL/TS, без LLM) →
  // дешёвая задача, primary deepseek-v4-flash. Без ₽-оценок (Р6).
  {
    taskType: 'customer-risk-digest',
    group: 'knowledge-core',
    playbookSection: '§11 generalPurpose (cheap hint)',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  // TZ-1 Фаза 2 (daily-value-engine) — движок рядового «Твой день».
  // ТОЛЬКО «1 подсказка дня» (бриф структурный, «кто знает X» — embeddings) →
  // дешёвая задача, primary deepseek-v4-flash. Без выдуманных фактов/₽.
  {
    taskType: 'personal-brief-hint',
    group: 'knowledge-core',
    playbookSection: '§11 generalPurpose (cheap hint)',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  // TZ-1 Фаза 3.A (daily-value-engine) — накопительный синтез блокеров.
  // ТОЛЬКО финальный абзац-сводка (кластеризация/статусы/импакт — SQL/TS +
  // embeddings) → дешёвая задача, primary deepseek-v4-flash. Без выдуманных ₽.
  {
    taskType: 'blocker-synthesis-summary',
    group: 'knowledge-core',
    playbookSection: '§11 generalPurpose (cheap summary)',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },

  // ─── Competitor-parity (Фазы B/C/D/E) ───
  // Резервируем taskType'ы заранее, чтобы /admin/ai-models был готов к ним
  // (по правилу зонтика §3.7: каждый sub-TZ регистрирует свои taskType'ы в этом
  // seed-файле, или PR не проходит ревью).
  {
    taskType: 'transcript-clean-refine',
    group: 'competitor-parity',
    playbookSection: '§2.1 chat-v2 (similar workload)',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'behavior-refine',
    group: 'competitor-parity',
    playbookSection: '§2.1 chat-v2 (sub-TZ B)',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'meeting-quality-score',
    group: 'competitor-parity',
    playbookSection: '§11 classifier (sub-TZ B)',
    chain: [
      { tier: 'primary', providerName: 'openai-via-proxy', model: 'gpt-5.4-nano' },
      { tier: 'secondary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
];

interface SeedStats {
  inserted: number;
  updated: number;
  skipped: number;
  protectedByAudit: number;
}

async function applySeedForTask(
  seed: TaskRouteSeed,
  force: boolean,
  stats: SeedStats,
): Promise<void> {
  // Защита от перезаписи: если есть LlmTaskRouteChange для taskType — админ
  // уже менял цепочку. Без --force ничего не делаем.
  if (!force) {
    const auditCount = await prisma.llmTaskRouteChange.count({
      where: { taskType: seed.taskType, tenantId: null },
    });
    if (auditCount > 0) {
      stats.protectedByAudit++;
      // eslint-disable-next-line no-console
      console.log(`[skipped:audit] ${seed.taskType} (audit log has ${auditCount} entries)`);
      return;
    }
  }

  for (let i = 0; i < seed.chain.length; i++) {
    const entry = seed.chain[i];
    if (!entry) continue;
    const priority = entry.priority ?? i;
    const existing = await prisma.llmTaskRoute.findFirst({
      where: {
        taskType: seed.taskType,
        tenantId: null,
        tier: entry.tier,
        providerName: entry.providerName,
      },
    });
    if (!existing) {
      await prisma.llmTaskRoute.create({
        data: {
          taskType: seed.taskType,
          tenantId: null,
          tier: entry.tier,
          providerName: entry.providerName,
          model: entry.model,
          priority,
          providers: null,
          isActive: true,
          editedByAdmin: false,
        },
      });
      stats.inserted++;
      continue;
    }
    if (existing.editedByAdmin && !force) {
      stats.protectedByAudit++;
      continue;
    }
    if (
      existing.model === entry.model &&
      existing.priority === priority &&
      existing.isActive === true
    ) {
      stats.skipped++;
      continue;
    }
    await prisma.llmTaskRoute.update({
      where: { id: existing.id },
      data: {
        model: entry.model,
        priority,
        isActive: true,
      },
    });
    stats.updated++;
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  // eslint-disable-next-line no-console
  console.log(`=== seed-llm-task-routes-default START (force=${force}) ===`);
  // eslint-disable-next-line no-console
  console.log(`Routes to apply: ${ROUTES.length}`);

  const stats: SeedStats = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    protectedByAudit: 0,
  };

  for (const seed of ROUTES) {
    await applySeedForTask(seed, force, stats);
  }

  // eslint-disable-next-line no-console
  console.log(
    `inserted=${stats.inserted}, updated=${stats.updated}, skipped=${stats.skipped}, protected_by_audit_or_edit=${stats.protectedByAudit}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-default DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-default FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

// Экспортируем массив для тестов (unit-test проверяет, что 28+ taskType'ов
// и у каждого 3 tier'а).
export { ROUTES };
