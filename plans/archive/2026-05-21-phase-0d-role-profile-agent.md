---
type: tz
status: done
feature: Фаза 0d — RoleProfileAgent (BullMQ-воркер + cron + on-demand rebuild)
date: 2026-05-21
parent_tz: tz/2026-05-21-phase-0-roles-and-onboarding.md
depends_on:
  - tz/2026-05-21-phase-0a-data-model-and-graph-infra.md (модель RoleProfile + GraphService + /api/v1/role-profiles)
  - tz/2026-05-21-phase-0b-document-ingest.md (IdeaBlock.role_relevant + сущности группы Б)
covers_matrix_rows: [37, 38, 39, 40, 41, 42, 79 (логика 409)]
---

# ТЗ 0d: RoleProfileAgent — BullMQ-воркер сборки карты должности

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-phase-0-roles-and-onboarding.md`](2026-05-21-phase-0-roles-and-onboarding.md). При расхождениях — приоритет у зонтичного.
>
> **Контекст:**
> - Существующие воркеры — в [`backend/src/workers/`](../../backend/src/workers/), отдельный процесс `bun run worker:dev` (см. CLAUDE.md, команды).
> - Промпты — через **prompt registry** (skill `z-ai-agent-rules`). Code fallback обязателен.
> - LLM — только через `LlmRouterService` с `taskType='role-profile-build'` (новый task type).
> - **Не запускать на проде, пока:** ни одной Role с ≥`N` `IdeaBlock`-ов с пометкой `role_relevant=true` (зонтичный §5). Иначе агент работает на пустоте, генерирует мусор.

---

## 1. Цель

После 0d в Z работает **автоматическая сборка карт должностей**:

- BullMQ-воркер `role-profile.worker` слушает очередь, для каждой задачи: собирает контекст вокруг Role через `GraphService` → вызывает LLM с промптом `role-profile-build` → сохраняет результат в `RoleProfile.summaryCache`.
- Cron `@Cron('0 */4 * * *')` раз в 4 часа enqueue'ит все Role с `RoleProfile.status IN ('forming', 'stale')`.
- On-demand через POST `/api/v1/role-profiles/:roleId/rebuild` — admin может пересобрать конкретную карту.
- API возвращает `409 Conflict` если job уже в очереди или выполняется (для debounce в 0c §6.4).

---

## 2. Scope

### Входит в 0d

**А. BullMQ-воркер:**
- `role-profile.worker` в `backend/src/workers/role-profile/`.
- Очередь `role-profile.queue` через Redis (существующий BullMQ-инстанс).
- Concurrency = 1 (LLM-вызовы дороги, parallel запуск ничего не даёт).
- Idempotency-key: `${roleId}:${buildVersion}` — повторный enqueue в течение коротких интервалов не создаёт дубликат job.

**Б. Cron:**
- `@Cron('0 */4 * * *')` — раз в 4 часа (зонтичный §6, решение #3).
- Логика: enqueue для всех Role с `RoleProfile.status IN ('forming', 'stale')`.
- Stale-маркировка: отдельный sub-cron раз в час смотрит на Role с новыми `IdeaBlock`-ами после `RoleProfile.lastBuildAt` → меняет статус на `stale`.

**В. On-demand rebuild:**
- POST `/api/v1/role-profiles/:roleId/rebuild` (контракт уже в 0a §7.7).
- Логика 409 (на стороне 0d):
  - Проверка через BullMQ `getJobCounts({ types: ['waiting', 'active'] })` на очереди для этой `roleId`.
  - Если есть `waiting` или `active` job — возвращаем `409 Conflict` с body `{ status: 'queued'|'running', since: ISO8601 }`.
  - Иначе — enqueue + возвращаем `202 Accepted` с `{ status: 'queued', jobId }`.

**Г. Build-status endpoint:**
- GET `/api/v1/role-profiles/:roleId/build-status` (контракт в 0a §7.7).
- Возвращает: `{ status: 'idle'|'queued'|'running'|'error', since?: ISO8601, lastBuildAt?: ISO8601 }`.

**Д. Сбор контекста через GraphService:**
- Cypher-запрос «всё, что касается роли»: обход `Role → Person → Event/Meeting → IdeaBlock → Theme + Decision/Process/Regulation` (4-5 хопов).
- Через `GraphService.traverse` — единственный escape-hatch (см. 0a §6.3).

**Е. Промпт `role-profile-build`:**
- В prompt registry, со code fallback.
- Input: контекст (блоки идей, темы, решения, процессы, должностная инструкция, если есть).
- Output JSON: `{ responsibilities[], skills[], decision_patterns[], common_pitfalls[], style_profile }`.

**Ж. Минимальный порог запуска:**
- Перед LLM-вызовом проверяем: `count(IdeaBlock WHERE role_relevant=true AND roleId=?) >= N` (порог `N=5` по умолчанию, ENV `ROLE_PROFILE_MIN_BLOCKS`).
- Если меньше — обновляем `RoleProfile.status = 'forming'`, job завершается без LLM-вызова.

### Не входит в 0d

- Frontend (0c).
- Модели и API (0a).
- Document/extraction pipeline (0b).
- Шаблоны карт должностей по типу должности — отложено, всегда пустой `summaryCache` если порог не достигнут (зонтичный §6, решение #5).
- Многоязычность карт — Фаза γ.
- Сравнение declared (JobDescription) vs observed (RoleProfile) — Фаза γ + ζ.
- Версионирование `RoleProfile.summaryCache` с историей — γ.

---

## 3. Структура и зависимости

```
0a (модели + GraphService + role-profile API контракт)
  ↓
0b (IdeaBlock.role_relevant + сущности группы Б наполняются)
  ↓
0d.1 Воркер + очередь + cron + rebuild endpoint (1 неделя)
  ↓
0d.2 Промпт + LLM-вызов + сохранение в summaryCache (3-5 дней)
  ↓
0d.3 Тестирование на пилотных данных + tuning порога N (3-5 дней)
```

**Не запускать 0d пока:**
- В Org нет ни одной Role с ≥5 связанными `IdeaBlock`-ами с `role_relevant=true`.
- 0b не закрыта (минимум `IdeaBlock.role_relevant` поле работает).

---

## 4. Архитектура воркера

### 4.1. Файловая структура

```
backend/src/workers/role-profile/
  role-profile.worker.ts     // основной воркер
  role-profile.queue.ts      // BullMQ-очередь wrapper
  role-profile.cron.ts       // cron-расписание
  role-profile.service.ts    // бизнес-логика (separable для unit-тестов)
  context-builder.ts         // сбор контекста через GraphService
  role-profile.types.ts      // TypeScript-типы
  role-profile.spec.ts       // unit-тесты
  role-profile.integration.spec.ts
```

### 4.2. Job payload

```ts
type RoleProfileJobPayload = {
  tenantId: string;
  roleId: string;
  triggerReason: 'cron' | 'on-demand' | 'stale-detected';
  triggeredByUserId?: string;     // для on-demand
};

type RoleProfileJobResult = {
  status: 'built' | 'skipped' | 'failed';
  skipReason?: 'below_threshold';
  blocksCount?: number;
  llmCostUsd?: number;
  durationMs?: number;
};
```

### 4.3. Job processor (pseudo-code)

```ts
async processRoleProfileJob(payload: RoleProfileJobPayload): Promise<RoleProfileJobResult> {
  // 1. Загрузить Role + RoleProfile
  const role = await prisma.role.findUniqueOrThrow({ where: { id: payload.roleId } });
  const profile = await prisma.roleProfile.findUniqueOrThrow({ where: { roleId: role.id } });

  // 2. Проверить порог (зонтичный §6 решение #5)
  const blocksCount = await prisma.ideaBlock.count({
    where: { orgId: payload.tenantId, roleRelevant: true, roleId: role.id, status: 'active' },
  });
  if (blocksCount < config.ROLE_PROFILE_MIN_BLOCKS) {
    await prisma.roleProfile.update({
      where: { id: profile.id },
      data: { status: 'forming' },
    });
    return { status: 'skipped', skipReason: 'below_threshold', blocksCount };
  }

  // 3. Собрать контекст через GraphService
  const context = await contextBuilder.buildContext({ tenantId: payload.tenantId, roleId: role.id });

  // 4. LLM-вызов
  const llmResult = await llmRouter.run({
    taskType: 'role-profile-build',
    promptKey: 'role-profile-build-v1',
    input: { role, context },
    dataClass: 'business-confidential',
  });

  // 5. Парсинг ответа + валидация zod-схемой
  const parsed = RoleProfileSchema.parse(llmResult.output);

  // 6. Сохранение
  await prisma.roleProfile.update({
    where: { id: profile.id },
    data: {
      summaryCache: parsed,
      status: 'ready',
      lastBuildAt: new Date(),
      buildVersion: { increment: 1 },
    },
  });

  return { status: 'built', blocksCount, llmCostUsd: llmResult.costUsd, durationMs: ... };
}
```

### 4.4. Error handling

- Любой throw в processor → BullMQ retry (3 раза с exponential backoff).
- После 3 retry → `RoleProfile.status = 'error'` + Prometheus метрика `z_role_profile_build_failed`.
- Stack уходит в pino-log с `roleId`, `tenantId`, `attempt`.

---

## 5. Сбор контекста через `GraphService`

### 5.1. Cypher-запрос

Через `GraphService.traverse` (escape-hatch внутри `common/graph/` — см. 0a §6.1):

```cypher
MATCH (r:role {id: $roleId, tenant_id: $tenant})
OPTIONAL MATCH (r)<-[:executes_role]-(p:person)
OPTIONAL MATCH (p)-[:participated_in]->(m:meeting)
OPTIONAL MATCH (m)-[:produced]->(b:idea_block {role_relevant: true})
OPTIONAL MATCH (b)-[:belongs_to_theme]->(t:theme)
OPTIONAL MATCH (r)<-[:described_by]-(jd:job_description)
OPTIONAL MATCH (r)-[:is_responsible_for]->(proc:process)
OPTIONAL MATCH (proc)-[:has_step]->(step:process_step)
OPTIONAL MATCH (b)-[:source_of]->(d:decision)
RETURN r, collect(distinct p) as persons, collect(distinct m) as meetings, collect(distinct b) as blocks, collect(distinct t) as themes, jd, collect(distinct proc) as processes, collect(distinct step) as steps, collect(distinct d) as decisions
```

### 5.2. ContextBuilder

```ts
type RoleContext = {
  role: { id: string; name: string; departmentName?: string };
  jobDescription?: { contentMd: string };
  ideaBlocks: Array<{ id: string; text: string; signalType: string; sourceMeetingTitle?: string; sourceDocumentName?: string; createdAt: Date }>;
  themes: Array<{ id: string; name: string; description: string }>;
  processes: Array<{ id: string; name: string; description?: string; steps?: Array<{ name: string }> }>;
  decisions: Array<{ id: string; text: string; rationale?: string; decidedAt: Date }>;
  meetings: Array<{ id: string; title: string; type: string; happenedAt: Date }>;
};
```

ContextBuilder подгружает из Postgres полные поля по `id`-шкам, которые AGE вернул (AGE хранит только структуру + name).

### 5.3. Лимиты контекста

LLM-окно ограничено (Claude Sonnet 4.6 — 200k tokens, но дорого). Жёсткий лимит:
- IdeaBlocks: top-50 по дате (новые лучше для observed-картины).
- Themes: top-10 по релевантности.
- Decisions: top-20 свежих.
- Meetings: top-10 свежих.
- ProcessStep: только для процессов, где Role owner.

Если контекст превышает лимит — truncate через `truncateContext()` с приоритетом «новые > старые».

---

## 6. Промпт `role-profile-build-v1`

### 6.1. Структура промпта

```
Ты — аналитик «памяти компании». Твоя задача — построить «карту должности» (RoleProfile) на основе наблюдаемой работы.

Должность: {{role.name}}
Отдел: {{role.departmentName}}

ДЕКЛАРАЦИЯ (то, что прописано в должностной инструкции):
{{#jobDescription}}{{contentMd}}{{/jobDescription}}
{{^jobDescription}}— должностная инструкция не загружена{{/jobDescription}}

НАБЛЮДАЕМАЯ РАБОТА (из встреч, документов, дампов):

Сотрудники на должности:
{{#persons}}- {{name}}{{/persons}}

Блоки идей, связанные с должностью (последние 50):
{{#ideaBlocks}}
- [{{signalType}}] {{text}} ({{sourceMeetingTitle || sourceDocumentName}}, {{createdAt}})
{{/ideaBlocks}}

Темы:
{{#themes}}- {{name}}: {{description}}{{/themes}}

Процессы, за которые роль отвечает:
{{#processes}}- {{name}}: {{description}}{{/processes}}

Решения, связанные с должностью:
{{#decisions}}- {{text}} (решено {{decidedAt}}{{#rationale}}, потому что {{rationale}}{{/rationale}}){{/decisions}}

ТВОЯ ЗАДАЧА:

Построй карту должности по наблюдаемой работе. Не повторяй декларацию — нас интересует то, что на самом деле делают сотрудники этой роли. Если декларация и наблюдение расходятся — отметь это в `style_profile` как поле «расхождение declared vs observed».

Верни JSON по схеме:

{
  "responsibilities": [
    { "title": "string", "details": "string", "evidence": ["uuid идеи блока"] }
  ],
  "skills": [
    { "name": "string", "level": "junior|middle|senior|expert", "evidence": ["uuid"] }
  ],
  "decision_patterns": [
    { "pattern": "string — описание типичного решения", "examples": ["uuid Decision или IdeaBlock"] }
  ],
  "common_pitfalls": [
    { "description": "string", "frequency_observation": "string" }
  ],
  "style_profile": "1-3 предложения о том, как роль работает: темп, коммуникация, расхождение declared vs observed, особенности"
}

Все строки на русском. Если данных мало для какой-то секции — верни пустой массив, не выдумывай.
```

### 6.2. Code fallback

Если prompt registry недоступен — встроенный текст промпта в `role-profile.service.ts` (skill `z-ai-agent-rules`).

### 6.3. LLM модель

Через `LlmRouterService` с `taskType='role-profile-build'`. Маршрутизация — Claude Sonnet 4.6 через `proxy.agent-lia.ru` (см. `llm-models-playbook.md` в корне).

---

## 7. Cron и stale-detection

### 7.1. Основной cron

```ts
@Cron('0 */4 * * *')  // раз в 4 часа
async runRoleProfileBuilds() {
  const profiles = await prisma.roleProfile.findMany({
    where: { status: { in: ['forming', 'stale'] } },
  });

  for (const profile of profiles) {
    await this.queue.add('build', { tenantId: profile.orgId, roleId: profile.roleId, triggerReason: 'cron' }, {
      jobId: `role-profile:${profile.roleId}:${profile.buildVersion}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    });
  }
}
```

### 7.2. Stale-detection cron

```ts
@Cron('0 * * * *')  // раз в час
async markStaleProfiles() {
  // Все RoleProfile в статусе 'ready', где есть новые IdeaBlock после lastBuildAt
  const staleCandidates = await prisma.$queryRaw`
    UPDATE role_profiles rp
    SET status = 'stale'
    WHERE rp.status = 'ready'
      AND EXISTS (
        SELECT 1 FROM idea_blocks ib
        WHERE ib.org_id = rp.org_id
          AND ib.role_relevant = true
          AND ib.role_id = rp.role_id
          AND ib.created_at > rp.last_build_at
      )
    RETURNING id;
  `;
  this.logger.info({ marked: staleCandidates.length }, 'Marked profiles as stale');
}
```

---

## 8. On-demand rebuild с логикой 409

```ts
@Post(':roleId/rebuild')
@UseGuards(JwtAuthGuard, TenantGuard, CasbinGuard)
@Roles('admin', 'owner')
async rebuild(@Param('roleId') roleId: string, @CurrentUser() user, @TenantId() tenantId: string) {
  // 1. Проверить, нет ли уже job в очереди
  const counts = await this.queue.getJobCounts('waiting', 'active');
  if (counts.waiting > 0 || counts.active > 0) {
    const existingJob = await this.queue.findJobByRoleId(roleId);  // helper в queue wrapper
    if (existingJob) {
      const status = existingJob.processedOn ? 'running' : 'queued';
      const since = new Date(existingJob.timestamp).toISOString();
      throw new HttpException({ status, since }, 409);
    }
  }

  // 2. Enqueue
  const job = await this.queue.add('build', { tenantId, roleId, triggerReason: 'on-demand', triggeredByUserId: user.id }, {
    jobId: `role-profile:${roleId}:on-demand:${Date.now()}`,
    attempts: 3,
  });

  return { status: 'queued', jobId: job.id };
}
```

---

## 9. Метрики и логи

### 9.1. Prometheus

```
z_role_profile_built_total{trigger="cron|on-demand|stale"}
z_role_profile_skipped_total{reason="below_threshold"}
z_role_profile_failed_total
z_role_profile_build_duration_seconds (histogram)
z_role_profile_llm_cost_usd (counter)
z_role_profile_blocks_used (histogram)
```

### 9.2. Логи

- `info` на каждый старт job, завершение, skip.
- `warn` на failure после retry.
- LLM-cost и latency — в lifecycle log.

---

## 10. Фазирование

| Фаза | Длительность | Содержимое |
|---|---|---|
| 0d.1 | 1 неделя | Воркер + очередь + cron (без LLM-вызова, mock'ом). On-demand endpoint с 409. Stale-detection cron. Базовые тесты |
| 0d.2 | 3-5 дней | ContextBuilder через GraphService.traverse. Промпт `role-profile-build-v1` в registry + code fallback. LLM-вызов через LlmRouterService. Парсинг + сохранение в summaryCache |
| 0d.3 | 3-5 дней | Тестирование на пилотных данных (минимум 1 Role с ≥5 IdeaBlock-ами role_relevant=true). Tuning порога N. Проверка ambiguous-кейсов |

---

## 11. DoD

### Технические

- [ ] `bun run typecheck` чистый.
- [ ] `bun run lint` чистый.
- [ ] `bun run test:unit` зелёный по `RoleProfileService`, `ContextBuilder`.
- [ ] `bun run test:integration` зелёный на полном flow (enqueue → process → save).
- [ ] `bun run build` чистый.
- [ ] Worker корректно стартует через `bun run worker:dev`, в логах нет ошибок при пустой очереди.

### Функциональные

- [ ] Для каждой пилотной компании сгенерирован минимум 1 непустой `RoleProfile` (зонтичный DoD).
- [ ] Сгенерированный `summaryCache` валидируется zod-схемой без ошибок.
- [ ] На Role с <N блоков идей → `status='forming'`, LLM-вызов не происходит, метрика `z_role_profile_skipped_total{reason="below_threshold"}` инкрементируется.
- [ ] On-demand rebuild возвращает 409 если job уже в очереди.
- [ ] Cron запускается раз в 4 часа (видно в логах).
- [ ] Stale-detection корректно метит профили после появления новых IdeaBlock.
- [ ] LLM-cost на одну сборку < $0.50 (Claude Sonnet 4.6); если выше — алёрт и пересмотр контекст-лимитов.

### Документация

- [ ] Создан `second-brain/01_projects/role-profile-agent.md` — описание агента, потока, промпта, порога N.
- [ ] Обновлён `second-brain/01_projects/ai-jobs.md` — добавлен `role-profile-build`.
- [ ] Обновлён `second-brain/01_projects/workers-queues.md` — `role-profile.queue`.
- [ ] Обновлён `second-brain/02_architecture/module-map.md` — `workers/role-profile`.
- [ ] Запись рефлексии в `second-brain/05_история/2026-MM-DD-0d-role-profile-agent-итог.md`.

### Матрица прослеживаемости

- [ ] Строки 37, 38, 39, 40, 41, 42, 79 (логика 409) — все `[x]`.

---

## 12. Риски и митигации

| Риск | Тяжесть | Митигация |
|---|---|---|
| LLM генерирует «мусорные» карты на малом объёме данных | средняя | Порог `N=5` блоков (зонтичный §6 решение #5); до достижения — статус `forming`, LLM не вызывается |
| LLM-стоимость растёт по мере роста компаний | высокая | Метрика `z_role_profile_llm_cost_usd` + алёрт при превышении $X/день; переход на on-demand only при необходимости |
| Cypher-запрос «всё, что касается роли» падает или медленный на больших Org | средняя | Лимит контекста (top-50 блоков и т.д.); index'ы на AGE-узлах `(tenant_id, type)`; smoke-тест на синтетических 1000 IdeaBlock'ов |
| Конкурентные rebuild для одной Role | низкая | Idempotency-key `${roleId}:${buildVersion}` + checkboard 409 на уровне controller |
| LLM возвращает невалидный JSON | средняя | zod-парсинг + retry (LLM-router сам делает retry на JSON-parse-error); после 3 retry → `status='error'` |
| `RoleProfile.summaryCache` устаревает быстрее, чем cron успевает | низкая | Cron каждые 4 часа; пользователи с актуальной нуждой используют on-demand rebuild |
| Конфликт concurrency в очереди (concurrency=1 + 100 Role) | средняя | Job-time ≤2 мин (LLM + сохранение). 100 Role → ~3.5 часа на все, что укладывается в 4-часовой cron. Если больше — повышаем concurrency до 2-3 |

---

## 13. Итог

_Заполняется по факту, когда 0d.1–0d.3 закрыты._

- **Реализовано полностью / частично:** _TBD_
- **Что осталось:** _TBD_
- **Ссылка на рефлексию:** _TBD_

## Ревизия от 2026-05-24

**Статус:** done

**Реализовано:**
- BullMQ-воркер: `backend/src/modules/knowledge-core/workers/role-profile.worker.ts` (живёт под knowledge-core, не отдельной директорией — архитектурное упрощение от ТЗ).
- Cron: `backend/src/modules/knowledge-core/workers/role-profile.cron.ts` — `@Cron('0 */4 * * *')` для builds + `@Cron('0 * * * *')` для stale-detection (полностью соответствует §7.1/§7.2 ТЗ).
- ContextBuilder через GraphService: `backend/src/modules/role-profiles/services/context-builder.service.ts`.
- Бизнес-логика сборки: `backend/src/modules/role-profiles/services/role-profile.service.ts` (отдельно от CRUD `role-profiles.service.ts`).
- Промпт: `backend/src/modules/knowledge-core/prompts/role-profile-build.prompt.ts` (с code fallback).
- LLM-вызов: через `LlmRouterService` с `taskType='role-profile-build'`.
- On-demand rebuild с 409: `backend/src/modules/role-profiles/role-profiles.controller.ts` + `role-profiles-agent.module.ts`; есть `role-profiles-crud.spec.ts`.
- В shipping-report 2026-05-23 α-8 wave 4 явно зафиксировано: «role-map-builder.worker + role-profile-build.prompt перенастроен под 9 слотов» — RoleProfileAgent эволюционировал дальше Phase 0d scope.

**Осталось:** —
