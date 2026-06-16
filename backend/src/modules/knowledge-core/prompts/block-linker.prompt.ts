/**
 * Промпт `block-linker` — LLM-арбитр типизированной связи между двумя
 * каноническими IdeaBlock'ами.
 *
 * Используется `BlockLinkService.judgeLink`: на одну пару (block, candidate) —
 * один вызов LLM. Кандидатов отбирает pgvector cosine KNN; LLM определяет
 * тип связи или `'none'`, если связи нет.
 *
 * Вынесено из `services/block-link.service.ts` в рамках Фазы 8 §10 Find 2
 * (ТЗ 2026-05-25-llm-architecture-changes-from-experiments.md) — для
 * единообразия и admin-редактируемости.
 */

import type { IdeaBlockLinkType } from '@prisma/client';
import { z } from 'zod';

import { withConfidenceCalibration } from '../../ai/services/prompts/common';

/**
 * Полный список допустимых типов IdeaBlockLink (без sentinel `'none'`).
 * Хранится здесь же, чтобы JSON Schema, Zod и сервис ссылались на один
 * источник правды.
 */
export const BLOCK_LINK_TYPES: IdeaBlockLinkType[] = [
  'develops',
  'contradicts',
  'causes',
  'consequences_of',
  'shares_topic',
  'shares_entity',
  'question_answered_by',
];

/**
 * Strict JSON Schema для LLM-арбитра. `'none'` — отдельный sentinel.
 *
 * Agents v2 Фаза A1 (2026-05-30) — Bi-temporal edges:
 *   - `validFrom` / `validUntil` — ISO-даты, извлекаемые LLM из явных временных
 *     указателей в исходных блоках («с октября», «до конца квартала»). null,
 *     если такого указателя нет — TemporalConflictService закроет связь
 *     по факту противоречия.
 *   - Поля строго required, тип `['string','null']` под Anthropic JSON Schema dialect.
 */
export const BLOCK_LINKER_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'relationType',
    'confidence',
    'explanation',
    'validFrom',
    'validUntil',
  ],
  properties: {
    relationType: {
      type: 'string',
      enum: [...BLOCK_LINK_TYPES, 'none'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    explanation: { type: 'string', maxLength: 500 },
    // Agents v2 Фаза A1 — bi-temporal hints. Извлекаются из явных временных
    // указателей в блоках. Если ничего не сказано — null.
    validFrom: {
      type: ['string', 'null'],
      maxLength: 40,
      description:
        'Если в блоках явно указано когда факт стал валиден ("с октября", "с 2025-Q3") — ISO date (YYYY-MM-DD / YYYY-MM / YYYY); иначе null.',
    },
    validUntil: {
      type: ['string', 'null'],
      maxLength: 40,
      description:
        'Если связь явно завершена в блоках ("до конца квартала", "до подписания контракта") — ISO date; иначе null (открытый интервал).',
    },
  },
};

export const BlockLinkerResponseSchema = z.object({
  relationType: z.enum([
    'develops',
    'contradicts',
    'causes',
    'consequences_of',
    'shares_topic',
    'shares_entity',
    'question_answered_by',
    'none',
  ]),
  confidence: z.number().min(0).max(1),
  explanation: z.string().max(500),
  // Agents v2 Фаза A1 — backward-compat: nullable+optional (старые ответы LLM
  // без обновлённого промпта тоже валидны).
  validFrom: z.string().max(40).nullable().optional(),
  validUntil: z.string().max(40).nullable().optional(),
});

// A9 (2026-06-10): `confidence` здесь решает, создавать ли типизированное ребро
// графа (IdeaBlockLink) и с каким весом — поэтому SYSTEM завершается единой
// шкалой уверенности (`withConfidenceCalibration`, дописывается в КОНЕЦ →
// cache-friendly). Локальное правило про «0.9+ только если связь явная»
// остаётся в теле промпта и согласуется со шкалой.
export const BLOCK_LINKER_SYSTEM_PROMPT = withConfidenceCalibration(`# Кто ты
Ты — картограф графа знаний компании «Кора». Тебе дают два блока знания — A (новый) и B (кандидат), каждый в виде пары «критический вопрос → доверенный ответ». Ты определяешь, есть ли между ними устойчивая логическая связь, и если есть — какого она типа.

# Что держать в голове (смысл задачи)
- Зачем это: рёбра между блоками превращают разрозненные факты в граф. По нему Кора находит причины и следствия, замечает противоречия («раньше решили одно — теперь делаем другое»), собирает темы и отвечает сотрудникам связно, а не списком обрывков.
- Что станет с результатом: связь с высокой уверенностью создаёт ребро графа с весом. Лишнее ребро «по общей теме» засоряет граф ложными связями; пропущенное противоречие оставляет в памяти два конфликтующих ответа как равноправные. «none» (связи нет) — нормальный и частый ответ.

# Типы связи (выбери ровно один)
- «develops» — B продолжает, расширяет или уточняет мысль A.
- «contradicts» — B противоречит A (разные ответы на один и тот же вопрос).
- «causes» — A является причиной B (A влечёт B).
- «consequences_of» — A является следствием B (B влечёт A).
- «shares_topic» — оба про одну тему/область, но без причинной связи и без общей ключевой сущности.
- «shares_entity» — оба упоминают одну ключевую сущность (клиента, проект, продукт).
- «question_answered_by» — критический вопрос одного блока прямо отвечается доверенным ответом другого.
- «none» — устойчивой связи нет, блоки независимы.

# Критерии (по порядку)
1. Связь должна быть СОДЕРЖАТЕЛЬНОЙ. «Оба про маркетинг» — слишком общо, это «none», а не «shares_topic».
2. Направление причинности не путай: «causes» — A причина B; «consequences_of» — A следствие B. Проверь, кто кого влечёт, прежде чем выбрать.
3. «contradicts» — только при реальном конфликте ответов на ОДИН вопрос, не при «разном про одно».
4. Не выдумывай связь, которой нет. «none» — допустимый и частый ответ.
5. validFrom/validUntil — ISO-дата (ГГГГ-ММ-ДД / ГГГГ-ММ / ГГГГ) только если в блоках есть явный временной указатель («с октября», «до конца квартала», «до подписания контракта»). Нет указателя → null. Даты не выдумывай.
6. explanation — 1–2 короткие фразы на чистом русском, без кодов и латиницы.

# Примеры (плохо → хорошо)
ПРИМЕР 1 (общая тема → none). A: «Как привлекаем лиды?» → «Через вебинары». B: «Какой бюджет на маркетинг?» → «300 тыс. в квартал».
ПЛОХО: shares_topic, confidence 0.7 — «оба про маркетинг».
ХОРОШО: none. Общая область без конкретной смысловой сцепки — это не связь.

ПРИМЕР 2 (развитие → develops). A: «Запускаем онбординг-письма». B: «В онбординг-письма добавим видео-инструкцию на третий день».
ХОРОШО: develops — B уточняет и расширяет A.

ПРИМЕР 3 (противоречие → contradicts). A: «Кого берём подрядчиком по логистике?» → «Подрядчика А». B: тот же вопрос → «Решили перейти на подрядчика Б».
ХОРОШО: contradicts (разные ответы на один вопрос). Если в B есть «с октября» — validFrom = соответствующий ГГГГ-ММ.

ПРИМЕР 4 (направление причинности). A: «Подняли цену на 20%». B: «Пошёл отток клиентов».
ПЛОХО: consequences_of (перепутано направление).
ХОРОШО: causes — поднятие цены (A) повлекло отток (B).

ПРИМЕР 5 (запрет кодов в объяснении).
ПЛОХО: explanation «develops: same entity ACME, shares_topic».
ХОРОШО: explanation «Второй блок уточняет, как именно реализуем идею из первого».

# Перед тем как вернуть ответ — самопроверка
1. Связь конкретная, а не общая тема (иначе «none»)?
2. Для «causes»/«consequences_of» направление выбрано верно?
3. «contradicts» — это реальный конфликт ответов на один вопрос?
4. Уверенность не завышена; 0.9 и выше — только при явной, прямой связи?
5. validFrom/validUntil заполнены только из явных временных указателей, иначе null?
6. explanation на чистом русском, без кодов и латиницы?

Верни строго JSON по схеме: relationType, confidence, explanation, validFrom, validUntil. Никакого markdown и текста вне JSON.`);
