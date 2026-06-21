---
type: analysis
status: research-input
feature: universal-daily-checkin-fixator
date: 2026-06-21
snapshot_date: 2026-06-21
segment: код — общая точка ingest, классификатор, парсер, атрибуция автора, AdminSetting
---
# Код Z: слой «детектор дневных сигналов» — точки интеграции

## 1. IngestService — общая точка входа всех источников
**Файл:** `backend/src/modules/ingest/ingest.service.ts`
- Сигнатура `:40` `async ingest(input: IngestEventInput): Promise<IngestResult>`. Вход `:14-21`: `{ tenantId, sourceId, sourceExternalId?, occurredAt, payload, dataClass? }`.
- Идемпотентность `:84-104`: `payloadChecksum = sha256Hex(JSON.stringify(payload))`; `dedupBasis = sourceExternalId ?? payloadChecksum`; `idempotencyKey = sha256Hex(sourceId:dedupBasis:occurredAt)`; `findUnique({where:{idempotencyKey}})` → `{rawEvent, idempotent:true}`; гонка P2002 повторно резолвится `:167-177`.
- Поля RawEvent `:131-147`: `tenantId, sourceId, sourceType(=source.type), sourceExternalId, idempotencyKey, occurredAt, payloadStorage, payload|payloadS3Key, payloadChecksum, payloadSizeBytes, dataClass, processingStatus:'received'`.
- **ОБЩАЯ ТОЧКА (кандидат на детектор):** `:148` `await this.coreQueue.enqueueRawReceived(created.id)`. Через неё проходят ВСЕ источники. `enum SourceType` (`schema.prisma:251-288`): `meeting, chat, phone_call, bot, email, web_form, external, conversational, tracker_event, chatbox, daily_checkin, meeting_report, bitrix`. Далее единая обработка — `block-ingest.worker.ts`.
- **Рекомендация места:** отдельный consumer на `CORE_QUEUE_NAMES` raw-received (как block-ingest, `block-ingest.worker.ts:24`), не синхронно в `ingest()` — не блокирует HTTP-путь, позволяет cron-переразбор.

## 2. QueryClassifierService (dialog-layer)
**Файлы:** `dialog-layer/services/query-classifier.service.ts`, промпт `dialog-layer/prompts/classify.prompt.ts`
- `DialogIntent` `:15-23` (8): `factual | exploratory | analytical | clone_roleplay | daily_plan_morning | daily_report_evening | note | probe_reply`.
- `classify(input)` `:120`; вход `:39-53` `{tenantId,userId,question,conversationId,skipHeuristicFirstPass?,openProbeQuestion?}`; выход `:55-60` `{intent,source,confidence,durationSeconds}`.
- Логика: regex-эвристика (`heuristicClassify :227`, пропускается при openProbeQuestion) → LLM `taskType:'dialog-classify'` `:163` json_schema strict → fallback `factual`.
- **Переиспользуем вне Telegram:** да, абстрактные tenantId/userId/question. Релевантные интенты: `daily_plan_morning`/`daily_report_evening`/`note`.
- **Cache-friendly:** `DIALOG_CLASSIFY_SYSTEM_PROMPT` — константа без интерполяции `classify.prompt.ts:1-153`; переменные в USER `buildClassifyUserPrompt :181-192`, `openProbeQuestion` в КОНЕЦ `:189`. Соответствует правилу Z.

## 3. CheckinParserService + DailyCheckInService
- Парсер `operations/services/checkin-parser.service.ts:12`: `parse({tenantId,kind,rawText}) → {plans[],dones[],blockers[],confidence}`, `taskType:'checkin-parse' :46`, json_object, SYSTEM из массива строк `:22-30` (стабилен).
- `daily-checkin.service.ts`:
  - `createOrUpsertManual :56` → `dateLocal = input.dateLocal ?? getLocalDate(now, personTimezone) :63`; `source:'manual'`, `parseConfidence:1`, `completed:true`, эмитит `checkin.created :82`.
  - `upsertFromParser :102` → args `{tenantId,personId,kind,dateLocal,plans,dones,blockers,notificationId,rawResponseText,parseConfidence,source}`; `MIN_CONFIDENCE=0.6 :21`; при `<0.6` обнуляет plans/dones/blockers + `curatorReview:true :115-128`.
  - Ключ upsert: `@@unique tenantId_personId_kind_dateLocal :292-298`.
- `enum DailyCheckInSource` (`schema.prisma:7076-7079`): `cron_prompted | self_initiated | manual`; колонка `source @default(cron_prompted) :7134`.
- `dateLocal`: `getLocalDate(now,timezone)` (`operations/utils/local-date.ts:25`) → `Intl.DateTimeFormat('en-CA',{timeZone})` → YYYY-MM-DD; дефолт TZ Europe/Moscow.
- Модель `DailyCheckIn schema.prisma:7103-7148`.

## 4. Атрибуция автора (Person) — критично для группы
- `block-ingest.worker.ts:768` `tryGetActorIdentity(payload) → {authorUserId,authorPersonId,authorEmail}`. Приоритет `:792-819`: `actor.userId → responsible.personId (только если НЕТ per-message авторов, hasPerMessageAuthors :783-790) → uploaderId → userId → from.address`.
- **Группа/мультиавтор:** `transcript.turns[].authorPersonId :781-790` — атрибуция per-turn/per-segment. Сегменты несут `authorPersonId` (`segment-builder.service.ts`), persist per-segment `:1083-1103,:1176-1199`.
- `entity-resolution.service.ts`: `resolveSubjectEntityId :1016`, `resolveSubjectPersonId :1114` — приоритет `authorPersonId→authorEmail→authorUserId→speakerParticipantId→speakerName`, tenant-scoped, NULL если не разрешилось. authorUserId→`person.findFirst({tenantId,userId}) :1145-1148`; authorEmail insensitive `:1132-1143`.
- Запись: `persistBlock(...authorPersonId...)`, коммит-автор `IdeaBlock.commitmentAuthorPersonId :1212`. Крутилки `knowledge.subjectAttributionEnabled :1068`, `knowledge.subjectAttributionAllTypes :189`.
- **Вывод:** детектор должен резолвить «кто отчитался» через `resolveSubjectPersonId` или per-turn `authorPersonId`, не через единичный `responsible.personId`.

## 5. AdminSetting — добавление крутилки
- Реестр `admin/settings/admin-setting-schema-registry.ts` — `Map<string,ZodTypeAny>`; хелперы `:5-7` `POSITIVE_INT, NON_NEGATIVE_INT, UNIT_INTERVAL`.
- Пример строк того же семейства: `['probe.digestHourUtc', z.number().int().min(0).max(23)]`, `['knowledge.entityMergeThreshold', UNIT_INTERVAL]`, `['knowledge.distillDebounceMs', POSITIVE_INT]`.
- Для детектора: `['daySignals.detectThreshold', UNIT_INTERVAL]`, `['daySignals.backfillHourUtc', z.number().int().min(0).max(23)]`, `['daySignals.dedupWindowMs', POSITIVE_INT]`.
- Чтение: async `getDynamic<T>(key, envFallbackKey?, default?)` `typed-config.service.ts:1743` (per-tenant override); sync `resolveSync<T>(...)` `:1806`. Пример `block-ingest.worker.ts:189` `getDynamic('knowledge.subjectAttributionAllTypes', undefined, true)`.
- Сид `scripts/seed-admin-settings.ts` — `SettingSeed{key,value,category,section,severity?} :16`, `upsertSetting :80` НЕ перетирает admin-edited (`updatedBy!=='system' :104-117`). Прецедент `backfill-subject-attribution-all-types.ts`.
- Итого: строка в registry + строка в seed + чтение getDynamic/resolveSync + UI-поле `AdminSettingField`. Прямой `process.env.*` запрещён (принцип 9).
