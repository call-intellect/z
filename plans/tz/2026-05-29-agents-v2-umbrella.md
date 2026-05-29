---
type: tz
status: draft
feature: agents-v2-umbrella
date: 2026-05-29
---

# ТЗ: Z Agents & Clones v2.0 — зонтичное

> **Анализ-источник:** [`plans/analysis/2026-05-29-z-agents-v2-technical-plan.md`](../analysis/2026-05-29-z-agents-v2-technical-plan.md) (технический план с доказательной базой)
> **Связанный анализ:** [`plans/analysis/2026-05-29-self-improving-agents-research.md`](../analysis/2026-05-29-self-improving-agents-research.md) (research SOTA-паттернов 2025-2026)
> **Триггер:** запрос Сергея 2026-05-29 «приди с доказательствами какие технические улучшения сделают Z лучше всех» + два уточнения (без кнопок в probe, qwen3.5:9b только tertiary)
> **Принцип:** надстройка над v1.0 без breaking changes; каждый модуль независим и под ENV-флагом

## Цель

Усилить существующую v1.0 шестью независимыми модулями: bi-temporal validity на связях графа, библиотека выполняемых навыков (`PracticeSkill`), автоматическая эволюция промптов через GEPA, извлечение правил из правок пользователей (AutoRule), мульти-агентный судья для критичных типов и step-level scoring tool-use Concierge. Плюс предварительная фаза 0 — убрать inline-кнопки из probe (по фидбеку 2026-05-29).

## Scope

**Входит:**
- Фаза 0 (3-5 дней) — миграция probe-system на свободный ввод без inline-кнопок (текст + опц. голос через ASR)
- Фаза A (2 недели) — `bi-temporal-edges` + `multi-agent-debate` для critical-types
- Фаза B (1.5 месяца) — `autorule-extract` (shadow) + `concierge-prm-step-scorer` (shadow)
- Фаза C (3 месяца) — `practice-skills` + `prompt-evolution-gepa` (с auto-promote через A/B)
- Фаза D (6+ месяцев) — расширение debate на все critical, full auto-promote AutoRule, research для v3.0
- Все 6 модулей под отдельными ENV-флагами с возможностью kill-switch без deploy
- Обновление `second-brain/02_architecture/ai-agents-map.md` после каждой фазы

**Не входит:**
- Сам Darwin Gödel Machine (research для v3.0, отложен)
- Замена существующих специалистов 3-1..3-9 (они работают, мы только надстраиваем)
- Перенос на другие LLM-провайдеры (стек DeepSeek + OpenAI-proxy + Ollama остаётся)
- UI-редизайн админки (только необходимые dashboard-страницы для нового состояния)
- Замена knowledge-core retrieval pipeline (chat-v2 retrieval, dialog-layer) — расширяем фильтрами, не переделываем

## Контекст (что уже есть в v1.0)

См. полный разбор в [`plans/analysis/2026-05-29-z-agents-v2-technical-plan.md`](../analysis/2026-05-29-z-agents-v2-technical-plan.md) §I.

Ключевое для ТЗ:
- `SkillTrait` + `SkillTraitConcept` (с union-find ≥0.92) — descriptive характер
- `ExecutablePersona` (versioned, scope=person|role) — компилируется LLM
- `ClonesService.askPerson/askRole` — anti-fakery (≥2 reasoning блока, cosine ≥0.70)
- `LlmTaskRoute` с `pinnedVersionNote` + `editedByAdmin` (защита ручных правок)
- `CurationService.triage` + `CURATION_CRITICAL_TYPES_DEFAULT` (Decision, Regulation severity=critical и т.д.)
- `ProbeService` с 30+ триггерами и `probe-formulate.prompt.ts`, который сейчас выдаёт `{question, options[]}` — `options` пойдут на выход (фаза 0)
- `LlmRouter` с цепочкой primary → secondary → tertiary
- `IdeaBlockLink` + `EntityLink` — пока без validFrom/validUntil

---

## Фаза 0 — Probe без кнопок (3-5 дней)

**Цель:** убрать inline-кнопки из всех уточняющих вопросов системы. Только свободный ввод (текст или голос через ASR).

**Источник:** feedback `feedback_probe_no_buttons_text_voice_only.md` + [[concierge-text-only-output]].

### Backend

**Изменения в `backend/src/modules/probe/`:**
- `prompts/probe-formulate.prompt.ts` — JSON Schema: удалить поле `options: string[]`, оставить только `question: string ≤ 200 символов`. Системный промпт переписать: «Сформулируй короткий уточняющий вопрос для человека, без вариантов ответа — ожидаем свободный ответ текстом или голосом».
- `services/probe.service.ts` — удалить логику дедупа по options-хэшу, оставить дедуп по `reason + payloadHash(question)`.
- Все per-specialist `probe.service.ts` (3-1..3-9) — где формировались structured options, переписать на свободный ввод. Контекст для LLM остаётся (resource данные), output только question.

**Изменения в `backend/src/modules/conversational/`:**
- `ConversationalService.sendNotification` — `eventType='specialist.probe'`: payload убрать `options`, оставить только `question`, `actionUrl`, `specialistName`, `reason`, `personId?`.
- Telegram bot adapter — удалить `reply_markup.inline_keyboard` в сообщениях типа probe. Использовать обычный текст. Ответ пользователя приходит как regular message → `ProbeResponseHandler` парсит свободный текст.
- Email adapter — убрать кнопки-варианты, оставить только текст вопроса с ссылкой на actionUrl (там можно ответить свободно).
- In-app `Notification` — `payload.options` deprecated, при отображении показывать только текст + поле ввода.

**Изменения в `backend/src/modules/probe/handlers/probe-response.handler.ts`:**
- Парсинг ответа: входит **свободный текст** (раньше мог быть индекс option или текст). Парсим как natural language через лёгкий LLM-вызов (`probe-response-classify`, новый taskType: DeepSeek V4 Flash → OpenAI mini → Ollama qwen3.5:9b как tertiary safety-net).
- `probe-response-classify` промпт: «Вот вопрос системы: {question}. Вот ответ человека: {response}. Извлеки структурированный ответ: {answer: string, confidence: 0..1, requiresFollowup: bool}». JSON Schema strict.
- Если confidence < 0.5 — записать в `RawEvent` как `notification_response_unclear` и эмиттнуть новый probe-event `probe.response_unclear` (получатель — тот же оригинальный recipient).
- Если confidence ≥ 0.5 — обычный `RawEvent(kind='notification_response')` с `answer` в payload, дальше идёт в обычный ingest.

**Голосовой ввод:**
- Telegram bot — на voice message в ответ на probe: транскрибировать (существующий ASR pipeline через Voice memo transcription, см. `ai-jobs.md` §Concierge dialog-layer) → передать текст в `probe-response-classify`.
- In-app UI — компонент `ProbeAnswerInput` с двумя кнопками управления (не ответом!): «🎤 Записать голосом» и «✍ Ввести текст». «🎤» открывает голосовую запись → ASR → текст в textarea (пользователь может отредактировать перед отправкой). «✍» — обычный textarea сразу. Отправка обычной кнопкой «Отправить» — это **управление**, не вариант ответа, разрешено по [[probe-no-buttons-text-voice-only]].

### База данных

**Миграция (через `bun run prisma:push`):**
- `Notification.payload` (Json) — старые записи с `options` остаются, новые без них. Backward-compatible, не требует backfill.
- Новый enum `RawEventKind` если ещё нет: `notification_response_unclear` (для случаев низкой confidence парсинга).

### Frontend

**Изменения:**
- `frontend/src/ui/probe/ProbeCard.tsx` (или эквивалент) — удалить рендеринг массива кнопок из `payload.options`. Заменить на компонент `ProbeAnswerInput` (свободный ввод с переключателем голос/текст).
- `frontend/src/ui/notifications/NotificationItem.tsx` — для `eventType='specialist.probe'` показывать только question + actionUrl + поле ввода.
- В Telegram WebApp (если есть) — отдельная проверка, что inline_keyboard не используется.

### Тесты

- Snapshot test на `probe-formulate.prompt.ts` — JSON Schema без поля `options`.
- Integration test на `ProbeResponseHandler.handle()` — три сценария:
  1. clear text response → RawEvent c parsed answer
  2. unclear text response → RawEvent + probe `response_unclear`
  3. voice message → ASR → text response (mock ASR provider)
- E2E test на Telegram bot adapter — verify нет `reply_markup` в outgoing message.

### Метрики

- `probe_response_classified_total{confidence_bucket}` (`high|medium|low`) — counter
- `probe_response_voice_input_total` — counter (сколько ответов пришло голосом)
- `probe_response_unclear_total{originalReason}` — counter

### ENV (новые)

```
PROBE_RESPONSE_CLASSIFY_ENABLED=true   # для роллбэка к парсингу-как-есть в случае проблем
PROBE_VOICE_INPUT_ENABLED=true          # фиче-флаг голосового ввода
```

### DoD Фаза 0

- [ ] `probe-formulate.prompt.ts` — JSON Schema без `options`, snapshot test зелёный
- [ ] Все per-specialist probe services переписаны на свободный ввод
- [ ] Telegram bot — `reply_markup` удалён в probe messages, manual test
- [ ] In-app `ProbeCard` рендерит `ProbeAnswerInput` (text + voice toggle)
- [ ] `ProbeResponseHandler` парсит свободный текст через `probe-response-classify` (новый taskType seed'нут)
- [ ] Integration test 3 сценариев зелёный
- [ ] Метрики `probe_response_*` отдаются
- [ ] `second-brain/02_architecture/ai-agents-map.md` §5.3-5.4 обновлены — новая схема без кнопок

---

## Фаза 0.5 — Router fix + Knowledge backfill (3-5 дней, параллельно Фазе 0)

**Цель:** закрыть пропуск, при котором фраза «я внедряла CRM в Лукойле» (signalType ∈ {`expertise`, `experience`, `competence`}) идёт только в Skill-специалиста (3-7), но не в Knowledge-Clone-специалиста (3-2). После фикса — backfill старых блоков, чтобы KnowledgeProfile сотрудников не остался «дырявым».

**Источник:** обсуждение Сергея 2026-05-29 (вопросы 5 и 6 из другого чата). Согласовано техническое решение B+B (отвечает Claude, после проверки кода).

### Аргументация и доказательная база

**Вопрос 5: Router fix — expertise/experience/competence → одновременно 3-7 (SKILL) И 3-2 (KNOWLEDGE_CLONE)**

Проверено в коде [`backend/src/modules/knowledge-core/services/router.service.ts`](../../backend/src/modules/knowledge-core/services/router.service.ts) строки 293-302:

```ts
case 'expertise':
case 'experience':
case 'competence':
  {
    const hasEmployeeSubject = await this.hasEmployeeSubject(block.id);
    if (hasEmployeeSubject) {
      targets.add(RouterService.SPECIALIST.SKILL);  // ← только сюда
    }
  }
  break;
```

Подтверждаю: текущий routing **некорректный** для целей продукта.

**Почему фраза «я внедряла CRM в Лукойле» — это И навык, И знание:**
- **Навык** (для 3-7 SkillProfile): «умеет вести проекты внедрения CRM», «работает с большими корпоративными клиентами» — поведение
- **Знание** (для 3-2 KnowledgeProfile): «знает специфику энергетического сектора», «понимает циклы согласования в РФ-госкорпорациях» — факты

Эти знания нужны для разных вопросов клона Z:
- «У кого спросить про энергетический сектор?» — KnowledgeProfile
- «Кому поручить внедренку Лукойлу?» — SkillProfile

Если факт «работала с Лукойлом» оседает только в одном из двух — на половину вопросов ответа не будет.

**Подтверждение, что воркер 3-2 примет такие блоки:** в [`second-brain/02_architecture/ai-agents-map.md`](../../second-brain/02_architecture/ai-agents-map.md) видно, что `specialist-3-2-knowledge-clone.worker` фактически только триггерит ребилд профиля Person'а (`enqueueRebuildKnowledgeProfile` с debounce 60s). Сам ребилд (`knowledge-clone-rebuild.worker`) **читает все блоки за 12 месяцев** через `IdeaBlockEntity` независимо от того, по какому signalType пришёл триггерный блок. То есть **достаточно расширить routing**, ничего больше менять не нужно — старые блоки уже учтутся в ребилде.

**Cost-impact:** один дополнительный enqueue per block с expertise/experience/competence + employee subject. Реальный ребилд debounce 60s — на 10 таких блоков подряд = 1 LLM-вызов. Defensive cap `ROUTER_MAX_SPECIALISTS_PER_BLOCK=4` уже подрезает разброс. **Acceptable.**

**Вопрос 6: Backfill старых блоков — да, idempotent скрипт**

Без backfill'а сотрудники с длинной историей будут иметь «дырявый» KnowledgeProfile. Алиса работает год — все её упоминания экспертизы в графе — но Knowledge-карточка пуста, потому что cron `knowledge-clone-rebuild` ищет Person'ов **со свежей активностью за неделю**. Если её expertise-блоки старше недели и она нигде не светилась → ребилд не запустится.

**Idempotent:** воркер 3-2 фактически только enqueue ребилд. Существующий debounce через `jobId='rebuild-knowledge-profile_<personId>'` гарантирует — повторный запуск backfill = no-op.

**Cost:** ребилд = 1 LLM-вызов (`knowledge-clone-extract` + опц. `knowledge-clone-merge`) на Person. Цепочка DeepSeek V4 Flash → OpenAI mini → Ollama. На 1000 employee'ев Org = ~$0.5-2 разово. На 10000 = ~$5-20. **Приемлемо.**

### Backend

**Изменение в `backend/src/modules/knowledge-core/services/router.service.ts:293-302`:**

```ts
case 'expertise':
case 'experience':
case 'competence':
  {
    const hasEmployeeSubject = await this.hasEmployeeSubject(block.id);
    if (hasEmployeeSubject) {
      targets.add(RouterService.SPECIALIST.SKILL);
      targets.add(RouterService.SPECIALIST.KNOWLEDGE_CLONE);  // ← добавить
    }
  }
  break;
```

**Обоснование `if hasEmployeeSubject`:** KnowledgeProfile есть только для employee Person'ов (см. [`knowledge-clone.md`](../../second-brain/01_projects/knowledge-clone.md) — условие `Person.relationship='employee'`). Для external Person'ов профиль не строится, нет смысла enqueue. Условие то же, что для SKILL.

**Тесты:**
- `backend/src/modules/knowledge-core/services/__tests__/router.spec.ts` — расширить existing test'ы на 3 кейса:
  1. `signalType=expertise` + employee subject → 2 specialists (`SKILL`, `KNOWLEDGE_CLONE`)
  2. `signalType=experience` + external subject → 0 specialists (нет employee)
  3. `signalType=competence` + employee subject → 2 specialists
- Snapshot test на `RouterService.specialistsForBlock()` если есть.
- E2E: insert block с `signalType=expertise` через `BlockIngest` → verify оба jobName появились в очереди `core.specialist-routing`.

### Backfill скрипт

**Новый файл:** `backend/scripts/backfill-knowledge-clone-after-router-fix.ts`

```ts
import { createPrismaClient } from './_lib/prisma';
import { coreQueue } from '../src/modules/knowledge-core/queues/core.queue';

const SIGNAL_TYPES = ['expertise', 'experience', 'competence'] as const;

interface Options {
  tenantId?: string;
  since?: Date;
  limit?: number;
  dryRun?: boolean;
}

async function main(opts: Options) {
  const prisma = createPrismaClient();

  // 1. Найти employee-Person'ов, у которых есть canonical-блоки с
  //    expertise/experience/competence в IdeaBlockEntity (role=subject)
  const employees = await prisma.person.findMany({
    where: {
      relationship: 'employee',
      ...(opts.tenantId && { tenantId: opts.tenantId }),
      // подзапрос: есть хотя бы один такой блок
      ideaBlockEntities: {
        some: {
          role: 'subject',
          ideaBlock: {
            signalType: { in: SIGNAL_TYPES as any },
            status: 'canonical',
            ...(opts.since && { createdAt: { gte: opts.since } }),
          },
        },
      },
    },
    select: { id: true, tenantId: true, entityId: true },
    ...(opts.limit && { take: opts.limit }),
  });

  console.log(`Found ${employees.length} employees with expertise/experience/competence blocks`);

  if (opts.dryRun) {
    console.log('Dry-run mode, no enqueue');
    return;
  }

  let enqueued = 0;
  for (const emp of employees) {
    await coreQueue.enqueueRebuildKnowledgeProfile({
      tenantId: emp.tenantId,
      personId: emp.id,
    });
    enqueued++;
  }

  console.log(`Enqueued ${enqueued} rebuild jobs (existing debounce will dedupe)`);
}

// CLI: --tenant <orgId> --since 2026-01-01 --limit 1000 --dry-run
const args = process.argv.slice(2);
const opts: Options = {
  tenantId: args.find(a => a.startsWith('--tenant='))?.split('=')[1],
  since: args.find(a => a.startsWith('--since='))?.split('=')[1]
    ? new Date(args.find(a => a.startsWith('--since='))!.split('=')[1])
    : undefined,
  limit: args.find(a => a.startsWith('--limit='))?.split('=')[1]
    ? parseInt(args.find(a => a.startsWith('--limit='))!.split('=')[1], 10)
    : undefined,
  dryRun: args.includes('--dry-run'),
};

main(opts).catch(console.error);
```

**CLI флаги:**
- `--tenant=<orgId>` — для конкретной Org (по умолчанию все)
- `--since=2026-01-01` — только блоки после даты (по умолчанию все)
- `--limit=1000` — cap для дроблёного прогона
- `--dry-run` — только показать сколько Person'ов попадёт, ничего не enqueue

**Регистрация:**
- В `backend/scripts/apply-prod-deploy.ts` массив `STEPS` — добавить entry:
  ```ts
  {
    phase: 'backfill',
    name: 'backfill-knowledge-clone-after-router-fix',
    file: 'backfill-knowledge-clone-after-router-fix.ts',
    description: 'Forces Knowledge-Clone rebuild for employees with expertise/experience/competence blocks (one-time after router fix)',
    skipBootstrap: true,  // только для апгрейда, не для свежего prod
  }
  ```
- Используется `createPrismaClient()` из `_lib/prisma.ts` (по правилу из `CLAUDE.md`).
- В `prod-deploy-log.md` Шаг 8 — добавить запись.

**Защита от перегрузки:**
- Backfill использует существующий `enqueueRebuildKnowledgeProfile` с debounce 60s → даже если запустить 5000 employees, очередь обработает плавно (1 LLM-вызов / 60 сек / employee для каждого reuild)
- BullMQ rate-limit уже настроен на очереди `core.knowledge-clone-rebuild` (concurrency=1) → нет шанса перегрузить LLM-провайдер

### База данных

Изменений в Prisma схеме **не требуется**. Router фикс — изменение логики, backfill — использует существующие enqueue API.

### Метрики

Существующие достаточны:
- `core_router_dispatched_total{specialist='3-2-knowledge-clone'}` — counter, **должен подскочить** после фикса на старых tenant'ах (мониторим первые 7 дней)
- `core_specialist_pipeline_duration_seconds{type='knowledge_profile'}` — histogram, чтобы убедиться, что не выросла latency аномально
- `core_specialist_llm_tokens_total{type='knowledge_profile'}` — counter, чтобы видеть стоимость
- `knowledge_clone_categories_per_profile` — histogram, ожидаем рост среднего числа категорий после backfill

Новых метрик не нужно.

### Откат

- Router fix → один-строчный revert в `router.service.ts`
- Backfill → нечего откатывать (idempotent rebuild — старые профили перезапишутся новыми, можно не запускать повторно если что)

### DoD Фазы 0.5

- [ ] `router.service.ts:293-302` обновлён, добавлен `targets.add(KNOWLEDGE_CLONE)`
- [ ] 3 unit-теста на router добавлены, snapshot обновлён
- [ ] E2E test: block с expertise + employee subject → оба jobName в очереди
- [ ] Backfill скрипт `backfill-knowledge-clone-after-router-fix.ts` написан с CLI флагами
- [ ] Скрипт зарегистрирован в `apply-prod-deploy.ts` (phase='backfill', skipBootstrap=true)
- [ ] Dry-run прогон на dev: ожидаемое число employee'ев подтверждено
- [ ] Реальный прогон на dev: ребилды отработали без ошибок, KnowledgeProfile у sample 5 employee'ев заполнен
- [ ] Метрика `core_router_dispatched_total{specialist='3-2-knowledge-clone'}` выросла после deploy на prod (мониторинг 7 дней)
- [ ] `second-brain/01_projects/knowledge-clone.md` обновлён — упомянуть расширенный routing
- [ ] `docs/operations/prod-deploy-log.md` Шаг 8 обновлён — добавлена backfill команда

### Когда передумаем

**Если метрика `core_router_dispatched_total{specialist='3-2-knowledge-clone'}` подскочит так, что LLM-бюджет начнёт упираться** — уточнить routing: пускать в 3-2 только если в блоке упоминается **конкретная сущность** (Customer/Project/Tool/Skill — не голые «я умею»). Это будет дополнительное условие в router, не отмена фикса.

**Если на проде окажется не «тысячи», а «сотни тысяч» блоков и backfill упрётся в бюджет** — запускать дроблёно через `--since=2026-03-01 --limit=1000`, по неделе. Скрипт это поддерживает из коробки.

---

## Фаза A — Bi-temporal edges + Multi-agent debate (2 недели)

**Цель:** добавить временную валидность связям графа и заменить single-LLM-arbiter на 3-judge debate для критичных типов.

### Модуль A1: bi-temporal-edges

**Источник доказательств:** Zep paper arxiv 2501.13956 (+15pp LongMemEval), Graphiti hybrid search P95 300ms без LLM-вызовов.

#### База данных

```prisma
model IdeaBlockLink {
  // existing fields...
  validFrom    DateTime?  @db.Timestamptz
  validUntil   DateTime?  @db.Timestamptz

  @@index([sourceBlockId, validFrom, validUntil])
  @@index([targetBlockId, validFrom, validUntil])
}

model EntityLink {
  // existing fields...
  validFrom    DateTime?  @db.Timestamptz
  validUntil   DateTime?  @db.Timestamptz

  @@index([sourceEntityId, validFrom, validUntil])
  @@index([targetEntityId, validFrom, validUntil])
}
```

**Backfill:** `backend/scripts/backfill-edge-temporal.ts` — идемпотентный (`WHERE validFrom IS NULL`):
- Для каждого existing row: `validFrom = createdAt`, `validUntil = NULL` (открытый интервал).
- Зарегистрировать в `backend/scripts/apply-prod-deploy.ts` (массив `STEPS`) с `phase='backfill'`, `skipBootstrap=false`.
- Использовать `createPrismaClient()` из `_lib/prisma.ts`.

#### Backend

**Изменения в JSON Schema двух judge'ей:**
- `backend/src/modules/knowledge-core/services/block-link.service.ts.judgeLink()` — добавить в output:
  ```ts
  validFrom: { type: 'string', format: 'date-time', nullable: true,
    description: 'Если в блоках явно указано когда факт стал валиден — ISO date; иначе null' }
  validUntil: { type: 'string', format: 'date-time', nullable: true,
    description: 'Если связь явно завершена в блоках — ISO date; иначе null (открытый интервал)' }
  ```
- `backend/src/modules/knowledge-core/services/entity-graph.service.ts.judgeRelation()` — то же.
- Промпт-инструкция: «Если в исходных блоках есть временные указатели ("с октября", "до конца квартала") — извлекай и в `validFrom/validUntil` ISO date. Если ничего не сказано — оставь null».

**Новый сервис: `TemporalConflictService`** (`backend/src/modules/knowledge-core/services/temporal-conflict.service.ts`):
- Метод `onNewLink(newLink: IdeaBlockLink | EntityLink)` вызывается после upsert.
- Логика: ищет existing links того же source+target, но с противоречащим relationType (например, `develops` vs `contradicts`, `works_at` vs `left_company`).
- При conflict — НЕ удаляет старый, а ставит `validUntil = NOW` на старый и `validFrom = NOW` на новый.
- Метрика `temporal_edges_invalidated_total{relationType}`.

**Расширение retrieval:**
- `ChatV2RetrievalService.fetchCandidates()` уже принимает `validAt` для блоков. Добавить filter на edges:
  ```sql
  WHERE (link.validFrom IS NULL OR link.validFrom <= $validAt)
    AND (link.validUntil IS NULL OR link.validUntil > $validAt)
  ```
- `ClonesService` retrieval — то же.
- Default `validAt = NOW()` если не передан — backward-compat.

#### Тесты

- Unit test `temporal-conflict.service.spec.ts` — 5 сценариев: insert без conflict, insert с conflict (открытый → закрытый), insert с conflict (закрытый → новый открытый), evolving chain длиной 3, конкурентный insert (race).
- Integration test `block-link-validity.spec.ts` — judgeLink с временным контекстом, проверка что validFrom/validUntil парсятся правильно из «с октября», «до конца квартала», «бессрочно», «до подписания контракта».
- Retrieval test — `validAt=2026-08` находит link с `validFrom=2026-06, validUntil=2026-10`, не находит с `validUntil=2026-07`.

#### ENV

```
BI_TEMPORAL_EDGES_ENABLED=false   # default off для контролируемого rollout
```

При `false` — `validFrom/validUntil` записываются, но retrieval фильтр не применяется (как сейчас). При `true` — фильтр применяется. Можно включить per-tenant через `LlmTenantOverride` (новое поле `featureFlags Json?` — отложено в фазу D, в A — глобальный флаг).

#### Метрики

- `z_edges_with_temporal_total{type='block'|'entity'}` (gauge — обновляется ежечасно через snapshot cron)
- `z_temporal_edges_invalidated_total{relationType}` (counter)
- `z_temporal_filter_hits_total{passed|filtered_out}` (counter — сколько edges фильтр пропустил vs отсёк)

#### DoD A1

- [ ] Prisma миграция применена локально и на dev через `bun run prisma:push`
- [ ] Backfill script зарегистрирован в `apply-prod-deploy.ts`, локальный прогон 0 записей на пустой dev
- [ ] judgeLink и judgeRelation JSON Schema обновлены, snapshot tests обновлены
- [ ] `TemporalConflictService` написан, unit тесты зелёные
- [ ] `ChatV2RetrievalService` принимает `validAt` для edges, integration test зелёный
- [ ] ENV `BI_TEMPORAL_EDGES_ENABLED` добавлен в `env.schema.ts`
- [ ] Метрики выставляются
- [ ] `second-brain/02_architecture/knowledge-core.md` обновлён — новая схема edges

### Модуль A2: multi-agent-debate (только для decision-supersede-detect в Фазе A)

**Источник доказательств:** Du et al. Multi-Agent Debate (+5-15% accuracy на reasoning), diverse providers > homogeneous.

#### Backend

**Новый сервис `MultiAgentDebateService`** (`backend/src/modules/ai/services/multi-agent-debate.service.ts`):

```ts
interface DebateRequest {
  task: string;
  candidates: any[];
  contextBlocks: any[];
  n: number;            // default 3
  rounds: number;       // default 1, max 2
  taskType: string;     // например 'debate-decision-supersede'
}

interface DebateVote {
  stance: 'strict-critic' | 'empathetic-supporter' | 'neutral-judge';
  verdict: string;
  reasoning: string;
  confidence: number;
  provider: string;
  costUsd: number;
}

interface DebateVerdict {
  decision: string;
  votes: DebateVote[];
  consensusType: 'unanimous' | 'majority' | 'split';
  rounds: number;
  totalCostUsd: number;
}

async judge(req: DebateRequest): Promise<DebateVerdict>
```

**Реализация:**
- Round 1: 3 параллельных LLM-вызова через `LlmRouter`, с явным `providerPref` на каждый:
  1. `strict-critic` → primary `deepseek:deepseek-v4-pro`
  2. `empathetic-supporter` → primary `openai-via-proxy:gpt-5.4`
  3. `neutral-judge` → primary `deepseek:deepseek-v4-flash` (другая модель того же провайдера для cost-balance)
- **Ollama НЕ участвует в debate** (по [[ollama-tertiary-only-deepseek-flash-cheap]]) — только secondary fallback в каждой цепочке.
- Stance-prompts:
  - Strict: «Ты критик. Найди причины НЕ принимать этот candidate. Default к отказу при сомнении.»
  - Supporter: «Ты ищешь причины ПРИНЯТЬ candidate. Default к принятию при наличии хоть какого-то signal.»
  - Neutral: «Ты нейтральный арбитр. Взвесь pro и contra.»
- Majority verdict: 2 из 3 → consensus. 1-1-1 (split) или round-2 disabled → fallback к `decision = 'split_uncertain'`, эскалация в `CurationService` deep review.

**Round 2 (опц.):**
- Если round 1 = split AND `req.rounds >= 2` AND `DEBATE_ROUND2_ENABLED=true` → круг 2 с обоснованиями: каждый stance получает голосования других + их reasoning, делает повторный verdict.

**Интеграция с `decision-supersede-detect`:**
- В `backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts` метод arbitration (currently single LLM call для verdict `new|merge|supersedes`):
  ```ts
  if (this.config.multiAgentDebateEnabled) {
    const debateVerdict = await this.debate.judge({
      task: 'Является ли candidate решение superseding existing decision?',
      candidates: [{ candidate, knnTop5 }],
      contextBlocks: [...],
      n: 3,
      rounds: 1,
      taskType: 'debate-decision-supersede',
    });
    return this.mapDebateToSupersedeVerdict(debateVerdict);
  }
  // fallback: old single LLM call
  ```

**Новый taskType `debate-decision-supersede`:**
- Primary chain: `deepseek-v4-pro` → `openai-via-proxy:gpt-5.4` → `ollama:qwen3:30b` (capable, потому что nuanced)
- Seed: `backend/scripts/seed-llm-task-routes-agents-v2.ts` (новый файл)
- `pinnedVersionNote = 'Закреплено на deepseek-v4-pro 2026-05-29 для Multi-Agent Debate Фаза A'`

#### Тесты

- Unit test `multi-agent-debate.service.spec.ts` — mock LlmRouter, 4 сценария:
  1. Unanimous (3-0 agree) → consensus, round 1
  2. Majority (2-1) → consensus, round 1
  3. Split (1-1-1) → escalate к CurationService deep
  4. Cost cap exceeded → fallback к single arbiter с warning
- Integration test на `specialist-3-3-decisions.service` — реальный decision с КNN-кандидатами → debate verdict приемлемого формата для `supersedeVerdict`.
- Cost budget test — verify что 1 debate run < $0.01 (3 calls × ~$0.003).

#### ENV

```
MULTI_AGENT_DEBATE_ENABLED=false   # default off
DEBATE_DEFAULT_N=3
DEBATE_DEFAULT_ROUNDS=1
DEBATE_ROUND2_ENABLED=false        # включить когда оценим cost / value round 1
DEBATE_COST_CAP_USD_PER_RUN=0.05   # budget cap, если превышен — fallback к single arbiter
```

#### Метрики

- `z_debate_judgments_total{taskType, decision, consensusType}` (counter)
- `z_debate_cost_usd_total{tenant, taskType}` (counter)
- `z_debate_round2_triggered_total{taskType}` (counter)
- `z_debate_provider_disagreement_total{providerA, providerB, taskType}` (counter — какие модели чаще не соглашаются)
- `z_debate_fallback_to_single_total{reason}` (counter — `cost_cap`, `provider_unavailable`)

#### DoD A2

- [ ] `MultiAgentDebateService` написан с unit-тестами 4 сценариев
- [ ] Новый taskType `debate-decision-supersede` seed'нут с `pinnedVersionNote`
- [ ] `specialist-3-3-decisions.service` integrated через ENV-флаг, integration test зелёный
- [ ] Cost budget test показывает < $0.01 на run
- [ ] Метрики `z_debate_*` отдаются
- [ ] `second-brain/02_architecture/ai-agents-map.md` §6.2 обновлён — упомянуть debate

### Фаза A DoD общий

- [ ] Оба модуля включены под ENV-флагами на dev
- [ ] A/B на prod: A1 — на одной Org включить `BI_TEMPORAL_EDGES_ENABLED=true` на неделю → measure retrieval accuracy на cherry-picked queries («что мы знали про X в апреле»). A2 — на одной Org включить `MULTI_AGENT_DEBATE_ENABLED=true` → measure `decision-supersede` точность через manual sample 20 cases
- [ ] Рефлексия в `second-brain/05_история/2026-06-XX-agents-v2-phase-a.md`
- [ ] Prod-deploy log обновлён (Шаги 4 для миграции, 8 для backfill, 12 для smoke новых очередей)

---

## Фаза B — AutoRule + Concierge PRM (shadow mode, 1.5 месяца)

**Цель:** собирать данные для будущей auto-evolution. Никакого автоматического применения — только запись и анализ.

### Модуль B1: autorule-extract (shadow)

**Источник доказательств:** AutoRule arxiv 2506.15651 (+28.6% AlpacaEval2, reduced reward hacking measurable).

#### База данных

```prisma
model PromptFeedback {
  id              String   @id @default(uuid())
  tenantId        String
  promptKey       String   // например 'meeting-report-fast'
  promptVersion   String
  invocationId    String   // ссылка на AiUsageLog.id
  inputDigest     String   @db.Text  // короткое digest of input (для group by similar contexts)
  inputEmbedding  Unsupported("vector(1536)")?
  originalOutput  String   @db.Text
  editedOutput    String?  @db.Text
  editDistance    Float?   // 0..1 (Levenshtein normalized)
  editedAt        DateTime?
  editedByUserId  String?
  downstreamSignals Json?  // {followUpCreated, recoClicked, taskCompleted, statusChanged}
  createdAt       DateTime @default(now())

  @@index([promptKey, createdAt])
  @@index([tenantId])
  @@index([promptKey, inputEmbedding], type: Hnsw, ops: VectorCosineOps)
}

model PromptRule {
  id              String   @id @default(uuid())
  tenantId        String?  // null = global
  promptKey       String
  rule            String   @db.Text  // human-readable
  ruleType        RuleType  // 'must_do' | 'must_not_do' | 'tone' | 'structure'
  source          RuleSource  // 'autorule' | 'manual_admin'
  examples        Json     // [{originalSnippet, editedSnippet, why}]
  confidence      Float    // 0..1
  status          RuleStatus  // 'shadow' | 'active' | 'archived' | 'overridden_by_admin'
  shadowMetrics   Json?    // {runs, withRuleScore, withoutRuleScore}
  embedding       Unsupported("vector(1536)")?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  promotedAt      DateTime?
  archivedAt      DateTime?
  archivedReason  String?

  @@index([promptKey, status])
  @@index([tenantId, status])
}

enum RuleType { must_do must_not_do tone structure }
enum RuleSource { autorule manual_admin }
enum RuleStatus { shadow active archived overridden_by_admin }
```

#### Backend

**Новый модуль `backend/src/modules/prompt-evolution/`:**

```
prompt-evolution/
├─ services/
│   ├─ prompt-feedback-collector.service.ts
│   ├─ autorule-extractor.service.ts
│   └─ rule-injector.service.ts
├─ workers/
│   ├─ autorule-extract.cron.ts
│   └─ prompt-feedback-collect.handler.ts (event listener)
├─ controllers/
│   └─ admin-prompt-evolution.controller.ts
└─ dto/
    └─ ...
```

**Сбор feedback:**
- В `LlmRouter.recordUsage()` (уже существует) добавить эмит события `ai.invocation.completed` с `{invocationId, promptKey, promptVersion, input, output, tenantId}`.
- `PromptFeedbackCollectorService.handleInvocationCompleted()` — сохраняет в `PromptFeedback` (`originalOutput`, `editedOutput=null` пока).
- Когда пользователь правит результат (через любое из user-facing UI: админка отчётов, правки в `/me/inbox`, правки `Meeting.summary`):
  - Существующий хук на update → дополнительно эмиттит `ai.invocation.edited` с `{invocationId, editedOutput, editedByUserId}`.
  - `PromptFeedbackCollectorService.handleInvocationEdited()` — обновляет existing `PromptFeedback` с `editedOutput`, вычисляет `editDistance` (levenshtein normalized).
- `inputEmbedding` вычисляется через `KnowledgeEmbeddingService` при сохранении.

**AutoRule extraction:**

```ts
// modules/prompt-evolution/services/autorule-extractor.service.ts

async extractForPromptKey(promptKey: string, tenantId: string | null): Promise<PromptRule[]> {
  // 1. Загрузить feedback за последние 24ч с editedOutput != null
  const feedback = await this.prisma.promptFeedback.findMany({
    where: {
      promptKey,
      tenantId: tenantId ?? undefined,
      editedOutput: { not: null },
      createdAt: { gte: subDays(new Date(), 1) },
    },
  });

  if (feedback.length < this.config.autoruleMinFeedbackForExtract) return [];

  // 2. Group by similar input context (KNN cosine ≥ 0.78 на inputEmbedding)
  const groups = await this.knnGroup(feedback, 0.78);

  const newRules: PromptRule[] = [];
  for (const group of groups.filter(g => g.length >= 3)) {
    // 3. LLM extract rule from group
    const llmResult = await this.llmRouter.call('autorule-extract', {
      promptKey,
      examples: group.map(f => ({ original: f.originalOutput, edited: f.editedOutput })),
    }, { taskType: 'autorule-extract' });

    // 4. Validate rule (confidence ≥ AUTORULE_MIN_CONFIDENCE_FOR_PROMOTE)
    if (llmResult.confidence < this.config.autoruleMinConfidence) continue;

    // 5. Check not exists similar rule (KNN на rule embedding ≥ 0.90)
    const existing = await this.findSimilarRule(promptKey, llmResult.rule, 0.90);
    if (existing?.status === 'overridden_by_admin') continue;  // sticky override
    if (existing) {
      // Update existing rule examples
      await this.appendExamples(existing.id, llmResult.examples);
      continue;
    }

    // 6. Create new rule in shadow
    const rule = await this.prisma.promptRule.create({
      data: {
        tenantId,
        promptKey,
        rule: llmResult.rule,
        ruleType: llmResult.ruleType,
        source: 'autorule',
        examples: llmResult.examples,
        confidence: llmResult.confidence,
        status: 'shadow',  // никогда сразу active — фидбек [[no-human-in-loop-for-clone-learning]] про автоматичность не отменяет shadow phase
      },
    });
    newRules.push(rule);
  }

  return newRules;
}
```

**Cron:**
- `autorule-extract.cron.ts` (`0 3 * * *` — daily после reframing 03:00):
  - Для каждой Org: для каждого `promptKey` с ≥10 feedback за сутки → `extractForPromptKey(promptKey, tenantId)`.
  - Также для global rules: `extractForPromptKey(promptKey, null)` поверх agregated feedback всех Org с ≥30 feedback.
  - Per-tenant Redis SETNX lock (TTL 1ч) — защита от двойного запуска.

**Новый taskType `autorule-extract`:**
- Primary: `deepseek:deepseek-v4-pro` (сложная задача — извлечение паттернов из пар)
- Secondary: `openai-via-proxy:gpt-5.4`
- Tertiary: `ollama:qwen3:30b` (safety-net, **не qwen3.5:9b** — слишком слабая для extraction)
- `pinnedVersionNote = 'Закреплено на deepseek-v4-pro 2026-05-29 для AutoRule Фаза B'`

**Promпт `autorule-extract.prompt.ts`** (новый):
- System: «Ты анализируешь пары (original, edited). Найди консистентное правило, отличающее edited от original. Игнорируй опечатки/перестановки слов. Сосредоточься на: что добавили, что убрали, какой структуры стало больше».
- Output JSON Schema strict:
  ```
  {
    rule: string,                              // human-readable ≤200 chars
    ruleType: 'must_do' | 'must_not_do' | 'tone' | 'structure',
    confidence: number 0..1,                   // calibrated по T7 F2 шкале
    examples: [{ originalSnippet: string, editedSnippet: string, why: string }, ...],  // 1-3
    reasoning: string                          // почему именно это правило
  }
  ```

**Rule injection (НЕ в Фазе B, готовится для C):**
- `rule-injector.service.ts` написан с методом `getActiveRulesForPrompt(promptKey, tenantId)` — возвращает `PromptRule[]` со `status='active'`.
- В Фазе B status `active` НЕТ — все rules остаются `shadow`. Injection отложен в Фазу C.

#### Admin UI

**`frontend/app/(authenticated)/admin/prompt-evolution/page.tsx`** (новая страница):
- Список всех `PromptRule` с фильтрами по `promptKey`, `status`, `source`.
- Карточка правила: rule text + examples + confidence + shadow metrics.
- Действия (НЕ ответы на вопросы системы, это управление — кнопки разрешены):
  - «📋 Скопировать в манульное правило» — создать копию с `source='manual_admin'`, `status='shadow'`.
  - «🗄 Архивировать» — поставить `status='archived'`, `archivedReason` обязателен.
  - «⛔ Заблокировать (overridden_by_admin)» — поставить `status='overridden_by_admin'` (sticky, AutoRule больше не предложит).

**RBAC:** только owner / admin Org для своих rules, super-admin для global.

#### Тесты

- Unit test `autorule-extractor.service.spec.ts` — 4 сценария:
  1. < 10 feedback → пустой return
  2. 12 feedback, 3 KNN-группы по 4 → 3 candidate rules
  3. Confidence < threshold → не создаются
  4. Существующий `overridden_by_admin` rule → skip
- Integration test с реальным DeepSeek V4 Pro (под флагом `AUTORULE_GOLDEN_REAL=1`) — golden dataset 10 pairs (original, edited) → expect specific rule.
- Snapshot test на seed `seed-llm-task-routes-agents-v2.ts`.

#### ENV

```
AUTORULE_ENABLED=false
AUTORULE_MIN_FEEDBACK_FOR_EXTRACT=10
AUTORULE_MIN_CONFIDENCE_FOR_PROMOTE=0.7   # для будущего promote, но в фазе B не используется
AUTORULE_KNN_GROUP_THRESHOLD=0.78
AUTORULE_RULE_SIMILARITY_THRESHOLD=0.90
```

#### Метрики

- `z_prompt_feedback_total{promptKey, has_edit}` (counter)
- `z_autorule_extracted_total{promptKey, ruleType}` (counter)
- `z_autorule_rules_total{promptKey, status, source}` (gauge — обновляется ежечасно snapshot cron)
- `z_autorule_overridden_total{promptKey}` (counter)

#### DoD B1

- [ ] Prisma модели созданы и зарегистрированы в `apply-prod-deploy.ts` Шаге 4
- [ ] `PromptFeedbackCollectorService` собирает feedback на event `ai.invocation.*`
- [ ] `AutoRuleExtractorService` создаёт `PromptRule(status='shadow')` через cron
- [ ] Все extracted rules остаются shadow — нет inject в prompts пока что
- [ ] Admin UI показывает rules с фильтрами и actions
- [ ] Тесты зелёные (4 unit, 1 integration с real-LLM golden)
- [ ] `second-brain/01_projects/prompt-evolution.md` создан как новый source-of-truth
- [ ] Метрики `z_prompt_feedback_*`, `z_autorule_*` отдаются

### Модуль B2: concierge-prm-step-scorer (shadow)

**Источник доказательств:** AgentPRM arxiv 2511.08325 (ACM Web Conference 2026), MASPRM arxiv 2510.24803, PRIME-RL 2025.

#### База данных

```prisma
model ConciergeStepScore {
  id              String   @id @default(uuid())
  tenantId        String
  conversationId  String
  messageId       String   // ссылка на ConciergeMessage
  stepIndex       Int      // 0..MAX_ITER
  goalSummary     String   @db.Text  // краткое представление user intent
  selectedTool    Json     // { toolName, args }
  alternatives    Json     // [{ toolName, args, score, reasoning }] top-3
  selectedScore   Float
  selectedRank    Int      // 1-based: 1 = top по PRM, 2 = second, и т.д.
  llmChoseRank    Int      // ранг по PRM того инструмента, что выбрал LLM (если бы PRM решал)
  prmAgreed       Boolean  // selectedRank == 1
  promotedToActive Boolean  // в фазе B всегда false (shadow only)
  createdAt       DateTime @default(now())

  @@index([conversationId, stepIndex])
  @@index([tenantId, createdAt])
  @@index([promptedToActive, prmAgreed])
}
```

#### Backend

**Новый сервис `ConciergeStepScorerService`** (`backend/src/modules/concierge/services/step-scorer.service.ts`):

```ts
interface StepCandidate {
  toolName: string;
  args: Record<string, any>;
  reasoning?: string;  // если LLM объяснил почему этот tool
}

interface StepScore {
  candidate: StepCandidate;
  score: number;       // 0..1
  reasoning: string;   // короткое объяснение PRM
}

async scoreStep(args: {
  goal: string;
  history: ConciergeMessage[];
  candidate: StepCandidate;
  retrievedContext: any[];
}): Promise<StepScore>

async scoreAllCandidates(args: {
  goal: string;
  history: ConciergeMessage[];
  candidates: StepCandidate[];
}): Promise<StepScore[]>
```

**Реализация:**
- `scoreStep` делает один LLM-вызов через `LlmRouter.call('concierge-step-prm', {...})`.
- **Primary: `deepseek:deepseek-v4-flash`** (cheap + достаточно умный — по [[ollama-tertiary-only-deepseek-flash-cheap]] qwen3.5:9b не годится).
- Secondary: `openai-via-proxy:gpt-5.4-mini`.
- Tertiary: `ollama:qwen3.5:9b` (только safety-net на случай отказа основных).
- `scoreAllCandidates` параллельно вызывает `scoreStep` для top-K (default 3).

**Новый taskType `concierge-step-prm`:**
- Promпт-инструкция: «Ты оцениваешь, насколько этот инструмент приблизит к цели пользователя. Цель: {goal}. История: {history digest}. Кандидат: {tool + args}. Контекст: {retrieved}. Верни score 0..1 + reasoning ≤100 слов».
- Output JSON Schema strict: `{ score: number 0..1, reasoning: string ≤500 chars }`
- `pinnedVersionNote = 'Закреплено на deepseek-v4-flash 2026-05-29 для Concierge PRM Фаза B'`

**Shadow-режим Integration с ConciergeService:**
- В `ConciergeService.runToolUseLoop()` — после того как LLM сгенерировал tool_call (top-1):
  ```ts
  if (this.config.conciergePrmShadowEnabled) {
    // LLM может вернуть только top-1; для shadow мы вызываем его ещё раз с n=3 (или генерируем k вариантов retry'ями)
    const candidates = await this.llmGenerateTopK(messages, this.tools, 3);
    const scores = await this.stepScorer.scoreAllCandidates({
      goal, history: messages, candidates,
    });
    const llmChosen = candidates[0];  // top-1 от LLM
    const prmChosen = scores.sort((a,b) => b.score - a.score)[0].candidate;

    // запись для analytics
    await this.prisma.conciergeStepScore.create({
      data: {
        conversationId, messageId: llmMessage.id,
        stepIndex, goalSummary: this.summarizeGoal(goal),
        selectedTool: llmChosen,  // что LLM реально выполнил
        alternatives: scores.map(s => ({ ...s.candidate, score: s.score, reasoning: s.reasoning })),
        selectedScore: scores.find(s => s.candidate.toolName === llmChosen.toolName).score,
        selectedRank: this.rank(scores, llmChosen),
        llmChoseRank: 1,
        prmAgreed: llmChosen.toolName === prmChosen.toolName,
        promotedToActive: false,  // shadow
      },
    });
  }

  // Concierge выполняет ЧТО ВЫБРАЛ LLM (не PRM) — это shadow mode
  return llmChosen;
  ```

**Cost calculation:**
- Shadow mode: +3 invocations of `deepseek-v4-flash` за step (~$0.003 на step). При average 2 steps/conversation и 100 conversations/день — ~$0.6/день. **Acceptable.**
- Top-K generation via LLM: можно делать через `n=3` параметр (если provider поддерживает) или 3 отдельных вызова с разными temperature. Для DeepSeek используем `n=3` в одном вызове — cheaper.

#### Admin UI

**`frontend/app/(authenticated)/admin/concierge-prm/page.tsx`:**
- Dashboard статистики: `prmAgreed` rate (%), distribution of `selectedRank`, top toolNames where PRM disagrees with LLM.
- Sample 20 random conversations: show `llmChosen` vs `prmChosen`, reasoning, чтобы понять качество PRM.

#### Тесты

- Unit test `step-scorer.service.spec.ts` — mock LlmRouter, 3 сценария:
  1. Single candidate → score 0..1 returned
  2. Top-3 candidates → all scored, returned sorted
  3. LLM провайдер недоступен → fallback к next provider, успех
- Integration test shadow-режима на Concierge — 5 conversations, verify что `ConciergeStepScore` записаны и Concierge выполнил то, что выбрал LLM (не PRM).
- Snapshot test на `concierge-step-prm.prompt.ts`.

#### ENV

```
CONCIERGE_PRM_SHADOW_ENABLED=false   # shadow mode (фаза B)
CONCIERGE_PRM_TOP_K=3
CONCIERGE_PRM_ENABLED=false           # active mode (фаза C — PRM выбор реально применяется)
```

В фазе B `CONCIERGE_PRM_ENABLED` всегда false. Включится только в фазе C/D после анализа shadow данных.

#### Метрики

- `z_concierge_prm_score_distribution{toolName}` (histogram)
- `z_concierge_prm_agreement_total{agreed}` (counter — `true`/`false`)
- `z_concierge_prm_llm_chose_rank_total{rank}` (counter — distribution of «насколько LLM согласен с PRM»)
- `z_concierge_prm_cost_usd_total{tenant}` (counter)

#### DoD B2

- [ ] `ConciergeStepScore` Prisma model и миграция
- [ ] `ConciergeStepScorerService` написан с тестами
- [ ] Новый taskType `concierge-step-prm` seed'нут с DeepSeek V4 Flash primary
- [ ] Integration в `ConciergeService.runToolUseLoop` под `CONCIERGE_PRM_SHADOW_ENABLED=true`
- [ ] Admin dashboard показывает статистику
- [ ] Cost / latency измерения в реальных conversations
- [ ] `second-brain/02_architecture/ai-agents-map.md` §4.1 обновлён про PRM scoring

### Фаза B DoD общий

- [ ] Оба shadow-модуля включены на 1 dev-tenant
- [ ] За месяц собрано ≥1000 PromptFeedback и ≥500 ConciergeStepScore — данные для анализа
- [ ] Принято решение перед Фазой C: AutoRule confidence threshold (на основе manual sample 50 rules) + Concierge PRM agreement rate (сравнение с baseline)
- [ ] Рефлексия в `second-brain/05_история/2026-07-XX-agents-v2-phase-b.md`

---

## Фаза C — PracticeSkill + GEPA (3 месяца)

**Цель:** включить настоящую автоматическую эволюцию — выполняемые навыки клонов и самообучающиеся промпты.

### Модуль C1: practice-skills

**Источник доказательств:** Voyager NeurIPS 2023 (15.3× faster), SkillWeaver arxiv 2504.07079 (+31.8% WebArena, +54.3% transfer).

#### База данных

```prisma
model PracticeSkill {
  id              String   @id @default(uuid())
  tenantId        String
  scope           SkillScope    // 'person' | 'role' | 'org'
  scopeRefId      String        // personId / roleId / orgId
  trigger         String   @db.Text     // "когда клиент возражает на цену enterprise"
  triggerEmbedding Unsupported("vector(1536)")?
  steps           Json     // [{order:1, action:"...", emotionalRegister:"...", redFlags:[]}]
  examples        Json     // [{episodeBlockId, outcome:'success'|'fail'|'mixed', editDistance?}]
  redFlags        Json     // string[] - что НЕЛЬЗЯ делать в этом скилле
  status          PracticeSkillStatus  // 'shadow' | 'active' | 'archived' | 'deprecated'
  trafficShare    Float    @default(0.1)  // 0..1 — доля случаев в shadow
  shadowMetrics   Json?    // {runs, successRate, vsBaseline}
  successRate     Float?
  lastUsed        DateTime?
  derivedFromConceptIds String[]
  derivedFromTraitIds   String[]
  derivedFromEpisodeCount Int
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  promotedAt      DateTime?
  archivedAt      DateTime?
  archivedReason  String?
  version         Int      @default(1)

  @@index([tenantId, scope, scopeRefId, status])
  @@index([tenantId, triggerEmbedding], type: Hnsw, ops: VectorCosineOps)
}

model SkillUsage {
  id              String   @id @default(uuid())
  tenantId        String
  practiceSkillId String
  conversationId  String   // ChatV2Conversation (mode='clone_style')
  messageId       String
  wasUsed         Boolean  // включён ли skill в prompt
  outcome         String?  // 'accepted_as_is' | 'edited' | 'rejected' | 'pending'
  editDistance    Float?
  downstreamSignals Json?
  createdAt       DateTime @default(now())

  @@index([practiceSkillId, createdAt])
  @@index([conversationId])
}

enum SkillScope { person role org }
enum PracticeSkillStatus { shadow active archived deprecated }
```

#### Backend

**Новый модуль `backend/src/modules/practice-skills/`:**

```
practice-skills/
├─ services/
│   ├─ practice-skill-extractor.service.ts
│   ├─ practice-skill-retrieval.service.ts
│   ├─ practice-skill-evaluator.service.ts
│   └─ practice-skill-usage.service.ts
├─ workers/
│   ├─ practice-skill-extract.worker.ts
│   └─ practice-skill-evaluate.cron.ts
└─ controllers/
    └─ admin-practice-skills.controller.ts
```

**Extraction pipeline:**

- Trigger: после `SkillTraitConceptNormalizerCron` (03:00) — для каждого concept'а с ≥5 связанных traits → enqueue extract job в новую очередь `core.practice-skill-extract`.
- `PracticeSkillExtractorWorker` (concurrency=2):
  - Загружает concept + связанные SkillTrait'ы + IdeaBlock'и (reasoning, decision_basis) для каждого trait'а.
  - Если в блоках видны явные шаги («сначала ..., потом ..., если ..., то ...») — LLM `practice-skill-extract` (DeepSeek V4 Pro) → draft PracticeSkill.
  - Embedding `trigger` через `KnowledgeEmbeddingService`.
  - KNN check на existing PracticeSkill (cosine ≥ 0.85) — если есть, обновляем `examples` and `derivedFrom*`, не создаём дубль.
  - Создаём с `status='shadow'`, `trafficShare=0.1`.

**Retrieval в clone-respond:**

В `backend/src/modules/clones/services/clones.service.ts.askPerson/askRole`:
- После загрузки reasoning-блоков (анти-fakery) — embed user question.
- KNN top-K `PracticeSkill` same scope (cosine ≥ 0.78) → отфильтровать status `archived/deprecated`.
- Для каждого result:
  - Если `status='shadow'` — взять с вероятностью `trafficShare` (deterministic by hash of conversationId).
  - Если `status='active'` — взять всегда.
- Inject в `clone-respond.prompt`:
  ```
  <known_procedures>
    {{#each practiceSkills}}
    Когда: {{trigger}}
    Шаги:
    {{#each steps}}
      {{order}}. {{action}}{{#if emotionalRegister}} (эмоционально: {{emotionalRegister}}){{/if}}
    {{/each}}
    {{#if redFlags.length}}Чего НЕ делать: {{redFlags}}{{/if}}
    {{/each}}
  </known_procedures>
  ```
- Записать в `SkillUsage` каждый retrieved skill (wasUsed=true).

**Evaluation:**

- `PracticeSkillEvaluatorCron` (`0 4 * * *` — daily 04:00):
  - Для каждой shadow PracticeSkill с ≥30 SkillUsage за последние 24-48ч:
    - Composite score = `0.5 * (1 - mean(editDistance)) + 0.3 * meanOutcomeSuccess + 0.2 * adversarialOK`
      - `editDistance` — из SkillUsage.editDistance (Levenshtein normalized между clone ответом и финальной user-version)
      - `meanOutcomeSuccess` — % usages с `outcome='accepted_as_is'`
      - `adversarialOK` — через быстрый LLM debate verifier (один call DeepSeek V4 Flash) на 5 случайных usages, верифицирует что ответ не нарушает red_flags и не противоречит SkillTrait
    - Сравнить с baseline score (тот же расчёт на conversations без этой skill в retrieval — берётся из последних 30 дней).
    - Если composite score > baseline + 5% → `promote` (status='active', trafficShare=1.0).
    - Если composite score < baseline - 5% после ≥30 runs → `archive` (status='archived', archivedReason='shadow_metrics_worse_than_baseline').
    - Между ±5% — оставить в shadow ещё цикл.

**Новые taskType'ы:**
- `practice-skill-extract`: primary `deepseek-v4-pro` → secondary `openai-via-proxy:gpt-5.4` → tertiary `ollama:qwen3:30b`. `pinnedVersionNote` обязателен.
- `practice-skill-adversarial-verify`: primary `deepseek-v4-flash` → secondary `openai-via-proxy:gpt-5.4-mini` → tertiary `ollama:qwen3.5:9b`. Дешёвая верификация.

**Promпт `practice-skill-extract.prompt.ts`:**
- System: «На основе reasoning-блоков сотрудника извлеки выполняемую процедуру — рецепт «когда X → делай 1, 2, 3». Только если в блоках видны конкретные шаги. Если описано общее — пропусти (output={skill:null}).»
- Output JSON Schema strict:
  ```
  {
    skill: {
      trigger: string ≤ 200 chars,
      steps: [{ order: int, action: string, emotionalRegister?: string, redFlags?: string[] }, ...],
      redFlags: string[],
      reasoning: string                  // почему именно эти шаги
    } | null,
    confidence: number 0..1
  }
  ```

#### Admin UI

**`/admin/practice-skills`** (новая страница):
- Список skills с фильтрами по scope, role, status.
- Карточка skill: trigger + steps + redFlags + examples + shadowMetrics + lastUsed.
- Действия (управление, не «ответы»):
  - «🗄 Архивировать» с обязательным `archivedReason`
  - «⏸ Снизить трафик» (изменить `trafficShare`)
  - «📌 Закрепить как priority» (manual flag для retrieval booster)

#### Тесты

- Unit test `practice-skill-extractor.service.spec.ts` — golden dataset 5 sample reasoning-блоков → expect specific skill or null.
- Integration test на retrieval в `ClonesService.askPerson` — конкретный вопрос → retrieve K skills → inject в prompt.
- Integration test `PracticeSkillEvaluatorCron` — fixture 30 SkillUsage с заданными outcomes → expect promote/archive decisions.
- Real LLM golden run `PRACTICE_SKILL_EXTRACT_GOLDEN_REAL=1` — 10 fixtures.

#### ENV

```
PRACTICE_SKILLS_ENABLED=false
PRACTICE_SKILLS_MIN_TRAITS_FOR_EXTRACT=5
PRACTICE_SKILLS_SHADOW_TRAFFIC=0.1
PRACTICE_SKILLS_KNN_RETRIEVAL_THRESHOLD=0.78
PRACTICE_SKILLS_KNN_DEDUP_THRESHOLD=0.85
PRACTICE_SKILLS_EVAL_MIN_RUNS=30
PRACTICE_SKILLS_EVAL_PROMOTE_DELTA=0.05
PRACTICE_SKILLS_EVAL_ARCHIVE_DELTA=0.05
```

#### Метрики

- `z_practice_skills_total{tenant, scope, status}` (gauge)
- `z_practice_skills_extracted_total{scope}` (counter)
- `z_practice_skills_promoted_total / archived_total` (counter)
- `z_practice_skills_runs_total{status='shadow'|'active'}` (counter)
- `z_practice_skills_composite_score_vs_baseline` (histogram)
- `z_practice_skills_retrieval_hits_total{scope}` (counter)

#### DoD C1

- [ ] Prisma модели `PracticeSkill` и `SkillUsage` + миграция + регистрация в `apply-prod-deploy.ts`
- [ ] `PracticeSkillExtractor` написан с unit/integration тестами
- [ ] Golden eval-набор 10 sample sets, real LLM run зелёный
- [ ] Retrieval integration в `ClonesService.askPerson` под флагом
- [ ] `PracticeSkillEvaluatorCron` написан с тестами
- [ ] Admin UI `/admin/practice-skills`
- [ ] Эксперимент на роли «Маркетолог» (1 tenant, shadow 10% trafficShare) — 4 недели
- [ ] Решение promote/archive первых skills на основе данных
- [ ] `second-brain/01_projects/practice-skills.md` создан
- [ ] `second-brain/02_architecture/ai-agents-map.md` §2.7 обновлён — добавить PracticeSkill в clone pipeline

### Модуль C2: prompt-evolution-gepa

**Источник доказательств:** GEPA arxiv 2507.19457 (ICLR 2026 Oral), +13% над MIPROv2, 35× cheaper rollouts.

#### Зависимости

- Python 3.11+ в Docker image backend prod-runner (новый stage в Dockerfile)
- Pip install: `gepa`, `dspy-ai>=2.6.0`
- Изоляция: `backend/python/gepa/` — отдельная директория с requirements.txt + runner.py
- Между Node и Python — JSON через stdin/stdout (subprocess) или HTTP local 127.0.0.1 (FastAPI Uvicorn)

#### База данных

```prisma
model PromptCandidate {
  id              String   @id @default(uuid())
  tenantId        String?  // null = global
  promptKey       String
  parentVersion   String?  // ancestor LlmTaskRoute.version
  promptText      String   @db.Text
  systemPart      String?  @db.Text  // structured
  userPart        String?  @db.Text
  paretoMetric    Json     // {accuracy, cost, latency}
  reflectionTraces Json    // ASI from GEPA
  status          CandidateStatus  // 'pareto_pool' | 'testing' | 'promoted' | 'rejected'
  evaluations     Int      @default(0)
  compositeScore  Float?
  abTrafficShare  Float?   // если в testing
  abStartedAt     DateTime?
  abEndedAt       DateTime?
  promotedAt      DateTime?
  rejectedReason  String?
  createdAt       DateTime @default(now())

  @@index([promptKey, status])
  @@index([tenantId, promptKey, status])
}

enum CandidateStatus { pareto_pool testing promoted rejected }
```

#### Backend

**Новые crons:**

1. `gepa-optimize.cron` (`0 4 * * 0` — weekly Sun 04:00):
   - Для каждого `promptKey` с ≥30 `PromptFeedback` за неделю И с `LlmTaskRoute.evolutionEnabled=true`:
     - Загрузить feedback last 30 дней.
     - Запустить `GepaRunnerService.runOptimization(promptKey, feedback)`.
     - Сохранить Pareto frontier candidates в `PromptCandidate(status='pareto_pool')`.

2. `gepa-ab-monitor.cron` (`*/15 * * * *` — каждые 15 минут):
   - Для каждого `PromptCandidate(status='testing')`:
     - Compare metrics A (current LlmTaskRoute) vs B (candidate) за последние 48ч.
     - Если B заметно хуже A (specific threshold) → auto-rollback: `status='rejected'`, `rejectedReason='ab_deg_detected'`.
     - Если B заметно лучше A после ≥48ч и ≥100 invocations → promote.

3. `gepa-promote.cron` (`0 5 * * 0` — weekly Sun 05:00):
   - Из `pareto_pool` выбрать top-1 candidate per promptKey → set `status='testing'`, `abTrafficShare=0.1`, `abStartedAt=NOW`.
   - LlmRouter применяет candidate на 10% traffic (deterministic hash by invocationId).

**`GepaRunnerService`** (`backend/src/modules/prompt-evolution/services/gepa-runner.service.ts`):

```ts
async runOptimization(promptKey: string, feedback: PromptFeedback[]): Promise<{ candidates: PromptCandidate[] }> {
  // 1. Build reflective dataset
  const reflectiveDataset = feedback.map(f => ({
    input: f.invocationInput,
    original: f.originalOutput,
    edited: f.editedOutput,
    diff: this.computeDiff(f.originalOutput, f.editedOutput),
    downstream: f.downstreamSignals,
  }));

  // 2. Get current prompt from LlmTaskRoute
  const currentRoute = await this.prisma.llmTaskRoute.findFirst({ where: { taskType: promptKey, tier: 'primary' } });
  const seedPrompt = currentRoute.promptOverride ?? this.getCodeFallbackPrompt(promptKey);

  // 3. Spawn Python GEPA process
  const result = await this.pythonSubprocess.run({
    script: 'gepa/runner.py',
    payload: {
      seed_prompt: seedPrompt,
      reflective_dataset: reflectiveDataset,
      task_lm: 'deepseek-v4-pro',
      reflection_lm: 'deepseek-v4-pro',
      max_metric_calls: this.config.gepaMaxMetricCalls,  // 150
    },
    timeout: 60 * 60 * 1000,  // 1ч
  });

  // 4. Save Pareto frontier
  return await Promise.all(result.pareto_frontier.map(candidate =>
    this.prisma.promptCandidate.create({
      data: {
        promptKey,
        parentVersion: currentRoute.version,
        promptText: candidate.text,
        paretoMetric: candidate.metrics,
        reflectionTraces: candidate.traces,
        status: 'pareto_pool',
      },
    })
  ));
}
```

**Python `backend/python/gepa/runner.py`:**

```python
import sys, json
from gepa import optimize
from gepa.adapters.default import DefaultAdapter

if __name__ == '__main__':
    payload = json.loads(sys.stdin.read())
    # GEPA adapter настроен на DeepSeek через LangChain
    result = optimize(
        seed_prompt=payload['seed_prompt'],
        dataset=payload['reflective_dataset'],
        task_lm=f"deepseek/{payload['task_lm']}",
        reflection_lm=f"deepseek/{payload['reflection_lm']}",
        max_metric_calls=payload['max_metric_calls'],
        adapter=DefaultAdapter(),
    )
    print(json.dumps({
        'pareto_frontier': [
            {'text': c.prompt, 'metrics': c.metrics, 'traces': c.traces}
            for c in result.pareto_frontier
        ]
    }))
```

**Защита `editedByAdmin`:**
- `gepa-promote.cron` ПЕРЕД промоутом проверяет `LlmTaskRoute.editedByAdmin === false`.
- Если admin ручно правил — candidate не промоутится, лежит в pareto_pool. Через 30 дней → status='rejected', rejectedReason='admin_edit_blocks_promotion'.

**Routing 10% trafficShare:**
- В `LlmRouter.invoke()` — проверка наличия активного `PromptCandidate(status='testing')` для promptKey + tenantId.
- Если есть — deterministic hash by `invocationId` → если в первых 10% — использовать candidate.promptText вместо стандартного.
- Каждый invoke с candidate помечается tag `gepa_candidate=true` для downstream metrics.

**Auto-rollback:**
- `gepa-ab-monitor.cron` каждые 15 минут считает composite score on:
  - А: invocations без `gepa_candidate=true` за последние 48ч на том же promptKey + tenantId
  - B: invocations с `gepa_candidate=true`
- Если B is significantly worse (`compositeScore(B) < compositeScore(A) - 0.10`) → set candidate.status='rejected'.
- Если B is significantly better (`compositeScore(B) > compositeScore(A) + 0.05`) AND ≥100 B invocations → promote:
  - Создать новый `LlmTaskRoute.version`, скопировать candidate.promptText в `promptOverride`, выставить `pinnedVersionNote='Auto-promoted by GEPA YYYY-MM-DD'`.
  - Старая версия остаётся для rollback.

#### Admin UI

**`/admin/prompt-evolution`:**
- Pareto frontier explorer: для каждого promptKey показать candidates с метриками.
- A/B testing dashboard: текущие тестируемые candidates, real-time metrics.
- History promoted/rejected с timestamps.
- Действия:
  - «❌ Отменить кандидата» (manual reject)
  - «⏪ Rollback последнего promote» (восстановить предыдущий LlmTaskRoute.version)
  - «🔒 Заблокировать эволюцию для этого promptKey» (выставить `LlmTaskRoute.evolutionEnabled=false`)

#### Тесты

- Unit test `gepa-runner.service.spec.ts` — mock python subprocess, verify сохранение candidates.
- Integration test `gepa-ab-monitor` — fixture: 100 invocations А и 100 B → assert correct decision (promote vs reject).
- Real GEPA run test (под `GEPA_REAL_TEST=1`) — реальный subprocess на seed dataset → expect at least 1 valid candidate с better score.
- Cost test — 1 GEPA run < $20 (150 max_metric_calls × ~$0.05/call avg).

#### ENV

```
PROMPT_EVOLUTION_ENABLED=false
GEPA_MAX_METRIC_CALLS=150
GEPA_REFLECTION_LM=deepseek-v4-pro
GEPA_TASK_LM=deepseek-v4-pro
GEPA_AB_TRAFFIC_SHARE=0.1
GEPA_AB_MIN_INVOCATIONS_BEFORE_DECISION=100
GEPA_AB_PROMOTE_THRESHOLD=0.05
GEPA_AB_REJECT_THRESHOLD=0.10
GEPA_PYTHON_PATH=/usr/bin/python3.11
GEPA_TIMEOUT_MS=3600000
```

#### Метрики

- `z_gepa_optimizations_total{promptKey, status}` (counter — `success|failed|timeout`)
- `z_gepa_candidates_total{promptKey, status}` (gauge)
- `z_gepa_promoted_total / rejected_total{reason}` (counter)
- `z_gepa_ab_active_total` (gauge)
- `z_gepa_cost_usd_total` (counter)
- `z_gepa_rollback_total{reason}` (counter)

#### DoD C2

- [ ] Python GEPA subprocess работает в dev Docker
- [ ] Prod Dockerfile обновлён с Python 3.11 + pip install gepa
- [ ] Prisma `PromptCandidate` + миграция
- [ ] `GepaRunnerService` написан с тестами
- [ ] 3 cron'a (optimize / ab-monitor / promote) написаны
- [ ] Защита `editedByAdmin` — integration test
- [ ] Routing 10% trafficShare в LlmRouter с deterministic hash
- [ ] Auto-rollback тест на dev synthetic data
- [ ] Admin UI `/admin/prompt-evolution`
- [ ] Эксперимент на promptKey `meeting-report-fast` — 4 недели, ≥1 promoted candidate
- [ ] `second-brain/01_projects/prompt-evolution.md` обновлён с GEPA полностью
- [ ] Cost dashboards в Grafana

### Фаза C DoD общий

- [ ] PracticeSkill: ≥3 promoted skills для роли «Маркетолог», composite score > baseline + 5%
- [ ] GEPA: ≥1 promoted prompt version на `meeting-report-fast`, measured improvement ≥5% доля unedited paragraphs
- [ ] Cost: суммарная стоимость v2.0 +$50-150/месяц на средний tenant
- [ ] AutoRule переход shadow → active (опц., в конце фазы C): rules с confidence ≥ 0.85 и ≥30 shadow runs автоматически становятся active. `rule-injector.service` начинает inject в prompt.
- [ ] Рефлексия в `second-brain/05_история/2026-09-XX-agents-v2-phase-c.md`

---

## Фаза D — Расширение и Research v3.0 (6+ месяцев)

**Цель:** дочистить хвосты + начать смотреть на следующее поколение.

### D1: Multi-agent debate расширение

- Применить `MultiAgentDebateService` ко всем `CURATION_CRITICAL_TYPES_DEFAULT` (Regulation severity=critical, граничные entity-merge cosine 0.85-0.92 и т.д.).
- Включить Round 2 (`DEBATE_ROUND2_ENABLED=true`) для split-cases.
- Optimization: при N=3 cost становится ощутимым на масштабе → cache results для идентичных task hash'ей (Redis с TTL 24ч).

### D2: Concierge PRM active mode

- На основе данных Фазы B принять решение: использовать PRM choice вместо LLM choice в Concierge tool-use loop.
- Включить `CONCIERGE_PRM_ENABLED=true` после verify что `prmAgreed` rate stable ≥ 60% И что в случаях disagreement PRM choice объективно лучше (manual sample 20 cases).
- A/B на одной Org 2 недели.
- Promote если выигрыш по `concierge_iterations_to_completion_avg` или `concierge_user_satisfaction_proxy`.

### D3: AutoRule auto-promote

- На основе данных Фазы C: если AutoRule rules с status='active' (промотированные в конце C) не вызвали reward hacking и improved metrics → продолжаем auto-promote.
- Если есть рост edit-rate на затронутых promптах → вернуться к shadow-only.

### D4: Research для v3.0 — Darwin Gödel Machine pattern

- Прототип `practice-skill-self-modify` — PracticeSkill могут переписывать свои steps на основе trajectory data.
- Только prototype, не в prod. Цель — научный proof-of-concept на одном skill за квартал.
- См. [`plans/analysis/2026-05-29-self-improving-agents-research.md`](../analysis/2026-05-29-self-improving-agents-research.md) Часть XI про Sakana Darwin Gödel Machine.

### D5: Bi-temporal на Decision / Insight / Card

- Если Фаза A bi-temporal-edges показал value — расширить паттерн на:
  - `Decision.validFrom/validUntil` уже частично есть (supersedes chain) — добавить explicit поля
  - `Insight.validFrom/validUntil` — для болей, которые устарели
  - `Card.validFrom/validUntil` — для проектов с явным сроком

### Фаза D DoD общий

- [ ] Multi-agent debate работает на ≥3 critical-types
- [ ] Concierge PRM active mode принят в prod (или явно отклонён с причиной)
- [ ] AutoRule auto-promote pipeline работает без reward hacking
- [ ] DGM prototype на одной PracticeSkill — научный отчёт
- [ ] Все 6 модулей stable в production ≥ 1 месяц
- [ ] v3.0 architecture planning начался

---

## Глобальные технические изменения

### Новые taskTypes (все seed в `seed-llm-task-routes-agents-v2.ts`)

| TaskType | Primary | Secondary | Tertiary | Why |
|---|---|---|---|---|
| `probe-response-classify` | `deepseek-v4-flash` | `openai-via-proxy:gpt-5.4-mini` | `ollama:qwen3.5:9b` | Парсинг свободного ответа |
| `debate-decision-supersede` | `deepseek-v4-pro` | `openai-via-proxy:gpt-5.4` | `ollama:qwen3:30b` | Critical, capable required |
| `autorule-extract` | `deepseek-v4-pro` | `openai-via-proxy:gpt-5.4` | `ollama:qwen3:30b` | Сложная задача reasoning |
| `concierge-step-prm` | `deepseek-v4-flash` | `openai-via-proxy:gpt-5.4-mini` | `ollama:qwen3.5:9b` | Дёшево, частый вызов |
| `practice-skill-extract` | `deepseek-v4-pro` | `openai-via-proxy:gpt-5.4` | `ollama:qwen3:30b` | Capable required |
| `practice-skill-adversarial-verify` | `deepseek-v4-flash` | `openai-via-proxy:gpt-5.4-mini` | `ollama:qwen3.5:9b` | Дёшево, частый вызов |
| `gepa-reflection-lm` (внутри Python) | (через DSPy adapter на DeepSeek API) | — | — | Внутренняя оптимизация |

**Все** seed-записи имеют `pinnedVersionNote = 'Закреплено DD-MM-YYYY для Agents v2 Фаза X'` (обязательно).

### Новые модели Prisma (итого)

```
IdeaBlockLink           ← + validFrom + validUntil
EntityLink              ← + validFrom + validUntil
LlmTaskRoute            ← + evolutionEnabled (default true)
+ PromptFeedback
+ PromptRule
+ PromptCandidate
+ PracticeSkill
+ SkillUsage
+ ConciergeStepScore
+ RuleType / RuleSource / RuleStatus / CandidateStatus / SkillScope / PracticeSkillStatus (enums)
```

### Новые BullMQ-очереди / @Cron

```
+ core.autorule-extract              (@Cron 0 3 * * *)         — daily after reframing
+ core.practice-skill-extract        (event-driven по SkillTraitConceptNormalizerCron)
+ core.practice-skill-evaluate       (@Cron 0 4 * * *)         — daily 04:00
+ core.gepa-optimize                 (@Cron 0 4 * * 0)         — weekly Sun 04:00
+ core.gepa-promote                  (@Cron 0 5 * * 0)         — weekly Sun 05:00
+ core.gepa-ab-monitor               (@Cron */15 * * * *)      — каждые 15 минут
+ core.debate-judge                  (callable from specialists)
+ core.concierge-prm                 (callable from Concierge)
+ core.probe-response-classify       (callable from ProbeResponseHandler)
```

### Новые модули backend

```
+ backend/src/modules/prompt-evolution/   (модули B1 + C2)
+ backend/src/modules/practice-skills/    (модуль C1)
+ backend/src/modules/ai/services/multi-agent-debate.service.ts  (модуль A2)
+ backend/src/modules/concierge/services/step-scorer.service.ts  (модуль B2)
+ backend/src/modules/knowledge-core/services/temporal-conflict.service.ts (модуль A1)
+ backend/python/gepa/   (Python subprocess для C2)
```

### Изменённые модули backend

```
~ backend/src/modules/probe/                      (фаза 0 — без кнопок)
~ backend/src/modules/conversational/             (фаза 0 — Telegram без inline_keyboard)
~ backend/src/modules/knowledge-core/services/block-link.service.ts        (фаза A1 — JSON schema)
~ backend/src/modules/knowledge-core/services/entity-graph.service.ts      (фаза A1 — JSON schema)
~ backend/src/modules/knowledge-core/services/chat-v2-retrieval.service.ts (фаза A1 — validAt edges)
~ backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts (фаза A2 — debate)
~ backend/src/modules/clones/services/clones.service.ts                    (фаза C1 — PracticeSkill retrieval)
~ backend/src/modules/clones/prompts/clone-respond.prompt.ts               (фаза C1 — секция <known_procedures>)
~ backend/src/modules/concierge/services/concierge.service.ts              (фаза B2 — PRM scoring)
~ backend/src/modules/ai/services/llm-router.service.ts                    (фаза C2 — A/B routing для candidates)
~ backend/src/common/config/env.schema.ts                                  (все ENV-флаги выше)
```

### Frontend изменения

```
~ frontend/src/ui/probe/                          (фаза 0 — ProbeAnswerInput + ASR toggle)
~ frontend/src/ui/notifications/                  (фаза 0 — без кнопок вариантов)
+ frontend/app/(authenticated)/admin/prompt-evolution/    (фаза B1 + C2)
+ frontend/app/(authenticated)/admin/practice-skills/     (фаза C1)
+ frontend/app/(authenticated)/admin/concierge-prm/       (фаза B2)
+ frontend/app/(authenticated)/admin/multi-agent-debate/  (фаза A2 — статистика)
```

### Все новые ENV (итого)

См. соответствующие модули выше. Полный список ≈25 переменных, все добавлены в `env.schema.ts` с Zod validators.

---

## Критерии готовности (DoD общий)

- [ ] Фаза 0 — probe без кнопок, проверено вручную на dev и Telegram
- [ ] Фаза A — bi-temporal edges + debate работают на 1 prod-tenant под ENV-флагами
- [ ] Фаза B — shadow собирает данные ≥1000 PromptFeedback и ≥500 ConciergeStepScore
- [ ] Фаза C — PracticeSkill и GEPA с реальными promoted версиями, measured improvement
- [ ] Фаза D — расширение модулей на остальные critical-types, начат research v3.0
- [ ] Все ENV-флаги работают как kill-switch без deploy
- [ ] `editedByAdmin=true` неприкосновенно — integration test зелёный
- [ ] Никаких inline-кнопок в probe/conversational системе
- [ ] Все новые taskType'ы используют DeepSeek primary (Pro для capable, Flash для cheap) — qwen3.5:9b только tertiary
- [ ] `second-brain/02_architecture/ai-agents-map.md` обновлён после каждой фазы
- [ ] Рефлексии в `second-brain/05_история/` после каждой фазы
- [ ] `docs/operations/prod-deploy-log.md` обновлён по чек-листу CLAUDE.md

---

## Риски и ограничения

| Риск | Вероятность | Impact | Mitigation |
|---|---|---|---|
| GEPA Python subprocess нестабилен на Windows dev | Средняя | Средний | Docker контейнер для GEPA + локальный JSON-API; в проде Linux |
| Bi-temporal edges ломают existing queries без validAt | Высокая | Высокий | Default `validAt = NOW` если не передан → backward-compat; integration tests на старые queries |
| `editedByAdmin=true` теряется при evolution | Critical | High | Test snapshot + integration test; GEPA-promote проверяет перед replace |
| Reward hacking всё равно случается | Средняя | Высокий | Composite multi-signal score + adversarial verifier + monthly manual sample 20 cases audit |
| PracticeSkill в shadow даёт worse результат | Средняя | Низкий | Auto-archive после 30 runs если worse; ENV kill-switch |
| Multi-agent debate cost spikes на больших tenant | Низкая | Средний | Cost cap per run ($0.05); только critical-types; budget alert через existing budget-alert.cron |
| AutoRule извлекает противоречивые rules | Низкая | Средний | Rules в shadow, sticky `overridden_by_admin`; confidence < 0.5 never auto-promote |
| Python в prod Dockerfile увеличит образ | Низкая | Низкий | Multi-stage build, Python в отдельном stage; final image +200MB acceptable |
| Telegram bot сломан без inline_keyboard для существующих пользователей | Низкая | Низкий | Backward-compat: парсинг свободного текста; graceful fallback если ответ непонятен |
| Голосовой ввод probe медленнее текста | Низкая | Низкий | ASR + редактирование перед отправкой; пользователь решает; UI без navigation lock |
| Latency Concierge PRM добавит 200-500ms на step | Высокая | Низкий | PRM на дешёвом deepseek-v4-flash параллельно с main LLM; на multi-step задачах экономия итераций компенсирует |

Главные гардейлы:
- ENV-флаги per module → выключение без deploy
- Shadow → A/B → promote — никогда сразу 100%
- Auto-rollback каждые 15 минут (gepa-ab-monitor)
- Sticky overrides (`editedByAdmin`, `overridden_by_admin`) — admin overrules system

---

## Фазы реализации (свод)

- [ ] **Фаза 0 (3-5 дней)** — probe без кнопок (тригеррит обновление существующих 30 probe-триггеров)
- [ ] **Фаза 0.5 (3-5 дней, параллельно с Фазой 0)** — router fix expertise/experience/competence → 3-2 + backfill знаниевого профиля сотрудников
- [ ] **Фаза A (2 недели)** — bi-temporal edges + multi-agent debate (для decision-supersede-detect)
- [ ] **Фаза B (1.5 месяца)** — AutoRule shadow + Concierge PRM shadow
- [ ] **Фаза C (3 месяца)** — PracticeSkill + GEPA (с auto-promote через A/B)
- [ ] **Фаза D (6+ месяцев)** — расширение debate + Concierge PRM active + AutoRule auto-promote + DGM research

Каждая фаза заканчивается:
1. Обновлением `second-brain/02_architecture/ai-agents-map.md` и соответствующих `01_projects/*.md`
2. Рефлексией в `second-brain/05_история/YYYY-MM-DD-agents-v2-phase-X.md`
3. Обновлением `docs/operations/prod-deploy-log.md`
4. Push с подтверждением + auto-push рефлексии (по `feedback_prod_deploy_log_single_source`)

---

## Итог

_Будет заполнен по факту реализации каждой фазы._

**Связанные ТЗ:**
- (будет создан) `plans/tz/2026-06-XX-agents-v2-phase-a-details.md` — детальный план Фазы A с конкретными PR
- (будет создан) `plans/tz/2026-07-XX-agents-v2-phase-b-details.md`
- (будет создан) `plans/tz/2026-08-XX-agents-v2-phase-c-details.md`
