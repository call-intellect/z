/**
 * Agents v2 — Seed маршрутов LLM для новых taskType'ов зонтика
 * `plans/tz/2026-05-29-agents-v2-umbrella.md`.
 *
 * Фаза 0.1 (2026-05-30): только один taskType — `probe-response-classify`.
 * В следующих волнах сюда же добавятся остальные agents-v2 taskType'ы.
 *
 *   - probe-response-classify — лёгкий классификатор свободного ответа
 *     человека на probe-вопрос (текст или голос после ASR). Извлекает
 *     {answer, confidence, requiresFollowup}. JSON Schema strict.
 *     Сложность — дешёвая, поэтому primary = deepseek-v4-flash.
 *
 * Источник цепочек: docs/reference/llm-models-playbook.md §2.1 + verified-
 * карта second-brain/01_projects/llm-providers-verified.md (smoke 2026-05-21)
 * + правило feedback `Ollama qwen3.5:9b — только tertiary fallback`.
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-agents-v2.ts
 *   bun run scripts/seed-llm-task-routes-agents-v2.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - editedByAdmin=true — не перезаписываем.
 *   - Без флага — пропускаем existing.
 *   - С `--update-existing` — обновляем model/priority/isActive (но НЕ editedByAdmin).
 */

import { type LlmRouteTier } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface TierEntry {
  tier: LlmRouteTier;
  providerName: string;
  model: string;
}

interface TaskRouteSeed {
  taskType: string;
  playbookSection: string;
  chain: TierEntry[];
  /**
   * Закрепление версии модели на тестовый период. Текстовая заметка,
   * видимая супер-админу на /admin/llm-routes. Сохраняется на всех
   * записях одного taskType (для всех tier'ов одинаково).
   */
  pinnedVersionNote?: string;
}

const SEEDS: TaskRouteSeed[] = [
  {
    taskType: 'probe-response-classify',
    playbookSection:
      '§2.1 короткий JSON-классификатор. Дешёвая задача (1 вопрос + 1 свободный ответ → 3 поля JSON). Primary = deepseek-v4-flash, secondary = gpt-5.4-mini, tertiary = qwen3.5:9b (только safety-net).',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
    pinnedVersionNote: 'Закреплено 2026-05-30 для Agents v2 Фаза 0.1',
  },
  // ── Agents v2 Фаза A2 (2026-05-30) — Multi-Agent Debate ─────────────
  // Зонтичный taskType (используется для бюджетной аналитики и smoke-теста).
  // Реальные LLM-вызовы делает `MultiAgentDebateService` через три
  // stance-specific taskType ниже, каждый со своим primary провайдером.
  {
    taskType: 'debate-decision-supersede',
    playbookSection:
      '§2.4 capable nuanced арбитр. Используется как зонтичный route для агрегатной аналитики стоимости debate-сессии supersede-detect. Primary = deepseek-v4-pro (capable + thinking, лучший на nuanced reasoning); secondary = openai-via-proxy/gpt-5.4 (diverse провайдер); tertiary = ollama/qwen3:30b (capable safety-net).',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
    pinnedVersionNote: 'Закреплено 2026-05-30 для Multi-Agent Debate Фаза A2',
  },
  {
    taskType: 'debate-decision-supersede-critic',
    playbookSection:
      'Multi-Agent Debate stance "strict-critic". Primary = deepseek-v4-pro (capable + склонна к точному «отказу» при сомнении). Secondary/tertiary — для надёжности при downtime primary.',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
    pinnedVersionNote: 'Закреплено 2026-05-30 для Multi-Agent Debate Фаза A2 (strict-critic)',
  },
  {
    taskType: 'debate-decision-supersede-supporter',
    playbookSection:
      'Multi-Agent Debate stance "empathetic-supporter". Primary = openai-via-proxy/gpt-5.4 (другой провайдер для diversity голосов).',
    chain: [
      {
        tier: 'primary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4',
      },
      { tier: 'secondary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
    pinnedVersionNote: 'Закреплено 2026-05-30 для Multi-Agent Debate Фаза A2 (empathetic-supporter)',
  },
  {
    taskType: 'debate-decision-supersede-neutral',
    playbookSection:
      'Multi-Agent Debate stance "neutral-judge". Primary = deepseek-v4-flash (дешёвый арбитр; уравновешивает дороже-capable critic и supporter).',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
    pinnedVersionNote: 'Закреплено 2026-05-30 для Multi-Agent Debate Фаза A2 (neutral-judge)',
  },
  // ── Agents v2 Фаза B1 (2026-05-30) — AutoRule extract (shadow) ────
  // Сложная задача: извлечение паттерна из 3-8 пар (original, edited)
  // одного типа промпта. Capable модель с JSON Schema strict + thinking.
  // Primary = deepseek-v4-pro (лучший на nuanced reasoning); secondary =
  // gpt-5.4 (другой провайдер для diversity при downtime primary);
  // tertiary = ollama/qwen3:30b (capable safety-net, НЕ qwen3.5:9b —
  // слишком слабая для extraction).
  // См. plans/tz/2026-05-29-agents-v2-umbrella.md §B1.
  {
    taskType: 'autorule-extract',
    playbookSection:
      '§2.4 capable nuanced арбитр. Используется ночным cron\'ом AutoRuleExtractCron (03:00) для извлечения PromptRule из групп похожих PromptFeedback. Primary = deepseek-v4-pro; secondary = openai-via-proxy/gpt-5.4; tertiary = ollama/qwen3:30b (capable safety-net, не qwen3.5:9b).',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
    pinnedVersionNote: 'Закреплено 2026-05-30 для AutoRule Фаза B1',
  },
  // ── Agents v2 Фаза B2 (2026-05-30) — Concierge PRM step-scorer (shadow) ──
  // Дешёвый scorer: на входе один candidate tool_call + goal + краткая история,
  // на выходе {score 0..1, reasoning ≤500 chars}. Primary = deepseek-v4-flash
  // (cheap + достаточно умный для оценки); secondary = openai-via-proxy/
  // gpt-5.4-mini (diverse провайдер при downtime primary); tertiary = ollama/
  // qwen3.5:9b — здесь приемлем как safety-net (cheap scoring, не nuanced
  // extraction как у autorule-extract Фазы B1).
  // См. plans/tz/2026-05-29-agents-v2-umbrella.md §B2.
  {
    taskType: 'concierge-step-prm',
    playbookSection:
      '§2.1 короткий JSON-scorer. Дешёвая частая задача (1 кандидат → 2 поля JSON). Primary = deepseek-v4-flash, secondary = gpt-5.4-mini, tertiary = qwen3.5:9b (safety-net).',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
    pinnedVersionNote: 'Закреплено 2026-05-30 для Concierge PRM Фаза B2',
  },
  // ── Agents v2 Фаза C1 (2026-05-30) — PracticeSkill (executable skills) ─────
  // Извлечение и верификация выполняемых навыков клонов. См. §C1.
  //
  // practice-skill-extract — capable nuanced extractor (concept + traits +
  //   reasoning blocks → draft PracticeSkill). Primary = deepseek-v4-pro
  //   (лучший на nuanced reasoning + thinking); secondary = openai-via-proxy/
  //   gpt-5.4 (diverse провайдер); tertiary = ollama/qwen3:30b (capable
  //   safety-net, НЕ qwen3.5:9b — слишком слабая для извлечения steps).
  {
    taskType: 'practice-skill-extract',
    playbookSection:
      '§2.4 capable nuanced арбитр. Используется PracticeSkillExtractWorker для извлечения процедуры (trigger + steps + redFlags) из reasoning-блоков сотрудника. Primary = deepseek-v4-pro; secondary = openai-via-proxy/gpt-5.4; tertiary = ollama/qwen3:30b (capable safety-net, не qwen3.5:9b).',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
    pinnedVersionNote: 'Закреплено 2026-05-30 для PracticeSkill Фаза C1',
  },
  // practice-skill-adversarial-verify — дешёвая верификация (бинарный вердикт
  //   «нарушает redFlags / противоречит skill» на 5 sample usages). Primary =
  //   deepseek-v4-flash; secondary = gpt-5.4-mini; tertiary = qwen3.5:9b
  //   (cheap verdict, qwen3.5:9b приемлем как safety-net).
  {
    taskType: 'practice-skill-adversarial-verify',
    playbookSection:
      '§2.1 короткий JSON-классификатор. Дешёвая верификация (1 ответ + redFlags → бинарный вердикт). Primary = deepseek-v4-flash, secondary = gpt-5.4-mini, tertiary = qwen3.5:9b (safety-net).',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
    pinnedVersionNote: 'Закреплено 2026-05-30 для PracticeSkill Фаза C1',
  },
];

interface SeedStats {
  inserted: number;
  updated: number;
  skipped: number;
  protectedByAudit: number;
}

async function applySeed(
  seed: TaskRouteSeed,
  updateExisting: boolean,
  stats: SeedStats,
): Promise<void> {
  for (let i = 0; i < seed.chain.length; i++) {
    const entry = seed.chain[i];
    if (!entry) continue;
    const priority = i;
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
          pinnedVersionNote: seed.pinnedVersionNote ?? null,
        },
      });
      stats.inserted++;
      // eslint-disable-next-line no-console
      console.log(
        `[insert] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`,
      );
      continue;
    }
    if (existing.editedByAdmin) {
      stats.protectedByAudit++;
      // eslint-disable-next-line no-console
      console.log(
        `[skip:edited-by-admin] ${seed.taskType}/${entry.tier}/${entry.providerName}`,
      );
      continue;
    }
    if (!updateExisting) {
      stats.skipped++;
      continue;
    }
    const seedPin = seed.pinnedVersionNote ?? null;
    if (
      existing.model === entry.model &&
      existing.priority === priority &&
      existing.isActive === true &&
      existing.pinnedVersionNote === seedPin
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
        pinnedVersionNote: seedPin,
      },
    });
    stats.updated++;
    // eslint-disable-next-line no-console
    console.log(
      `[update] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`,
    );
  }
}

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(
    `=== seed-llm-task-routes-agents-v2 START (updateExisting=${updateExisting}) ===`,
  );
  // eslint-disable-next-line no-console
  console.log(`TaskTypes: ${SEEDS.map((s) => s.taskType).join(', ')}`);

  const stats: SeedStats = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    protectedByAudit: 0,
  };

  for (const seed of SEEDS) {
    await applySeed(seed, updateExisting, stats);
  }

  // eslint-disable-next-line no-console
  console.log(
    `inserted=${stats.inserted}, updated=${stats.updated}, skipped=${stats.skipped}, protected_by_admin=${stats.protectedByAudit}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-agents-v2 DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-agents-v2 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
