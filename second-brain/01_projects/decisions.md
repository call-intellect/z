---
type: project
status: active
phase: beta
sba_step: β-3
related:
  - regulations
  - specialist-3-4-project-customer
  - curation
  - chat-v2
  - knowledge-clone
---

# SBA β-3 — Specialist 3.3 (Decisions Registry) — реестр решений компании

> «Почему мы так решили» больше не теряется при кадровой ротации.

## Что появилось

Specialist 3.3 — четвёртый специалист Слоя 3 (после α-6 Specialist 3.4, α-7 Specialist 3.1 и β-2 Specialist 3.2 Knowledge Clone). Закрывает самую ценную для бизнеса сущность: **Decision** — структурированную запись «что мы решили + почему + какие были альтернативы + что в итоге получилось».

Decision — центральная сущность для β-4 Insights («какая проблема — следствие какого решения») и γ-1 Skill («как этот человек принимает решения»).

## Откуда берутся решения

Источник — `IdeaBlock`'и с `signalType ∈ {decision, rationale, decision_basis}`. Их размечает Layer-1 (α-2) в момент BlockExtraction. Router (α-3) диспатчит такие блоки в очередь `core.specialist-routing` jobName=`3-3-decisions`, где consumer — `Specialist33DecisionsWorker`.

Воркер передаёт блок в `Specialist33Service.processBlock`, который:

1. Подгружает блок + evidence + контекст ±2 минуты той же RawEvent (соседние блоки в окне — для извлечения rationale из reasoning-блоков рядом).
2. LLM-вызов `decision-extract` (DeepSeek `deepseek-v4-pro` → OpenAI gpt-5.4-mini → Ollama qwen3:30b; переведён на Pro патчем `patch-task-extractor-route-pro.ts`, E 2026-06-22) → черновик `{statement, rationale, alternatives, decidedByPersonHints, affectsEntityHints, decidedAt?, deadline?, status?, confidence}`.
3. Резолв `decidedByPersonIds`: name-match по `Person.name` (предпочтительно `relationship='employee'`); если ничего не нашли — берём subject-Person'ы блока через `IdeaBlockEntity → Entity{type=person} → Person`.
4. Резолв `affectsEntityIds`: для hint'ов с типами {customer, project, product, vendor} — `EntityResolutionService.findOrCreate`. `process` пока не поддерживается (Process — отдельная таблица, не Entity).
5. KNN top-5 похожих Decision того же Org через cosine на embedding (fallback — ILIKE).
6. LLM-арбитр `decision-supersede-detect` → verdict `{verdict: 'new'|'merge'|'supersedes', targetId?, evolvingMeta?}`.
7. Apply:
   - **new** → создаётся новый Decision.
   - **merge** → существующий обновляется: alternatives мерджатся (по `option` case-insensitive), sourceBlockIds/decidedByPersonIds/affectsEntityIds объединяются, rationale append-only (если в существующем не было).
   - **supersedes** → создаётся новый Decision с `supersedesId=existing.id` и `validFrom`; старый помечается `status='superseded'` + `validUntil`. Эмитим `ConflictItem(resourceType='decision', relationType='supersedes')` с suggested resolution='evolving'.
8. Embedding (best-effort, raw SQL update).
9. `CurationService.triage` — `decision` в `CURATION_CRITICAL_TYPES_DEFAULT` → **всегда deep review** (CurationItem).
10. **(НЕ РЕАЛИЗОВАНО)** Проактивный эмиттер решений отсутствует в коде: файла `specialist-3-3-probe.service.ts` / класса `Specialist33ProbeService` нет, `checkAndEmitForDecision` не вызывается. Реестр решений **pull-only** — очередь решений владельцу никто не пушит.

## Probe-events (ДЕКЛАРИРОВАНЫ, НЕ ЭМИТЯТСЯ)

> ⚠️ **Статус: не реализовано в runtime.** Ниже — задуманная спецификация probe/cron по решениям. Backend-эмиттера НЕТ (`Specialist33ProbeService` в коде отсутствует). Причины/reason'ы `decision.missing_decider/no_deadline_critical/overdue/outcome_unknown` и сигнал `decision_no_owner` объявлены только декларативно (комментарии в `schema.prisma` + `frontend/src/domain/assistant-signals.ts`); proactive-watcher их НЕ генерит. Оставлено как контракт на будущее.

| Reason | Trigger | Получатели |
|---|---|---|
| `decision.missing_decider` | `decidedByPersonIds[]` пуст AND status='approved' | участники исходной встречи (через RawEvent → Meeting → Participants); fallback — admin'ы Org |
| `decision.no_deadline_critical` | status='approved' AND deadline=null AND в `sourceBlockIds` есть блок с тегом `'critical'` | owner решения (1-й decidedByPerson) или admin'ы |
| `decision.overdue` (cron) | deadline < now AND status ∉ {implemented, cancelled, rejected, superseded} | owner решения или admin'ы |
| `decision.competing_versions` | KNN нашёл близкое решение, supersede-detect неуверен. На β-3 — не вызывается автоматически, оставлено для будущей админ-страницы | admin'ы Org |
| `decision.outcome_unknown` (cron) | status='implemented' AND actualOutcomes=null AND decidedAt < now − 3 мес | owner решения или admin'ы |

Задумывалось: cron-trigger'ы (overdue, outcome_unknown) в `Specialist33ProbeService.runDailyChecks`, отправка через `ConversationalService.sendNotification({eventType:'specialist.probe', dataClass:'sensitive', ...})`. В коде ни того, ни другого нет.

## Идемпотентность combined-пути + решения встречи в UI (F1/F3 + D5, 2026-06-22)

- **F1 — идемпотентность.** `specialists-combined.persistDecisions` теперь делает `decision.upsert` по `sourceIdeaBlockId` (как полный specialist-3-3): повтор блока с тем же `sourceIdeaBlockId` не падает `Unique constraint failed`, решение материализуется/мержится. Доводит идемпотентность Decision (combined был дефолт-прод-путём, см. ниже).
- **F3 — полнота combined.** Combined-решение/идея выровнены с полным specialist: получают `CurationItem` (`curation.triage`) + embedding + idea `weight>0` + supporters + событие `idea.created` (best-effort). Раньше combined-путь был урезан — решения/идеи проходили без триажа/веса.
- **D5 — решения встречи в UI.** Карточка встречи показывает материализованные `Decision` (секция «Решения встречи», `DecisionsSection` в `OverviewTab`); связь — фильтр `GET /decisions?meeting_id=` (через `IdeaBlockEvidence → RawEvent.sourceExternalId`).

ТЗ [`meeting-to-tracker-and-models-unified-fix`](../../plans/tz/2026-06-22-meeting-to-tracker-and-models-unified-fix.md) F1/F3/D5.

## Conflict-events

| Type | Trigger | Suggested resolution |
|---|---|---|
| Decision supersede (evolving) | LLM арбитр сказал verdict='supersedes' с evolvingMeta | `evolving` (existingValidUntil = now, newValidFrom = decidedAt ?? now) |
| Manual supersede (через API) | `POST /api/v1/decisions/:id/supersede` (owner/admin) | `evolving` (создаём ConflictItem + сразу resolve как evolving) |

## Решения по моделям (см. план β-3 §14)

- **§14.1 `affectsEntityIds[]`** — оставлен массивом с GIN-индексом (`decisions_affectsEntityIds_gin_idx`). Reverse-query «какие решения касались Project X» работает через `where: { affectsEntityIds: { has: entityId } }`. Миграция в join-таблицу — γ+ (если потребуется аналитика «топ-N решений по entity»).
- **§14.2 `alternatives`** — Json. Структура: `[{ option: string, reasonRejected: string|null }]`. Отдельная таблица — γ+.
- **§14.3 Manual creation** — endpoint `POST /api/v1/decisions` (owner/admin only) реализован. UI-кнопка «Создать решение вручную» — НЕ реализована, TODO γ+. Этот endpoint доступен через Swagger.
- **§14.4 Decision как Entity type** — НЕ добавили. У Decision есть поле `entityId?` для связки с графом (заполнится при canonical, отдельным процессом). Если в γ потребуются графовые запросы — расширим Entity.type тогда.

## Модель `Decision`

Расширение модели Фазы 0a in-place. Существовавшие поля (`text`, `decidedByPersonId`, `sourceMeetingId`, `sourceIdeaBlockId`, `decidedAt`) сделаны nullable для backward-совместимости с legacy-записями.

Новые поля β-3:
- `entityId String? @unique` — связка с графом.
- `statement String? @db.Text` — главное поле (одна суть решения).
- `rationale String? @db.Text` — почему так решили.
- `alternatives Json?` — `[{option, reasonRejected}]`.
- `decidedByPersonIds String[]` — авторы (с GIN).
- `decidedAt DateTime?` — когда приняли.
- `deadline DateTime?` — срок исполнения.
- `status DecisionStatus` — `proposed | approved | rejected | implemented | cancelled | superseded` (+ legacy `active | rolled_back`).
- `supersedesId String?` — self-relation на предыдущую версию.
- `affectsEntityIds String[]` — на кого/что влияет (с GIN).
- `sourceBlockIds String[]` — блоки-источники (с GIN).
- `personSubjectIds String[]` — для γ-1 SkillProfile.
- `confidence Decimal(4,3)` — уверенность извлечения.
- `dataClass DataClass @default(sensitive)` — решения чаще стратегические.
- `currentVersionId String?` → CardVersion.
- `embedding Unsupported("vector(1536)")?` — для KNN.
- `validFrom`, `validUntil` — temporal-валидность для evolving.
- `actualOutcomes String? @db.Text` — фактический результат (заполняется ретроспективно).
- `lastConfirmedAt DateTime?` — когда последний раз подтверждали.

Индексы:
- `@@index([tenantId, status])`, `@@index([tenantId, decidedAt])`, `@@index([tenantId, deadline])` (для overdue probe).
- `@@index([supersedesId])` (для supersede-chain lookup).
- `@@index([currentVersionId])`.
- В `apply-postgres-init.sql`: HNSW на embedding, GIN на массивах, generated tsvector `decision_search_tsv` (statement + rationale + actualOutcomes).

## REST API

`/api/v1/decisions` — master-detail (см. `backend/src/modules/decisions/`):

| Метод + путь | Действие | RBAC |
|---|---|---|
| `GET /decisions` | Список с фильтрами (status, decided_by, deadline_filter, affects_entity_id, **meeting_id** (D5, 2026-06-22 — через `IdeaBlockEvidence → RawEvent.sourceExternalId`), q, page, limit) | read |
| `POST /decisions` | Manual create (через triage → deep review) | write |
| `GET /decisions/:id` | Детали Decision | read |
| `GET /decisions/:id/history` | CardVersion timeline | read |
| `GET /decisions/:id/supersede-chain` | Ancestors + descendants | read |
| `POST /decisions/:id/supersede` | Заменить новой версией (создаёт ConflictItem evolving) | write |
| `POST /decisions/:id/status` | Изменить статус (+ CardVersion) | write |
| `POST /decisions/:id/outcomes` | Записать actualOutcomes (+ CardVersion) | write |

RBAC ResourceType — `decision`. Read разрешён всем member'ам Org (`p, manager, open, *, decision, read`); write/delete — owner/admin.

## UI `/decisions`

Master-detail (`frontend/app/(authenticated)/decisions/`):
- Фильтры: status chip group (proposed/approved/implemented/rejected/cancelled/superseded), deadline filter (overdue/upcoming/all), search.
- Сортировка по умолчанию — `decidedAt desc`.
- В правой колонке: status badge, statement (h2), supersede chain (ancestors → descendants как кликабельные ссылки), rationale (pre-wrap), alternatives table, affects entity-id chips (mapping на имена — γ+), provenance (sourceBlockIds count), validity timeline, actualOutcomes.
- Actions (owner/admin): «Отметить как реализованным», «Отменить решение». Manual create через UI — γ+ (на β-3 только API).
- Sidebar — пункт «Решения» в группе «Компания» (после «Регламенты»).

## chat-v2 интеграция

`Specialist33CardHandler` зарегистрирован в `CardSpecialistRegistry` как `'3-3-decisions'`. Возвращает Decision'ы:
- через overlap `sourceBlockIds` с `candidateBlockIds` retrieval'а (приоритетный путь);
- через ILIKE по `statement` / `rationale` / `actualOutcomes` (вторичный, для запросов вроде «что мы решили по X»).

Не возвращает Decision'ы со статусом rejected / cancelled / superseded (устаревшие версии в чат не попадают).

## Метрики

Переиспользуем core_specialist_* с `type='decision'`:
- `core_specialist_pipeline_duration_seconds{type='decision'}` — длительность цикла.
- `core_specialist_llm_tokens_total{type='decision', model, tier}` — токены LLM.
- `core_specialist_probe_events_total{type='decision', reason}` — probe-events.
- `core_specialist_conflict_events_total{type='decision'}` — все конфликты.
- `core_specialist_extraction_failures_total{type='decision', reason}` — провалы.

Новые метрики β-3:
- `core_specialist_conflict_evolving_total{type='decision'}` — отдельный counter для evolving-конфликтов (рядом с conflict_events_total).
- `decision_supersede_chain_length` (histogram) — длина supersede-цепочек для аналитики.

## LLM taskType'ы

- `decision-extract` — извлечение черновика. JSON Schema strict.
- `decision-supersede-detect` — арбитр {new/merge/supersedes}. JSON Schema strict.

Default chain (см. `scripts/seed-llm-task-routes-decisions.ts`):
- `decision-extract` primary: `deepseek-v4-pro` (E 2026-06-22, `patch-task-extractor-route-pro.ts`);
- `decision-supersede-detect` primary: `deepseek-v4-flash` (остаётся на flash);
- secondary: `openai-via-proxy gpt-5.4-mini`
- tertiary: `ollama qwen3:30b` (sensitive-capable)

`maxDataClass >= sensitive` (решения чаще стратегические).

## Cron'ы

> ⚠️ **Не реализовано.** Планировался `@Cron('0 5 * * *')` в `Specialist33ProbeService.runDailyChecks` (обход всех Org, проверка decision.overdue / decision.outcome_unknown, лимит 100 decisions на Org). Этого cron'а в коде нет — по решениям не бежит ни один периодический надзор.

## Что отложено в γ+

- UI «Создать решение вручную» (endpoint POST /decisions есть, кнопки нет).
- Workflow согласования (proposed → approved через approvals).
- Голосование за решение.
- Decision как тип Entity (для графовых запросов).
- Process в `affectsEntityIds` (сейчас skip — Process не Entity).
- Migration `text` → `statement` для legacy-записей.
- Dashboard widget «Overdue decisions» (опциональный β-3.14).

## Замыкание решение↔задача (2026-06-22, ТЗ tasks-subsystem-unified-fix D3)

- **Обратная линковка:** `linkDerivedTasksForDecision` связывает решение с порождёнными из него задачами.
- **Авто-переход во «внедрено»:** Decision → `implemented` при закрытии ВСЕХ связанных задач.
- **Защита supersede:** `markTasksForReviewOnSupersede` не трогает уже закрытые задачи.
- ТЗ [`2026-06-22-tasks-subsystem-unified-fix`](../../plans/tz/2026-06-22-tasks-subsystem-unified-fix.md) (Блок D3). Миграций нет.

## Две оси: память vs исполнение — actionable-решение авто-заводит задачу (2026-06-27, Ф2)

Решение живёт по **двум ортогональным осям**: **память** (что решили — `Decision`.statement/rationale, это ретро и источник правды, не меняется) и **исполнение** (нужно ли из решения завести конкретную работу). Разводит их пара полей `Decision.impliesAction` + `Decision.actionExtractedAt` (миграция `20260627210000_decision_implies_action`, см. [[../02_architecture/data-model]]).

- **Извлечение:** `decision-extract` помечает `impliesAction=true` + `actionTitle` (повелит. наклонение), если решение влечёт конкретное дело (мигрировать/настроить/подготовить). «Решили НЕ делать X» (`status=rejected`) и стратегический/ценностный выбор без действия → `impliesAction=false`.
- **Авто-задача:** `specialist-3-3-decisions.maybeEnqueueActionableTask` для actionable-решения зовёт `IntakeService.create(source='decision', extractedTitle=actionTitle)` → штатный auto-triage → авто-`Issue` + `DecisionTaskLink('derived')` (то же замыкание, что выше). `IntakeSourceSchema` расширен `'decision'`.
- **Идемпотентность:** маркер `actionExtractedAt` + source-block guard — повторный прогон/merge не плодит второй intake (merge bump'ит `impliesAction=true` на существующем Decision).
- **Решение остаётся пассивной памятью.** Дашборд-надзор за внедрением (метрика доведения, оба дашборд-эндпоинта решений, виджет очереди «доведи решение») снят 2026-06-30 (чистка оперативно-контрольного хвоста решений, ТЗ [`2026-06-29-decisions-operational-cleanup`](../../plans/tz/2026-06-29-decisions-operational-cleanup.md)); оперконтроль доведения теперь только на задачах через `DecisionTaskLink`. Ось исполнения (`impliesAction` → авто-задача) живёт.
- **Обратимость — тихий бейдж на карточке (Ф7).** `decision-hygiene-scorer` помечает `Decision.reversibility`; решение с `reversibility==='type-1'` («необратимое», Bezos one-way door) показывает на карточке тихий бейдж «необратимое» — атрибут памяти, без дашборд-алерта.
- ТЗ [`2026-06-27-task-decision-execution-unified`](../../plans/tz/2026-06-27-task-decision-execution-unified-tz.md) (Ф2). **Старые решения** `impliesAction=false` по дефолту → бэкфилл-ре-экстракция отложена (см. [[../04_не-сделано/README]]).

## Связи

- **β-4 Insights** будет читать Decision'ы, чтобы связать «эта проблема — следствие решения X».
- **γ-1 Skill / Clone** будет использовать `rationale` Decision'ов как главный источник «как сотрудник принимает решения».
- **α-4 Curation** — все Decision'ы автоматически идут в deep review (decision в CURATION_CRITICAL_TYPES_DEFAULT).
- **α-3 Router** — диспатчит decision/rationale/decision_basis блоки с jobName='3-3-decisions'.

## Файлы

Backend:
- `backend/prisma/schema.prisma` — модель `Decision` (расширена in-place).
- `backend/scripts/postgres-init.sql` — HNSW + tsvector + GIN на массивах для `decisions`.
- `backend/src/modules/knowledge-core/workers/specialist-3-3-decisions.worker.ts`
- `backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts`
- `backend/src/modules/knowledge-core/services/specialist-3-3-card-handler.service.ts`
- `backend/src/modules/knowledge-core/specialist-3-3.module.ts`
- `backend/src/modules/knowledge-core/prompts/decision-extract.prompt.ts`
- `backend/src/modules/knowledge-core/prompts/decision-supersede-detect.prompt.ts`
- `backend/src/modules/decisions/` — REST API (controller + service + dto + module).
- `backend/scripts/seed-llm-task-routes-decisions.ts`

Frontend:
- `frontend/src/api/decisions.api.ts`
- `frontend/src/domain/decision.ts`
- `frontend/app/(authenticated)/decisions/page.tsx`
- `frontend/app/(authenticated)/decisions/DecisionsListClient.tsx`
- `frontend/src/ui/components/app-shell/Sidebar.tsx` (добавлен пункт «Решения»)

Documentation:
- `second-brain/13_glossary/ui-glossary.md` (секция «SBA β-3»).
- `second-brain/02_architecture/module-map.md`, `knowledge-core.md`, `index.md`.
