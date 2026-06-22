---
type: tz
status: ready-to-implement
feature: clone-signaltype-methodology-step
date: 2026-06-22
owner: sergrv80 (владелец); решение Р1 делегировано исполнителю с требованием доказать выбор
relates_to:
  - plans/analysis/2026-06-22-clone-module-prod-test/RESULTS.md
  - plans/tz/2026-06-11-clone-persona-method-layer-orchestrator-prompt.md
  - second-brain/01_projects/skill-and-clone.md
  - second-brain/03_processes/specialist-gamma-1-skill-clone.md
---
> Анализ и боевой прогон: `plans/analysis/2026-06-22-clone-module-prod-test/RESULTS.md` · Статус согласования: 2026-06-22

# Клон должности кормится и блоками «Шаг методологии» (methodology_step)

## Принцип
Клон должности (`SkillProfile` → `SkillTrait` → `ExecutablePersona`) должен впитывать **наблюдаемый метод работы носителя**, а не только обоснования разовых решений. Сейчас он отрезан от блоков типа `methodology_step` («как сотрудник делает работу») — это и чиним. Правка — **расширение набора-потребителя**, без вмешательства в LLM-классификатор и без новых моделей БД.

## Цель
Сделать так, чтобы блоки `signalType='methodology_step'` с `IdeaBlockEntity.role='subject'` доходили до конвейера построения клона должности — на всех трёх рубежах (subject-атрибуция → событийный гейт перестройки → выборки rebuild/принципов роли/ответа клона) — и чтобы уже накопленные такие блоки попали в клон через форс-пересборку.

## Зачем (болезненное состояние)
Боевой прогон на проде (Org «ооо ромашка», 2026-06-22, `RESULTS.md`):
- Залито 30 reasoning-заметок носителя должности через канал «Мысль» (`POST /api/v1/ingest/dump`). Граф наполнился штатно (102→120 сущностей, дедуп работает), `SkillProfile` создан.
- Но `buildVersion=0`, `traits=[]` — клон **не построился**. Диагностика (UI «Сущности» → «Алексей» → 20 блоков знаний): 13× `methodology_step`, 2× `motivation`, 2× `decision`, по 1× `fact`/`regulation`/`metric_change`/`result`; блоков `reasoning`/`rationale`/`decision_basis` — **0**.
- Клон кормится строго `signalType ∈ {reasoning, rationale, decision_basis}` и при `<5` таких блоков делает полный skip. → богатый «подходный» контент в клон не попадает.

**Следствие для продукта:** канал «Мысль/Память» (и часть живых встреч) почти не порождает `reasoning`-блоки — рассуждения про подход уходят в `methodology_step`. Поэтому у активных компаний на проде **0 клонов**. Эта правка — необходимое условие, чтобы клоны вообще наполнялись.

## REALITY-CHECK (по факту кода и прод-прогона)
| Узел | Факт |
|---|---|
| Канал входа «Мысль» → граф | ✅ Работает (`POST /api/v1/ingest/dump`, sourceType `web_form`, subject-атрибуция на автора). |
| block-ingest классификация | ✅ Работает и **осмысленно** метит подход как `methodology_step` — менять её НЕ нужно (см. «Отвергнутые альтернативы»). |
| subject-атрибуция `role='subject'` | ✅ Работает. При дефолтном `knowledge.subjectAttributionAllTypes=true` ставится на блок ЛЮБОГО типа (`block-ingest.worker.ts:1022-1024`). Но базовый набор `REASONING_SUBJECT_SIGNAL_TYPES` (`block-ingest.worker.ts:43-50`) `methodology_step` НЕ содержит → при выключенном флаге блок не атрибутируется. |
| Диспетчер 3-7 → `SkillProfile` | ✅ Создаётся. |
| rebuild → `SkillTrait` | 🔴 Не строит: гейт по узкому набору. **Это и есть предмет ТЗ.** |
| Существующие тесты | ✅ `loadSubjectReasoningBlocks` всюду замокан в `specialist-3-7-skill.service.spec.ts` → расширение набора их не ломает. Golden `backend/test/eval/skill-trait-detect-golden/` и snapshot `seed-llm-task-routes-skill-and-clone.snapshot.spec.ts` НЕ затрагиваются (промпт/модели не меняем). |
| Слой метода клона (process-marker-detect и пр.) | ⚠️ Уже пытается извлечь «повторяемый приём процесса» из reasoning-суррогата — то есть нуждается в `methodology_step`, но не получает (рассогласование замысла, `RESULTS.md` Находка №2). |

**Вывод REALITY-CHECK:** цепочка исправна на 90%; единственное узкое горлышко — узкий набор `signalType`, повторённый литералом в нескольких местах. Это правка-расширение, не новая фича.

## Принятые решения владельца
| # | Решение | Обоснование | Статус |
|---|---|---|---|
| Р1 | В набор клона добавить **только `methodology_step`** (НЕ `expertise`/`competence`/`process_step`). | Прямой носитель смысла «как сотрудник работает» = ядро клона должности; 13/20 блоков прод-теста. `expertise`/`competence` = «что знает», сознательно отданы в `KnowledgeProfile` (специалист 3-2, запрет в `skill-trait-detect.prompt.ts`). `process_step` надличностный, пересекается с регламентами (специалист 3-1). Делегировано исполнителю с требованием доказать — см. «Доказательство выбора». | Зафиксировано, не пересматривать в рамках этого ТЗ |
| Р2 | Набор вынести в **единую экспортируемую константу** в коде (один источник правды), без `AdminSetting`. | Сейчас литерал скопирован в ≥6 местах → рассинхрон (источник этого бага). Набор `signalType` — внутренний инвариант извлечения, не бизнес-крутилка владельца Org (не порог/лимит/цена); `AdminSetting` избыточен. `[ASSUMPTION]` подтверждён обоснованием. | Зафиксировано |
| Р3 | Выкатываем **включённым**, без feature-flag. | Ship-On (CLAUDE.md принцип 8): улучшение извлечения, не billing/access/необратимое-для-людей. Откат — обычным релизом. Kill-switch не требуется. | Зафиксировано |
| Р4 | Форс-пересборку уже накопленных профилей сделать **one-off backfill-скриптом** (все `active`-профили, опц. `--tenant`). | Событийный rebuild срабатывает только на НОВЫЙ блок; ночной recalibrate-cron делает лишь decay; существующий `backfill-subject-attribution-all-types` берёт только блоки без subject-связи. Без скрипта правка оживит клонов лишь на новых встречах, исторические блоки не подхватятся. | Зафиксировано |

## Доказательство выбора (Вариант A против B/C)
Полная матрица и доказательная база (4 независимых прохода по коду) — в `plans/analysis/2026-06-22-clone-module-prod-test/RESULTS.md`. Сведение:

| Критерий | A. Расширить набор-потребитель (выбран) | B. Переучить классификатор block-ingest | C. Снизить гейт `<5` |
|---|---|---|---|
| Чинит корень | ✅ Да | 🟡 Частично | ❌ Нет (reasoning-блоков 0) |
| Детерминизм | ✅ Код, стабильно | ❌ LLM-классификация плавает (граница reasoning↔methodology_step размыта по сути) | — |
| Цена | ✅ Константа + 3 рубежа + backfill | ❌ Переписать SYSTEM-промпт | ✅ 1 строка |
| Побочки | ✅ Только клон | ❌ Все блоки системы; ломает **prompt-cache** block-ingest на всех тенантах | ❌ Хлипкие черты от 1-2 наблюдений |
| Семантика | ✅ methodology_step = ядро клона | 🟡 Натягивает «метод» на «обоснование» | — |

**Отвергнутые альтернативы:**
- **B (переучить классификатор)** — `withDecisionDiscriminator` (`ai/services/prompts/common.ts`) намеренно толкает «как я всегда делаю» в сторону процесса/нормы; LLM по ~57 близким кодам недетерминирован; правка стабильного SYSTEM ломает кэш (правило `feedback_llm_prompts_cache_friendly`). Лечит симптом ненадёжно.
- **C (снизить порог)** — не решает: блоков нужного типа ноль, а черта от 1-2 наблюдений недостоверна.
- **Включить `expertise`/`competence`/`process_step`** — отвергнуто по Р1 (размывает границу «навык-подход vs знание-область»; регламентный шум). Вынесено в Scope/Не входит → vNext.

## Scope
### Входит
- Единая константа набора `signalType` для конвейера клона должности (+`methodology_step`).
- Расширение трёх обязательных рубежей: subject-атрибуция, событийный гейт диспетчера, выборки rebuild + синтеза принципов роли.
- Согласование выборок ответа клона на лету и валидации качества (тот же набор).
- One-off backfill-скрипт форс-пересборки `active`-профилей + регистрация в `apply-prod-deploy.ts`.
- Юнит-тесты на новые рубежи; acceptance-проверка на прод-Org «ооо ромашка».

### Не входит (vNext / отложено)
- `process_step` в наборе клона — отдельной ТЗ-заглушкой, **условие**: брать только при `role='subject'` и не дублировать сущности регламентов (специалист 3-1). [vNext]
- `expertise`/`experience`/`competence` в наборе клона — продуктовое решение «навык-подход vs знание-область», не очевидная починка. [vNext]
- Правка LLM-промптов `skill-trait-detect`/`process-marker-detect`/`value-motivation-detect`, где в тексте сказано «reasoning-цитаты» — функционально не влияет на выборку, правка ломает prompt-cache. Помечается как known-неточность. [vNext, при следующей запланированной ревизии промптов]
- Вынос набора в `AdminSetting`/`getDynamic` — по Р2 не нужно. [не делать]

## Граничные контракты
- **enum `SignalType` НЕ расширяется** — `methodology_step` уже есть (`schema.prisma:445`). Миграции БД и `prisma:generate` по этой причине НЕ требуются.
- **block-ingest classifier НЕ трогаем** — он уже корректно создаёт `methodology_step`-блоки.
- **`skill-trait-detect` промпт/модель НЕ трогаем** — DeepSeek V4 Pro, golden и snapshot остаются зелёными.
- **`SkillTraitLayer` (value/motivation/process_marker) — НЕ signalType.** «motivation» из формулировки задачи в `signalType:{in:[...]}` не вписывать (несовместимый enum) — это layer, продуцируемый отдельным детектором.

## Контракт-first

### Новый файл — единый источник набора
`backend/src/modules/knowledge-core/constants/skill-signal-types.ts`:
```ts
import type { SignalType } from '@prisma/client';

export const SKILL_SUBJECT_SIGNAL_TYPES: readonly SignalType[] = [
  'reasoning',
  'rationale',
  'decision_basis',
  'methodology_step',
];

export const SKILL_SUBJECT_SIGNAL_TYPE_SET: ReadonlySet<string> = new Set(
  SKILL_SUBJECT_SIGNAL_TYPES,
);
```
> `///`-комментарий и нарративные комментарии не добавлять (CLAUDE.md «без комментариев»). Контракт/инвариант набора живёт в этом ТЗ и в `docs/`, не в коде.

### Рубеж 1 — subject-атрибуция (чтобы methodology_step получал role='subject' даже при выключенном флаге)
`backend/src/modules/knowledge-core/workers/block-ingest.worker.ts:43-50` — якорь `const REASONING_SUBJECT_SIGNAL_TYPES`. Добавить `'methodology_step'` в Set (станет 7 типов). НЕ заменять на `SKILL_SUBJECT_SIGNAL_TYPES` — это ДРУГОЙ, более широкий набор (содержит `expertise/experience/competence`), его сужать нельзя.
```ts
const REASONING_SUBJECT_SIGNAL_TYPES: ReadonlySet<string> = new Set([
  'reasoning', 'rationale', 'decision_basis',
  'expertise', 'experience', 'competence',
  'methodology_step',
]);
```

### Рубеж 2 — событийный гейт диспетчера (скрытая половина: без него новый блок не триггерит rebuild)
`backend/src/modules/knowledge-core/workers/specialist-3-7-skill.worker.ts:69-83` — якорь `signalType вне области специалиста`. Заменить тройное `!==` на проверку по набору:
```ts
if (!SKILL_SUBJECT_SIGNAL_TYPE_SET.has(block.signalType)) {
  // skip-логику и метрику reason:'signal_out_of_scope' сохранить как есть
  ...
  return;
}
```

### Рубеж 3 — выборки конвейера клона (rebuild + принципы роли)
- `backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts:530` — якорь `signalType: { in: ['reasoning', 'rationale', 'decision_basis'] }` внутри `loadSubjectReasoningBlocks`. Заменить на `signalType: { in: [...SKILL_SUBJECT_SIGNAL_TYPES] }`.
- `backend/src/modules/knowledge-core/services/role-principle-synthesis.service.ts:106` — тот же литерал, та же замена (клон роли питается согласованно).

### Рубеж 4 — согласование ответа клона на лету и валидации качества
- `backend/src/modules/clones/services/clones.service.ts:2136` (`loadPersonSubgraph`) и `:2272` (`loadRoleSubgraph`) — тот же литерал, замена на `[...SKILL_SUBJECT_SIGNAL_TYPES]` (ответ клона подтягивает тот же набор блоков, что и обучение).
- `backend/src/modules/knowledge-core/services/persona-layer-validation.service.ts:297` (`loadCaseCandidateBlocks`) — замена на набор (judge-валидация меряет клон на согласованном наборе).
> Якоря-строки на момент написания; перед правкой перечитать (номера дрейфуют). Искать по тексту литерала `['reasoning', 'rationale', 'decision_basis']`.

### Рубеж 4-расширенный — потребители, обнаруженные по факту кода (грэп всего класса, 2026-06-22)
Грэп литерала `['reasoning', 'rationale', 'decision_basis']` по `backend/src` вскрыл **3 точки сверх первоначального перечня**. Все три — потребители того же «subject-набора клона роли» (семейство специалиста 3-7 / downstream черт). Оставить их с узким набором = повторить ровно тот рассинхрон, который чинит это ТЗ (правило `feedback_fix_the_whole_class_not_the_case`: чинить весь класс, не кейс). Поэтому они входят в scope Ф2 (доказательство — ниже):
- `backend/src/modules/knowledge-core/services/specialist-3-7-skill-probe.service.ts:134` (`checkProfileStarved`) — считает свежие subject-блоки и шлёт probe «у сотрудника не копится инфа о решениях». **С узким набором** будет слать **ложный** probe «профиль голодает», когда у носителя полно `methodology_step` → шум для владельца + противоречие с реально наполняющимся клоном. Замена на `[...SKILL_SUBJECT_SIGNAL_TYPES]`.
- `backend/src/modules/knowledge-core/services/specialist-3-7-skill-probe.service.ts:258` (`loadFreshCaseQuotes`, CDM-интервью) — тянет «кейсы» для углубления клона роли. Должен черпать из того же пула, что обучает клон. Замена на набор.
- `backend/src/modules/practice-skills/services/practice-skill-extractor.service.ts:126` (`extractForPerson`) — берёт `sourceBlockIds` уже построенных `SkillTrait` и **ре-фильтрует** их по signalType. После расширения `loadSubjectReasoningBlocks` черты будут строиться из `methodology_step`-блоков; узкий ре-фильтр их **выкинет** (`blocks.length===0` → молчаливый skip), сломав извлечение practice-skills для клонов на методологии. Замена на набор обязательна, иначе фича работает наполовину.

**НЕ входит (проверено грэпом, осознанно вне scope):** `specialist-3-3-decisions.worker.ts:68-69` — это специалист **по решениям (3-3)**, не клон (3-7); `methodology_step` ≠ «решение» → набор не расширяем. `REASONING_SUBJECT_SIGNAL_TYPES` в block-ingest (6 типов с `expertise/experience/competence`) — отдельный subject-набор, только добавляем `methodology_step` (Рубеж 1), не заменяем.

### Backfill-скрипт
`backend/src/.../scripts` → `backend/scripts/backfill-skill-profiles-rebuild.ts`:
- `createPrismaClient()` из `./_lib/prisma` (НЕ `new PrismaClient()`); импорты из `../src`.
- Пройти `skillProfile.findMany({ where: { status: 'active' }, ... })` курсором/пагинацией (образец — `skill-profile-recalibrate.cron.ts:63-69`); опц. фильтр `tenantId` из флага `--tenant`.
- На каждый профиль — `enqueueRebuildSkillProfile({ profileId, reason: 'backfill-methodology-step' })` (jobId `skill-profile-rebuild_<profileId>` дедуплицирует → повторный прогон no-op).
- Залогировать счётчик enqueued.
- Зарегистрировать в `backend/scripts/apply-prod-deploy.ts` массив `STEPS`: `phase:'backfill'`, `skipBootstrap:true`.

## Границы фичи
- ✅ Always: переиспользовать существующие очереди/воркеры/метрики; заменять литералы импортом константы; держать subject-набор и skill-набор раздельно.
- ⚠️ Ask first: любое включение `expertise`/`competence`/`process_step` (это vNext, не делать без отдельного решения); любая правка LLM-промптов.
- 🚫 Never: менять enum `SignalType`; трогать `skill-trait-detect` промпт/модель/golden/snapshot; вписывать `motivation` в `signalType`-фильтр; вводить feature-flag «на всякий случай»; `new PrismaClient()` в скрипте.

## Фазы

### Граф зависимостей
```
Ф1 (ядро: константа + рубежи 1-3)  ──►  Ф3 (backfill-скрипт)  ──►  Ф4 (тесты + прод-acceptance)
Ф2 (рубеж 4: ответ клона + валидация)  ──┘ (параллельна Ф1, обязательна до Ф4)
```
Ф1 и Ф2 правят разные файлы → параллельны. Ф3 строго после Ф1 (backfill бессмыслен без расширенной выборки). Ф4 строго после Ф1+Ф2+Ф3.

### Ф1 · Ядро: единая константа + рубежи 1–3 `[x]`
Файлы: новый `constants/skill-signal-types.ts`; `block-ingest.worker.ts:43-50`; `specialist-3-7-skill.worker.ts:69-83`; `specialist-3-7-skill.service.ts:530`; `role-principle-synthesis.service.ts:106`.
Что НЕ входит: clones.service / persona-validation (это Ф2); backfill (Ф3); промпты.
Acceptance:
- `grep -n "methodology_step" backend/src/modules/knowledge-core/constants/skill-signal-types.ts` → найдено.
- `grep -rn "SKILL_SUBJECT_SIGNAL_TYPE" backend/src/modules/knowledge-core/workers/specialist-3-7-skill.worker.ts backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts backend/src/modules/knowledge-core/services/role-principle-synthesis.service.ts` → импорт/использование в каждом.
- `grep -n "methodology_step" backend/src/modules/knowledge-core/workers/block-ingest.worker.ts` → присутствует в `REASONING_SUBJECT_SIGNAL_TYPES`.
- `cd backend && bun run typecheck && bun run lint && bun run build` — зелёные.
Закрывает: R1, R2, R3, R6.

### Ф2 · Согласование всех потребителей набора клона `[x]`
Файлы: `clones.service.ts:2136`, `:2272`; `persona-layer-validation.service.ts:297`; **+ обнаруженные по коду:** `specialist-3-7-skill-probe.service.ts:134`, `:258`; `practice-skills/services/practice-skill-extractor.service.ts:126` (Рубеж 4-расширенный).
Что НЕ входит: обучающий конвейер (Ф1); промпты ответа клона; `specialist-3-3-decisions.worker.ts` (специалист решений, не клон).
Acceptance:
- `grep -n "SKILL_SUBJECT_SIGNAL_TYPES" backend/src/modules/clones/services/clones.service.ts` → ≥2 использования.
- Литерал `['reasoning', 'rationale', 'decision_basis']` отсутствует во всех 6 точках Рубежа 4 + 4-расширенного (`grep -rn` по этим файлам пусто).
- `bun run typecheck && bun run build` — зелёные.
Закрывает: R4.

### Ф3 · Backfill-скрипт форс-пересборки `[x]`
Файлы: новый `backend/scripts/backfill-skill-profiles-rebuild.ts`; правка `backend/scripts/apply-prod-deploy.ts` (`STEPS`).
Acceptance:
- Скрипт запускается локально: `cd backend && bun run scripts/backfill-skill-profiles-rebuild.ts --tenant <id>` без ошибок; логирует число enqueued.
- Идемпотентность: повторный прогон → те же jobId, очередь не растёт (no-op) — проверяемо по логу «enqueued N (deduped)».
- `grep -n "backfill-skill-profiles-rebuild" backend/scripts/apply-prod-deploy.ts` → в STEPS с `phase:'backfill'`.
- `grep -n "new PrismaClient" backend/scripts/backfill-skill-profiles-rebuild.ts` → пусто; `grep -n "createPrismaClient" ...` → есть.
Закрывает: R5.

### Ф4 · Тесты + прод-acceptance `[x]` (юнит-часть; прод-acceptance — за владельцем после выката)
Файлы: тест на гейт-воркер и на `loadSubjectReasoningBlocks` (рядом с `specialist-3-7-skill.service.spec.ts` / новый `*.worker.spec.ts`).
Acceptance:
- Юнит: блок `signalType='methodology_step'`+canonical+subject-person-employee — НЕ отсекается воркером (доходит до `enqueueRebuildSkillProfile`); блок `signalType='fact'` — отсекается (reason `signal_out_of_scope`). `bunx vitest run <файл>` зелёный.
- Юнит: `loadSubjectReasoningBlocks` включает `methodology_step` в `where.signalType.in` (через мок prisma — проверить переданный фильтр).
- Прод-acceptance (после выката владельцем, на Org `cmpuz4gbs000201mvfbf3k2zk`): выкат → backfill → `GET /api/v1/clones/persons/cmpzl0mee00065gnq9vm3ajv1/skill-profile` показывает `buildVersion ≥ 1` и `traits.length ≥ 3` (active после verify); `/clones` показывает клон «[QA] Руководитель маркетинга»; ответ клона на тематический вопрос — не отказ; на вне-темный — отказ (анти-фейк). Зафиксировать в `RESULTS.md`.
Закрывает: R7, R8.

## Требования (трассировка)
- R1: Когда block-ingest пометил блок `methodology_step` от автора-сотрудника, система shall проставить `IdeaBlockEntity.role='subject'` даже при `subjectAttributionAllTypes=false`.
- R2: Когда canonical-блок `methodology_step` с subject-person-employee проходит диспетчер 3-7, система shall НЕ отсекать его по `signal_out_of_scope`, а ставить `enqueueRebuildSkillProfile`.
- R3: При rebuild профиля система shall включать блоки `methodology_step` в выборку наблюдений (`loadSubjectReasoningBlocks`).
- R4: При ответе клона, judge-валидации, probe-проверках (голодание профиля / CDM-интервью) и извлечении practice-skills система shall подтягивать тот же расширенный набор блоков (Рубеж 4 + 4-расширенный).
- R5: Backfill-скрипт shall ставить rebuild для всех `active`-профилей идемпотентно (повтор = no-op).
- R6: Набор signalType shall задаваться единой экспортируемой константой; литерал `['reasoning','rationale','decision_basis']` в перечисленных точках shall отсутствовать.
- R7: После выката+backfill профиль носителя из прод-теста shall иметь `traits.length ≥ 3` и видимый клон в `/clones`.
- R8: Существующие golden/snapshot/`specialist-3-7-skill.service.spec.ts` shall оставаться зелёными без изменений.

## Риски / Pre-mortem (ревью-аспекты для strict-production-review-gate)
| Риск | Митигация |
|---|---|
| Правка только service:530 без worker:69 → «работает на backfill, молчит на новых встречах» (скрытый второй гейт). | Ф1 обязывает оба рубежа; Acceptance грепает worker. |
| Сужение subject-набора при замене на skill-константу (потеря expertise/experience/competence). | Явный запрет: в `block-ingest.worker.ts` только ДОБАВИТЬ `methodology_step`, не заменять набор. |
| Качество черт: `methodology_step` процедурен («что делается»), verify-гейт заточен на «почему» → часть черт законно отсечётся (held), трата LLM-бюджета; fail-open при таймаутах промоутит неверифицированные в active. | Принять (управляемо). Прод-acceptance Ф4 проверяет, не мусор ли черты. Если зашумит — vNext: стоп-маркеры для methodology-черт. |
| Backfill массово дёргает rebuild по всем Org → LLM-затраты. | Скрипт идемпотентен + флаг `--tenant`; владелец запускает осознанно (deploy-операция). На тест-Org — точечно. |
| Прозаический claim в `skill-trait-detect.prompt.ts` про «только reasoning» станет неточным. | Вне scope (prompt-cache); помечено vNext. |

## Idempotency / feature-flag / prod-deploy
- **Flag:** нет (Р3, Ship-On).
- **Idempotency:** backfill — повтор = no-op (jobId-дедуп) как acceptance-критерий R5.
- **prod-deploy-log.md:** Шаг 8 (новый `backfill-*` скрипт) — добавить строку `bun run scripts/backfill-skill-profiles-rebuild.ts [--tenant <id>]` + однострочный комментарий. Миграции/seed/ENV — НЕ затронуты (enum уже есть, набор в коде).
- **Прод-инструкция (diff):** (1) `docker compose up -d --build backend`; (2) `docker compose exec backend bun run scripts/backfill-skill-profiles-rebuild.ts` (или `apply-prod-deploy.ts --mode update`); (3) форс `SkillTraitVerifyCron.tick` через админку cron-ов для промоута черт в active.

## DoD
- typecheck (вкл. `.spec`) / lint / build — зелёные; новые vitest — зелёные; golden/snapshot не тронуты.
- second-brain обновлён: `01_projects/skill-and-clone.md` (раздел «Источник данных» — расширен набор), `03_processes/specialist-gamma-1-skill-clone.md` (Шаг 1/3 — набор signalType). `RESULTS.md` — финал прод-acceptance.
- `docs/operations/prod-deploy-log.md` Шаг 8 — строка backfill.
- Реестр `second-brain/04_не-сделано/README.md` — строка-указатель на vNext (process_step / expertise+competence / правка промптов).
- Рефлексия в `second-brain/05_история/`.

## Итог
_(заполнит tz-orchestrator по завершении: что реализовано, что осталось, ссылки на коммиты.)_
