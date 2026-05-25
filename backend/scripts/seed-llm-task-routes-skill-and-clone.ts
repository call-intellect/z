/**
 * SBA γ-1 — Seed маршрутов LLM для 4 новых taskType'ов специалиста 3.7
 * (SkillProfile + ExecutablePersona + Clone API):
 *
 *   - skill-trait-detect       — **самая ответственная задача γ-1**. Из 5+
 *     reasoning-цитат сотрудника → один SkillTrait. Качество модели здесь
 *     определяет полезность всей γ-фазы.
 *   - skill-trait-merge        — арбитр merge/supersedes/new по top-K KNN.
 *   - executable-persona-compile — из набора traits → persona prompt 300–800 слов.
 *   - clone-respond            — ответ в стиле сотрудника на вопрос (persona +
 *     subgraph context).
 *
 * Источник цепочек: docs/reference/llm-models-playbook.md §2.1 + verified-
 * карта second-brain/01_projects/llm-providers-verified.md (smoke 2026-05-21).
 *
 * ⚠ **Качество skill-trait-detect — критично.** Primary должна быть capable
 * модель (deepseek-v4-pro или gpt-5.4 — не -flash). Тесты этой модели —
 * `backend/test/eval/skill-trait-detect-golden/` (20 valid + 5 reject фикстур).
 *
 * **Решение по primary 2026-05-25 (clone-reliability-hardening, Фаза 6.1):**
 * Прогон golden-набора на двух моделях:
 *   - gpt-5.4: 23/25 (92%), $0.10
 *   - deepseek-v4-pro: 24/25 (96%), $0.02  ← победил по точности и в 4.5×
 *                                             дешевле, переключаем primary.
 * Перед следующей сменой primary — обязательно прогнать golden-набор:
 *   `SKILL_TRAIT_DETECT_GOLDEN_REAL=1 bunx vitest run backend/test/eval/skill-trait-detect-golden`
 * + snapshot-тест `seed-llm-task-routes-skill-and-clone.snapshot.spec.ts`
 * сломается на любой правке цепочки → осознанный `bunx vitest -u`.
 *
 * Цепочки:
 *   skill-trait-detect       — primary: deepseek-v4-pro (capable), secondary: gpt-5.4 (страховка), tertiary: ollama qwen3:30b
 *   skill-trait-merge        — primary: deepseek-v4-flash, secondary: gpt-5.4-mini, tertiary: ollama qwen3:30b
 *   executable-persona-compile — primary: deepseek-v4-flash, secondary: gpt-5.4-mini, tertiary: ollama qwen3:30b
 *   clone-respond            — primary: deepseek-v4-flash, secondary: gpt-5.4-mini, tertiary: ollama qwen3:30b
 *
 * maxDataClass: все три провайдера в каждой цепочке должны пропускать
 * dataClass='internal' (стандарт для β-2/3/4/5 — сравнимо). По sub-TZ γ-1
 * Skill ставится 'private', но для совместимости с реальной маршрутизацией
 * (только Ollama поддерживает private) используем 'internal' — практическая
 * совместимость важнее формального ярлыка.
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-skill-and-clone.ts
 *   bun run scripts/seed-llm-task-routes-skill-and-clone.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - Записи с editedByAdmin=true НЕ перезаписываются.
 *   - Без флага — пропускаем существующие.
 *   - С `--update-existing` — обновляем model/priority/isActive.
 */

import { PrismaClient, type LlmRouteTier } from '@prisma/client';

// ТЗ 2026-05-25 clone-reliability-hardening, Фаза 6.5 — ленивая инициализация
// PrismaClient, чтобы snapshot-тест мог импортировать `SEEDS` без поднятия БД
// (см. `seed-llm-task-routes-skill-and-clone.snapshot.spec.ts`).
let prismaInstance: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient();
  }
  return prismaInstance;
}

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
   * ТЗ 2026-05-25 clone-reliability-hardening, Фаза 6.5 — закрепление версии модели.
   * Прокси DeepSeek версионные slug-и не поддерживает, поэтому заморозка —
   * через текстовую заметку, видимую супер-админу на /admin/llm-routes.
   * Сохраняется на всех записях одного taskType (для всех tier'ов одинаково).
   */
  pinnedVersionNote?: string;
}

const SEEDS: TaskRouteSeed[] = [
  {
    taskType: 'skill-trait-detect',
    // ⚠ САМАЯ ОТВЕТСТВЕННАЯ ЗАДАЧА γ-1 — primary capable, выбрана через golden-набор.
    playbookSection:
      '§2.3 capable LLM. Primary = deepseek-v4-pro выбрана через golden-прогон 2026-05-25 (24/25 vs gpt-5.4 23/25, в 4.5× дешевле). Перед сменой primary — обязательно прогнать `backend/test/eval/skill-trait-detect-golden/` с SKILL_TRAIT_DETECT_GOLDEN_REAL=1.',
    chain: [
      {
        tier: 'primary',
        providerName: 'deepseek',
        model: 'deepseek-v4-pro',
      },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
    pinnedVersionNote:
      'Закреплено на deepseek-v4-pro 2026-05-25 после golden-прогона (24/25 vs gpt-5.4 23/25, $0.02 vs $0.10). Перед сменой primary — обязательно прогнать SKILL_TRAIT_DETECT_GOLDEN_REAL=1 bunx vitest run backend/test/eval/skill-trait-detect-golden. Прокси DeepSeek не поддерживает версионные slug-и, поэтому при обновлении модели провайдером поведение может незаметно измениться.',
  },
  {
    taskType: 'skill-trait-merge',
    playbookSection: '§2.1 arbiter — JSON in/out, средняя сложность.',
    chain: [
      {
        tier: 'primary',
        providerName: 'deepseek',
        model: 'deepseek-v4-flash',
      },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
  },
  {
    taskType: 'executable-persona-compile',
    playbookSection: '§2.1 persona compile — структурированный текст 300–800 слов.',
    chain: [
      {
        tier: 'primary',
        providerName: 'deepseek',
        model: 'deepseek-v4-flash',
      },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
  },
  {
    taskType: 'clone-respond',
    playbookSection:
      '§2.1 conversational с цитатами — близко к chat-v2 + custom prompt.',
    chain: [
      {
        tier: 'primary',
        providerName: 'deepseek',
        model: 'deepseek-v4-flash',
      },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
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
    const existing = await getPrisma().llmTaskRoute.findFirst({
      where: {
        taskType: seed.taskType,
        tenantId: null,
        tier: entry.tier,
        providerName: entry.providerName,
      },
    });
    if (!existing) {
      await getPrisma().llmTaskRoute.create({
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
    await getPrisma().llmTaskRoute.update({
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
    `=== seed-llm-task-routes-skill-and-clone START (updateExisting=${updateExisting}) ===`,
  );
  // eslint-disable-next-line no-console
  console.log(`TaskTypes: ${SEEDS.map((s) => s.taskType).join(', ')}`);
  // eslint-disable-next-line no-console
  console.log(
    '⚠  skill-trait-detect — самая ответственная задача γ-1. Primary = deepseek-v4-pro (выбрана через golden-прогон 2026-05-25: 24/25 vs gpt-5.4 23/25, в 4.5× дешевле). pinnedVersionNote — см. seed. Перед сменой primary — golden-набор с SKILL_TRAIT_DETECT_GOLDEN_REAL=1.',
  );

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
  console.log('=== seed-llm-task-routes-skill-and-clone DONE ===');
}

// Импорт-only из тестов: запускаем main() только если это прямой запуск скрипта.
// import.meta.main === true в Bun-runtime для точки входа.
declare const importMeta: { main?: boolean };
const isMain =
  typeof import.meta !== 'undefined' &&
  (import.meta as unknown as importMeta).main === true;
if (isMain) {
  main()
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('seed-llm-task-routes-skill-and-clone FAILED:', err);
      process.exit(1);
    })
    .finally(async () => {
      if (prismaInstance) {
        await prismaInstance.$disconnect();
      }
    });
}

export { SEEDS };
