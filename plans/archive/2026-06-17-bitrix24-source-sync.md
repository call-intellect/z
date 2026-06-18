# ТЗ: Bitrix24 как источник — синк IM-чатов + CRM + визард

> Статус: **Этап 1 готов (Ф0–Ф6, 2026-06-17)**; Ф4b (CRM-дайджест) отложен.
> Фундамент (установка/OAuth/токены) готов —
> [ТЗ установки](2026-06-09-bitrix24-integration-install.md). Это Этап 1 из
> [next-steps](../analysis/2026-06-09-bitrix24-next-steps.md): портал → память компании.
> Модель — по образцу ChatBox-источника (мастер, сопоставление, бэкафилл, анализ).

## Решения владельца (2026-06-17)
- **«Чаты» = внутренний чат Bitrix (IM)** — переписки сотрудник↔сотрудник (`im.*`).
  Внешних клиентов нет: обе стороны — сотрудники (менеджеры↔менеджеры).
- **Объём MVP = чаты + CRM-сущности** (контакты/компании/сделки → граф знаний).

## Пересмотр 2026-06-17 (сессии-сутки + саммари + CRM-дельта)
Уточнения владельца по ходу Ф2:
1. **Сессия = окно синхронизации (сутки), «закрываем день».** Чат сквозной (бесконечный
   с одним менеджером). Каждый синк берёт новые сообщения с прошлого синка, группирует
   по календарному дню и создаёт НОВУЮ ЗАКРЫТУЮ сессию (`endedAt`) → сразу анализируема.
   **Сделано и для Bitrix (`rebuildDialogSessions`), и для ChatBox (`ChatboxSessionService.rebuildSessions`
   переведён с gap-based на день-окно — сквозной чат больше не зависает открытым).**
2. **Посуточное саммари + накопительный контекст (Ф4).** На закрытие сессии-дня —
   ОДИН LLM-вызов: вход = `накопительное саммари + сообщения дня`, выход =
   `{ саммари дня, обновлённое накопительное }`. Накопительное хранится полем
   `rollingSummary`(+`rollingSummaryAt`) на диалоге/чате; саммари дня → блок в графе
   знаний, привязанный к дню и менеджеру. (Никогда не гоним всю историю — только дельту.)
3. **CRM по суткам.** Сущности: контакты, компании, сделки, **лиды, заметки/таймлайн**.
   Дельта без событий: `crm.*.list?filter[>DATE_MODIFY]=<курсор>`. На «закрытие дня» —
   **LLM-дайджест изменений за день** → блок в графе по дню. Новые зеркала: `BitrixLead`,
   `BitrixCrmNote`; на `BitrixDialog`/`ChatboxChat` — `rollingSummary`/`rollingSummaryAt`.

## Цель
Подключить портал Bitrix24 как **источник** Коры: пошаговый визард (ввод адреса →
OAuth → сопоставление сотрудников → бэкафилл), зеркалирование внутренних IM-чатов и
CRM-сущностей, AI-анализ переписок (как ChatBox), управление на странице источника
в «Админка компании → Источники».

## Ключевые отличия от ChatBox
- Коннект — **OAuth, не токен**: шаг 1 визарда = ввод домена → редирект на
  `authorize` Bitrix → callback → возврат в визард на шаг 2. Persist-прогресс
  визарда (sessionStorage, как у ChatBox) переживает OAuth-round-trip.
- Обе стороны чата — **сотрудники** (Bitrix users). Нет таблицы «клиентов»
  чатов; есть только сопоставление Bitrix-user → Person (менеджеры).
- Плюс CRM-ветка: контакты/компании/сделки → knowledge-core.

## Объём
**Входит:**
- Визард первого подключения: (1) домен → OAuth; (2) сопоставление сотрудников
  (Bitrix users → Person, авто-связка по email, селект связать/создать); (3)
  бэкафилл IM-чатов + CRM за период (можно пропустить).
- Зеркала IM: `BitrixUser`, `BitrixDialog`, `BitrixMessage` (+ сессии для анализа).
- Зеркала CRM: `BitrixContact`, `BitrixCompany`, `BitrixDeal` → мост в Entity/IdeaBlock.
- Слой синка: `bitrix-sync.service` + очередь `bitrix.sync` (BullMQ) + `@Cron`
  (раз в сутки 00:00) + ручной триггер по scope (как ChatBox).
- AI-анализ диалогов (гейт по `analysisEnabled`, дедуп pending+jobId) — как ChatBox.
- Source(type='bitrix') (`ensureBitrixSource`), статусы синка в `BitrixIntegration`.
- Стеклянная страница источника (`BitrixIntegrationClient` ConnectedView) + страница
  сопоставления сотрудников.
- hardDelete bitrix-источника = полный сброс (зеркала + интеграция), как ChatBox.

**Вне объёма (отдельные этапы):**
- Инкрементальный синк через события Bitrix (`event.bind`) — Этап 2.
- placement-виджеты — Этап 3. Self-hosted box — Этап 5. Двусторонний поток.

## Опорные API Bitrix
- `callMethodList(method, params)` — обёртка пагинации `start`/`next`/`total` (по 50).
- IM: `im.recent.list` (последние диалоги), `im.dialog.messages.get`
  (`dialog_id`, `last_id`/limit), `im.user.list`/`user.get` (сотрудники).
- CRM: `crm.contact.list`, `crm.company.list`, `crm.deal.list` (постранично).
- Refresh-on-401 на уровне REST: повтор `callMethod` при `isTokenExpired`
  (сейчас refresh только по `accessExpiresAt`).

## Данные (Фаза 0)
Зеркала (`tenantId + externalId @@unique`, `raw Json`, `syncedAt`):
- `BitrixUser` — сотрудник портала (id, name, email, active). Поля связки
  `linkedPersonId`/`linkMode` (none|auto|manual) — для маппинга на Person.
- `BitrixDialog` — IM-диалог (dialogId, type chat/private, title, участники).
- `BitrixMessage` — сообщение (externalId, dialogId, authorBitrixUserId, text, ts).
- `BitrixDialogSession` — окно диалога для анализа (`analysisStatus`
  pending|analyzing|done|failed, `endedAt`) — аналог `ChatboxChatSession`.
- CRM: `BitrixContact`, `BitrixCompany`, `BitrixDeal` (externalId, поля, raw).
- В `BitrixIntegration`: `analysisEnabled Boolean @default(true)`, `syncMode`,
  `lastFullSyncAt`, `lastIncrementalSyncAt`, счётчики (или отдельный status-эндпоинт).
Миграция версионируемая (`prisma:migrate --name bitrix_source_sync`), внести в
`apply-prod-deploy.ts` если потребуются seed/patch (для схемы — авто `migrate deploy`).

## Фазы
- [x] Ф0 — Prisma-модели зеркал (`BitrixUser/Dialog/DialogSession/Message/Contact/Company/Deal`)
  + enum'ы (`BitrixLinkMode/DialogType/DialogAnalysisStatus`) + поля синка
  (`analysisEnabled` default-on, `lastFullSyncAt`, `lastIncrementalSyncAt`) + back-refs в Org.
  Миграция `20260617000000_bitrix_source_sync` (аддитив, без out-of-band DROP) +
  `20260617000001_bitrix_age_schema_fix` (идемпотентный перенос ag_catalog→public,
  AGE-трап). `migrate dev` нельзя (shadow-БД без AGE) → diff(`--from-config-datasource`)
  + ручной чистый файл + `migrate deploy`. Клиент сгенерён, все объекты в public. ✅
- [x] Ф1 — `BitrixApiClient.callMethodList` (пагинация `start/next/total`, кап 400 стр.,
  result массив|словарь) + вынесён `restRequest` (полный конверт). Refresh-on-401 — в
  сервисе: `callApi`/`callApiList` (проактивный `getValidAccessToken` → при
  `isTokenExpired` форс-`refreshNow` + один retry) + `requireEndpoint`. Методы `im.*`/
  `crm.*`/`user.*` НЕ оборачивал — зовутся строкой через `callApi(List)` из синка. ✅
- [x] Ф2 — `bitrix-sync.service`: `syncUsers` (`user.get` → BitrixUser + автосвязка
  email→имя-fuzzy + авто-создание Person), `syncDialogs` (`im.recent.get` →
  `im.dialog.messages.get` → BitrixDialog/Message + единая сессия seq=1 для анализа),
  `syncContacts/Companies/Deals` (`crm.*.list`), `syncByScope`/`fullSync`/`markSynced`.
  Все REST через `integration.callApi(List)` (refresh-on-401). Защитный парсинг
  ВЕРХНЕГО регистра полей Bitrix. Зарегистрирован в `BitrixModule` (+ `PersonsModule`).
  Анализ-enqueue отложен в Ф4. Проверка на реальном портале — при подключении. ✅
- [x] Ф3 — очередь `bitrix.sync` (BullMQ): `bitrix-sync.queue.ts` (константы/scope `all|users|dialogs|crm`),
  `BitrixSyncQueueService` (producer, jobId `bitrix-sync-${tenantId}-${scope}` через `-`),
  `BitrixSyncWorker` (consumer, in-process в WorkersModule), `BitrixSyncCron`
  (`@Cron` 00:00 → `all` для всех connected, гейт `bitrix.enabled`), ручной триггер
  `POST /bitrix/integration/sync?scope=` (RBAC manage + feature). Проводка: QueueService+Cron
  в BitrixModule, Worker+BitrixModule в WorkersModule. ✅
- [x] Ф3.5 — схема под пересмотр: `rollingSummary`/`rollingSummaryAt` на `BitrixDialog`
  И `ChatboxChat`; зеркала `BitrixLead`, `BitrixCrmNote`. Миграция
  `20260617010000_bitrix_rolling_summary_crm_notes` (чистый аддитив + `SET search_path
  TO public` в начале → CREATE сразу в public, AGE-трап обойдён инлайн, без отдельной
  fix-миграции — чище, чем Ф0). Применена, клиент сгенерён. ✅
- [x] Ф4 — AI-анализ дня (диалоги): на закрытую сессию-сутки — 1 LLM-вызов
  (`накопительное rollingSummary + сообщения дня → { daySummary, rollingSummary }`,
  plain-text JSON + `validate`+retry, переиспользован seed-route `chatbox-summary`
  → sensitive→anthropic). `daySummary` → `BitrixDialogSession.summary`; обновлённое
  `rollingSummary`(+`rollingSummaryAt`) → `BitrixDialog`. Мост в knowledge-core:
  `BitrixIngestService.ingestSession` → `RawEvent(sourceType='bitrix')` с
  ОБЯЗАТЕЛЬНЫМ `fullText` + `transcript.turns[*].authorPersonId` (из
  `BitrixUser.linkedPersonId` автора реплики — атрибуция subject в графе).
  Очередь `bitrix.analyze` + `BitrixAnalyzeWorker` (in-process, concurrency 2,
  attempts 3, jobId `bitrix-analyze-${sessionId}`) + `BitrixAnalyzeCron`
  (00:00, гейт `bitrix.enabled` + `analysisEnabled`) + enqueue после синка в
  `BitrixSyncService` (гейт `analysisEnabled`, дедуп jobId). Новое значение enum
  `SourceType.bitrix` (миграция `20260617020000_bitrix_source_type`, `ADD VALUE
  IF NOT EXISTS`). Юнит-тест чистых хелперов (`renderBitrixTranscript`,
  `parseDayRollup`). **ChatBox-анализатор доработан тем же rollup'ом:
  `ChatboxIngestService.generateSummary` → JSON `{daySummary, rollingSummary}`,
  накопительное на `ChatboxChat.rollingSummary`; payload ingest получил
  `rollingSummary`.** Bridge в knowledge-core (block-ingest) НЕ трогали — generic. ✅
- [x] Ф4b — CRM посуточный дайджест. **Решение владельца:** дельта + бэкафилл
  **7 дней** (90 было перебором — до 90 цепочек block-ingest при включении;
  единое окно `CRM_BACKFILL_DAYS=7`, меняется одной строкой). Реализовано:
  (а) **дельта-синк** `crm.{contact,company,deal,lead}.list?filter[>=DATE_MODIFY]=
  <курсор>` + колонка `modifiedAt` на зеркалах + курсор `lastCrmSyncAt` (первый
  синк = now−7д); `syncCrm` двигает курсор; добавлен `syncLeads` (`BitrixLead`).
  (б) **посуточный дайджест** `BitrixIngestService.ingestCrmDigests`: на закрытые
  дни (UTC) от `lastCrmDigestAt` до вчера (кап `MAX_DIGEST_DAYS_PER_RUN=7`/проход)
  собирает изменённые сущности → **детерминированный `fullText`** (без отдельного
  LLM-вызова — знания извлекает downstream block-ingest, экономим LLM) →
  `RawEvent(sourceType=bitrix, sourceExternalId='crm-digest-<день>',
  occurredAt=начало дня)` (идемпотентно, без новой таблицы). Триггер — в
  `BitrixAnalyzeCron` по enabled-тенантам. Миграция `20260617030000_bitrix_crm_delta`.
  Тесты: курсор/окно/пропуск пустых дней. **Заметки/таймлайн (`BitrixCrmNote`)
  отложены** (`crm.timeline.*` — per-entity, тяжело; зеркало есть, синк позже). ✅
- [x] Ф5 — визард + страница источника + сопоставление сотрудников.
  Подключение = OAuth (домен→`authorize`→callback→`?bitrix=connected`); сам
  round-trip и есть persist (интеграция создаётся на бэке в callback, на возврате
  `getIntegration` → ConnectedView — без sessionStorage-визарда). **Стеклянная**
  страница источника `BitrixIntegrationClient` (ConnectedView на `GlassCard`/
  `CardTitle`/`GRAD`/`STATUS_TONE`, как одобренный ChatBox): статус портала,
  ручной синк по scope (Сотрудники/Диалоги/CRM/Всё) с поллингом прогресса,
  тумблер AI-анализа, счётчики данных (8 зеркал + разбивка сессий), отключение.
  Страница сопоставления `company-admin/sources/bitrix/managers` (единый селект
  связать/не связывать/создать). `ensureBitrixSource` (lazy `Source(type=bitrix)`
  при connect/claim) + деактивация при `remove`. **hardDelete-сброс** bitrix в
  `SourcesService.hardDelete` (полный каскад зеркал + интеграция, FK-safe).
  Фронт: `bitrix.api.ts` (getStatus/listUsers/linkUser/sync/setAnalysis) +
  `domain/bitrix.ts` (mapBitrixStatus + bitrixLinkModeLabel). ✅
- [x] Ф6 — статус-эндпоинт + RBAC/фича + тесты + verify. `GET /bitrix/integration/
  status` (счётчики/синки/анализ), `PATCH /analysis` (тумблер), `GET /users` +
  `PATCH /users/:externalId/link` (сопоставление) — все за `feature.bitrix` +
  RBAC (`requireRead`/`requireManage`). Юнит-тесты: `linkUser` (link/unlink/create
  + ошибки), `listUsers`, `setAnalysisEnabled`. Verify: typecheck 0 (back+front),
  lint чисто, 142 теста (bitrix+chatbox+sources) зелёные. ✅

## Открытые вопросы (по ходу)
- Какие типы IM-диалогов брать: личные + групповые чаты, или только рабочие группы?
- Глубина CRM-импорта (всё / N месяцев) — закрывается выбором периода в визарде.
- Scope OAuth: добавить `im` к `crm,user,profile` (финализировать в кабинете Bitrix).

## Итог
**Этап 1 реализован целиком (Ф0–Ф6).** Bitrix24 подключается как источник Коры:
OAuth-коннект → синк сотрудников/IM-диалогов/CRM в зеркала → нарезка диалогов на
сессии-сутки → посуточный AI-анализ (1 LLM-вызов: `daySummary` + накопительное
`rollingSummary`) → мост в knowledge-core (RawEvent `sourceType=bitrix` с
`fullText` + per-message `authorPersonId`). Управление — стеклянная страница
источника (синк по scope, тумблер анализа, счётчики, сопоставление сотрудников,
отключение) + hardDelete-сброс. Та же ревизия доработала ChatBox (сессии-сутки +
`rollingSummary`). Verify: typecheck 0 (back+front), lint, 142 unit-теста зелёные.

**Осталось (отдельными фазами, вне Этапа 1):**
- **Заметки/таймлайн CRM** (`BitrixCrmNote` через `crm.timeline.comment`/
  `crm.activity`) — зеркало есть (Ф3.5), синк отложен (per-entity, тяжело).
- Этап 2 — событийный инкремент (`event.bind`); Этап 3 — placement-виджеты;
  Этап 5 — self-hosted box. (См. «Вне объёма».)
