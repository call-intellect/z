---
type: tz
status: done
feature: Фаза A — Prompt Registry + Admin-конструктор шаблонов AI-отчёта + per-agent цепочка моделей
date: 2026-05-21
parent_tz: tz/2026-05-21-competitor-parity.md
depends_on: []
covers_matrix_rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 48, 49, 51, 52, 53]
references:
  - docs/reference/llm-models-playbook.md (карта моделей, цепочки fallback, ENV)
  - plans/tz/2026-05-21-second-brain-agents-umbrella.md (§3.7 + §5.11 — стандарт 3-уровневой цепочки)
---

# ТЗ A: Prompt Registry + Admin-конструктор шаблонов AI-отчёта

> **Это sub-TZ.** Зонтичный — [`competitor-parity`](2026-05-21-competitor-parity.md). При расхождениях — приоритет у зонтика по структурным решениям, у этого файла — по техническим деталям.
>
> **Контекст:**
> - Сейчас 9 промптов AI-отчёта живут в коде ([backend/src/modules/ai/services/prompts/type-*.ts](../../backend/src/modules/ai/services/prompts/)). Меняются только через релиз.
> - У mymeet.ai с 20.05.2026 — конструктор кастомных шаблонов с 30 разделами. Это новый стандарт рынка.
> - Skill [`z-ai-agent-rules`](../../.claude/skills/) уже описывает «prompt registry с code fallback», но реализации в коде нет — этот sub-TZ её закрывает.

---

## 1. Цель

После реализации A:

1. Все промпты AI-отчёта живут в БД (`PromptTemplate` + `PromptTemplateVersion`).
2. **Конструктор шаблонов** в Z-Admin (для super_admin) и Org-Admin (для owner/admin своей Org): создать новый шаблон, добавить разделы (до 30) с независимыми инструкциями LLM, превью на demo-встрече, активировать.
3. **9 существующих типов встреч** становятся системными шаблонами, импортированы из кода через seed-скрипт.
4. **Code fallback**: если БД-шаблон недоступен, воркер использует встроенный код (текущие `type-*.ts` остаются как фоллбек).
5. **Версионирование**: каждое сохранение шаблона — новая `PromptTemplateVersion`. Можно откатиться к любой версии.
6. **A/B-тестирование**: две версии одного `PromptTemplate` крутятся с заданным split-percent, метрики собираются в `AiUsageLog.experimentGroup`.
7. **Org-level overrides**: Pro/Business Org-Admin может создать кастомный шаблон, видимый только своей Org. Системные шаблоны — read-only для Org-Admin'а; можно копировать в свой шаблон.
8. **Per-taskType цепочка моделей в админке** (фаза A.4) — для каждого `LlmTaskType` (каждого агента) в `/admin/ai-models` видна цепочка `primary → secondary → tertiary`, метрики (cost/latency/success/% fallback), можно переключить primary одной кнопкой, запустить A/B per-agent. Эта же страница используется всеми остальными sub-TZ (B/C/D/E) — они только добавляют свои taskType'ы через seed, UI уже готов.

---

## 2. Scope

### Входит в A

**A.1. Схема + перенос промптов из кода в БД:**
- Модели `PromptTemplate`, `PromptTemplateVersion`, `PromptTemplateSection`, `PromptExperiment`.
- Seed-скрипт `seed-prompt-templates.ts` — переносит все промпты из `ai/services/prompts/` в БД как системные.
- `AiResult.promptTemplateVersionId` (новое поле) — трекинг, какой версией сгенерирован отчёт.
- Изменение `LlmRouterService` (или новый `PromptResolverService`): резолвит промпт по `taskType + scope (system|org)` через БД → code-fallback если БД пустая или ошибка.

**A.2. Admin API + UI (CRUD по шаблонам):**
- REST: `GET /api/v1/admin/prompt-templates`, `GET /:id`, `POST`, `PATCH /:id`, `DELETE /:id` (soft), `POST /:id/versions`, `POST /:id/activate-version`, `POST /:id/preview`.
- Z-Admin (`super_admin`) видит ВСЕ шаблоны (системные + Org). Org-Admin — только системные (read) + свои Org-шаблоны (write).
- UI: список шаблонов с фильтрами «Системные / Мои», страница редактирования (название + описание + список разделов с drag-n-drop), редактор раздела (название + промпт-инструкция + ожидаемый формат вывода), preview на demo-meeting.

**A.3. Org-overrides + A/B-эксперименты (по промптам):**
- Раздел «Эксперименты» в админке: создать `PromptExperiment` с двумя `PromptTemplateVersion`'ами + `splitPercent` + `startedAt/endsAt`.
- В аналитике эксперимента: средняя длина ответа, среднее время генерации, средняя стоимость, средняя оценка качества (после feedback-механизма; в этой фазе UI-кнопка «👍/👎» под отчётом).
- Entitlement-гейт: создание Org-шаблонов и эксперименты — только Pro/Business тарифы (см. §11).

**A.4. Управление цепочкой моделей per-агент (3-уровневая подстраховка):**
- Расширение модели `LlmTaskRoute` (или новая `LlmTaskRouteTier`) — поле `tier: 'primary' | 'secondary' | 'tertiary'` + `priority` для порядка внутри tier'а.
- Перенос дефолтных цепочек из [playbook §2.1](../../docs/reference/llm-models-playbook.md#21-дефолтная-маршрутизация-tasktype--primary--fallback-2026-05) в БД через `seed-llm-task-routes-default.ts` (для существующих 28 taskType'ов knowledge-core и AI-pipeline).
- Расширение `LlmRouterService.call()` — автоматический fallback по tier'ам: primary → secondary → tertiary. Логирует в `AiUsageLog.tier` фактически использованный уровень. На полный отказ — `NoEligibleProviderError` + метрика `core_llm_no_provider_total{taskType}`.
- Страница `/admin/ai-models` (расширение существующего `admin/admin-prices` модуля или новый модуль `admin/ai-models`):
  - Список всех `taskType` с группировкой (knowledge-core / AI-pipeline / competitor-parity).
  - Per-row: цепочка primary/secondary/tertiary с моделью + provider'ом + maxDataClass.
  - Метрики per-agent (за период 24ч/7д/30д): cost ₽/1k вызовов, latency p50/p95/p99, success rate, % запросов в fallback (по `AiUsageLog.tier`).
  - Кнопка «Переключить primary» → модалка с выбором из доступных provider'ов того же `maxDataClass` + опция «отправить N% трафика на новый, остаток на старый» (A/B на уровне модели).
  - История переключений (audit log) — `LlmTaskRouteChange` с автором, timestamp, before/after.
  - Ссылка «📖 Playbook» рядом с каждым провайдером — открывает раздел [playbook](../../docs/reference/llm-models-playbook.md) с описанием модели.
- A/B-эксперимент per-agent: на N% трафика — другой primary; сравнение метрик side-by-side (расширение `PromptExperiment` или отдельная `LlmModelExperiment`). См. §10 — переиспользуем механику A.3 для модельных экспериментов.
- **Обязательное правило для всех новых taskType'ов (sub-TZ B/C/D/E):** при создании voor seed-script содержит 3 provider'а + ссылку на конкретный раздел playbook в комментарии. Без этого PR не пройдёт ревью.

### Не входит в A

- Промпты для knowledge-core (`block-ingest`, `theme-classify` и т.д.) **в БД-registry как шаблоны** — остаются в коде как сейчас, переносить промпты в БД будем в отдельной фазе после паритета. **НО:** их `LlmTaskRoute` (цепочка моделей) переносится в БД через `seed-llm-task-routes-default.ts` — это входит в A.4, потому что админка `/admin/ai-models` должна показывать ВСЕ taskType'ы, не только competitor-parity-ные.
- Marketplace шаблонов (публичные шаблоны между Org) — после паритета.
- Версии промптов с git-style diff'ами — пока plain text, diff делается на стороне UI как простой text-diff.
- Перевод шаблонов на другие языки — только русский.
- Автоматическое предложение «улучшить промпт» через мета-LLM — после паритета.
- Импорт промптов из mymeet/FollowUp экспортов — не делаем.
- Аппаратные нагрузочные тесты Ollama для tertiary fallback — отдельная инфра-задача. Проверяем только функционально (запрос проходит, ответ парсится).

---

## 3. Структура и зависимости

```
A.1 Schema + migration промптов из кода (3-4 дня)
  ├── Prisma: PromptTemplate, PromptTemplateVersion, PromptTemplateSection, PromptExperiment
  ├── Seed: scripts/seed-prompt-templates.ts (импорт 9 type-*.ts + общие промпты)
  ├── PromptResolverService (новый сервис в ai/)
  ├── Patch LlmRouterService — резолв через PromptResolverService
  ├── AiResult.promptTemplateVersionId + сохранение в analyze.worker
  └── E2E-тест: один meeting проходит весь pipeline через БД-шаблон → fallback к коду → оба пути работают
        ↓
A.2 Admin API + UI (3-4 дня)
  ├── Backend: AdminPromptTemplatesController (CRUD + version + preview)
  ├── RBAC: новый ResourceType 'prompt_template'
  ├── Frontend: /admin/prompts (список + детальная)
  ├── Редактор раздела: до 30 разделов, drag-n-drop, валидация (не больше N токенов в инструкции)
  └── Preview: вызов на синтетической `merged.json` (положим 1-2 в backend/test-fixtures/)
        ↓
A.3 Org-overrides + A/B (2-3 дня)
  ├── Backend: scope='org' в PromptTemplate, фильтр по tenantId
  ├── Entitlement-гейт (см. §11)
  ├── PromptExperiment + сервис распределения трафика (sticky по meetingId-hash)
  ├── Frontend: /admin/prompts/experiments
  └── Feedback-кнопка 👍/👎 под отчётом → AiResultFeedback таблица
        ↓
A.4 Per-agent цепочка моделей в админке (2-3 дня)
  ├── Prisma: LlmTaskRoute расширение полем tier + priority; LlmTaskRouteChange (audit)
  ├── Seed: scripts/seed-llm-task-routes-default.ts — перенос дефолтных цепочек из playbook в БД для всех 28 существующих taskType'ов
  ├── Patch LlmRouterService.call() — автоматический fallback primary→secondary→tertiary
  ├── AiUsageLog.tier — логировать фактически использованный уровень
  ├── Backend: /admin/ai-models (CRUD + метрики + audit log)
  ├── Frontend: /admin/ai-models (страница со списком taskType'ов и per-row цепочкой)
  └── Smoke-тест Ollama tertiary: для каждого taskType один вызов через qwen3.5:9b → ответ парсится
```

**Зависит от:** ничего (можно стартовать сразу).
**Блокирует:** sub-TZ B/C/D/E через A.4 — их seed-script'ы регистрируют свои taskType'ы в `LlmTaskRoute` с tier'ами, поэтому A.4 должна быть готова. В крайнем случае B/C/D/E могут параллельно с A.4 готовиться, при этом seed применяется после A.4 в одном PR.

---

## 4. Схема БД

### 4.1. Модели Prisma

```prisma
enum PromptTemplateScope {
  system    // Поставляется с Z, доступен всем Org, read-only для Org-Admin
  org       // Создан Org-Admin'ом, виден только своей Org
}

enum PromptTemplateStatus {
  draft     // Редактируется, не используется в analyze
  active    // Используется в analyze
  archived  // Не используется, но видим для истории
}

model PromptTemplate {
  id              String                  @id @default(cuid())
  scope           PromptTemplateScope
  orgId           String?                 // null если scope=system; обязателен если scope=org
  key             String                  // уникальный slug, e.g. 'type-sales', 'custom-sales-deep-dive'
  name            String                  // отображаемое имя
  description     String?
  meetingType     MeetingType?            // null = для любого типа
  taskType        String                  // legacy LLM taskType, e.g. 'summary'
  status          PromptTemplateStatus    @default(draft)
  activeVersionId String?                 @unique
  createdById     String
  createdAt       DateTime                @default(now())
  updatedAt       DateTime                @updatedAt
  deletedAt       DateTime?

  org             Org?                    @relation(fields: [orgId], references: [id])
  versions        PromptTemplateVersion[]
  activeVersion   PromptTemplateVersion?  @relation("active_version", fields: [activeVersionId], references: [id])
  experimentsA    PromptExperiment[]      @relation("experiment_a")
  experimentsB    PromptExperiment[]      @relation("experiment_b")

  @@unique([orgId, key])                  // в рамках Org key уникален; для system orgId=null
  @@index([scope, status])
  @@index([orgId, status])
}

model PromptTemplateVersion {
  id              String                    @id @default(cuid())
  templateId      String
  versionNumber   Int                       // 1, 2, 3...
  systemPrompt    String                    @db.Text   // общая часть промпта (шапка)
  outputSchema    Json                      // ожидаемая JSON-схема ответа
  createdById     String
  createdAt       DateTime                  @default(now())
  notes           String?                   // changelog от автора версии

  template        PromptTemplate            @relation(fields: [templateId], references: [id])
  sections        PromptTemplateSection[]
  aiResults       AiResult[]                @relation("from_prompt_version")

  @@unique([templateId, versionNumber])
  @@index([templateId])
}

model PromptTemplateSection {
  id              String                  @id @default(cuid())
  versionId       String
  order           Int                     // 1, 2, ..., до 30
  key             String                  // slug для отображения в JSON-ответе LLM
  title           String                  // отображаемое имя секции
  instruction     String                  @db.Text   // инструкция LLM «что писать в этой секции»
  outputType      String                  // 'text' | 'bullet_list' | 'table' | 'json_object'
  required        Boolean                 @default(true)
  maxTokens       Int?                    // опциональный лимит

  version         PromptTemplateVersion   @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@unique([versionId, key])
  @@unique([versionId, order])
  @@index([versionId])
}

model PromptExperiment {
  id              String     @id @default(cuid())
  orgId           String?    // null = эксперимент системного шаблона (только Z-Admin); иначе Org-эксперимент
  templateAId     String     // версия A
  templateBId     String     // версия B
  splitPercent    Int        // 0-100, доля трафика на B
  status          String     // 'draft' | 'running' | 'stopped' | 'completed'
  startedAt       DateTime?
  endsAt          DateTime?
  createdById     String
  createdAt       DateTime   @default(now())
  notes           String?

  templateA       PromptTemplateVersion  @relation("experiment_a", fields: [templateAId], references: [id])
  templateB       PromptTemplateVersion  @relation("experiment_b", fields: [templateBId], references: [id])

  @@index([orgId, status])
}

model AiResultFeedback {
  id              String    @id @default(cuid())
  aiResultId      String
  userId          String
  reaction        String    // 'positive' | 'negative'
  comment         String?
  createdAt       DateTime  @default(now())

  aiResult        AiResult  @relation(fields: [aiResultId], references: [id])

  @@unique([aiResultId, userId])
  @@index([aiResultId])
}
```

### 4.2. Расширение существующих моделей

```prisma
model AiResult {
  // ... существующие поля ...
  promptTemplateVersionId String?
  promptTemplateVersion   PromptTemplateVersion? @relation("from_prompt_version", fields: [promptTemplateVersionId], references: [id])
  experimentGroup         String?   // 'A' | 'B' | null — для аналитики экспериментов
  feedback                AiResultFeedback[]
}

model AiUsageLog {
  // ... существующие поля ...
  tier               String?   // 'primary' | 'secondary' | 'tertiary' — фактически использованный уровень (для аналитики % fallback)
  fallbackReason     String?   // 'primary_timeout' | 'primary_error' | 'primary_rate_limit' | 'secondary_*' | null
}
```

### 4.3. Модели для per-agent цепочки моделей (A.4)

```prisma
enum LlmRouteTier {
  primary
  secondary
  tertiary
}

model LlmTaskRoute {
  // ... существующие поля (taskType, providers[], experiment, ...) ...
  // Расширение:
  tier       LlmRouteTier         // primary / secondary / tertiary
  priority   Int       @default(0)   // порядок внутри tier'а (0 = первый кандидат)
  // ... остальное как есть ...

  @@unique([taskType, providerId, tier])
  @@index([taskType, tier, priority])
}

model LlmTaskRouteChange {
  id              String       @id @default(cuid())
  taskType        String
  tier            LlmRouteTier
  changeType      String       // 'switched_primary' | 'added_provider' | 'removed_provider' | 'started_ab' | 'stopped_ab'
  before          Json         // snapshot цепочки до изменения
  after           Json         // snapshot после
  changedById     String
  reason          String?      // ручной комментарий админа
  createdAt       DateTime     @default(now())

  changedBy       User         @relation(fields: [changedById], references: [id])

  @@index([taskType, createdAt])
  @@index([changedById, createdAt])
}

model LlmModelExperiment {
  id              String        @id @default(cuid())
  orgId           String?       // null = глобальный эксперимент (только super_admin); иначе org-scoped
  taskType        String        // какой агент тестируем
  controlModel    String        // текущий primary
  variantModel    String        // тестируемая модель
  controlProvider String
  variantProvider String
  splitPercent    Int           // 0-100, доля трафика на variant
  status          String        // 'draft' | 'running' | 'stopped' | 'completed'
  startedAt       DateTime?
  endsAt          DateTime?
  createdById     String
  createdAt       DateTime      @default(now())
  notes           String?

  @@index([orgId, taskType, status])
}
```

### 4.4. Команды

`bun run prisma:push && bun run prisma:generate`.

Применение дефолтов для всех существующих 28 taskType'ов — отдельным шагом seed:
```bash
bun run scripts/seed-llm-task-routes-default.ts
```

### 4.5. Команды

```bash
# применение схемы
bun run prisma:push
bun run prisma:generate

# первоначальный seed системных шаблонов из кода
bun run scripts/seed-prompt-templates.ts

# seed цепочек моделей для всех существующих taskType'ов (из playbook §2.1)
bun run scripts/seed-llm-task-routes-default.ts
```

**Запрещено** — `prisma migrate*` (skill `prisma-db-push-rules`).

---

## 5. PromptResolverService — резолв с code-fallback

### 5.1. Контракт

```ts
@Injectable()
export class PromptResolverService {
  constructor(
    private prisma: PrismaService,
    private logger: PinoLogger,
    private metrics: MetricsService,
  ) {}

  /**
   * Резолвит промпт для analyze.worker.
   * Стратегия:
   *  1. Если есть активный эксперимент в Org и шаблон попадает в split — берём A или B.
   *  2. Иначе ищем org-шаблон с meetingType=type, status=active.
   *  3. Иначе ищем system-шаблон с meetingType=type, status=active.
   *  4. Иначе code-fallback из ai/services/prompts/type-*.ts.
   *  5. На любую ошибку резолва из БД — code-fallback + лог + метрика z_prompt_resolver_fallback_total.
   */
  async resolveForMeeting(params: {
    tenantId: string;
    meetingId: string;
    meetingType: MeetingType;
    taskType: 'summary' | 'tasks' | 'chapters' | 'follow-up' | 'card-rollup';
  }): Promise<ResolvedPrompt>;
}

type ResolvedPrompt = {
  source: 'db_org' | 'db_system' | 'code_fallback';
  versionId?: string;        // null если code_fallback
  experimentGroup?: 'A' | 'B';
  systemPrompt: string;
  sections: Array<{ key: string; title: string; instruction: string; outputType: string }>;
  outputSchema: object;
};
```

### 5.2. Integration с analyze.worker

[backend/src/modules/ai/workers/analyze.worker.ts](../../backend/src/modules/ai/workers/analyze.worker.ts):

```ts
const resolved = await this.promptResolver.resolveForMeeting({
  tenantId,
  meetingId: job.data.meetingId,
  meetingType: meeting.type,
  taskType: 'summary',
});

const llmInput = renderPromptFromResolved(resolved, mergedTranscript);  // helper
const llmResult = await this.llmRouter.run({
  taskType: resolved.source === 'code_fallback' ? 'summary' : `prompt-template:${resolved.versionId}`,
  input: llmInput,
  dataClass: 'internal',
  experimentGroup: resolved.experimentGroup,
});

await this.prisma.aiResult.update({
  where: { id: aiResult.id },
  data: {
    summary: parseLlmOutput(llmResult),
    promptTemplateVersionId: resolved.versionId,
    experimentGroup: resolved.experimentGroup,
  },
});
```

### 5.3. Code fallback (важно)

Файлы [backend/src/modules/ai/services/prompts/type-*.ts](../../backend/src/modules/ai/services/prompts/) **не удаляются**. Они становятся ResolvedPrompt-objekt'ами через адаптер `codeFallbackAdapter.ts`:

```ts
export function codeFallbackForMeeting(type: MeetingType, taskType: string): ResolvedPrompt {
  const builder = getPromptForType(type);   // существующий index.ts
  return {
    source: 'code_fallback',
    versionId: undefined,
    systemPrompt: builder.buildPrompt({} as any).system,  // вырвать system из buildPrompt
    sections: extractSectionsFromTool(builder.TOOL),       // тулу превратить в sections[]
    outputSchema: builder.SCHEMA,
  };
}
```

Это рефакторинг без потери поведения. Тест: `bunx vitest run -t "code-fallback returns equivalent to current type-sales"`.

---

## 6. Seed-скрипт `seed-prompt-templates.ts`

Создаёт системные `PromptTemplate` + первую `PromptTemplateVersion` + `PromptTemplateSection[]` для всех 9 + дополнительных промптов:

| Key | name | meetingType | taskType |
|---|---|---|---|
| `type-team` | Командная встреча | `team` | `summary` |
| `type-standup` | Дейли-standup | `standup` | `summary` |
| `type-plan_fact` | План-факт | `plan_fact` | `summary` |
| `type-project` | Проектная встреча | `project` | `summary` |
| `type-sales` | Встреча с клиентом (продажи) | `sales` | `summary` |
| `type-custdev` | CustDev / интервью с пользователем | `custdev` | `summary` |
| `type-partner` | Встреча с партнёром | `partner` | `summary` |
| `type-interview` | Собеседование | `interview` | `summary` |
| `type-customer_success` | Customer Success | `customer_success` | `summary` |
| `tasks-default` | Извлечение задач | null | `tasks` |
| `chapters-default` | Извлечение глав | null | `chapters` |
| `follow-up-default` | Follow-up письмо | null | `follow-up` |
| `card-rollup-default` | Сводка карточки | null | `card-rollup` |

Скрипт идемпотентный (skill `safe-seed-rules`): на повторный запуск НЕ перезаписывает шаблоны, которые были вручную отредактированы (по флагу `editedByAdmin: true`). Только обновляет, если `versionsCount === 1 && editedByAdmin === false`.

Запуск из CLAUDE.md: `bun run scripts/seed-prompt-templates.ts` — фиксирует флаг применения в `MetaConfig.seedAppliedAt`.

---

## 7. Admin API

### 7.1. Endpoints (`/api/v1/admin/prompt-templates`)

| Метод | Путь | Что | RBAC |
|---|---|---|---|
| GET | `/admin/prompt-templates` | Список (фильтры: scope, status, meetingType) | super_admin (видит все) / owner+admin (видит system + свои org) |
| GET | `/admin/prompt-templates/:id` | Детальная карточка с активной версией | как выше |
| POST | `/admin/prompt-templates` | Создать новый шаблон (всегда `status=draft`, `scope` зависит от роли) | super_admin (можно system); owner+admin (только org) |
| PATCH | `/admin/prompt-templates/:id` | Изменить метаданные (название, описание, тип встречи) | автор/super_admin |
| DELETE | `/admin/prompt-templates/:id` | Soft-delete (только org-шаблоны; system защищены) | автор/super_admin |
| POST | `/admin/prompt-templates/:id/versions` | Сохранить новую версию (после редактирования секций) | автор/super_admin |
| GET | `/admin/prompt-templates/:id/versions/:versionId` | Получить конкретную версию для сравнения/отката | как выше |
| POST | `/admin/prompt-templates/:id/activate-version/:versionId` | Сделать версию активной (status шаблона → active) | автор/super_admin |
| POST | `/admin/prompt-templates/:id/copy-to-org` | Скопировать system-шаблон в Org-шаблон для редактирования | owner+admin |
| POST | `/admin/prompt-templates/:id/preview` | Запустить preview-генерацию на demo-meeting и вернуть результат | как list |

### 7.2. Endpoints для экспериментов

| Метод | Путь | Что | RBAC |
|---|---|---|---|
| GET | `/admin/prompt-experiments` | Список экспериментов | super_admin/owner/admin |
| POST | `/admin/prompt-experiments` | Создать (templateAId, templateBId, splitPercent, endsAt) | super_admin/owner/admin |
| POST | `/admin/prompt-experiments/:id/start` | Запустить (`status=running`) | автор |
| POST | `/admin/prompt-experiments/:id/stop` | Остановить | автор |
| GET | `/admin/prompt-experiments/:id/analytics` | Метрики (среднее время, стоимость, % positive feedback по группе A/B) | как list |

### 7.3. Endpoint feedback

| Метод | Путь | Что |
|---|---|---|
| POST | `/api/v1/meetings/:meetingId/result/feedback` | Создать AiResultFeedback (reaction: positive/negative, comment) — для пользователя, не админа |
| GET | `/api/v1/admin/feedback` | Список фидбека для аналитики (фильтры: templateId, period) |

### 7.4. Endpoints для управления моделями (фаза A.4)

| Метод | Путь | Что | RBAC |
|---|---|---|---|
| GET | `/admin/ai-models` | Список всех taskType'ов с их цепочками primary/secondary/tertiary | super_admin / owner / admin |
| GET | `/admin/ai-models/:taskType` | Детальная карточка taskType: цепочка + метрики (cost/latency/success/% fallback) за период | как list |
| POST | `/admin/ai-models/:taskType/switch-primary` | Переключить primary на другого provider'а (вариант: с A/B-параметрами — N% трафика на новый) | super_admin / owner |
| POST | `/admin/ai-models/:taskType/add-provider` | Добавить провайдера в tier (с указанием tier + priority) | super_admin / owner |
| DELETE | `/admin/ai-models/:taskType/provider/:providerId` | Убрать провайдера из tier (запрещено если это единственный в primary) | super_admin / owner |
| GET | `/admin/ai-models/:taskType/history` | Audit log переключений | как list |
| GET | `/admin/ai-models/:taskType/metrics?from=<ISO>&to=<ISO>` | Метрики per-tier: cost-per-1k, latency p50/p95/p99, success rate, % fallback | как list |
| POST | `/admin/llm-model-experiments` | Создать A/B-эксперимент на уровне модели | super_admin / owner |
| GET | `/admin/llm-model-experiments` | Список + статус | как list |
| POST | `/admin/llm-model-experiments/:id/start` | Запустить | автор |
| POST | `/admin/llm-model-experiments/:id/stop` | Остановить | автор |
| GET | `/admin/llm-model-experiments/:id/analytics` | Метрики A/B: cost, latency, success, % positive feedback (control vs variant) | как list |

### 7.4. DTO + Zod схемы

В [backend/src/modules/admin/prompt-templates/dto/](../../backend/src/modules/admin/) — DTO-чейн `ApiDto → DomainModel`, Swagger через `nestjs-zod`. Все Zod-схемы хранят `min/max` валидаторы:
- `name`: 3..120 символов
- `description`: 0..1000 символов
- `sections.length`: 0..30
- `section.instruction`: 10..4000 символов
- `splitPercent`: 0..100
- `notes`: 0..2000 символов

---

## 8. Frontend (`/admin/prompts` + `/admin/ai-models`)

### 8.1. Страницы — шаблоны промптов

- `/admin/prompts` — список шаблонов с фильтрами (системные / мои / архивные), поиск, кнопка «Создать шаблон».
- `/admin/prompts/[id]` — карточка шаблона:
  - Шапка: название, описание, тип встречи, статус, ссылки «Активная версия», «История версий», **«Цепочка моделей» → ведёт на `/admin/ai-models/<taskType>` соответствующего шаблона**.
  - Табы: «Редактор», «Версии», «Тестирование (preview)», «Использование» (статистика).
- `/admin/prompts/[id]/edit` — редактор:
  - Метаданные сверху.
  - Список разделов с drag-n-drop (используем `@dnd-kit` уже есть).
  - Каждый раздел — карточка с полями (title, instruction, outputType, required, maxTokens).
  - Кнопка «Добавить раздел» (≤30).
  - Footer: «Сохранить как новую версию» (новая `PromptTemplateVersion`), «Сохранить и активировать», «Отмена».
- `/admin/prompts/experiments` — список экспериментов + кнопка «Создать эксперимент».
- `/admin/prompts/experiments/[id]` — детальная: метрики, кнопки start/stop, сравнение A vs B.

### 8.2. Страницы — модели агентов (фаза A.4)

- `/admin/ai-models` — главная страница с таблицей всех `taskType`:
  - Группировка: «AI-pipeline встреч» (summary, tasks, chapters, follow-up, custom-report:* …), «Knowledge-core» (block-ingest, block-distill, theme-classify …), «Competitor-parity» (behavior-refine, meeting-quality-score, transcript-clean-refine, ...).
  - Колонки: TaskType, Primary (модель + provider + 📖 playbook), Secondary, Tertiary, Cost/1k за 7д, Latency p95, Success %, % fallback.
  - Поиск + фильтр по группе + сортировка по cost/latency.
  - Кнопка «Запустить A/B» рядом с каждым taskType.
- `/admin/ai-models/[taskType]` — детальная карточка:
  - Шапка: имя taskType + описание (из реестра LlmTaskType) + ссылки на seed-script и на playbook-раздел.
  - Цепочка primary/secondary/tertiary с кнопками «Переключить», «Удалить», «Добавить в tier».
  - Виджет «Метрики» (range-selector 24ч/7д/30д): cost, latency, success — графиками + цифрами per-tier.
  - Виджет «Эксперименты» — текущие A/B + история.
  - Audit log переключений (последние 50).
- `/admin/ai-models/[taskType]/switch-primary` — модалка:
  - Выбор провайдера из доступных (фильтр по `maxDataClass` taskType'а).
  - Опция «Сразу 100% трафика» или «A/B: N% на новый, 100-N% на старый».
  - Текстовое поле «Причина переключения» (обязательно, → `LlmTaskRouteChange.reason`).

**Свобода выбора в админке (главное правило):** super_admin может назначить **любой** доступный provider в **любой** tier любого taskType — без правки кода и без выкатки. Конкретно:
- Список доступных provider'ов — `Provider` модель (DeepSeek / GPT-* / Claude / MiniMax / Ollama / KIA / Gemini через `grsai`). Откуда они берутся — registered в коде при старте приложения по ENV.
- Фильтр: `provider.maxDataClass >= taskType.dataClass`. Если ENV `ANTHROPIC_API_KEY` пусто — Claude в списке скрыт (есть индикатор «нет ключа»).
- Drag-n-drop в `<ProviderTierBadge>` — переместить provider'а между tier'ами (через field `tier`) или внутри tier'а (через field `priority`). Изменение persists через PATCH-запрос → запись в `LlmTaskRouteChange`.
- Кнопка «Сбросить к дефолту» рядом с каждым taskType — re-applies seed-пресет (по этой кнопке `seedAppliedAt` НЕ обновляется, флаг «вручную сброшено к дефолту» отдельный).
- Кнопка «Удалить tier» — если super_admin хочет отказаться, например, от tertiary. UI показывает warning «Без tertiary при отказе primary и secondary воркер встанет; согласно правилу зонтика рекомендуется держать 3 уровня». Не блокируется.
- Кнопка «Добавить tier» — позволяет вставить ещё один (например, secondary-2, secondary-3) — это превращается в `priority` внутри одного tier'а, не новый enum-value. UI визуализирует «secondary [2 модели]».
- Список всех `LlmTaskType`-ов в одном месте — `/admin/ai-models` — чтобы super_admin мог за час пересобрать всю карту маршрутизации по таблице из playbook §2.1 или своей бенчмарк-таблице.
- `/admin/ai-models/experiments` — общий список A/B-экспериментов по моделям (отдельно от prompt-экспериментов).
- `/admin/ai-models/experiments/[id]` — карточка эксперимента: control vs variant, метрики side-by-side, confidence interval (Wilson) при ≥30 samples per group.

### 8.3. Компоненты

- `<PromptTemplateList />` — таблица с SWR.
- `<PromptTemplateEditor />` — основной редактор; внутри `<SectionsEditor />` (drag-n-drop, до 30).
- `<SectionForm />` — форма одного раздела.
- `<PromptPreviewModal />` — модалка для preview на demo-meeting (выбор meeting из dropdown + результат как accordion).
- `<PromptExperimentCard />` — карточка prompt-эксперимента.
- `<FeedbackButton />` — 👍/👎 под отчётом встречи (использует уже существующую страницу результата).
- `<AiModelsTable />` — основная таблица `/admin/ai-models`.
- `<TaskTypeDetailsCard />` — детальная карточка taskType.
- `<ProviderTierBadge />` — отрисовка пары provider+model с цветом по tier.
- `<SwitchPrimaryModal />` — модалка переключения primary с опцией A/B.
- `<LlmModelExperimentCard />` — карточка модельного A/B-эксперимента.
- `<TaskTypeMetricsWidget />` — графики (Recharts) cost/latency/success.

### 8.3. Доступы и навигация

- Z-Admin (`super_admin`): пункт меню «Шаблоны промптов» в `/admin` слева.
- Org-Admin (`owner`, `admin`): пункт меню «Мои шаблоны отчётов» внутри `/settings` или `/admin` своей Org (зависит от текущей структуры — проверить в `frontend/src/app/(authenticated)/(admin)/`).

### 8.4. UX-состояния

- Loading skeleton при первом рендере.
- Empty state «У вас нет своих шаблонов. Скопируйте системный или создайте с нуля».
- Error state с retry-кнопкой.
- Saving indicator (Tailwind toast) на сохранении.
- Confirmation modal на «Активировать версию» (предупреждение, что это влияет на новые встречи).
- Read-only state для системных шаблонов с подсказкой «Скопируйте для редактирования».

### 8.6. Локализация

Все строки на русском (memory `feedback_admin_ui_russian_only`). Добавить в `delivery/ui/copy-strings.ru.md`:
- «Шаблон отчёта» / «Шаблоны отчётов»
- «Раздел отчёта»
- «Инструкция для ИИ»
- «Системный шаблон» / «Мой шаблон»
- «Версия N» / «Активировать версию» / «Откатить к версии»
- «Эксперимент» / «Группа A» / «Группа B» / «Доля трафика на группу B»
- «Предпросмотр на демо-встрече»
- «Поделиться отзывом об отчёте»
- «Модели агентов» / «Цепочка моделей»
- «Основная модель» / «Запасная» / «Локальная (без интернета)»
- «Переключить основную модель» / «Причина переключения»
- «Стоимость 1000 вызовов» / «Задержка p95» / «Доля успешных» / «Доля переключений на запасную»
- «Запустить A/B-эксперимент на моделях» / «Контрольная модель» / «Тестируемая модель»

---

## 9. Preview-механика

### 9.1. Demo-встречи

В `backend/test-fixtures/demo-meetings/` положить 2-3 синтетические `merged.json`:
- `demo-sales.json` — продажная встреча (10 минут, 2 спикера).
- `demo-standup.json` — короткий standup (5 минут, 4 спикера).
- `demo-interview.json` — собеседование (20 минут, 2 спикера).

### 9.2. Preview endpoint

`POST /admin/prompt-templates/:id/preview` принимает `{ demoMeetingKey: 'demo-sales' | ... }` → вызывает `PromptResolverService.resolveTemplate(id, version='draft')` → рендерит промпт + вызывает `LlmRouterService.run({ taskType: 'preview' })` → возвращает JSON-ответ + cost + duration.

Лимит: 10 preview в час на одного пользователя (rate-limit через `ThrottlerGuard`). Лимит стоимости: $0.20 на один preview (предохранитель).

---

## 10. A/B-механика

### 10.1. Распределение трафика

Sticky-allocation по `hash(meetingId + experimentId) % 100 < splitPercent` → группа B, иначе A. Это гарантирует, что один meeting получит один и тот же promtp при retry/regenerate.

### 10.2. Аналитика

В `GET /admin/prompt-experiments/:id/analytics`:
- Кол-во meeting'ов в A и B.
- Средняя стоимость генерации (USD).
- Средняя длительность (мс).
- Average response length.
- % positive feedback (из `AiResultFeedback`).
- Confidence interval по proportion (Wilson) при количестве ≥ 30.

### 10.3. Лимиты

- Один Org — максимум 3 одновременных эксперимента (предохранитель).
- Эксперимент должен иметь `endsAt` ≤ `startedAt + 30 дней` (форс-стоп через cron, после endsAt → status='completed' автоматически).

---

## 11. Entitlements

### 11.1. Гейтинг

Расширить enum `EntitlementFeature` (или существующий `Feature` enum в коде, проверить как там устроено):

```
custom_prompt_templates    — создание Org-шаблонов
prompt_experiments         — A/B-эксперименты
preview_unlimited          — без лимита на preview (для super_admin всегда true)
```

Гейтинг:
- Free / Starter — НЕ могут создавать Org-шаблоны; используют только системные. UI: кнопка «Создать» disabled с подсказкой «Доступно на Pro/Business».
- Pro — могут создавать Org-шаблоны (до 10 на Org).
- Business — могут создавать Org-шаблоны (до 50 на Org) + эксперименты (до 3 одновременных).

### 11.2. Implementation

Через существующий `EntitlementsService.checkFeature(orgId, 'custom_prompt_templates')` в `PromptTemplatesController.create`.

---

## 12. Метрики и логи

### 12.1. Prometheus

```
z_prompt_resolver_total{source="db_org|db_system|code_fallback"}
z_prompt_resolver_fallback_total{reason="db_empty|db_error"}
z_prompt_template_active_count{scope="system|org"}    # gauge, обновляется cron'ом раз в час
z_prompt_template_preview_total{result="success|error|cost_limit"}
z_prompt_experiment_active_count
z_prompt_experiment_completed_total
z_prompt_template_feedback_total{reaction="positive|negative"}
```

### 12.2. Логи

- `info` на каждое сохранение версии, активацию, удаление шаблона, старт/стоп эксперимента.
- `warn` при code-fallback с reason.
- `error` при rendering-ошибке промпта (e.g. невалидный JSON в outputSchema).
- Все логи c `tenantId`, `userId` (для трекинга кто изменил).

---

## 13. Фазирование

| Фаза | Длительность | Содержимое | DoD |
|---|---|---|---|
| **A.1** | 3-4 дня | Schema + seed системных шаблонов + PromptResolverService + интеграция в analyze.worker + code-fallback wrapper | `bun run dev` запускается, analyze.worker генерирует отчёт через БД для всех 9 типов; при удалении строки в БД → code-fallback работает; integration тест зелёный |
| **A.2** | 3-4 дня | AdminPromptTemplatesController + UI редактор + preview | Z-Admin может создать system-шаблон, добавить ≤30 разделов, сохранить версию, активировать, preview работает на demo-meeting |
| **A.3** | 2-3 дня | Org-overrides + entitlement-гейт + PromptExperiment + feedback-кнопка | Org-Admin создаёт свой шаблон, тестирует A/B, видит аналитику; Free-тариф получает 403 на create |
| **A.4** | 2-3 дня | LlmTaskRoute.tier + seed дефолтов из playbook + LlmRouterService fallback по tier'ам + `/admin/ai-models` (CRUD + метрики + audit + A/B) + smoke-test Ollama tertiary | `/admin/ai-models` показывает все 28+ taskType с цепочками; переключение primary одной кнопкой работает; для каждого taskType один тестовый вызов через Ollama tertiary проходит; AiUsageLog.tier заполняется |

---

## 14. DoD

### Технические

- [ ] `bun run typecheck` чистый.
- [ ] `bun run lint` чистый (backend + frontend).
- [ ] `bun run test:unit` зелёный (PromptResolverService, controllers, мапперы).
- [ ] `bun run test:integration` зелёный: e2e на analyze.worker с БД-шаблоном + e2e на analyze.worker с code-fallback (БД пустая).
- [ ] `bun run build` (backend + frontend) чистый.
- [ ] `bun run prisma:push` идёт без warnings (skill `prisma-db-push-rules`).

### Функциональные

- [ ] 9 типов встреч успешно перенесены в БД через seed.
- [ ] AiResult.promptTemplateVersionId сохраняется на каждое generation.
- [ ] Удалена строка `PromptTemplate` для `type-sales` → analyze.worker генерирует отчёт через code-fallback с метрикой `z_prompt_resolver_fallback_total{reason="db_empty"}`.
- [ ] Z-Admin может создать новый системный шаблон, добавить ≤30 разделов, активировать; новые встречи используют его.
- [ ] Org-Admin может скопировать системный шаблон в свой Org-шаблон, отредактировать и активировать; новые встречи Org используют его.
- [ ] Preview работает на demo-встречах за ≤30 сек.
- [ ] A/B-эксперимент с splitPercent=50 распределяет meeting'ы корректно (sticky-hash проверен на 100 синтетических meetingId).
- [ ] Free-тариф получает 403 на `POST /admin/prompt-templates`; UI кнопка disabled.

**По фазе A.4 (модели агентов):**
- [ ] Seed `seed-llm-task-routes-default.ts` создаёт записи `LlmTaskRoute` с tier'ами для всех 28 существующих taskType'ов; соответствие playbook §2.1.
- [ ] `LlmRouterService.call()`: при недоступности primary автоматически переключается на secondary, при недоступности secondary — на tertiary. Smoke-test: задать `OPENAI_API_KEY=invalid`, проверить, что вызов через tertiary (Ollama) проходит.
- [ ] `AiUsageLog.tier` заполняется на каждом вызове; `tier='secondary'/'tertiary'` сопровождается `fallbackReason`.
- [ ] `/admin/ai-models` показывает все taskType'ы с группировкой; метрики per-tier работают.
- [ ] Переключение primary через UI создаёт запись `LlmTaskRouteChange` с обязательным `reason`.
- [ ] A/B-эксперимент моделей: создан, запущен, через 24 часа аналитика показывает cost/latency/success per-group.
- [ ] Smoke-test Ollama tertiary: для 5 ключевых taskType'ов (`summary`, `tasks`, `chapters`, `chat-v2`, `behavior-refine`) один реальный вызов через `qwen3.5:9b` → ответ парсится. Если не парсится для какого-то — alert и пересмотр дизайна (skipper qwen, использовать GPT-5.4-nano как tertiary с предупреждением).

### Документация

- [ ] Создан `second-brain/01_projects/prompt-registry.md` — описание архитектуры.
- [ ] Обновлён `second-brain/02_architecture/data-model.md` — новые модели.
- [ ] Обновлён `second-brain/02_architecture/module-map.md` — модуль `admin/prompt-templates`.
- [ ] Обновлён `second-brain/01_projects/api-layer.md` — новые эндпоинты.
- [ ] Глоссарий `delivery/13-glossary.md` расширен.
- [ ] CLAUDE.md (раздел про LLM-router) обновлён — «промпты теперь в БД, code остаётся как fallback».
- [ ] Запись рефлексии в `second-brain/05_история/2026-MM-DD-A-prompt-registry-итог.md`.

### Матрица прослеживаемости (из зонтика §7)

- [ ] Строки 1–10 матрицы — все `[x]`.
- [ ] Строки 48, 49, 51, 52, 53 — все `[x]` (фаза A.4).

---

## 15. Риски и митигации

| Риск | Тяжесть | Митигация |
|---|---|---|
| Регрессия качества AI-отчётов при переходе с кода на БД | критичная | Side-by-side test: на 20 пилотных встречах генерируем отчёт через старый код и через новый PromptResolver → diff'им JSON-ответы → разница только в порядке полей. Если контент отличается — фиксим резолвер до релиза |
| Удаление кодовых файлов type-*.ts ломает фоллбек | критичная | Файлы НЕ удаляем. Они становятся fallback-источником. Документируем в коде комментарием «DO NOT DELETE — fallback for PromptResolverService» |
| Конструктор разделов слишком сложный для не-программистов | средняя | UX-копирайтинг: в UI рядом с каждым полем «инструкция для ИИ» — пример из системного шаблона. Кнопка «Подсказать с ИИ» (отложено, не в A) |
| 30 разделов × 4000 токенов = 120k токенов в одном промпте, дорого | средняя | Валидатор на сохранении: сумма maxTokens всех разделов ≤ 16000. Превышение → ошибка с подсказкой |
| Org-Admin создаёт шаблон, ломает отчёты для всей своей Org | высокая | Перед активацией — модальное окно «Вы уверены? Все новые встречи Org будут использовать эту версию». В первый месяц после релиза — кнопка «Откатить за 1 клик» к предыдущей активной версии |
| Эксперименты увеличивают latency analyze.worker | низкая | Резолв с экспериментами — один запрос в PromptExperiment с includeRelations. Latency overhead ≤ 50ms |
| Preview жжёт LLM-cost | средняя | Rate-limit 10/час на user. Cost-limit $0.20 на preview (jobs прерываются заранее) |
| Утечка системных промптов через GET (промпт = ноу-хау) | низкая | Системные промпты видны только админам с правом `prompt_template:read`. Не публичный API. Но всё-таки пользователи их видят — это OK, mymeet тоже их показывает |
| Каскадное удаление PromptTemplate при удалении Org | средняя | onDelete: NoAction. Удаляем Org → шаблоны помечаются deletedAt, доступ через специальный admin-endpoint для recovery в течение 30 дней |

---

## 16. Открытые вопросы (закрыть до A.3)

1. **AiResultFeedback per-section или per-result?** Пока — per-result (одна реакция на весь отчёт). Если sales-кейс покажет, что нужно per-section — добавим в отдельной фазе.
2. **Preview на полной длинной встрече или только demo?** Пока — только demo (3 фикстуры). На реальной встрече сильно дороже + дольше; добавим в A.3 если будет запрос.
3. **Импорт/экспорт шаблонов между Org (JSON-файл)?** Не входит в A; будет marketplace в отдельной фазе после паритета.
4. **Шаблоны на уровне Department, не только Org?** Не входит. На уровне Org достаточно для MVP паритета.

---

## 17. Итог

_Заполняется по факту, когда A.1–A.3 закрыты._

- **Реализовано полностью / частично:** _TBD_
- **Что осталось:** _TBD_
- **Side-by-side тест 20 встреч пройден:** _TBD_
- **Ссылка на рефлексию:** _TBD_

## Ревизия от 2026-05-24

**Статус:** done

**Реализовано:**
- A.1: Prisma-модели `PromptTemplate` (schema.prisma:4809), `PromptTemplateVersion` (:4853), `PromptTemplateSection` (:4889), `PromptExperiment`, `AiResultFeedback` (:4945) + расширение `AiResult.promptTemplateVersionId` и `AiUsageLog.tier/fallbackReason`.
- `PromptResolverService` + spec + experiment.spec (`backend/src/modules/ai/services/prompt-resolver.{service,types}.ts`).
- Seed системных шаблонов: `backend/scripts/seed-prompt-templates.ts`.
- A.2: Admin API + UI — `backend/src/modules/admin/prompt-templates/{prompt-templates,prompt-experiments,ai-result-feedback,prompt-templates-preview,admin-feedback,meeting-result-feedback}.{service,controller}.ts` + RBAC spec; frontend `frontend/app/(authenticated)/admin/prompts/{page,new,[id],[id]/PromptEditor,[id]/PromptVersionsTab,[id]/PromptPreviewModal,experiments/*}.tsx`.
- A.3: PromptExperiment + feedback-кнопка реализованы.
- A.4: модели `LlmTaskRouteChange` (schema.prisma:1651), `LlmModelExperiment` (:1678), enum tier'ов. Модуль `backend/src/modules/admin/ai-models/{ai-models.service,ai-models.controller,dto/ai-models.dto}.ts` + seed-script `seed-llm-task-routes-default.ts`. Frontend `frontend/app/(authenticated)/admin/ai-models/{page,AiModelsClient,[taskType]/{page,TaskTypeDetailsClient},experiments/*}.tsx`.
- Все фазы B/C/D/E/прочие зарегистрировали свои taskType через 30+ `seed-llm-task-routes-*.ts` скриптов (видно в backend/scripts/).
- Полный Economics стек (был в Phase 7 ревизии) — `backend/src/modules/admin/economics/*` с 5 cron'ами и UI.

**Осталось:** только документация (рефлексия в second-brain). Side-by-side тест 20 встреч — не верифицирован формально.
