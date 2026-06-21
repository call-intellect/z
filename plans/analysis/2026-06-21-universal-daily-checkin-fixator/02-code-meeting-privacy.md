---
type: analysis
status: research-input
feature: universal-daily-checkin-fixator
date: 2026-06-21
snapshot_date: 2026-06-21
segment: код — мост встреча→чек-ин, кто пишет в DailyCheckIn, приватность групп, cron-добор, конфиг betaOps
---
# Код Z: мост встречи, приватность групповых чатов, cron-образец

## 1. meeting-extract-actions — извлечение по участнику и резолв
**Файл:** `tracker/services/meeting-extract-actions.service.ts`
- Извлечения «план/итоги на день по участнику» рядом **НЕТ**. Только задачи `tasks[]` через `taskType:'meeting-extract-actions' :192-241`; схема `:204-234` = `title/assignee/dueDate/suggestedPriority/sourceQuote/confidence`. Пишет в `IntakeIssue`, не в чек-ин.
- Резолв участника **в userId, не personId**: `ParticipantContextService.loadForMeeting :148` → `AiParticipantContext` с `userId` (если isRegisteredUser&&userId), `personId` НЕ выставляется (`ai/services/participant-context.service.ts:31-41`). `TaskAssigneeResolverService.resolve :310-320` → `assigneeUserId` (матч по имени среди участников; тёзка/гость → null).
- Реплики→personId: в tracker-сервисе связи на personId нет. `DialogTurn` (`ai/services/prompts/common.ts:5-12`) несёт `speaker, speakerParticipantId?, speakerLivekitIdentity?`. **Мост speaker→personId в knowledge-core:** `resolveSubjectPersonId` грузит `Participant.personId :1156-1161` → значит у `Participant` есть `personId`. Цепочка для будущего моста: turns по `speakerParticipantId` → `Participant.personId` → `DailyCheckIn.personId`. Частично реализована в `SegmentBuilderService` (`speakerParticipantId` в блоки `:19/294/339`).

## 2. Кто пишет в DailyCheckIn
Греп `dailyCheckIn.(create|upsert|update)` по backend — **из встречи никто не пишет**. Писатели:
- Основной upsert: `daily-checkin.service.ts:291`, ключ `tenantId_personId_kind_dateLocal :292-298`, source `cron_prompted|self_initiated|manual :251`. **Ключ по personId, не userId** (расхождение с резолвом п.1, который в userId).
- sentiment: `checkin-sentiment-analyzer.worker.ts:76`, `checkin-sentiment-batch.cron.ts:190`.
- качество: `reflection-quality-scorer.cron.ts:85,123`.
- demo: `onboarding/demo-data/operations.ts:1051,1069`.
- Заполнение из канала (Telegram-ответ) → `checkin-ingest.service.ts` → `daily-checkin.service`; ingest кормит граф `SOURCE_TYPE='daily_checkin'`.
- Остальные ~15 файлов — только findMany/count/groupBy (дашборды/агенты).

## 3. Приватность / 152-ФЗ / группы в conversational/telegram
- Обработки `chat.type` (group/supergroup) **НЕТ** — грепы `chat.type|supergroup|'group'|isGroup` по conversational/ = 0. Бот не различает личку и группу.
- Binding строго по `from.id` (`telegram-bot.adapter.ts`): `tgUserId = msg.from?.id :172`; нет from.id (channel post) → игнор `:174-178`. `requireVerifiedBinding :903-922`: `channelBinding.findFirst({channelId, externalId:tgUserId})`; `!binding||!verifiedAt` → метрика `no_binding`, ответ «Аккаунт не привязан», `return null` (в граф не попадает). Тенант через `Membership` `:181-197`, не через чат.
- Сообщение от непривязанного → игнор + бот шлёт «не привязан» (в группе — потенциальная privacy/UX-проблема для группового добора).
- dataClass: статические литералы. Входящий ingest по умолчанию `'internal'` (`conversational-ingest.adapter.ts:43,88,111`); `conversational.service.ts:118` `dataClass ?? 'internal'`, chat-reply дефолт `'sensitive' :275`; telegram task-parser/digest жёстко `'internal'`. Consent/фильтра по типу чата/повышения dataClass для group — нет.

## 4. Cron-образец для «добора раз в сутки»
- **`telegram-digest.cron.ts`** (ближайший образец): `@Cron('0 * * * *') :44`; `channelBinding.findMany({verifiedAt:{not:null}, channel:{kind:'telegram_bot',status:'active'}})`, лимит `MAX_USERS_PER_RUN=5000 :23,67-74`; per-user TZ (`Person.timezone`, getLocalHour/Date), `localHour!==digestHourLocal`→skip `:86-137`; **Redis NX дедуп** `dedupKey=telegram_digest:${userId}:${tenantId}:${localDate}`, `set(key,'1','EX',25*3600,'NX')`, `!=='OK'`→deduped `:139-156` (TTL 25ч закрывает сутки); час доставки `getDynamic('conversational.telegramDigestHourLocal','TELEGRAM_DIGEST_HOUR_LOCAL',9) :219-233`.
- **`email-fetch.cron.ts`** (добор из внешнего источника): `@Cron('*/5 * * * *')`+`this.running` guard `:24-33`; `Source.findMany({type:'email',isActive:true})`; per-tenant `WorkerOrgGate.checkOrThrow` + `entitlements.hasFeature('feature.adapter_email')` fail-open `:54-71`; дедуп внутри `fetchOne` по messageId; флаг `cfg.emailFetch.enabled`.
- `daily-checkin-prompt.cron.ts` — итерация по Person + per-person TZ + окно morning/evening, без Redis-дедупа (опора на `hasCompletedToday`).

## 5. Конфиг betaOps — ENV или AdminSetting
**Определён `typed-config.service.ts:1413` (get betaOps()).** Смешанный:
- `dailyCheckInEnabled` — **чистый ENV** `:1415` `get('DAILY_CHECKIN_ENABLED')`, `env.schema.ts:596` zBool(true). **В admin-registry НЕТ** — несоответствие принципу 8/9 (флаг должен быть kill-switch в реестре).
- `morningLocalHour`/`eveningLocalHour` — **AdminSetting** `:1416-1424` `resolveSync('betaOps.morningLocalHour','DAILY_CHECKIN_MORNING_LOCAL_HOUR',9)`/`eveningLocalHour`(18); registry `:331`.
- Прочие resolveSync (AdminSetting): `weeklyDigestLocalHour/Day :1432-1440`, `dailyDigestHourUtc :1443-1446`, `commitmentFollowupLocalHour :1449-1452`. А `weeklyDigestEnabled/dailyDigestEnabled/commitmentFollowupEnabled` — чистые ENV (как dailyCheckInEnabled).
