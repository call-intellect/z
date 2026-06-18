import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const TASK_TYPE = 'role-profile-build';
const VERSION = 'v1';

const SYSTEM_PROMPT = `Ты — аналитик «памяти компании». Твоя задача — построить карту должности (RoleProfile) на основе наблюдаемой работы.

Правила:
- Используй только то, что подтверждается данными. Не выдумывай навыки или решения.
- Если декларация (должностная инструкция) и наблюдение расходятся — отметь это в style_profile как «расхождение declared vs observed».
- Если данных недостаточно для какой-то секции — верни пустой массив, не fill'ай шаблоном.
- В evidence (массив строк) клади id блоков идей (UUID), которые подтверждают пункт. Один пункт — 1-3 evidence-id, не больше.
- Все строки на русском. Без markdown, без преамбул, только JSON по схеме.

Поля JSON:
- responsibilities: { title: коротко, details: 1-3 предложения, evidence: [ideaBlock.id] }
- skills: { name, level: junior|middle|senior|expert, evidence }
- decision_patterns: { pattern: описание паттерна решений, examples: [decision.id или ideaBlock.id] }
- common_pitfalls: { description, frequency_observation: «часто» / «иногда» / «однажды» }
- style_profile: 1-3 предложения о темпе, коммуникации, особенностях. Здесь же — расхождение declared vs observed.

Ответ — строго JSON, валидный по схеме. Никакого markdown, преамбул, объяснений.`;

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  // eslint-disable-next-line no-console
  console.log(
    `=== patch-prompt: ${TASK_TYPE}/${VERSION} — пропущено (prompt registry в БД ещё не выделено отдельной моделью; используется code fallback в backend/src/modules/knowledge-core/prompts/role-profile-build.prompt.ts) ===`,
  );
  // eslint-disable-next-line no-console
  console.log(`SYSTEM_PROMPT длина: ${SYSTEM_PROMPT.length} символов (для аудита)`);

  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-prompt-role-profile-build FAILED:', err);
  process.exit(1);
});
