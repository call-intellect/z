# Инструмент диагностического доступа Claude к прод-данным Коры (логи + цепочка встреча→отчёт)

> Тип: анализ фичи / выбор архитектуры. Дата: 2026-06-04. Статус: **РЕАЛИЗОВАНО и проверено в прод** — `backend/scripts/diag.ts` (read-only CLI). Запуск: `bun run --env-file=c:/work/z/.env c:/work/z/backend/scripts/diag.ts <cmd>` (DIAG_* в КОРНЕВОМ `.env`; логин кредами admin@crossmark.ru). Прод-доступ только с явным подтверждением владельца в сессии.
>
> Контекст-триггер: переписка владельца (Сергей) с программистами.
> - **Программист №1:** «дать Claude статический токен к `https://meet.crossmark.ru/api/v1`, он сам найдёт эндпоинты и заберёт логи; но статических токенов нет — надо сначала добавить выдачу токенов».
> - **Программист №2:** «можно без токенов — просто дать логин/пароль админа, и Claude через API достанет логи».
> - **Запрос владельца:** не просто логи, а доступ ко всей цепочке «видеовстреча → аудиотранскрипт → AI-джобы → отчёт», чтобы Claude мог сам ходить и разбирать, *правильно ли собрался отчёт*, где сломалось, и быстрее находить реальную причину багов. «Докажи, что твой вариант лучше, на человеческом языке».

---

## 0. Короткий вывод (TL;DR)

1. **Статические токены УЖЕ есть** в коде (`ApiKey` + `BearerAuthGuard` + скоупы `read`/`write`, выпуск через `POST /api/v1/api-keys`). Посылка программиста №1 «токенов нет» — устарела.
2. **Все данные для разбора УЖЕ пишутся в БД и почти все уже имеют API:** логи с трассировкой цепочки (`/platform/logs/chain?traceId=mtg_<id>`), полная телеметрия LLM/ASR-вызовов с сохранённым промптом и ответом модели (`/admin/usage/calls`), итоговый отчёт (`AiResult`). **Проблема не в данных — в доступе и упаковке.**
3. **Реальных дыры три:** (а) эти диагностические эндпоинты закрыты cookie + супер-админ — статический токен (Bearer) до них не дотягивается; (б) нет «одного вызова = вся цепочка по встрече»; (в) нет удобного «инструмента» для Claude (он бы ходил сырым `curl`).
4. **Оба предложения программистов — крайности одного спектра:** токен = безопасно, но сейчас слеп к логам; логин/пароль = всё видит, но это полный доступ с правом разрушать, без отзыва-без-побочек.
5. **Рекомендация:** read-only диагностический срез (новые эндпоинты под отдельным узким скоупом `diagnostics`) + локальный **MCP-сервер** `z-diag` как «инструмент» для Claude (токен живёт в окружении процесса, не попадает в переписку). CLI-скрипт `bun run scripts/diag.ts` — как ядро на тот же день, которое потом оборачивается в MCP.
6. **Решение владельца по приватности (2026-06-04): полный контент по ВСЕМ организациям** — осознанный размен (приватность сейчас в низком приоритете). Транскрипты/отчёты/превью моделей доступны инструменту по всем оргам. Сохраняем все НЕ-приватные предохранители: read-only, отдельный скоуп `diagnostics` (никогда write), `expiresAt`, throttler, per-read аудит, токен только в окружении MCP (не в чат), kill-switch; `PATCH /logs/settings` и `POST /cleanup` остаются вне Bearer.

---

## 1. Что уже есть (проверено по коду, двойной проход)

### 1.1 Авторизация и токены
- **Cookie-сессия** (`z_session`, httpOnly JWT): `CookieAuthGuard` → `req.user`. Логин админа: `POST /api/v1/auth/admin-login` (email+пароль, bcrypt) → ставит cookie. Сессия из admin-login идёт **без `jti`** → записи в `UserSession` нет → **серверно отозвать такую сессию нельзя** (только сменой секрета = разлогин всех). [auth.controller.ts, admin-login.service.ts, cookie-auth.guard.ts, jwt.service.ts]
- **Статические API-ключи (УЖЕ ЕСТЬ):** модель `ApiKey` (schema ~1712): `hashedKey` = sha256(raw), `prefix`, `scopes ApiKeyScope[]` (`read`/`write`), `scope` (kind: `api`/`ingest`), `userId`, `tenantId?`, `lastUsedAt`, `revokedAt`. Формат `z_<43 base64url>` (32 байта энтропии). Выпуск: `POST /api/v1/api-keys` (cookie-auth). Проверка: `BearerAuthGuard` (Authorization: Bearer z_…), scope-чек, `req.apiUserId`. Отзыв: `DELETE /api/v1/api-keys/:id`, идемпотентно; `resolveByRawKey` отвергает revoked на следующем же запросе. **Нет поля `expiresAt`** — токены не протухают сами. [api-keys.*, bearer-auth.guard.ts]

### 1.2 Что Bearer-ключ может читать СЕГОДНЯ
Только публичный API `/api/public/v1` и только данные **владельца ключа** (`where ownerId=userId`):
- `GET /meetings`, `/meetings/:id` (+`aiResult`: summary/structuredData/customOutputMd/followUpEmail/modelUsed/summaryFast), `/meetings/:id/tasks`, `/meetings/:id/chapters`;
- `GET/POST/PATCH/DELETE /cards…`, `GET/POST/DELETE /webhooks/subscriptions`.
- **Нет** транскриптов, **нет** логов, **нет** телеметрии LLM-вызовов. [public-api/*]

### 1.3 Что закрыто за cookie + SuperAdmin (Bearer НЕ дотягивается)
- **Логи:** `GET /api/v1/platform/logs` (фильтры: level/category/contour/pipeline/traceId/module/userId/orgId/requestId/method/path/statusCode/dates/search), `/aggregates`, **`/chain?traceId=X`** (вся цепочка одного действия по времени), `/:id`, `/settings`, `PATCH /settings`, `POST /cleanup`. [system-logs.controller.ts]
- **Телеметрия AI:** `GET /api/v1/admin/usage/dashboard|users|calls|calls/:id|functions|export`. `calls/:id` отдаёт по вызову: provider/model/agentType/taskType/токены/cost/durationMs/success/errorText/tier/fallbackReason + **requestPreview (промпт, 8 КБ) + responsePreview (ответ модели, 8 КБ)** + experimentGroup. [admin-usage.service.ts]

### 1.4 Где лежат данные (модели)
- `SystemLog` (schema ~10104): level/category/contour/`pipeline`/module/action/message/`details Json`/userId/orgId/requestId/**traceId**/method/path/statusCode/durationMs/errorName/errorMessage/errorStack. Индексы по traceId/pipeline/module/level/createdAt.
- `AiUsageLog` (schema ~1348): `meetingId`, jobId, provider, model, agentType (`transcribe|summary|report-by-type|follow-up|tasks|custom`), taskType, токены, costUsd, durationMs, success, errorText, tier, fallbackReason, requestPreview, responsePreview, sourceRef `{type,id}`.
- `AiResult` (schema ~1303): summary, structuredData, customOutputMd, followUpEmail, summaryFast/V2, modelUsed, promptTemplateVersionId, experimentGroup. Связь `meetingId` — 1:1.
- `ApiAccessLog` (schema ~2032): apiKeyId/userId/route/status/durationMs/ipHash — пишется интерсептором на каждый public-вызов (fire-and-forget, **только на `PublicApiModule`**).

### 1.5 Трассируемость одной встречи (ключ к «разбору цепочки»)
- **`traceId` встречи = `mtg_<Meeting.id>`** (детерминированно; `log-pipeline.ts` `traceForMeeting`). → `GET /platform/logs/chain?traceId=mtg_<id>` = весь технический след: `MEETING_LIFECYCLE → RECORDING → TRANSCRIPTION → AI_ANALYSIS → KNOWLEDGE_GRAPH`.
- `AiUsageLog.meetingId` связывает каждый LLM/ASR-вызов со встречей.
- `Meeting.failureReason` — текстовый «журнал ошибки» встречи; `Meeting.status` + под-статусы (`reportFastStatus`, `analyzeV2Status`, `qualityScoreStatus`) — где встал конвейер.
- FSM встречи (11 шагов) и сигналы успеха/ошибки на каждом — см. Приложение A.

### 1.6 Шум VOX-polling (жалоба Никиты) — гасится без кода
Runtime-настройки логов через `PATCH /api/v1/platform/logs/settings`: `disabledModules[]` (заглушить шумный модуль опроса), `logSuccessfulRequests=false`, `minLevel`, `slowRequestThresholdMs`. Применяются без рестарта. **Это zero-code quick win прямо сейчас.**

---

## 2. Реальные пробелы (что мешает Claude самому разбирать цепочку)

1. **Диагностика не доступна по токену.** Логи и `usage/calls` — только cookie+SuperAdmin. Любой неинтерактивный клиент (Claude) до них не дойдёт без новых эндпоинтов или костыля с логин/паролем.
2. **Нет «одного вызова = вся цепочка по встрече».** Сейчас это 3–4 разных запроса (meeting detail + `AiUsageLog by meetingId` + `SystemLog by traceId=mtg_<id>` + `AiResult`). Нужен агрегирующий `GET …/meetings/:id/trace`.
3. **Нет узкого скоупа `diagnostics`.** Есть только грубые `read`/`write`. Нечем ограничить токен «только диагностика, только чтение».
4. **Нет `expiresAt`** у токена — не протухает сам.
5. **Нет глобального ограничителя частоты.** `ThrottlerModule` сконфигурирован (120/60с), но `ThrottlerGuard` **не глобальный** — висит только на `tables.controller.ts`. Весь public-API и любые новые эндпоинты — без лимита. Агент в retry-петле по `/aggregates` (GROUP BY по `SystemLog`) может нагрузить прод-Postgres.
6. **Редактор логов чистит по ИМЕНИ ключа, не по содержимому** (`log-sanitizer.ts`). Свободный текст (транскрипт, имена, почты внутри `message`/`details`/`requestPreview`) не маскируется.
7. **Нет инструмента для Claude.** В репо `.mcp.json` есть только Playwright. Диагностического MCP-сервера/CLI нет.

---

## 3. Как «отдать» это Claude — 4 механизма доставки

| Вариант | Как работает | Плюсы | Минусы | Труд |
|---|---|---|---|---|
| **A. Сырой `curl`/Bash + токен** | Claude сам строит URL и шлёт `Authorization: Bearer` через Bash | ноль кода, максимально гибко | **токен утекает в переписку/историю** (в репо уже пришлось добавить запрет `Bash(curl *$*)`); нет рамок — модель может выдумать write-путь; хрупкое экранирование в PowerShell; конфликт с vexp-хуком | low |
| **B. Локальный MCP-сервер** (рекоменд.) | Bun/Node-процесс с 5 типизированными инструментами (`meeting_trace`, `logs_query`, `logs_chain`, `llm_calls`, `report_dump`); токен из `process.env`, в инструмент НЕ передаётся | **токен не попадает в чат** (живёт в окружении процесса, в `.mcp.json` через `${DIAG_TOKEN}` — даже не коммитится); жёсткие рамки (5 инструментов = вся поверхность атаки, write физически нет); лучшая эргономика, Zod-валидация, работает в субагентах/Plan; ложится на стек Bun+TS и существующий `.mcp.json` | ~150–300 строк сервера + поддержка контракта; lifecycle stdio-процесса | medium |
| **C. CLI-скрипт в репо** | `bun run scripts/diag.ts trace --meeting <id>`; токен из env; URL/auth/пагинация в одном месте | дешевле MCP, переиспользуем людьми и в CI, контент можно пред-фильтровать | идёт через Bash (permission-промпты, риск утечки токена в флаге), хуже discoverability | low |
| **D. Прямой read-only доступ к БД/реплике** | Postgres-MCP/`psql` с readonly-ролью, Claude пишет SQL | максимальная мощь для произвольной аналитики; жёсткая граница «только чтение» на уровне БД | **наибольший радиус поражения**: голые таблицы (PII, секреты-колонки, embeddings), мульти-тенант-изоляция в коде (TenantGuard) обходится SQL'ом; на ноут уезжает DSN БД (секрет опаснее токена); надо знать схему ~1.7к строк; легко повесить прод тяжёлым запросом | high |

**Рекомендация по доставке — РЕШЕНИЕ ВЛАДЕЛЬЦА (2026-06-04): вариант C — CLI-инструмент внутри репо** (`backend/scripts/diag.ts`), без MCP-сервера («инструмент с кнопками не нужен»). Ключи доступа — в `.env` (не в чат, не в git). Плюс поведенческий гейт: **перед обращением к проду в сессии нужно явное подтверждение владельца** (зафиксировано в памяти агента — `feedback_prod_diagnostic_access_requires_confirmation`). Вариант B (MCP) — отклонён как лишняя сложность (справка по нему — Приложение B, на случай если передумаем); A — только одноразовый зонд; D (прямой доступ к БД) — не для этой задачи.

Конкретный формат регистрации MCP-сервера для Claude Code, паттерн «токен в env через `${DIAG_TOKEN}`» и скелет сервера — см. Приложение B.

---

## 4. Три способа дать «личность» (где стоят оба программиста)

| | Логи сегодня | Только чтение (нельзя сломать прод) | Отзыв без побочек | Атрибуция в аудите | Хрупкость | Код |
|---|---|---|---|---|---|---|
| **Токен `read` (прог. №1)** | ❌ (нужны новые эндпоинты) | ✅ можно `read`-only | ✅ кнопка отзыва | ✅ свой apiKeyId | низкая | немного |
| **Логин/пароль админа (прог. №2)** | ✅ сразу (если `isSuperAdmin`) | ❌ полный доступ, вкл. `POST /cleanup` (удаление логов) | ❌ только сменой секрета (разлогин всех) — сессия без `jti` | ❌ «это сделал супер-админ» | высокая: TTL-перелогин, httpOnly cookie jar, глобальный `mustChangePassword`-барьер | ноль |
| **Выделенный `diagnostics`-токен (рекоменд.)** | ✅ через новый read-only срез | ✅ по построению | ✅ отзыв + `expiresAt` + feature-flag | ✅ свой apiKeyId + per-read аудит | низкая | средне |

Вывод: оба предложения программистов заставляют выбирать «полезно ИЛИ безопасно». Логин/пароль особенно опасен: это «ключ от всего здания» на ноутбуке, с правом удалять логи, **который нельзя отозвать, не разлогинив живых людей** (admin-login выдаёт сессию без `jti`). Рекомендованный вариант снимает выбор: ровно столько прав, сколько нужно, только чтение, со своей кнопкой отзыва, протуханием и журналом «кто что прочитал».

**Прагматический нюанс:** если «прямо сегодня, ноль кода», то наименее плохой быстрый костыль — **не пароль живого админа, а отдельный супер-админ-аккаунт под бота** (`claude-bot@…`): отдельная личность, блокируется без вреда тебе, видна в аудите как автомат. Но это всё ещё полный доступ — только как мост на 1–2 дня.

---

## 5. Security-вердикт и конфликт «контент против безопасности»

Состязательный security-разбор (полный — в исходных данных research) дал **жёсткий вывод**: предложение «кросс-органный/админский токен, который тащит транскрипты и дословные промпты/ответы моделей» **надо отклонить как есть**. Критичные риски:

1. **Утечка токена** (critical): bearer без `expiresAt`, без nonce; живёт на ноуте, проходит через внешний LLM, оседает в истории чата. Утёк-но-не-отозван → бессрочный доступ.
2. **Эксфильтрация контента клиентов наружу** (critical): `requestPreview/responsePreview`, `SystemLog.details/message`, отчёты содержат дословный транскрипт встреч реальных клиентов. Редактор чистит по имени ключа, не по содержимому → транскрипт уезжает во внешнюю модель.
3. **Кросс-тенант-утечка** (critical): новые Bearer-эндпоинты, фильтрующие по `traceId/orgId` без `ownerId/tenant`, отдадут данные всех оргов одному ноут-токену.
4. **Сполз скоупа к write/destructive** (high): `@RequireScope` по умолчанию `read`, но грубый enum; `PATCH /logs/settings` и `POST /logs/cleanup` нельзя пускать на Bearer никогда.
5. **Нет лимита частоты** (high) → прод-DoS. **Слабый аудит** (high) — `ApiAccessLog` пишет только route+status, не «какой meetingId/чей транскрипт прочитан».

**Конфликт с твоим запросом.** Безопасный вывод security — «только метаданные, без контента». Но ты явно хочешь, чтобы Claude *видел, правильно ли собрался отчёт* — а это требует контента. Разрешение конфликта — **два уровня доступа** (и это же идеально ложится на «прогнали тест по этой компании — разбери всю цепочку»):

- **Уровень 1 — «где сломалось» (широко, безопасно): только метаданные.** traceId, pipeline, module, level, errorName/Message, status, durationMs, provider/model/agentType/taskType/success/токены/cost/tier/fallbackReason, `Meeting.status/failureReason`. Без транскриптов и без текста отчёта. Хватает для 90% отладки (включая кейс Никиты).
- **Уровень 2 — «правильно ли собралось» (контент): только для ОДНОЙ выделенной тест-организации.** Токен тенант-ограничен на наш тест-орг; для него Claude читает всё, включая транскрипт/отчёт/превью. Данные реальных клиентов так не утекают — это осознанный размен на своих тестовых данных. Если контент по реальной встрече нужен разово — через живую супер-админ-сессию человека, не через постоянный токен.

**Условия, при которых токен в прод допустим** — РЕШЕНИЕ ВЛАДЕЛЬЦА (2026-06-04): полный контент по всем оргам; тенант-ограничение и «только метаданные» из security-вердикта СНЯТЫ осознанным решением (приватность в низком приоритете). Остаются обязательными предохранители, НЕ конфликтующие с этим выбором: отдельный скоуп `diagnostics`, никогда `write`; `expiresAt` ≤ 72ч; per-route throttler (~20/мин); per-read аудит (какой traceId/meetingId/orgId прочитан); токен никогда не в чате — только как секрет окружения MCP, «жечь при подозрении»; `PATCH /logs/settings` и `POST /cleanup` — навсегда вне Bearer. Kill-switch — три слоя: feature-flag (`AdminSetting`) гасит весь срез одним тумблером → отзыв ключа (мгновенный) → `expiresAt`.

---

## 6. Рекомендованная архитектура и фазы

**Что строим:** read-only CLI-инструмент в репо (`backend/scripts/diag.ts`), который ходит к проду с ключами из `.env`; по решению владельца — без MCP-сервера. Перед использованием в сессии — явное подтверждение владельца (гейт в памяти агента). Нужен ли тонкий диагностический срез на backend (скоуп `diagnostics` + агрегирующая ручка) — зависит от выбора ключа (см. развилку ниже).

**Развилка ключа в `.env`:**
- **(а) Креды отдельного бот-супер-админа `claude-bot@` (рекоменд. для скорости):** ноль backend-изменений — скрипт логинится и читает уже существующие админ-эндпоинты (`/platform/logs`, `/admin/usage/calls`, meeting data). Отдельная личность: отзывается блокировкой аккаунта, видна в аудите как автомат, не задевает живого админа. Read-only обеспечивается тем, что скрипт шлёт только GET. Минус: креды в `.env` формально дают полный доступ (но скрипт — только чтение).
- **(б) Выделенный read-only `diagnostics`-токен:** чище по правам (физически только чтение), но требует backend-работы (новый скоуп + агрегирующая ручка, т.к. Bearer сейчас не видит логи). Дольше.
РЕШЕНО (2026-06-04): владелец выбрал максимально простой путь — используем креды СУЩЕСТВУЮЩЕГО `admin@crossmark.ru` (уже супер-админ, без must-change-password) прямо в `.env`, без отдельного бот-аккаунта и setup-скрипта. Инструмент написан: `backend/scripts/diag.ts` (7 команд, read-only). При желании ужесточить до (б) — позже.

- **Фаза 0 (сегодня, ноль кода):** заглушить VOX-шум через `PATCH /platform/logs/settings`. Показать, что промпт/ответ модели уже видны в Z-Admin `/admin/usage/calls`.
- **Фаза 1 — данные/доступ (backend):** скоуп `diagnostics` в `ApiKeyScope`; `expiresAt` в `ApiKey` (+ проверка в `resolveByRawKey`); глобальный или per-route `ThrottlerGuard` на диагностике; новый `DiagnosticsController` под `BearerAuthGuard + @RequireScope('diagnostics')`, тенант-фильтр обязателен:
  - `GET /api/v1/diag/meetings/:id/trace` — агрегат: статус+failureReason встречи, шаги FSM, LLM-вызовы (метаданные), технический след по `traceId=mtg_<id>` (метаданные). Контент — только если `tenantId == DIAG_CONTENT_ORG`.
  - `GET /api/v1/diag/logs` и `/logs/chain` — метаданные SystemLog (без свободного текста по умолчанию).
  - `GET /api/v1/diag/meetings/:id/llm-calls` — телеметрия AiUsageLog (превью — только для тест-орга).
  - per-read аудит в `AuditLog` (ресурс-идентификаторы), `ApiAccessLogInterceptor` на контроллере, не-fire-and-forget.
- **Фаза 2 — инструмент (CLI, без MCP — решение владельца):** `backend/scripts/diag.ts` — подкоманды `trace --meeting <id>` / `logs [--level --from --module]` / `llm-calls --meeting <id>` / `report --meeting <id>`; base URL и ключи из `.env`; вывод — компактный JSON/таблица. MCP-обёртка и формат `.mcp.json` (`${DIAG_TOKEN}`) оставлены в Приложении B как справка на будущее.
- **Фаза 3 — операционка:** feature-flag `feature.diagnostic_api`; короткоживущий токен под тест-орг; алерт на всплеск `ApiAccessLog` диаг-ключа.

Скоуп/throttler/аудит-инфраструктура частично есть — переиспользуем, не строим с нуля.

---

## 7. Решение владельца (2026-06-04)

**Объём доступа к контенту — ВЫБРАНО: полный контент по всем организациям.** Осознанный размен (приватность сейчас в низком приоритете): инструменту доступны транскрипты/отчёты/превью моделей по всем оргам. Тенант-ограничение и «только метаданные» из security-вердикта сняты. Сохраняются НЕ-приватные предохранители: read-only, скоуп `diagnostics` (никогда write), `expiresAt` ≤ 72ч, throttler (~20/мин), per-read аудит, токен только в окружении MCP (не в чат), kill-switch (feature-flag → отзыв → expiry), `cleanup`/`settings` вне Bearer.

Следующий шаг: ТЗ в `plans/tz/` по Фазам 1–2 — по подтверждению владельца «пиши ТЗ».

---

## Приложение A — FSM встречи и сигналы (для диагностики)

| Шаг | Модели | Успех | Провал / где ошибка |
|---|---|---|---|
| 1 Создание | Meeting, MeetingsBalance | status=scheduled, баланс списан | Forbidden при нехватке баланса; SystemLog category=BUSINESS |
| 2 Активация комнаты | Meeting, Participant, Recording | status=active | SystemLog pipeline=MEETING_LIFECYCLE |
| 3 Завершение | Meeting, Recording, AudioTrack | Recording.status=ready, треки в S3 | Recording.status=failed; pipeline=RECORDING |
| 4 Транскрибация | Transcript, AiUsageLog(agentType=transcribe) | AiUsageLog.success=true | success=false+errorText; pipeline=TRANSCRIPTION |
| 5 Сборка транскрипта | Transcript | turns заполнены, status=transcription_ready | turns пусты; action=merge.failed |
| 6 AI-анализ | AiResult, SystemLog | status=ai_processing, AiResult-плейсхолдер | action=ai.analyze.failed |
| 6a Summary | AiUsageLog(summary), AiResult | AiResult.summary | success=false; эскалация tier |
| 6b Отчёт | AiUsageLog, AiResult, PromptTemplateVersion | structuredData/customOutputMd | поля null; success=false |
| 6c Follow-up | AiUsageLog(follow-up), AiResult | followUpEmail | null |
| 6d Задачи | AiUsageLog(tasks), AiResult, Task | tasks/Task созданы | пусто |
| 7 ai_ready | Meeting | status=ai_ready, вторичные джобы в очередь | Meeting.failureReason |
| 8 Fast report | AiResult.summaryFast | reportFastStatus=ready | reportFastStatus=failed |
| 9 Knowledge-core | AiResult.summaryV2, RawEvent | analyzeV2Status=ready | analyzeV2Status=failed |
| 10 Quality score | MeetingQualityScore | qualityScoreStatus=ready | failed/disabled |
| 11 ROI score | Meeting.roiScore | roiScore посчитан | null |

**Быстрые запросы отладки** (для CLI/MCP внутри, не для модели напрямую):
- Статус встречи: `SELECT id,status,failureReason,createdAt FROM "Meeting" WHERE id=$1`
- LLM-вызовы встречи: `SELECT agentType,taskType,provider,model,tier,fallbackReason,success,errorText,costUsd,durationMs,createdAt FROM "AiUsageLog" WHERE "meetingId"=$1 ORDER BY createdAt`
- След встречи: `SELECT pipeline,module,action,level,message,details,errorName,durationMs FROM "SystemLog" WHERE "traceId"='mtg_'||$1 ORDER BY createdAt`
- Зависшие встречи: `… WHERE status='transcription_processing' AND createdAt < now()-interval '2 hours'`

## Приложение B — Регистрация MCP-сервера для Claude Code (паттерн «токен в env»)

`.mcp.json` (project scope, в корне репо; токен НЕ коммитится — берётся из окружения через `${DIAG_TOKEN}`):
```json
{
  "mcpServers": {
    "z-diag": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "${CLAUDE_PROJECT_DIR:-.}/backend/scripts/diag-mcp.ts"],
      "env": {
        "DIAG_API_BASE": "https://meet.crossmark.ru",
        "DIAG_TOKEN": "${DIAG_TOKEN}"
      },
      "timeout": 600000
    }
  }
}
```
Принцип: токен — **никогда не аргумент инструмента**; сервер читает `process.env.DIAG_TOKEN` сам и кладёт в `Authorization: Bearer`. Модель передаёт только `meetingId/level/timeRange`. `${VAR}`-подстановка → литерал секрета не в git и не в чате. Если `DIAG_TOKEN` не задан в окружении — Claude Code не стартует сервер (это нормальный «предохранитель»).

Скелет сервера (`@modelcontextprotocol/sdk`, Bun/TS, 5 read-only инструментов): `meeting_trace`, `logs_query`, `logs_chain`, `llm_calls`, `report_dump`; каждый — `fetch` к `/api/v1/diag/...` с Bearer из env; большие выдачи — пагинация / `anthropic/maxResultSizeChars`.

Источники: code.claude.com/docs/en/mcp; modelcontextprotocol.io security best practices; OWASP MCP Top-10 (MCP01 — token mismanagement); modelcontextprotocol/typescript-sdk.

---

## Связанные материалы
- Жалоба-триггер на шум VOX и «вернуть результат транскрипции» — гасится §1.6, контент вызова уже в `/admin/usage/calls`.
- Память проекта: приватность/data-residency «отложено» (`feedback_privacy_deprioritized_now`) — §5 помечает экспозицию транскриптов как осознанное решение.
- Стек: единый Bun+Node+TS — MCP-сервер и CLI пишутся в нём (`feedback_single_node_stack_no_python`).
