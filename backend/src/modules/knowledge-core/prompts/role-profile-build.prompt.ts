/**
 * Промпт `role-profile-build-v2` (SBA α-8 wave 4) — сборка карты должности
 * (RoleProfile.summaryCache) из observed-данных графа.
 *
 * Расширение wave 4: вместо 5 полей старой схемы — 9 нормализованных слотов
 * Role Map. Поле `summaryCache` остаётся как «быстрый» JSON-кеш для UI;
 * канонические данные wave-2 моделей живут в нормализованных таблицах
 * (ResponsibilityElement / AuthorityBoundary / RequiredKnowledge /
 * DecisionPolicy / Interaction). Старые поля (responsibilities/skills/...)
 * сохраняются для backward-compat существующего UI до миграции на Role Map view.
 *
 * Источник — plans/tz/2026-05-21-phase-0d-role-profile-agent.md §6.1 +
 * plans/tz/2026-05-23-sba-alpha-8-wave4-role-map-worker-rest-ui.md §3.3.
 *
 * Регистрируется в `LlmRouterService` через `taskType='role-profile-build'`.
 */

import { z } from 'zod';

import { withPeopleHypothesisGuard } from '../../ai/services/prompts/common';

import { signalTypeLabel } from './signal-type-label';

/**
 * Zod-схема для парсинга ответа LLM. Используется в
 * `RoleProfileService.build` для validate + сохранения в
 * `RoleProfile.summaryCache`.
 *
 * 9 слотов Role Map (см. ТЗ wave 4 §3.3):
 *   1. responsibilities — за что отвечает
 *   2. authority — границы полномочий
 *   3. knowledge — требуемые знания
 *   4. decisions — политики принятия решений
 *   5. interactions — типовые взаимодействия
 *   6. metrics — KPI и наблюдаемые показатели
 *   7. ownership — обязательства / ownership scope
 *   8. kpi_links — на какие метрики компании влияет
 *   9. style_profile — стиль / completeness self-rating
 *
 * Backward-compat: оставлены старые `skills[]`, `decision_patterns[]`,
 * `common_pitfalls[]` — их использует existing UI (frontend RoleProfileSection).
 */
export const RoleProfileSchema = z.object({
  // 1. Обязанности (полный аналог wave 2 ResponsibilityElement.kind=outcome|function|activity).
  responsibilities: z
    .array(
      z.object({
        title: z.string().min(1),
        kind: z.enum(['outcome', 'function', 'activity']).default('function'),
        details: z.string(),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  // 2. Границы полномочий (wave 2 AuthorityBoundary).
  authority: z
    .array(
      z.object({
        kind: z
          .enum(['allowed', 'requires_approval', 'forbidden'])
          .default('allowed'),
        scope: z.string().min(1),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  // 3. Требуемые знания (wave 2 RequiredKnowledge).
  knowledge: z
    .array(
      z.object({
        topic: z.string().min(1),
        importance: z
          .enum(['mandatory', 'preferred', 'nice_to_have'])
          .default('preferred'),
        expectedLevel: z
          .enum(['beginner', 'intermediate', 'expert'])
          .nullable()
          .default(null),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  // 4. Политики принятия решений (wave 2 DecisionPolicy).
  decisions: z
    .array(
      z.object({
        name: z.string().min(1),
        rule: z.string().min(1),
        condition: z.string().default(''),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  // 5. Взаимодействия (wave 2 Interaction).
  interactions: z
    .array(
      z.object({
        kind: z.string().min(1),
        counterpart: z.string().default(''),
        frequency: z.string().default(''),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  // 6. KPI / наблюдаемые показатели (Metric).
  metrics: z
    .array(
      z.object({
        name: z.string().min(1),
        unit: z.string().default(''),
        target: z.string().default(''),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  // 7. Ownership scope (что в зоне ответственности с точки зрения compliance / ресурсов).
  ownership: z
    .array(
      z.object({
        what: z.string().min(1),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  // 8. KPI links — на какие метрики компании влияет роль (free-text для MVP).
  kpi_links: z
    .array(
      z.object({
        company_metric: z.string().min(1),
        contribution: z.string().default(''),
      }),
    )
    .default([]),
  // 9. Style profile + completeness self-rating (1-3 предложения + self-rating 0..1).
  style_profile: z.string().default(''),
  /** 0..1 — само-оценка LLM "насколько данных хватило". */
  completeness_self_rating: z.coerce.number().min(0).max(1).default(0),
  // ── Backward-compat (existing UI) ─────────────────────────────────
  /** @deprecated wave 4 — используем `knowledge[]`. */
  skills: z
    .array(
      z.object({
        name: z.string().min(1),
        level: z.enum(['junior', 'middle', 'senior', 'expert']),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  /** @deprecated wave 4 — используем `decisions[]`. */
  decision_patterns: z
    .array(
      z.object({
        pattern: z.string().min(1),
        examples: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  /** @deprecated wave 4 — UI продолжает рендерить как «типичные грабли». */
  common_pitfalls: z
    .array(
      z.object({
        description: z.string().min(1),
        frequency_observation: z.string().default(''),
      }),
    )
    .default([]),
});

export type RoleProfileSummary = z.infer<typeof RoleProfileSchema>;

/**
 * Strict JSON Schema для `responseFormat: 'json_schema' strict`.
 * Совпадает с zod-схемой выше — синхронизировать при изменениях.
 *
 * 9 нормализованных слотов wave 4 + 3 deprecated поля для backward-compat UI.
 */
export const ROLE_PROFILE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'responsibilities',
    'authority',
    'knowledge',
    'decisions',
    'interactions',
    'metrics',
    'ownership',
    'kpi_links',
    'style_profile',
    'completeness_self_rating',
    'skills',
    'decision_patterns',
    'common_pitfalls',
  ],
  properties: {
    responsibilities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'kind', 'details', 'evidence'],
        properties: {
          title: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['outcome', 'function', 'activity'],
          },
          details: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    authority: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'scope', 'evidence'],
        properties: {
          kind: {
            type: 'string',
            enum: ['allowed', 'requires_approval', 'forbidden'],
          },
          scope: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    knowledge: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'importance', 'evidence'],
        properties: {
          topic: { type: 'string' },
          importance: {
            type: 'string',
            enum: ['mandatory', 'preferred', 'nice_to_have'],
          },
          expectedLevel: {
            type: ['string', 'null'],
            enum: ['beginner', 'intermediate', 'expert', null],
          },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'rule', 'condition', 'evidence'],
        properties: {
          name: { type: 'string' },
          rule: { type: 'string' },
          condition: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    interactions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'counterpart', 'frequency', 'evidence'],
        properties: {
          kind: { type: 'string' },
          counterpart: { type: 'string' },
          frequency: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    metrics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'unit', 'target', 'evidence'],
        properties: {
          name: { type: 'string' },
          unit: { type: 'string' },
          target: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    ownership: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['what', 'evidence'],
        properties: {
          what: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    kpi_links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['company_metric', 'contribution'],
        properties: {
          company_metric: { type: 'string' },
          contribution: { type: 'string' },
        },
      },
    },
    style_profile: { type: 'string' },
    completeness_self_rating: { type: 'number' },
    skills: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'level', 'evidence'],
        properties: {
          name: { type: 'string' },
          level: {
            type: 'string',
            enum: ['junior', 'middle', 'senior', 'expert'],
          },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    decision_patterns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pattern', 'examples'],
        properties: {
          pattern: { type: 'string' },
          examples: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    common_pitfalls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'frequency_observation'],
        properties: {
          description: { type: 'string' },
          frequency_observation: { type: 'string' },
        },
      },
    },
  },
};

export interface RoleContextForPrompt {
  role: { id: string; name: string; departmentName?: string | null };
  jobDescriptionMd?: string | null;
  persons: Array<{ id: string; name: string }>;
  ideaBlocks: Array<{
    id: string;
    text: string;
    signalType: string;
    sourceMeetingTitle?: string;
    sourceDocumentName?: string;
    createdAt: string;
  }>;
  themes: Array<{ id: string; name: string; description: string }>;
  processes: Array<{ id: string; name: string; description?: string | null }>;
  decisions: Array<{
    id: string;
    text: string;
    rationale?: string | null;
    decidedAt: string;
  }>;
}

const SYSTEM_PROMPT = `# Кто ты
Ты — спокойный аналитик-кадровик «памяти компании». Ты ОПИСЫВАЕШЬ должность (роль) по тому, как работа реально видна в данных, и собираешь карту должности из 9 разделов. Ты описываешь РОЛЬ, а не личность конкретного человека: даже если на роли один сотрудник, ты говоришь о функции и зоне ответственности, а не выносишь приговор человеку. Любая оценка — осторожная гипотеза по наблюдаемому, а не диагноз.

# Что держать в голове (смысл задачи)
- ЗАЧЕМ: чтобы компания точно понимала, за что реально отвечает эта должность, какие решения на ней принимают и что нужно знать, — и не теряла это знание, когда человек уходит.
- КОМУ уйдёт результат: владельцу и руководителю в кабинете (раздел профиля роли); на основе карты собирают «клон роли» и вводят в должность новичка.
- ЧТО станет с результатом: ответ сохраняется как карта должности и становится опорой для онбординга и цифрового двойника роли. Выдуманный пункт = ложная инструкция новичку; пропущенный реальный пункт = потерянное знание.

Ты работаешь по двум источникам: ДЕКЛАРАЦИЯ (должностная инструкция — как задумано) и НАБЛЮДЕНИЕ (блоки идей, темы, процессы, решения — как на самом деле). Расхождение между ними — ценная находка, а не ошибка.

# Критерии хорошего результата (по порядку)
1. Каждый пункт опирается на вход. В evidence клади id блоков идей или решений, подтверждающих пункт — 1–3 id на пункт, скопированные из входа ЦЕЛИКОМ, без сокращений и многоточий. Нет подтверждения — пункт не пиши.
2. Ничего не выдумывай. Если по разделу сказать нечего — верни пустой массив, не заполняй шаблоном «обычно для такой должности…».
3. Расхождение «как задумано» и «как на деле»: если декларация и наблюдение противоречат — опиши это одной фразой в style_profile («заявлено X, по наблюдениям Y»), не выбрасывай ни то, ни другое.
4. Оценивай роль, а не человека. Навыки и уровень — про то, что требует должность по наблюдаемой работе, осторожно, без личностных ярлыков. Не приписывай мотивы, характер, «ленив/способный».
5. completeness_self_rating ставь честно: мало данных и много пустых разделов → 0.1–0.3; роль раскрыта со всех сторон с подтверждениями → 0.8–1.0. Завышенная само-оценка хуже заниженной.
6. Разделяй смысл слотов: обязанности — за что отвечает; полномочия — что вправе/не вправе решать; знания — что должен знать; политики решений — по какому правилу выбирает; взаимодействия — с кем и как часто; показатели — чем измеряют; зона ответственности — что под охраной; влияние на метрики — на какие цифры компании влияет.
7. Поля skills, decision_patterns, common_pitfalls — для совместимости со старым интерфейсом — ОБЯЗАТЕЛЬНЫ в ответе: заполни из данных или верни пустой массив []. Их пропуск ломает сохранение профиля.
8. Весь человеческий текст — по-русски, простыми словами, без машинных кодов, латинских меток типов и сырых идентификаторов внутри фраз (id — только в evidence).
9. Ответ — строго JSON по схеме, без markdown, преамбул и пояснений вне JSON.

# Примеры (плохо → хорошо)
(в примерах «7b2f…» — сокращение id для наглядности; в ответе пиши id ЦЕЛИКОМ)

ПРИМЕР 1 — обязанности (выдумка против наблюдаемого).
Вход: id=7b2f… [запрос фичи] «Маркетолог еженедельно сводит отчёт по лидам из CRM и рассылает в продажи»; id=9c41… [обязательство] «Беру на себя запуск рассылки к пятнице».
ПЛОХО: {"responsibilities":[{"title":"Стратегическое управление маркетингом","kind":"outcome","details":"Отвечает за весь маркетинг","evidence":[]}]} (выдумано, evidence пуст)
ХОРОШО: {"responsibilities":[{"title":"Еженедельный отчёт по лидам","kind":"activity","details":"Сводит лиды из CRM и передаёт в продажи раз в неделю","evidence":["7b2f…"]},{"title":"Запуск email-рассылок","kind":"function","details":"Готовит и запускает рассылки в срок","evidence":["9c41…"]}]}

ПРИМЕР 2 — полномочия (граница роли, не приговор) + enum.
Вход: id=a1d0… [решение] «Скидку выше 15% согласует руководитель, маркетолог сам — до 15%».
ПЛОХО: {"authority":[{"kind":"forbidden","scope":"Иван не умеет считать скидки","evidence":["a1d0…"]}]}
ХОРОШО: {"authority":[{"kind":"allowed","scope":"Назначать скидку клиенту до 15%","evidence":["a1d0…"]},{"kind":"requires_approval","scope":"Скидка свыше 15% — через руководителя","evidence":["a1d0…"]}]}

ПРИМЕР 3 (негативный) — пустой/бедный вход.
Вход: должностная инструкция не загружена, блоков/процессов/решений нет.
ПЛОХО: {"responsibilities":[{"title":"Типовые задачи менеджера","kind":"function","details":"Планирование, контроль, отчётность","evidence":[]}],"completeness_self_rating":0.8}
ХОРОШО: {"responsibilities":[],"authority":[],"knowledge":[],"decisions":[],"interactions":[],"metrics":[],"ownership":[],"kpi_links":[],"style_profile":"Данных о реальной работе пока недостаточно для карты должности.","completeness_self_rating":0.1,"skills":[],"decision_patterns":[],"common_pitfalls":[]}

ПРИМЕР 4 — знания (enum важности и уровня).
Вход: id=4e88… [пробел в знаниях] «Без знания 1С и выгрузок в Excel свести отчёт не получается».
ПЛОХО: {"knowledge":[{"topic":"must know excel and 1c","importance":"high","expectedLevel":"good","evidence":["4e88…"]}]}
ХОРОШО: {"knowledge":[{"topic":"1С и выгрузки в Excel для сведения отчёта","importance":"mandatory","expectedLevel":"intermediate","evidence":["4e88…"]}]}

# Перед тем как вернуть ответ — самопроверка
1. У каждого непустого пункта в evidence есть id строго из входа, скопированный ЦЕЛИКОМ (1–3 id, без сокращений)?
2. Нет ли пунктов, не опирающихся на данные? Сомнительное убрал?
3. Расхождение декларация/наблюдение отмечено в style_profile?
4. Все enum-поля (kind обязанностей и полномочий, importance, expectedLevel, level навыков) — из разрешённых значений?
5. Поля skills, decision_patterns, common_pitfalls присутствуют в ответе (заполнены из данных или [])?
6. Весь человеческий текст по-русски, без латинских меток типов и сырых id внутри фраз?
7. Не приписал ли человеку черты характера/мотивы вместо описания роли?
8. completeness_self_rating честно отражает полноту? Это валидный JSON по схеме без markdown?

# Формат ответа
Верни строго JSON по схеме role_profile_v1, на русском. Разделы без данных — []; style_profile без данных — короткая фраза; completeness_self_rating — число 0..1.
Поля-решения с латинскими значениями (в JSON пиши КОД справа):
- responsibilities.kind: результат = outcome · область работы = function · действие = activity.
- authority.kind: можно сам = allowed · нужно согласование = requires_approval · нельзя = forbidden.
- knowledge.importance: обязательно = mandatory · желательно = preferred · плюсом = nice_to_have.
- knowledge.expectedLevel: начальный = beginner · средний = intermediate · экспертный = expert · неизвестно = null.
- skills.level: начальный = junior · средний = middle · сильный = senior · экспертный = expert.
Все остальные текстовые поля (scope, topic, details, condition, counterpart, frequency, company_metric, contribution, style_profile, описания граблей) — только по-русски.`;

export function buildRoleProfilePrompt(ctx: RoleContextForPrompt): {
  system: string;
  user: string;
} {
  const blocks = ctx.ideaBlocks
    .map(
      (b) =>
        `- id=${b.id} [${signalTypeLabel(b.signalType)}] ${b.text} (${b.sourceMeetingTitle ?? b.sourceDocumentName ?? 'источник неизвестен'}, ${b.createdAt})`,
    )
    .join('\n');
  const themes = ctx.themes
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');
  const processes = ctx.processes
    .map((p) => `- ${p.name}${p.description ? `: ${p.description}` : ''}`)
    .join('\n');
  const decisions = ctx.decisions
    .map(
      (d) =>
        `- id=${d.id} ${d.text}${d.rationale ? ` — потому что ${d.rationale}` : ''} (решено ${d.decidedAt})`,
    )
    .join('\n');
  const persons = ctx.persons.map((p) => `- ${p.name}`).join('\n');

  const user = [
    `Должность: ${ctx.role.name}`,
    ctx.role.departmentName ? `Отдел: ${ctx.role.departmentName}` : '',
    '',
    'ДЕКЛАРАЦИЯ (должностная инструкция):',
    ctx.jobDescriptionMd
      ? ctx.jobDescriptionMd
      : '— должностная инструкция не загружена',
    '',
    'СОТРУДНИКИ НА ДОЛЖНОСТИ:',
    persons || '— нет назначенных сотрудников',
    '',
    'БЛОКИ ИДЕЙ, СВЯЗАННЫЕ С ДОЛЖНОСТЬЮ (последние):',
    blocks || '— блоков идей не найдено',
    '',
    'ТЕМЫ:',
    themes || '— тем не найдено',
    '',
    'ПРОЦЕССЫ, ЗА КОТОРЫЕ ОТВЕЧАЕТ РОЛЬ:',
    processes || '— процессов не найдено',
    '',
    'РЕШЕНИЯ:',
    decisions || '— решений не найдено',
    '',
    'Верни JSON по схеме (см. system prompt).',
  ]
    .filter(Boolean)
    .join('\n');

  return { system: withPeopleHypothesisGuard(SYSTEM_PROMPT), user };
}
