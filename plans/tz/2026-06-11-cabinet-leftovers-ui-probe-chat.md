# ТЗ: доводка кабинета — остатки (UI-протечки §1 Ф2–Ф6 · уведомления/probe §3 · чат-стрим §4)

> **Что это.** Вынесенный из `plans/tz/2026-06-10-cabinet-fixes-master.md` остаток, который **можно делать
> отдельной сессией прямо сейчас** — без миграций, без новых ENV-решений владельца, без прод-доступа.
> Решения Р-2/Р-3/Р-4 уже приняты в master-ТЗ (§Р). Из master уже выкачены: §1 Ф0+Ф1, §2 (Telegram), §5 (chatbox).
>
> **Основания (доказательная аналитика, file:line, цитаты):**
> - UI: `plans/analysis/2026-06-10-ui-technical-leaks-audit.md`
> - probe: `plans/analysis/2026-06-10-notifications-probe-subsystem.md`
> - чат: прод-трасса 2026-06-10 (в master §4)
> - **верификация текущего кода (2026-06-11):** `plans/analysis/2026-06-11-tz-implementation-audit-last-2-days.md`
>   — все якоря ниже подтверждены по ветке `feature/meeting-cabinet-fixes-2026-06-10`.

## §0. Что уже сделано (НЕ трогать)

- **§1 Ф0** (класс ошибок core + курация + спринты) — закоммичено `25981b53`/`5679b5d0`.
- **§1 Ф1** (`humanizeApiError` на ~114 call-sites) — закоммичено `5b0b27c3`.
- **§1 Ф4 курация** — `ReadablePayload` внедрён в `CurationDetailClient`/`CurationQueueClient`/`ConflictsListClient` ✅.
- Инфра в наличии: компонент `ReadablePayload` (`frontend/app/(authenticated)/curation/ReadablePayload.tsx`),
  доменные мапперы `meetingTypeLabel`/`entityTypeLabel`/`relationLabel`/`conflictRelationLabel`/`IDEA_STATUS_LABEL`,
  pre-existing `resolveProbeRecipients` (`probe-recipient.util.ts`).

## §0.1 Порядок и приёмка-зонтик

Порядок: **§1 (дёшево, видно всем) → §3 (адресация — не косметика) → §4 (стрим)**. Каждая часть — самостоятельный выкат.
Сквозная приёмка: `bun run typecheck`/`lint`/`build` (front+back) зелёные; ни один тост/баннер/заголовок не показывает
латиницу-код/HTTP/cuid/сырой JSON; probe про сотрудника приходит ему (или руководителю), не владельцу; чат показывает прогресс.

---

## Часть 1 — UI технические протечки (остаток Ф2–Ф6)

**Принцип:** чинить **классом** через существующие мапперы / `ReadablePayload` / резолвер имени, не по одному кейсу.
**Рекомендация (опора):** вынести `ReadablePayload` из `curation/` в общий `frontend/src/ui/` — он нужен и notifications, и team-templates.

### Ф2 — enum → русский (через мапперы; где словаря нет — завести) ✅ `d8902c49`
- [x] `cards/[id]/CardDetailClient.tsx:300,400` — `{m.type}` / `StatusBadge {status}` (`ai_ready`/`failed`/`daily`) → `meetingTypeLabel` + новый словарь статусов карточки (`meetingStatusLabel`).
- [x] `entities/[id]/graph/EntityGraphClient.tsx:404,423,505` — панель «Тип связи» `{edge.relationType}` → `relationLabel`; `{node.entityType}` → `entityTypeLabel`; `JSON.stringify(edge.attributes)` → `ReadablePayload`. (Tooltip связи :385 уже через маппер — не трогали.)
- [x] `themes/[id]/ThemeDetailClient.tsx:203,231` — `{block.signalType}` (`task_created`) / `{entity.type}` (`PERSON`/`ORG_UNIT`) → мапперы в `domain/theme.ts` (`signalTypeLabel`, реюз `entityTypeLabel`).
- [x] `ui/concierge/ConciergeChat.tsx:204,213,248,281,290` — имена инструментов латиницей (`create_table`/`infer_table_schema`) → словарь `toolNameLabel` (новый `frontend/src/domain/concierge.ts`, русское «Создаю таблицу…»).
- [x] `sprints/[id]/SprintDashboardClient.tsx:390` — `{m.type} · {m.status}` → мапперы встречи.
- [x] Точечно: ChatBox role (chats-менеджеры), `brand-voice`, `roles/skill-profile` — прогнаны через мапперы; `?? rawCode` убран. `ReadablePayload` вынесен в общий `frontend/src/ui/readable-payload.tsx`.
- **Приёмка:** в перечисленных экранах ни одного латинского enum-кода в видимом тексте. ✅

### Ф3 — cuid → имя/название ✅ `fce71268`
- [x] `intake/IntakeClient.tsx:404,410,425` — `shortId(suggestedProjectId/AssigneeId/GoalId)` (обрезанный cuid) → бэк `intake.findAll` батч-резолвит имена (`Project.name`/`Goal.name`/`Person.name`) → `suggestedProjectName`/`AssigneeName`/`GoalTitle` в DTO. Это же — Ф3 #6 аудита.
- [x] `experiments/[id]/ExperimentDetailClient.tsx:134,137` — `ID: {detail.id}` / `entityId: {detail.entityId}` → ID скрыт из видимого UI.
- [x] `curation/[id]/CurationDetailClient.tsx:364` — `Конфликт {cid}` (сырой cuid как заголовок ссылки) → человеческий текст «Связанный конфликт».
- [x] Точечно: `projects/settings` участники-id → `memberDisplayName` (имя вместо id).
- **Приёмка:** внутренние ID не показываются как контент/заголовок/подпись. ✅

### Ф4 — raw-json (остаток вне курации) ✅ `6f6fff64`
- [x] `me/notifications/NotificationsClient.tsx:432-434` — `<pre>{JSON.stringify(n.responsePayload)}</pre>` → текст `responsePayload.response`/`.text` («Ваш ответ: …»). ⚠️ **СОВПАДАЕТ с §3 Ф3-D7 — реализовано ОДИН раз** (см. Часть 2).
- [x] `team-templates/[slug]/TeamTemplateDetailClient.tsx:30,41` — `{category}` (сырой код) → словарь `teamTemplateCategoryLabel`; `{JSON.stringify(definition)}` → `ReadablePayload`.
- **Приёмка:** нет `JSON.stringify` в видимом (не-admin) JSX. ✅

### Ф5 — зоны (критик полноты) ✅ `d995a4c7`
- [x] **`/orchestrator/*` (Р-3):** нет role-gate — страница под `(authenticated)`, открыта по прямому URL всем. → role-gate `OrchestratorAuthGuard` + layout (только `super_admin`/`owner`). (Локализацию НЕ делали — Р-3.)
- [x] **`/support/*`:** support-статусы **НЕ трогали** — `ticket.status = issueState.name` уже по-русски (false-positive аудита, проверено по коду; отдельный `ticketStatusLabel` не нужен).
- [x] **Чат-синтез:** `chat-v2` — `stripBlockMarkers` вырезает сырые маркеры `[BLOCK:<cuid>]` / `[CONTRADICTING BLOCK:<cuid>]` из текста ответа. Маркеры не утекают в UI.
- **Приёмка:** `/orchestrator` недоступен обычной роли; статусы тикетов по-русски (уже были); в ответе чата нет `[BLOCK:…]`. ✅

### Ф6 (low) — `/(admin)/**` — ОСОЗНАННО ПРОПУЩЕН
- [ ] **Осознанно пропущен** (см. §Итог). Десятки `<pre>`/JSON/taskType-кодов — это инструменты отладки `super_admin` (`LogsClient`/`WorkerQueueDetailDialog`/`PromptPreviewModal` и т.п.), где сырой JSON — сама их функция. Бизнес-пользователь admin не видит (за `AdminAuthGuard`). Severity low, ТЗ рейтит «приемлемо, при желании». Не блокирует выкат Ф2–Ф5.

### Системные опоры (чтобы класс не вернулся)
`ReadablePayload` как общий компонент · доменные мапперы как обязательная прослойка · (опц.) ESLint-гард на `JSON.stringify(` в `.tsx` (вне admin) и на сырой `.message` в тостах.

---

## Часть 2 — Уведомления / probe / модерация (§3, целиком)

**Корни (подтверждены по коду 2026-06-11):**
- Адресация: `probe-dispatcher.worker.ts:136-138` берёт `candidates[0]` (round-robin); `consistency-checker.cron.ts:96,415-425,459` кладёт владельцев (`findOwnerCandidates`). Pre-existing `resolveProbeRecipients` (`probe-recipient.util.ts:21-61`) уже маршрутизирует probe **двух** специалистов (3.7/3.2) на главу отдела субъекта (fallback owner, исключая самого субъекта), но это «руководителю», не «самому X», и не покрывает диспетчер/consistency-checker.
- Тексты: `consistency-checker.cron.ts:57-64 RULE_DESCRIPTIONS` — жаргон (CompanyProfile/Document/Role); `probe-dispatcher.worker.ts:213-214` fallback берёт `payload.message` дословно; `probe-formulate.prompt.ts:30-34` без запрета на коды/ID.
- Фронт: `frontend/src/domain/conversational.ts:84-89 EVENT_TYPE_LABELS` неполный; `NotificationsClient.tsx:432-434` JSON.stringify(responsePayload).

### Ф1 (приоритет) — Адресация (Р-2). За kill-switch `PROBE_SUBJECT_ADDRESSING_ENABLED` (ON). ✅ `a088e25d`
- [x] Таблица `reason → audience`: `resolveProbeRecipients` при флаге ON → `[субъект, глава отдела, owner]` (субъект первым; резолв `subject.userId`). Структурные gap-правила про компанию → владельцу/админу.
- [x] Точка правки — эмиттеры specialist-3-2/3-7 пробрасывают флаг. Диспетчер остаётся «бери первого», но первым теперь приходит субъект. Kill-switch `PROBE_SUBJECT_ADDRESSING_ENABLED` (zBool default true).
- **Приёмка:** «обнаружена экспертиза у X» → X (или руководителю), **не владельцу**; вопросы про разных людей не размазываются по админам. ✅

### Ф2 — Человеческие тексты ✅ `dbde0d57`
- [x] `RULE_DESCRIPTIONS` (`consistency-checker.cron.ts`) → простой русский без классов-сущностей.
- [x] ID/тип/уровень/логин → резолвятся в имя через `resourceTypeRu`/`levelRu`/`resolutionRu` (новые в `pending-actions/resource-type-ru.ts`); модерация (curation/card-stale/conflict) очищена от `resourceId`/cuid в видимом тексте.
- [x] `probe-formulate.prompt.ts` — в SYSTEM добавлено правило «без кодов/ID»; fallback — человеческий `humanizeProbeFallback` (не `payload.message` дословно). ⚠️ Правка SYSTEM ломает кэш `probe-formulate` разово — приемлемо, далее стабильно.
- **Приёмка:** в тексте уведомления нет латиницы-классов/ID/логинов. ✅

### Ф3 — Фронт ✅ `6655f769`
- [x] `conversational.ts EVENT_TYPE_LABELS` — дозаполнен реальными кодами из backend conversational policy-map → русские заголовки.
- [x] `NotificationsClient.tsx` — `JSON.stringify(responsePayload)` → текст `.response`/`.text` («Ваш ответ»). **(Тот же фикс, что §1 Ф4 — сделан один раз, см. `6f6fff64`.)**
- [x] Служебные пустые поля скрыты.
- **Приёмка:** заголовки уведомлений по-русски; ответ пользователя — обычным текстом, не JSON. ✅

---

## Часть 3 — Чат «Помощник компании»: обратная связь и латентность (§4, Р-4)

**Проблема (подтверждена):** `chat-v2.controller.ts:79-112` `ask()` — синхронный `@HttpCode(OK)`, возвращает готовый
`{text, citations, …}` одним ответом. На реальном вопросе ~58с (classify 7с + retrieval 22с + синтез 28.6с), единственный
фидбек «Кора печатает…», синтез **впритык к таймауту 30с** → риск потери ответа.

### Ф1 (быстрый выигрыш) — Стадии вместо статичного «печатает» ✅ backend `2c6285aa` · frontend `afc7e1d2`
- [x] Индикатор стадий «Понимаю вопрос → Ищу в памяти → Пишу ответ» + явный таймаут-стейт («Долго думаю — подождите…», >45с). Реализовано через лёгкий SSE стадий (по образцу Concierge), без перелопачивания синтеза. Backend: новый `POST /api/v1/chat-v2/messages/stream`, `ChatV2Stage = understanding|searching|writing`, `onStage` пробрасывается orchestration→synthesis→knowledge-core; события SSE `stage`/`done`/`error`. Kill-switch `CHAT_V2_STREAMING_ENABLED` (default true): OFF → 503 до SSE, фронт fallback на синхронный `/messages`. Синхронный `POST /messages` не тронут.
- **Приёмка:** пользователь видит, что система работает, а не «зависла». ✅

### Ф2 — SSE-стрим токенов — ОТЛОЖЕНО решением владельца (2026-06-11)
- [ ] **Отложено решением владельца, follow-up за `CHAT_V2_STREAMING_ENABLED`.** Посимвольный стрим токенов требует переписать LLM-роутер + 3 провайдера (`call()` строго НЕ-стриминговый) — большой риск ради косметики; стадии (Ф1) уже решают «зависло». Остаётся как follow-up за тем же kill-switch.
- **Приёмка (на будущее):** ответ появляется по мере генерации; тяжёлый ответ не теряется.

### Ф3 (Р-4) — Таймаут синтеза + профиль retrieval ✅ `8adfa8da`
- [x] Отдельный таймаут синтеза `chat-v2` через AdminSetting (не в код): `LlmCallParams.timeoutMs?` (per-call override race), AdminSetting `knowledge.chatV2SynthesisTimeoutMs` (POSITIVE_INT, code-default 90000 мс, не ENV); синтез chat-v2 передаёт `timeoutMs`. Профиль retrieval 22с — вторично, не делали.
- **Приёмка:** синтез не обрывается по таймауту. ✅

---

## §Сквозное

- **Прод:** всё — фронтенд + точечный backend (тексты/маршруты/адресация/стрим). **Миграций и новых ENV-крутилок нет**
  (таймауты/пороги — AdminSetting). Выкат: `docker compose up -d --build`.
- **Флаги (Ship-On):** новые — только kill-switch (ON): `PROBE_SUBJECT_ADDRESSING_ENABLED` (Часть 2 Ф1),
  `CHAT_V2_STREAMING_ENABLED` (Часть 3 Ф2). Каждый — строка в `docs/operations/feature-flags.md`. §1 — чистый рендер, без флага.
- **prompt caching:** правки SYSTEM `probe-formulate` (Часть 2 Ф2) ломают кэш разово — приемлемо; далее стабильно.
- **Верификация:** typecheck/lint/build (front+back); прод-смоук через `diag.ts` — отсутствие сырых кодов в уведомлениях,
  адресация probe субъекту, прогресс в чате (после выката, по «можно в прод»).

## §Не входит
- Разграничение доступа к графу ([[knowledge-access-groups]] — отдельный механизм; адресация probe ≠ доступ к данным).
- Переписывание retrieval-движка (только профиль/кэш/таймаут).
- `/(admin)/**` глубокая локализация (Ф6 — отдельный low-prio проход).
- intake-project-picker и onboarding-nav Ф1/Ф2 — у них **свои** ТЗ (`2026-06-10-intake-project-picker-and-triage-calibration.md`,
  `2026-06-10-onboarding-nav-and-prod-retest-followup.md`); брать как есть, не дублировать сюда.

## §Итог
**Реализовано:** §1 Ф2–Ф5, §3 Ф1–Ф3, §4 Ф1+Ф3 (10 коммитов реализации `d8902c49..afc7e1d2`; в диапазоне есть 2 чужих docs-коммита про мобильную версию — не наши).
**Открыто:** §4 Ф2 посимвольный стрим токенов (отложен владельцем — follow-up за `CHAT_V2_STREAMING_ENABLED`); §1 Ф6 (осознанный пропуск — super_admin debug-инструменты, сырой JSON = их функция, за `AdminAuthGuard`).

Тесты (все зелёные): `intake.service.spec`, `chat-v2-strip-markers.spec` (9), `probe-recipient.util.spec` (9), `humanize-probe-fallback.spec` (5), `chat-v2-synthesis-timeout.spec` (1), `chat-v2-stage-progress.spec` (4). `typecheck`/`build` front+back зелёные.

### Коммиты по фазам

| Часть · Фаза | Что | Коммит |
|---|---|---|
| §1 Ф2 | enum → русский (мапперы cards/graph/themes/concierge/sprints; `toolNameLabel`, `meetingStatusLabel`; `ReadablePayload` → `frontend/src/ui/readable-payload.tsx`) | `d8902c49` |
| §1 Ф3 | cuid → имя (бэк `intake.findAll` батч-резолв `*Name`; эксперимент скрыл ID; «Связанный конфликт»; `memberDisplayName`) | `fce71268` |
| §1 Ф4 | raw-json → текст (`me/notifications` «Ваш ответ»; team-templates `definition`→`ReadablePayload`, `teamTemplateCategoryLabel`) | `6f6fff64` |
| §1 Ф5 | role-gate `/orchestrator` (`OrchestratorAuthGuard`+layout); `stripBlockMarkers` в chat-v2 | `d995a4c7` |
| §3 Ф1 | адресация probe субъекту (`resolveProbeRecipients` → `[субъект, глава отдела, owner]`; kill-switch `PROBE_SUBJECT_ADDRESSING_ENABLED`) | `a088e25d` |
| §3 Ф2 | человеческие тексты (`RULE_DESCRIPTIONS`; `probe-formulate` SYSTEM; `humanizeProbeFallback`; `resourceTypeRu`/`levelRu`/`resolutionRu`) | `dbde0d57` |
| §3 Ф3 | `EVENT_TYPE_LABELS` дозаполнен реальными кодами из policy-map | `6655f769` |
| §4 Ф3 | отдельный таймаут синтеза chat-v2 (`LlmCallParams.timeoutMs?`; AdminSetting `knowledge.chatV2SynthesisTimeoutMs`, default 90000) | `8adfa8da` |
| §4 Ф1 backend | стадии прогресса SSE (`POST /chat-v2/messages/stream`; `onStage`; kill-switch `CHAT_V2_STREAMING_ENABLED`) | `2c6285aa` |
| §4 Ф1 frontend | стадии «Понимаю→Ищу→Пишу» + «Долго думаю» (>45с) + fallback на синхронный `ask` при 503/ошибке | `afc7e1d2` |

Брать по явному «начни реализацию: Часть N».
