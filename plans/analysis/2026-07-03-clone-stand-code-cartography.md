---
type: analysis
feature: clone-quality-stand
subtype: code-cartography
date: 2026-07-03
status: reference
relates_to:
  - plans/2026-07-03-employee-clone-quality-HANDOFF.md
  - plans/tz/2026-07-03-clone-stand-and-baseline.md
  - plans/analysis/2026-07-03-employee-clone-expert-answer-audit.md
source: workflow clone-stand-cartography (10 ридеров + синтез, wf_7906505a-30d)
---

> **Свежая картография кода под ТЗ-0** (снята fan-out-ом 2026-07-03, строки-якоря аудита сверены с реальным кодом).
> Раздел «Констатация дрейфа» — где код отличается от аудита; это первично для точности ТЗ.
> Пути от корня репо. Строки могут дрейфовать далее — при реализации фазы досверяться по символу.

# Картография кода под ТЗ-0 клон-стенда

Плотная сводка 10 карточек, организованная по фазам стенда. Все якоря — `path:line` из карточек. Где карточка не дала факта — помечено «TODO: доснять при реализации фазы». Все пути абсолютные от корня репо `/Users/sergrvmz/Documents/kora/`.

---

## Общий переиспользуемый слой (`backend/scripts/_lib/`) — фундамент всех фаз

Единый harness, на котором строятся Канал А, Канал Б и раннеры. Файл: `backend/scripts/_lib/combat-harness.ts`.

- **`readConfig(argv?)`** — `combat-harness.ts:36`. Собирает `HarnessConfig` (`combat-harness.ts:11`) целиком из ENV: `MODE`, `BASE_URL`, `X_ORG_ID`, `INGEST_TOKEN`, `SESSION_COOKIE`, `DATABASE_URL`(обяз), `REDIS_URL`(обяз), `VERIFY_TIMEOUT_MS`(деф 90000), `VOX_LIVE`, `KEEP_TENANT`, `ALLOW_PROD`; `runMode='gate'` если argv содержит `--gate`, иначе `'audit'`.
- **`assertNotProd(cfg)`** — `combat-harness.ts:91`. Prod-guard: бросает, если host в `databaseUrl/redisUrl/baseUrl` не приватный (localhost/127.0.0.1/::1/postgres/redis/host.docker.internal/10./192.168./172.16-31./host-без-точки). Обход `ALLOW_PROD=1` (warn). **Host без точки трактуется как приватный** (docker-имена postgres/redis проходят), `korateam.ru`/`46.8.196.29` — блокируются. Вызывать ПЕРВЫМ в каждом стендовом скрипте.
- **`makeInfra(cfg)`** — `combat-harness.ts:120` → `HarnessInfra{prisma; redis; rawEventsQueue:Queue('core.raw-events'); close}` (`combat-harness.ts:111`). IORedis с `maxRetriesPerRequest:null` (обязательно для BullMQ). `RAW_EVENTS_QUEUE='core.raw-events'` — `combat-harness.ts:118`.
- **`injectRawEventDirect(infra, args)`** — `combat-harness.ts:250`. `idempotencyKey=sha256(sourceId:sourceExternalId??payloadChecksum:occurredAtIso)`; при существующем → `{idempotent:true}`; иначе `rawEvent.create(payloadStorage 'inline', dataClass деф 'internal', processingStatus 'received')` + `queue.add('raw-received',{rawEventId},{jobId:raw_${id}})`. P2002 → возврат существующего.
- **`upsertSource(prisma,{tenantId,type,name})`** — `combat-harness.ts:225`. Upsert по ключу `tenantId_type_name`, `dataClass='internal'`, `isActive=true`.
- **`bootstrapTenant(prisma)`** — `combat-harness.ts:143` → `SyntheticTenant{tag,userId,orgId,personId}` (`combat-harness.ts:136`). User(`cmbt-<hex>@combat.test`, role `user`, signupSource `standalone`) + Org(slug `<tag>-org`, visibilityMode `open`, tier `basic`) + Membership(`owner`) + Person(`employee`). `tag='cmbt-'+randomBytes(3).hex`.
- **`teardownTenant(prisma,t)`** — `combat-harness.ts:177`. Каскадное удаление ~24 таблиц в FK-порядке, каждый шаг `.catch(()=>undefined)`.
- **`loadCounts(prisma,tenantId)`** — `combat-harness.ts:380` → `TenantCounts` (`combat-harness.ts:355`, 22 счётчика). `rawEventProcessed=status!='received'`, `canonicalBlock=status 'canonical'`, `commitmentBlock=ideaBlock signalType 'commitment'`.
- **`pollUntil(prisma,tenantId,predicate,timeoutMs,intervalMs=1000)`** — `combat-harness.ts:464`. Поллит `loadCounts` до `predicate` ИЛИ дедлайна; **НЕ бросает по таймауту** — возвращает последний снимок (вызывающий сам проверяет predicate).
- **`probeAge(prisma,tenantId)`** — `combat-harness.ts:491`. Узлы Apache AGE-графа `z_graph` через cypher, фильтр `n.tenant_id`.
- **`NODE_COLUMNS`** (`combat-harness.ts:521`, 14 колонок) / **`renderMatrix`** (`combat-harness.ts:547`) / **`computeExitCode(rows,runMode)`** (`combat-harness.ts:562`, gate→любой FAIL=1; audit→FAIL с note не-`known`=1).
- **`createPrismaClient()`** — `backend/scripts/_lib/prisma.ts:4`. `PrismaPg` adapter, `search_path=ag_catalog,"$user",public`. **Обязателен** (Prisma 7 роняет голый `new PrismaClient()`).
- **`silenceRedisShutdownNoise()`** — `backend/scripts/_lib/silence-redis-shutdown.ts:8`. Глушит `Connection is closed`.
- **`directLlmCall(opts)`** — `backend/scripts/_lib/llm-direct.ts:207` → `DirectCallResult` (`llm-direct.ts:38`). Диспетчер `deepseek`(chat.completions+tool_choice) / `openai-proxy`(responses+json_schema strict). **Ошибки НЕ бросаются** — оседают в `result.error` (text='', токены=0). `DirectCallOpts` — `llm-direct.ts:26` (нет `temperature`; `openai-proxy` — `reasoningEffort` деф 'medium'). `buildClient` — `llm-direct.ts:50` (ключи из ENV: `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL`, `OPENAI_API_KEY`/`PROXY_PREFIX`/`PROXY_BASE_URL`). `PRICES` — `llm-direct.ts:11` (только deepseek-v4-pro/flash, gpt-5.4/-mini).

**Критическая ловушка всего harness:** он **НЕ поднимает NestJS AppModule**. `injectRawEventDirect` кладёт RawEvent в БД + очередь, а обработку делает **уже запущенный backend-процесс** (`bun run dev` → воркеры in-process через `WorkersModule`). Без живого backend/воркеров `pollUntil` никогда не сойдётся. Раннеры run (Фаза 1), напротив, сами поднимают AppModule.

---

## Фаза 0а — наполнение / пере-сев / роли / регламенты / смена носителя / конфиг окружения

### Пере-сев «Стрелы» (Канал А наполнения)

- **Базовый сев:** `backend/scripts/seed-synthetic-company.ts`. `bootstrap(prisma)` — `seed-synthetic-company.ts:149` → `SeedTenant{tag,orgId,ownerUserId,people:Map<name,personId>}`. Owner-User `Сергей`(signupSource `standalone`) + Org(`Компания Стрела [QA-test <tag>]`, slug `<tag>-strela`, visibilityMode `open`, tier `basic`) + Membership(`owner`). Employee: Сергей+Анна/Михаил/Дарья/Игорь/Елена/Александр (`relationship='employee'`, email `<name>.<tag>@strela.test`, `externalSource='qa-test'`). External: Виктор/Наталья/Пётр/Ольга (`@client.test`). `tag='strela-<hex6>'`. **Елена и Игорь — ОТДЕЛЬНЫЕ employee** (`seed-synthetic-company.ts:185`); слияния Елена→Игорь в коде НЕТ (см. Констатацию дрейфа).
- `main()` — `seed-synthetic-company.ts:263`. `readConfig→assertNotProd→makeInfra→bootstrap→upsertSource×5(meeting/bitrix/chatbox/conversational/external)+daily_checkin→инъекция 5-дневной ленты→pollUntil(canonicalBlock>=20 && decision+idea+insight>=5 && intakeIssue>=3, verifyTimeoutMs, 3000)`. **orgId наружу отдаётся ТОЛЬКО через stdout `ORG_ID=<orgId>`** (`seed-synthetic-company.ts:465`) — в env не пишется. **Раннер обязан спарсить stdout и экспортировать в `STRELA_ORG`**. Регламент вводится как external-документ (`seed-synthetic-company.ts:439-446`): `payload.fullText`, owner='Елена', scope='роль специалист поддержки'.
- **Долив недели:** `backend/scripts/seed-synthetic-company-week2.ts`. `main()` — `seed-synthetic-company-week2.ts:101`. Читает `orgId=process.env['STRELA_ORG']` (**throw если пусто**, `seed-synthetic-company-week2.ts:104-105`). `loadTenant()` подтягивает `ownerId` + `Map<name,personId>` по `relationship='employee'`. Инъектит day −9..−5, поллит до `canonicalBlock>=40`. Не создаёт org/people.
- **Инъекция:** `injectRawEventDirect` (`combat-harness.ts:250`, см. общий слой). Идемпотентность по `(sourceId, sourceExternalId??checksum, occurredAt)`. **occurredAt считается от `Date.now()−day(N)`** — повтор в другой день даст дубли; пере-сев = НОВЫЙ тенант (новый tag), не повторный прогон.

### Модели ролей/носителей (schema.prisma)

- **`Role`** — `schema.prisma:4992` (@@map `roles`); `@@unique([tenantId,name,deletedAt])`. Носитель — через PersonRole/Appointment, не полем.
- **`PersonRole`** — `schema.prisma:5252` (@@map `person_roles`); `validTo=null`=действующий. **`buildForRole` читает именно `PersonRole(validTo=null)`.**
- **`Appointment`** — `schema.prisma:5286` (@@map `appointments`); `loadPercent`, `status active|former|acting`, `validFrom/validTo`. **`maybeEmitBearerChanged` берёт носителя из `Appointment(validTo=null)`, топ по `loadPercent/validFrom`** — НЕ из PersonRole.
- **`ExecutablePersona`** — `schema.prisma:8883` (@@map `executable_personas`); `scope`, `scopeRefId`(=roleId), `version`, `roleVersion`, `currentBearerPersonId`, `publicName`, `succeedsPersonaId`, `status active|superseded|frozen|pending_rebuild`. `@@unique([profileId,scope,scopeRefId,version])`.
- **`CloneAccessGrant`** — `schema.prisma:2893`; `cloneType('person'|'role')`, `cloneRefId`(без FK), soft-revoke, `@@unique([tenantId,grantedToUserId,cloneType,cloneRefId])`.
- **`Regulation`** — `schema.prisma:6198` (@@map `regulations`); `scope`(`org`|`department:<id>`|`role:<id>`|`project:<id>`), `ownerPersonId`, `embedding vector(1536)`, `supersedesId`, `@@unique([tenantId,name])`.

### Назначение ролей + смена носителя (событие `role.bearer_changed`)

- **`RoleBearerChangedEvent`** — `backend/src/modules/knowledge-core/services/role-clone-persona-versioning.handler.ts:26`: `{tenantId; roleId; oldPersonId:string|null; newPersonId:string|null; changedAt:Date}`. `oldPersonId=null` — первое назначение; `newPersonId=null` — освобождение.
- **`RoleClonePersonaVersioningHandler.handle(event)`** — `role-clone-persona-versioning.handler.ts:87` (`@OnEvent('role.bearer_changed')`) → `string|null`. Active→superseded; новая версия(`roleVersion=prev+1`, `succeedsPersonaId=prev.id`, `currentBearerPersonId=newPersonId`, `publicName='Клон <Role.name> v<N+1>'`, `status='pending_rebuild'`, пустой prompt) + немедленный `buildForRole`. Идемпотентен по `(roleId,newPersonId,succeedsPersonaId)`. **Публичный `handle()` можно дёргать напрямую в baseline минуя event-bus.**
- **`ExecutablePersonaBuildService.buildForRole({tenantId,roleId,triggerReason?,triggerEventAt?})`** — `backend/src/modules/knowledge-core/services/executable-persona-build.service.ts:295` → `ExecutablePersona|null`. `PersonRole(validTo=null, take 50)` → `SkillProfile(active)` → `SkillTrait(status=active, layer='skill', top10 confidence/observationCount)`. `null` если нет носителей. **`computeRoleVersioning()`** — `executable-persona-build.service.ts:835` (carry-forward версий; `currentBearerPersonId` ставится в Person ТОЛЬКО если носитель ровно один, `bearerPersonIds.length===1`).
- **`AppointmentsService.maybeEmitBearerChanged({tenantId,roleId})`** — `backend/src/modules/appointments/services/appointments.service.ts:373` (private, вызовы при create/update/softDelete — строки 185/260/315, все void+catch). **Единственный продовый эмиттер события.** Если `EventEmitter2` не внедрён — no-op. **Смена носителя ТОЛЬКО через PersonRole событие НЕ вызовет** — менять через AppointmentsService.

### Выдача прав клону

- **`ClonesAdminService.createAccessGrant({tenantId,actorUserId,dto:CreateAccessGrantDto{grantedToUserId,cloneType,cloneRefId,expiresAt?}})`** — `backend/src/modules/clones/services/clones-admin.service.ts:27` → `AccessGrantDto`. Проверяет membership (иначе `BadRequest user_not_in_org`), `assertCloneRefExists`, upsert (revoked → воскрешение), шлёт `clone.access_granted` (best-effort). Идемпотентно. **`cloneRefId` без формального FK** — прямая вставка в БД мимо сервиса пропустит проверку существования клона.

### Консолидация регламентов

- **`RegulationConsolidatorService.consolidateTenant(tenantId,limit=500)`** — `backend/src/modules/knowledge-core/services/regulation-consolidator.service.ts:321` → `{merged,scanned}`. Типы `['regulation','process','policy','instruction']`, `consolidateCard()` (мерж дублей, union `sourceBlockIds`). **Backfill вызывает с `limit=1000`.**
- **Backfill-скрипт:** `backend/scripts/backfill-regulation-consolidate.ts` — (A) `consolidateTenant(orgId,1000)`; (B) raw-SQL cosine-KNN (`MIGRATION_COSINE_MIN=0.85`, хардкод) Process→ProcessTemplate, union `sourceBlockIds`, `Process.status='deprecated'`. Флаги `--dry-run/--org`. Поднимает полный AppModule.

### Версионирование role-клонов (backfill/patch)

- `backend/scripts/backfill-role-clone-single-bearer.ts` — инвариант «1 active на роль»: (A) лишние active→frozen; (B) superseded→frozen, pending_rebuild→superseded; (C) пересборка `buildForRole` с `currentBearerPersonId=null`. Флаги `--dry-run/--tenant=/--skip-rebuild`. Поднимает AppModule.
- `backend/scripts/patch-clones-role-versioning.ts` — active+`roleVersion IS NULL` → `roleVersion=1`, `publicName='Клон <Role.name> v1'`. **НАРУШЕНИЕ КАНОНА:** голый `new PrismaClient()+PrismaPg` (`patch-clones-role-versioning.ts:6-8`), не `createPrismaClient()`. Работает на голом Prisma без Nest.

### Конфиг окружения — что трогать и как (ENV vs AdminSetting)

- **`STRELA_ORG`** — `backend/scripts/probe-stand/seed-fixtures.ts:3`: `process.env['STRELA_ORG'] ?? 'cmr1qbvpx0001pwbwxbgmh1jl'`. **НЕ в env.schema.ts** — прямой `process.env` с хардкод-фолбэком; в `seed-synthetic-company-week2.ts:104` фолбэка нет (throw).
- **Сиды AdminSetting клона (защищают admin-edited):**
  - `backend/scripts/seed-admin-setting-clone-coverage.ts` — `knowledgeClone.profileMinConfidence=0.55` (`seed-admin-setting-clone-coverage.ts:20`, registry:140).
  - `backend/scripts/seed-admin-setting-clone-regulations.ts` — 4 ключа `clone.regulations.*` (`seed-admin-setting-clone-regulations.ts:18`): `retrieval.top_n=6`, `retrieval.min_similarity=0.3`, `snapshot.max_items=20`, `scope.include_org=true` (registry:136-139).
- **Крутилки, влияющие на наполнение (менять через AdminSetting, admin→ENV→code):**
  - `tracker.methodCaptureMinComplexity` — `issues.service.ts:1315` (`getDynamic(...,0.5)`, registry:453). Опустить до 0, чтобы захват метода срабатывал на простых кейсах.
  - `knowledge.skillProfileMinObservations` / `knowledge.skillClusterMinObservations` — `backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts:314` (fallback = `SKILL_MIN_OBSERVATIONS=5` / `3`). **Оба ОТСУТСТВУЮТ в registry** (дрейф) — через admin-UI валидированно не задать.
  - `PERSONA_MIN_TRAITS` (деф 3, `env.schema.ts:607`) = AdminSetting `knowledge.personaMinTraits` (registry:120); `PERSONA_ROLE_AGG_MIN_PERSONS` (деф 2, `env.schema.ts:608`) = `knowledge.personaRoleAggMinPersons` (registry:121). Опустить до 1 на одном носителе.
- **Ловушка очистки:** Org создаётся `tier='basic'`, `externalSource='qa-test'` (не `'demo'`) → `resetDemoWorkspace` (фильтр `externalSource='demo'`) эти данные НЕ тронет. Чистить по своему признаку (tag в slug/name).

---

## Фаза 0б — Канал Б (ответ на probe → ингест в конвейер клона)

Полный контур: адаптер → `InboundMessage{type:'response'}` → `dispatchInbound` → `ProbeResponseInboundBridge.handleResponse` → `respondToProbe` (emit `notification.responded`) → `ProbeResponseHandler.handle` → `ingestResponseAsRawEvent` → `ingestNotificationResponse` → `IngestService.ingest` (RawEvent `kind='notification_response'`) → `block-ingest.worker` (склейка Q&A, атрибуция автора, форс `signalType='reasoning'`).

### Программный путь (две точки входа)

- **Прямой (короткий):** `ConversationalService.respondToProbe({notificationId,userId,payload:ConversationalJson})` — `backend/src/modules/conversational/conversational.service.ts:311` → `Notification`. Проверки по порядку: (1) Notification найдено иначе `NotFoundException notification_not_found`; (2) `notif.recipientUserId===args.userId` иначе `ForbiddenException not_recipient`; (3) `responseStatus==='answered'` → **идемпотентно** возвращает без изменений и БЕЗ повторного emit; (4) `expiresAt<now` → `BadRequestException notification_expired`. Затем `responseStatus='answered'`, `respondedAt=now`, `status='responded'`, emit `notification.responded` с `{tenantId,notificationId,recipientUserId,eventType,payload,contextBlockId,contextCardId}`. **`args.userId` ОБЯЗАН === `Notification.recipientUserId`.**
- **Через мост (полный контур с digest):** `dispatchInbound(msg:InboundMessage)` — `conversational.service.ts:715` → `ProbeResponseInboundBridge.handleResponse` — `backend/src/modules/conversational/probe-response-inbound.bridge.ts:70`. Гейт `msg.type==='response'`; для `eventType==='probe.digest'` резолвит `probeEventId` через `resolveDigestProbeEventId` (`probe-response-inbound.bridge.ts:25`, token-overlap). Затем `respondToProbe`. Требует, чтобы `Bridge.onModuleInit` отработал.
- **`InboundMessage['type']='response'`** — `backend/src/modules/conversational/types/channel.types.ts:27`: `{type:'response'; userId; tenantId; notificationId; payload:ConversationalJson; originChannelBindingId?}`. `payload={text:'ответ клона'}`.

### Downstream закрытия петли (автоматически по emit)

- **`ProbeResponseHandler.handle(event)`** — `backend/src/modules/probe/probe-response.handler.ts:85` (`@OnEvent('notification.responded')`). Гейт `event.eventType.startsWith('probe.')`. Находит ProbeEvent: `payload.probeEventId` → `findFirst{id,tenantId,dispatchedNotificationId}`, иначе `findFirst{tenantId,dispatchedNotificationId=event.notificationId}`. Нет ProbeEvent → debug-лог + return. Классифицирует ответ (LLM), зовёт `ingestResponseAsRawEvent`. **Завязан на живой `EventEmitter2`** — в юнит-тесте без него собрать `NotificationRespondedPayload` вручную и вызвать `handle`.
- **`signalTypeHint` (вычисление)** — `probe-response.handler.ts:157`: `probe.reason === 'skill.cdm_interview' || probe.reason === 'task.method_capture' ? 'reasoning' : undefined`. **КЛЮЧЕВОЙ якорь:** чтобы ответ стал reasoning-блоком клона, `ProbeEvent.reason` ДОЛЖЕН быть одним из этих двух.
- **`ingestResponseAsRawEvent(args)`** — `probe-response.handler.ts:1192` (private, ошибки глотает warn). `userId=event.recipientUserId`, `questionText` из `extractQuestionText(probePayload)`.
- **`ConversationalIngestAdapter.ingestNotificationResponse(args)`** — `backend/src/modules/conversational/adapters/conversational-ingest.adapter.ts:52` → `RawEvent`. Строит `rawPayload={kind:'notification_response', userId, respondsToNotificationId, eventType, sourceChannelKind, contextBlockId, contextCardId, questionText, response=payload, [signalTypeHint]}`; зовёт `ingest.ingest` с `sourceId=ensureSource(tenant).id`, `sourceExternalId='resp:<notifId>'`. `DEFAULT_SOURCE_NAME='Свободные заметки'` (`conversational-ingest.adapter.ts:12`, type `conversational`).
- **`IngestService.ingest(input)`** — `backend/src/modules/ingest/ingest.service.ts:41` → `{rawEvent,idempotent}`. `idempotencyKey=sha256(sourceId:sourceExternalId??payloadChecksum:occurredAtIso)`. Квота `ingest_bytes_per_month` (только `QuotaExceededError` пробрасывается). RawEvent `processingStatus='received'` + `enqueueRawReceived`. **Автора/субъекта не проставляет.**
- **`segment-builder` склейка** — `backend/src/modules/knowledge-core/services/segment-builder.service.ts:233`: для `kind='notification_response'` → `questionText ? 'Вопрос Коры: <q>\n\nОтвет сотрудника: <r>' : responseText`.
- **`block-ingest tryGetActorIdentity(payload)`** — `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts:933`. Приоритет `actor.userId > responsible.personId > uploaderId > payload.userId(→authorUserId) > from.address`. Для `notification_response` — ветка `payload.userId`.
- **`block-ingest applySignalTypeHint(blocks,hint,payload)`** — `block-ingest.worker.ts:995`. Форсит `signalType` на первом блоке или строит синтетический.

### Гейты подъёма probe (`task.method_capture`) — что стенд обязан пройти или снять

Триггер: `transitionState`/`update` → `completed` → `maybeRaiseMethodCaptureProbe` → `ProbeService.suggest` → `ProbeDispatcherWorker.process` → `dispatched`.

- **`transitionState(id,dto,tenantId,userId)`** — `backend/src/modules/tracker/services/issues.service.ts:1161`. При `newState.category==='completed' && !existing.completedAt` → `completedAt=now` + best-effort `maybeRaiseMethodCaptureProbe`. **Идемпотентен** (`existing.stateId===dto.stateId` → ранний return без activity/probe).
- **`transitionToCategory(id,'completed',tenantId,userId)`** — `issues.service.ts:1376`. Обёртка: резолвит первый по sequence completed-стейт → делегирует. **Удобнее для стенда** (не нужно знать `completedStateId`).
- **`maybeRaiseMethodCaptureProbe({issueId,tenantId})`** — `issues.service.ts:1266`. Гейты: `tracker.methodCaptureEnabled=true`; issue не deletedAt; **`assignees` непусты** (`recipientCandidates=assignees.userId`, иначе return ДО suggest — `issues.service.ts:1296`); `complexity>=minComplexity`. Затем `suggest` reason `task.method_capture`, `emittedByService='task-method-capture'`, `payload.contextCardId=issue.id`, `priorityHint=0.7`.
- **`computeMethodCaptureComplexity(input)`** — `issues.service.ts:1347`. **Точная формула** (`issues.service.ts:1360-1365`): `clamp01( 0.4*clamp01(descriptionLength/280) + 0.3*clamp01(activityCount/8) + 0.2*clamp01(lifetimeDays/7) + 0.1*priorityWeight )`, `priorityWeight`: urgent|high→1, medium→0.5, иначе→0. `descriptionLength=(descriptionStripped??description??'').length`. **Порог 0.5.** Минимальный набор для 0.5: `priority='high'`(0.1) + `descriptionStripped>=280 симв`(0.4). Либо снять через AdminSetting `tracker.methodCaptureMinComplexity=0`.
- **`ProbeService.suggest(input)`** — `backend/src/modules/probe/probe.service.ts:46` → `ProbeSuggestResult`. Гейты по порядку: (1) валидация + непустые `recipientCandidates`; (2) `suppressOnUnconfirmedAuto` (только MACHINE_FILLABLE — method_capture пропускается); (3) **content-dedup** `probe:cooldown:*` + `probe:dedup:{tenant}:{contentHash}` SET NX EX (`dedupTtlHours*3600`); (4) **semantic-dedup**; (5) **rate-limit** (immediate→`dropped_rate_limit`); (6) **cold-start**→`routed_to_digest`; (7) `priority<minValuePriority(30)`→`dropped_low_value`; (8) NUDGE→digest. `priority=round(clamp01(priorityHint??0.4)*100)` → method_capture=70.
- **`maybeSemanticDedup(args)`** — `probe.service.ts:401`. Флаг `probe.semanticDedupEnabled` (деф true), порог `0.92`, окно `72ч`. **Главная ловушка масс-сева:** одинаковый `suggestedQuestion` → sim≈1.0 → DEDUP. Варьировать текст на задачу, либо снять флаг, либо чистить `probe_events.questionEmbedding`.
- **`filterByRateLimit(recipientCandidates)`** — `probe.service.ts:501`. `limitHour=5`, `limitDay=20`. Ключи `probe:ratelimit:{userId}:h:{bucket}` / `:d:{bucket}`. Adaptive-fatigue: `probe:engagement:{userId}<0.2` → лимиты /2 (5→2/час). `noteSent` — `probe.service.ts:555` (инкремент ПОСЛЕ dispatch).
- **`ProbeDispatcherWorker.process(job)`** — `backend/src/modules/probe/probe-dispatcher.worker.ts:85`. Финальный гейт до `dispatched`. `expiresAt<now`→expired; повторный rate-limit; **`priority<immediatePushMinPriority(70)`→queued_digest** (method_capture=70 проходит ВПРИТЫК, условие строгое `<`); `selectRecipient` (`probe-dispatcher.worker.ts:325`); **formulation value-gate** (`ask===false`→`dropped_low_value`, LLM-гейт, недетерминирован); `sendNotification(eventType='probe.question')`; `noteSent`; `status='dispatched'`, `dispatchedNotificationId=notif.id`; `setTopicCooldown(48ч)`. **Воркер in-process** (`WorkersModule`, очередь `core.probe-events`, concurrency 2).
- **Связь ProbeEvent↔Notification:** `dispatchedNotificationId` пишет ТОЛЬКО `probe-dispatcher.worker` (строка 272). Модель `ProbeEvent` — `schema.prisma:6824`; enum `ProbeStatus` — `schema.prisma:6690`. **Стенд, создающий Notification+ProbeEvent вручную, обязан связать их** (`dispatchedNotificationId=Notification.id`, `status='dispatched'`), иначе `ProbeResponseHandler` молча пропустит.
- **`Notification` (probe-поля)** — `schema.prisma:7281`: `recipientUserId`, `eventType`, `responseStatus`, `expiresAt`, `respondedAt`, `externalSource`. Стенд создаёт: `eventType='probe.question'`, `recipientUserId=автор-клон`, `responseStatus='pending'`, `expiresAt` в будущем/null.
- **Reason-политика:** `PROBE_REASON_WINDOW['task.method_capture']='immediate'` — `backend/src/modules/probe/probe-reason-policy.ts:22`. method_capture **отсутствует** в `MACHINE_FILLABLE_REASONS/NUDGE_REASONS/PROBE_REASON_RECHECK` (`probe-reason-policy.ts:35`) — применимые гейты ровно: content-dedup, semantic-dedup, rate-limit, cold-start, min-value(30), immediatePush(70), formulation.
- **Redis-ключи усталости:** `probeEngagementRedisKey`/`probeTopicCooldownRedisKey` — `backend/src/modules/probe/probe-fatigue.util.ts:7`. Чистить `probe:engagement:*` и `probe:cooldown:{tenant}:*`.

### Как поллить ProbeEvent до `dispatched` и найти Notification

- Ассерт успеха: `ProbeEvent` где `reason='task.method_capture' AND status='dispatched' AND dispatchedNotificationId IS NOT NULL` для tenantId. Быстрый отбор через `@@index([tenantId,emittedByService])` — `emittedByService='task-method-capture'`.
- Образец loop-поллинга: `pollProbe` — `backend/scripts/probe-stand/stand.ts:103`: `deadline=now+timeoutMs`, `findMany(ProbeEvent where tenantId+reason+createdAt>=startedAt, take 50, desc)`, матч по `payload.contextCardId`, sleep 700мс, дефолт-таймаут 10_000мс.
- **`dialogEnabled`** — `cfg.probe.dialogEnabled` (AdminSetting без ENV, деф true, registry:279). **НЕ гейт подъёма** method_capture — влияет на пост-dispatch clarify-фазу (`ProbeDialogState`). Не путать с параметром `respondToProbe` (там его НЕТ, см. дрейф).

---

## Фаза 0в — Слой 0 (фиделити клона: манифест ↔ база read-only)

**Целевые файлы ещё НЕ созданы** (`backend/scripts/clone-stand/` отсутствует): `layer0-annotate.ts`, `layer0-match.ts`, `clone-feed-manifest.json`. ТЗ-0 создаёт их по образцу манифеста + reader/judge-паттерну probe-stand.

### Схема манифеста (образец — `backend/scripts/eval/gold/strela-manifest.batch*.json`)

- **`_meta`** — `strela-manifest.batch1.json:2-10`: `{tenant, batch, source, anchors, method, compareResult:string, note?, findings?:string[], dedupChecks?, fullResult?}`. `method='2 непересекающихся агента-разметчика (blind) → сверка → сверялка с базой read-only'`, `compareResult` — счётчики строкой.
- **`blocks[]` annotate-форма** — `strela-manifest.batch1.json:11-22`: `{anchorId:'A1..', signalType:'decision'|'goal'|'fact'|..., gist, author, agreement:'full'|'partial'|'conflict'}`. `signalType` — **словарь разметчика, НЕ enum базы**.
- **`blocks[]` match/verdict-форма** — `strela-manifest.batch2.json:17-27`: добавляет `verdict:'found'|'wrong_type'|'partial'|'missing'`, `baseType?`, `note?`. Прямой шаблон вердиктов `layer0-match`.
- **`entities[]`** — `strela-manifest.batch1.json:23-38`: `{name, type:'person'|'metric'|'feature'|...}`. Основа `entity fidelity` + `no_false_merge`.
- **`blockEdges[]`** — `strela-manifest.batch1.json:39-46`: `{from, to, relation}` (must-have, закрытый список). Для клона edge = derivation-trail (черта выведена из `sourceBlockIds`).
- **Для клона манифест расширяется полем `expected`** (образец — `FixtureExpected`, `backend/scripts/eval/run-skill-trait-detect-golden.ts:25-34`): `{shouldExtract, categoryKeywords?, statementContainsQualifier?, minObservations?, expectedConfidence?:'low'|'medium'|'high', forbiddenWords?}`.
- **Метод сверки:** `docs/methodology/synthetic-fidelity-eval-method.md` (§6 — адаптация под клон; правило №1 против тавтологии).

### Prisma-модели клона (read-only, фильтр `status='active'` обязателен)

- **`SkillProfile`** — `schema.prisma:8462-8488`: 1:1 с Person(employee), `status active|archived|paused_relationship`, `buildVersion`, `lastBuildAt`. Корень чтения: `findMany{where:{tenantId:STRELA,status:'active'}, include:{traits,person}}`.
- **`SkillTrait`** — `schema.prisma:8493-8548`: `statement:Text` (гипотезная формулировка), `confidence:SkillConfidence`, `observationCount`, **`sourceBlockIds:String[]`** (grounding), `layer:SkillTraitLayer`, `conceptId?`, `embedding`. **ГЛАВНАЯ модель Слоя 0.** `trait recall` — все методы дали active SkillTrait; `derivation` (правило №1) — statement ВЫВЕДЕН из sourceBlockIds (кластер ≥3), не скопирован из gist. **Двойное поле категории:** `category:VarChar(200) @deprecated` + `categoryId?→SkillTraitCategory`.
- **`SkillTraitConcept`** — `schema.prisma:8554-8584`: канонизация одинаковых по смыслу traits разных сотрудников (`no_false_merge` на уровне навыков).
- **`ExecutablePersona`** — `schema.prisma:8883-8946`: `includedTraitIds:String[]`, `status active|superseded|pending_rebuild|frozen`. `persona fidelity` — active-персона собрала выведенные черты (`includedTraitIds ⊇ ожидаемых`). `frozen` — тест бывшего носителя (Елена→Игорь).
- **`RoleProfile`** — `schema.prisma:5523-5556`: `roleId @unique`, `summaryCache:Json`, `status forming|ready|stale|error`, `completeness`. Слой 0 роли: `status='ready'`.
- **`RolePrinciple`** — `schema.prisma:8655-8683`: `situation`, `statement`, `sourceBlockIds`, `status active|superseded|archived`.
- **`PracticeSkill`** — `schema.prisma:8736-8791`: `trigger`, `steps:Json`, `redFlags`, `status shadow|active|archived|deprecated`, `derivedFromTraitIds`/`derivedFromConceptIds` (extractor-trail).
- **Enum'ы фильтров:** `SkillProfileStatus`(`schema.prisma:8403`), `SkillTraitStatus active|superseded_by|archived|misleading|pending_verification`(`schema.prisma:8423` — считать ТОЛЬКО `active`; `pending_verification` не в персоне), `SkillConfidence`(`schema.prisma:8410`), `SkillTraitLayer skill|value|motivation|process_marker`(`schema.prisma:8642`), `PersonaStatus`(`schema.prisma:8451`), `PersonaScope person|role`(`schema.prisma:8434`)/`SkillScope person|role|org`(`schema.prisma:8830`), `RoleProfileStatus`(`schema.prisma:1017`).

### Образец сверялки (reader + инварианты)

- **Reader read-only:** каркас `probe-stand/stand.ts:8-70` (`createPrismaClient` → `findMany{where:{tenantId:STRELA_ORG}}`, отчёты в `docs/testing/*-report.{md,json}+runs/`). `layer0-match` копирует: `findMany` по `skillProfile/skillTrait/executablePersona`, вердикты в manifest+report.
- **Детерминированные ассерты (без LLM):** `checkInvariants(fixture,resp)` — `run-skill-trait-detect-golden.ts:51-108`: проверяет `forbiddenWords`, `categoryKeywords`, `statementContainsQualifier` (qualifier «похоже/склонен/обычно»), `expectedConfidence`, **`sourceBlockIds⊂input`**, длины. Прямой образец derivation-линзы Слоя 0.
- **Гранулярность якоря клона отличается от графа:** граф 1:1 (предложение→блок), клон **N:1** (кластер 3-5 свидетельств → 1 выведенная черта, cosine ≥0.78). `layer0-annotate` НЕ копирует batch1.json один-в-один.

**ВНИМАНИЕ:** смоук-скрипты `backend/scripts/eval/smoke-*.ts` **НЕ читают базу клона** — гоняют LLM-промпт на JSON-фикстурах `test/eval/smoke-all-agents/fixtures/${taskType}.json`. Это промпт-golden, НЕ Слой 0. Читалку базы строить по `probe-stand/stand.ts` + `batch-recall-trace.ts`.

---

## Фаза 1 — раннер run + трасса

### Три точки, по которым бьёт раннер оси L (ask* сигнатуры + форма ответа)

- **`askPerson({tenantId,requesterUserId,personId,question,conversationId?})`** — `backend/src/modules/clones/services/clones.service.ts:99` → `AskCloneResponseDto`. При `isCloneV2Enabled()` (`clones.service.ts:591`, `cfg.cloneV2?.enabled===true`) → `askPersonV2`, иначе V1.
- **`askRole({tenantId,requesterUserId,roleId,question,conversationId?,roleVersion?})`** — `clones.service.ts:343` → `AskCloneResponseDto`. V2→`askRoleV2`, иначе V1.
- **`askAllFormers({tenantId,requesterUserId,roleId,question})`** — `clones.service.ts:1880` → `AskAllFormersResponseDto`. `executablePersona.findMany(scope:'role', status in ['active','frozen'], orderBy [roleVersion desc, snapshotAt desc], take 8)` → цикл `askRoleV2` per version. **ВСЕГДА зовёт askRoleV2** (`clones.service.ts:1931`), игнорируя `CLONE_V2_ENABLED`.
- **Форма ответа `AskCloneResponseDto`** — `backend/src/modules/clones/dto/clones.dto.ts:30`: `{conversationId, messageId, text, citations:CloneCitationDto[], mode:'clone_style', isOwner, refused?, refusalReason?}`. **DTO-поле `mode` всегда литерал `'clone_style'`** — это НЕ factual/judgmental (тот живёт только в `llmMeta`). `AskAllFormersResponseDto/AskAllFormersAnswerDto` — `clones.dto.ts:184`.
- **Модуль:** `backend/src/modules/clones/clones.module.ts` — `@Global`, `ClonesService` глобальный провайдер (отдельного импорта модуля не нужно).

### Точка расширения `llmMeta` для оси L (файл:строка, что в скоупе)

- **`askRoleV2` — ГЛАВНАЯ точка вставки:** блок `llmMeta` — `clones.service.ts:1006-1020`. Текущая форма (`clones.service.ts:1006`): `{model, inputTokens, outputTokens, tier|null, personaVersion, scopeKind:'role', roleId, cloneV2:true, mode, dialogIntent, dialogConfidence, dialogQueriesCount, practiceSkillsCount}`. **В скоупе уже есть:** `applicableRegulationsV2` (`CloneRespondRegulation[]`: kind/name/text/severity/scope), `retrievedSkillsV2Role` (id/status/trigger/steps/redFlags), `subgraph.reasoningBlocks` (id), `citations` (blockId), `dialog.queries`. Добавить: `usedBlockIds:number[]` (`subgraph.reasoningBlocks.id ∩ citations`), `usedRegulationNames:string[]` (`applicableRegulationsV2.map(r=>r.name)`), `usedSkillIds:string[]` (`retrievedSkillsV2Role.map(s=>s.id)`), `topicMatchedBlocks`.
- **`askPersonV2` — симметрично:** блок `llmMeta` — `clones.service.ts:773-785` (`clones.service.ts:773`). В скоупе: `retrievedSkillsV2`, `subgraph.reasoningBlocks`, `citations`, `dialog.queries`. **Регламентов у персоны нет** (`retrieveRoleRegulations` не зовётся) — `usedRegulationNames` только для роли.
- **V1-форма** — `clones.service.ts:301` (person) / +`scopeKind/roleId` для `askRole@550`: `{model, inputTokens, outputTokens, tier|null, personaVersion, practiceSkillsCount}`. Без `cloneV2/mode/dialog*`. Раннер различает V1/V2 по наличию ключа `cloneV2`.
- **`persistMessage({...,llmMeta:Record<string,unknown>})`** — `clones.service.ts:2604`. `assistant.llmMeta = args.llmMeta as Prisma.InputJsonValue` (`clones.service.ts:2665`) — **свободный JSON, расширение оси L НЕ требует миграции Prisma**. Создаёт `chatV2Conversation` с `channelKindOrigin:'web'`, `chatV2Message.mode:'clone_style'` (фикс). Читать режим (factual/judgmental) из `chatV2Message.llmMeta.mode`, НЕ из DTO.
- **`callCloneRespond({...,mode?,practiceSkills?,applicableRegulations?})`** — `clones.service.ts:2520`. Единственный LLM-вызов клона. `applicableRegulations`+`practiceSkills`, переданные сюда = именно то, что «вошло» в промпт. `taskType:'clone-respond'`, `dataClass:'internal'` (фикс маршрутизации). `LlmCallResult` — источник полей `llmMeta.model/inputTokens/...` — `backend/src/modules/ai/services/llm-router.service.ts:1167`.
- **Подграфы:** `loadPersonSubgraph` — `clones.service.ts:2156` (mentions `take 40` **без orderBy** → недетерминированный пул, затем `ideaBlock take 20 orderBy createdAt desc`); `loadRoleSubgraph` — `clones.service.ts:2279` (`take 60` без orderBy). `usedBlockIds = subgraph.reasoningBlocks.id ∩ citations`. `parseCitations` — `clones.service.ts:2559`.
- **Гейты (важны для трассы):** `assertTopicDensity` — `clones.service.ts:2415` (порог `cloneTopicSimilarityThreshold=0.7`, `requiredBlocks=cloneTopicMinBlocks=2`; **FAIL-OPEN** трижды при недоступном embedder; `topic*`-поля пишутся в llmMeta ТОЛЬКО при отказе — `persistTopicStarvedRefusal@1214`). `isUngrounded(citations,mode)` — `clones.service.ts:1243` (judgmental → false; `!cloneRespondGroundingEnabled` → false; иначе `citations.length===0`→true). `intentToMode` — `clones.service.ts:1168` (exploratory|analytical→judgmental). `MIN_TRAITS_FOR_ANSWER=3` — `clones.service.ts:62` (хардкод, только person, `<3 traits`→`starved_profile` до LLM). `logCloneQuery` — `clones.service.ts:2671` (журнал `CloneQueryLog`, отдельного файла нет).

### Паттерн прогона (скелет раннера — `backend/scripts/batch-recall-trace.ts`)

- **Bootstrap:** `main()` — `batch-recall-trace.ts:132`: `NestFactory.createApplicationContext(AppModule,{logger:['error']})` → `app.get(DialogService)`, `app.get(ChatV2OrchestrationService)`. (Образец headless-boot — `withApp` в `probe-stand/stand.ts:91`: `createApplicationContext` + try/finally `close`, динамический `import('../../src/app.module')`.)
- **`assertNotProd`** — **ОТСУТСТВУЕТ в batch-recall-trace И в probe-stand** (см. дрейф). ТЗ-0 добавляет из `combat-harness.ts:91`.
- **ORG из ENV:** в `batch-recall-trace.ts:8` **захардкожен** `ORG='cmr1qbvpx0001pwbwxbgmh1jl'`, `USER='cmqxh4za3000018bwpuy1whg3'`. probe-stand читает `STRELA_ORG` правильно (`stand.ts:12`). **ТЗ-0 читает `STRELA_ORG` из ENV** (пере-сев меняет org id).
- **CONCURRENCY:** `CONCURRENCY=3` (`batch-recall-trace.ts:8`) — пул воркеров через общий idx-курсор для singles. Наследовать ≤3 (не перегружать LLM).
- **conversationId / история на цепочку:** `processOne` — `batch-recall-trace.ts:20`. `dialog.process({...,conversationId:null,historyOverride:history})` + `orch.askEphemeral({...,collectTrace:true})`. **`conversationId=null` всегда** (эфемерно), но `history` (`Msg{role,content}`, `batch-recall-trace.ts:18`) протягивается для цепочек. `main` группирует по `chain`, сортирует по `turn`, гонит **последовательно** с накоплением (`fresh hist=[]` на каждую цепочку). `honest = текст содержит HONEST ∨ needsClarification ∨ (usedBlockIds пусто && cites пусто)`.
- **Per-run файлы:** `flush()` пишет `OUT` инкрементально после каждой записи. `BANK`/`OUT` в scratchpad. Образец timestamped-снапшота — `writeReport` в `probe-stand/stand.ts:262` (`stamp=ISO.slice(0,16), T→'-', первый ':' убран`; каталог `RUNS_DIR`).
- **Чистка кэшей/дедупов — точные ключи:**
  - **Answer-cache:** `AnswerCacheService.buildKey` — `backend/src/modules/dialog-layer/services/answer-cache.service.ts:42`: `KEY_PREFIX='dlg:ans'`, ключ `dlg:ans:${tenantId}:${userId}:${sha256(...).slice(0,32)}`. Чистить `invalidateTenant(STRELA_ORG)` (SCAN+DEL `dlg:ans:<tenant>:*`). TTL `ANSWER_CACHE_TTL_SECONDS=86400` (`env.schema.ts:593`).
  - **Redis-dedup probe (образец pattern-scan):** `modeTrigger` в `probe-stand/stand.ts:325`: `redis.client.keys('consistency:dedup:${STRELA}:*')` → `del(...keys)`. **Знает ТОЛЬКО этот формат** — `task-clarify`/`method-capture` дедупы не чистит.
  - **Probe dedup/ratelimit:** `probe:dedup:<STRELA_ORG>:*` (TTL 72ч), `probe:ratelimit:*`, `probe:engagement:*`, `probe:cooldown:<tenant>:*` (`probe.service.ts:148`, `probe-fatigue.util.ts:7`).
  - **BullMQ rebuild dedup:** `enqueueRebuildSkillProfile` — `backend/src/modules/core-queue/core-queue.service.ts:646`: jobId `skill-profile-rebuild_<profileId>`, очередь `core.skill-profile-rebuild`, `delay=delayMs??cfg.skill.rebuildDebounceMs??60000`. Стенд зовёт с `delayMs=0` (обход дебаунса `SKILL_REBUILD_DEBOUNCE_MS`, `env.schema.ts:563`).
- **ДРЕЙФ:** `batch-recall-trace` **НЕ чистит answer-кэш/bull-дедупы перед прогоном** (изоляция только через `askEphemeral conversationId=null`). SCRATCH-пути захардкожены на **чужой session-id** (`82c87a6d-...`) — пересобрать под сессию ТЗ-0.

---

## Фаза 2 — судьи + report

### `directLlmCall` — сигнатура, модель, JSON через tool-call

- **`directLlmCall(opts:DirectCallOpts)`** — `backend/scripts/_lib/llm-direct.ts:207` → `DirectCallResult` (`llm-direct.ts:38`: `{provider,model,text,toolCallArgs:string|null,tokensIn,tokensOut,cachedTokens,ms,error:string|null}`). Опции (`llm-direct.ts:26`): `{provider:'deepseek'|'openai-proxy', model, system, user, schema?, schemaName?, toolName?, maxTokens?(деф 4000), reasoningEffort?}`. deepseek→`chat.completions` + `tools`+`tool_choice='auto'` (schema→function, результат в `toolCallArgs`); openai-proxy→`responses` + `json_schema` strict (результат в `text`). **Ошибки не бросаются** — в `result.error`.
- **Модель судьи:** `JUDGE_MODEL='deepseek-v4-pro'` — `backend/scripts/probe-stand/judge.ts:33`. Согласуется с LLM-routing-standard (DeepSeek primary, не Opus).
- **`buildClient`** — `llm-direct.ts:50` (ключи из ENV). `computeDirectCost` — `llm-direct.ts:66`.

### JSON-схема через tool-call + majority-of-3

- **Образец судьи:** `judgeProbe(input:JudgeInput)` — `backend/scripts/probe-stand/judge.ts:160` → `JudgeVerdict`. `JUDGE_SCHEMA`/`GAPS_SCHEMA` — `judge.ts:73` (`as const, additionalProperties:false, все поля required`). `toolName 'judge_probe'`. `judgeGaps` — `judge.ts:179` (обратная проверка пробелов, `maxItems 5`).
- **`llmJson<T>({system,user,schema,toolName,validate})`** — `judge.ts:127`: `for attempt 1..3: directLlmCall(provider:'deepseek',model:JUDGE_MODEL,maxTokens:2500); raw=res.toolCallArgs ?? res.text; JSON.parse(extractJson(raw)); validate(...) иначе throw`.
- **`extractJson(raw)`** — `judge.ts:119`: срезает ```` ```json ```` fences, берёт от первого `{` до последнего `}`. Спасает при text-ответе (fallback `res.toolCallArgs ?? res.text`).
- **`loadFieldRules()`** — `judge.ts:44`: грузит рубрику из `docs/testing/probe-field-rules.md` с встроенным `FIELD_RULES_FALLBACK`; встраивается между маркерами `=== ПОЛЕ ПРАВИЛЬНОСТИ ===`.
- **КРИТИЧНО для majority-of-3:** `llmJson` — это **retry×3 до первого schema-valid ответа, НЕ N-голосование**. Если ТЗ-0 требует majority-of-3 — **это новая надстройка поверх `directLlmCall`** (3 независимых вызова + выбор большинства), не копирование `llmJson`. См. Констатацию дрейфа.

### Промпты-прецеденты (пути + пороги)

- **Линза M — `persona-behavior-judge`:** `backend/src/modules/knowledge-core/prompts/persona-behavior-judge.prompt.ts`. `PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT` (`:1`) — рубрика-шкала (`:17-20`): **1.0** ход совпадает по сути (те же шаги/критерии); **0.5** частично (направление верное, шаги другие); **0.0** противоположный/выдуманный. Спец-якорь **0.3** (`:29`) — честный отказ при реально существовавшем ходе (НЕ промежуток шкалы); **0.0–0.2** — уверенный но неверный ход. Запрещено учитывать характер/стиль/длину. `USER_TEMPLATE` (`:32`, лимиты обрезки: caseSituation 400, actualMove 1200, answerA/B 2000). `JSON_SCHEMA` `persona_behavior_judge_v1` (`:56`): `{scoreA:0..1, scoreB:0..1, behaviorMatchA:3..500, behaviorMatchB:3..500}`, все required. `SCHEMA_NAME` (`:92`). **Парная оценка A/B**, не одиночный score.
- **Линза G — `RAG_GROUNDEDNESS_LENIENT`:** `backend/src/modules/knowledge-core/prompts/rag-pipeline.prompts.ts`. `RAG_GROUNDEDNESS_LENIENT_SYSTEM_PROMPT` (`:114`) — «мягкий контролёр заземления», JSON `{grounded, reason, fabricated}`. **Критерий `fabricated=true`** (`:116-119`) ТОЛЬКО если: (1) конкретный факт (имя/число/дата/решение/статус «готово») вне блоков или противоречащий; ИЛИ (2) приписан статус-итог «готово/завершено/решено/закрыто/не блокирует» без опоры; ИЛИ (3) приписан провенанс (кто предложил, на какой встрече). Неполнота/осторожные формулировки/честное «не нашёл» → `fabricated=false`. **Ключевое поле — `fabricated`**, не `grounded` (оставлен «для совместимости»). Строгий вариант `RAG_GROUNDEDNESS_SYSTEM_PROMPT` (`:111`) — без `fabricated`. `RagGroundednessSchema` (`:122`, zod: `fabricated` optional). Потребитель — `chat-v2.service.ts:498`.
- **Клон-ответ (генерация, не судья):** `backend/src/modules/knowledge-core/prompts/clone-respond.prompt.ts`. `buildCloneRespondSystemPrompt({mode})` (`:94`, дефолт factual). FACTUAL (`:1`/`:42`) — правило №6 (`<2 reasoning-блоков`→отказ фикс.фразой), требует цитаты `[BLOCK:id]`. JUDGMENTAL (`:44`) — по аналогии, БЕЗ `[BLOCK:id]` в тексте. `CLONE_RESPOND_USER_TEMPLATE` (`:124`, reasoningBlocks обрезка до 600 симв).
- **Структура персоны (что сверять в Слое 0):** `backend/src/modules/knowledge-core/prompts/executable-persona-compile.prompt.ts`. Актуальна **v2** (5 секций): `EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT` (`:70`), `V2_USER_TEMPLATE` (`:102`), `V2_PROMPT_NAME='executable_persona_compile_v2'` (`:192`). v1 (`:1`) — устарел, в baseline НЕ использовать.

### Форма отчёта (образец — `backend/scripts/analyze-recall-results.ts`)

- `Rec` — `analyze-recall-results.ts:7` (схема per-run записи; раннер обязан держать эти поля). `classify(r)` — `analyze-recall-results.ts:35` → `'ok_empty'|'false_empty'|'answered'|'error'` (**`false_empty` — главная метрика провала**: данные есть, отказ). `main()` — `analyze-recall-results.ts:41` (7 блоков: ошибки; ПОИСК путь дверь→рёбра; РАСПОЗНАВАНИЕ СУЩНОСТИ; ИТОГ ПО ИСХОДУ; ПО УГЛАМ; КОНТРОЛЬНЫЕ ПАРЫ канон↔синоним; ЦЕПОЧКИ; ГЛАВНЫЕ ПРОВАЛЫ; латентность).
- Образец записи 3 артефактов (сводный MD+JSON+timestamped per-run): `writeReport` — `probe-stand/stand.ts:262`.

---

## Конфигурация прогона (зафиксировать в отчёте)

Точные имена/дефолты (ENV — `env.schema.ts`; крутилки — через AdminSetting admin→ENV→code).

| Ключ | Дефолт | Якорь | Слой | Действие стенда |
|---|---|---|---|---|
| `CLONE_V2_ENABLED` | **false** (единственный OFF) | `env.schema.ts:579` (`cfg.cloneV2.enabled`, `typed-config.service.ts:1397`) | ENV (плейн, без AdminSetting) | **ЯВНО включить** для v2-ветки; иначе `askPerson/askRole`→V1 (без dialog-layer, mode всегда factual). `askAllFormers` всегда V2. |
| `CLONE_TOPIC_SIMILARITY_THRESHOLD` | 0.7 | `env.schema.ts:565` (`typed-config.service.ts:1366`) | ENV (плейн) | Держать дефолт / пинить явно. Порог `assertTopicDensity`. |
| `CLONE_TOPIC_MIN_BLOCKS` | 2 | `env.schema.ts:566` | ENV (плейн) | `requiredBlocks` анти-deepfake. |
| `CLONE_RESPOND_GROUNDING_ENABLED` | true | `env.schema.ts:567` | ENV (плейн) | Держать ON (grounding — часть поля правильности). |
| `PERSONA_ROLE_AGG_MIN_PERSONS` | 2 | `env.schema.ts:608` = AdminSetting `knowledge.personaRoleAggMinPersons` (registry:121) | крутилка | Опустить до 1 на одном носителе. |
| `PERSONA_MIN_TRAITS` | 3 | `env.schema.ts:607` = `knowledge.personaMinTraits` (registry:120) | крутилка | Опустить для baseline на малых данных. |
| `PERSONA_BUILD_CRON` | `0 6 * * SUN` | `env.schema.ts:606` | ENV | Не ждать крон — дёргать rebuild напрямую. |
| `SKILL_REBUILD_DEBOUNCE_MS` | 60000 | `env.schema.ts:563` (`cfg.skill.rebuildDebounceMs`) | ENV | Rebuild с `delayMs=0` обходит дебаунс. |
| `ANSWER_CACHE_TTL_SECONDS` | 86400 | `env.schema.ts:593` (`cfg.dialogLayer.answerCacheTtlSeconds`) | ENV | Инвалидировать `dlg:ans:*` между прогонами. |
| `probe.dedupTtlHours` | 72 | `typed-config.service.ts:1217` (`PROBE_DEDUP_TTL_HOURS`, registry:264) | крутилка | Чистить `probe:dedup:*` перед probe-прогоном. |
| `probe.rateLimitPerHour` | 5 | `typed-config.service.ts:1217` (`PROBE_RATE_LIMIT_PER_USER_PER_HOUR`, registry:265) | крутилка (resolveSync) | Поднять / чистить `probe:ratelimit:*`. |
| `probe.rateLimitPerDay` | 20 | (`PROBE_RATE_LIMIT_PER_USER_PER_DAY`, registry:266) | крутилка (resolveSync) | То же. |
| `probe.coldStartModeHours` | 24 | `PROBE_COLD_START_MODE_HOURS` | крутилка | Ставить 0 или старить тенант (иначе первые 24ч → digest). |
| `probe.semanticDedupEnabled` | true | registry:254 | крутилка | Снять или варьировать текст (иначе масс-сев→DEDUP). |
| `probe.semanticDedupThreshold` | 0.92 | registry:256 | крутилка | — |
| `probe.semanticDedupWindowHours` | 72 | registry:257 | крутилка | — |
| `probe.dialogEnabled` | true | registry:279 (AdminSetting без ENV) | крутилка | Пост-dispatch clarify, НЕ гейт подъёма. |
| `probe.adaptiveFatigueEnabled` | true | `getDynamic` (`probe.service.ts:528`) | крутилка | Отключить / чистить `probe:engagement:*` для стабильного baseline. |
| `minValuePriority` | 30 (code-fallback) | `probe.service.ts:275` | крутилка (**НЕ в registry**) | method_capture=70 проходит. |
| `immediatePushMinPriority` | 70 (code-fallback) | `probe-dispatcher.worker.ts:144` | крутилка (**НЕ в registry**) | method_capture=70 проходит ВПРИТЫК (строгое `<`). |
| `tracker.methodCaptureMinComplexity` | 0.5 | `issues.service.ts:1315` (registry:453) | крутилка | Опустить до 0 для наполнения. |
| `tracker.methodCaptureEnabled` | true | registry:452 | крутилка | Держать ON. |
| `tracker.methodCapturePriorityHint` | 0.7 | registry (→priority 70) | крутилка | Не снижать (<0.7→queued_digest). |
| `knowledgeClone.profileMinConfidence` | 0.55 | seed `seed-admin-setting-clone-coverage.ts:20` (registry:140) | крутилка | Сеять через seed. |
| `clone.regulations.retrieval.top_n` | 6 | `seed-admin-setting-clone-regulations.ts:18` (registry:136) | крутилка | Сеять. |
| `clone.regulations.retrieval.min_similarity` | 0.3 | (registry:137) | крутилка | Сеять. |
| `clone.regulations.snapshot.max_items` | 20 | (registry:138) | крутилка | Сеять. |
| `clone.regulations.scope.include_org` | true | (registry:139) | крутилка | Сеять. |
| `knowledge.skillProfileMinObservations` | fallback `SKILL_MIN_OBSERVATIONS=5` | `specialist-3-7-skill.service.ts:314` (**НЕ в registry**) | getDynamic | Опустить на малых данных (через ENV/raw AdminSetting). |
| `knowledge.skillClusterMinObservations` | 3 | `specialist-3-7-skill.service.ts:326` (**НЕ в registry**) | getDynamic | То же. |
| `AI_CHAT_DAILY_LIMIT_ADMIN` / `_MEMBER` | 50 / 20 | `env.schema.ts:191-192` = `aiChatQuota.dailyLimitAdmin/Member` (registry:518-519, `typed-config.service.ts:1420`) | крутилка | Поднять/снять, чтобы baseline не упирался в квоту. |
| `STRELA_ORG` | `cmr1qbvpx0001pwbwxbgmh1jl` | `seed-fixtures.ts:3`, `stand.ts:12` (**НЕ в env.schema**) | plain process.env | Выставлять явно (пере-сев меняет id). |

### LlmTaskRoute (seed-цепочки, `tenantId=null` глобальные)

- **clone-v2:** `backend/scripts/seed-llm-task-routes-clone-v2.ts:15` — `dialog-multi-query-clone` (primary deepseek-v4-pro / secondary gpt-5.4-mini / tertiary qwen3.5:9b), **`clone-respond` (primary deepseek-v4-pro)**.
- **clone-method:** `backend/scripts/seed-llm-task-routes-clone-method.ts:19` — 5 taskType: `role-principle-synthesize` (pro/gpt-5.4/qwen3:30b), `value-motivation-detect` (flash/mini/qwen3.5:9b), `process-marker-detect` (flash/mini/qwen3.5:9b), `cdm-case-interview` (pro/gpt-5.4/qwen3:30b), **`persona-behavior-judge` (flash/mini/qwen3.5:9b)**.
- **skill-and-clone:** `backend/scripts/seed-llm-task-routes-skill-and-clone.ts:25` — `skill-trait-detect` (**PINNED** deepseek-v4-pro, golden-2026-05-25), `skill-trait-merge/verify` (flash/mini/qwen3:30b), `executable-persona-compile` (flash/mini/qwen3:30b), **`clone-respond` (primary deepseek-v4-FLASH)**.
- **КОНФЛИКТ:** `clone-respond` primary определён ДВАЖДЫ на один route-ключ `(taskType,tenantId=null,tier=primary,provider=deepseek)`: **pro** (clone-v2 seed) vs **flash** (skill-and-clone seed). Кто применён последним/с `--update-existing`, тот победил. **Стенд обязан зафиксировать реально применённую модель**, иначе baseline недетерминирован. Все seed защищают admin-edited (`editedByAdmin===true` не перезаписывается).

---

## Констатация дрейфа (код ≠ аудит — критично для точности ТЗ)

**Прод-safety / boot:**
- **`assertNotProd` ОТСУТСТВУЕТ** в `probe-stand/stand.ts`, `seed-fixtures.ts`, `batch-recall-trace.ts`. Prod-safety только косвенная (ENV указывает на локальную БД). **ТЗ-0 добавляет явный `assertNotProd` из `combat-harness.ts:91`** — образца в probe-stand нет.
- Harness (`combat-harness.ts`) **НЕ поднимает AppModule** — работает через прямой Prisma+BullMQ Queue; обработку делает отдельный живой backend. Раннеры run (`batch-recall-trace.ts`), напротив, сами boot'ят AppModule.

**Судья:**
- **`majority-of-N` НЕ реализован.** `llmJson` (`judge.ts:127`) — retry×3 до первого schema-valid ответа, НЕ N-голосование. Majority-of-3 = новая надстройка над `directLlmCall`.
- Модель судьи `deepseek-v4-pro` (не Claude/Opus). `directLlmCall` **не имеет `temperature`** — для openai-proxy используется `reasoningEffort`.

**CLI-режимы:**
- Режимы probe-stand НЕ совпадают с ТЗ-0 (`prepare|build|status|run|judge|report|all`). Фактические: `catalog|harvest|report|report:nollm|trigger|scenario:method-capture|scenario:task-clarify|all`. Диспетчер — простой `switch(process.argv[2])`, не парсинг флагов.
- **Подготовка стенда (seed) — ОТДЕЛЬНЫЙ скрипт `seed-fixtures.ts`, не режим `prepare`** внутри раннера.

**Клоны / llmMeta:**
- `askAllFormers` **ВСЕГДА зовёт `askRoleV2`** (`clones.service.ts:1931`), игнорируя `CLONE_V2_ENABLED`; `isCloneV2Enabled` разводит только `askPerson/askRole`.
- Пороги `CLONE_TOPIC_*`/`CLONE_RESPOND_GROUNDING_ENABLED`/`CLONE_V2_ENABLED` читаются **плейн `this.get(ENV)`** (`typed-config.service.ts:1366-1368/1397`), БЕЗ `resolveSync/AdminSetting` — чистые ENV, **нарушение принципа №9** (соседние `knowledge.*` идут через resolveSync). Раннер меняет их только через `.env`/рестарт.
- `llmMeta` успешного пути **НЕ содержит** `usedBlockIds/usedRegulationNames/usedSkillIds/topicMatchedBlocks` — `topic*` пишутся ТОЛЬКО при отказе. Ось L добавляет их вручную.
- DTO-поле `mode` всегда `'clone_style'` (брендинг), НЕ режим генерации — режим читать из `chatV2Message.llmMeta.mode`.
- Разные механизмы доступа V1/V2: `askPerson` V1→`this.canAccessPersonClone`, V2→`rbac.canAccessPersonClone`; `askRole` V1→`rbac.check(obj:'role')`, V2→`rbac.canAccessRoleClone`.

**Канал Б:**
- Отдельного `seed-clone-feed.ts` **НЕ существует** — ТЗ-0 создаёт (реюз `respondToProbe`/`ingestNotificationResponse`/`dispatchInbound`).
- **Атрибуция автора клона — через `RawEvent.payload.userId`=`recipientUserId`** (`tryGetActorIdentity`), НЕ через `ProbeEvent.subjectPersonId` (**такого поля в ProbeEvent НЕТ**). `subjectPersonId` живёт только в `SendNotificationInput` (роутинг каналов). `NotificationRespondedPayload` (`probe.types.ts:41`) — без `subjectPersonId`.
- `respondToProbe` сигнатура — три поля `{notificationId,userId,payload}`. **`dialogEnabled`/`expiresAt` НЕ параметры** `respondToProbe`: `expiresAt` проверяется по записанному `notif.expiresAt`; `dialogEnabled` = `cfg.probe.dialogEnabled`, обрабатывается в `ProbeResponseHandler`.
- `signalTypeHint='reasoning'` привязан к `skill.cdm_interview` **И** `task.method_capture` (два reason, не один).
- Провенанс-гейт `resolveProbeProvenance` (`probe-reason-policy.ts:55-60`) — **заглушка, всегда `'unknown'`** → `suppressOnUnconfirmedAuto` недостижим (no-op).
- `minValuePriority`(30) и `immediatePushMinPriority`(70) **НЕ в admin-setting-schema-registry** — только `getDynamic` code-fallback.

**Слой 0:**
- Моделей **`KnowledgeProfile` и `RoleClone` в schema.prisma НЕТ** (устаревшие имена). Клон роли = `ExecutablePersona(scope=role)`+`RoleProfile`+`RolePrinciple`; клон человека = `SkillProfile(1:1 Person)`+`SkillTrait`+`ExecutablePersona(scope=person)`.
- Смоук-скрипты `eval/smoke-*.ts` читают **LLM-фикстуры, НЕ базу** (промпт-golden). Реальную читалку строить по `probe-stand/stand.ts` + `batch-recall-trace.ts`.
- Манифест имеет ДВЕ формы блока: annotate (batch1: `agreement`, `author`) и match (batch2/3: `verdict`, `baseType`); `sourceQuote` **отсутствует** (есть `gist`+`author`), `expectedType` называется `signalType`.
- `SkillTrait.category` — двойное поле (deprecated string + FK `categoryId→SkillTraitCategory`); `conceptId` может быть null до backfill.
- `SkillTraitLayer`(skill|value|motivation|process_marker), `RolePrinciple`/`PracticeSkill`/`SkillTraitConcept` — новые слои после исходного аудита; persona-compile v2 секционирует по layer.
- Целевые `layer0-annotate.ts`/`layer0-match.ts`/`clone-feed-manifest.json` (`backend/scripts/clone-stand/`) **ещё НЕ созданы**.

**Фаза 0а:**
- **Слияние Елена→Игорь — дрейф памяти vs код:** в `seed-synthetic-company.ts:185` оба — отдельные employee. Пере-сев с нуля устраняет проблему.
- **`RoleAssignment` как модели НЕТ** — назначение через `PersonRole`(legacy) И `Appointment`(replacement). Событие `role.bearer_changed` эмитится ТОЛЬКО из `AppointmentsService`, НЕ из PersonsService.
- Два источника носителя: `buildForRole` читает `PersonRole(validTo=null)`, `maybeEmitBearerChanged` — `Appointment(validTo=null)`. Смена только через PersonRole событие НЕ вызовет.
- `patch-clones-role-versioning.ts` использует голый `new PrismaClient()` (нарушение канона).
- `MIGRATION_COSINE_MIN=0.85` захардкожен в backfill (не крутилка).

**Окружение / хардкоды:**
- `ORG`/`USER` в `batch-recall-trace.ts:8` захардкожены (не `STRELA_ORG`). SCRATCH-пути на чужой session-id `82c87a6d-...`.
- `CONCURRENCY=3`, порог `traits>=2` (`clone-build-harness.ts`), `verifyTimeoutMs=90000`, `sleep(400/5000)` — магические числа в dev-скриптах.
- Банк вопросов раннера = `SCRATCH/strela-recall-questions.json` (вопросы), НЕ `gold/strela-manifest.batch*.json` (anchor-блоки) — разные артефакты; сам банк вопросов в git отсутствует (живёт в scratchpad).
