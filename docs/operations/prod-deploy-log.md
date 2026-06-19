# Накопительная prod-инструкция — Z / Кора

> **Назначение.** Единый реестр операций, которые нужно выполнить на проде после очередного push в `dev` / `main`.
> Каждый push, который требует операций (миграция БД, seed, patch, новые ENV, рестарт), **обязан** добавить запись в раздел [🚨 Накоплено к выкату](#-накоплено-к-выкату).
> После реального выката на прод накопленный блок переезжает в [📂 Архив применённых](#-архив-применённых).
>
> **Прод-программист:** открой раздел «Накоплено к выкату», иди сверху вниз — это твоя готовая копи-пейст-инструкция.
> **Агент (Claude):** правила обновления см. в [🔄 Правила поддержки файла](#-правила-поддержки-файла) и в `CLAUDE.md` → «Триггер 1: после `git push`».
>
> ⚠️ **ПРАВИЛО №1.** Z на проде живёт целиком внутри `docker-compose.yml` (postgres + redis + migrate + backend + frontend, единый стек). Все команды этого файла — через `docker compose exec backend …` (для запущенного backend) или `docker compose run --rm backend …` (для разового запуска). **Никаких прямых `cd backend && bun run …` или `bun install` на хосте.** Хост — только `git pull` + `docker compose build/up/down`.

---

## ⚡ Быстрый выкат (`docker compose up -d`)

С 2026-06-01 контейнер `migrate` сам прогоняет весь выкат. Выкат = собрать образ + поднять стек:

```bash
cd /home/docker/z
git pull origin dev
docker compose build backend frontend
docker compose up -d
docker compose logs -f migrate     # дождаться завершения + посмотреть SUMMARY
docker compose ps                  # z-migrate=Exited(0), backend/frontend=healthy
```

`migrate` выполняет (через `apply-prod-deploy.ts --mode update --with-schema --continue-on-fail --no-fail-on-steps`):
**авто-бэкап БД** (`pg_dump` → volume `z-backups`) → **dedupe** → **`prisma migrate deploy`** → **`apply-postgres-init`** → **все seed/patch/backfill**. Затем стартуют `backend` и `frontend`.

> **С 2026-06-05 — версионируемые миграции, НЕ `db push`.** Схема применяется файлами из `backend/prisma/migrations/` через `prisma migrate deploy` (транзакционно, только новые миграции). Это убрало класс частичных/дрейфующих состояний от `db push --accept-data-loss` (инцидент: осиротевший enum `ParticipantInvitationStatus`). **Одноразовый baseline существующего прода** — см. блок «🆕 Baseline миграций» в разделе «Накоплено к выкату». После baseline новые схемы просто доезжают через `migrate deploy` на каждом `up -d`.

> **Тихий лог (с 2026-06-05).** seed/patch/backfill-шаги печатают по ОДНОЙ строке-итогу (`✓ [phase] script — inserted=…, skipped=…`); полный вывод шага — только если он упал. Идемпотентный выкат больше не засоряет лог сотнями строк. Нужен полный вывод всех шагов — `--verbose` или env `APPLY_PROD_DEPLOY_VERBOSE=1`. Schema-фаза (migrate deploy / postgres-init) печатается как есть.

Семантика отказов (важно):
- **Сбой схемы** (бэкап не сделался / migrate deploy упал) → `migrate` exit 1 → `backend` НЕ стартует. Это правильно: схема-mismatch фатален. Чини и `up -d` снова.
- **Осечка отдельного seed/backfill** → залогирована в `=== SUMMARY ===`, но `migrate` выходит 0 → стек поднимается. Идемпотентные скрипты перезапусти руками: `docker compose exec backend bun run scripts/<имя>.ts`.

**Авто-бэкап обязателен** перед `migrate deploy`. Файл: `/app/backups/pre-deploy-<ts>.dump` в volume `z-backups`. Restore:
```bash
docker compose run --rm --no-deps backend \
  pg_restore --clean --if-exists -d "$DATABASE_URL" /app/backups/<file>.dump
```
Список бэкапов: `docker compose run --rm --no-deps backend ls -lh /app/backups`.

> Требует `pg_dump` в образе (`postgresql16-client`, `backend/Dockerfile`) и volume `z-backups` (`docker-compose.yml`).
>
> **Ручной прогон** (например, доехать сиды без пересборки) — через работающий backend:
> `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update --continue-on-fail`.
> Прогон схемы вручную в обход migrate: `docker compose run --rm --no-deps backend bun run scripts/apply-prod-deploy.ts --mode update --with-schema` (внутри = `prisma migrate deploy`). Только миграции, без сидов: `docker compose run --rm --no-deps backend sh -c 'bunx prisma migrate deploy'`; статус — `... sh -c 'bunx prisma migrate status'`.
>
> **Первый bootstrap с нуля** (пустая БД): замени `--mode update` на `--mode all` (добавит супер-админа и базовые сиды). Для существующего прода — всегда `--mode update`.

Подробная пошаговая инструкция со smoke-проверками — ниже (Шаги 0–12). Быстрый путь её заменяет в типовом случае.

---

## 🚨 Накоплено к выкату

**Окно:** 2026-05-20 .. 2026-05-30 (с момента последнего prod-cut).
**Источник:** все рефлексии в `second-brain/05_история/` с этой даты + git log dev.
**Содержит:** ~80 prod-скриптов (patch/seed/migrate/backfill/setup) + ~175 новых Prisma-моделей + ~135 новых ENV (все опциональные) + 2 опасных schema-изменения + новый модуль биллинга (Tochka).

> Все рабочие директории — внутри контейнера `backend` (`/app`). На хосте оставайся в корне репо `~/work/z` (или где у тебя `docker-compose.yml`).

### 🎛️ Опциональные ручные операции (вне авто-аггрегатора)

> Эти скрипты **НЕ зарегистрированы** в `apply-prod-deploy.ts` STEPS и **НЕ выполняются** на `docker compose ... apply-prod-deploy`. Запускать **только вручную, осознанно владельцем** (бюджетные / cost-решения). Все идемпотентны (повторный прогон = no-op).

- **(опц., owner cost-decision)** `docker compose exec backend bun run scripts/patch-task-extractor-route-pro.ts` — перевести task-экстракторы (`tasks`, `meeting-extract-actions`) с дефолтной `deepseek-v4-flash` на capable `deepseek-v4-pro` (точнее, но дороже). Не входит в авто-выкат. Откат — вернуть `deepseek-v4-flash` через `/admin/ai-models/[taskType]` или обратным патчем. Не трогает маршруты с `editedByAdmin=true`.
- **(прод-операция владельца, не код)** `docker compose exec backend bun run scripts/patch-enable-chatbox-analysis.ts --apply` — **ChatBox Ф0:** включить анализ переписки (`analysisEnabled=true`) для уже подключённых интеграций, в т.ч. «Ооо луа» (`svmazur@mail.ru`), где синк забрал ~215 чатов, но анализ ни разу не запускался (дефолт OFF до фикса). Без флага — dry-run (только counts). Уже зарегистрирован в `apply-prod-deploy STEPS` (`phase:'patch'`, `skipBootstrap:true`) — прогон агрегатора `--mode update` его выполнит; здесь продублирован как явная операция «включить анализ переписки» для существующих тенантов. Идемпотентен (повтор → 0). После прогона cron `analyze-sweep` сам подберёт их сессии в граф.

---

### 🐛 2026-06-19 — Фикс зависания экрана цели + уведомление об обновлении фронта

> Коммит: `0a676e56`. Изменены только frontend-файлы — backend, миграции, ENV не затронуты.
>
> **Зачем:** (1) после редактирования цели экран зависал — помогал только разлогин. Причина: SWR с `revalidateOnFocus` по умолчанию триггерил рефетч при открытии диалога, `goal`-объект в deps `useEffect` создавал бесконечный цикл setState → React error #185, страница падала в error boundary. (2) пользователи продолжали работать на старом клиентском бандле после сборки нового контейнера — добавляем polling `/api/version` с Sonner-тостом и очисткой SW-кэшей.

- **Шаг 11 — Docker rebuild, только frontend:** `docker compose up -d --build frontend`. Backend не перебирать.
- **Шаг 12 — Smoke:**
  - (а) **цель не зависает:** создать цель → открыть детальный экран → нажать «Редактировать» → изменить и сохранить → экран обновляется, не падает в error boundary;
  - (б) **версия-эндпоинт:** `GET /api/version` → `{"version":"<строка>"}` (или проверить через браузер — в DevTools Network после открытия приложения).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🧹 2026-06-19 — ChatBox: убрать приём вебхуков (только суточный забор по AccessToken)

> Контракт: ТЗ `plans/tz/2026-06-19-chatbox-remove-webhooks.md`. second-brain: `01_projects/chatbox-integration.md`, `02_architecture/module-map.md` + `data-model.md`, `01_projects/api-layer.md`.
>
> **Зачем для прода:** вебхук ChatBox давал постоянный 403 `chatbox_webhook_invalid_secret` при рассинхроне секрета URL↔БД (кейс «Ооо луа», удары каждые 1-2 мин). Вебхук был лишь триггером «иди синкани» — данные всё равно тянутся по AccessToken. Убираем приём вебхуков целиком; единственный способ забора — суточный `chatbox-sync.cron.ts` (полночь). Фронт не менялся.
>
> **1 миграция (авто, дроп 2 колонок + нормализация enum).** **1 новый backfill (в STEPS) — снимает внешние вебхуки на стороне ChatBox.** **Docker rebuild только backend.**

- **Шаг 4 — Prisma — обязательно, авто** (`prisma migrate deploy` в migrate-контейнере на `docker compose up`): миграция `20260619120000_chatbox_remove_webhooks` — `UPDATE "ChatboxIntegration" SET "syncMode"='daily' WHERE "syncMode"<>'daily'` (нормализация legacy `hourly`/`realtime`), затем `DROP COLUMN "webhookExternalId"`, `DROP COLUMN "webhookSecret"`. ⚠ **Destructive (DROP COLUMN)**, но колонки больше не читаются кодом (webhook-контур удалён). Enum `ChatboxSyncMode` и поле `syncMode` сохранены. **В STEPS агрегатора регистрировать НЕ нужно** (миграция схемы). **Порядок гарантирован:** SCHEMA PHASE (дроп колонок) идёт ДО Шага 8 — поэтому backfill ниже НЕ читает дропнутые колонки, а находит вебхуки через ChatBox API.
- **Шаг 8 — Backfill (1 прогон, идемпотентный, уже в STEPS `phase:'backfill'`, `skipBootstrap:true`):** `backfill-chatbox-unregister-webhooks.ts` — для каждой `ChatboxIntegration` идёт в ChatBox API (`GET /workspaces/{ws}/webhooks` по AccessToken), находит наши вебхуки (по URL `/api/v1/webhooks/chatbox/` или описанию «Кора») и снимает их (`DELETE`). Не читает дропнутые колонки (только `tokenEnc`+`workspaceId`). Не падает на ошибке отдельного орга (401/таймаут → пропуск, log). Идемпотентен (повтор → 0 совпадений). Сначала dry-run для проверки: `docker compose exec backend bun run scripts/backfill-chatbox-unregister-webhooks.ts --dry-run`, затем агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`. Требует ENV `CHATBOX_API_BASE_URL` (default `https://app.agent-lia.ru`) + `CRYPTO_MASTER_KEY`.
- **Шаг 11 — Docker rebuild** — `docker compose up -d --build backend` (удалён контроллер `chatbox-webhook.controller.ts` + webhook-методы; фронта изменения не касаются).
- **Шаг 12 — Smoke** (после выката):
  - (а) **роут вебхука исчез:** `POST /api/v1/webhooks/chatbox/<любой>/<любой>` → 404 (раньше был 403/200);
  - (б) **суточный синк жив:** в логах старта backend есть `ChatboxSyncCron`; ручной триггер `POST /api/v1/chatbox/integration/sync {scope:'all'}` для тестового орга наполняет чаты;
  - (в) **внешние вебхуки сняты:** `backfill-chatbox-unregister-webhooks.ts` отчитался `deleted>0` (или `matched=0`, если ChatBox их уже отключил); в логах ChatBox прекратились удары по `/webhooks/chatbox/...`.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🔍 2026-06-19 — Observability Bitrix/ChatBox: таблица прогонов, именованные cron, admin-страница

> Контракт: `plans/tz/2026-06-19-integration-sync-observability.md`. Коммит: текущий push `dev`. second-brain: `02_architecture/module-map.md` §ChatBox + §Bitrix, `01_projects/api-layer.md`, `01_projects/workers-queues.md`.
>
> **Зачем:** в логах не было никаких записей по прогонам синка/анализа. Добавляем `IntegrationSyncRun` — per-run запись со статусом, длительностью, счётчиками и ошибкой. Все 4 воркера оборачивают свою работу. Очереди bitrix/chatbox теперь видны в admin-панели. Новая страница `/admin/integrations/sources` — обзорный дашборд.

- **Шаг 4 — Prisma — обязательно, авто** (`prisma migrate deploy` в migrate-контейнере на `docker compose up`): миграция `20260619130000_integration_sync_run` — новая таблица `IntegrationSyncRun` (10 колонок + 2 индекса). Аддитивная, без потери данных. **В STEPS агрегатора регистрировать НЕ нужно** (миграция схемы).
- **Шаг 7 — Seed (идемпотентный, уже в STEPS `phase:'seed-base'`):** `seed-integration-crons.ts` — регистрирует 5 `CronSchedule`-строк (BitrixSyncCron.runDaily, ChatboxSyncCron.runDaily, BitrixAnalyzeCron.sweep, ChatboxAnalyzeCron.sweep, IntegrationSyncLogPruneCron.run). Пропускает, если уже есть. Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — `docker compose up -d --build backend` (новый модуль `integrations-observability`, именованные @Cron, новый admin-контроллер, очереди в реестре).
- **Шаг 12 — Smoke** (после выката):
  - (а) **таблица существует:** `docker compose exec backend bun run -e "const {createPrismaClient}=await import('./scripts/_lib/prisma.js');const p=createPrismaClient();console.log(await p.integrationSyncRun.count())"` → 0 (таблица пустая, скоро наполнится);
  - (б) **cron'ы зарегистрированы:** `GET /api/v1/admin/platform/crons` → должны появиться `BitrixSyncCron.runDaily`, `ChatboxSyncCron.runDaily`, `BitrixAnalyzeCron.sweep`, `ChatboxAnalyzeCron.sweep` (swagger `/api/docs`);
  - (в) **очереди видны в панели:** `GET /api/v1/admin/workers/queues` → в списке есть `bitrix.sync`, `bitrix.analyze`, `chatbox.sync`, `chatbox.analyze`;
  - (г) **admin sources API:** `GET /api/v1/admin/integrations/sources/overview` → 200 с массивом (тестовая авторизация через super_admin cookie).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🔗 2026-06-19 — Сопоставление сотрудников/клиентов: «Получить» вместо автосвязки + 3-колоночный UI + чистка мёртвого кода + relationship-фикс

> Коммиты: `f70c1485`, `be5aad82`, `d312ec5c`, `b51df5d3`, `0e54f989`, `2a0f22ca`, `9499a271`, `66543dc7`, `f09e8436`, `e165ca75` + текущий push (relationship-фикс + бэкфилл). second-brain: реестр не-сделанного.
>
> **Зачем для прода:** синк интеграций САМ автосопоставлял и автосоздавал persons (→ команда=1, а в сопоставлении 9 фантомов с неверными email-матчами). Убрали автосвязку из ВСЕХ потоков (bitrix users, chatbox members/customers/channelClients) — теперь «Получить» только тянет записи, сопоставление вручную на странице (с email-подсказкой, 3 колонки Источник\|Предложение\|Действие). Вырезали ~674 строки осиротевших auto-методов. **Фикс:** при ручном связывании/создании из Bitrix-юзеров и Chatbox-менеджеров person теперь становится `employee` (был дефолт `external` → не попадал в «Сотрудники компании»); клиенты chatbox остаются `external`.

- **Шаг 8 — Backfill (1 прогон, идемпотентный, уже в STEPS `phase:'backfill'`, `skipBootstrap:true`):** `backfill-integration-persons-to-employee.ts` — persons, связанные с `bitrixUser`/`chatboxMember` (linkedPersonId), переводит `external → employee` (чинит уже созданные «внешними» карточки Bitrix-сотрудников и Chatbox-менеджеров). НЕ трогает клиентов. Идемпотентен (повтор → 0). Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **(опц., разовый сброс — НЕ в авто-STEPS, деструктивен для ручных связей):** `docker compose exec backend bun run scripts/patch-reset-phantom-manager-links.ts` — сбрасывает ВСЕ привязки (`linkedPersonId=null, linkMode='none'`) в 4 таблицах (`bitrixUser`, `chatboxMember`, `chatboxCustomer`, `chatboxChannelClient`), чтобы вычистить фантомные авто-связи. Запускать осознанно (затрёт и ручные привязки) — после него пересопоставить на странице.
- **Шаг 11 — Docker rebuild** — `docker compose up -d --build backend frontend` (бэк: убрана автосвязка + relationship-фикс; фронт: 3-колоночный UI + email-подсказки + кнопки «Получить»).
- **Шаг 12 — Smoke** (после выката):
  - (а) **«Получить» не сопоставляет:** на чистом тенанте `POST /api/v1/chatbox/integration/sync {scope:'all'}` → менеджеры/клиенты появились, но все `linkMode='none'`, `linkedPersonId=null`;
  - (б) **создание = сотрудник:** на странице сопоставления Bitrix выбрать «Создать нового сотрудника» → Применить → созданная Person имеет `relationship='employee'`, видна в «Команде» под фильтром «Только сотрудники»;
  - (в) **email-подсказка:** менеджер с email, совпадающим с Person, при загрузке страницы предзаполнен (бейдж «по email»), но в БД ничего не записано до «Применить».

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🗓️ 2026-06-18 — Помощник × календарь: дубли / даты-таймзоны / контрагент-vs-место / онлайн-пометка (8 фаз)

> Контракт: ветка `feature/assistant-calendar-fixes`, коммиты `25e316d6..00a9858a` (9: Ф1 дедуп+ACK `25e316d6`; Ф2 «Сейчас»/TZ `9213df40`+фикс `a15733b8`; Ф7 описания `18303af1`; миграция `c7f26742`; Ф6+Ф5 online/counterparty `ba7ce495`; Ф3 окно дня в TZ `85d47d26`; Ф4 рабочий профиль `4a1a11f9`; Ф8 фронт `00a9858a`). ТЗ: `plans/tz/2026-06-18-assistant-calendar-master.md`. Диагностика: `plans/analysis/2026-06-18-telegram-assistant-calendar-bugs-diagnosis.md`. second-brain: `02_architecture/data-model.md`, `01_projects/{api-layer,frontend-pages,workers-queues,conversational-channels,concierge-agent,calendar}.md`. Реестр флагов — `docs/operations/feature-flags.md` (`ASSISTANT_INBOUND_ASYNC_ENABLED`).
>
> **Зачем для прода:** помощник в Telegram/MAX (1) слал по 5 дублей ответа на одно сообщение (webhook ждал 14-15с concierge-loop до 200 → ретраи доставки) — чиним дедупом `update_id`/`mid` + ранним ACK через очередь; (2) не понимал «завтра/сегодня» (не знал дату/TZ) — добавили «Сейчас…» в контекст; (3) «сегодня» для UTC+7 возвращало вчера+завтра — окно дня теперь по таймзоне человека; (4) офлайн-встречи плодили `failed` видеокомнаты — видео только при `online=true`. Плюс: контрагент vs место (`counterparty`), рабочий профиль человека (таймзона+часы+дни) с настройкой и автоспросом.
>
> **1 миграция (авто, аддитивная).** **1 новый ENV-флаг (kill-switch ON, действий владельца НЕ требует).** **1 seed (в STEPS).** **1 новая BullMQ-очередь (in-process).** **Docker rebuild backend+frontend обязателен.**

- **Шаг 1 — ENV (новый kill-switch, ON по умолчанию, действий владельца НЕ требует):** `ASSISTANT_INBOUND_ASYNC_ENABLED` (zBool, default `true`) — ранний ACK входящих помощника через BullMQ-очередь `assistant.inbound`; OFF → синхронная обработка как раньше (аварийный откат, если очередь деградировала). Дедуп `update_id`/`mid` (Redis SET NX) работает НЕЗАВИСИМО от флага. Реестр — `docs/operations/feature-flags.md`. Новых обязательных ENV нет (backend стартует без правок `.env`).
- **Шаг 4 — Prisma — обязательно, авто** (`prisma migrate deploy` в migrate-контейнере на `docker compose up`; аддитивная, без потери данных, backfill не нужен): миграция `20260618120000_person_work_profile_event_online_counterparty` — `Person.workStartHour/workEndHour Int?`, `Person.workingDays Int[] @default([])` (рабочий профиль); `Event.online Boolean @default(false)` (формат: видеокомната только при true); `Event.counterparty VarChar(300)?` (контрагент/клиент, НЕ место). **В STEPS агрегатора регистрировать НЕ нужно** (миграция схемы).
- **Шаг 7 — Seed (1 прогон AdminSetting, идемпотентный, уже в STEPS `phase:'seed-base'`):** `seed-admin-setting-work-hours.ts` — дефолты рабочего профиля `work_hours_default_start=9`, `work_hours_default_end=18`, `work_days_default=[1,2,3,4,5]`, `default_timezone=Europe/Moscow` (уважает admin-override). Доезжает агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (новая очередь+воркер `assistant.inbound`, дедуп в webhook-контроллерах Telegram/MAX, «Сейчас»/TZ в контексте, окно дня + find_free_slot в TZ, `online`/`counterparty` в events, новый эндпоинт make-online + инструменты помощника `make_event_online`/`set_my_work_profile`; фронт — `WorkProfileSection` в настройках, тумблер «Онлайн»/поле «Контрагент»/кнопка «Сделать онлайн» в форме события): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката):
  - (а) **дедуп:** один и тот же апдейт боту дважды (или повтор доставки прокси) → ОДИН ответ, не 5; в логах `telegram webhook: enqueued (early-ack)` с `ackMs` < 1000; webhook отвечает 200 сразу;
  - (б) **новая очередь жива:** в логах старта backend `AssistantInboundWorker запущен (concurrency=4)` и `AssistantInboundQueueService: очередь assistant.inbound готова`;
  - (в) **«завтра/сегодня»:** боту «запиши встречу завтра в 10:00 с N» → событие создаётся на корректную дату без переспроса и без 400; «какие у меня сегодня встречи» (для пользователя с заданной TZ) → только сегодняшние локальные сутки;
  - (г) **онлайн только по пометке:** «встреча с N на заводе завтра» → событие БЕЗ видеокомнаты (`Event.online=false`, не `failed`); «онлайн-созвон с N завтра» → с комнатой; `POST /api/v1/events/:id/make-online` создаёт комнату к офлайн-событию;
  - (д) **рабочий профиль:** Swagger `/api/docs` содержит `GET/PATCH /api/v1/me/work-profile` и `POST /api/v1/events/:id/make-online`; в «Настройки → Профиль» виден блок «Рабочее время» (таймзона/часы/дни); `GET /admin/settings` содержит `work_hours_default_start=9` и др.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🧩 2026-06-18 — Батч из 5 ТЗ: probe-система Ф2 + хлебные крошки + Лента в дашборды + задачи встречи в трекере + баннер онбординга

> Контракт: ветка `feature/knowledge-base-redesign-formatter`, 16 коммитов (A `2d7fd244` баннер; B `73836b7c` задачи встречи→трекер; D `8ef49108`+`eb0f7dee` хлебные крошки; C `9aa3945e`+`10dbbe35` Лента Коры в дашборды; E `9430383f`/`cf9c3878`/`b7b32e64`/`855197a4`/`553c93e9`/`ea27594e` probe Ф1–Ф6). ТЗ: `plans/tz/2026-06-17-fix-incomplete-setup-banner-progress.md`, `plans/tz/2026-06-16-intake-issue-linked-meeting-ids-fix.md`, `plans/tz/2026-06-17-cabinet-breadcrumbs-and-mobile-back.md`, `plans/tz/2026-06-17-cora-feed-into-dashboards.md`, `plans/tz/2026-06-17-probe-system-phase2.md`. second-brain: `01_projects/probe-agent.md`, `03_processes/probe-question-flow.md`, `01_projects/ai-jobs.md`, `02_architecture/data-model.md`, `01_projects/frontend-contexts-hooks.md`, `01_projects/frontend-pages.md`. Реестр флагов — `docs/operations/feature-flags.md` (новые probe.*-рубильники).
>
> **Зачем для прода:** (A) баннер «N из 6» брал прогресс из устаревшего источника → теперь из `onboardingApi.getSetupProgress` (только фронт). (B) задачи встречи не были видны в карточке встречи — IntakeIssue.meetingId протянут в Issue.linkedMeetingIds. (D) сквозные хлебные крошки + мобильная «назад» (только фронт). (C) «Лента Коры» вынесена в виджет на /dashboard и /me, отдельная страница `/feed` удалена. (E) доведение probe-системы (Layer 6): свободный ответ на probe, LLM-судья качества вопроса, выбор получателя по отзывчивости, семантический дедуп через pgvector, один переспрос, ingest-повод unresolved-at-ingest.
>
> **2 миграции (авто, аддитивные).** **1 HNSW-индекс в postgres-init.** **Новые probe.*-рубильники — все kill-switch ON (действий владельца НЕ требуют).** **Seed/backfill — все уже в STEPS.** **Docker rebuild backend+frontend обязателен.**

- **Шаг 1 — AdminSetting (новые probe.*-крутилки/рубильники, code-default есть — действий владельца НЕ требуют):** `probe.replyClassifyMinConfidence` (0.6), `probe.qualityJudgeEnabled` (true, kill-switch), `probe.engagementRoutingEnabled` (true, kill-switch), `probe.semanticDedupEnabled` (true, kill-switch), `probe.semanticDedupThreshold` (0.92), `probe.semanticDedupWindowHours` (72), `probe.reaskEnabled` (true, kill-switch). Доезжают перепрогоном агрегатора (Шаг 7 — `seed-admin-settings.ts` уже в STEPS, уважает admin-override). Реестр — `docs/operations/feature-flags.md`.
- **Шаг 4 — Prisma — обязательно, авто** (`prisma migrate deploy` в migrate-контейнере на `docker compose up`; обе аддитивны, без потери данных, backfill для колонок не нужен):
  - `add_intake_issue_meeting_id` — `IntakeIssue.meetingId String?` (привязка кандидата в задачу к встрече-источнику).
  - `add_probe_event_question_embedding` — `ProbeEvent.questionEmbedding vector(1536)` (семантический дедуп вопросов probe).
  - **В STEPS агрегатора регистрировать НЕ нужно** (миграции схемы, не seed/patch/backfill).
- **Шаг 5 — Postgres-init (новый HNSW, идемпотентно `IF NOT EXISTS`, выполняется в migrate-сервисе):** `idx_probeevent_qembed_hnsw` на `probe_events("questionEmbedding" vector_cosine_ops) WHERE "questionEmbedding" IS NOT NULL` (partial HNSW для KNN-дедупа probe). Если нужно вручную — `docker compose run --rm backend bun run apply-postgres-init`.
- **Шаг 7 — Seed (идемпотентно upsert, отдельных команд НЕ надо — оба уже в STEPS, идут штатно `apply-prod-deploy.ts --mode update`):**
  - `seed-admin-settings.ts` (новые `probe.*` крутилки/рубильники, `phase:'seed-base'`).
  - `seed-llm-task-routes-ideas-and-probe.ts` (route нового taskType `probe-quality-judge`: deepseek-v4-flash → gpt-5.4-mini → ollama; `phase:'seed-llm-routes'`).
- **Шаг 8 — Backfill (после деплоя, идемпотентно, уже в STEPS `phase:'backfill'`, `skipBootstrap`):** `backfill-meeting-linked-ids.ts` — восстанавливает `Issue.linkedMeetingIds` из meeting-intake (только `meeting:`-формат `externalId`); существующие задачи встреч начинают отображаться в карточке встречи. Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update` (или точечно `docker compose exec backend bun run scripts/backfill-meeting-linked-ids.ts`).
- **Шаг 11 — Docker rebuild** — обязателен (probe-воркеры/судья/дедуп/re-ask, ingest-эмиссия `attribution.unresolved_at_ingest`, новый taskType, протяжка linkedMeetingIds; фронт — хлебные крошки + `CoraFeedWidget` на /dashboard и /me, удаление страницы `/feed`, баннер «N из 6»): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката):
  - (а) **probe-quality-judge маршрутизируется (не DEFAULT-цепочка):** `docker compose exec backend bun run scripts/diag-routes.ts` (или греп прод-маршрутов) показывает `probe-quality-judge` → primary `deepseek-v4-flash`, а не аварийный `DEFAULT_FALLBACK_CHAIN`;
  - (б) задача, извлечённая из встречи, видна в карточке встречи (раздел задач), а не только в `/issues`;
  - (в) хлебные крошки рендерятся на детальных страницах кабинета; на мобильном — кнопка «назад»;
  - (г) «Лента Коры» (виджет) видна на `/dashboard` и `/me`; прямой переход на `/feed` больше не открывает отдельную страницу (сиблинги `/feed/insights`, `/feed/probe-questions`, `/feed/spotlights` живы);
  - (д) баннер онбординга показывает корректное «N из 6».

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🔌 2026-06-17 — Bitrix24 как источник: синк IM+CRM + посуточный анализ + UI (Ф0–Ф6)

> Контракт: ветка `bitrix`, коммиты `aa44f18a` (Ф0–Ф4: схема+синк+очереди+анализ), `40580414` (Ф5–Ф6: страница+сопоставление+статус). ТЗ: `plans/archive/2026-06-17-bitrix24-source-sync.md`.

- **Шаг 1 — ENV** — **новых нет.** `BITRIX_CLIENT_ID/SECRET` и пр. заведены ещё на фазе установки (`2026-06-09-bitrix24-integration-install`). Kill-switch `bitrix.enabled` — admin-настройка (не ENV).
- **Шаг 4 — Prisma** — **обязательно, авто** (4 миграции, аддитивные, без потери данных, `prisma migrate deploy` в migrate-контейнере на `docker compose up -d`):
  - `20260617000000_bitrix_source_sync` — зеркала `BitrixUser/Dialog/DialogSession/Message/Contact/Company/Deal` + enum'ы `BitrixLinkMode/BitrixDialogType/BitrixDialogAnalysisStatus` + поля `BitrixIntegration.analysisEnabled`(default true)/`lastFullSyncAt`/`lastIncrementalSyncAt`.
  - `20260617000001_bitrix_age_schema_fix` — идемпотентный перенос ag_catalog→public (AGE-трап; для повторного выката no-op).
  - `20260617010000_bitrix_rolling_summary_crm_notes` — `rollingSummary`/`rollingSummaryAt` на `BitrixDialog` И `ChatboxChat` + зеркала `BitrixLead`/`BitrixCrmNote`.
  - `20260617020000_bitrix_source_type` — `ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'bitrix'`. ⚠ `ADD VALUE` не-транзакционна → отдельный файл; идемпотентна.
  - `20260617030000_bitrix_crm_delta` (Ф4b) — колонка `modifiedAt` + индекс `[tenantId, modifiedAt]` на `BitrixContact/Company/Deal/Lead` + курсоры `lastCrmSyncAt`/`lastCrmDigestAt` на `BitrixIntegration` (дельта-синк CRM + посуточный дайджест).
  - **В STEPS агрегатора регистрировать НЕ нужно** (миграции схемы, не seed/patch/backfill).
- **Шаг 12 — Smoke** (после выката):
  - В логах backend при старте: `BitrixSyncWorker запущен (bitrix.sync)` и `BitrixAnalyzeWorker запущен (bitrix.analyze)` (in-process воркеры в `WorkersModule`).
  - Новые BullMQ-очереди: `bitrix.sync`, `bitrix.analyze`. Кроны `@Cron 00:00`: `BitrixSyncCron` (синк connected-порталов), `BitrixAnalyzeCron` (анализ закрытых сессий + **посуточный CRM-дайджест Ф4b** `ingestCrmDigests`, гейт `bitrix.enabled`+`analysisEnabled`).
  - Новые REST (Swagger tag `bitrix`): `GET /api/v1/bitrix/integration/status`, `PATCH .../analysis`, `GET .../users`, `PATCH .../users/:externalId/link`, `POST .../sync?scope=all|users|dialogs|crm`.
  - Фронт: `/company-admin/sources/bitrix` (стеклянная страница) + `/company-admin/sources/bitrix/managers` (сопоставление сотрудников).
- **LLM сам не побежит:** анализ гейтится `analysisEnabled` + наличием подключённого портала. Дефолт `analysisEnabled=true`, но без connected-интеграции крон/синк ничего не ставят. Включение для существующих — через тумблер на странице источника.
- **Отложено (Ф4b):** CRM посуточный дайджест — нужна дельта по `DATE_MODIFY` + `modifiedAt`/курсор + решение владельца по глубине/периоду. См. `second-brain/04_не-сделано/README.md`.

---

### 🔌 2026-06-17 — Bitrix24 SSR-установка из маркета + фиксы синка + sync-state + сотрудники/клиенты

> Контракт: ветка `bitrixNext`, коммиты `b25802e0`, `efb09fa5`, `1f7021f5`. ТЗ:
> `plans/tz/2026-06-17-bitrix24-install-ssr-and-recovery.md`. Рефлексия:
> `second-brain/05_история/2026-06-17-bitrix-install-chatbox-sync-fixes.md`.

- **Шаг 1 — ENV — проверить на проде:**
  - `PUBLIC_HOST_URL` = публичный домен бэка (Bitrix install/oauth/event URL; пусто → фолбэк на `PUBLIC_FRONTEND_URL`). В dev — туннель.
  - `BITRIX_CLIENT_ID` / `BITRIX_CLIENT_SECRET` — **обязательны** (refresh access-token; без них синк умирает через ~1ч). Заведены ранее — убедиться, что заполнены.
  - Партнёрский кабинет Bitrix: обработчик установки `{PUBLIC_HOST_URL}/api/v1/bitrix/install/handler`, событие `.../install/event`, redirect_uri `.../oauth/callback`; scope `crm,user_basic,im`.
- **Шаг 4 — Prisma — авто** (`migrate deploy`): `20260617130000_task_closure_candidate_to_public` — идемпотентный AGE-перенос `ag_catalog."TaskClosureCandidate"` → public (тот же класс трапа, что `..._bitrix_age_schema_fix`, но для таблицы из не-bitrix-миграции `..._task_closure_candidate`). Прочие pending-миграции ветки (`frozen_persona`, `task_dedup`, `issue_closure_review`, `goal_embedding`) — аддитивные, авто.
- **Шаг 12 — Smoke:**
  - Новые REST: `POST /api/v1/bitrix/install/bind`, `POST /api/v1/bitrix/integration/claim-by-domain`; `GET /api/v1/bitrix/integration/status` и `GET /api/v1/chatbox/integration/sync/status` теперь несут `runningScopes`/`activeSyncScope`.
  - Фронт: `/accounts/magic-link/consume` (вход по одноразовой ссылке из iframe-визарда).
  - В логах при старте: `Bitrix24 install URLs (партнёрский кабинет): handler=… event=… oauthCallback=…`.
- **Код-фиксы (прод-шагов НЕ требуют):** `queue.remove(jobId)` перед `add` (bitrix+chatbox — фикс «повторный синк не запускается»); клиенты ChatBox → `Person.relationship=external`; менеджеры → `employee`; sync-state из BullMQ; разделение сотрудники/клиенты в директории «Команда».

---

### 🧠 2026-06-17 — База знаний: форматтер на создании карточки + редизайн раздела (Ф1–Ф6)

> Контракт: ветка `feature/knowledge-base-redesign-formatter`, коммиты `6e98d3a8..28b6217e` (8 коммитов: Ф1 форматтер-на-создании, Ф2 backfill, Ф3 граница промпта, Ф6 docType→hint, Ф4 нейминг, Ф5a backend-kill-switch, Ф5b редизайн). ТЗ: `plans/tz/2026-06-16-knowledge-base-redesign-and-formatter-tz.md`. second-brain: `01_projects/regulations.md`, `02_architecture/knowledge-core.md`, `03_processes/specialist-3-1-regulations.md`. Реестр флагов — `docs/operations/feature-flags.md` (новая строка `knowledge_base.redesign.enabled`).
>
> **Зачем для прода:** раздел «Правила, процессы и политики» читался как лог экстракции (сырой одноабзацный `statement` в теле, узкая master-detail раскладка). Чиним 4 вектора: (Ф1) компилятор `compile-org-document` теперь зовётся на СОЗДАНИИ карточки (reg/proc/pol/instr), а не только на merge → каждая карточка структурна с v1 + CardVersion; (Ф2) разовый backfill переразмечает старые плоские карточки; (Ф3) граница regulation↔policy в промпте экстрактора; (Ф6) ручная загрузка `docType→signalTypeHint` — документ детерминированно доходит до Specialist 3.1; (Ф4) нейминг «База знаний компании» + таксономия + неконфликтные счётчики; (Ф5) редизайн раскладки (широкая оболочка + дерево + колонка чтения + TOC + тумблер ширины) за kill-switch.
>
> **Миграций БД НЕТ.** **1 новый kill-switch (`knowledge_base.redesign.enabled`, тип «аварийный рубильник», ON).** **1 seed + 1 backfill (оба в STEPS).** **Docker rebuild backend+frontend обязателен.**

- **Шаг 1 — AdminSetting / feature-flag (новый kill-switch, ON, действий владельца НЕ требует):** `knowledge_base.redesign.enabled` (zBool, code-default `true`) — новая раскладка раздела «База знаний». Едет на фронт через `/regulations/summary.redesignEnabled`; OFF → прежняя master-detail раскладка. Реестр — `docs/operations/feature-flags.md`. Доезжает seed'ом (Шаг 7).
- **Шаг 4 — Prisma** — **миграций НЕТ** (CardVersion на создании использует существующую модель `CardVersion`; новых колонок/таблиц нет). Регистрировать нечего.
- **Шаг 7 — Seed (1 прогон AdminSetting, идемпотентный, в STEPS `phase:'seed-base'`):** `seed-admin-setting-knowledge-base-redesign.ts` (`knowledge_base.redesign.enabled=true`; защита admin-override). Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 8 — Backfill (1 прогон, идемпотентный, в STEPS `phase:'backfill'`, `skipBootstrap`):** `backfill-compile-flat-cards.ts` — переразмечает старые плоские карточки (reg/proc/pol/instr без `## `/таблицы) структурным компилятором + CardVersion. Прогон тем же агрегатором (`--mode update`). Идемпотентен (структурные пропускаются → повтор = 0). ⚠️ **Faithfulness-проверка перед массовым прогоном:** сначала `docker compose exec backend bun run scripts/backfill-compile-flat-cards.ts --dry-run --limit=20` (покажет кандидатов без LLM/записи), глазами сверить выборку; затем агрегатор. Уважает kill-switch `docCompilerEnabled` (OFF → backfill пропущен).
- **Шаг 11 — Docker rebuild** — обязателен (Ф1 компилятор на создании в `core.specialist-routing`, Ф3 промпт экстрактора, Ф6 адаптер документов, Ф5a поле `redesignEnabled` в summary; фронт — Ф4 нейминг + Ф5b новая раскладка): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката):
  - (а) **Форматтер на создании:** создать/дождаться новой карточки regulation из встречи → тело содержит markdown-структуру (`## ` или таблица `| `), не сырой одноабзацный текст;
  - (б) **Ручная загрузка:** загрузить документ с `docType='regulation'` → карточка появляется на `/regulations` (а не оседает только в `/documents`);
  - (в) `GET /api/v1/regulations/summary` отдаёт поле `redesignEnabled: true`;
  - (г) `/regulations` рендерит новую раскладку (широкая оболочка + дерево-папки слева + читаемая колонка + правый TOC + тумблер «Чтение/Широкий»); проверить читаемость в светлой И тёмной теме (переключатель внешнего вида в Настройках);
  - (д) `GET /admin/settings` содержит `knowledge_base.redesign.enabled=true`.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 📊 2026-06-16 — Подключение агентов «Операционного директора» к UI (доска «Аналитика»)

> Контракт: ветка `feature/coo-orphan-agents-wire`, коммиты `ac56ce2b..b44229ae` (Ф1–Ф8). ТЗ: `plans/tz/2026-06-15-coo-orphan-agents-wire-to-operations-board.md`. second-brain: `01_projects/director-dashboard.md` (§«Доска «Аналитика»»). Реестр флагов — `docs/operations/feature-flags.md` (убрана строка `deliver_to_telegram`).
>
> **Зачем для прода:** бэкенд COO почти весь уже считал данные, но часть результатов была «осиротевшей» (код есть, потребителя на экране нет). Этот выкат подключает готовое к доске `/dashboard/operations` (переименована в «Аналитика»): 6 pulse-виджетов, «Доведение решений», «Клиенты под риском», «Знания под риском», «Перегруз ответственностью», оживлены мёртвые сигналы (факторы вовлечённости команд, сеть обещаний), починены 2 заглушки данных (`team-detail.goals`, `team-health.decisions`), дневная сводка COO начинает доставляться в каналы по умолчанию.
>
> **Миграций БД НЕТ** (все поля/модели уже в схеме). **Seed/patch/backfill на запуск НЕТ.** **Новых OFF-флагов НЕТ** (Ship-On). **1 ENV удалена** (`COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM`). **Docker rebuild backend+frontend обязателен.**

- **Шаг 1 — ENV (удалить 1, действий владельца не требует):** `COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM` удалена из `env.schema.ts` (Ф8, Ship-On — OFF-дефолт нарушал принцип). Если задана в прод-`.env` — можно удалить строку (лишняя ENV не ломает запуск; `EnvSchema` её больше не валидирует). Оставшаяся в проде AdminSetting `operations.daily_digest.deliver_to_telegram` безвредна (можно удалить вручную позднее). Новых ENV нет. ⚠️ **Стелс-эффект:** после выката дневная сводка COO начнёт доставляться owner/coo во все привязанные каналы по умолчанию (in_app + Telegram/email/MAX по привязкам); контроль — персональной галочкой «Ежедневная сводка компании» в кабинете (Настройки → Уведомления). Kill-switch `operations.daily_digest.enabled` остаётся.
- **Шаг 4 — Prisma** — **миграций НЕТ** (все поля/модели уже в схеме: `Goal.ownerPersonId`, `Person.primaryDepartmentId`, `Department.healthSummaryJson`, `PromiseNetworkSnapshot`). Регистрировать нечего.
- **Seed / patch / backfill — НЕТ.** Регистрировать в `apply-prod-deploy.ts` STEPS нечего.
- **Шаг 11 — Docker rebuild** — обязателен (новые эндпоинты `GET /dashboard/operations/promise-network` + `GET /me/notification-preferences`, backend-доводки goals/decisions/team-health/knowledge-at-risk, фронт — новый пункт меню «Аналитика» + риск-виджеты + персональная галочка): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката):
  - (а) Swagger `/api/docs` содержит `GET /api/v1/dashboard/operations/promise-network` и `GET /api/v1/me/notification-preferences`;
  - (б) доска `/dashboard/operations` достижима из меню под меткой **«Аналитика»** (раздел «Ритмы», после «Сегодня») и рендерит риск-виджеты (клиенты под риском / знания под риском / перегруз ответственностью);
  - (в) `GET /api/v1/me/notification-preferences` отдаёт `{ optOutEventTypes, quietHoursStart, quietHoursEnd }` (не 500);
  - (г) тумблер «Ежедневная сводка компании» рендерится в Настройки → Уведомления; снятие шлёт `PATCH /me/notification-preferences` с `operations.daily_digest` в `optOutEventTypes` (push перестаёт приходить, сводка остаётся в кабинете).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🧬 2026-06-16 — Один человек = один клон должности (Раздел 7) + ревизия 12 промптов клона + 21 баг конвейера M5

> Контракт: ветка `devsv`, 9 коммитов (`80ce250a..8168d915`). ТЗ: `plans/tz/2026-06-16-clone-agents-prompt-revision.md` (Раздел 7 + Раздел 8 + Приложения A–D). second-brain: `02_architecture/data-model.md` §«PersonaStatus += frozen», `02_architecture/module-map.md`, `02_architecture/agent-modules.md`, `01_projects/skill-and-clone.md` §«Доработки 2026-06-16», `01_projects/api-layer.md`, `01_projects/ai-jobs.md`, `01_projects/workers-queues.md`.
>
> **Зачем для прода:** клон роли переосмыслен как снимок ОДНОГО текущего носителя должности (без агрегации нескольких людей); прошлый носитель замораживается (`frozen`, read-only) и остаётся доступным навсегда («совет бывших»), имя — «Клон <Должность> v<N>» без ФИО. Плюс ревизия 12 промптов клона (якорь смысла + few-shot + self-check, всё в стабильный SYSTEM) и фиксы 21 бага конвейера M5 (застой черт, дрейф traitCount, версионирование, бюджеты кронов).

- **Шаг 1 — ENV / флаги — НЕТ** (новых ENV и флагов нет; промпты — code-fallback, едут с билдом).
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260616160000_add_frozen_persona_status`, `prisma migrate deploy` в migrate-контейнере на `docker compose up`): `ALTER TYPE "PersonaStatus" ADD VALUE IF NOT EXISTS 'frozen'`. Аддитивна, идемпотентна (`IF NOT EXISTS`). ⚠ `ADD VALUE` **не-транзакционна** → вынесена в отдельную миграцию (нельзя использовать новое enum-значение в той же транзакции). **В STEPS агрегатора регистрировать НЕ нужно** (миграция схемы).
- **Шаг 5 — postgres-init.sql — partial-unique (новый, self-skip):** `executable_personas_one_active_per_role` — `UNIQUE (scopeRefId) WHERE scope='role' AND status='active'` (ровно одна active-персона на должность; образец self-skip — `persons_tenant_email_active_uniq`). **Self-skip:** если на момент прогона есть роли с >1 active-клоном — блок делает `RAISE NOTICE` и пропускает создание; индекс встанет на следующем прогоне `postgres-init` **после** backfill Шага 8 (он заморозит лишние active). Применяется: `docker compose exec backend bun run apply-postgres-init` (идемпотентно, `CREATE INDEX IF NOT EXISTS`; на штатном `up -d` агрегатор гоняет его сам).
- **Шаг 8 — Backfill** — **1 новый, идемпотентный, в STEPS** (`phase:'backfill'`, `skipBootstrap:true`): `docker compose exec backend bun run scripts/backfill-role-clone-single-bearer.ts` — дедуп active-дублей клона роли → frozen, `superseded` → frozen, пересборка агрегатов snapshot'ом единственного текущего носителя (single-bearer). Идемпотентен (повтор → 0). Флаг `--skip-rebuild` — прогнать без LLM-пересборки (только дедуп/freeze). Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`. **Порядок:** backfill → затем повторный `apply-postgres-init` (чтобы self-skip-индекс Шага 5 встал).
- **Шаг 11 — Docker rebuild** — обязателен (переписаны промпты клона M5, `clones`-сервис/контроллер, конвейер черт/концептов/принципов/кронов, фронт — frozen-бейдж/спросить версию/совет бывших): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката):
  - (а) Swagger `/api/docs` содержит `POST /api/v1/clones/roles/{roleId}/ask-all-formers`; у `POST /api/v1/clones/roles/{roleId}/ask` в схеме body есть опц. `roleVersion`.
  - (б) `psql`/`diag`: `SELECT enum_range(NULL::"PersonaStatus")` содержит `frozen`; индекс `executable_personas_one_active_per_role` существует (или `RAISE NOTICE` о дублях — тогда прогнать Шаг 8 и повторить Шаг 5).
  - (в) на экране должности с несколькими бывшими носителями — список версий (active + frozen) без ФИО, кнопка «спросить версию» и экран «Совет бывших» отвечают.
  - (г) в логах backend — нет вечного re-verify застрявших черт (Б1) и runaway-реэмита `role.bearer_changed` (Б16).

---

### 🧠 2026-06-17 — Модуль усвоения (knowledge-core) MASTER: промпты + аудит-фиксы + дедуп задач (волны 0–6)

> Контракт: ветка `feature/knowledge-core-master`, 18 коммитов (`ee96aea7`..`9c5218aa`). ТЗ: `plans/tz/2026-06-16-knowledge-core-MASTER.md` (зонтик) + 6 промпт-ТЗ + `plans/tz/2026-06-16-task-dedup-and-tracker-reconcile.md`. Отложено: `plans/tz/2026-06-17-knowledge-core-queue-dlq-per-queue-config.md` (G5, DLQ/per-queue — vNext). second-brain: `02_architecture/data-model.md`, `01_projects/ai-jobs.md`, `01_projects/workers-queues.md`, `01_projects/api-layer.md`, `02_architecture/module-map.md`, `04_не-сделано/README.md`.
>
> **Зачем для прода:** закрыты 59 аудит-багов (4 HIGH потери/утечки данных, 36 MED, 19 LOW); 30 промптов knowledge-core переписаны по методологии; реализован дедуп задач + петля «разговор→кандидат закрытия» (task-dedup, 6 фаз Ф0–Ф5); закрыты пробелы покрытия G1–G8 (в т.ч. обход платного `feature.graph` — G1, выручка).
>
> **4 миграции (авто). postgres-init: 4 partial-unique + 1 HNSW. 2 seed-маршрута + 1 backfill (все в STEPS). Новые ENV — опц., default. Docker rebuild backend обязателен.**

- **Шаг 1 — ENV (опц., code-default — действий владельца НЕ требуют):** `TASK_RECONCILE_ENABLED` (kill-switch суточного task-reconcile-крона, default `true`); `ROUTER_FALLBACK_NEGATIVE_TTL_SECONDS` (negative-cache LLM-fallback, default 60 — весь fallback OFF по `ROUTER_LLM_FALLBACK_ENABLED=false`). Реестр — `docs/operations/feature-flags.md`.
- **Шаг 1 — AdminSetting (опц., code-fallback — без сида работает на дефолтах):** `taskDedup.suggestThreshold` (0.88), `taskDedup.embedTimeoutMs`, `taskClosure.matchThreshold` (0.85), `taskClosure.autoConfirmThreshold` (0.95), `taskClosure.reopenRateAlert` (0.10), kill-switch'и `taskDedup.enabled` / `taskClosure.enabled` (ON). Доезжают перепрогоном агрегатора (уважает admin-override).
- **Шаг 4 — Prisma (обязательно, авто — `prisma migrate deploy` в migrate-контейнере на `up`):** 4 аддитивные миграции (без потери данных): `20260616233329_task_dedup_intake_suggested_duplicate` (IntakeIssue.suggestedDuplicateOfIssueId), `20260617000614_task_closure_candidate` (модель TaskClosureCandidate), `20260617002427_issue_closure_review` (Issue.closureReviewState/Reason/At + индекс), `20260617005105_goal_embedding` (Goal.embedding `vector(1536)` + embeddingHash).
- **Шаг 5 — postgres-init.sql (через `docker compose exec backend bun run apply-postgres-init`, идемпотентно; агрегатор на `up` гоняет сам):** 4 новых partial-unique (K1, защита от гонки дублей): `uq_conflict_open`, `uq_knowledge_group_singleton`, `uq_executable_persona_role_version`, `uq_executable_persona_role_active`; 1 HNSW: `goal_embedding_hnsw_cosine_idx` (Ф5, KNN-дедуп целей).
- **Шаг 7 — Seed (2 LLM-маршрута, идемпотентны, в STEPS `phase:'seed-llm-routes'`):** `seed-llm-task-routes-task-dedup-arbiter.ts`, `seed-llm-task-routes-task-closure-verify.ts` (CHEAP_CHAIN). Прогон одним агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 8 — Backfill (в STEPS `phase:'backfill'`, идемпотентен):** `backfill-goal-embeddings.ts` — посчитать `Goal.embedding` существующим целям (повтор = no-op; пропускает уже с embedding). Выполнится тем же `apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild backend** обязателен (4 модели/колонки в PrismaClient; новые cron `BlockDistillReconcileCron`/`TaskReconcileCron`, worker `GoalEmbedWorker` + очередь `core.goal-embed`; **удалена** очередь `core.idea-clusterer`; 2 новых taskType; новые pending-провайдеры `task_closure`/`task_review`; entitlement-гард на граф-эндпоинтах; 30 переписанных промптов): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката):
  - (а) `/admin/ai-models` содержит `task-dedup-arbiter` и `task-closure-verify`;
  - (б) логи backend: подняты `BlockDistillReconcileCron` (каждые 30 мин), `TaskReconcileCron` (03:00), `GoalEmbedWorker` (очередь `core.goal-embed`); нет ошибок от удалённой `core.idea-clusterer`;
  - (в) FREE-тариф: `GET /api/v1/knowledge/entities/:id/graph` и `/blocks/:id/links` → 403 `entitlement_required` (платный `feature.graph` больше не обходится); на платном — 200;
  - (г) `/search` при штатном эмбеддинге работает; при рассинхроне размерности модели — не 500, а деградация на BM25 (WARN в логах);
  - (д) сигнал «сделал задачу X» из разговора → кандидат `task_closure` в очереди подтверждений (Issue НЕ закрыта); supersede решения → связанные задачи помечены `task_review` (не закрыты/не отменены).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🐛 2026-06-16 — QA-багфиксы кабинета (пакет по итогам полного обхода)

> Контракт: ветка `fix/qa-cabinet-bugfix-2026-06-16`, коммиты `e42b4ec3` (фронт), `9fa1ea12` (навигация настроек), `cf20473c` (бэкенд). ТЗ: `plans/tz/2026-06-16-qa-cabinet-bugfix-pack.md`.
>
> **Зачем для прода:** устранены видимые пользователю дефекты (сырой Markdown/таблицы в AI-отчётах встреч, биллинг «tier_standard», остатки бренда Z→Кора, англицизмы, склонения числительных, дубли навигации настроек, технический мусор в /actions) + критичный ночной ERROR 42P01 (`idea_blocks`).

- **Backfill (НОВЫЙ, в STEPS):** `docker compose exec backend bun run scripts/backfill-rename-z-sources.ts` — переименование дефолтных `Source` «Встречи Z»→«Встречи», «Трекер Z»→«Трекер» у существующих Org. Идемпотентен (повтор → 0). Зарегистрирован в `apply-prod-deploy.ts` (`phase:'backfill'`, `skipBootstrap:true`) → прогон `--mode update` выполнит автоматически.
- **Миграций / новых ENV / seed / patch — НЕТ.** Фикс `idea_blocks` — только raw SQL в коде (`domain-expander.cron.ts` → таблица `"IdeaBlock"`, колонка `tags`), схема НЕ менялась.
- **Docker rebuild backend+frontend ОБЯЗАТЕЛЕН** (код фронта и бэка).
- **Smoke:** (а) AI-отчёт встречи `/meetings/<id>/result` — Markdown и таблица «Возражения» рендерятся форматированными (не сырой `| col |`); (б) `/settings/billing` — тариф «Стандартный» (не «tier_standard»); (в) прод-логи в 04:00 UTC — нет ERROR `relation "idea_blocks" does not exist`.

---

### 🧠 2026-06-15 — Помощник = единый мозг каналов: дедуп понимания/синтеза + единый промпт chat-v2 + таблицы (цепочка из 5 ТЗ)

> Контракт: ветка `feature/dialog-chat-assistant-chain`, коммиты `3f63f7c1` (ТЗ#1 dialog-layer), `13b0cd9c`+`5e3498f9` (ТЗ#2A/2B chat-v2), `f49e7212` (ТЗ#3 concierge), `33ae43aa` (ТЗ#4 channels-sync), `4e9f1fec` (ТЗ#5 cabinet) + доп-фиксы `dfb82a6f` (Ф7 intent-questions), `b207743d` (issue-move). ТЗ: `plans/archive/2026-06-14-dialog-layer-unified-query-understanding.md`, `plans/archive/2026-06-15-chat-v2-unified-answer-prompt.md`, `plans/archive/2026-06-14-assistant-router-dedup-and-prompt.md`, `plans/archive/2026-06-11-assistant-channels-telegram-max.md` (синхр. каналов), `plans/archive/2026-06-15-cabinet-assistant-clone-selector.md`, `plans/archive/2026-06-15-intent-questions-are-not-commitments.md`, `plans/archive/2026-06-15-issue-move-to-project.md`. second-brain: `01_projects/conversational-channels.md`, `02_architecture/module-map.md`, `01_projects/api-layer.md`, `01_projects/tracker.md`, `01_projects/frontend-pages.md`. Реестр флагов / крутилок — `docs/operations/feature-flags.md`.
>
> **Зачем для прода:** помощник перестаёт быть «вторым мозгом» — понимание запроса и синтез считаются ОДИН раз, внутри chat-v2 (убран дубль помощник↔chat-v2). chat-v2 переведён на один промпт-ответчик без режимов + человеческий русский контекст + умные таблицы как параллельный источник. Помощник — развилка + руки: `ask_chat_v2` терминальный, новые инструменты `create_task`/`search_tasks`/`ingest_note` вместо `search_knowledge`. Постановка задач из Telegram переведена на помощника (интенты `task`/`show_tasks` убраны из классификатора). В кабинете — селектор «помощник / клон должности» на `/chat`.
>
> **Миграций БД НЕТ.** **1 ENV удалена (`CONTEXTUALIZER_CONFIDENCE_MIN`).** **Новых флагов НЕТ** (kill-switch'и `ASSISTANT_CHANNEL_ROUTING_ENABLED` / `CONCIERGE_NATIVE_TOOLS_ENABLED` и пр. уже на проде). **3 seed-прогона AdminSetting (все в STEPS).** **Docker rebuild backend+frontend обязателен.**

- **Шаг 1 — ENV (удалить 1, действий владельца не требует):** `CONTEXTUALIZER_CONFIDENCE_MIN` удалена из `env.schema.ts` (слитый dialog-layer убрал `ContextualizerService`/`ConfidenceEstimatorService`). Если она задана в прод-`.env` — можно удалить строку (лишняя ENV не ломает запуск; `EnvSchema` её больше не валидирует). Также формально мёртв `CONCIERGE_DIALOG_LAYER_ENABLED` (concierge больше не зовёт dialog-layer) — ничего не гейтит, удаление по желанию. Новых ENV нет.
- **Шаг 1 — AdminSetting (новые крутилки, code-default есть — действий владельца НЕ требуют):** `dialog_layer.query_history_pairs` (4), `concierge.history_pairs` (4), `concierge.clarify_min_confidence` (80), `chat_v2.table_context_max_rows` (20), `chat_v2.table_context_max_tables` (2). Доезжают перепрогоном агрегатора (Шаг 7; уважает admin-override). Реестр — `docs/operations/feature-flags.md` §Крутилки.
- **Шаг 4 — Prisma** — **миграций НЕТ** (новый эндпоинт `POST /me/tasks` использует существующие модели трекера). Регистрировать нечего.
- **Шаг 7 — Seed (3 прогона AdminSetting, идемпотентные, все в STEPS, `phase:'seed-base'`):** `seed-admin-setting-dialog-layer.ts` (`dialog_layer.query_history_pairs=4`), `seed-admin-setting-concierge.ts` (`concierge.history_pairs=4` + `concierge.clarify_min_confidence=80`), `seed-admin-setting-chat-v2-tables.ts` (`chat_v2.table_context_max_rows=20` + `max_tables=2`). Прогон одним агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (переписаны concierge/chat-v2/dialog-layer-сервисы и промпты, новый контроллер `POST /me/tasks`, удалены прежние промпты режимов, фронт — селектор клона): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката):
  - (а) **Telegram → ответ помощника:** написать боту вопрос «что у нас по проекту X?» → приходит текстовый ответ (через `ask_chat_v2`), не молчание;
  - (б) **Telegram → задача себе:** написать «поставь задачу позвонить клиенту завтра» → помощник создаёт задачу через `create_task` (появляется в `GET /me/inbox` / «Мои задачи»), не уходит в free_note и не перехватывается старым классификатором;
  - (в) **chat-v2 единым промптом:** `POST /api/v1/chat-v2/messages` (scope org) отвечает одним промптом без латиницы-кодов/английских тегов в выводе; при наличии умной таблицы с релевантными строками ответ опирается на «Данные из таблиц»;
  - (г) Swagger `/api/docs` содержит `POST /api/v1/me/tasks`;
  - (д) в логах backend нет ошибок инициализации от удалённых `ContextualizerService`/`ConfidenceEstimatorService` (модуль `dialog-layer` поднялся со слитым `query-understand`).

#### Доп-фиксы поверх цепочки (2 коммита)

> Контракт: та же ветка `feature/dialog-chat-assistant-chain`, коммиты `dfb82a6f` (Ф7 intent-questions), `b207743d` (issue-move-to-project). ТЗ: `plans/archive/2026-06-15-intent-questions-are-not-commitments.md`, `plans/archive/2026-06-15-issue-move-to-project.md`. second-brain: `01_projects/api-layer.md`, `01_projects/tracker.md`.

- **Ф7 — вопросы/команды сотрудников ≠ кандидаты в задачи — ПРОД-ОПЕРАЦИЙ НЕТ.** Калибровка LLM-классификатора интента: константа `NOT_A_TASK_DISCRIMINATOR` в хвосте SYSTEM-промптов (`common.ts` → `telegram-task-parser.service.ts` главный источник + `tasks-unified.ts` встречи/ChatBox); ChatBox теперь пишет в `Task`, не в `IntakeIssue`. Промпт — code-fallback/registry (не seed). Миграций/ENV/seed/patch нет. `smoke-tasks-unified-battery.ts` — полевой smoke (в `apply-prod-deploy.ts` STEPS НЕ регистрируется). Достаточно `docker compose up -d --build backend`. **Smoke:** написать боту «какие у меня задачи?» → НЕ появляется кандидат в очереди «Кандидаты в задачи» (читается как вопрос/команда, не обещание).
- **issue-move — перенос задачи в другой проект — МИГРАЦИЙ НЕТ** (новый эндпоинт `POST /api/v1/issues/:id/move` на существующих моделях `Issue`). RBAC `issue`/`write`; ре-аллокация `sequenceId`/`identifier`, ремап `state` по category, `board`=дефолт, `cycle`=null; запрет переноса задач с подзадачами; WS `IssueMovedToProjectEvent` + метрика `issue_moved_to_project_total`. Фронт: `ProjectPickerDialog` (`src/ui/tracker`) + строка «Проект · Перенести» в `IssueSidebar`. Seed/patch/backfill/ENV нет. **Rebuild backend+frontend:** `docker compose up -d --build backend frontend`. **Smoke:** (а) Swagger `/api/docs` содержит `POST /api/v1/issues/:id/move`; (б) перенос задачи из проекта «Входящие» в другой проект меняет её префикс/`identifier` на целевой, она исчезает из «Входящих» и появляется в целевом проекте.
- **tasks-unified-workspace — рабочий стол «Задачи» — МИГРАЦИЙ/ENV/SEED НЕТ** (ТЗ `2026-06-18-tasks-unified-workspace-phase1.md`). 2 новых эндпоинта на существующих моделях: `GET /api/v1/issues` (`OrgIssuesController` — сквозной список задач org, видимость по роли/`Org.visibilityMode`, поле `stateCategory` в ответе) и `POST /api/v1/issues/:id/transition-to-category` (DnD доски «Все проекты», делегирует в `transitionState`). Видимость = существующий `Org.visibilityMode` (флаг не вводится). Фронт: `/projects` теперь рабочий стол (`TasksWorkspaceClient`, виды Доска/Список/Спринты/Входящие/Архив), `ProjectsListClient` удалён; новые `OrgBoard`/`useOrgIssues`. **Rebuild backend+frontend:** `docker compose up -d --build backend frontend`. **Smoke:** (а) Swagger `/api/docs` содержит `GET /api/v1/issues` и `POST /api/v1/issues/:id/transition-to-category`; (б) пункт меню «Задачи» открывает стол сразу с доской «Все проекты» (без промежуточного списка проектов); (в) под `manager`+`strict` в «Все проекты» видны только свои/созданные задачи, под owner — все.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🛠️ 2026-06-14 — Мастер-фиксы кабинета: рефералка + хаб «Оцифровано» (A/B/C)

> Контракт: ветка `feature/cabinet-master-fixes`, коммиты `dfb79211..fd0e8eeb` (8 коммитов). ТЗ: `plans/archive/2026-06-14-cabinet-master-fixes-referral-and-hub.md` (части A/B/C). second-brain: `01_projects/director-dashboard.md`, `01_projects/api-layer.md`, `01_projects/frontend-pages.md`. Реестр флагов — `docs/operations/feature-flags.md`.
>
> **Зачем для прода:** доработка кабинета по итогам аудита. (A) светлая тема доведена до конца — тема-зависимые токены поверхностей вместо белых оверлеев в modern-примитивах и ~24 файлах кабинета; ack «✓ Записано в память компании» на чек-ине; бейдж «Спросил руководитель» в Ленте Коры; синхронизация `/intake` с очередью решений; виджет «Висят без ответа ≥3 дней» на /week; CSV-экспорт «Скачать для планёрки»; merge отделов переносит FK (Metric/Interaction/OrgUnit/Entity); петля next-step→Issue с `IntakeIssue.sourceBlockIds`. (B) пункт меню «Партнёрка» (/referrals) вернулся в кабинет, persistent role-баннер «N из 3» вместо промо-полоски, редизайн кабинета рефералки на modern/, новый эндпоинт прогресса вознаграждения. (C) пункт меню «Оцифровано» (/regulations) — хаб с 4 типами норм + вкладкой шаблонов процессов + провенанс-цитатами + summary-виджетом на «Сегодня».
>
> **1 миграция (авто, аддитивная колонка).** **3 новых ENV (все с дефолтами — действий владельца НЕ требуют).** **Seed/patch/backfill новых нет.** **Docker rebuild backend+frontend обязателен.**

- **Шаг 1 — ENV (3 новых, рабочие дефолты — действий владельца НЕ требуют):**
  - `DASHBOARD_THEME_SILENCE_ENABLED` (zBool default `true`) — kill-switch детектора молчащих тем (оживлён: раньше флаг был мёртв). Аварийный откат: `=false` в `.env` + рестарт → cron `theme-silence-detector` no-op.
  - `DASHBOARD_THEME_SILENCE_WEEKS` (int default `3`) — порог недель молчания темы (раньше — только AdminSetting `dashboard.theme_silence_weeks`; ENV даёт прод-fallback).
  - `USE_APPOINTMENT_FOR_PERSON_ROLES` (zBool default `false`) — флаг миграции источника ролей `PersonRole`→`Appointment` (`persons.service` читает `cfg.persons.useAppointment`). Дефолт OFF — поведение не меняется до явного перевода. Реестр — `docs/operations/feature-flags.md`.
- **Шаг 1 — AdminSetting** — новых ключей нет (ENV-флаги Шага 1 имеют code-default).
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260614110154_add_intake_source_block_ids`, аддитивная, без потери данных, `prisma migrate deploy` в migrate-контейнере на `docker compose up`): `ALTER TABLE "IntakeIssue" ADD COLUMN "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[]` (петля next-step→Issue→DecisionTaskLink('derived')). Backfill НЕ нужен (default `ARRAY[]` = пустой массив для существующих строк). **В STEPS агрегатора регистрировать НЕ нужно** (миграция схемы, не seed/patch/backfill).
- **Seed / patch / backfill — НЕТ.** Регистрировать в `apply-prod-deploy.ts` STEPS нечего.
- **Шаг 11 — Docker rebuild** — обязателен (новая миграция в PrismaClient, новые контроллеры/эндпоинты, новые ENV, фронт — новые пункты меню + редизайн `/referrals` + хаб `/regulations`): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката):
  - (а) Swagger `/api/docs` содержит новые эндпоинты: `GET /api/v1/referrals/me/reward-progress`, `GET /api/v1/regulations/:id/sources`, `GET /api/v1/regulations/summary`;
  - (б) `GET /api/v1/referrals/me/reward-progress` отдаёт `{hasProfile, activePaying, targetClients, monthlyEarnedKopecks}` (не 500);
  - (в) `GET /api/v1/regulations/summary` отдаёт счётчики по 4 типам норм; `GET /api/v1/regulations/:id/sources?kind=` — провенанс-цитаты;
  - (г) меню кабинета содержит пункты «Партнёрка» (/referrals) и «Оцифровано» (/regulations); `/policies` редиректит на `/regulations?kind=policy`; дубля `/processes` в меню нет;
  - (д) светлая тема: в кабинете (modern-примитивы, /referrals, хаб) нет «светлое-на-светлом» от белых оверлеев — фон поверхностей берётся из тема-токенов.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🗂️ 2026-06-13 — Редизайн кабинета: ритмы (Сегодня/Неделя/Месяц) + очередь решений + Лента Коры (Ф0–Ф10)

> Контракт: ветка `feature/cabinet-redesign-rhythms`, 23 коммита. ТЗ: `plans/archive/2026-06-13-cabinet-redesign-rhythms-and-decision-queue.md` (Ф0–Ф10). second-brain: `05_история/2026-06-13-cabinet-redesign-implementation.md`, `01_projects/director-dashboard.md`. Реестр флагов — `docs/operations/feature-flags.md`.
>
> **Зачем для прода:** кабинет перестроен от «свалки меню + противоречивых дашбордов» к модели ритмов (Сегодня / Неделя / Месяц) + сквозной очереди решений «Требует вас». Единый источник навигации (десктоп+мобилка), новый экран «Сегодня» (VerdictBar + лента дня + чек-ин-плашка), очередь решений с inline-резолвом, /week табы, /month + PPTX-экспорт, авто-название встреч, поиск по памяти, мастер дедупа отделов, drill-down план-факта по людям, Лента Коры (`/feed/cora` + контроль вопросов), silence-детектор тем, светлая тема.
>
> **2 миграции (авто).** **Новая backend-зависимость `pptxgenjs@^4.0.1` (подтянется при rebuild образа).** **Новый kill-switch + 3 крутилки (все с дефолтами — действий владельца НЕ требуют).** **Новый taskType `meeting-title` (DEFAULT-цепочка, сид не нужен).** **Новый @Cron `theme-silence-detector`.** **ENV новых нет. Seed/patch/backfill новых нет.** **Docker rebuild backend+frontend обязателен.**

- **Шаг 1 — AdminSetting (новый kill-switch + крутилки, code-default есть — действий владельца НЕ требуют):**
  - `dashboard.theme_silence.enabled` (kill-switch, code-default `true`) — детектор молчащих тем. Аварийный откат: → `false` из `/admin/settings` → cron no-op.
  - `dashboard.theme_silence_weeks` (default `3`) — порог недель молчания темы.
  - `pendingActions.conflictTtlDays` (default `14`) / `pendingActions.intakeTtlDays` (default `14`) — TTL элементов очереди решений (sweep-крон убирает протухшие).
  - Реестр — `docs/operations/feature-flags.md`.
- **Шаг 1 — ENV** — **новых ENV нет.**
- **Шаг 1 — ⚙️ ВЛАДЕЛЕЦ (не блокер этого редизайна, напоминание):** VAPID-ключи web-push в проде (`npx web-push generate-vapid-keys` → `VAPID_*` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` в прод-`.env`). Без них web-push — graceful no-op (см. §«НЕ флаг, но ждёт прод-ENV: VAPID-ключи» в `feature-flags.md`). Этот пакет push-каналов не добавляет — строка справочная.
- **Шаг 4 — Prisma** — **обязательно, авто** (2 миграции, аддитивные, без потери данных, `prisma migrate deploy` в migrate-контейнере на `docker compose up`):
  - `add_expiresat_conflict_intake`: `ALTER TABLE` — добавляет nullable `expiresAt` на `ConflictItem` и `IntakeIssue` (TTL для очереди решений + sweep-крон). Backfill НЕ нужен (`null` = бессрочно до проставления sweep-кроном).
  - `feed_read_cursor`: новая таблица/колонка курсора прочтения Ленты Коры (`POST /feed/cora/seen`). Аддитивна.
  - **В STEPS агрегатора регистрировать НЕ нужно** (миграции схемы, не seed/patch/backfill).
- **Зависимость — `pptxgenjs@^4.0.1`** (backend `package.json`) — для PPTX-экспорта раздела «Месяц». Подтянется автоматически при пересборке образа (`docker compose up -d --build backend`). Отдельной prod-команды не требует.
- **Seed / patch / backfill — НЕТ.** Регистрировать в `apply-prod-deploy.ts` STEPS нечего. Новый taskType `meeting-title` НЕ требует сид-роута (идёт по DEFAULT-цепочке) — действий не требует.
- **Шаг 11 — Docker rebuild** — обязателен (новые миграции в PrismaClient, новый `@Cron('theme-silence-detector')`, новый sweep-крон очереди решений, новая зависимость `pptxgenjs`, новый taskType, новые контроллеры/эндпоинты): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката):
  - (а) в логах backend поднялся `@Cron('theme-silence-detector')`;
  - (б) Swagger `/api/docs` содержит новые эндпоинты: `GET /dashboard/operations/checkin-discipline`, `POST /pending-actions/confirm`, `GET /dashboard/operations/value-recap/:id/export?format=pptx`, `POST /meetings/:id/next-steps/to-intake`, `POST /departments/:id/merge`, `GET /dashboard/operations/weekly-per-person/:personId/items` (+ self `GET /me/...`), `GET /feed/cora`, `POST /feed/cora/seen`, `GET /probe/control`, `GET /decisions/stalled`;
  - (в) taskType `meeting-title` присутствует в реестре: `docker compose exec backend bun run scripts/diag-routes.ts | grep meeting-title` (ожидаемо — DEFAULT-цепочка, отдельного роута нет);
  - (г) PPTX-экспорт «Месяца» отдаёт файл (а не 500): `GET /dashboard/operations/value-recap/:id/export?format=pptx` → `Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation`;
  - (д) очередь решений «Требует вас» отдаёт 4 группы; `POST /pending-actions/confirm` резолвит элемент;
  - (е) светлая тема: переключатель не даёт «светлое-на-светлом» (визуальная доводка оттенков графиков на белом — за владельцем/qa, отдельная строка в реестре не-сделанного).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🤖 2026-06-12 — Единый помощник в каналах (Telegram/MAX) + автономизация подтверждений (W0–W4)

> Контракт: ветка `feature/assistant-channels-and-autonomy`, коммиты `cb285350..90f02a6e` (10 коммитов + фиксы ревью). ТЗ: `plans/archive/2026-06-11-assistant-channels-telegram-max.md` (Ф1–Ф6) + `plans/archive/2026-06-11-autonomy-remove-manual-confirmations.md` (W0–W4). second-brain: `01_projects/conversational-channels.md`, `02_architecture/module-map.md`, `02_architecture/data-model.md`, `01_projects/workers-queues.md`, `01_projects/ai-jobs.md`.
>
> **Зачем для прода:** (ТЗ-1) Telegram/MAX становятся окнами ЕДИНОГО мозга помощника: solicited-ответ AI-чата возвращается в канал-источник + ack на заметку (стоп-молчание); рендер 10+ проактивных eventType в обоих ботах; native function-calling (встроенный вызов инструментов) в concierge; service-auth путь ToolRouter (loopback); свободный текст/голос → ConciergeService (`assistant_turn`, память диалога per-binding в Redis 24ч); канальный whitelist self/manager + текстовое подтверждение мутаций. (ТЗ-2) гасим спам ручных подтверждений: одна сводка напоминаний в день (09:00), ночной LLM-арбитр конфликтов знаний, гейт ценности probe + маршрутизация NUDGE в дайджест, OwnerResolver (лестница владельца поля), intake авто-приём задач из всех каналов (порог 0.75, дефолт-проект «Входящие»).
>
> **1 миграция (авто, enum).** **3 новых ENV (все с дефолтами — действий владельца НЕ требуют).** **2 seed-прогона (оба в STEPS).** **Docker rebuild backend обязателен.**

- **Шаг 1 — ENV (2 kill-switch default ON + 1 опц. URL — действий владельца НЕ требуют):**
  - `CONCIERGE_NATIVE_TOOLS_ENABLED` (zBool default `true`) — native function-calling помощника. Аварийный откат: `=false` в `.env` + рестарт → прежняя regex-эмуляция tool_call в тексте.
  - `ASSISTANT_CHANNEL_ROUTING_ENABLED` (zBool default `true`) — свободный текст/голос Telegram/MAX → единый мозг (`assistant_turn`). Аварийный откат: `=false` + рестарт → прежний узкий классификатор бит-в-бит (чек-ин от флага не зависит).
  - `CONCIERGE_LOOPBACK_BASE_URL` (default `http://127.0.0.1:3000`) — базовый URL для loopback tool-вызовов в service-режиме; **задавать ТОЛЬКО если backend внутри контейнера слушает не :3000**.
  - Реестр — `docs/operations/feature-flags.md`.
- **Шаг 1 — AdminSetting (новые крутилки/дефолты, code-default есть — действий владельца НЕ требуют):** `probe.immediatePushMinPriority` (70), `probe.minValuePriority` (30), `knowledge.curationConflictArbiterEnabled` (true, kill-switch), `knowledge.curationConflictArbiterMinConfidence` (0.7), `knowledge.curationConflictArbiterBatchSize` (20), `pendingActions.reminderWindowEndHour` (9) / `pendingActions.reminderStepHours` (12) — одна сводка/день, `knowledge.curationAuditSampleRate` (0.05→0.01), `knowledge.curationAutotuneEnabled` (seed-дефолт → true). Доезжают перепрогоном `seed-admin-settings.ts` (Шаг 7; уважает admin-override).
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260612090000_probe_status_w2_autonomy`): `ALTER TYPE "ProbeStatus" ADD VALUE IF NOT EXISTS 'dropped_low_value'` + `'routed_to_digest'`. Аддитивна, идемпотентна (`IF NOT EXISTS`); `ADD VALUE` не-транзакционна → отдельный файл. Применяется `prisma migrate deploy` в migrate-контейнере на `docker compose up`. **В STEPS агрегатора регистрировать НЕ нужно** (миграция схемы).
- **Шаг 7 — Seed (2 прогона, идемпотентные, оба в STEPS):**
  - `docker compose exec backend bun run scripts/seed-llm-task-routes-conflict-arbiter.ts` — маршруты семейства `debate-conflict-arbiter` (`-critic`/`-supporter`/`-neutral`; cheap-цепочка как у curation-verify, supporter primary gpt-5.4-mini для diversity). В STEPS (`phase:'seed-llm-routes'`, alias `conflict-arbiter`).
  - `docker compose exec backend bun run scripts/seed-admin-settings.ts` — перепрогон: новые крутилки + новые дефолты из Шага 1. Уже в STEPS.
  - Либо одним прогоном агрегатора: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (новые enum-значения в PrismaClient, новые `ConflictArbiterCron` / `AssistantChannelBridge` / `OwnerResolver`, новые taskType, метрики): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката):
  - (а) в логах воркера поднялся новый `ConflictArbiterCron` (`@Cron('0 2 * * *')`);
  - (б) `docker compose logs backend | grep "AssistantChannelBridge: подписан"` — мост каналов подписан на inbound `assistant_turn`;
  - (в) вопрос свободным текстом из Telegram → ответ помощника приходит в Telegram (одним сообщением);
  - (г) уведомление `checkin.prompt` приходит текстом вопроса (не молчит);
  - (д) Swagger без изменений (новых REST-разделов нет);
  - (е) метрики тикают: `curl -s localhost:3000/metrics | grep -E "z_assistant_turn_total|z_conflict_arbiter_total|z_owner_resolution_total"`.

---

### 🧬 2026-06-12 — Слой метода клона (clone-persona-method-layer, Э0–ВАЛ)

> Контракт: ветка `feature/clone-persona-method-layer`, коммиты `6e8b470f..41289726` (8 фаз). ТЗ: `plans/archive/2026-06-11-clone-persona-method-layer.md`. second-brain: `01_projects/skill-and-clone.md` §«Доработки 2026-06-12», `02_architecture/data-model.md` §«Слой метода клона», `01_projects/ai-jobs.md`, `01_projects/workers-queues.md`, `01_projects/api-layer.md` §Clones.
>
> **Зачем для прода:** клон роли получает слой МЕТОДА работы. (Э0.1) grounding-гейт `clone-respond` — factual-ответ без опоры на наблюдения заменяется честным отказом (`'ungrounded'`), каждый вопрос клону пишется в журнал `CloneQueryLog` + новый `GET /api/v1/clones/query-log`. (Э1) ночной Reflection-синтез принципов роли (`RolePrinciple`, cron 05:30) + детектор ценностей/мотивации из trade-off. (Э2) активация PracticeSkill в ответах клона + детектор конструктивных маркеров процесса. (Э3) CDM-интервью носителя через probe (до 5 вопросов + cooldown 7 дн.). (ИНТ) persona-compile v2 — секционная сборка всех слоёв (пустые секции опускаются — деградация к v1). (ВАЛ) воскресная поведенческая A/B-оценка persona v1-vs-v2 (LLM-судья; только наблюдение, ничего не блокирует).
>
> **1 миграция (авто).** **1 новый HNSW-индекс (postgres-init).** **1 seed LLM-маршрутов (в STEPS).** **6 новых ENV-флагов — все default ON, в `.env` добавлять НИЧЕГО не нужно** (⚠ кроме проверки `PRACTICE_SKILLS_ENABLED`, см. Шаг 1). **Docker rebuild backend обязателен.**

- **Шаг 1 — ENV (6 новых kill-switch, все default `true` — действий владельца НЕ требуют, строки информативные):**
  - `CLONE_RESPOND_GROUNDING_ENABLED` (default true, действий не требует) — пост-LLM grounding-гейт clone-respond (отказ `'ungrounded'` без валидных цитат `[BLOCK:]`/`[DECISION:]`). Аварийный откат: `=false` + рестарт → поведение до Э0.1.
  - `ROLE_PRINCIPLE_SYNTHESIS_ENABLED` (default true, действий не требует) — Reflection-cron синтеза принципов роли (05:30).
  - `VALUE_MOTIVATION_DETECT_ENABLED` (default true, действий не требует) — детектор ценностей/мотивации в rebuild 3.7.
  - `PROCESS_MARKER_DETECT_ENABLED` (default true, действий не требует) — детектор маркеров процесса в rebuild 3.7.
  - `CDM_INTERVIEW_ENABLED` (default true, действий не требует) — CDM-интервью носителя через probe.
  - `PERSONA_LAYER_VALIDATION_ENABLED` (default true, действий не требует) — воскресная поведенческая валидация persona v1-vs-v2 (только наблюдение).
  - ⚠ **`PRACTICE_SKILLS_ENABLED` — СМЕНА ДЕФОЛТА false→true** (Э2.1: подмешивание процедур PracticeSkill в ответы клона). **Если в прод-`.env` стоит явная строка `PRACTICE_SKILLS_ENABLED=false` — УДАЛИТЬ её**, иначе фича останется выключенной (явный ENV перебивает новый code-default). Если строки в `.env` нет — действий не требуется.
  - Реестр всех — `docs/operations/feature-flags.md` (тип A kill-switch, ON).
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260612000000_clone_method_layer`, аддитивная, без потери данных, `prisma migrate deploy` в migrate-контейнере на `docker compose up`): новая таблица `role_principles` (модель `RolePrinciple` + enum `RolePrincipleStatus`) + новая таблица `clone_query_logs` (модель `CloneQueryLog`) + enum `SkillTraitLayer` + колонка `skill_traits.layer` (default `'skill'` — существующие черты получают `skill`) + индекс `[profileId, layer, status]`. Проверка после выката: таблицы `role_principles` и `clone_query_logs` созданы, `skill_traits.layer` имеет default `'skill'`. **В STEPS агрегатора регистрировать НЕ нужно** (миграция схемы, не seed/patch/backfill).
- **Шаг 5 — postgres-init.sql — HNSW** — новый: `role_principles_embedding_hnsw_cosine_idx ON "role_principles" USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL` (KNN cosine — дедуп принципов 0.85 при ресинтезе). Применяется: `docker compose exec backend bun run apply-postgres-init` (идемпотентно, `CREATE INDEX IF NOT EXISTS`; на штатном `up -d` агрегатор гоняет его сам).
- **Шаг 7 — Seed-маршруты — 1 новый, идемпотентный, в STEPS** (`phase:'seed-llm-routes'`, alias `'clone-method'`): `docker compose exec backend bun run scripts/seed-llm-task-routes-clone-method.ts` — 5 новых LLM-маршрутов: `role-principle-synthesize` + `cdm-case-interview` (capable: `deepseek-v4-pro` → `openai-via-proxy/gpt-5.4` → `ollama/qwen3:30b`), `value-motivation-detect` + `process-marker-detect` + `persona-behavior-judge` (flash: `deepseek-v4-flash` → `openai-via-proxy/gpt-5.4-mini` → `ollama/qwen3.5:9b`). Защищает `editedByAdmin`. Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (новые модели/enum в PrismaClient, 2 новых cron'а `RolePrincipleSynthesisCron`/`PersonaLayerValidationCron`, новый эндпоинт query-log, изменённые промпты clone-respond/persona-compile v2): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката):
  - (а) в логах backend поднялись `RolePrincipleSynthesisCron` и `PersonaLayerValidationCron`;
  - (б) после первого ночного cron (05:30) `RolePrinciple` непуст для активных ролей с накопленными reasoning-блоками: SQL `SELECT count(*) FROM role_principles;` > 0;
  - (в) persona роли (после пересборки) содержит секции «Мои принципы в типовых ситуациях» / «Типовые ситуации → как я действую»;
  - (г) клон без опоры отказывается: вопрос на тему вне наблюдений → программный отказ, в `clone_query_logs` запись с `refusalReason='ungrounded'`;
  - (д) `GET /api/v1/clones/query-log` (под owner/admin) отдаёт записи; Swagger `/api/docs` — тег `clones` содержит `query-log`;
  - (е) метрики тикают: `curl -s localhost:3000/metrics | grep -E "role_principles_|clone_persona_layer"`;
  - (ж) первые цифры A/B `clone_persona_layer_score{variant}` появятся после первого воскресного cron (вс 07:00).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🧩 2026-06-11 — Консолидация отчёта встречи + отчёт→граф + апгрейд 3 промптов

> Контракт: ветка `svdev`, коммиты `2501d72b` (Фаза 1 — консолидация), `13a6ac69` (Фаза 2 — отчёт→граф), `e4fded3c` (Фаза 3 — промпты). ТЗ: `plans/tz/2026-06-11-meeting-report-consolidation-graph-and-prompts.md` (Ф1/Ф3) + суб-ТЗ `plans/tz/2026-06-11-report-to-graph-phase2.md` (Ф2). second-brain: `02_architecture/knowledge-core.md` §«Отчёт встречи → граф», `02_architecture/data-model.md`, `02_architecture/module-map.md`, `01_projects/ai-jobs.md`, `01_projects/workers-queues.md`.
>
> **Зачем для прода:** (Ф1) единое ядро отчёта = `meeting-report-fast` (один LLM-вызов); удалены дублирующие воркеры/очереди `chapters`/`tasks-extract`/`quality-score` (качество теперь пишет fast в каноничную `MeetingQualityScore`). (Ф2) после готовности fast-отчёта его чистая выжимка + структурные выводы идут в граф как **вторичный** источник (`meeting_report`) с защитой от галлюцинаций (транскрипт всегда побеждает report при дедупе). (Ф3) апгрейд 3 промптов отчётов (code-промпты, едут с кодом — отдельной seed-операции НЕ требуют).
>
> **2 миграции (авто).** **1 новый ENV kill-switch (default ON) + 1 AdminSetting-крутилка (code-fallback).** **Seed/patch/backfill — НЕТ.** **Docker rebuild backend обязателен** (новый enum в PrismaClient + новый listener/event).

- **Шаг 1 — ENV (kill-switch, default ON — действий владельца НЕ требует):** `REPORT_INGEST_ENABLED` (Ship-On, default `true`). Мост отчёт→граф. Аварийный откат: `=false` в `.env` + рестарт → отчёт в граф не попадает (граф только из транскрипта; сам отчёт пользователю не затронут). Реестр — `docs/operations/feature-flags.md`.
- **Шаг 1 — AdminSetting (опц., code-fallback есть — действий владельца НЕ требует):** `knowledge.reportBlockConfidenceCap` (потолок уверенности report-блока в графе, code-fallback `0.6`). super_admin может изменить из `/admin/settings`. Сид не обязателен для выката (code-fallback активен).
- **Шаг 4 — Prisma** — **обязательно, авто** (2 миграции, аддитивные, без потери данных, `prisma migrate deploy` в migrate-контейнере на `docker compose up`):
  - `source_type_meeting_report`: `ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'meeting_report'` — **отдельным файлом** (`ADD VALUE` не-транзакционна; `IF NOT EXISTS` → повторный прогон безопасен).
  - `idea_block_primary_source`: `ALTER TABLE "IdeaBlock" ADD COLUMN "primarySource" VARCHAR(16)` — nullable, **backfill НЕ нужен** (`null` трактуется как `'transcript'` в коде). Порядок: enum-миграция → потом column-миграция. **В STEPS агрегатора регистрировать НЕ нужно** (это миграции схемы, не seed/patch/backfill).
- **Seed / patch / backfill — НЕТ.** Регистрировать в `apply-prod-deploy.ts` STEPS нечего.
- **Шаг 11 — Docker rebuild** — обязателен (новое значение enum `SourceType` в PrismaClient + новый `ReportIngestListener`/событие `meeting.report-fast-ready` + новое поле `IdeaBlock.primarySource`): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката):
  - (а) `docker compose exec backend grep -r "meeting.report-fast-ready" src/` — событие эмитится в `meeting-report-fast.worker` и слушается в `ReportIngestListener`;
  - (б) после готовности отчёта тестовой встречи в БД появляется `RawEvent(sourceType='meeting_report', sourceExternalId='report_<id>')` (один на встречу) и `IdeaBlock` с `primarySource='report'`, `confidence ≤ 0.6`;
  - (в) клиентский протокол (`client_protocol_md`) в граф НЕ попал (D6);
  - (г) главы/задачи/резюме/качество встречи видны (из `meeting-report-fast` + каноничной `MeetingQualityScore`), спиннер гаснет, дублей задач нет.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🔔 2026-06-11 — Probe-система Фаза 1 (формулировка + дайджест + recheck + fatigue + видимое следствие)

> Контракт: ветка `svdev`, коммиты `5ed78b54..fa950cd1` (6 под-фаз). ТЗ: `plans/tz/2026-06-11-probe-system-upgrade-phase1.md`. Анализ: `plans/analysis/2026-06-11-proactive-clarifying-questions-probe-research.md`.
>
> **Зачем для прода:** переработка проактивных уточняющих вопросов (probe). (Ф1) переписан промпт `probe-formulate` — человеческие формулировки без машинных кодов (schema `probe_formulate_v3`). (Ф2) политика по типу пробела (окно срочности + предикаты «пробел ещё открыт?»). (Ф3) deferrable-probe сверх бюджета не дропается, а копится в `queued_digest` → новый `ProbeDigestCron` шлёт ОДНО сводное уведомление «Вопросы от Коры» 1×/день. (Ф4) recheck повода перед dispatch — если пробел закрылся сам, probe не шлётся (`suppressed_stale`). (Ф5) adaptive fatigue — меньше беспокоить тех, кто не отвечает, + cooldown темы. (Ф6) подтверждение «ваш ответ записан» после ответа.
>
> **1 миграция (авто, enum).** **5 новых AdminSetting-крутилок (code-default, действий владельца НЕ требуют).** **Docker rebuild backend+frontend обязателен** (новый enum в PrismaClient, новый cron, новые eventType, метрика).

- **Шаг 1 — AdminSetting (5 крутилок, code-default есть — действий владельца НЕ требуют):** `probe.digestTouchCap` (5), `probe.digestHourUtc` (9 UTC), `probe.digestEnabled` (true, kill-switch), `probe.topicCooldownHours` (48), `probe.adaptiveFatigueEnabled` (true, kill-switch). Сид — `seed-admin-settings.ts` секция `probe` (опц., code-default активен — сид не обязателен для выката). Реестр флагов — `docs/operations/feature-flags.md` (`probe.digestEnabled` / `probe.adaptiveFatigueEnabled` — два kill-switch тип A).
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260611120000_probe_status_digest`): `ALTER TYPE "ProbeStatus" ADD VALUE 'queued_digest'` + `'suppressed_stale'`. Аддитивна, безопасна, идемпотентность через сам Prisma (`migrate deploy` пропускает применённую миграцию). ⚠ `ALTER TYPE ... ADD VALUE` **не-транзакционна** — вынесена в отдельную миграцию. Применяется `prisma migrate deploy` в migrate-контейнере на `docker compose up`. **В STEPS агрегатора регистрировать НЕ нужно** — это миграция схемы, не seed/patch/backfill.
- **Миграций / seed / patch / backfill (кроме enum выше) — НЕТ.**
- **Шаг 11 — Docker rebuild** — обязателен (новый enum-значение в PrismaClient, новый `ProbeDigestCron`, новые eventType `probe.digest` / `probe.answer_acknowledged` в `event-payload.registry.ts` + рендер telegram/max-bot, метрика `probe_outcome_total`; frontend: новые notification-label «Вопросы от Коры» / «Ответ записан»): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката):
  - (а) в логах backend поднялся `ProbeDigestCron`;
  - (б) метрика тикает: `curl -s localhost:3000/metrics | grep probe_outcome_total`;
  - (в) probe-вопрос в Telegram приходит **без машинных кодов / латиницы** (человеческая формулировка);
  - (г) после ответа на probe приходит подтверждение «ваш ответ записан в память компании».

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 📱💬 2026-06-11 — Остаток пакета: Мобильная Кора Ф2–Ф7 (exec/manager + голос + утренний web-push) · ChatBox блок A (виджет/метрики/парсер)

> Контракт: ветка `feature/remaining-handoff` (6 коммитов `9fcdc26c..daf72cbe` поверх фундамента `feature/finishable-now-2026-06-11`). ТЗ: `plans/tz/2026-06-11-mobile-cora-exec-manager.md`, `plans/tz/...chatbox-memory-finishing...` (блок A: Ф2/Ф3/Ф4). Handoff-ТЗ: `plans/tz/2026-06-11-remaining-handoff-finishable-now.md`.
>
> **Зачем для прода:** доводка остатка пакета «6 ТЗ» — два независимых направления. (1) **ChatBox блок A** — виджет «Чаты в памяти» на странице интеграции (новый эндпоинт `GET /api/v1/chatbox/integration/memory-summary` с counts: диалоги/сессии/проанализировано/в работе/ошибки + blocks/tasks из переписки) + prom-метрики синка/анализа + чистый парсер `extractChatboxOutboundId` ответа `sendMessage` (best-effort, форма ждёт боевой отправки). (2) **Мобильная Кора Ф2–Ф7** — exec «Обзор»/«Команда»/«Дела»/«Цели» через `MobileShell`-gate (десктоп не тронут), голосовой ввод в чек-ин (серверный ASR Vox), «Спросить»/«Память», и **первое подключение браузерного web-push** — новый `ExecMorningPushCron` (утреннее окно: «Требует тебя сегодня: N» → `/dashboard`).
>
> **Миграций / seed / patch / backfill — НЕТ.** **2 новых kill-switch + 1 крутилка (AdminSetting, code-default есть).** **VAPID-ENV нужны для нового exec-push** (без них — graceful no-op). **Docker rebuild backend+frontend обязателен** (код).

- **Шаг 1 — ENV (VAPID — без них браузерный web-push, ВКЛЮЧАЯ новый `ExecMorningPushCron`, graceful no-op):** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (backend) + `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (frontend build-ENV). Генерация: `npx web-push generate-vapid-keys` (публичный ключ продублировать в backend и frontend, `VAPID_SUBJECT` = `mailto:`-адрес). **Это первый крон, который реально вызывает `enqueuePushSend`** — без VAPID отправка молча no-op (ошибки нет). Реестр — `docs/operations/feature-flags.md` §VAPID. _(если VAPID уже заданы при выкате блока finishable-now — повторно не нужно.)_
- **Шаг 1 — флаги (kill-switch / крутилка, code-fallback ON — сид не обязателен):**
  - `operations.daily_digest.deliver_to_webpush` (AdminSetting, ENV-fallback `OPS_DIGEST_DELIVER_TO_WEBPUSH=true`, kill-switch, default ON). Доставка утреннего exec web-push «Требует тебя сегодня: N». Аварийный откат: `=false` → утренний exec-push не шлётся.
  - `operations.daily_digest.webpush_morning_hour` (AdminSetting, ENV-fallback `OPS_DIGEST_WEBPUSH_MORNING_HOUR`, крутилка, default `9`). Час утреннего окна exec-push. super_admin может изменить из `/admin/settings`.
  - Реестр обоих — `docs/operations/feature-flags.md`.
- **Миграций / seed / patch / backfill — НЕТ.** Регистрировать в `apply-prod-deploy.ts` STEPS нечего.
- **Прод-операция владельца (не код): ChatBox Ф0** — прогнать `patch-enable-chatbox-analysis.ts --apply` для уже подключённых интеграций, в т.ч. «Ооо луа» (~215 чатов, анализ переписки не запускался). См. «Опциональные ручные операции» выше; уже в STEPS (`phase:'patch'`), `--mode update` его выполнит. _(нужно для того, чтобы виджет «Чаты в памяти» показал ненулевые counts.)_
- **Шаг 11 — Docker rebuild** — обязателен. Backend: новый эндпоинт `GET /api/v1/chatbox/integration/memory-summary`, prom-метрики `z_chatbox_*` + `z_exec_morning_push_delivered_total`, парсер `extractChatboxOutboundId`, новый `ExecMorningPushCron` (operations). Frontend: `ChatboxMemorySummaryCard` на `/chats/integrations/chatbox`, мобильные экраны exec/manager (`src/ui/mobile/*`), голосовой ввод в чек-ин, кнопка `EnableMorningRemindersButton` на exec «Обзоре». Команда: `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката):
  - (а) `GET /api/v1/chatbox/integration/memory-summary` отдаёт counts (`dialogs`/`sessions`/`analyzed`/`inProgress`/`failed` + `blocks`/`tasks` + `analysisEnabled`);
  - (б) `/metrics` содержит `z_chatbox_syncs_total`, `z_chatbox_analyzes_total`, `z_chatbox_pending_sessions`, `z_chatbox_last_sync_ts_seconds`, `z_exec_morning_push_delivered_total`;
  - (в) `ExecMorningPushCron` — дождаться утреннего окна или прогнать вручную (`/admin/crons` → run, или вызвать метод), проверить `enqueuePushSend` и доставку на подписанное устройство, тап по уведомлению → `/dashboard`.
- **Алерты (документировать в Grafana/Alertmanager):**
  - `z_chatbox_pending_sessions > 0 and increase(z_chatbox_analyzes_total[1h]) == 0` — копим сессии, но анализ не идёт (цепочка знаний встала).
  - `time() - max(z_chatbox_last_sync_ts_seconds) > 7200` — синк отстал > 2 ч (вебхуки/крон не доезжают).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 📱💬 2026-06-11 — Финиш «сейчас» (6 ТЗ): ASR-сегменты · промпты-MASTER · кабинет-honesty · ChatBox память+задачи · Мобильная Кора · probe-fix

> Контракт: ветка `feature/finishable-now-2026-06-11` (13 коммитов). ТЗ: `plans/tz/2026-06-11-asr-segment-timings-persist-and-merge.md`, `2026-06-11-prompt-polish-fewshot-org-and-reports.md`, `2026-06-11-org-extractor-and-compiler-finalize.md`, `2026-06-11-cabinet-inbox-nav-ui-honesty.md`, `2026-06-11-chatbox-memory-finishing-and-tasks-from-chat.md`, `2026-06-11-cabinet-leftovers-ui-probe-chat.md` (probe-fix).
>
> **Зачем для прода:** шесть независимых доводок. (1) **ASR-сегменты** — Vox `v3_e2e_rnnt` отдаёт посегментные тайминги в `extendedResult.segments`; теперь они персистятся (`TranscriptTrack.segments`) и мержатся, чтобы транскрипт шёл по времени, а не «дорожками подряд». (2) **Промпты-MASTER** — орг-агенты (regulation/policy/instruction) + строгий гейт `isOrgNorm`, версии и sync шагов; 11 few-shot примеров. (3) **Кабинет Волны 1–2** — ребренд «Кора-Админ», автоген slug, документы-контракт, архив спринтов, primary-nav + `/feed` + сворачивание Sidebar + welcome-тур. (4) **ChatBox память+задачи** — матчинг участников по имени, извлечение задач из переписки (Ф5), межисточниковый дедуп (Ф6). (5) **Мобильная Кора Ф0+Ф1** — каркас + первый экран. (6) **probe context-leak fix** — `payload.message` больше не течёт сырым в `probe.question`.
>
> **2 миграции (авто).** **3 новых ENV (kill-switch, default ON) + VAPID (ENV-секреты push, действие владельца).** **1 backfill (в STEPS, safety no-op).** **Docker rebuild backend+frontend обязателен** (код).

- **Шаг 1 — ENV (3 kill-switch, default ON — действий владельца НЕ требуют):**
  - `REGULATION_GATE_STRICT_ENABLED` (`aiFeatures.regulationGateStrict`, zBool default `true`). Строгий гейт `isOrgNorm` в regulation/policy/instruction-экстракторах. Аварийный откат: `=false` → recall-страховка (мягкий гейт). Можно не задавать — дефолт ON.
  - `CHATBOX_TASK_EXTRACTION_ENABLED` (`aiFeatures.chatboxTaskExtractionEnabled`, zBool default `true`). Извлечение задач из переписки (Ф5). Аварийный откат: `=false` → переписка в граф мостится, задачи не создаются.
  - `TASKS_CROSS_SOURCE_DEDUPE_ENABLED` (`aiFeatures.tasksCrossSourceDedupeEnabled`, zBool default `true`). Межисточниковый дедуп задач (Ф6). Аварийный откат: `=false` → возможны дубли «встреча + чат».
  - Реестр всех трёх — `docs/operations/feature-flags.md`.
- **Шаг 1 — ENV (VAPID — действие владельца, без них push = no-op):** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (backend) + `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (frontend build-ENV) — нужны для web-push Мобильной Коры. **Не задашь — push молча не шлётся** (фича работает без push, ошибки нет). Генерация: `npx web-push generate-vapid-keys` (публичный ключ продублировать в backend и frontend, `VAPID_SUBJECT` = `mailto:`-адрес). Реестр — `docs/operations/feature-flags.md` §VAPID.
- **Шаг 1 — AdminSetting (опц., code-default есть — действий НЕ требует):** `tasks.cross_source_dedupe_threshold` (порог cosine дедупа, code-default `0.85`); `chatbox.match.name_fuzzy_enabled` (нечёткий матчинг по имени, code-default `true`). super_admin может изменить из `/admin/settings`.
- **Шаг 4 — Prisma** — **обязательно, авто** (2 миграции, аддитивные, без потери данных, `prisma migrate deploy` в migrate-контейнере на `docker compose up`):
  - `20260611100000_transcript_track_segments` — `TranscriptTrack +segments Json?` (посегментные тайминги Vox для персиста+мерджа).
  - `20260611110000_chatbox_tasks_and_customer_link` — `Task.meetingId → nullable` (задача может быть из переписки/трекера, не только из встречи) + `Task +sourceType` / `+sourceChatSessionId` / `+sourceChatId`; новый enum/модель `TaskSource`; `ChatboxCustomer`/`ChannelClient +linkedPersonId` / `+linkMode` (связка клиента переписки с `Person` графа).
  - **В STEPS агрегатора регистрировать НЕ нужно** — это миграции схемы, не seed/patch/backfill.
- **Шаг 8 — Backfill** — **1 новый, идемпотентный, в STEPS** (`phase:'backfill'`, `skipBootstrap:true`): `scripts/backfill-task-source-type.ts` — проставляет `Task.sourceType='meeting'` где пусто. **Safety no-op:** колонка `Task.sourceType` имеет `@default("meeting")`, поэтому новые/мигрированные строки уже корректны; скрипт — страховка на случай, если insert/миграция обошли дефолт. Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Прод-операция владельца (не код): ChatBox Ф0** — прогнать `patch-enable-chatbox-analysis.ts --apply` (см. «Опциональные ручные операции» выше), чтобы включить анализ переписки у уже подключённых интеграций («Ооо луа» — ~215 чатов, анализ не запускался). Уже в STEPS (`phase:'patch'`), `--mode update` его выполнит.
- **Шаг 11 — Docker rebuild** — обязателен. Backend: `TranscriptTrack.segments` (персист+мердж сегментных таймингов Vox), орг-экстракторы regulation/policy/instruction + гейт `isOrgNorm` + версии/steps-sync + 11 few-shot, ChatBox task-extraction (Ф5) + cross-source dedupe (Ф6) + матчинг участников по имени, probe context-leak fix, web-push отправка (если заданы VAPID). Frontend: Кабинет Волны 1–2 (ребренд «Кора-Админ», пикер+ControlsBar, primary-nav + `/feed` + сворачивание Sidebar + welcome-тур), Мобильная Кора Ф0+Ф1, push-подписка (если задан `NEXT_PUBLIC_VAPID_PUBLIC_KEY`). Команда: `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката): транскрипт встречи идёт по времени (не «дорожками подряд»); `Task` из закрытой ChatBox-сессии создаётся с `sourceType='chatbox'`; дубль «встреча+чат» не плодится; уведомление-вопрос (`probe.question`) без сырого `payload.message`; на телефоне открывается Мобильная Кора (первый экран). Если заданы VAPID — push доходит; не заданы — отправка no-op без ошибок.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🧹 2026-06-11 — ТЗ cabinet-leftovers (UI-протечки §1 Ф2–Ф5 · probe §3 · чат-стрим §4)

> Контракт: `plans/tz/2026-06-11-cabinet-leftovers-ui-probe-chat.md`. Ветка `feature/meeting-cabinet-fixes-2026-06-10` (10 коммитов `d8902c49..afc7e1d2`).
>
> **Зачем для прода:** доводка кабинета — три независимых улучшения. (1) §1: технические протечки в UI убраны (enum→русский, cuid→имя, raw-json→текст, role-gate `/orchestrator`, маркеры `[BLOCK:]` не светятся в ответе чата). (2) §3: уведомление-вопрос (probe) про сотрудника теперь приходит самому сотруднику / его руководителю, а не владельцу; тексты модерации и probe — человеческие, без кодов/ID. (3) §4: AI-чат компании показывает стадии работы («Понимаю→Ищу→Пишу») через лёгкий SSE и больше не «зависает» молча; таймаут синтеза разведён от общего. **Миграций/seed/patch/backfill — НЕТ.** **2 новых ENV (kill-switch, default ON).** **1 новая AdminSetting (code-default есть).** **Docker rebuild backend+frontend обязателен** (код).

- **Шаг 1 — ENV (2 kill-switch, default ON — действий владельца НЕ требуют):**
  - `PROBE_SUBJECT_ADDRESSING_ENABLED` (`cfg.probe.subjectAddressingEnabled`, zBool default `true`, §3 Ф1). При ON probe про сотрудника адресуется `[субъект, глава отдела, owner]` (субъект первым). Аварийный откат: `=false` в `.env` + рестарт → probe адресуется как раньше (глава отдела / админы, не субъект).
  - `CHAT_V2_STREAMING_ENABLED` (`cfg.chatV2.streamingEnabled`, zBool default `true`, §4 Ф1). При ON работает SSE-эндпоинт стадий чата. Аварийный откат: `=false` → `POST /api/v1/chat-v2/messages/stream` отдаёт `503`, фронт прозрачно откатывается на синхронный `POST /api/v1/chat-v2/messages`.
  - Реестр обоих — `docs/operations/feature-flags.md`.
- **Шаг 1 — AdminSetting (опц., code-default есть — действий НЕ требует):** `knowledge.chatV2SynthesisTimeoutMs` (таймаут синтеза AI-чата, POSITIVE_INT, code-default `90000` мс; не ENV, §4 Ф3). super_admin может изменить из админки `/admin/settings`.
- **Миграций / seed / patch / backfill — НЕТ.** Регистрировать в `apply-prod-deploy.ts` STEPS нечего.
- **Шаг 11 — Docker rebuild** — обязателен. Backend: новый SSE-эндпоинт `POST /api/v1/chat-v2/messages/stream`, `onStage` в `chat-v2`/`synthesis`/`knowledge-core`, per-call `timeoutMs` override в `llm-router`, адресация probe (`resolveProbeRecipients`), человеческие тексты модерации (`resource-type-ru`), `stripBlockMarkers` в синтезе чата. Frontend: стадии чата («Понимаю→Ищу→Пишу» + «Долго думаю» >45с + fallback), мапперы (`toolNameLabel`/`meetingStatusLabel`/`teamTemplateCategoryLabel`/`signalTypeLabel`), `ReadablePayload` в `src/ui`, role-gate `/orchestrator`. Команда: `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката): в `/me/notifications` нет латиницы-кодов / сырого JSON; probe про сотрудника приходит ему/руководителю, **не владельцу**; AI-чат показывает стадии «Понимаю→Ищу→Пишу»; ответ чата без маркеров `[BLOCK:…]`.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🔗 2026-06-10 — Мост ежедневный чек-ин → граф знаний (`daily_checkin`)

> Контракт: `plans/tz/2026-06-10-daily-checkin-to-graph-bridge.md`. Ветка `feature/meeting-cabinet-fixes-2026-06-10`.
>
> **Зачем для прода:** завершённый чек-ин (план/отчёт сотрудника) теперь становится источником графа знаний — AI-чат компании сможет отвечать «что делал сотрудник X на неделе». Событийный мост: на `checkin.created` слушатель `CheckinGraphIngestListener` зовёт `CheckinIngestService.ingestCheckin`, который пишет `RawEvent(sourceType='daily_checkin', dataClass='sensitive')` через `IngestService.ingest` (по образцу `ChatboxIngestService`). Идемпотентно по `sourceExternalId=checkInId`; `occurredAt` берётся из стабильного `dateLocal` (не из мутирующего `completedAt`). Sentiment/qualityScore в граф НЕ ингестятся — работает рядом и независимо от `CheckinSentimentAnalyzerWorker`. **Миграция БД ЕСТЬ** (enum-значение, аддитивная, авто). **1 новая ENV (kill-switch, default ON).** **Новой BullMQ-очереди/cron НЕТ** — событийный listener.
>
> ⚠ **v1-ограничение:** replace чек-ина того же дня = no-op (первый завершённый чек-ин = канон), т.к. `idempotencyKey` стабилен по `dateLocal`; re-ingest при replace — vNext.

- **Шаг 1 — ENV (kill-switch, default ON — действий владельца НЕ требует):** `CHECKIN_GRAPH_INGEST_ENABLED` (`betaOps.checkinGraphIngestEnabled`, zBool default `true`). Аварийный откат: `=false` в `.env` + рестарт → чек-ины перестают попадать в граф (sentiment/обработка чек-ина не затронуты). Реестр — `docs/operations/feature-flags.md`.
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260610140000_source_type_daily_checkin`): `ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'daily_checkin'`. Опасных изменений нет (только новое enum-значение). ⚠ `ALTER TYPE ... ADD VALUE` **не-транзакционна** и её нельзя выполнять в одной транзакции с использованием значения — поэтому enum-значение вынесено в **отдельную** миграцию. Идемпотентна (`IF NOT EXISTS`, повтор — no-op). Применяется `prisma migrate deploy` в migrate-контейнере на `docker compose up`. **В STEPS агрегатора регистрировать НЕ нужно** (миграция схемы, не seed/patch/backfill).
- **Шаг 11 — Docker rebuild** — обязателен (backend: новый `CheckinIngestService` + `CheckinGraphIngestListener` (`@OnEvent('checkin.created')`), оба зарегистрированы в `operations.module.ts`; новая ENV; frontend без изменений): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката): после завершения чек-ина появляется новый `RawEvent` с `sourceType='daily_checkin'` (через `diag` или БД); метрика `z_checkin_graph_ingest_total{result}` тикает (`result ∈ ok|skipped|error`): `curl -s localhost:3000/metrics | grep z_checkin_graph_ingest_total`. Новой очереди/cron НЕТ — это событийный listener (отдельного `bullmq_`/cron-grep'а не требует).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🩹 2026-06-10 — Зависание встречи в `scheduled` + дубли/статусы «Команда» (Ф1–Ф6)

> Контракт: `plans/tz/2026-06-10-meeting-stuck-and-team-roster-fixes.md`. Ветка `feature/meeting-cabinet-fixes-2026-06-10` (6 коммитов).
>
> **Зачем для прода:** два независимых багфикса. (1) «Команда»: один человек = одна строка (дедуп по email + статус по membership). (2) Встреча больше не виснет навсегда в `scheduled` — `finish` устойчив, idle-cron reconcile'ит брошенные `scheduled`. **Миграций Prisma НЕТ** (partial unique — в `postgres-init.sql`). **Новых ENV нет.** **Docker rebuild backend+frontend** (код).
>
> ⚠ **Главный прод-блокер (вне репо, владельцу):** доставка вебхуков LiveKit `room_started`/`room_finished` на backend сломана после переезда `meet.crossmark.ru → korateam.ru` — без её починки **каждая новая встреча будет зависать в `scheduled`**, а Ф5/Ф6 — лишь страховка устойчивости, корень не лечат. Действия — см. ТЗ §4 (правка `infra/livekit/livekit.yaml` `webhook.urls` + nginx-проксирование `/webhooks/` на backend) и строку в `second-brain/04_не-сделано/README.md`.

- **Шаг 5 — postgres-init.sql** — новый partial unique: `persons_tenant_email_active_uniq ON "persons" ("tenantId", lower("email")) WHERE "deletedAt" IS NULL AND "email" <> ''` (запрещает второй активный `Person` на тот же email в Org; образец — `Vendor_tenantId_inn_unique_idx`/`Entity_strong_email_uniq`). **Self-skip:** если на момент прогона ещё есть активные дубли по email — блок делает `RAISE NOTICE` и пропускает создание индекса; индекс встанет на следующем прогоне `postgres-init` **уже после backfill Ф3** (Шаг 8). Применяется: `docker compose exec backend bun run apply-postgres-init` (идемпотентно, `CREATE INDEX IF NOT EXISTS`).
- **Шаг 8 — Backfill** — **1 новый, идемпотентный, в STEPS** (`phase:'backfill'`, `args:['--apply']`, `skipBootstrap:true`): `scripts/backfill-merge-duplicate-persons.ts` — сливает дубли `Person` по `(tenantId, lower(email))`: каноническая = аккаунтная (`userId`) либо старейшая, дубли soft-delete'ятся, пустые поля канонической обогащаются, слабое имя-логин заменяется человеческим (Р4); `≥2` аккаунтов на email — НЕ сливает (warn). **Сначала dry-run** (без флага, только counts — сверить): `docker compose exec backend bun run scripts/backfill-merge-duplicate-persons.ts` → **затем `--apply`** через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update` (или напрямую `... backfill-merge-duplicate-persons.ts --apply`, опц. `--tenant=<id>`). Идемпотентен (повтор → 0 групп). Запускать **до** повторного `apply-postgres-init` (чтобы self-skip-индекс Шага 5 встал).
- **Шаг 11 — Docker rebuild** — обязателен (backend: `orgs.service.listTeamRoster` (статус по membership + дедуп по email), `persons.service.create` (дедуп по email до вставки → 409 `person_email_taken` / линковка безличной карточки), `host-controls.service.finish` (устойчив из `scheduled`/терминальных), `idle-meeting.cron` (reconcile брошенных `scheduled`); frontend: нейтральный тост finish): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката): раздел «Команда» — один человек = одна строка, владелец помечен «активен» (не «не приглашён»); тестовая встреча — «Завершить» из любого состояния закрывает без 409 (из `scheduled` → нейтральный тост «Встреча завершена (запись не велась)»).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 📖 2026-06-10 — Волна 6 A10: модель Instruction (first-class «Инструкция», single-role)

> Контракт: master-prompt-fleet (Волна 6 A10), схема-слой. Ветка `feature/master-prompt-fleet-2026-06-10`.
>
> **Зачем для прода:** новая first-class сущность «Инструкция» (`Instruction`) — пошаговое руководство для ОДНОЙ роли (`forRole`), зеркалит `Regulation` + признак single-role. Только схема-слой (таблица + индексы), без extraction/API/RBAC (другой слой). **Миграция БД ЕСТЬ** (аддитивная, авто). **Новых ENV нет.**

- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260610120000_add_instruction`): `+ table instructions` (FK → `Org`/`persons`/self/`CardVersion`; unique `(tenantId, name)` + unique `entityId`; индексы по `(tenantId, status)`/`(tenantId, forRole)`/`(tenantId, ownerPersonId)`/`(currentVersionId)`; колонка `embedding vector(1536)`). Аддитивна (CREATE TABLE), без потери данных. Применяется `prisma migrate deploy` в migrate-контейнере на `docker compose up`. Идемпотентна.
- **Шаг 5 — postgres-init.sql — HNSW** — новый: `instructions_embedding_hnsw_cosine_idx ON "instructions" USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL` (KNN cosine dedupe/supersede инструкций, зеркало `decisions`/`regulations`). Применяется: `docker compose exec backend bun run apply-postgres-init` (идемпотентно, `CREATE INDEX IF NOT EXISTS`).
- **Шаг 8 — Backfill** — **1 новый, идемпотентный, в STEPS** (Волна 6 B, `phase:'backfill'`, `args:['--apply']`, `skipBootstrap:true`): `scripts/backfill-reclassify-instructions.ts` — переносит single-role `Process` (`scope=role:*`) в новую таблицу `instructions` (идемпотентно, skip по `tenantId+name`). Без `--apply` — dry-run. Сначала проверка: `docker compose exec backend bun run scripts/backfill-reclassify-instructions.ts` → затем через агрегатор `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (новый PrismaClient-модель `instruction`): `docker compose up -d --build backend`.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🧩 2026-06-10 — Волна 6 A7: агент-компилятор орг-документа (`compile-org-document`)

> Контракт: master-prompt-fleet (Волна 6 Стадия C, A7). Ветка `feature/master-prompt-fleet-2026-06-10`.
>
> **Зачем для прода:** единый владелец сборки `contentMd` орг-документа (regulation/process/policy/instruction). На verdict merge/extension от `regulation-dedupe` специалист 3.1 теперь собирает структурный документ по шаблону типа (режимы СОЗДАНИЕ/ДОПОЛНЕНИЕ, маркеры `[требует уточнения]`/`[конфликт]`/`[изменено]`, «ничего не теряй») вместо plain-update поля + инкремент `version`. Best-effort: при ошибке компилятора — fallback к существующему телу (dedupe-путь не ломается). **Миграций БД НЕТ.** **1 новая ENV (kill-switch, default ON).** **1 новый taskType.**

- **Шаг 1 — ENV (kill-switch, default ON — действий владельца НЕ требует):** `DOC_COMPILER_ENABLED` (`aiFeatures.docCompilerEnabled`, default `true`). Аварийный откат: `=false` → legacy plain-update поля. Реестр — `docs/operations/feature-flags.md`.
- **Шаг 7 — Seed-маршрут — 1 новый, идемпотентный, в STEPS** (`phase:'seed-llm-routes'`, alias `'compile-org-document'`): `scripts/seed-llm-task-routes-compile-org-document.ts` — taskType `compile-org-document` → `deepseek-v4-pro` primary → `openai-via-proxy/gpt-5.4` → `ollama/qwen3.5:9b` (capable + tool-use). Без seed поедет по `DEFAULT_FALLBACK_CHAIN` (тоже работоспособен). Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (backend: `StructuredDocumentCompilerService`, новый промпт `compile_org_document`, вызов из `Specialist31Service` на merge/extension, новый taskType; frontend без изменений): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката): `/admin/ai-models` → `compile-org-document` (deepseek-v4-pro primary). После встречи с повторно-упомянутым регламентом/процессом: в логах backend нет ERROR от `structured-document-compiler`; `contentMd` существующей карточки на extension собран по структуре типа (таблица «кто-что-когда» для регламента / разделы для процесса), `version` инкрементирован.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🐞 2026-06-10 — Фикс открытых багов retest3 (Ф1–Ф9, кроме #20/#24/#17/#26)

> Контракт: `plans/tz/2026-06-10-bugfix-fleet-retest3.md`. Коммиты: Ф1 `e696d831` · Ф2 `a442fc37` · Ф5 `5781b43f` · Ф6 `1f035158` · Ф7 `73af1791` · Ф4 `9550d382` · Ф3 `0652c365` · Ф8 `a9289d54` · Ф9 `048be10e`.
>
> **Зачем для прода:** pulse-patterns 500 → 200; json-режим LLM (quality-score/extract-actions/secondary-каскад) перестаёт падать; главный отчёт идёт через DeepSeek (кэш + pro); чат больше не светит служебные маркеры; локализация (русский 404, resourceType, заголовки, отчёт); диагностика пустых дорожек + гард абсурдных метрик диаризации. **Миграций БД НЕТ.** **Docker rebuild backend+frontend обязателен** (код).

- **Шаг 1 — ENV (обе с дефолтами — действий владельца НЕ требуют):**
  - `LLM_MAIN_REPORT_PRIMARY` (enum `minimax`/`deepseek`, **default `deepseek`**, Ф5/#51). Откат на прежний канал: `=minimax` в `.env` + рестарт.
  - `LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED` (**default сменён OFF→ON**, Ф2/#56). Аварийный откат: `=false`.
  - Реестр обоих — `docs/operations/feature-flags.md`.
- **Шаг 1 — AdminSetting (опц., code-fallback есть — действий НЕ требует):** `transcribe.minAudioBytes` (порог «битого» аудио для ре-submit пустой дорожки, default 1024, Ф3/#74).
- **Шаг 9 — Re-run скрипта (Ф8/#83):** `migrate-task-to-issue.ts` уже в `apply-prod-deploy STEPS` — прогон агрегатора обновит описание виртуального проекта «Из встреч». Идемпотентно.
- **Кэш-сброс (ожидаемо):** правки SYSTEM-промптов `meeting-quality-score` и `daily-digest` разово инвалидируют prompt-cache DeepSeek/MiniMax — деньги на 1 прогон, дальше кэш восстановится.
- **Шаг 11 — Docker rebuild:** `docker compose up -d --build backend frontend`.
- **ОТЛОЖЕНО (не в этом выкате):** #26 (тайминги Vox — нужен прод-smoke), #20/#24 (Sidebar UX — отдельный ТЗ), #17 (прод-ретест смены пароля). См. `second-brain/04_не-сделано/README.md`.

---

### 👁 2026-06-10 — «Кому видно» — доступ к видеовстречам (Ф1–Ф6)

> Контракт: `plans/tz/2026-06-10-meeting-visibility-who-can-see.md`. Ветка `feature/meeting-cabinet-fixes-2026-06-10` (5 код-коммитов).
>
> **Зачем для прода:** убирает боль «сотрудники не видят встречи владельца» (by design owner-only MVP). Хост встречи управляет аудиторией «Кому видно» (как в Google Диске): `owner_only` · `participants` (ДЕФОЛТ) · `custom` (выбрать людей/группы) · `org` (всей компании). Кому видна встреча — тому видны видео/запись/расшифровка/отчёт (6 READ-поверхностей переведены на предикат `canView`). Управление встречей (rename/контролы/retry-ai/start/stop/delete/смена видимости) остаётся host-only. Граф знаний («второй мозг») НЕ затронут — отдельная подсистема. **Миграция БД ЕСТЬ** (аддитивная, авто). **1 новая ENV (kill-switch, default true).**
>
> ⚠ **Регистрировать в `apply-prod-deploy.ts` STEPS НЕ нужно** — это миграция схемы (`prisma migrate deploy`), не seed/patch/backfill.

- **Шаг 1 — ENV (kill-switch, default true — действий владельца НЕ требует):** `MEETING_VISIBILITY_ENABLED` (`cfg.meetingVisibilityEnabled`, zBool default `true`). Действует «Кому видно». Аварийный откат: `=false` в `.env` + `docker compose up -d --force-recreate backend` → legacy owner-only (встречу видит только создатель). Реестр — `docs/operations/feature-flags.md`.
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260610130000_meeting_visibility`): `Meeting +visibilityScope VARCHAR(16) NOT NULL DEFAULT 'participants'`; `+ table MeetingAccessGrant` (грант person/group: `tenantId`/`meetingId`/`granteeType`/`granteeId`/`grantedById`/`createdAt`; FK `meetingId → Meeting ON DELETE CASCADE`; unique `(meetingId,granteeType,granteeId)` + индексы `(tenantId,meetingId)`/`(granteeType,granteeId)`). Аддитивна (ADD COLUMN с дефолтом + CREATE TABLE), без потери данных. Применяется `prisma migrate deploy` в migrate-контейнере на `docker compose up`. Идемпотентна (повтор — no-op). **В STEPS агрегатора регистрировать НЕ нужно.**
- **Шаг 11 — Docker rebuild** — обязателен (backend: `MeetingVisibilityService` (`canView`/`assertCanView`/`buildListWhere`), `KnowledgeAccessResolver.resolveDirectGroupIds` (новый read-only метод), новый `assertMeetingHost`, эндпоинты `GET/PATCH /meetings/:id/visibility`, новая PrismaClient-модель `meetingAccessGrant`; frontend: контрол «Кому видно» на странице встречи + при создании): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката): Swagger `/api/docs` → `GET /api/v1/meetings/:id/visibility` + `PATCH /api/v1/meetings/:id/visibility` (host-only). На странице встречи (хост) виден чип «Кому видно: …» и диалог редактирования; участник встречи видит её в списке/деталях/отчёте/записи; не-участник при дефолте `participants` без гранта → `403`.

Прод-инструкция кратко: `docker compose up -d --build backend frontend` (миграция применится сама) + при желании выставить `MEETING_VISIBILITY_ENABLED=true` в `.env` (это и так дефолт). Все прочие команды — через `docker compose exec backend ...`.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🛟 2026-06-09 — Встроенная служба поддержки + закрытый контур + самообучающийся клон (Ф1–Ф4)

> Контракт: `plans/archive/2026-06-09-support-desk-clone-and-closed-contour-tz.md` (Фазы 1–4). Коммиты Ф1 `356cc032`+`d8ffbdf3` · Ф2 `4cb444ed` · Ф3 `ae0fca83`+`24bf7e0f`+`9d396cd4` · Ф4 `14c4e6dc`.
>
> **Зачем для прода:** клиент Коры из своего кабинета задаёт вопрос → обращение приходит в единый вендор-деск → сотрудник отвечает → ответы копятся в закрытый контур памяти → из него собирается клон техподдержки (черновики человеку, обучение на правках, ночной куратор контура). Ф5 (авто-отправка клиенту) и Ф6 (тон-адаптер) — **отложены**. **Миграции БД ЕСТЬ** (3 шт., аддитивные, авто). **Новые ENV ЕСТЬ** (2 kill-switch, default ON). **Деск НЕ заработает, пока владелец не задаст AdminSetting `support.vendor_org_id` + entitlement `feature.support_desk` для вендор-Org** (см. Шаг 1).

- **Шаг 1 — ENV / AdminSetting / kill-switch / entitlement:**
  - **ENV (2 kill-switch, default ON):** `SUPPORT_DESK_ENABLED` (приём обращений + деск; `false` → `POST /support/tickets` 503 `SUPPORT_DESK_DISABLED`), `SUPPORT_CURATOR_ENABLED` (ночной куратор контура; `false` → curator-cron no-op). Реестр — `docs/operations/feature-flags.md`.
  - **Параметр владельца (обязателен для работы):** AdminSetting `support.vendor_org_id` = id вендор-Org. Пока пусто — все support-seed'ы no-op, приём 503. Засеивается code-fallback'ом нет — задаётся владельцем через админку.
  - **Решение владельца (вендор-эксклюзив):** entitlement `feature.support_desk` включить ТОЛЬКО для вендор-Org через `OrgEntitlement.featureOverrides` (не продаётся, Р-3).
  - **Крутилки (AdminSetting, засеиваются `seed-admin-setting-support.ts`, см. Шаг 7):** `support_critic_min_groundedness` (default 0.6, R-INV-5), `support_promote_min_csat` (default 4, гейт промоута R-INV-2).
- **Шаг 4 — Prisma** — **обязательно, авто** (3 миграции, аддитивные, без потери данных, применяются `prisma migrate deploy` в migrate-контейнере на `docker compose up`):
  - `20260609120000_support_desk_phase1`: `Issue +` support-поля (`supportCustomerOrgId`/`supportCustomerUserId`/`supportCustomerContact` + `firstResponseDueAt`/`resolutionDueAt`/`firstRespondedAt`/`slaBreachedAt` + 2 индекса), `IssueComment +` `authorType`/`draftState`/`cloneConfidence`/`groundednessScore`, `+ table SupportSlaPolicy`, `+ table IssueRating`, `ALTER TYPE "KnowledgeGroupKind" ADD VALUE 'support'`.
  - `20260609130000_support_draft_outcome`: `+ table SupportDraftOutcome` (пара черновик→финал + тип правки, обучающий сигнал).
  - `20260609140000_support_curator_action`: `+ table SupportCuratorAction` (аудит решений ночного куратора).
  - ⚠ `ALTER TYPE ... ADD VALUE 'support'` **не-транзакционна** (нормально для enum-добавления; `migrate deploy` исполняет её отдельным statement'ом, повторно — no-op). Прочее — ADD COLUMN / CREATE TABLE. Идемпотентно.
- **Шаг 7 — Seed** — **4 новых, идемпотентных, ВСЕ в `apply-prod-deploy.ts` STEPS** (прогон агрегатора их подхватит). Все **no-op без AdminSetting `support.vendor_org_id`** где применимо:
  - `scripts/seed-support-project.ts` (`phase:'seed-base'`) — Support-проект `SUP` (`systemGenerated`, скрыт из обычного списка) + 6 states (Новое/В работе/Ждёт клиента/Решено/Закрыто/Спам) + `SupportSlaPolicy`. No-op без `support.vendor_org_id`.
  - `scripts/seed-support-contour-group.ts` (`phase:'seed-base'`) — синглтон `KnowledgeGroup(kind='support', isClosed)` per вендор-Org. No-op без `support.vendor_org_id`.
  - `scripts/seed-admin-setting-support.ts` (`phase:'seed-base'`) — `support_critic_min_groundedness=0.6` + `support_promote_min_csat=4` (защищает admin-edited).
  - `scripts/seed-llm-task-routes-support.ts` (`phase:'seed-llm-routes'`, alias `'support'`) — 4 новых taskType: `support-clone-draft` + `support-contour-curate` → DeepSeek V4 Pro; `support-answer-critic` + `support-edit-classify` → `deepseek-v4-flash` (Б9). Fallback — `DEFAULT_FALLBACK_CHAIN`.
  - Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (backend: новый модуль `support` (intake/desk/access/sla/contour/clone/critic/edit-classify/learning/curator-сервисы, 3 контроллера, `SupportAccessGuard`/`SupportAdminGuard`, `SupportSlaCron` `@Cron('*/5 * * * *')` + `SupportCuratorCron` `@Cron('0 3 * * *')`), безусловный pre-filter контура `contourGroupId` в `ChatV2RetrievalService.collectPool`, 4 новых taskType, 2 новых ENV; frontend: `SupportWidget` (плавающая кнопка+форма) + `/support/my-tickets` + `/support/desk` + пункты сайдбара): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката):
  - **СНАЧАЛА владелец задаёт `support.vendor_org_id` + entitlement `feature.support_desk` для вендор-Org**, затем повторный прогон seed-агрегатора (`--mode update`) — без этого деск 503.
  - Новые cron: в логах backend `support-sla.cron`/`support-curator.cron` проходят без ERROR (SLA — каждые 5 мин ставит `slaBreachedAt` просроченным; curator — в 03:00 за debate-гейтом, только soft-archive).
  - Новые taskType: `/admin/ai-models` → `support-clone-draft` (deepseek-v4-pro), `support-answer-critic`/`support-edit-classify` (deepseek-v4-flash), `support-contour-curate` (deepseek-v4-pro).
  - Новые REST: Swagger `/api/docs` → раздел `/api/v1/support/*` (`/tickets`, `/my-tickets`, `/me`, `/desk/*`, `/admin/agents`, `/admin/contour/seed`).
  - Изоляция контура: `POST /support/tickets` от пользователя другой Org создаёт `Issue` в вендор-Org (`supportCustomerOrgId` = его tenant); черновик клона цитирует ТОЛЬКО блоки support-контура.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🔌 2026-06-09 — Bitrix24: установка интеграции + жизненный цикл токена

> Контракт: `plans/archive/2026-06-09-bitrix24-integration-install.md`. Ветка `bitrix`.
>
> **Зачем для прода:** подключение портала Bitrix24 к компании (оба способа —
> OAuth-коннект из Коры + установка из Маркета `ONAPPINSTALL`), шифрованное
> хранение `access+refresh` per-org, refresh по требованию, проверка соединения,
> отключение. Синк данных — отдельный следующий этап. **Миграция БД ЕСТЬ**
> (аддитивная, авто). **Новые ENV — опциональны** (без них стартует; подключение
> даёт `bitrix_misconfigured`).

- **Шаг 1 — ENV / kill-switch** (опциональны):
  - `BITRIX_CLIENT_ID` / `BITRIX_CLIENT_SECRET` — OAuth-креды тиражного приложения
    (из партнёрского кабинета Bitrix24). Без них фича не подключается, но backend
    стартует. `redirect_uri` НЕ в ENV — `{PUBLIC_HOST_URL}/api/v1/bitrix/oauth/callback`.
  - `BITRIX_OAUTH_BASE_URL` (default `https://oauth.bitrix.info`) — сервер авторизации.
  - `bitrix.enabled` (AdminSetting, **default true**, kill-switch ON) — приём событий
    установки. Выкл → install-handler 200 no-op. Code-fallback `true`, seed не нужен.
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260609112355_bitrix_integration`):
  `+ table BitrixIntegration` (FK → `Org`, 2 индекса, unique по `memberId`) +
  `+ enum BitrixIntegrationStatus`. Аддитивна (CREATE TABLE/TYPE), без потери данных.
  Применяется `prisma migrate deploy` в migrate-контейнере на `docker compose up`.
- **Шаг 11 — Docker rebuild** — обязателен (backend: модуль `bitrix` — 3 контроллера,
  API-клиент, сервис, RBAC-ресурс `bitrix`, фича `feature.bitrix`; frontend: секция
  Bitrix24 на `/settings/integrations` + страница `/bitrix/install`):
  `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката):
  - `curl -s localhost:3000/api/docs-json | grep -c bitrix` → теги `bitrix` присутствуют.
  - В UI `/settings/integrations` видна секция «Bitrix24» (если задан `BITRIX_CLIENT_ID`).
  - **Вне кода:** зарегистрировать тиражное приложение в партнёрском кабинете
    (client_id/secret → ENV; handler URL = `/bitrix/install`; install event →
    `/api/v1/bitrix/install/event`; redirect_uri → `/api/v1/bitrix/oauth/callback`),
    финализировать `scope` (минимум `crm,user,profile`).

---

### 🔔 2026-06-08 — TZ-1 Фаза 0: daily-value foundation (ТГ-доставка + бюджет + кампания привязки)

> Контракт: `plans/tz/2026-06-08-agents-daily-value-engine.md` (Фаза 0). Ветка `feature/2026-06-08-tz-batch-tables-clones-shipon`.
>
> **Зачем для прода:** включает доставку дневного чек-ина в Telegram (раньше `checkin.prompt` падал на in_app), вводит per-person дневной бюджет push-уведомлений (не заваливать человека) + тихие часы + opt-out, и кампанию привязки Telegram-канала (приглашение + напоминание). Владелец авторизовал доставку дайджестов в ТГ (LOCKED DECISION). **Миграция БД ЕСТЬ** (аддитивная, авто). **Новых обязательных ENV нет** (все тумблеры — AdminSetting с code-fallback, ENV-fallback опционален).

- **Шаг 1 — ENV / AdminSetting / kill-switch** (все засеиваются `seed-admin-setting-notification-budget.ts`, см. Шаг 7; ENV-fallback опционален):
  - `notifications.daily_budget.per_person` (int, **default 5**) — лимит push на сотрудника в его локальный день. ENV-fallback `NOTIFICATIONS_DAILY_BUDGET_PER_PERSON`.
  - `notifications.quiet_hours.start` / `.end` (int 0..23, **default 22 / 8**) — окно тихих часов (локальная TZ). ENV `NOTIFICATIONS_QUIET_HOURS_START/END`.
  - `notifications.daily_budget.enabled` (bool, **default true**, kill-switch ON) — дневной бюджет. ENV `NOTIFICATIONS_DAILY_BUDGET_ENABLED`.
  - `notifications.binding_campaign.enabled` (bool, **default true**, kill-switch ON) — кампания привязки канала. ENV `NOTIFICATIONS_BINDING_CAMPAIGN_ENABLED`.
  - **Флипаются patch'ем (Шаг 6):** `operations.daily_digest.deliver_to_telegram` + `goals.pulse.deliver_to_telegram` → `true` (владелец авторизовал ТГ-доставку 2026-06-08).
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260608130000_notification_budget_and_binding`): `+ table notification_budget_ledger`, `+ persons.channelBindingCampaignState/channelBindingInvitedAt`, `+ notifications.priorityTier`. Все изменения аддитивны (ADD COLUMN / CREATE TABLE), без потери данных. Применяется `prisma migrate deploy` в migrate-контейнере на `docker compose up`. Идемпотентна.
- **Шаг 6 — Patch** — **1 новый, идемпотентный, в STEPS** (`phase:'patch'`, `skipBootstrap`): `scripts/patch-enable-telegram-digests.ts` — выставляет `true` для `operations.daily_digest.deliver_to_telegram` и `goals.pulse.deliver_to_telegram` ТОЛЬКО если не правил человек (`updatedBy` IS NULL/`'system'`); absent → пропуск (seed покроет). Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 7 — Seed** — **1 новый, идемпотентный, в STEPS** (`phase:'seed-base'`): `scripts/seed-admin-setting-notification-budget.ts` — 5 ключей `notifications.*` (см. Шаг 1). Защищает admin-edited. Прогон агрегатором или напрямую `docker compose exec backend bun run scripts/seed-admin-setting-notification-budget.ts`.
- **Шаг 11 — Docker rebuild** — обязателен (backend: `NotificationBudgetService` (бюджет в `ConversationalService.sendNotification`), `ChannelBindingCampaignCron` `@Cron('0 9 * * *')`, `checkin.prompt` в policy, `GET /api/v1/dashboard/operations/binding-coverage`, `PATCH /api/v1/me/notification-preferences`, 6 новых метрик; frontend без изменений): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката):
  - Новый cron: в логах backend `channel-binding-campaign.cron: проход завершён` (≤ след. 09:00 локального окна), без ERROR.
  - Новые REST: Swagger `/api/docs` → `GET /api/v1/dashboard/operations/binding-coverage` (owner/coo) и `PATCH /api/v1/me/notification-preferences`.
  - Новые метрики: `curl -s localhost:3000/metrics | grep -E 'notification_budget_consumed_total|notification_budget_blocked_total|notification_deferred_to_digest_total|channel_binding_coverage_ratio|channel_binding_campaign_invited_total|checkin_prompt_delivered_total'` — присутствуют.
  - ТГ-доставка чек-ина: `diag-routes`/логи показывают, что `checkin.prompt` уходит в `telegram_bot` для сотрудников с verified-привязкой (метрика `checkin_prompt_delivered_total{channel="telegram_bot"}` растёт).
  - Дайджесты в ТГ: `operations.daily_digest.deliver_to_telegram` и `goals.pulse.deliver_to_telegram` = `true` (через `/admin/settings` или `diag`).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 💰 2026-06-08 — TZ-1 Фаза 1: Радар клиентов и сделок под риском (деньги)

> Контракт: `plans/tz/2026-06-08-agents-daily-value-engine.md` (Фаза 1). Ветка `feature/2026-06-08-daily-value-dashboards-uploads`. **Зависит от Ф0** (доставка push + бюджет).
>
> **Зачем для прода:** дневной агент группирует клиентские сигналы (отток/возражения/боли/доработки) по `Entity{type=customer}`, ранжирует по money-риску, кладёт секцию «Клиенты под риском» в COO-дайджест и шлёт push ответственному менеджеру по его клиенту. **Миграция БД ЕСТЬ** (аддитивная, авто). **Новых ENV нет** (все крутилки — AdminSetting с code-fallback).

- **Шаг 1 — AdminSetting / kill-switch** (все засеиваются `seed-admin-setting-customer-risk.ts`, см. Шаг 7; code-fallback есть):
  - `customer_risk.window_days` (int, **default 14**) — окно накопления сигналов.
  - `customer_risk.weight.churn_risk` / `.objection` / `.pain` / `.feature_request` (int, **default 5 / 3 / 2 / 1**) — веса сигналов (churn весомее). Правка в админке меняет ранжирование без деплоя.
  - `customer_risk.threshold.critical` / `.warning` (int, **default 10 / 4**) — пороги уровня риска.
  - `operations.customer_risk_radar.enabled` (bool, **default true**, kill-switch ON) — мастер-флаг радара. ENV-fallback `OPERATIONS_CUSTOMER_RISK_RADAR_ENABLED`.
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260608140000_customer_risk_snapshot`): `+ table customer_risk_snapshot` (FK → `Org`/`Entity`/`persons`, 3 индекса, unique по (tenantId, customerEntityId, dateLocal)). Аддитивна (CREATE TABLE), без потери данных. Применяется `prisma migrate deploy` в migrate-контейнере на `docker compose up`. Идемпотентна.
- **Шаг 7 — Seed** — **1 новый, идемпотентный, в STEPS** (`phase:'seed-base'`): `scripts/seed-admin-setting-customer-risk.ts` — 8 ключей `customer_risk.*` + `operations.customer_risk_radar.enabled` (см. Шаг 1). Защищает admin-edited. Также **новый LLM-маршрут** `customer-risk-digest` (primary `deepseek-v4-flash`) в `seed-llm-task-routes-default.ts` (уже в STEPS, идемпотентно). Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update` (или напрямую `docker compose exec backend bun run scripts/seed-admin-setting-customer-risk.ts`).
- **Шаг 11 — Docker rebuild** — обязателен (backend: `CustomerRiskRadarService`, `CustomerRiskRadarCron` `@Cron('0 21 * * *')`, секция «Клиенты под риском» в COO-дайджесте, `GET /api/v1/dashboard/operations/customer-risk`, `GET /api/v1/me/customer-risk`, новый taskType `customer-risk-digest`, 3 новые метрики; frontend без изменений): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката):
  - Новый cron: в логах backend `customer-risk-radar.cron: проход завершён` (≤ след. 21:00 UTC), без ERROR.
  - Новые REST: Swagger `/api/docs` → `GET /api/v1/dashboard/operations/customer-risk` (owner/coo) и `GET /api/v1/me/customer-risk` (self).
  - Новые метрики: `curl -s localhost:3000/metrics | grep -E 'customer_risk_snapshots_total|customer_risk_radar_failed_total|customer_risk_manager_notified_total'` — присутствуют.
  - Маршрут LLM: `customer-risk-digest` виден в `/admin/ai-models` (primary deepseek-v4-flash).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### TZ-1 Фаза 2 (daily-value-engine) — движок рядового: «Твой день» + «кто знает X»

> Контракт: `plans/tz/2026-06-08-agents-daily-value-engine.md` (Фаза 2). **Зависит от Ф0** (доставка push + бюджет). Gate Ф0 ≥70% привязки — продуктовое условие старта рассылки, на выкат кода не влияет (cron без verified-binding просто не доставит push).
>
> **Зачем для прода:** утренний персональный бриф сотруднику (его задачи/обещания/блокеры на сегодня + что обещали ему + 1 подсказка) и помощник «кто знает X» (семантический поиск носителя знания по блокеру через skill-профили). Источник зависимости снизу. **Миграция БД ЕСТЬ** (аддитивная, авто). **Новых ENV нет** (все крутилки — AdminSetting с code-fallback). Эндпоинты строго self-scope (Р8).

- **Шаг 1 — AdminSetting / kill-switch** (все засеиваются `seed-admin-setting-personal-brief.ts`, см. Шаг 7; code-fallback есть):
  - `operations.personal_daily_brief.enabled` (bool, **default true**, kill-switch ON) — мастер-флаг брифа. ENV-fallback `OPERATIONS_PERSONAL_DAILY_BRIEF_ENABLED`.
  - `operations.personal_daily_brief.morning_hour` (int, **default 9**) — локальный час утреннего окна (по `Person.timezone`).
  - `operations.knows_who.enabled` (bool, **default true**, kill-switch ON) — мастер-флаг «кто знает X». ENV-fallback `OPERATIONS_KNOWS_WHO_ENABLED`.
  - `knows_who.min_confidence` (number, **default 0.5**) — порог cosine similarity для зачёта носителя. ENV-fallback `KNOWS_WHO_MIN_CONFIDENCE`.
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260608150000_personal_daily_brief`): `+ table personal_daily_brief` (FK → `Org`/`persons`, 2 индекса, unique по (tenantId, personId, dateLocal)). Аддитивна (CREATE TABLE), без потери данных. Применяется `prisma migrate deploy` в migrate-контейнере на `docker compose up`. Идемпотентна.
- **Шаг 7 — Seed** — **1 новый, идемпотентный, в STEPS** (`phase:'seed-base'`): `scripts/seed-admin-setting-personal-brief.ts` — 4 ключа `operations.personal_daily_brief.*` + `operations.knows_who.enabled` + `knows_who.min_confidence` (см. Шаг 1). Защищает admin-edited. Также **новый LLM-маршрут** `personal-brief-hint` (primary `deepseek-v4-flash`) в `seed-llm-task-routes-default.ts` (уже в STEPS, идемпотентно). Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update` (или напрямую `docker compose exec backend bun run scripts/seed-admin-setting-personal-brief.ts`).
- **Шаг 11 — Docker rebuild** — обязателен (backend: `PersonalDailyBriefService`, `KnowsWhoService`, `PersonalDailyBriefCron` `@Cron('0 * * * *')`, `GET /api/v1/me/daily-brief`, `POST /api/v1/me/daily-brief/:id/opened`, `GET /api/v1/me/knows-who`, новый taskType `personal-brief-hint`, 4 новые метрики; frontend без изменений): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката):
  - Новый cron: в логах backend `personal-daily-brief.cron: проход завершён` (в течение часа), без ERROR.
  - Новые REST: Swagger `/api/docs` → `GET /api/v1/me/daily-brief`, `POST /api/v1/me/daily-brief/:id/opened`, `GET /api/v1/me/knows-who` (все self-scope).
  - Новые метрики: `curl -s localhost:3000/metrics | grep -E 'personal_daily_brief_built_total|personal_daily_brief_delivered_total|personal_daily_brief_opened_total|knows_who_match_total'` — присутствуют.
  - Маршрут LLM: `personal-brief-hint` виден в `/admin/ai-models` (primary deepseek-v4-flash).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### TZ-1 Фаза 3.A/B/C (daily-value-engine) — агенты исполнения: синтез блокеров · контролёр решений · каскад обещаний

> Контракт: `plans/tz/2026-06-08-agents-daily-value-engine.md` (Фаза 3.A/B/C). **Зависит от Ф0** (доставка push + бюджет). Ф3.D (фиксы достоверности) — уже выкачена отдельно.
>
> **Зачем для прода:** (А) накопительный синтез блокеров (cron 22:00 → статусы new/recurring/resolved + бизнес-удар + мост хроники в инсайт-радар); (Б) контролёр внедрения решений (cron 06:00 → решения без задач/результатов старше N дней → stalled + push ответственному + агрегат «% доведённых»); (В) каскад обещаний (cron 08:00 → просроченное обещание с зависимостью → дневной алерт автору и руководителю). **3 миграции БД** (все аддитивные, авто). **Новых ENV нет** (все крутилки — AdminSetting с code-fallback). Эндпоинты owner/coo.

- **Шаг 1 — AdminSetting / kill-switch** (все засеиваются `seed-admin-setting-execution-agents.ts`, см. Шаг 7; code-fallback есть):
  - `operations.blocker_synthesis.enabled` (bool, **default true**, kill-switch ON). ENV-fallback `OPERATIONS_BLOCKER_SYNTHESIS_ENABLED`.
  - `operations.decision_controller.enabled` (bool, **default true**, kill-switch ON). ENV-fallback `OPERATIONS_DECISION_CONTROLLER_ENABLED`.
  - `operations.promise_cascade.enabled` (bool, **default true**, kill-switch ON). ENV-fallback `OPERATIONS_PROMISE_CASCADE_ENABLED`.
  - `blocker_synthesis.lookback_days` (int, **default 7**), `blocker_synthesis.recurring_days` (int, **default 2**), `blocker_synthesis.impact.{base,customer,deadline,commitment,per_day_open}` (веса бизнес-удара: 1/4/3/2/0.5).
  - `decision.stale_days` (int, **default 21**) — после скольких дней решение без задач/outcomes → stalled.
- **Шаг 4 — Prisma** — **обязательно, авто** (3 миграции, все аддитивные, без потери данных, применяются `prisma migrate deploy` в migrate-контейнере на `docker compose up`):
  - `20260608160000_blocker_synthesis`: `+ table blocker_synthesis` (FK → `Org`/`persons`, unique по (tenantId, clusterKey), индекс по (tenantId, status, lastSeenDateLocal)).
  - `20260608160100_decision_implementation`: `+ decisions.linkedTaskCount/implementationStatus/implementationCheckedAt` (ADD COLUMN, default/nullable).
  - `20260608160200_decision_task_link`: `+ table decision_task_link` (join Decision↔Issue, FK → `decisions`/`Issue` onDelete CASCADE, unique по (decisionId, issueId)).
- **Шаг 7 — Seed** — **расширен существующий, идемпотентный, в STEPS** (`phase:'seed-base'`): `scripts/seed-admin-setting-execution-agents.ts` — добавлены ключи Ф3.A/B/C (см. Шаг 1) к ключам Ф3.D. Защищает admin-edited. Также **новый LLM-маршрут** `blocker-synthesis-summary` (primary `deepseek-v4-flash`) в `seed-llm-task-routes-default.ts` (уже в STEPS, идемпотентно). Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update` (или напрямую `docker compose exec backend bun run scripts/seed-admin-setting-execution-agents.ts`).
- **Шаг 8 — Backfill** — **1 новый, идемпотентный, в STEPS** (`phase:'backfill'`, `skipBootstrap:true`): `scripts/backfill-decision-linked-task-count.ts` — засевает `DecisionTaskLink` из пересечения `sourceBlockIds` (Decision×Issue) + пересчитывает `Decision.linkedTaskCount`. Идемпотентно (skipDuplicates). Сначала `--dry-run`: `docker compose exec backend bun run scripts/backfill-decision-linked-task-count.ts --dry-run` → затем без флага. Через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (backend: `BlockerSynthesisService`+`BlockerSynthesisCron` `@Cron('0 22 * * *')`, `DecisionImplementationService`+`DecisionImplementationCron` `@Cron('0 6 * * *')`, `PromiseCascadeService`+`PromiseCascadeCron` `@Cron('0 8 * * *')`, 3 новых эндпоинта, новый taskType `blocker-synthesis-summary`, 4 новые метрики; frontend без изменений): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката):
  - Новые cron в логах backend (без ERROR): `blocker-synthesis.cron: проход завершён`, `decision-implementation.cron: проход завершён`, `promise-cascade.cron: проход завершён`.
  - Новые REST: Swagger `/api/docs` → `GET /api/v1/dashboard/operations/blockers/chronic`, `GET /api/v1/dashboard/operations/decisions/throughput`, `GET /api/v1/dashboard/operations/decisions/stalled` (все owner/coo).
  - Новые метрики: `curl -s localhost:3000/metrics | grep -E 'blocker_synthesis_recurring_total|decision_stalled_total|decision_throughput_percent|promise_cascade_alert_total'` — присутствуют.
  - Маршрут LLM: `blocker-synthesis-summary` виден в `/admin/ai-models` (primary deepseek-v4-flash).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### TZ-1 Фаза 4 (daily-value-engine) — улучшения и знания: лента идей · re-check инсайтов · знание-под-риском · capacity · онбординг

> Контракт: `plans/tz/2026-06-08-agents-daily-value-engine.md` (Фаза 4). **Зависит от Ф0** (доставка push + бюджет) и Ф3 (авто-статус идеи из закрытия задач). BACKEND-ONLY (фронт-виджеты — отдельным ТЗ).
>
> **Зачем для прода:** (А) лента идей `GET /ideas/top` (ре-ранк weight+свежесть+цель) + авто-морфинг статуса идеи при закрытии связанной задачи (по общей цели) + расширена policy `idea.status_changed` (+telegram) + recognition `idea_shipped` при shipped + секция «Идеи недели» в недельном COO-дайджесте; (Б) re-check митигированных инсайтов в insight-clusterer cron (повтор паттерна → active) + «ты не один» в персональном брифе; (В) знание-под-риском × уход человека (weekly cron пн 05:00, push только руководителю); (Г) capacity-агрегат по командам (endpoint); (Д) онбординг-рамп новичка (daily cron 07:00, push руководителю + новичку). **1 миграция БД** (аддитивная, авто). **Новых ENV нет** (все крутилки — AdminSetting с code-fallback). Эндпоинты owner/admin/coo.

- **Шаг 1 — AdminSetting / kill-switch** (все засеиваются `seed-admin-setting-knowledge-improvement-agents.ts`, см. Шаг 7; code-fallback есть):
  - `ideas.feed.enabled` (bool, **default true**, kill-switch ON). ENV-fallback `IDEAS_FEED_ENABLED`.
  - `insights.recheck.enabled` (bool, **default true**, kill-switch ON). ENV-fallback `INSIGHTS_RECHECK_ENABLED`.
  - `operations.knowledge_at_risk.enabled` (bool, **default true**, kill-switch ON). ENV-fallback `OPERATIONS_KNOWLEDGE_AT_RISK_ENABLED`.
  - `operations.team_capacity.enabled` (bool, **default true**, kill-switch ON). ENV-fallback `OPERATIONS_TEAM_CAPACITY_ENABLED`.
  - `operations.onboarding_ramp.enabled` (bool, **default true**, kill-switch ON). ENV-fallback `OPERATIONS_ONBOARDING_RAMP_ENABLED`.
  - `ideas.feed.rerank.{weight,freshness,goal_link}` (1/0.5/0.75), `ideas.feed.freshness_days` (int, **default 30**).
  - `insight.recheck_days` (int, **default 14**).
  - `team_capacity.overload_percent` (int, **default 120**), `team_capacity.underload_percent` (int, **default 50**).
  - `onboarding.silent_days` (int, **default 5**).
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260608170000_knowledge_at_risk`): `+ table knowledge_at_risk_snapshot` (FK → `Org`/`persons`, индекс по (tenantId, combinedSeverity, snapshotAt)). Аддитивна (CREATE TABLE), без потери данных. Применяется `prisma migrate deploy` в migrate-контейнере на `docker compose up`. Идемпотентна.
- **Шаг 7 — Seed** — **1 новый, идемпотентный, в STEPS** (`phase:'seed-base'`): `scripts/seed-admin-setting-knowledge-improvement-agents.ts` — 14 ключей `ideas.feed.*` / `insight.recheck_days` / `insights.recheck.enabled` / `team_capacity.*` / `onboarding.silent_days` / `operations.{knowledge_at_risk,team_capacity,onboarding_ramp}.enabled` (см. Шаг 1). Защищает admin-edited. Без новых LLM-маршрутов (Ф4 без chat-LLM). Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update` (или напрямую `docker compose exec backend bun run scripts/seed-admin-setting-knowledge-improvement-agents.ts`).
- **Шаг 11 — Docker rebuild** — обязателен (backend: `KnowledgeAtRiskService`+`KnowledgeAtRiskCron` `@Cron('0 5 * * 1')`, `OnboardingRampService`+`OnboardingRampCron` `@Cron('0 7 * * *')`, `TeamCapacityService`, `IdeaStatusAutoAdvanceService` (@OnEvent `tracker.event_occurred`), `IdeasService.getTop`, re-check в insight-clusterer cron, 4 новых эндпоинта, расширена policy `idea.status_changed`, 7 новых метрик; frontend без изменений): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката):
  - Новые cron в логах backend (без ERROR): `knowledge-at-risk.cron: проход завершён`, `onboarding-ramp.cron: проход завершён`; insight-clusterer лог содержит `totalReactivated`.
  - Новые REST: Swagger `/api/docs` → `GET /api/v1/ideas/top` (owner/admin/coo), `GET /api/v1/dashboard/operations/knowledge-at-risk`, `GET /api/v1/dashboard/operations/team-capacity`, `GET /api/v1/dashboard/operations/onboarding-ramp` (owner/coo).
  - Новые метрики: `curl -s localhost:3000/metrics | grep -E 'ideas_top_served_total|idea_status_auto_advanced_total|idea_status_changed_notified_total|insight_rechecked_total|knowledge_at_risk_total|team_capacity_overload_total|onboarding_ramp_stalled_total'` — присутствуют.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🟢 TZ-1 Фаза 5 (daily-value-engine) — месячная витрина value-recap + оценка ответов AI-чата

> Контракт: `plans/tz/2026-06-08-agents-daily-value-engine.md` (Фаза 5). **Зависит от Ф0** (доставка push + бюджет), Ф3.B (`getDecisionThroughput`). BACKEND-ONLY (фронт-экран — отдельным ТЗ).
>
> **Зачем для прода:** (А) оценка «помог ли ответ» на ChatV2Message (палец вверх/вниз, web + Telegram/in_app) + агрегатор метрики чата (`GET /chat-v2/usage-stats`, type-guard citations = grounding-proxy, helped-rate скрыт при rated<min); (Б) месячная витрина value-recap на ТВЁРДЫХ данных (cron 1-го числа → build за прошлый месяц + push-first владельцу/COO eventType `operations.monthly_recap`) + эндпоинты read/opened/export(slides|json). **Честность Р6** (нет ₽/было→стало/medianHoursToAnswer/roiScore) гарантирована кодом (`assertNoForbiddenMetricKeys`) + unit-тестом. **2 миграции БД** (аддитивные, авто). **Новых ENV нет** (все крутилки — AdminSetting с code-fallback). Эндпоинты owner/admin/coo (usage-stats org-scope) + self (usage-stats self, feedback).

- **Шаг 1 — AdminSetting / kill-switch** (все засеиваются `seed-admin-setting-value-recap.ts`, см. Шаг 7; code-fallback есть):
  - `operations.value_recap.enabled` (bool, **default true**, kill-switch ON) — мастер-флаг витрины. ENV-fallback `OPERATIONS_VALUE_RECAP_ENABLED`.
  - `chat_v2.feedback.enabled` (bool, **default true**, kill-switch ON) — оценка ответов чата. ENV-fallback `CHAT_V2_FEEDBACK_ENABLED`.
  - `chat_v2.feedback.min_rated` (int, **default 10**) — порог скрытия helped-rate («мало данных»).
  - `chat_v2.feedback.retry_dedup_seconds` (int, **default 30**) — окно дедупа ретраев в метрике чата.
- **Шаг 4 — Prisma** — **обязательно, авто** (2 миграции, аддитивные, без потери данных, применяются `prisma migrate deploy` в migrate-контейнере на `docker compose up`):
  - `20260608180000_chat_v2_message_helpful`: `+ ChatV2Message.helpful (VARCHAR 8) / helpfulAt / helpfulComment` (все nullable, `ADD COLUMN IF NOT EXISTS`).
  - `20260608180100_value_recap_snapshot`: `+ table value_recap_snapshot` (FK → `Org`, unique по (tenantId, periodYm), индекс по (tenantId, createdAt)).
- **Шаг 7 — Seed** — **1 новый, идемпотентный, в STEPS** (`phase:'seed-base'`): `scripts/seed-admin-setting-value-recap.ts` — 4 ключа `operations.value_recap.enabled` + `chat_v2.feedback.{enabled,min_rated,retry_dedup_seconds}` (см. Шаг 1). Защищает admin-edited. Также **новый LLM-маршрут** `value-recap-narrative` (primary `deepseek-v4-flash`) в `seed-llm-task-routes-default.ts` (уже в STEPS, идемпотентно). Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update` (или напрямую `docker compose exec backend bun run scripts/seed-admin-setting-value-recap.ts`).
- **Шаг 11 — Docker rebuild** — обязателен (backend: `ValueRecapService`+`ValueRecapCron` `@Cron('0 7 1 * *')`, `ChatV2FeedbackService`, 3 новых эндпоинта chat-v2 (feedback POST/DELETE + usage-stats), 3 новых эндпоинта value-recap (get/opened/export), новый eventType `operations.monthly_recap` (policy + payload-схема), новый LLM-taskType `value-recap-narrative`, 5 новых метрик; frontend без изменений): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката):
  - Новый cron в логах backend (без ERROR, 1-го числа): `value-recap.cron: проход завершён`.
  - Новые REST: Swagger `/api/docs` → `POST /api/v1/chat-v2/messages/:id/feedback`, `DELETE /api/v1/chat-v2/messages/:id/feedback`, `GET /api/v1/chat-v2/usage-stats` (self / org owner-coo); `GET /api/v1/dashboard/operations/value-recap`, `POST .../value-recap/:id/opened`, `GET .../value-recap/:id/export` (owner/admin/coo).
  - Новые метрики: `curl -s localhost:3000/metrics | grep -E 'value_recap_built_total|value_recap_delivered_total|value_recap_opened_total|chat_v2_feedback_total|chat_v2_answered_with_citation_total'` — присутствуют.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 📊 2026-06-09 — ТЗ-2 ⊕ ТЗ-3: дашборды (состав + современный визуал) + здоровье портфеля целей

> Контракты: `plans/tz/2026-06-08-dashboards-info-rework.md` (состав ТЗ-2) ⊕ `plans/tz/2026-06-08-dashboards-redesign-modern-visual-language.md` (визуал ТЗ-3). Ветка `feature/2026-06-08-daily-value-dashboards-uploads`, фазы S2.1–S2.9.
>
> **Зачем для прода:** главная директора сжата до ≤7 величин (флаг `dashboard.main_rework.enabled`), COO-overview += «сколько закрыли» (флаг `operations.dashboard_rework.enabled`), self-view план-факта `/me/weekly-per-person` (флаг `operations.per_person_self_view.enabled`), /me 5→9 виджетов + 👍/👎 на ответах чата (флаг `me.daily_value_widgets.enabled`), два новых дашборда `/dashboard/portfolio` (здоровье портфеля целей + MoSCoW) и `/dashboard/value-recap`. **Миграция БД ЕСТЬ** (аддитивная, авто). **Новых ENV нет** (все флаги — AdminSetting с code-fallback).

- **Шаг 1 — AdminSetting / kill-switch** (засеиваются отдельными `seed-admin-setting-*`, см. Шаг 7; code-fallback есть):
  - `dashboard.main_rework.enabled` (bool, kill-switch ON) — новая компоновка главной директора (ТЗ-2 Ф1).
  - `operations.dashboard_rework.enabled` (bool, kill-switch ON) — новая раскладка COO-дашборда (ТЗ-2 Ф2).
  - `operations.per_person_self_view.enabled` (bool, kill-switch ON) — self-view `GET /me/weekly-per-person` (ТЗ-2 Ф4).
  - `me.daily_value_widgets.enabled` (bool, kill-switch ON) — 4 виджета пользы + чат-feedback на /me (ТЗ-2 Ф5).
  - `operations.portfolio_health.enabled` (bool, kill-switch ON) + крутилки `portfolio.health.{threshold_healthy,threshold_warning,weight_achieved,weight_on_track,weight_at_risk,weight_stalled,weight_dropped}` (ТЗ-2 Ф6.A). Все зарегистрированы в `admin-setting-schema-registry.ts`.
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260608190000_goal_priority_moscow`): `+ enum GoalPriority (must|should|could|wont)`, `+ Goal.priority GoalPriority?`, `+ table portfolio_health_snapshot` (FK → `Org` ON DELETE CASCADE, unique (tenantId, dateLocal), индекс по (tenantId, snapshotAt desc)). Все изменения аддитивны (CREATE TYPE / ADD COLUMN / CREATE TABLE), без потери данных. Применяется `prisma migrate deploy` в migrate-контейнере на `docker compose up`. Идемпотентна.
- **Шаг 7 — Seed** — **5 новых, идемпотентных, в STEPS** (`phase:'seed-base'`): `scripts/seed-admin-setting-dashboard-main.ts`, `...-operations-dashboard.ts`, `...-operations-per-person.ts`, `...-me-widgets.ts`, `...-portfolio-health.ts` (ключи см. Шаг 1). Все защищают admin-edited. Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update` (или каждый напрямую). Без сидеров работают на code-дефолтах.
- **Шаг 11 — Docker rebuild** — обязателен (backend: `PortfolioHealthService` + `PortfolioHealthSnapshotCron` `@Cron('0 5 * * 1')`, `GET /api/v1/dashboard/operations/portfolio-health`, `PATCH /api/v1/goals/:id/priority`, `GET /api/v1/me/{ideas,recognitions,weekly-per-person}`, `fetchValueStrip`/`reasonSourceRef`/`mainReworkEnabled` в director-dashboard, chat-v2 feedback; frontend: новые виджеты главной + `/dashboard/portfolio` + `/dashboard/value-recap` + modern-визуал/фон админки): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката):
  - Новый cron (≤ след. пн 05:00, без ERROR): в логах backend `portfolio-health-snapshot.cron` (`@Cron('0 5 * * 1')`, per-Org).
  - Новые REST: Swagger `/api/docs` → `GET /api/v1/dashboard/operations/portfolio-health`, `PATCH /api/v1/goals/:id/priority`, `GET /api/v1/me/ideas`, `GET /api/v1/me/recognitions`, `GET /api/v1/me/weekly-per-person`, `GET /api/v1/dashboard/operations/value-recap/:id/export`.
  - Новые метрики: `curl -s localhost:3000/metrics | grep -E 'portfolio_health_score|portfolio_health_snapshot_total|portfolio_priority_set_total|dashboard_value_strip_served_total|dashboard_main_first_screen_widget_count|coo_blockers_resolved_total|coo_team_capacity_widget_served_total|weekly_per_person|me_ideas_fate_served_total|me_recognitions_served_total'` — присутствуют.
  - Миграция применена: в логах migrate-контейнера `goal_priority_moscow` без ошибок.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 📄 2026-06-09 — ТЗ-4 Ф1+Ф10: новые форматы документов + смысловой тип/привязки + AI-подсказка привязки

> Контракт: `plans/archive/2026-06-08-manual-document-upload-and-import-tz.md` (Ф1 схема/парсер/мультифайл/дедуп/привязка + Ф10 AI-подсказка). Ветка `feature/2026-06-08-daily-value-dashboards-uploads`.
>
> **Зачем для прода:** канал `/documents` расширен — новые форматы (xlsx/pptx/html/rtf/odt/csv), мультифайл-загрузка + дедуп `contentHash` + явная привязка (тема/проект/должность → граф) + смысловой тип `docType`; LLM-подсказка привязки (human-in-the-loop). **Миграция БД ЕСТЬ** (аддитивная, авто). **Новых ENV нет** (флаги/крутилки — AdminSetting с code-fallback). Библиотеки `officeparser` + `exceljs` (уже в `package.json`). ⚠ `officeparser` имеет `postinstall` — проверить нативную сборку на прод-Docker.

- **Шаг 1 — AdminSetting / kill-switch** (засеивается `seed-admin-setting-document-attribution.ts` + `seed-admin-settings.ts`, см. Шаг 7; code-fallback есть):
  - `documents.ai_attribution.enabled` (bool, kill-switch ON) — LLM-подсказка привязки документа (`document-attribution-suggest`). Зарегистрирован в `admin-setting-schema-registry.ts`.
  - `documents.{maxSizeMb,maxFilesPerUpload,acceptedFormats}` (int/int/array) — лимиты мультизагрузки. `documents.maxZipSizeMb` — см. блок «ТЗ-4 Ф7» ниже.
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260608200000_documents_formats_type_attribution`): `+ enum DocumentType (regulation|policy|instruction|process|job_description|other)`, `+ значения xlsx/pptx/html/rtf/odt/csv в enum DocumentKind`, `+ Document.docType/suggestedDocType/suggestedThemeId/attachedThemeId/attachedProjectId/contentHash/importBatchId` + индексы (`(tenantId,docType)`, `(tenantId,contentHash)`, `(tenantId,attachedThemeId)`, `(importBatchId)`). Все изменения аддитивны (ADD VALUE / CREATE TYPE / ADD COLUMN), без потери данных. Применяется `prisma migrate deploy` в migrate-контейнере на `docker compose up`. Идемпотентна.
- **Шаг 7 — Seed** — **1 новый, идемпотентный, в STEPS** (`phase:'seed-base'`): `scripts/seed-admin-setting-document-attribution.ts` — `documents.ai_attribution.enabled` (см. Шаг 1). Защищает admin-edited. Также **новый LLM-маршрут** `document-attribution-suggest` (primary `deepseek-v4-flash`) в `seed-llm-task-routes-default.ts` (уже в STEPS, идемпотентно). Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (backend: парсер `officeparser`+`exceljs`, мультифайл `POST /documents` + дедуп `contentHash` + attribution → граф (`block-ingest.applyDocumentAttribution`), `PATCH /documents/:id/attribution`, `DocumentAttributionService` + taskType `document-attribution-suggest`, chat-v2 citations += documentId/Name; frontend: мультизагрузка + форма привязки + SuggestionBanner + doc-citation): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (после выката):
  - Новый REST: Swagger `/api/docs` → `PATCH /api/v1/documents/:id/attribution`; `POST /api/v1/documents` принимает несколько файлов.
  - Маршрут LLM: `docker compose exec backend bun run scripts/diag-routes.ts` → `document-attribution-suggest` ведёт на `deepseek-v4-flash`.
  - Парсер форматов: загрузить .pptx/.xlsx → `Document.status` доходит до `parsed`/`blocks_extracted` без ERROR (проверка нативной сборки `officeparser`).
  - Миграция применена: в логах migrate-контейнера `documents_formats_type_attribution` без ошибок.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 📦 2026-06-08 — ТЗ-4 Ф7: массовый импорт документов из ZIP-архива

> Контракт: `plans/analysis/2026-06-08-manual-document-upload-and-import.md` (ТЗ-4 Ф7). Ветка `feature/2026-06-08-daily-value-dashboards-uploads`.
>
> **Зачем для прода:** новый канал загрузки — пользователь грузит ZIP, каждый поддержанный файл внутри становится отдельным Document (re-use существующего ingest-пути → граф). Новая очередь BullMQ `core.document-import` + воркер. **Миграция БД ЕСТЬ** (аддитивная, авто). **Новых обязательных ENV нет** (лимит — AdminSetting с code-fallback). Библиотека `fflate` (pure-TS, уже была транзитивной — теперь явная зависимость).

- **Шаг 1 — AdminSetting** (засеивается `seed-admin-settings.ts`, см. Шаг 7; code-fallback есть):
  - `documents.maxZipSizeMb` (int, **default 200**) — потолок размера ZIP-архива массового импорта. ENV-fallback `DOCUMENT_MAX_ZIP_SIZE_MB` (опц.). Зарегистрирован в `admin-setting-schema-registry.ts`.
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260608210000_document_import`): `+ enum DocumentImportSource`, `+ enum DocumentImportStatus`, `+ table document_import` (FK → `Org` ON DELETE CASCADE, индекс по (tenantId, status)). Все изменения аддитивны (CREATE TYPE / CREATE TABLE), без потери данных. Применяется `prisma migrate deploy` в migrate-контейнере на `docker compose up`. Идемпотентна.
- **Шаг 7 — Seed** — **расширен существующий, идемпотентный, в STEPS** (`phase:'seed-base'`): `scripts/seed-admin-settings.ts` пополнен ключом `documents.maxZipSizeMb` (default 200, секция `documents`). Защищает admin-edited. Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update` (или напрямую `docker compose exec backend bun run scripts/seed-admin-settings.ts`). Без сидера работает на code-дефолте 200.
- **Шаг 11 — Docker rebuild** — обязателен (backend: новая очередь `core.document-import` + `DocumentImportWorker`, эндпоинт `POST /api/v1/documents/import-zip`, новая зависимость `fflate`; frontend без изменений): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката):
  - Новая очередь/воркер в логах backend (без ERROR): `DocumentImportWorker запущен (core.document-import)`.
  - Новый REST: Swagger `/api/docs` → `POST /api/v1/documents/import-zip` (owner/admin write).
  - Зависимость на месте: `docker compose exec backend node -e "require('fflate')"` — без ошибки.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🎙️ 2026-06-08 — ТЗ-5: ручная загрузка встреч с диаризацией и разметкой спикеров

> Контракт: `plans/archive/2026-06-08-meeting-upload-diarized-speaker-mapping.md` (Ф1–Ф6). Ветка `feature/2026-06-08-daily-value-dashboards-uploads`.
>
> **Зачем для прода:** новый канал — пользователь грузит готовое видео/аудио встречи (≤2 ГБ, любой формат) → ingest (ffmpeg-нормализация) → диаризация (Vox) → ручная разметка говорящих (сотрудник/внешний/исключить/слить) → AI-анализ как у обычной встречи. Новые BullMQ-очереди `meeting.upload-ingest` / `meeting.upload-transcribe` + воркеры. **Миграция БД ЕСТЬ** (аддитивная, авто). **Новых обязательных ENV нет** (рубильник и квота — с code-fallback).

- **Шаг 1 — ENV / AdminSetting / kill-switch** (рубильник работает на code-fallback; квота засеивается, см. Шаг 7):
  - `MEETING_UPLOAD_ENABLED` (bool, **default true**, kill-switch ON) — аварийный рубильник `POST /meetings/upload`. При `false` создание новой загрузки → `UPLOAD_DISABLED` (уже принятые загрузки доезжают). Также переопределяется AdminSetting-ключом `meeting_upload.enabled` (ENV — fallback под него; читается sync `cfg.recording.meetingUploadEnabled` и async в `MeetingUploadsService.assertUploadEnabled`). Реестр флагов — `docs/operations/feature-flags.md`.
  - `billing.meetingUploadsPerMonth` (AdminSetting, int, **default 20**) — месячный лимит ручных загрузок встреч на Org (≥ лимита → `UPLOAD_QUOTA_EXCEEDED`; отдельно от грантов `MeetingsBalance`). ENV-fallback `BILLING_MEETING_UPLOADS_PER_MONTH` (опц.). Зарегистрирован в `admin-setting-schema-registry.ts`.
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260608220000_meeting_upload_diarization`): `+ enum MeetingSource (livekit|upload)`, `+ enum UploadSpeakerAssignment (unassigned|employee|external|excluded)`, `+ value 'awaiting_speakers'` в enum `MeetingStatus` (BEFORE `ai_processing`), `+ Meeting.source (default 'livekit')` / `+ Meeting.uploadNumSpeakersHint`, `+ persons.company` / `+ persons.jobTitle`, `+ table meeting_upload_speaker` (FK → `Meeting` ON DELETE CASCADE / `persons` ON DELETE SET NULL, unique (meetingId,label), индекс по meetingId), `+ индекс Meeting(tenantId, source, createdAt)`. Все изменения аддитивны (ADD VALUE / ADD COLUMN / CREATE TYPE / CREATE TABLE), без потери данных. Применяется `prisma migrate deploy` в migrate-контейнере на `docker compose up`. Идемпотентна.
- **Шаг 7 — Seed** — **расширен существующий, идемпотентный, в STEPS** (`phase:'seed-base'`): `scripts/seed-admin-settings-billing.ts` пополнен ключом `billing.meetingUploadsPerMonth` (default 20, секция `tariff-standard`, severity medium). Защищает admin-edited (findUnique → skip). Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update` (или напрямую `docker compose exec backend bun run scripts/seed-admin-settings-billing.ts`). Без сидера квота работает на code-дефолте 20.
- **Шаг 11 — Docker rebuild** — обязателен (backend: новые очереди `meeting.upload-ingest` / `meeting.upload-transcribe` + воркеры (ingest=ffmpeg-нормализация, transcribe=Vox-диаризация), `MeetingUploadsController` под `/api/v1/meetings`, эндпоинты загрузки/разметки спикеров; frontend Ф5 отдельно): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката):
  - Новые очереди/воркеры в логах backend (без ERROR): `meeting.upload-ingest` и `meeting.upload-transcribe` — `curl -s localhost:3000/metrics | grep -E 'meeting.upload-ingest|meeting.upload-transcribe'` (или по логам старта воркеров).
  - Новые REST: Swagger `/api/docs` → `POST /api/v1/meetings/upload`, `POST /api/v1/meetings/:id/upload/complete`, `GET /api/v1/meetings/:id/upload/playback`, `GET /api/v1/meetings/:id/speakers`, `PUT /api/v1/meetings/:id/speakers`, `POST /api/v1/meetings/:id/speakers/confirm`.
  - Рубильник: `MEETING_UPLOAD_ENABLED`/`meeting_upload.enabled` = ON по умолчанию; квота `billing.meetingUploadsPerMonth` = 20 в `/admin/settings` (или code-fallback).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🔗 2026-06-08 — Батч из 3 ТЗ: умные таблицы · качество клона · Ship-On дефолтов

> Контракты: `plans/tz/2026-06-08-{smart-tables-import-agent-quality, clone-quality-improvements, enable-shipped-features-by-default}.md`. Ветка `feature/2026-06-08-tz-batch-tables-clones-shipon`, 10 коммитов: tables R1-R4 `e84d8ace`; clone Ф1(A) `dbf9b0d4`, Ф6(G) `8446e89a`, Ф7(H) `fc8901fe`, Ф3(D) `3376fae1`, Ф2+Ф4 `2b59c8da`, Ф5(F) `4c28bea1`; ship-on `bb7701dc`.
>
> **Зачем для прода:** TZ#1 — надёжность импорта таблиц (retry pass-1, union опций, type-guard, Jaccard-dedup); TZ#2 — качество клона сотрудника (атрибуция chatbox по говорящему, verify-гейт черт, confidence из дат, decay 1-шаг, split-floor, арбитраж merge); TZ#3 — включение готовых фич дефолтом + очистка отравленных данных. **Всё авто-применяется агрегатором** `apply-prod-deploy.ts --mode update` (migrate-контейнер на каждом `up`).

- **Шаг 1 — ENV / AdminSetting**:
  - **ENV `CONCIERGE_DIALOG_LAYER_ENABLED`** (`typed-config.service.ts`) — **дефолт переведён OFF→ON** (TZ#3). Новой ENV нет; kill-switch сохранён: `CONCIERGE_DIALOG_LAYER_ENABLED=false` в `.env` всё ещё выключает. На выкате ENV можно НЕ трогать (включится сам).
  - Новые AdminSetting-крутилки (code-fallback, регистрации/seed НЕ требуют): `table.agent.draft_max_attempts`(3), `table.import.dedup_col_jaccard`(0.6), `knowledge.skillProfileMinObservations`(тек.), `knowledge.skillClusterMinObservations`(3). Работают без записи в БД.
- **Шаг 4 — Prisma** — **обязательно, авто** (миграция `20260608120000_add_skill_trait_pending_verification`: `ALTER TYPE "SkillTraitStatus" ADD VALUE 'pending_verification'`). Применяется автоматически `prisma migrate deploy` в migrate-контейнере на `docker compose up`. Идемпотентна (повторно no-op). Ручных действий нет.
- **Шаг 6 — Patch** — **1 новый, идемпотентный, в STEPS** (`phase:'patch'`): `scripts/patch-enable-shipped-flags.ts` — выставляет `true` для AdminSetting `knowledge.meetingTasksToTrackerOnly` / `feature.tables_text_to_schema` / `knowledge.curationAutotuneEnabled` ТОЛЬКО если `updatedBy IS NULL` (уважает admin-override); absent → пропуск (code-fallback покроет). Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 7 — Seed** — **дефолты изменены** в `seed-admin-settings.ts` (`knowledge.meetingTasksToTrackerOnly`, `feature.tables_text_to_schema` → `true`) — влияет ТОЛЬКО на чистый старт (существующий прод чинит patch Шага 6). **+ новый LLM-маршрут** `skill-trait-verify` (primary `deepseek-v4-flash`) в `seed-llm-task-routes-skill-and-clone.ts` (уже в STEPS через `skill-and-clone`, идемпотентно).
- **Шаг 8 — Backfill** — **1 новый, идемпотентный, в STEPS** (`phase:'backfill'`, `args:['--apply']`): `scripts/backfill-chatbox-subject-cleanup.ts` — снимает ложные `IdeaBlockEntity{role='subject'}` у блоков с chatbox-evidence (cross-attribution клиент→менеджер). `mentioned` и не-chatbox subject НЕ трогает. Применяется агрегатором с `--apply`; ручная dry-run проверка: `docker compose exec backend bun run scripts/backfill-chatbox-subject-cleanup.ts` (без `--apply`).
- **Шаг 11 — Docker rebuild** — обязателен (backend: новый `SkillTraitVerifyCron`, taskType `skill-trait-verify`, post-passы table-agent, merge/decay/attribution-правки; frontend без изменений в этом батче): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката):
  - Cron виден: `docker compose exec backend grep -r "skill-trait-verify" dist/ | head` ИЛИ в логах воркера `skill-trait-verify.cron: START` (≤ след. 03:30).
  - Маршрут есть: `/admin/ai-models` содержит `skill-trait-verify` (primary deepseek-v4-flash).
  - Миграция применена: в логах migrate-контейнера `pending_verification` без ошибок; `diag.ts logs --level ERROR` — нет `Invalid prisma.skillTrait` по статусу.
  - Backfill отработал: в логах агрегатора `backfill-chatbox-subject-cleanup ... УДАЛЕНО N` (N≥0).

---

### 🔗 2026-06-08 — Ретест №2: оверхол цепочки агентов (4 ТЗ + зонтичные 8 фаз)

> Контракты: 4 точечных ТЗ ретеста `plans/tz/2026-06-07-{tables-detail-render-loop-and-route-fix, provider-smoke-test-and-alerting-fix, ui-copy-meeting-types-titles-and-anglicisms, asr-word-timestamps-duration-behavior}.md` + зонтичный `plans/tz/2026-06-07-agent-chain-overhaul.md` (8 фаз). Ветка `feature/retest2-agent-chain-overhaul`, 12 коммитов: ТЗ A `26219233`, Ф0a `b31c311f`, Ф0b `7c9d6a21`, Ф7+ТЗ D `c8cf2602`, Ф3 `4ef90bde`, ТЗ B `3a2d0ce4`, ТЗ C `f1ca83f6`, Ф1 `0c066468`, Ф2 C1 `c9339992`, Ф4.2 `5f55ee35`, Ф5 `ac3fa181`, Ф6 `c381e7c8`.
>
> **Зачем для прода:** ТЗ A — оживляет детальные страницы «Таблицы» (рендер-петля Zustand + 404 pending-patches); ТЗ B — глушит шум smoke-теста + чинит доставку алертинга; ТЗ C — русские типы встреч/`<title>`/убран «AI»/канон `/chat`; ТЗ D — ненулевые длительность/поведение участников при пустых пословных таймингах ASR; зонтичный — наблюдаемость графа, trace специалистов, recall Решений/Идей, ASR-нота, авто-привязка целей↔тем, консолидация summary, кэш-маршруты, порог авто-Issue. **Миграций БД НЕТ** (`GoalTheme` и все таблицы уже существовали). Фронт — пересборка.

- **Шаг 1 — ENV / AdminSetting**:
  - **ENV `SUMMARY_AGENT_ENABLED`** (`env.schema.ts`, **дефолт TRUE**) — kill-switch summary-агента (Ф5). Можно не выставлять (code-default true); читается также через AdminSetting `aiFeatures.summaryAgentEnabled`. `false` — только если summary-агент создаёт проблемы (тогда потребители падают на `summaryV2 ?? summary` через `pickPrimarySummary`).
  - Прочие новые AdminSetting (`tracker.autoAcceptConfidenceThreshold`, `goals.themeAutolinkMinWeight`, `goals.themeAutolinkLlmEnabled`) — см. Шаг 7 (засеиваются `seed-admin-settings.ts`, code-fallback есть).
- **Шаг 4 — Prisma** — **не требуется** (схема не менялась; `GoalTheme` уже существовал, привязка целей↔тем пишет в существующую модель `GoalTheme(source='ai')`).
- **Шаг 6 — Patch** — **1 новый, идемпотентный**: `scripts/patch-llm-routes-report-chain-deepseek.ts` — переводит маршруты `summary` / `report-by-type` / `tasks` на DeepSeek (кэш-дружелюбная цепочка, Ф6). Зарегистрирован в `apply-prod-deploy.ts` STEPS. Прогон: `docker compose exec backend bun run scripts/patch-llm-routes-report-chain-deepseek.ts` (или через агрегатор `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`). Не трогает маршруты с `editedByAdmin=true`.
- **Шаг 7 — Seed** — `scripts/seed-admin-settings.ts` пополнен 4 ключами (идемпотентно, защищает admin-edited): `tracker.autoAcceptConfidenceThreshold` (дефолт **0.75**, был мёртвый hardcoded 0.92 — порог авто-принятия Issue из встречи), `goals.themeAutolinkMinWeight` + `goals.themeAutolinkLlmEnabled` (Ф4.2 авто-привязка Goal↔Theme), `aiFeatures.summaryAgentEnabled` (Ф5, дефолт **true**). Прогон: `docker compose exec backend bun run scripts/seed-admin-settings.ts` (или агрегатором `apply-prod-deploy.ts --mode update`). Без сидера все 4 работают на code-дефолте.
- **Промпт-правки — отдельной seed-операции НЕ требуют.** Маркеры decision/idea в `block-ingest.prompt` (Ф1) и ASR-нота `withAsrNote` на 10 извлекающих промптах (Ф2 C1) — это **code-промпты** (prompt registry с code-fallback), едут с деплоем кода. Отдельный seed/patch не нужен.
- **Шаг 11 — Docker rebuild** — обязателен (backend: `GraphMaterializationService` + `GraphDiagnosticsController` (`/api/v1/platform/graph`) + `GraphMaterializationVerifyCron`, trace специалистов в диспетчере `core.specialist-routing`, `GoalThemeLinkerService` + `GoalThemeLinkerCron`, `merge.worker`/`behavior-metrics.worker` + `vox.types`, `pickPrimarySummary` у потребителей, smoke-кламп в openai-proxy, новая ENV; frontend: `useShallow` на таблицах, русские типы встреч + `<title>` + канон `/chat`): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - Новые cron (grep в логах backend через ≥30 мин): `graph-materialization-verify` (`@Cron` 30 мин, per-Org) и `goal-theme-linker` (`@Cron` 30 мин) — строки запуска присутствуют, без ERROR.
  - Новый REST: Swagger `/api/docs` показывает `GET /api/v1/platform/graph/materialization` (SuperAdmin); `diag graph --meeting <id>` отдаёт расхождения материализации.
  - Новые метрики: `curl -s localhost:3000/metrics | grep -E 'kc_materialization_gap_total|goal_theme_autolink_total'` → `kc_materialization_gap_total{type}` (разрыв материализации графа) и `goal_theme_autolink_total{method}` (авто-привязка Goal↔Theme) присутствуют.
  - Таблицы: `/tables/[id]` открывается (нет белого экрана / React #185); `GET /api/v1/tables/pending-patches` не 404.
  - Trace специалистов: на тест-встрече `diag chain --meeting <id>` → специалисты слоя 3 видны под `traceId=mtg_<id>` (раньше были невидимы под `block_`).
  - Кэш-маршруты: `docker compose exec backend bun run scripts/diag-routes.ts` → `summary`/`report-by-type`/`tasks` ведут на DeepSeek.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🔁 2026-06-08 — Ретест №2: остаток цепочки агентов без golden (ТЗ `agent-chain-remaining-no-golden`)

> Контракт: `plans/tz/2026-06-08-agent-chain-remaining-no-golden.md`. Ветка `feature/retest2-agent-chain-overhaul`, 7 коммитов `7430162e..accdfe7b`: Ф1 idea direct-path `7430162e`, Ф2 промпты `0c283e60`/`6dd216f5`/`0dfe170f`, Ф5 Р2 task-dedupe `a933138e`, Ф4.1 goal-task-link `e174baaa`, Ф6 smoke cache-hit `f28200cb`, ТЗ B код-хвост `c457403d`, ТЗ D Vox `accdfe7b`.
>
> **Зачем для прода:** Ф1 — детерминированная материализация Idea из блоков (recall идей без LLM-плодёжа); Ф2 — ASR-нота/калибровка/анти-галлюцинация имён/булевы гейты на экстракторах (качество извлечения, code-промпты); Ф5 Р2 — семантический дедуп задач встречи (LLM-арбитр серой зоны, за флагом OFF); Ф4.1 — авто-привязка AI-цели встречи к её задачам (Issue.goalId, за флагом OFF); Ф6 — smoke cache-hit-ratio WARN по DeepSeek (видимость экономии кэша); ТЗ B — Express5 named-wildcard + JSON-резилиенс в 2 воркерах; ТЗ D — Vox word-timings из extendedResult + PII-safe диагностика. **Миграций БД НЕТ** (schema.prisma не менялся, все флаги через `resolveSync`). **Новых ENV в `env.schema.ts` НЕТ** (флаги читаются `resolveSync` с code-дефолтом при отсутствии ENV). Новые арбитры — за флагами OFF (поведение прода не меняется до явного включения владельцем).

- **Шаг 1 — ENV / AdminSetting / kill-switch**:
  - **Новых ENV НЕТ** (`env.schema.ts` не трогался). Все новые тумблеры — **AdminSetting-ключи** (читаются через `resolveSync`, code-fallback при отсутствии записи; засеиваются `seed-admin-settings.ts`, см. Шаг 7):
    - `knowledge.ideaDirectPathEnabled` (bool, **default true**) — детерминированная материализация Idea из блоков `signalType='idea'` в `block-ingest.worker` (Ф1). Дедуп по `sourceBlockId` (guard в specialist-3-6-ideas). OFF — вернуть старое поведение (идеи только через LLM-специалиста).
    - `meetings.taskDedupeEnabled` (bool, **default false**) — семантический дедуп задач встречи (`MeetingTaskDedupeService`, embedding KNN + LLM-арбитр серой зоны, удаляет fast-черновики-дубли). **Флип ON владельцем после прод-наблюдения** (data-affecting: удаляет Task-черновики).
    - `meetings.taskDedupeThreshold` (number, **default 0.85**) — порог косинусной близости для KNN-кандидатов дедупа.
    - `goals.goalTaskLinkEnabled` (bool, **default false**) — авто-привязка AI-цели встречи к её Issue (`Issue.goalId`, non-destructive) через LLM-арбитр (`GoalTaskLinkerService` + cron). **Флип ON владельцем после прод-наблюдения** (новый арбитр + cron).
    - `llm.cacheSmokeEnabled` (bool, **default true**) — включает проверку cache-hit-ratio DeepSeek в `provider-smoke-test.cron`.
    - `llm.cacheHitRatioWarnThreshold` (number, **default 0.6**) — порог WARN: если доля кэш-хитов DeepSeek ниже — smoke пишет WARN (видимость, что правки SYSTEM ломают кэш).
  - **taskDedupe / goalTaskLink остаются OFF на выкате** — это новые арбитры с побочными эффектами (удаление черновиков / запись `Issue.goalId`). Включать только после прод-наблюдения метрик `z_task_dedupe_total` / `z_goal_task_link_total` через админку настроек (super_admin).
- **Шаг 4 — Prisma** — **не требуется** (schema.prisma не менялся; `Issue.goalId` уже существовал, дедуп оперирует существующими `Task`/`Issue`/`MeetingChapter`).
- **Шаг 5 — postgres-init.sql** — **не затронут** (новых HNSW/GIN/partial/extension нет).
- **Шаг 7 — Seed** — **2 новых маршрута + пополнение `seed-admin-settings.ts`**, все идемпотентны и **уже в `apply-prod-deploy.ts` STEPS** (прогон агрегатора их подхватит):
  - `scripts/seed-llm-task-routes-task-dedupe.ts` — taskType `task-dedupe` → `deepseek-v4-flash` (cheap-арбитр серой зоны). Phase `seed-llm-routes`.
  - `scripts/seed-llm-task-routes-goal-task-link.ts` — taskType `goal-task-link` → `deepseek-v4-flash` (cheap-арбитр). Phase `seed-llm-routes`. Маршрут нужен заранее — иначе при включении флага вызов поедет по аварийному `DEFAULT_FALLBACK_CHAIN`.
  - `scripts/seed-admin-settings.ts` пополнен новыми ключами (`knowledge.ideaDirectPathEnabled`, `meetings.taskDedupeEnabled`, `meetings.taskDedupeThreshold`, `goals.goalTaskLinkEnabled`, `llm.cacheSmokeEnabled`, `llm.cacheHitRatioWarnThreshold`) — идемпотентно, защищает admin-edited. Уже в агрегаторе.
  - Прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`. Без сидов всё работает на code-дефолтах (`resolveSync`).
- **Промпт-правки (Ф2) — отдельной seed-операции НЕ требуют.** ASR-нота/калибровка/анти-галлюцинация имён/`meetingDateIso` на `meeting-report-fast`+`block-ingest`; ASR/калибровка на `block-distill`/`theme-classify`/`axis-classify`/`knowledge-clone-extract`/`chapters-v2`/`goal-hierarchy-link`/`entity-merge-arbiter`; C8 `entity-merge` SYSTEM «5→1»; C3 булевы гейты `isDecision`/`isIdea` на decision/idea extract — это **code-промпты** (prompt registry с code-fallback), едут с деплоем кода.
- **Шаг 11 — Docker rebuild** — обязателен (backend: `MeetingTaskDedupeService` (modules/meetings), `GoalTaskLinkerService` + `GoalTaskLinkerCron` (modules/knowledge-core), idea direct-path в `block-ingest.worker`, smoke cache-hit в `provider-smoke-test.cron` + `BusinessMetricsService.getLlmCacheHitRatio`, Express5 named-wildcard в `app.module` + JSON-резилиенс в `intake-auto-triage.worker`/`meeting-speaker-analyzer.worker`, `parseVoxResult` extendedResult): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (после выката):
  - Новый cron (grep в логах backend через ≥30 мин): `goal-task-linker` (`@Cron` 30 мин, per-Org, `WorkerOrgGate`, в `ai/workers.module`) — строки запуска присутствуют, без ERROR. Cron `provider-smoke-test` теперь дополнительно делает `checkCacheHitRatio` (WARN при доле кэша DeepSeek ниже `llm.cacheHitRatioWarnThreshold`).
  - Новые taskType (read-only): `docker compose exec backend bun run scripts/diag-routes.ts` → `task-dedupe` и `goal-task-link` ведут на `deepseek-v4-flash`.
  - Новые метрики: `curl -s localhost:3000/metrics | grep -E 'z_task_dedupe_total|z_goal_task_link_total|z_llm_calls_total|z_llm_cache_hit_ratio_below_threshold'` → `z_task_dedupe_total{result}` (дедуп задач), `z_goal_task_link_total{result}` (привязка цель↔задача), `z_llm_calls_total{provider}` (знаменатель кэш-доли), `z_llm_cache_hit_ratio_below_threshold{provider}` (gauge — 1 если ниже порога) присутствуют.
  - Флаги (по умолчанию): `task-dedupe`/`goal-task-link` — OFF, удалений/привязок нет; `idea-direct-path` — ON (идеи материализуются детерминированно из блоков `signalType='idea'`); cache-smoke — ON (WARN в логах при низком кэш-хите DeepSeek).
  - **Включение data-affecting флагов — отдельно, после наблюдения:** `meetings.taskDedupeEnabled` и `goals.goalTaskLinkEnabled` флипнуть в админке настроек только после проверки метрик/логов на тест-встрече.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🩹 2026-06-06 — Стабильность прода: 6 ТЗ (ветка `feature/prod-stability-2026-06-06`)

> Контракты: `plans/tz/2026-06-06-{frontend-stability-chunk-and-video, recording-pipeline-reliability-reconcile, meeting-tasks-quality-dedup-asr, graph-arbiter-json-resilience, meeting-report-copy-download-actions, agent-quality-golden-harness}.md`.
> **Зачем для прода:** ТЗ-1 убирает «белый экран» ChunkLoadError (webpack вместо Turbopack) + оживляет видео (нативный `<video>`); ТЗ-2 ограничивает 18-мин паузу пайплайна сверху ≤2 мин (composite-reconcile-крон); ТЗ-3 чинит молчаливую потерю связей графа; ТЗ-4 — качество извлечения задач; ТЗ-5 — действия отчёта; ТЗ-6 — измеритель качества. **Схема БД НЕ меняется, миграций/seed/backfill НЕТ.** Новые рискованные/внешне-наблюдаемые фичи — за флагами с дефолтом OFF (поведение прода не меняется до явного включения).

- **Шаг 1 — ENV / build-arg**:
  - **build-arg фронта `DEPLOYMENT_VERSION`** (git sha, НЕ runtime-ENV backend, в `env.schema.ts` НЕ добавляется). Выкат фронта: `DEPLOYMENT_VERSION=$(git rev-parse --short HEAD) docker compose up -d --build frontend` (или прокинуть в `.env`). Без него `deploymentId=undefined` — не ломает, просто version-skew-защита неактивна.
  - **ENV `RECORDING_COMPOSITE_RECONCILE_ENABLED`** (`env.schema.ts`, **дефолт ON**) — kill-switch composite-egress reconcile-крона. Можно не выставлять (code-default true). `false` — только если крон создаёт проблемы.
  - **ENV `LIVEKIT_WEBHOOK_ACK_FIRST_ENABLED`** (`env.schema.ts`, **дефолт OFF**) — ack-first вебхуков (200 до обработки). OFF = текущее синхронное поведение. Включать ТОЛЬКО осознанно: при рестарте в окне фоновая обработка `room_finished` теряется (крон догоняет composite/track, но НЕ room_finished). Только для замера секвенс-холда.
  - **ENV `LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED`** (`env.schema.ts`, **дефолт OFF**) — forced `tool_choice` для не-thinking deepseek (лучше JSON-compliance). OFF = текущее `tool_choice:'auto'`. Включать ПОСЛЕ прод-пробы agent-lia (принимает ли прокси forced function); guard сам откатит на 'auto' при format-400, но проба желательна. `strict:true` НЕ добавлен (нужна та же проба).
- **Шаг 4 — Prisma**:
  - (прежний push) reconcile-крон — изменений схемы не требовал.
  - **(chatboxFix 2026-06-08)** миграция `20260608200000_chatbox_analysis_enabled` — `ALTER TABLE "ChatboxIntegration" ADD COLUMN "analysisEnabled" BOOLEAN NOT NULL DEFAULT false`. Применяется **автоматически** на `up -d` через `prisma migrate deploy` (migrate-контейнер) — ручных действий нет. Семантика: per-integration гейт AI-анализа (default OFF — анализ не запускается, пока владелец не включит тумблер в UI интеграции).
- **Шаг 11 — Docker rebuild** — обязателен (backend: `MeetingFinalizationService` + `CompositeEgressReconcileCron` в webhooks, `listCompositeEgress`/`reconcileCompositeEgress` в recordings, ack-first + метрика gap, entity-graph устойчивость + router validate-callback + deepseek forced tool_choice, ASR-нота + `OrgContextService`, 3 новых ENV; frontend: webpack-сборка + `deploymentId`, нативный `<video>` вместо Vidstack, error-boundary + chunk-reload, баннер «Отчёт готовится», действия отчёта): `DEPLOYMENT_VERSION=$(git rev-parse --short HEAD) docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - Крон: после старта backend в логах — строка запуска `composite-egress-reconcile` (раз/мин); на застрявшей встрече пауза `completed→recording_ready` ≤ ~2 мин (лог `reconcileCompositeEgress: composite догнан кроном`). Флип `RECORDING_COMPOSITE_RECONCILE_ENABLED=false` → крон молчит.
  - Метрики (`curl -s localhost:3000/metrics | grep ...`): `livekit_egress_ended_gap_seconds` (gap доставки egress-вебхука), `kc_entity_graph_invalid_json_total`/`kc_entity_graph_fallback_none_total` (устойчивость арбитра — fallback_none должен падать vs до выката), `incLlmRouterDispatch{status="invalid_output"}` (validate-callback пробует secondary).
  - Фронт: `/result` с записью — `<video>` играет (readyState>0), клик по главе перематывает; на детальных страницах нет английского «This page couldn't load» (русский экран + тихий reload при version skew); заголовок ответа фронта содержит `x-deployment-id` если `DEPLOYMENT_VERSION` пробросился.
  - Прод-верификация (владелец, см. реестр «не-сделано»): ≤2 мин пауза, падение fallback-none метрик, baseline качества (ТЗ-6 `agent-quality-harness.ts`).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🔐 2026-06-06 — Доступ к знаниям через группы + фундамент-провенанс (knowledge-access)

> Контракт: `plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md`. Ветка `feature/knowledge-access-groups`. 8 фаз: Ф1 провенанс автора на все типы + per-adapter identity · Ф2 модель групп + резолвер · Ф3 ingest-вывод группы блока · Ф4 security-гейт во всех поверхностях retrieval · Ф5 контекст клонов в правах спрашивающего · Ф6 наследование группы на проекции · Ф7 frontend admin (матрица/членство/флаг встречи) · Ф8 выкат.
>
> **Зачем для прода:** 1 аддитивная миграция (4 модели + 2 поля) + 1 seed (группы) + 2 backfill (subject-атрибуция всех типов, department-группы) + 1 patch (interview→personal) + 2 новых флага. **Гейт по умолчанию OFF — поведение байт-в-байт текущее.** Выкат безопасно поэтапный: off → shadow (сверка метрик) → enforce.

- **Шаг 1 — ENV / AdminSetting**:
  - **ENV `KNOWLEDGE_ACCESS_ENFORCEMENT`** = `off` | `shadow` | `enforce`, **дефолт `off`** (`env.schema.ts`). Режим гейта доступа к знаниям. На выкате оставить `off`; перевод в `shadow`/`enforce` — см. Шаг 12. owner/admin/super — bypass всегда.
  - **AdminSetting `knowledge.subjectAttributionAllTypes`** (bool, **default TRUE**, code-fallback TRUE через `TypedConfigService.getDynamic`) — расширенная привязка автора знания на ВСЕ типы (не только reasoning). Master-выключатель `knowledge.subjectAttributionEnabled` сохранён. Засеивается идемпотентно `seed-admin-settings.ts` (уже в агрегаторе, phase `seed-base`); без сидера работает на code-дефолте.
- **Шаг 4 — Prisma миграция** — **обязательно, автоматически** (аддитивно, без data-loss). Миграция **`20260606114416_knowledge_access_groups`** = 4 новые модели (`KnowledgeGroup`, `KnowledgeGroupMember`, `IdeaBlockAccess`, `GroupVisibilityPolicy`) + enum `KnowledgeGroupKind` + поля `Meeting.closedGroupKind String?` и `MeetingTypeConfig.defaultClosedGroupKind String?`. Едет файлом миграции, применяется **автоматически** на `docker compose up -d` через `prisma migrate deploy` (migrate-контейнер). Проверка: `docker compose run --rm --no-deps backend sh -c 'bunx prisma migrate status'` → миграция в списке applied.
- **Шаг 6 — Patch** — **1 новый, идемпотентный**: `scripts/patch-meeting-type-closed-defaults.ts` — `MeetingTypeConfig.defaultClosedGroupKind='personal'` для типа `interview` (В6), если ещё NULL (на проде, где bootstrap прошёл до фичи). Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: 'patch'`, `skipBootstrap: true`). Прогон: `docker compose exec backend bun run scripts/patch-meeting-type-closed-defaults.ts --dry-run` → без флага. Через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 7 — Seed** — **1 новый, идемпотентный**: `scripts/seed-knowledge-groups.ts` — синглтон-группы «Руководство»/«Совет» + department-группы из существующих `Department` + leadership-членство из owner/admin. Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: 'seed-base'`). Прогон: `docker compose exec backend bun run scripts/seed-knowledge-groups.ts` (или агрегатором `apply-prod-deploy.ts --mode update`).
- **Шаг 8 — Backfill** — **2 новых, идемпотентных**:
  - `scripts/backfill-subject-attribution-all-types.ts` — добивает `IdeaBlockEntity{role='subject'}` для исторических canonical-блоков ВСЕХ типов (не только reasoning) + per-adapter identity (tracker/chatbox/dump/email). Уважает флаги `knowledge.subjectAttributionEnabled` + `knowledge.subjectAttributionAllTypes`. Сначала `--dry-run`, затем без флага. STEPS (`phase: backfill`, `skipBootstrap`).
  - `scripts/backfill-block-access.ts --departments` — department-группы (`IdeaBlockAccess`) для исторических блоков из functional axisLabels (+ участники/автор). closed задним числом НЕ назначается (В5: историческое знание = открыто). **Без `--departments` скрипт no-op** — в STEPS прописан с `args:['--departments']`. Сначала `--dry-run --departments`, затем `--departments`. STEPS (`phase: backfill`, `skipBootstrap`).
  - Оба — через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (backend: новый модуль `knowledge-access`, `KnowledgeAccessResolver` в rbac, `BlockAccessDeriverService` + гейт во всех retrieval-поверхностях, `env.schema.ts` новый флаг; frontend: `company-admin/access-groups`, селектор закрытости встречи): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (поэтапный перевод флага):
  1. После выката `KNOWLEDGE_ACCESS_ENFORCEMENT` остаётся `off` — выдача идентична baseline. Swagger `/api/docs` показывает `/api/v1/knowledge-access/*` и `PATCH /meetings/:id/closed-group`.
  2. Перевести в **`shadow`** (выдача не меняется), дать набежать данным, сверить метрики: `curl -s localhost:3000/metrics | grep kc_access_shadow_diff_total` — по `{surface}` видно, сколько блоков было бы отфильтровано. Также `kc_subject_attribution_total{via}` растёт (провенанс работает).
  3. Если расхождение ожидаемое — перевести в **`enforce`**. Проверить e2e-предикат «логист не видит блок Совета» во всех поверхностях: chat / search / snapshot / blocks / контекст клона — член «Логистики» НЕ получает блок с `IdeaBlockAccess{closed=Совет}`; owner — получает. `curl -s localhost:3000/metrics | grep kc_access_denied_total` → счётчик `{surface}` растёт.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🧩 2026-06-06 — Трекер + Встречи (sergdev)

> Контракт: `plans/tz/2026-06-06-FINAL-session-tracker-and-meetings.md`. Ветка `sergdev`. 12 фаз: A1-A7 (трекер: пикер проекта во Входящих, единый «Спринт», группа меню «Задачи», подвкладки проекта, русификация, скрытие теневого проекта, консолидация поллинга бейджей) + B1-B5 (встречи: войти/ссылка/пригласить в журнале, rejoin хоста, надёжный copyLink, лобби-ссылка, эндпоинт `POST /meetings/:id/invitees`).
>
> **Зачем для прода:** аддитивная миграция (`Project.systemGenerated`) + 1 русификационный patch + 1 backfill для legacy-контейнеров. Остальные фазы (A1-A5 фронт, A7, B1-B4) — без БД-операций.

- **Шаг 4 — Prisma миграция** — **обязательно, автоматически** (аддитивно, без data-loss). Миграция **`20260606071402_project_system_generated`** = `ALTER TABLE "Project" ADD COLUMN "systemGenerated" BOOLEAN NOT NULL DEFAULT false` (скрывает теневой org-контейнер «Спринт компании» из `GET /projects`). Едет файлом миграции, применяется **автоматически** на `docker compose up -d` через `prisma migrate deploy` (migrate-контейнер). Никакого `db push`. Проверка применения: `docker compose run --rm --no-deps backend sh -c 'bunx prisma migrate status'` → миграция в списке applied.
- **Шаг 6 — Patch** — **1 новый, идемпотентный**: `scripts/patch-team-templates-ru.ts` — русификация ролей шаблона продаж (SDR → «Специалист по квалификации», BANT/CHAMP → «методике квалификации») в `TeamTemplate.definition`. Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: 'patch'`, `skipBootstrap: true`). Прогон: `docker compose exec backend bun run scripts/patch-team-templates-ru.ts` (или через агрегатор `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`).
- **Шаг 8 — Backfill** — **1 новый, идемпотентный**: `scripts/backfill-system-generated-projects.ts` — помечает существующие legacy org-контейнеры «Спринт компании» `systemGenerated = true` (чтобы они тоже пропали из `GET /projects`). Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: 'backfill'`, `skipBootstrap: true`). Сначала `--dry-run`, затем без флага: `docker compose exec backend bun run scripts/backfill-system-generated-projects.ts --dry-run` → `docker compose exec backend bun run scripts/backfill-system-generated-projects.ts`. Через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (backend: `ProjectsService.findAll` фильтр `systemGenerated:false`, `MeetingsService.addInvitees` + контроллер; frontend: журнал/комната/лобби встреч, меню «Задачи», подвкладки проекта, пикер проекта, «Архив спринтов»): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - Swagger `/api/docs` показывает `POST /meetings/:id/invitees`.
  - Ручной чек «допригласить» на active-встрече → новый `Participant(invitationStatus='invited')` + ушло приглашение со ссылкой `…/m/<id>?inv=<token>`; повтор того же `userId`/`personId` → no-op (`skipped`).
  - `GET /projects` больше не возвращает теневой «Спринт компании» (org-scope контейнер) — он виден только в разделе «Спринты».
  - Прочие фазы (A1-A5 фронт, A7, B1-B4) — без БД-операций, достаточно `docker compose up -d --build`.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🛡️ 2026-06-05 — Надёжность LLM-роутера + нормализация цепочек (deepseek → openai → kie)

> Контракт: `plans/tz/2026-06-05-llm-router-resilience-and-chain-normalization.md`. Ветка `sergdev`. Коммиты: Ф1 `025714d3`, Ф3 `caf69f13`, Ф4 `b68554fb`, Ф2a `c21c9e15`, Ф2b `cb820a69`.
>
> **Зачем.** Аудит прод-маршрутов 2026-06-05 показал: у большинства агентов работал только PRIMARY. SECONDARY (`openai-via-proxy`) падал `400 "messages must contain the word 'json'"` на всех JSON-задачах; TERTIARY (`ollama:qwen3.5:9b`) — `401 Invalid API key format` везде. 5 pro-агентов вообще без fallback, граф (`block-linker`) молча терял связи, таймаут 30с убивал thinking-модели. Цель — стандартная цепочка везде `deepseek → openai-via-proxy(gpt) → kie:gemini-3.1-pro`, ollama выведен из всех боевых цепочек, `gpt-4o` выведен полностью.

- **Шаг 1 — ENV** — **1 новый (опциональный, дефолт уже поднят в коде)**: `LLM_ROUTER_DISPATCH_TIMEOUT_MS=300000` — таймаут одного dispatch модели (per-attempt). Был `30000`, поднят до `300_000`, чтобы thinking-модели (`deepseek-v4-pro`) успевали на объёмном входе. Можно не выставлять (code-fallback теперь `300_000`); если в проде стоит руками старое `30000` — **поднять до `300000`**. ⚠️ Это заменяет старую запись «`LLM_ROUTER_DISPATCH_TIMEOUT_MS=30000` (С30)» в архивном блоке аудита 2026-05-29 — там был дефолт 30с, теперь 300с.
- **Шаг 4 — Prisma** — **не требуется** (схема не менялась).
- **Шаг 6 — Patch** — **1 новый, идемпотентный**: `scripts/patch-normalize-llm-chains-deepseek-openai-kie.ts` — нормализует все цепочки `LlmTaskRoute` (tenantId=null) к стандарту `deepseek → openai-via-proxy(gpt) → kie:gemini-3.1-pro`; выводит `ollama` из primary/secondary и `gpt-4o` из проекта (4 агента: `orchestrator-plan`/`orchestrator-synthesize`/`brand-voice-extract` → `deepseek-v4-pro`, `concierge-respond` → `gpt-5-mini`); openai-primary исключения (классификаторы на nano + `debate`-diversity) сохраняются. Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: 'seed-llm-routes'`, `skipBootstrap: true`) **БЕЗ `--force`** — steady-state уважает `editedByAdmin`-правки.
  - ⚠️ **РАЗОВО при ЭТОМ выкате — гнать с `--force`** (решение владельца Р-A): нужно перетереть легаси `ollama`/`gpt-4o`, в т.ч. в маршрутах с `editedByAdmin=true`. Порядок обязателен: сначала `--dry-run` (глазами просмотреть строки с `editedByAdmin=true` — что именно перетираем), затем `--force`:
    ```bash
    docker compose exec backend bun run scripts/patch-normalize-llm-chains-deepseek-openai-kie.ts --dry-run
    docker compose exec backend bun run scripts/patch-normalize-llm-chains-deepseek-openai-kie.ts --force
    ```
  - На последующих выкатах `--force` НЕ нужен — агрегатор гонит без него (steady-state, не клобберит будущие админ-правки).
- **Шаг 7 — Seed** — **1 новый, идемпотентный**: `scripts/seed-llm-task-routes-missing-registry.ts` — заводит дефолтные цепочки для 5 ранее не зарегистрированных taskType (`knowledge-specialists-combined`, `dialog-multi-query-clone`, `checkin-sentiment-batch`, `experiment-extract`, `experiment-summarize-lessons`) — закрытая дыра реестра (они теперь в `ALL_LLM_TASK_TYPES`). Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: 'seed-llm-default'`). Также code-сиды (`seed-llm-task-routes-default.ts`) и `DEFAULT_FALLBACK_CHAIN` обновлены: tertiary `ollama:qwen3.5:9b` → `kie:gemini-3.1-pro`. Прогон: `docker compose exec backend bun run scripts/seed-llm-task-routes-missing-registry.ts`.
- **Агрегатором (рекомендуется)** — оба скрипта входят в `apply-prod-deploy.ts --mode update` (`docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`). **НО** разовый `--force` для нормализации агрегатор не делает — его гнать **вручную** командой выше, до/после агрегатора.
- **Шаг 11 — Docker rebuild** — обязателен (backend: `env.schema.ts` дефолт таймаута, `OpenAiProxyService.ensureJsonHint` (Ф3 — чинит secondary на JSON-задачах), `block-linker` retry + общий lenient-парсер `json-extract.util.ts` (Ф4), `kie.maxDataClass internal→private`, регистрация 5 taskType): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke**:
  - карта маршрутов после прогона (read-only): `docker compose exec backend bun run scripts/diag-routes.ts` → (а) `ollama` нет ни в одной строке боевых LLM-цепочек, (б) tertiary везде `kie:gemini-3.1-pro`, (в) `gpt-4o` (без `-mini`) отсутствует, (г) 5 ранее потерянных taskType присутствуют.
  - новая метрика молчаливой деградации графа: `curl -s localhost:3000/metrics | grep kc_block_linker_fallback_none_total` (растёт `{reason=...}` только при реальной потере связи — повесить алерт).
  - secondary на JSON-задачах больше не 400: после тест-встречи `bun run --env-file=.env scripts/diag.ts trace --meeting <id>` → `reportFast` не failed, в логах нет `messages must contain the word 'json'`.

#### 💰 2026-06-05 — Безопасность стоимости LLM + retention телеметрии (поверх блока надёжности роутера)

> Контракт: `plans/tz/2026-06-05-llm-cost-safety-and-telemetry-retention.md`. Ветка `sergdev`. Закрывает риски #4 (бюджет LLM не enforce-ится, `costUsd=0` молча) и #5 (`AiUsageLog` без retention) техаудита. Реализовано целиком (3 фазы).
>
> **Зачем.** До фикса: взбесившийся воркер/тенант выжигал месячный лимит за часы (бюджет только наблюдался алертом раз в 2ч, `LlmRouter.call` его не проверял); модели вне прайс-карты молча давали `costUsd=0` (только `logger.debug` — расход невидим); телеметрия `AiUsageLog` (строка + 2 TEXT-превью до 8 КБ) росла append-only без retention.

- **Шаг 4 — Prisma** — **не требуется** (схема не менялась; `OrgBudgetCap.capKind 'soft'|'hard'` уже был в схеме; превью `AiUsageLog` уже nullable).
- **Шаг 7 — Seed / AdminSetting** — **не требуется**. Все новые ключи читаются через `getDynamic` с code-fallback → дефолты применяются лениво, выкат БЕЗ сидов безопасен. Ключи (дефолты): `llm.budget.enforce_enabled`(bool, **false**), `llm.budget.mtd_cache_ttl_sec`(int, 60), `llm.usage_log.scrub_previews_after_days`(int, 30), `llm.usage_log.delete_after_days`(int, 365). Опционально настраиваются через админку настроек под super_admin.
- **Прод-операций по схеме/сидам НЕТ.** Достаточно деплоя кода: `docker compose up -d --build backend` (+ перезапуск worker-процесса — там self-scheduling retention-сервис `AiUsageLogCleanupService`, раз в час).
- **Шаг 11 — Docker rebuild** — обязателен (backend: `llm-router.service.ts` pre-dispatch budget-gate + WARN на unpriced; новый `budget-guard.service.ts`; новый `ai-usage-log-cleanup.service.ts`; `business-metrics.service.ts` — 2 новые метрики): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke**:
  - новые метрики в `/metrics`: `curl -s localhost:3000/metrics | grep -E 'llm_cost_unpriced_total|llm_budget_exceeded_total'` → счётчики присутствуют. `llm_cost_unpriced_total{provider,model}` растёт при вызове модели вне прайс-карты (видимость `costUsd=0`); `llm_budget_exceeded_total{mode}` (`mode=observe`|`enforce`) — при превышении hard-cap.
  - retention (через ≥1ч после старта worker): в логах worker строка о прогоне `AiUsageLogCleanupService` (Tier-1 scrub превью / Tier-2 delete), без ERROR.
- **⚠️ ВАЖНО — `llm.budget.enforce_enabled` оставить OFF** до решения владельца по поведению enforcement (развилка Р-1 в ТЗ: block / degrade / alert-only). До включения — чистый observe: бюджет считается, метрится, логируется «would block», но НЕ блокирует. Включать только после явного подтверждения владельца А/B/C.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🎯 2026-06-05 — ТЗ-F Цели: ответственный (ownerPersonId) + кэш blocksCount + UI-полировка

> Ветка `feature/goals-improvements`. Контракт: `plans/tz/2026-06-05-goals-improvements.md` (Ф1–Ф4; Ф5 голос — vNext). Коммиты: Ф1 `afe344b2`+`2701cff2`, Ф2 `62febeec`, Ф3 `158ac9df`, Ф4 `184bce07`.

- **Шаг 4 — Prisma миграция** — **обязательно** (аддитивно, без data-loss). После мержа `dev` (переход на миграции) изменения едут **файлом миграции `20260605130000_goal_owner_person_and_blocks_cache`**, применяется **автоматически** на `docker compose up -d` через `prisma migrate deploy` (migrate-контейнер). Никакого `db push`. Содержимое: `Goal += ownerPersonId String?` (relation `ownerPerson` GoalOwnerPerson, FK `→ persons(id) ON DELETE SET NULL`) + `cachedBlocksCount Int?` + `@@index([tenantId, ownerPersonId])`; `Person += ownedGoals Goal[] @relation("GoalOwnerPerson")`. Проверка применения: `docker compose run --rm --no-deps backend sh -c 'bunx prisma migrate status'` → миграция в списке applied.
- **Шаг 1 — ENV/AdminSetting** — новых ENV/флагов нет. Пороги «светофора уверенности» — code-fallback в `frontend/src/domain/goal.ts` (`confidenceLevel`); вынос в AdminSetting → vNext.
- **Шаг 11 — Docker rebuild** — обязателен (backend: `goals.service` ownerPerson + `strategic-alignment.worker` пишет `cachedBlocksCount`; frontend: пикер ответственного + светофор уверенности + вердикт движения + русификация): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - Swagger `/api/docs` → `GoalListItemDto` содержит `ownerPersonId`/`ownerPersonName`/`blocksCount`.
  - `POST /api/v1/goals { …, ownerPersonId:"<Person.id>" }` → 201 с `ownerPersonName`; `ownerPersonId` чужого tenant → 404 `owner_person_not_found`.
  - после ночного прогона `strategic-alignment` у целей заполняется `Goal.cachedBlocksCount` (светофор в списке без JOIN).
- Новых очередей/cron нет (используется существующий `strategic-alignment.worker`, +1 поле `cachedBlocksCount` в его `tx.goal.update`).

---

### 📊 2026-06-05 — Пакет улучшений дашбордов (ТЗ B/D/C/G/E: компас целей · план-факт по людям · операции · люди под риском · кабинет «Я»)

> Контракты: `plans/tz/2026-06-05-goal-vector-compass.md` (B), `…-weekly-per-person-plan-fact.md` (D), `…-operations-dashboards-redesign.md` (C), `…-employee-pulse-and-people-at-risk.md` (G), `…-personal-cabinet-me.md` (E). Ветка `feature/dashboards-improvements`. Изменения схемы **аддитивны** (2 новых nullable-колонки + индексы, опасных нет). C/E содержат только backend-сервисы и фронт (схему не трогают).

- **Шаг 4 — Prisma миграция** — **обязательно** (аддитивно, без data-loss). После мержа `dev` (переход на миграции) изменения едут **файлом миграции `20260605120000_dashboards_goal_primary_commitment_author`**, применяется **автоматически** на `docker compose up -d` через `prisma migrate deploy` (migrate-контейнер). Никакого `db push`. Содержимое миграции:
  - **ТЗ-B:** `Goal.isPrimary Boolean @default(false)` + `@@index([tenantId, isPrimary])` — главная цель компании (для компаса на главной директора).
  - **ТЗ-D:** `IdeaBlock.commitmentAuthorPersonId String?` + relation `CommitmentAuthor → Person?` (обратка `Person.commitmentsAuthored`) + FK `→ persons(id) ON DELETE SET NULL` + `@@index([tenantId, commitmentAuthorPersonId])` + `@@index([tenantId, signalType, commitmentAuthorPersonId, commitmentDueDate])` — автор обещания (кто пообещал), для недельного план-факта по людям.
  - Проверка применения: `docker compose run --rm --no-deps backend sh -c 'bunx prisma migrate status'` → миграция в списке applied.
- **Шаг 5 — postgres-init.sql — partial unique** — новый: `goal_primary_unique ON "Goal"("tenantId") WHERE "isPrimary" = true` — гарантирует не более одной главной цели на Org. Применяется: `docker compose exec backend bun run apply-postgres-init` (идемпотентно, `CREATE UNIQUE INDEX IF NOT EXISTS`).
- **Шаг 1 — ENV/AdminSetting** — **новых ENV нет.**
  - **ТЗ-G:** 5 порогов «люди под риском» через `AdminSetting` (super_admin, code-fallback в коде; отдельный сид на первом этапе не обязателен — работают на дефолтах): `peopleAtRisk.overduePenaltyPerItem`=**8**, `peopleAtRisk.overduePenaltyCap`=**30**, `peopleAtRisk.redMoodShareThreshold`=**0.34**, `peopleAtRisk.redMoodPenalty`=**15**, `peopleAtRisk.riskThreshold`=**60**. Менять в админке настроек.
  - **ТЗ-D:** флаг атрибуции автора обещания `knowledge.commitmentAuthorAttributionEnabled` (**default TRUE**, code-fallback через `TypedConfigService.getDynamic`). `false` = `attributeCommitmentAuthor` в `block-ingest` не проставляет `commitmentAuthorPersonId`.
  - **ТЗ-E:** отписка от соцвклада — **Redis-preference** (`helpfulness:optout:<tenant>:<user>`), не AdminSetting и не ENV. Доп. действий нет — Redis уже есть.
- **Шаг 8 — Backfill** — **обязательно** (ТЗ-D): `scripts/backfill-commitment-author.ts` — заполняет `IdeaBlock.commitmentAuthorPersonId` для истории обещаний (резолв автора через `EntityResolutionService.resolveSubjectPersonId`). Идемпотентен, зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: backfill`, `skipBootstrap: true`). Сначала dry-run, затем применение: `docker compose exec backend bun run scripts/backfill-commitment-author.ts --dry-run` → `… backfill-commitment-author.ts`. Через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (backend: `WeeklyPerPersonService`, `PeopleAtRiskService`, `SocialContributionPreferenceService`, self-режимы Pulse, новые эндпоинты; frontend: `CompassWidget`, виджеты план-факта/людей под риском, кабинет «Я» с вкладками): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - **Новые REST** (Swagger `/api/docs`): `GET /api/v1/dashboard/operations/weekly-per-person`, `GET /api/v1/dashboard/people-at-risk`, `PATCH /api/v1/me/promises/:blockId/reschedule`, `GET|POST /api/v1/me/social-contribution/opt-out` → 200 под нужной ролью.
  - **Компас (B):** `GET /api/v1/dashboard/pulse-patterns` отдаёт `goalVector` с `primaryGoalId` / `proScore` / `contraScore` / `byDepartment`; на главной директора виджет «Компас» (SVG) вместо списка целей.
  - **whoShined (C):** `GET /api/v1/dashboard/operations/daily-digest/latest` (ежедневный) содержит непустой `whoShined` (Recognition / HelpfulnessSpotlight / закрытые обещания по `commitmentAuthorPersonId`), когда есть данные.
  - **Атрибуция автора (D):** после прохода встречи у блоков-обещаний появляется `commitmentAuthorPersonId`: `docker compose exec backend bun -e "import {createPrismaClient} from './scripts/_lib/prisma'; const p=createPrismaClient(); p.ideaBlock.count({where:{commitmentAuthorPersonId:{not:null}}}).then(n=>{console.log('commitments with author:',n);return p.\$disconnect();});"` → > 0.
  - **Главная цель (B):** попытка пометить вторую цель как главную при уже существующей — конфликт `goal_primary_unique` (на Org остаётся ровно одна `isPrimary=true`).

---

### 🆕 2026-06-05 — Переход на миграции (АВТОМАТИЧЕСКИ при обычном выкате)

> Переход с `db push` на `prisma migrate deploy`. Прод сейчас в дрейфе (частично применённый Ф0 identity-фундамент: enum `ParticipantInvitationStatus` есть, колонки `Participant.{invitationStatus,inviteToken,invitedAt,deviceCount}` — нет → 500 на `POST /meetings` и на result-эндпоинте → плеер «бесконечно грузит»). Контракт: `plans/tz/2026-06-05-prisma-migrations-switch.md`.

**Ничего вручную делать не нужно — просто обычный выкат:**
```bash
cd /home/docker/z && git pull origin dev
docker compose build backend frontend
docker compose up -d
docker compose logs -f migrate     # увидишь блок ">>> [schema] АВТО-BASELINE ..."
```

`apply-prod-deploy.ts` → `ensureBaseline()` сам, ОДНОРАЗОВО, при первом запуске на существующей (db-push'нутой) БД без `_prisma_migrations`:
1. авто-бэкап (`pg_dump`),
2. `migrate resolve --applied 0_init` — помечает init применённым (SQL НЕ выполняется; БД уже имеет все таблицы из прошлого `db push` той же `schema.prisma`),
3. `migrate deploy` → применяет **`20260605075900_reconcile_participant_invitation_status`** — она **актуализирует БД до текущей схемы** (чинит `Participant.invitationStatus` + дотягивает Ф0-колонки; идемпотентна — на свежей БД no-op),
4. `apply-postgres-init` (идемпотентно держит GIN/HNSW/tsvector).

> **Актуализация прода — через миграцию, а не diff.** Схема Z разделена: `schema.prisma` + `postgres-init.sql` (GIN/HNSW/trgm-индексы, generated-колонки `*_search_tsv`, partial-индексы — Prisma их не выражает). `migrate diff --to-schema` не видит объекты postgres-init → сгенерил бы их `DROP` (false-positives, что и поймал первый подход). Поэтому реальный дрейф (только `Participant.invitationStatus`) выправляется явной идемпотентной миграцией `0001`, а не авто-диффом.

После первого успешного прогона `_prisma_migrations` есть, 0_init+0001 applied → каждый `up -d` просто докатывает новые миграции. Проверка: `docker compose run --rm --no-deps backend sh -c 'bunx prisma migrate status'` → «up to date».

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 💬 2026-06-05 — ChatBox-интеграция (клиентские переписки в память компании)

> Контракт: `plans/tz/2026-06-05-chatbox-integration.md`. Новый домен `backend/src/modules/chatbox/` — зеркалит чаты из внешнего ChatBox (`app.agent-lia.ru`). **За feature-flag тарифа `feature.chatbox` (дефолт OFF)** — до включения тарифа поведение прода не меняется. Профильная заметка — `second-brain/01_projects/chatbox-integration.md`.

- **Шаг 4 — Prisma (schema)** — **обязательно** (аддитивно, без data-loss): миграция **`20260605120000_chatbox_integration`** — 8 таблиц `Chatbox*` (`ChatboxIntegration/Channel/Customer/ChannelClient/Member/Chat/ChatSession/Message`) + 7 enum (`ChatboxSyncMode/IntegrationStatus/ChatStatus/SenderType/ContentType/SessionAnalysisStatus/MemberLinkMode`) + значение `SourceType.chatbox` + обратная связь `Org.chatboxIntegration`. Применяется **автоматически** через `prisma migrate deploy` (migrate-контейнер) на `docker compose up -d`. Вручную: `docker compose run --rm --no-deps backend sh -c 'bunx prisma migrate status'` → должна числиться applied.
- **Шаг 1 — ENV / AdminSetting**:
  - `CHATBOX_API_BASE_URL` — **опциональна**, дефолт `https://app.agent-lia.ru` (можно не задавать). Только через `TypedConfigService`.
  - ⚠️ realtime-webhook требует корректный **`PUBLIC_HOST_URL`** (внешний адрес backend) — он уже есть; webhook регистрируется как `${PUBLIC_HOST_URL}/api/v1/webhooks/chatbox/:tenantId/:secret`. Токен шифруется существующим `CRYPTO_MASTER_KEY`.
  - **Kill-switch** `AdminSetting chatbox.enabled` (дефолт **true**; `false` → синк-кроны и webhook молча no-op). Засеивается Шагом 7.
- **Шаг 7 — Seed** — `docker compose exec backend bun run scripts/seed-admin-setting-chatbox.ts` — идемпотентно: `chatbox.session.idle_gap_hours=12` (порог сегментации сессий) + `chatbox.enabled=true`. **Уже в агрегаторе** `apply-prod-deploy.ts` STEPS (phase `seed-base`): `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (новый backend-модуль `chatbox` + фронт-страницы `/chats*`): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - очереди BullMQ: `docker compose exec backend grep -rl "chatbox.sync\|chatbox.analyze" src/modules/chatbox/queue` → найдены обе очереди.
  - cron'ы: `docker compose exec backend grep -l "@Cron" src/modules/chatbox/chatbox-sync.cron.ts src/modules/chatbox/chatbox-analyze.cron.ts` (ChatboxSyncCron hourly/daily, ChatboxAnalyzeCron `*/5`).
  - inbound webhook: `docker compose exec backend grep -n "webhooks/chatbox/:tenantId/:secret" src/modules/chatbox/chatbox-webhook.controller.ts` (всегда 200, `timingSafeEqual`).
  - Swagger-тег `chatbox` виден в `/api/docs`; `POST /api/v1/chatbox/integration/workspaces` с валидным токеном → непустой список воркспейсов; после `POST .../sync {scope:'all'}` в БД ≥1 `ChatboxChat`/`ChatboxMessage`/`ChatboxChatSession`; одна сессия → `analysisStatus='done'` + `RawEvent(sourceType='chatbox')`.
  - privacy: под super_admin текст чужой переписки (`ChatboxMessage.text`) не читается.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🆕 2026-06-05 — Колонка `dataClassAudit` в 4 проекции (миграция, АВТО при выкате)

> Контракт: `plans/tz/2026-06-05-dataclass-audit-schema-drift-fix.md`. Чинит schema drift: писатели specialist-3-1/3-6 кладут `dataClassAudit` в Regulation/Process/Policy/Idea, а колонки в схеме не было → ветка не компилировалась + snapshot-cron спамил 5 ERROR/30мин (`Unknown argument`).

- **Шаг 4 — Prisma миграция** — **обязательно, но автоматически** (аддитивно, без data-loss): новая миграция `20260605114300_add_dataclass_audit_to_projections` = 4× `ALTER TABLE {processes,regulations,policies,ideas} ADD COLUMN "dataClassAudit" JSONB`. Применяется штатным `prisma migrate deploy` в `migrate`-контейнере при обычном `docker compose up -d`. Отдельной ручной команды нет.
- **Шаг 11 — Docker rebuild** — обязателен (backend: правка `dataclass-audit-snapshot.cron.ts` — убран `skill_trait` + DMMF-гард): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (через ≥30 мин после выката): `bun run --env-file=… backend/scripts/diag.ts logs --level ERROR --from <дата>` → нет `Invalid prisma.{policy,process,regulation,idea,skillTrait}.count()`.
- **Бэкап** перед `migrate deploy` делается авто (`pg_dump` → z-backups).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🧩 2026-06-04 — Единая видимая задача из встречи (ТЗ meeting-identity, Ф5.2)

> Контракт: `plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md` §5.2. Дедуп Task↔Issue: из встречи рождается ОДНА видимая задача (tracker `Issue`), а не дубль Task+Issue. **GATE-COUPLED, дефолт OFF** — до включения флага владельцем поведение прода не меняется.

- **Шаг 4 — Prisma db push** — **не требуется** (схема не менялась; читаем существующие `Issue.linkedMeetingIds`/`externalSource`).
- **Шаг 1 — ENV/AdminSetting** — новых ENV нет. Новый AdminSetting-флаг `knowledge.meetingTasksToTrackerOnly` (**default FALSE**, code-fallback FALSE через `TypedConfigService.getDynamic`). Менять в админке настроек под super_admin. При `true`: meeting-`Task` для action-items не создаётся (gate в `meeting-report-fast.worker`), 6 потребителей + фронт читают задачи встречи из `Issue` по `linkedMeetingIds`.
- **Шаг 7 — Seed admin-settings** — идемпотентно засеивает ключ `knowledge.meetingTasksToTrackerOnly` (FALSE): `docker compose exec backend bun run scripts/seed-admin-settings.ts` (или `apply-prod-deploy.ts --mode update`). Без сидера флаг работает на code-дефолте FALSE.
- **Шаг 11 — Docker rebuild** — обязателен (backend: новый `MeetingActionItemsService` + репойнт 6 потребителей; фронт НЕ менялся — форма ответа при OFF сохранена байт-в-байт): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke**:
  - регистрация флага: `docker compose exec backend grep -c "knowledge.meetingTasksToTrackerOnly" src/modules/admin/settings/admin-setting-schema-registry.ts scripts/seed-admin-settings.ts` → по 1 в каждом.
  - LLM-промпты не тронуты (prompt-cache): diff по `meeting-report-fast.prompt.ts` / `block-ingest.prompt.ts` пуст.
  - после включения флага в админке (`true`): новая встреча → таб «Задачи» карточки и `GET /api/v1/meetings/:id/tasks` отдают Issue-задачи; meeting-`Task` (action-items) не плодится.
- ⚠ **НЕ проверено без БД (dev):** Issue-ветка (флаг ON) — дормант, верифицирована только unit-мок-тестами (маппинг Issue→форма Task + контракт public API при ON). Боевая проверка ON-режима — после включения флага владельцем на проде. При OFF поведение всех потребителей идентично прежнему (читают Task) — это гарантия безопасности дефолта.
- ℹ Это запись по Ф5.2 (дедуп задач). **Identity-фундамент + приглашения + subject-атрибуция (Ф0–Ф5)** того же ТЗ — отдельной записью ниже (schema-push, новый kill-switch, backfill, шаблон письма).

---

### 🎙️ 2026-06-05 — Meeting-identity: identity участника + приглашение сотрудников + subject-атрибуция (Ф0–Ф5)

> Контракт: `plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md` (Фазы 0–5). Связывает `Participant` с `User`/`Person`, приглашает сотрудников из списка (email/Telegram), оживляет клонов через `IdeaBlockEntity.role='subject'`. Коммиты: Ф0 `158a33d8`, Ф1 `b4ac1ebd`, Ф2 `b2fde6c9`, Ф3 `b5a07ebe`, Ф4 `d0609a90`, Ф5.1 `779b4811`.

- **Шаг 4 — Prisma db push** — **обязательно** (Ф0, аддитивно, без data-loss, без `--accept-data-loss`): `Participant` += `personId String?` / `inviteToken String? @unique` / `invitationStatus ParticipantInvitationStatus @default(none)` / `invitedAt DateTime?` + relations `user`(ParticipantUser)/`person`(ParticipantPerson) + back-relations `User.participantsAsUser[]` / `Person.participantsAsPerson[]`; новый enum `ParticipantInvitationStatus { none invited joined }`. Команда: `docker compose exec backend bun run prisma:push` (через `migrate`-контейнер автоматически).
- **Шаг 1 — ENV/AdminSetting** — новых ENV нет. **Два AdminSetting kill-switch** (оба code-fallback в `TypedConfigService`, засеиваются Шагом 7):
  - `knowledge.subjectAttributionEnabled` — **default TRUE** (Ф1: шаг `attributeSubject` в `block-ingest` пишет `role:'subject'`). `false` = откат к старому (только `mentioned`).
  - `knowledge.meetingTasksToTrackerOnly` — **default FALSE** (Ф5.2, см. запись выше) — поэтапная раскатка.
- **Шаг 7 — Seed**:
  - admin-settings (новые ключи `knowledge.subjectAttributionEnabled`=true, `knowledge.meetingTasksToTrackerOnly`=false): `docker compose exec backend bun run scripts/seed-admin-settings.ts` (или `apply-prod-deploy.ts --mode update`). Без сидера работают code-дефолты.
  - **email-шаблон `meeting-invite`** — **спец-сида не нужно.** `MEETING_INVITE_TEMPLATE` лежит в `STATIC_TEMPLATES` (`email-templates-admin.service.ts`) и **bootstrap-sync'ается автоматически** в таблицу `EmailTemplate` при первом GET `/admin/content/email-templates` (когда `count===0`); код остаётся fallback'ом. Дальше редактируется из админки писем.
- **Шаг 8 — Backfill** — `scripts/backfill-subject-attribution.ts` — идемпотентный upsert `IdeaBlockEntity{role:'subject'}` для reasoning-блоков + ре-enqueue `core.skill-profile-rebuild`. Сначала dry-run, затем применение: `docker compose exec backend bun run scripts/backfill-subject-attribution.ts --dry-run` → `… backfill-subject-attribution.ts`. Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: backfill`), идёт и через агрегатор `apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (backend: identity-связи, `deliverMeetingInvites`, `mail.sendMeetingInvite`, conversational `meeting.invite`, subject-атрибуция; frontend: блок «Пригласить сотрудников» в форме создания встречи + вход `/m/[id]?inv=<token>`): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - Swagger `/api/docs` → POST создания встречи принимает `invitees[]` в теле.
  - `eventType 'meeting.invite'` зарегистрирован: `docker compose exec backend grep -R "meeting.invite" src/modules/conversational/types` (registry + `EVENT_TYPE_CHANNEL_POLICY`).
  - `GET /api/v1/meetings/:id/tasks` при **дефолтном** флаге (`knowledge.meetingTasksToTrackerOnly=false`) — форма ответа не изменилась.
  - subject-атрибуция работает: после прохода встречи у reasoning-блоков сотрудника-спикера появляются `IdeaBlockEntity{role:'subject'}` (`docker compose exec backend bun -e "import {createPrismaClient} from './scripts/_lib/prisma'; const p=createPrismaClient(); p.ideaBlockEntity.count({where:{role:'subject'}}).then(n=>{console.log('subject links:',n);return p.\$disconnect();});"`) → > 0.

---

### 🔓 2026-06-04 — Разблокировка конвейера встреча→граф→задачи (МТЗ №1, Ф1–Ф11)

> Ветка `feature/pipeline-unblock`. Контракт: `plans/tz/2026-06-04-razblokirovka-konveyera.md`. Чинит критпуть B1–B7 + развязку видео от AI-статуса.

- **Шаг 4 — Prisma db push** — **обязательно** (4 аддитивных изменения, без data-loss, без `--accept-data-loss`):
  - `AudioTrack.voxTaskId String?` (Ф1); `TranscriptTrack @@unique([transcriptId, livekitIdentity])` (Ф1); `Insight.dataClassAudit Json?` + `Decision.dataClassAudit Json?` (Ф8); `MeetingStatus += ai_failed` (Ф11).
  - ⚠ ПЕРЕД push проверить отсутствие дублей под новый unique: `SELECT "transcriptId","livekitIdentity",count(*) FROM "TranscriptTrack" GROUP BY 1,2 HAVING count(*)>1;` (ожидается пусто).
  - Команда: `docker compose exec backend bun run prisma:push` (через migrate-контейнер автоматически).
- **Шаг 5 — postgres-init / AGE** — **обязательно** (Ф5): закрепить `ag_catalog` в search_path роли приложения для рантайм-пула. Идемпотентный прогон: `docker compose exec backend bun run apply-postgres-init` (содержит `ALTER ROLE CURRENT_USER SET search_path = ag_catalog, "$user", public;`).
  - Проверка: `SELECT extname FROM pg_extension WHERE extname='age';` · `SELECT name FROM ag_catalog.ag_graph WHERE name='z_graph';` · smoke под ролью app: `SELECT * FROM cypher('z_graph', $$ RETURN 1 $$) AS (v agtype);`. На managed PG нужен `shared_preload_libraries='age'` + рестарт.
- **Шаг 1 — ENV** — все **опциональные** (есть код-дефолты):
  - `VOX_POLL_INTERVAL_MS=5000`, `VOX_POLL_MAX_ATTEMPTS=180` (Ф1 — бюджет опроса Vox 900с, критично для длинных встреч).
  - `GRAPH_AGE_ENABLED=true` (Ф5 — kill-switch графа; false = только Postgres).
  - ⚠ ПОНИЖЕНЫ ДЕФОЛТЫ (Ф6): `LINKER_MIN_BLOCKS` 50→3, `THEME_CLUSTERING_MIN_BLOCKS` 100→10, `ENTITY_GRAPH_MIN_COMENTIONS` 3→2, `LINK_MIN_CONFIDENCE` 0.75→0.5. Если эти ENV выставлены в проде руками со старыми значениями — снять/понизить, иначе граф на малом тенанте не строится. Предпочтительно крутить через AdminSetting (`knowledge.*`).
- **Шаг 7 — Seed admin-settings** — идемпотентно: `graph.ageEnabled`=true (Ф5), пороги `knowledge.*` (Ф6). `docker compose exec backend bun run scripts/seed-admin-settings.ts` (или `apply-prod-deploy.ts --mode update`). Защищает admin-edited значения.
- **Шаг 8 — Backfill** — **обязательно** (Ф9): Person для владельцев Org без Person. `docker compose exec backend bun run scripts/backfill-owner-person.ts --apply` (зарегистрирован в `apply-prod-deploy.ts` STEPS, phase `backfill`, `skipBootstrap`; без `--apply` — dry-run). Идемпотентно.
- **Шаг 11 — Docker rebuild** — обязателен (backend + frontend): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - один Worker на очереди specialist-routing (Ф2): `docker compose exec backend grep -rzoP "new Worker\(\s*CORE_QUEUE_NAMES\.SPECIALIST_ROUTING" src | grep -c Worker` → 1 (**multiline** grep — имя очереди на соседней строке).
  - новый cron (Ф7): `docker compose logs backend | grep -iE "meeting-reingest|MeetingReingestCron"`.
  - новые метрики на `/metrics`: `core_specialist_skipped_total` (Ф3), `kc_typed_entity_failed_total` (Ф5), `meeting_ingest_failed_total` (Ф7).
  - **боевой тест на проде** через `diag` (после выката): прогнать новую встречу → `bun run --env-file=.env scripts/diag.ts trace --meeting <id>` — дошла ли до `ai_ready`, есть ли отчёт, наполнился ли граф (раньше падала на Vox-таймауте → `failed`).
- ⚠ **НЕ проверено в dev** (Docker Desktop не стартовал в сессии разработки): интеграц-тесты против реального Postgres (Ф4/Ф8 «tsc-слепой» класс, Ф9 backfill), боевой харнесс `smoke-pipeline-e2e.ts`, реальный AGE-резолв `cypher()`, рантайм-DI диспетчера 14 хендлеров. Всё покрыто typecheck/lint/build/unit; первый прод-прогон = боевая проверка. Прогнать `bun run test:integration` на CI/проде с поднятым Postgres.

---

### 🔔 2026-06-03 — Action Center Часть B: центр подтверждений (`/actions` + колокольчик + напоминания)

План: [plans/tz/2026-06-02-action-center-pending-confirmations.md](../../plans/tz/2026-06-02-action-center-pending-confirmations.md) (Часть B). Модуль `backend/src/modules/pending-actions/`.

**Что выкатывается:**
- B0 — новый модуль `pending-actions` (агрегатор + 4 read-провайдера) + REST `/api/v1/pending-actions/{count,,snooze,confirm}` + модель `PendingActionSnooze`.
- B1 — фронт: страница `/actions`, глобальный колокольчик `PendingActionsBell`, пункт сайдбара «Подтверждения», хуки `usePendingActionsCount`/`usePendingActions`.
- B2 — блок `requiresAction` в `DirectorDashboardDto` (`RequiresActionTile` на главной + `RequiresActionBanner` на «Панели операций»).
- B3 — `PendingActionsReminderCron` (Telegram-напоминания, eventType `actions.reminder`) + строка «Ждёт подтверждения: N» в ежедневном дайджесте.
- B4 — one-tap `POST /api/v1/pending-actions/confirm` (light curation approve). Telegram оставлен zero-button (β-1) намеренно.
- B5 — `CurationItemLifecycleCron` (expiry `CurationItem.expiresAt`).

- **Шаг 4 — Prisma** — **обязательно** (новая модель `PendingActionSnooze`; безопасно — только новая таблица, без data-loss): `docker compose exec backend bun run prisma:push`. Применяется автоматически через `migrate`-контейнер.
- **Шаг 1 — ENV** — **не требуется** (новых ENV/feature-flag нет). ⚠️ Окна напоминаний и `LEAD_DAYS` переведены в AdminSetting в фазе **C2** — см. запись «Action Center остаток (C1–C3)» ниже (Шаг 7 seed).
- **Шаг 7 — Seed** — **не требуется** (напоминания — детерминированный шаблон без LLM, новых LLM-маршрутов нет).
- **Шаг 11 — Docker rebuild** — обязателен (новый модуль `pending-actions` + 2 крона + фронт `/actions`/колокольчик/сайдбар): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - новый REST: `curl -i -H 'Cookie:<owner_session>' -H 'X-Org-Id:<orgId>' https://prod.host/api/v1/pending-actions/count` → 200 `{total, bySource}`; список `GET /api/v1/pending-actions` → urgent-first; `POST /api/v1/pending-actions/confirm` подтверждает light curation.
  - новые кроны зарегистрированы: `docker compose logs backend | grep -E 'PendingActionsReminderCron|CurationItemLifecycleCron'`.
  - новый eventType: `docker compose exec backend grep -R "actions.reminder" src/modules/conversational/types` (registry + `EVENT_TYPE_CHANNEL_POLICY`).
  - фронт: на `/actions` список висящих подтверждений; колокольчик в top-bar с живым бейджом; пункт сайдбара «Подтверждения».

---

### 👥 2026-06-04 — Команда + персональные доступы сотрудников (Фазы 0–5)

План: [plans/tz/2026-06-03-team-section-and-employee-access.md](../../plans/tz/2026-06-03-team-section-and-employee-access.md). Модули `orgs`/`persons`/`users` (backend) + `structure`/`settings` (frontend).

**Что выкатывается:**
- Раздел «Команда» (`/structure`) — объединённый ростер `GET /api/v1/orgs/:id/team-roster`, управление участниками/приглашениями (переехало из `/settings/organization`), карточка сотрудника `/structure/persons/[id]` (Профиль/Доступы).
- Новая таблица `EmployeeCapabilityOverride` (персональные override доступа `allow`/`deny` поверх дефолта роли/тарифа) + `CapabilitiesService` (модуль `orgs`).
- Эндпоинты (owner/admin): `GET/PUT/DELETE /api/v1/orgs/:id/members/:userId/capabilities[/:capability]` + `GET /api/v1/orgs/:id/effective-access`. `POST /persons` принимает `linkUserId`; приглашение — по `personId`.

- **Шаг 4 — Prisma** — **обязательно** (Фаза 5: новая таблица `EmployeeCapabilityOverride` — безопасное добавление таблицы, без потери данных, **не** migrate): `docker compose exec backend bun run prisma:push`. Применяется автоматически через `migrate`-контейнер.
- **Шаг 1 — ENV** — новых ENV нет.
- **Seed/Patch/Backfill/Migrate** — нет. Агрегатор `apply-prod-deploy.ts` STEPS — без изменений (новых скриптов нет).
- **Шаг 11 — Docker rebuild** — обязателен (backend: `CapabilitiesService` + team-roster + `POST /persons` linkUserId; frontend: раздел «Команда», карточка сотрудника, диалоги `src/ui/components/team/`): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - ростер: `curl -i -H 'Cookie:<owner_session>' -H 'X-Org-Id:<orgId>' https://prod.host/api/v1/orgs/<orgId>/team-roster` → 200, список Person ⊕ участники без карточки.
  - capabilities: `GET .../orgs/<orgId>/members/<userId>/capabilities` → 200; `PUT .../capabilities/feature:graph` body `{ "effect": "deny" }` → 200; `GET .../orgs/<orgId>/effective-access` → 200 (эффективный доступ с учётом override); `DELETE .../capabilities/feature:graph` → 200 (вернулся дефолт роли/тарифа).
  - UI: в Sidebar пункт «Команда» (группа «Каждый день»), вкладка «Сотрудники» открывается первой; `/structure/persons/[id]` → вкладка «Доступы» переключает override; `/settings/organization` показывает только «Информацию».

---

### 🎥 2026-06-03 — Надёжность записи v2: per-track дорожки (reconcile) + фильтр участников по kind + faststart видео

План: [plans/tz/2026-06-03-meeting-recording-reliability.md](../../plans/tz/2026-06-03-meeting-recording-reliability.md). Поверх PR #17. **Схема БД НЕ меняется, скриптов нет.**

**Что выкатывается:**
- Фаза 1 (P0) — надёжные per-track аудиодорожки: догон на старте записи + cron `recording-track-reconcile` (`*/1`) + in-process lock идемпотентности + метрика `recording_track_egress_failed_total`.
- Фаза 2 (P1) — `participant_joined` фильтрует по `ParticipantKind` (создаёт только `STANDARD`; egress/agent/sip — no-op), fallback на префикс `host:`/`guest:` если kind отсутствует.
- Фаза 3 (P1) — `FaststartWorker` (очередь `recording.faststart`): `ffmpeg -movflags +faststart` для composite, **за флагом, дефолт OFF**.

- **Шаг 4 — Prisma** — **не требуется** (схема не менялась).
- **Шаг 1 — ENV** — **3 новых опциональных** (есть код-дефолты, можно не выставлять):
  - `RECORDING_TRACK_RECONCILE_ENABLED` — kill-switch сверки дорожек. **Дефолт `true`** (P0-фикс активен сразу). `false` — только если сверка создаёт проблемы.
  - `RECORDING_FASTSTART_ENABLED` — **дефолт `true`** (faststart включён сразу; операция идемпотентна и безопасна — `-c copy`, перезалив после `exit 0`). Kill-switch: `false`.
  - `RECORDING_FASTSTART_MIN_BYTES` — **дефолт `52428800` (50 МиБ)**. Composite меньше порога не ремуксится (мелкий файл и так играет сразу). Поднять/опустить по вкусу.
- **Шаг 11 — Docker rebuild** — **обязателен с пересборкой образа** (правки backend + **новый бинарь `ffmpeg` в Dockerfile**): `docker compose up -d --build backend`. ⚠ Образ должен пересобраться (не только рестарт) — иначе `recording.faststart` и `clip.render` упадут с `ENOENT ffmpeg`. Проверка: `docker compose exec backend ffmpeg -version` → версия печатается.
- **Шаг 12 — Smoke**:
  - cron сверки зарегистрирован: `docker compose logs backend | grep -E 'RecordingTrackReconcileCron|recording-track-reconcile'`.
  - очередь faststart инициализирована: `docker compose logs backend | grep -E 'FaststartWorker запущен|recording.faststart'`.
  - **дорожки (главное):** провести тест-встречу 3 говоривших + умышленный reconnect одного → в результате встречи 3 полные аудиодорожки (не 2), транскрипт со всеми тремя.
  - участники: в отчёте «Участники» только реальные люди (без egress-фантомов), даже под записью.
  - **faststart (работает сразу, проверка эффекта):** после записи встречи (>50 МБ composite) в логах `docker compose logs backend | grep 'faststart: composite переупакован'` → есть запись; видео на странице результата стартует за пару секунд, без «вечной крутилки». Опц. убедиться `ffprobe -v trace https://<presigned> 2>&1 | grep -E 'moov|mdat'` → `moov` ПЕРЕД `mdat`. Если нужно выключить — `RECORDING_FASTSTART_ENABLED=false`.

---

### 🧹 2026-06-03 — Фикс egress-фантомов + Content-Type видео + списание MeetingsBalance

Багфикс по итогам тестовой конференции (без изменения схемы БД).

**Что выкатывается:**
- `webhooks/livekit-events.handler.ts` — `participant_joined` игнорирует identity не `host:`/`guest:` (egress-рекордеры больше не плодят фантомных гостей «Participant»).
- `recordings/s3.service.ts` + `recordings.service.ts` — presign композита форсит `ResponseContentType=video/mp4` + `inline` (S3 отдавал mp4 как `octet-stream`, видео не игралось в плеере).
- `meetings-balance/meetings-balance.service.ts` — `consume` переведён с битого `$executeRaw UPDATE meetings_balance` (таблица не существовала — `relation does not exist`, баланс не списывался) на типизированный `prisma.meetingsBalance.updateMany`. **Без миграции схемы.**

- **Шаг 4 — Prisma** — **не требуется** (схема не менялась).
- **Шаг 1 — ENV** — новых ENV нет.
- **Шаг 6 — Patch** — 1 новый, идемпотентный, зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: 'patch'`, `skipBootstrap: true`): `scripts/patch-cleanup-egress-phantom-participants.ts` — удаляет уже накопленных фантомных Participant'ов (identity не `host:`/`guest:`) + их `MeetingParticipantBehavior`. Прогон: сначала `--dry-run`, затем без флага, либо через агрегатор `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (правки backend): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke**:
  - провести тест-встречу хост+гость → в отчёте «Участники» ровно 2 строки, `participantsCount=2` в behavior-metrics (без «Participant»-фантомов).
  - на странице результата видео проигрывается в плеере; запрос к `composite.mp4` в Network отдаёт `Content-Type: video/mp4`.
  - создание встречи залогиненным юзером с балансом списывает 1 встречу: `docker compose exec backend bun -e "import {createPrismaClient} from './scripts/_lib/prisma'; const p=createPrismaClient(); p.meetingsBalance.findMany({take:3,orderBy:{updatedAt:'desc'}}).then(r=>{console.log(r);return p.\$disconnect();});"` — `totalConsumed` растёт, ошибки `relation \"meetings_balance\" does not exist` пропали из логов.

---

### 🪵 2026-06-03 — Логирование: процессные контуры (pipeline) + сквозной traceId + мост Nest Logger → БД

План: [plans/archive/2026-06-03-logging-pipelines-coverage.md](../../plans/archive/2026-06-03-logging-pipelines-coverage.md). Модуль `backend/src/modules/logging`.

**Что выкатывается:**
- Новый enum `SystemLogPipeline` + поле `SystemLog.pipeline?` + 2 индекса (`[pipeline, createdAt]`, `[traceId, createdAt]`).
- Мост `DbLoggerBridge` (`app.useLogger` в `main.ts`): все `this.logger.*` по бэкенду/воркерам дублируются в `SystemLog`.
- HTTP-логирование (REQUEST) **отключено** — `RequestLoggingInterceptor` снят из `LoggingModule` (ошибки запросов пишет `AllExceptionsFilter`).
- Инструментованы 48 воркеров + livekit-вебхуки (`pipeline`/`traceId`); админка — фильтр контура, вид «Цепочка» (`GET /platform/logs/chain?traceId=`), русские лейблы enum'ов.
- **Live-стрим по WebSocket** `LogStreamGateway` (Socket.IO namespace `/ws/platform-logs`, только super_admin) — заменяет поллинг в `/admin/logs` (тумблер «● Live»). Схему БД не меняет.

- **Шаг 4 — Prisma** — **обязательно** (аддитивно, без data-loss: nullable-поле `pipeline` + новый enum + 2 индекса): `docker compose exec backend bun run prisma:push`. Применяется автоматически через `migrate`-контейнер.
- **Шаг 1 — ENV** — новых ENV нет (все `LOG_DB_*` уже существуют и опциональны). После выката HTTP-логи перестанут писаться — это ожидаемо (D3).
- **Шаг 11 — Docker rebuild** — обязателен (правки `main.ts` + воркеров + фронт `/admin/logs`): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - мост работает: `docker compose exec backend bun -e "import {createPrismaClient} from './scripts/_lib/prisma'; const p=createPrismaClient(); p.systemLog.count({where:{pipeline:{not:null}}}).then(n=>{console.log('logs with pipeline:',n);return p.\$disconnect();});"` — после прохода встречи > 0.
  - вид «Цепочка»: `/admin/logs` (super_admin) → у записи встречи кликнуть `traceId` (`mtg_<id>`) → Drawer «Цепочка» показывает webhook → транскрипцию → AI → KC одной лентой.
  - REQUEST-логов больше нет: фильтр «Категория = REQUEST» за свежий период пуст.
  - WS live: на `/admin/logs` включить «● Live» → индикатор зелёный (`connected`), новые логи появляются сверху без обновления страницы. За nginx убедиться, что `/ws/platform-logs` проксируется с `Upgrade`/`Connection` заголовками (как для существующих `/ws/*`).

---

### 🪜 2026-06-03 — Action Center Часть A: Лестница доверия (пер-типовые пороги + AI-судья + autotune)

План: [plans/tz/2026-06-02-action-center-pending-confirmations.md](../../plans/tz/2026-06-02-action-center-pending-confirmations.md) (Часть A). Модуль `backend/src/modules/curation`.

**Что выкатывается:**
- A0 — триаж курации сравнивает калиброванную уверенность с пер-типовыми порогами `autoThresholdByType`/`deepReviewThresholdByType` (`Org.curationSettings`, fallback на глобальные); read-model `getOverrideStats` + `GET /api/v1/curation/override-stats` (owner/admin).
- A1 — `CardVersion.trustTier` (enum `TrustTier {auto|provisional|human}`); критические типы (`regulation`/`process`/`decision`) в провизорной полосе проходят AI-судью `curation-verify` (3 голоса) → провизорная канонизация без человека либо deep review. Аудит-выборка 5%. Новые taskType `debate-curation-verify-*`.
- A2 — `CurationAutotuneCron` (`@Cron('0 3 * * *')`): kill-switch (всегда активен) + автоподстройка порогов (opt-in `autotuneEnabled`).

- **Шаг 4 — Prisma** — **обязательно** (новый enum `TrustTier` + поле `CardVersion.trustTier @default(human)` + `@@index([tenantId, trustTier])`; безопасно — defaulted, без data-loss): `docker compose exec backend bun run prisma:push`. Применяется автоматически через `migrate`-контейнер (`prisma db push --accept-data-loss`).
- **Шаг 7 — Seed** — маршруты AI-судьи (идемпотентно, уже в агрегаторе `apply-prod-deploy.ts`, phase `seed-llm-routes`): `docker compose exec backend bun run scripts/seed-llm-task-routes-curation.ts` (cheap-цепочка `deepseek-v4-flash`→`gpt-5.4-mini`→`qwen3.5:9b`, без anthropic). Через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`. Опционально — без сидера работает code-fallback chain.
- **Шаг 11 — Docker rebuild** — обязателен (новый cron + curation-сервисы): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke**:
  - новый REST: `curl -i -H 'Cookie:<owner_session>' -H 'X-Org-Id:<orgId>' https://prod.host/api/v1/curation/override-stats` → 200 (доля override per resourceType).
  - новый cron зарегистрирован: `docker compose logs backend | grep -E 'CurationAutotuneCron'`.
  - новые LLM taskType: `docker compose exec backend bun -e "import {createPrismaClient} from './scripts/_lib/prisma'; const p=createPrismaClient(); p.llmTaskRoute.count({where:{taskType:{startsWith:'debate-curation-verify-'}}}).then(n=>{console.log('curation-verify routes:',n);return p.\$disconnect();});"`.
- **Заметка (долг):** опц. будущий backfill `CardVersion.trustTier` (existing → `auto` при `createdByUserId IS NULL`) — пока отложен, дефолт `human` безопасен.
### 🎯 2026-06-02 — Goals OKR v2 (Граф целей): специалист 3-14 + авто-прогресс + пульс + дерево

**Контекст.** Достройка модуля `goals` до «графа целей» (Цель → измеримые Key Results): авто-добыча из встреч (специалист `3-14-goals`), авто-прогресс KR (cron), еженедельный пульс (cron + доставка), дерево + мост к гипотезам. Принцип M0 — ручной контроль первичен, авто не перетирает `manualOverride`-поля. Изменения схемы **аддитивны** (только новые модели/поля/enum/FK). ТЗ — `plans/archive/2026-06-02-goals-okr-v2.md`.

- **Шаг 1 — ENV/AdminSetting** — **новых ENV нет.** Два тумблера через `AdminSetting` (не ENV, memory `feedback_admin_settings_not_env_or_code`), засеиваются сидером (Шаг 7): `goals.pulse.enabled` (default **true**) и `goals.pulse.deliver_to_telegram` (default **false**). Менять в админке настроек под super_admin.
- **Шаг 4 — Prisma** — **обязательно** (аддитивно, опасных изменений нет): `docker compose exec backend bun run prisma:push`.
  Новые модели `GoalKeyResult` / `GoalKeyResultCheckpoint` / `WeeklyGoalsPulseDigest`; поля в `Goal` (source/promotionState/progressStatus/sourceBlockIds/confidence/manualOverride/validFrom/validUntil/recordedAt/supersededById + relations); FK `Idea.goalId` / `Cycle.primaryGoalId`; 4 новых enum'а (`GoalSource`/`GoalPromotionState`/`GoalProgressStatus`/`GoalKrSourceKind`). Существующие `GoalStatus`/`GoalHorizon` НЕ менялись.
  Примечание: на dev `prisma:push` потребовал `--accept-data-loss` из-за уже-смерженного Smart-tables (`Table[tenantId, systemKey]`), **НЕ из-за goals** (goals полностью additive). На проде оценить необходимость флага отдельно — если в наличии только goals-изменения, `--accept-data-loss` не нужен.
- **Шаг 5 — postgres-init.sql — GIN-индекс** — новый: `Goal_sourceBlockIds_gin ON "Goal" USING GIN ("sourceBlockIds")` (поиск целей по блокам-источникам). Применяется: `docker compose exec backend bun run apply-postgres-init` (идемпотентно, `CREATE INDEX IF NOT EXISTS`).
- **Шаг 7 — Seed** — два сидера (оба идемпотентны, **оба уже в агрегаторе** `apply-prod-deploy.ts` STEPS):
  - `scripts/seed-llm-task-routes-goals.ts` — LLM-маршруты `goal-extract` (capable: DeepSeek V4 Pro→gpt-5.4-mini→qwen3.5:9b), `goal-hierarchy-link` (cheap: DeepSeek V4 Flash→…), `goals-pulse-summarize` (как operations-daily-digest). Без `anthropic`.
  - `scripts/seed-admin-setting-goals-pulse.ts` — тумблеры `goals.pulse.enabled=true` / `goals.pulse.deliver_to_telegram=false`.
  - Одной командой: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 8 — Backfill** — `scripts/backfill-goal-v2-defaults.ts` — legacy-целям проставляет `recordedAt=createdAt` + дефолты `source='manual'`/`promotionState='active'`/`progressStatus='on_track'` (идемпотентно). В агрегаторе STEPS (`phase: backfill`). Через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (новый специалист/воркер + 2 cron'а + сервисы goals + frontend дерево/пульс/диалоги): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - **Новый consumer** `3-14-goals` на очереди `core.specialist-routing` — виден в `/admin/platform/workers`. На тестовом блоке-обещании («провести 100 встреч за квартал») создаётся `suggested`-цель горизонта quarterly с провенансом; повтор не плодит дубль (KNN-dedup).
  - **Cron'ы** `goal-kr-progress` (05:00 UTC, ежедн.) и `goals-pulse` (пн 06:00 UTC = 09:00 МСК) — видны в `/admin/crons`. Ручной прогон `goal-kr-progress` → KR с `sourceKind='meeting_count'` показывает текущее число встреч + пишет checkpoint; ручной KR (`manual`) не перетирается.
  - **eventType `goals.pulse`** присутствует в `EVENT_TYPE_CHANNEL_POLICY` (при включённом `deliver_to_telegram` пульс уходит owner/coo).
  - **Метрики**: `curl -s localhost:3000/metrics | grep -E 'goal_kr_autoprogress_total|goals_pulse_(generated|failed|delivered)_total'`.
  - **Новые REST** (Swagger `/api/docs`): `/goals/:id/key-results*`, `/goals/:id/supersede`, `PATCH /goals/:id` (parentGoalId/progressStatus/promotionState), `/ideas/:id/goal`, `PATCH /cycles/:id` (primaryGoalId). Дашборд `GET /dashboard/director` отдаёт `goalsTree`/`goalsPulse`.
  - **UI**: `/goals` — переключатель «Список / Дерево», секция «Ключевые результаты» с прогресс-барами; на дашборде CEO — виджет «Пульс целей» + дерево.

---

### 🏷️ 2026-06-04 — Action Center остаток (C1 метка доверия · C2 крутилки AdminSetting · C3 detail-страницы курации)

План: [plans/tz/2026-06-03-action-center-remaining.md](../../plans/tz/2026-06-03-action-center-remaining.md). Достройка поверх Частей A/B (выше). Ветка `feature/action-center-trust-ladder`.

**Что выкатывается:**
- C1 — `trustTier` (из `CardVersion.currentVersion`) пробрасывается в read-DTO регуляций/решений/процессов/политик + provenance документа; фронт-плашка `TrustBadge` («Не проверено человеком» для provisional). Починен pre-existing баг вкладки «Извлечённые сущности» документа (контракт `entityGroups` vs `extractedEntities`).
- C2 — 14 платформенных дефолтов курации/напоминаний переведены из code-констант в AdminSetting (`resolveSync`, code-fallback): 9 `knowledge.curation*` (provisional/aiVerifier/auditSampleRate/autotune*/threshold*/maxProvisionalOverride) + 5 `pendingActions.*` (reminderWindow/Step/urgentAgeDays/reminderLeadDays). per-Org `curationSettings` не тронут. `urgentAgeDays` применён во всех 3 провайдерах (curation/conflict/intake).
- C3 — фронт detail-страницы `/curation/[id]` (решение куратора) + `/curation/conflicts` (список) + `/curation/conflicts/[id]` (резолюция/dismiss); `actionUrl` провайдеров теперь deep-link на конкретную карточку/конфликт.

- **Шаг 1 — ENV** — **не требуется** (C2 — admin-only ключи, новых ENV нет; код-дефолты сохранены как fallback).
- **Шаг 4 — Prisma** — **не требуется отдельно** (`CardVersion.trustTier`/`PendingActionSnooge` уже в записях Частей A/B выше; этот push покрывает и C-фазы).
- **Шаг 7 — Seed AdminSetting (C2)** — 14 ключей через существующий `seed-admin-settings.ts` (идемпотентно, уже в `apply-prod-deploy.ts` STEPS, phase `seed-base`): `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update` (или точечно `bun run scripts/seed-admin-settings.ts`). Без сидера крутилки работают на code-дефолтах, но не редактируются из админки.
- **Шаг 11 — Docker rebuild** — обязателен (backend: проброс trustTier, cfg-геттеры, провайдеры; frontend: TrustBadge, detail-страницы курации): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - метка доверия: открыть провизорную карточку в `/regulations`/`/decisions` → плашка «Не проверено человеком»; человеческая — без плашки.
  - крутилки: в админке super_admin изменить `knowledge.curationProvisionalThresholdDefault` или `pendingActions.urgentAgeDays` → значение применяется без релиза (history в `AdminSettingHistory`). Проверить наличие 14 ключей: `docker compose exec backend bun -e "import {createPrismaClient} from './scripts/_lib/prisma'; const p=createPrismaClient(); p.adminSetting.count({where:{OR:[{key:{startsWith:'knowledge.curation'}},{key:{startsWith:'pendingActions.'}}]}}).then(n=>{console.log('knobs:',n);return p.\$disconnect();});"`.
  - detail-страницы: «Открыть» из колокольчика/`/actions` для curation-item ведёт на `/curation/<id>` (не 404), для конфликта — на `/curation/conflicts/<id>`; решение/резолюция убирают элемент из очереди.

---

### ✍️ 2026-06-04 — Поправить карточку: исправить/оспорить провизорную (E1 backend + E2 frontend)

План: [plans/archive/2026-06-03-knowledge-card-correct.md](../../plans/archive/2026-06-03-knowledge-card-correct.md). Достройка поверх C1 (метка доверия). Ветка `feature/action-center-trust-ladder`.

**Что выкатывается:**
- E1 — новые REST на существующих модулях: `POST /api/v1/regulations/:id/{dispute,correct}` и `POST /api/v1/decisions/:id/{dispute,correct}`. `correct` от owner/admin применяет правку сразу (новая `CardVersion` `trustTier='human'` + `currentVersionId` + контент таблицы); от рядового — предложение в очередь курации (`CurationService.submitProposal` → `CurationItem(pending, via='user_correction')`). `dispute` → `recordDecision('mark_as_misleading')`. Обучающие сигналы: correct→`correct`, dispute→`misleading`.
- E2 — фронт `CardCorrectionActions` (кнопки «Исправить»/«Это неверно» на детали `/regulations` и `/decisions`).

- **Шаг 1 — ENV** — **не требуется** (новых ENV/флагов нет).
- **Шаг 4 — Prisma** — **не требуется** (всё на существующих `CurationItem`/`CardVersion`/канонических таблицах; схема не менялась).
- **Шаг 7 — Seed** — **не требуется** (новых LLM-маршрутов нет; `mark_as_misleading`/`approve_with_edits` уже маппятся в `PreferenceDatasetService`).
- **Шаг 11 — Docker rebuild** — обязателен (backend: regulations/decisions сервисы+контроллеры, curation.submitProposal; frontend: CardCorrectionActions): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - новые REST (Swagger `/api/docs` → теги `regulations`/`decisions` показывают `:id/dispute` и `:id/correct`). От owner: `correct` на провизорной карточке → `{ok:true,applied:true}`, плашка «Не проверено человеком» снимается, в `/regulations|decisions/:id/history` новая версия `changeReason='user_correction'`.
  - от пользователя без write-права: `correct` → `{ok:true,applied:false}`, карточка не изменилась, в очереди курации появился `CurationItem(pending)` с `via='user_correction'`.
  - `dispute` → `{ok:true}` + запись `LlmPreferenceSample(label='misleading')` по карточке.
- **Заметка (долг, ждёт go):** одобрение куратором *предложения рядового сотрудника* пока НЕ переносит правку в каноническую таблицу — суб-ТЗ [plans/tz/2026-06-04-curation-canonical-writeback.md](../../plans/tz/2026-06-04-curation-canonical-writeback.md) (blast-radius на `decide()`). Обходной путь — owner/admin применяет правку сам.

---

### 📊 2026-06-02 — Smart-tables Фаза 0: 10 системных таблиц при создании Org (auto-provision)

- **Шаг 4 — Prisma** — **обязательно** (безопасное добавление — только новые поля + индексы, опасных изменений нет): `docker compose exec backend bun run prisma:push`.
  В `Table`: `isSystem Boolean @default(false)`, `systemKey String?`, `@@unique([tenantId, systemKey])`, `@@index([tenantId, isSystem])`. У существующих строк `systemKey=NULL` — composite unique допускает множество NULL, дедуп не нужен.
- **Шаг 8 — Backfill** — завести 10 системных таблиц для всех существующих Org: `docker compose exec backend bun run scripts/backfill-system-tables.ts` (идемпотентен — повторный прогон пропускает уже созданные). Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: backfill`, `skipBootstrap: true`), поэтому идёт и через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (новый `TablesAutoProvisionService` + фронт-маркер 🔒): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - зарегистрировать нового пользователя → на `/tables` 10 системных таблиц с маркером 🔒 (Клиенты и сделки, Команда, Гипотезы и эксперименты, Поставщики, Реестр рисков, Идеи, Обещания, Контент-план, Регламенты, Цели и метрики).
  - попытка hard-delete системной таблицы через API → `403 system_table_hard_delete_forbidden`.
  - архив системной таблицы и восстановление из архива работают.

---

### 🤖 2026-06-02 — Smart-tables Фаза 1: Text-to-Schema через Кору (за feature-flag, default OFF)

- **Шаг 4 — Prisma** — **не требуется** (схема не менялась).
- **Шаг 7 — Seed** — два сидера (оба идемпотентны, уже в агрегаторе `apply-prod-deploy.ts`):
  - `scripts/seed-llm-task-routes-smart-tables.ts` — primary-маршруты для taskType `table-infer-schema`/`table-architect-pass`/`table-entity-check` на **DeepSeek V4 Pro**. Опционально: без сидера работает code-fallback chain (deepseek-chat→openai→ollama).
  - `scripts/seed-admin-settings.ts` — новый ключ `feature.tables_text_to_schema = false` (фича по умолчанию выключена).
  - Одной командой: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (новый backend-сервис + frontend-компоненты Concierge): `docker compose up -d --build backend frontend`.
- **Включение фичи** (ТОЛЬКО после прохождения Eval Фазы 1.5 ≥ 0.85 accuracy): super_admin переключает `feature.tables_text_to_schema = true` в админке настроек (или PATCH admin-settings). До этого эндпоинты `/tables/infer-schema` и `/tables/from-schema` отвечают `403 feature_tables_text_to_schema_disabled` — это ожидаемо.
- **Шаг 12 — Smoke** (после включения флага): в Кора (Concierge) написать «нужна таблица клиентов с контактами и стадией сделки» → приходит карточка-превью схемы → «Подтвердить и создать» → таблица появляется в `/tables`.

---

### 🔗 2026-06-02 — Smart-tables Фаза 2: graph-driven rows (живой entitySync)

- **Шаг 4 — Prisma** — **не требуется** (entitySync и config — Json-поля, расширены без миграции).
- **Шаг 8 — Backfill** — наполнить sync-таблицы строками из живых сущностей графа для существующих Org: `docker compose exec backend bun run scripts/backfill-table-entity-sync.ts` (идемпотентен, конфликт-резолвер по primary/email). Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: backfill`, `skipBootstrap: true`, после `backfill-system-tables`). Через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`. **Порядок:** сначала `backfill-system-tables`, затем `backfill-table-entity-sync`.
- **Новая очередь BullMQ `tables.sync`** + воркер `TableSyncWorker` (in-process, поднимается в `ai/workers.module.ts` — отдельного процесса воркеров нет). Новые доменные события `entity.created/updated/archived` (EventEmitter2, in-process). Доп. инфраструктура не нужна — Redis уже есть.
- **Шаг 11 — Docker rebuild** — обязателен (backend: новые сервисы/воркер/события + правка `EntityResolutionService`; frontend: read-only колонки): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - создать новую Entity типа `customer` (через любой knowledge-core flow) → в течение ≤5с строка появляется в системной таблице «Клиенты и сделки».
  - попытка отредактировать read-only колонку «Название» через PATCH `/rows/:id` → `422 table_cell_readonly`; в UI ячейка помечена 🔗 и не открывает редактор.

---

### 📝 2026-06-02 — Smart-tables Фаза 3: Event-to-Cells из транскриптов встреч

- **Шаг 4 — Prisma** — **обязательно** (2 новые модели, безопасно): `docker compose exec backend bun run prisma:push`.
  Создаёт `TableCellProvenance` и `TableCellPendingPatch` (Decimal(3,2) confidence, индексы). Опасных изменений нет (только новые таблицы).
- **Шаг 7 — Seed** — перепрогнать (идемпотентно, уже в агрегаторе):
  - `seed-admin-settings.ts` — 3 ключа `table.agent.confirmation_threshold=0.85`, `table.agent.max_concurrent_enrich_jobs_per_org=100`, `table.agent.max_daily_tokens=1000000`.
  - `seed-llm-task-routes-smart-tables.ts` — маршруты `table-extract-rows`/`table-auto-fill` → DeepSeek V4 Flash (опционально; code-fallback chain работает и без них).
  - Через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Новая очередь BullMQ `tables.enrich`** + воркер `TableEnrichWorker` (in-process, `ai/workers.module.ts`). Новое событие `meeting.ai_ready` (EventEmitter2, in-process, эмит в AnalyzeWorker). Доп. инфраструктура не нужна.
- **Шаг 11 — Docker rebuild** — обязателен (backend: enrich-сервис/воркер/событие + правка AnalyzeWorker; frontend: provenance/undo/панель подтверждений): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - завершить встречу с транскриптом, где прозвучал факт по колонке клиента → после `ai_ready` в течение секунд пустая ячейка патчится (если conf≥0.85), у ячейки в карточке строки появляется 🔗 с ссылкой на тайминг встречи; «Отменить» откатывает.
  - правка с conf<0.85 или перезапись непустой ячейки → попадает в «🔔 Правки на подтверждении» (не применяется молча).
  - проверить, что повторная обработка той же встречи не вызывает повторный LLM-патч (кэш по meetingId).

---

### 📥 2026-06-02 — Smart-tables Фаза 4: Document-to-Table (Excel/CSV, in-process exceljs)

- **Шаг 1 — ENV** — 2 новых опциональных (есть код-дефолты): `TABLE_IMPORT_MAX_FILE_MB=25`, `TABLE_IMPORT_MAX_ROWS=5000`.
- **Шаг 4 — Prisma** — **не требуется** (схема не менялась).
- **Шаг 7 — Seed** — `seed-admin-settings.ts` добавляет ключ `table.import.dedup_threshold=0.85` (идемпотентно, уже в агрегаторе). Прогон: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Новая npm-зависимость** `exceljs@^4.4.0` (парсинг XLSX/CSV) — попадает в образ при rebuild (она в package.json + bun.lock). **Особых prod-действий нет** (не native-модуль).
- **Шаг 11 — Docker rebuild** — обязателен (backend: парсер/импорт-сервис + exceljs; frontend: диалог «Из файла»): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**: на `/tables` кнопка «Из файла» → загрузить тестовый Excel/CSV → приходит превью схемы (+ блок слияния, если есть похожая таблица) → «Создать новую» → таблица со строками появляется. Загрузка PDF → понятная ошибка «формат пока не поддерживается».
- **Примечание (долг):** парсинг in-process на `exceljs` — временное Node-решение (владелец 2026-06-02 решил пока не поднимать Python-микросервис DCS). PDF/сканы/HTML не поддержаны до появления DCS (см. `plans/archive/2026-05-31-document-ingest-universal.md`).

---

### 🔍 2026-06-02 — Smart-tables Фаза 5: NL Saved Views (семантический фильтр)

- **Шаг 4 — Prisma** — **не требуется** (моделей не добавляли; фильтры живут в `TableView.config`).
- **Шаг 7 — Seed** — `seed-llm-task-routes-smart-tables.ts` дополнен маршрутом taskType `table-semantic-filter` → DeepSeek V4 Flash. Опционально (без сида — code-fallback chain на `deepseek-chat`): чтобы primary был Flash, прогнать `docker compose exec backend bun run scripts/seed-llm-task-routes-smart-tables.ts --update-existing` (уже в `apply-prod-deploy.ts` STEPS). 
- **Redis** — новый кэш-ключ `table:semfilter:{tableId}:{sha1(normQuery)}` (TTL 7д). Redis уже есть, доп. действий нет.
- **Шаг 11 — Docker rebuild** — обязателен (backend: semantic-filter сервис/эндпоинт; frontend: SemanticFilterBar + клиентская фильтрация): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**: открыть таблицу с данными → поле «Найти срез» → «клиенты без активности месяц» (или по реальной колонке-дате) → строки фильтруются → «Сохранить как новый вид» сохраняет фильтр.

---

### 🪵 2026-06-01 — LoggingModule (технические логи в БД + админ-UI `/admin/logs`)

- **Шаг 1 — ENV** — **11 новых опциональных** `LOG_DB_*` (все с код-дефолтами, можно не выставлять):
  `LOG_DB_ENABLED=true`, `LOG_DB_MIN_LEVEL=INFO`, `LOG_DB_BATCH_SIZE=50`, `LOG_DB_FLUSH_INTERVAL_MS=5000`,
  `LOG_DB_MAX_BUFFER=5000`, `LOG_DB_RETENTION_DAYS=30`, `LOG_DB_STACK_TRACES=true`,
  `LOG_DB_REQUEST_BODY=false`, `LOG_DB_RESPONSE_BODY=false`, `LOG_DB_SUCCESS_REQUESTS=false`,
  `LOG_DB_SLOW_REQUEST_MS=2000`. Все переопределяются в рантайме через PATCH `/api/v1/platform/logs/settings` (без рестарта).
- **Шаг 4 — Prisma** — **обязательно** (новые модели/enum'ы): `docker compose exec backend bun run prisma:push`.
  Создаёт `SystemLog` (+9 индексов) и `PlatformSetting`, enum'ы `SystemLogLevel/Category/Contour`. Опасных изменений нет (только новые таблицы).
- **Seed/patch/backfill/migrate — НЕТ.** Cleanup-ретеншен — внутренний `setInterval` в backend-процессе (не cron-сервис).
- **Шаг 11 — Docker rebuild** — обязателен (новый backend-модуль + frontend-страница): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - `curl -s localhost:3000/api/docs | grep platform-logs` (Swagger-тег появился).
  - под super_admin: `GET /api/v1/platform/logs?limit=5` → `{total, items, limit, offset}`; `GET /api/v1/platform/logs/settings` → настройки.
  - проверить запись: вызвать любой 5xx/404 → запись в `SystemLog` (через UI `/admin/logs`).

---

### 🌟 2026-06-01 — Shared demo Org «Демо: ТехноСтрим» + demo_observer (зонтик main-screen-umbrella, Поток А)

**Контекст.** Демо-кабинет «ТехноСтрим» теперь живёт **одной shared Org** в БД (isReferenceDemo=true). Новые пользователи получают `Membership(demo_observer)` к эталону сразу при регистрации (нет копий, нет ожидания «Готовим…»). При первой оплате listener снимает membership — пользователь видит только свою.

**Что выкачено в коде:**
- Schema: `enum MembershipRole +demo_observer`, `Org.isReferenceDemo`, `enum PaymentMode +reference`.
- ENV: `ZDEMO_ORG_ID` (optional CUID эталона).
- Backend: `DemoObserverGuard` (APP_GUARD), `RbacService.canMutate`, `AccountsService.register/getMe` интегрированы, `SubscriptionActivatedListener` снимает membership.
- Удалён авто-сидинг копий: `demo-seed.queue/worker`, `OnboardingService.triggerDemoSeed/getDemoSeedStatus/ensureDemoSeed`, endpoints `GET /demo-seed-status` / `POST /demo-workspace/ensure`, frontend loading-страница `/onboarding/welcome/complete`.
- Frontend: OrgSwitcher показывает бейдж «Демо», `/admin/demo` — «🌟 Эталон» с force-update только для эталона, MainEmptyState компонент.

**Шаги выката (порядок ВАЖЕН):**

- **Шаг 4 — Prisma** — да, новые enum values + поле:
  - `MembershipRole +demo_observer`
  - `Org.isReferenceDemo Boolean @default(false)`
  - `PaymentMode +reference`
  - Применяется автоматически через `migrate`-контейнер (`prisma db push --accept-data-loss`).

- **Шаг 6 — Patch (первый запуск)**: создать эталон + получить его id для ENV:
  ```bash
  docker compose exec backend bun run scripts/patch-create-reference-demo-org.ts
  ```
  Скрипт напечатает `ZDEMO_ORG_ID=<cuid>` — скопируй эту строку.

- **Шаг 1 — ENV**: добавить в `.env` (рядом с прочими ENV):
  ```bash
  ZDEMO_ORG_ID=<значение из шага 6 выше>
  ```
  Перезапустить backend:
  ```bash
  docker compose up -d backend
  ```

- **Шаг 6 — Patch (второй запуск)**: мигрировать старые «копии ТехноСтрим»:
  ```bash
  docker compose exec backend bun run scripts/patch-migrate-old-demo-orgs.ts
  ```
  Можно сделать сначала `--dry-run` для проверки.

- **Шаг 12 — Smoke**:
  - `curl -H "X-Org-Id: $ZDEMO_ORG_ID" -X POST http://localhost:3000/api/v1/meetings` (от owner'а эталона как demo_observer) → 403 `demo_observer_readonly`.
  - Зарегистрировать нового тест-юзера → проверить, что `/api/v1/accounts/me` возвращает `currentOrgId === ZDEMO_ORG_ID` И в `/api/v1/orgs/me` две Org (эталон + своя).
  - В админке `/admin/demo` — эталон помечен бейджем «🌟 Эталон», у остальных Org кнопки seed/reset disabled.

**Откат.** Если что-то пошло не так:
1. Удалить ENV `ZDEMO_ORG_ID` из `.env`, перезапустить backend — авто-привязка наблюдателей отключится (новые пользователи будут видеть только свою Org).
2. Memberships к эталону можно убрать через `prisma.membership.deleteMany({ where: { orgId: '<id>', role: 'demo_observer' } })`.
3. Саму эталонную Org можно soft-delete (`deletedAt: now()`) — schema fallback в register всё равно её отфильтрует.

**Известные ограничения:**
- Старые Org с `demoWorkspaceSeededAt != null` НО уже с реальными данными (`Person.externalSource <> 'demo'` или реальные `Meeting`) — НЕ мигрируются (skip-alive). Им остаётся прежнее состояние, в дашборде может быть «гибрид» демо + своих данных. По-хорошему надо просить пользователя оплатить, тогда listener снимет membership.
- frontend `(authenticated)/onboarding/welcome/complete/page.tsx` удалён — старые сессии, оказавшиеся на этой странице в момент выката, увидят 404. Они уйдут на `/dashboard` после refresh.

---

### 🛡️ 2026-06-01 — Идемпотентность update-скриптов (самопроверка вместо сырых падений)

Все patch/backfill/migrate-скрипты UPDATE-пути теперь **сами проверяют актуальность данных** и при «нечего делать / уже применено» печатают человекочитаемую причину и выходят с кодом `0`, а не валят `apply-prod-deploy`. Это значит: **повторный прогон `--mode update` безопасен**, и выкат не падает «сырой» ошибкой на уже-мигрированном проде.

Новый общий хелпер: `backend/scripts/_lib/schema-guards.ts` (`enumHasValue` / `isColumnNullable` / `tableExists` / `columnExists`) — read-only проверки `information_schema` / `pg_enum`.

Что изменилось по группам:
- **P1 (раньше падали на типичном проде):**
  - `patch-telegram-register-in-proxy.ts` — нет admin-кредов прокси / пустой токен / прокси недоступен → лог-причина + exit 0 (недоступность прокси пишется в `Channel.config.proxyLastSyncError`, выкат не блокируется). Перезапусти скрипт после настройки.
  - `patch-encrypt-tochka-oauth.ts` — `CRYPTO_MASTER_KEY` запрашивается только когда реально есть что шифровать (раньше падал, даже если всё уже зашифровано).
  - `backfill-demo-subscriptions.ts` — per-org ошибки → warning + exit 0; `exit 1` только при системном сбое (все Org упали).
  - `patch-backfill-card-versions.ts` — курсор по `id`, устранён бесконечный цикл в `--dry-run`.
- **P2 (поднимали весь AppModule):** `backfill-commitment-due-dates.ts`, `backfill-knowledge-clone-after-router-fix.ts` — лёгкий `count` + early-return ДО подъёма Nest; `migrate-telegram-channels-to-global.ts` переведён на `createPrismaClient()` (без AppModule).
- **P3 (защита от будущих cleanup-миграций):** enum DROP VALUE (`rename-client-to-customer`, `migrate-entity-custom-to-topic`), NOT NULL tightening (`org/person-timezone-default`, `backfill-entity-id-{document,goal,person}`), удаление legacy-моделей/колонок (`migrate-mvs-to-company-profile`, `migrate-person-role-to-appointment`, `skill-trait-categories-from-strings`, `bitemporal-backfill`).

Прод-операций сам по себе этот пункт НЕ добавляет — только делает существующие шаги 3/6/8/9 устойчивее. Достаточно общего Docker rebuild (Шаг 11).

---

### 🎬 2026-06-01 — Авто-сидинг демо при регистрации + авто-cleanup при оплате + фикс 403/404 дашборда

План: [plans/archive/2026-05-31-demo-auto-seed-and-cleanup.md](../../plans/archive/2026-05-31-demo-auto-seed-and-cleanup.md).

**Что выкатывается:**
- Backend: 2 новые BullMQ-очереди `onboarding.demo-seed` / `onboarding.demo-cleanup` + воркеры + `SubscriptionActivatedListener` (слушает `billing.subscription.activated_paid`/`_bonus`). `completeWelcome` ставит seed-job и редиректит на `/onboarding/welcome/complete`. Новый `GET /api/v1/orgs/:orgId/demo-seed-status`.
- Frontend: убрана страница `/onboarding/demo-choice`; новый loading-экран `/onboarding/welcome/complete`; фикс 403 дашборда (`dashboard.api.ts` теперь шлёт `X-Org-Id`); фикс 404 мёртвых ссылок (`/me/commitments`→`/me/promises`, `/settings/templates`→`/team-templates`).
- **Fallback пустого DEMO-кабинета:** `POST /api/v1/orgs/:orgId/demo-workspace/ensure` (идемпотентно) + триггер в `SubscriptionContext` при `status==='DEMO'`. Закрывает старые DEMO-Org (зарегистрированы до выката авто-сидинга) и неудавшийся seed — при первом заходе кабинет дозаливается синтетикой автоматически.

**Прод-операции:** только Docker rebuild. **Нет** новых ENV, миграций схемы (поле `Org.demoWorkspaceSeededAt` уже существует), seed/patch-скриптов. Очереди поднимаются вместе с backend-процессом (отдельного worker-процесса в Z нет).

- **Шаг 1 — ENV** — без новых.
- **Шаг 4 — Prisma** — не требуется (схема не менялась).
- **Шаг 11 — Docker rebuild** — обязательно:
  ```bash
  docker compose up -d --build backend frontend
  ```
- **Шаг 12 — Smoke**:
  ```bash
  # 1. Очереди demo-seed / demo-cleanup инициализированы (лог при старте backend)
  docker compose logs backend | grep -E 'DemoSeedQueue инициализирован|DemoCleanupQueue инициализирован|DemoSeedWorker запущен|DemoCleanupWorker запущен'

  # 2. Новый эндпоинт статуса отвечает (для своей Org owner'ом)
  curl -i -H 'Cookie: <owner_session>' -H 'X-Org-Id: <orgId>' \
    https://meet.crossmark.ru/api/v1/orgs/<orgId>/demo-seed-status
  # ожидаем {"status":"completed"} для уже залитой Org или pending/in_progress в процессе

  # 3. Дашборд директора больше НЕ отдаёт 403 (owner с X-Org-Id)
  curl -i -H 'Cookie: <owner_session>' -H 'X-Org-Id: <orgId>' \
    'https://meet.crossmark.ru/api/v1/dashboard/director?period=week'
  # ожидаем 200 (раньше 403 tenant_required из-за отсутствия X-Org-Id)
  ```
- **E2E (ручной):** регистрация новой Org → welcome 6 шагов → редирект на `/onboarding/welcome/complete` (спиннер «Готовим демо-кабинет») → авто-уход на `/dashboard` с данными «ТехноСтрим» + `PaywallBanner`. Затем активация подписки (manual bonus в Z-Admin) → через ~30 сек кабинет пуст.

---

### 🌊 2026-05-31 — Волна 2: Z-Admin Тариф (один tier_standard) + Партнёрский кабинет

Планы:
- [plans/archive/2026-05-31-admin-plans-collapse-to-standard.md](../../plans/archive/2026-05-31-admin-plans-collapse-to-standard.md)
- [plans/archive/2026-05-31-referrals-cabinet-revamp.md](../../plans/archive/2026-05-31-referrals-cabinet-revamp.md)

**ТЗ №3 — admin-plans-collapse-to-standard:**
- Backend: `/api/v1/admin/orgs/plans` CRUD → один `GET /current` (PlanSnapshotDto). `SeatService` и `MeetingsBalanceService` стали `async`, читают 6 ключей `billing.*` из AdminSetting через `getDynamic` с code-fallback. Активные `Subscription.monthlyPriceKopecks` НЕ пересчитываются при правке прайса.
- AdminSetting: 6 новых ключей `billing.*` (severity=`high`, reason обязателен).
- Frontend: `/admin/orgs/plans` переписан — одна карточка «Стандартный тариф Z» + 6 редактируемых `AdminSettingField` + калькулятор (slider 0..1000 seats) + история через `AdminSettingHistoryDrawer`.
- Prisma: `model Plan` помечен `// LEGACY` (физическое удаление — отдельным ТЗ через 2 недели).

**ТЗ №4 — referrals-cabinet-revamp:**
- Backend Prisma: `Referral.inn / legalForm / payoutDetails` → optional (`bun run prisma:push`, безопасно).
- Backend service: `create()` — `contractAccepted` обязателен, ИНН/реквизиты опциональны; `listClients()` маскированный (`clientCode`, без `org.name/id` — юридический приоритет); новые методы `getIncomeChart` (12 точек), `getFunnel(30d|90d|all)`; `getStats` расширен (+5 полей: clicks30d/signups30d/firstPayments30d/2 конверсии). `ReferralPayoutService.closePeriod` теперь требует `payoutDetails != null && Object.keys > 0`.
- Backend контроллер: новые `POST /me` body (`contractAccepted: z.literal(true)`), `GET /me/income-chart`, `GET /me/funnel`, `POST /me/promo-event` (throttle 30/min/IP).
- `AdminReferralsController.detail()` использует новый `listClientsForAdmin()` — super_admin сохраняет видимость `org.name/id` (маскировка только для партнёра).
- 3 новые Prometheus-метрики: `referral_promo_{impression,click,dismissed}_total{role}`.
- Frontend: `ReferralsClient.tsx` переписан на 3 состояния (A/B/C), 10 новых компонентов (`MarketingHero`, `CreateLinkCard`, `WithdrawalStrip`, `ReferralLinkCard`+QR, `IncomeChart` recharts, `FunnelCard`, `ClientsTableMasked`, `PayoutDetailsCard`, `WithdrawButton`, `PayoutsTable`). Терминологические замены (реферал → партнёр, paid → оплата).
- Frontend: `ReferralPromoStrip` в `AppShell` под `PaywallBanner` — мягкий promo-баннер с whitelisted страницами, разной копи для owner/member, dismiss на 30 дней, профиль-кэш на 24 часа.
- Новая зависимость: `qrcode.react@4.2.0` (~3 KB).

**Добивка 2026-05-31 (Блок A Волны 3):**
- Backend: `Referral`-response получил computed `hasPayoutDetails: boolean` (вычисляется как `payoutDetails != null && Object.keys > 0` через экспортируемую `hasPayoutDetails(ref)` в `services/referrals.service.ts`). Без него фронт использовал прокси `inn && legalForm` — кнопка «Вывести» ложно включалась, backend отвечал 400 при попытке вывода.
- Frontend: `referralFromApi` пробрасывает поле в `ReferralDomain`; `payoutDetailsAreFilled(ref)` теперь возвращает `ref.hasPayoutDetails` (старая эвристика по inn/legalForm удалена).
- Frontend: создана страница-заглушка `frontend/app/(public)/legal/partner-offer/page.tsx` (раньше чекбокс оферты в `CreateLinkCard` вёл в 404).
- Frontend: парный токен `text-emerald-50` вместо запрещённого `text-white` на CTA `ReferralPromoStrip`.
- Second-brain: создан `01_projects/referrals.md`; в `03_processes/referral-program.md` переписан раздел 3 (шаги 1-3 — one-click без обязательного ИНН) и §5-таблица (строки 1, 3).

**Pre-flight checks (Волна 2 + добивка Волны 3):**

```bash
# Сколько Referral без принятой оферты (профили до Волны 2).
# Если > 0 — обсудить с владельцем: backfill contractAcceptedAt = createdAt или
# попросить партнёров перепринять оферту вручную через legacy endpoint
# POST /referrals/me/accept-contract.
docker compose exec backend bun -e "import {PrismaClient} from '@prisma/client';
const p = new PrismaClient();
p.referral.count({where:{contractAcceptedAt: null}})
  .then(n=>{console.log('Referral без оферты:', n); return p.\$disconnect();});"
```

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — без новых.
- **Шаг 4 — Prisma** — **обязательно**:
  ```bash
  docker compose exec backend bun run prisma:push
  docker compose exec backend bun run prisma:generate
  ```
  Делает `Referral.inn / legalForm / payoutDetails` nullable (безопасно, данных не теряем) + добавляет `// LEGACY` docstring над `model Plan` (no-op для Postgres, нужен только generate).
- **Шаг 7 — Seed billing.* AdminSetting** — обязательно:
  ```bash
  docker compose exec backend bun run scripts/seed-admin-settings-billing.ts
  ```
  Идемпотентен. Создаёт 6 ключей `billing.*` с дефолтами 60_000 ₽ / 1_000 ₽ / 0.8 / 31 / 150 / 5. Если ключ уже есть — пропускает (защита админ-правок). Уже зарегистрирован в `apply-prod-deploy.ts STEPS` (phase=`seed-base`).
- **Шаг 9 — Migrate legacy tiers** — если в проде остались Org на `tier_basic/pro/enterprise`:
  ```bash
  docker compose exec backend bun run scripts/migrate-entitlements-to-standard.ts --dry-run
  docker compose exec backend bun run scripts/migrate-entitlements-to-standard.ts
  ```
  Уже зарегистрирован в `apply-prod-deploy.ts STEPS` (phase=`patch`, `skipBootstrap: true`).
- **Шаг 11 — Docker rebuild** — обязательно (новые backend-модули + frontend-страницы):
  ```bash
  docker compose up -d --build backend frontend
  ```
  (Уже было в записи Волны 1 от ai-chat-quota / z-admin-route-group — этот выкат накатываем общим cut'ом.)
- **Шаг 12 — Smoke**:
  ```bash
  # 1. Snapshot единого тарифа
  curl -i -H 'Cookie: <super_admin_session>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/admin/orgs/plans/current
  # Ожидаемо: 200 { tier: 'tier_standard', base: { monthlyPriceRub: 60000, … }, editableSettings: [...] }

  # 2. Правка прайса AdminSetting — live-инвалидация через <1s
  curl -i -X POST -H 'Cookie: <super_admin_session>' \
       -H 'Content-Type: application/json' \
       -d '{"value":7000000,"reason":"тест: подняли базу"}' \
       https://prod.host/api/v1/admin/settings/billing.baseMonthlyKopecks
  curl -i https://prod.host/api/v1/admin/orgs/plans/current  # base.monthlyPriceRub теперь 70000

  # 3. Старые CRUD-эндпоинты 404
  curl -i -X POST -H 'Cookie: <super_admin_session>' https://prod.host/api/v1/admin/orgs/plans
  # Ожидаемо: 404 (или 405)

  # 4. Партнёр без ИНН может создать профиль
  curl -i -X POST -H 'Cookie: <session>' -H 'Content-Type: application/json' \
       -d '{"contractAccepted":true}' https://prod.host/api/v1/referrals/me
  # Ожидаемо: 201 { id, slug, inn: null, legalForm: null, payoutDetails: null, contractAcceptedAt }

  # 5. Маскированный список клиентов
  curl -i -H 'Cookie: <session>' https://prod.host/api/v1/referrals/me/clients
  # Ожидаемо: 200 [{clientCode: 'C...', attachedAt, status, monthlyEarningsKopecks, totalEarnedKopecks}, ...]
  # Без org.name / org.id

  # 6. Новые аналитические эндпоинты
  curl -i https://prod.host/api/v1/referrals/me/income-chart  # 200, массив длиной 12
  curl -i https://prod.host/api/v1/referrals/me/funnel?period=30d  # 200, {clicks, signups, firstPayments, activeNow, conversions}

  # 7. Promo-event
  curl -i -X POST -H 'Cookie: <session>' -H 'Content-Type: application/json' \
       -d '{"type":"impression","role":"owner"}' \
       https://prod.host/api/v1/referrals/me/promo-event
  # Ожидаемо: 204 (без тела)
  curl -s https://prod.host/metrics | grep -E 'referral_promo_(impression|click|dismissed)_total'
  # Ожидаемо: счётчики увеличиваются при следующих вызовах

  # 8. UI:
  # - /admin/orgs/plans — одна карточка, 6 редактируемых полей, калькулятор, история
  # - /referrals — три состояния (A/B/C), маркетинговый герой, чекбокс оферты, без обязательных полей
  # - / (любая whitelisted страница) под пользователем без Referral — видна полоска ReferralPromoStrip; нажатие на × скрывает на 30 дней

  # 9. (Блок A Волны 3 — добивка) Партнёрская оферта — placeholder-страница не 404:
  curl -s -o /dev/null -w '%{http_code}\n' https://prod.host/legal/partner-offer
  # Ожидаемо: 200

  # 10. (Блок A Волны 3 — добивка) hasPayoutDetails в /referrals/me ответе:
  curl -i -H 'Cookie: <session>' https://prod.host/api/v1/referrals/me
  # Ожидаемо: 200 { ..., "hasPayoutDetails": false, "inn": null, ... } для свежесозданного профиля
  # После PATCH /me с непустым payoutDetails — hasPayoutDetails: true.
  ```

- **Откат:**
  ```bash
  git revert <hash_tz3> <hash_tz4>
  docker compose up -d --build backend frontend
  ```
  AdminSetting записи `billing.*` остаются (не ломают старый код — он на них не смотрел). Опциональность полей `Referral` ретро-вернуть в `required` нельзя без backfill дефолтами — не рекомендую откатывать prisma:push, только код.

⚠️ **Юридический момент.** Маскировка клиентов `/referrals/me/clients` обязательна — партнёр НЕ должен видеть `org.name/org.id`. Тест-кейсы в `referrals.service.spec.ts` проверяют это. Контракт: super_admin (`/admin/referrals/:id`) ВИДИТ полные данные через `listClientsForAdmin()` (отдельный метод сервиса).

---

### 🌊 2026-05-31 — Волна 3 Блок C: Smart Tables MVP-старт (Фазы 0+1)

План: [plans/archive/2026-05-31-smart-tables.md](../../plans/archive/2026-05-31-smart-tables.md) — реализованы Фазы 0+1 из 14.

**Сделано:**
- Backend: 5 новых Prisma-моделей (`Table`, `TableProperty`, `TableRow`, `TableView`, `TableAutomation`) + 3 enum'а (`TablePropType` 24 значения, `TableViewType` 9, `TableViewVisibility` 3) + обратная relation `Org.tables`.
- Backend: модуль `backend/src/modules/tables/` с 3 контроллерами и 3 сервисами, 19 эндпоинтов CRUD (`/api/v1/tables`, `/api/v1/tables/:tableId/properties`, `/api/v1/tables/:tableId/rows`).
- Backend: RBAC ресурс `table` в `policy.csv` (9 строк: owner/admin/manager r/w/d, manager — self-scope на write/delete).
- Backend: 4 ENV `TABLE_MAX_*` (опциональные, дефолты в коде).
- Backend: 19 unit-тестов пройдены; integration-spec `tables.e2e.spec.ts` помечен `it.skip` до dev-Postgres+testcontainers.
- Postgres-init: GIN-индекс `table_row_cells_gin ON "TableRow" USING GIN (cells jsonb_path_ops)` для фильтра по JSONB.
- Frontend: страница `/tables/[id]` с Glide Data Grid (Canvas, `next/dynamic ssr:false`), Zustand store с optimistic updates + debounce 500мс. 14 интерактивных типов колонок + 3 computed + drag&drop колонок/строк через фракционный `order` + copy/paste из Excel + добавление колонок через UI popover.
- Новые зависимости фронта: `@glideapps/glide-data-grid@^6.0.3`, `@tanstack/react-virtual@^3.13.26` (зарезервирован), `zustand@^5.0.14`.

**Не реализовано (отдельные сессии)**: Views (Фаза 3), Канбан (4), Excel-импорт (5, зависит от document-ingest Фазы 1), AI внутри таблиц (8), Embed в документ (9), Yjs real-time (10), Permissions ячейки (11), Conditional + Automations (12), API+webhooks (13), Forms (14).

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — 4 новых, опциональных (дефолты в коде):
  ```bash
  # TABLE_MAX_ROWS_PER_TABLE=100000
  # TABLE_MAX_PROPS_PER_TABLE=200
  # TABLE_MAX_TABLES_PER_ORG=1000
  # TABLE_MAX_CELL_SIZE_BYTES=1048576
  ```
  Не задавать = принять дефолты. В отдельной строке `.env` если нужно повысить порог.
- **Шаг 4 — Prisma** — **обязательно** (новые модели):
  ```bash
  docker compose exec backend bun run prisma:push
  docker compose exec backend bun run prisma:generate
  ```
  Делает: создаёт 5 таблиц `Table/TableProperty/TableRow/TableView/TableAutomation` + 3 enum типа в Postgres. Безопасно — все новые таблицы, ничего не теряем.
- **Шаг 5 — postgres-init.sql — GIN-индекс**:
  ```bash
  docker compose exec backend bun run apply-postgres-init
  ```
  Создаёт `CREATE INDEX IF NOT EXISTS table_row_cells_gin ON "TableRow" USING GIN (cells jsonb_path_ops)`. Идемпотентно.
- **Шаги 6–10 (patch/seed/backfill/migrate/setup)** — НЕТ. Фаза 0 без seed.
- **Шаг 11 — Docker rebuild** — обязателен (новый backend модуль + новые frontend зависимости):
  ```bash
  docker compose up -d --build backend frontend
  ```
- **Шаг 12 — Smoke**:
  ```bash
  # 1. Список таблиц для нового тенанта — пустой массив
  curl -i -H 'Cookie: <session>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/tables
  # Ожидаемо: 200 { items: [], total: 0 }

  # 2. Создание таблицы
  curl -i -X POST -H 'Cookie: <session>' -H 'X-Org-Id: <orgId>' \
       -H 'Content-Type: application/json' \
       -d '{"name":"Тестовая таблица"}' \
       https://prod.host/api/v1/tables
  # Ожидаемо: 200 { id, tenantId, name: 'Тестовая таблица', ... }
  TABLE_ID=<id из ответа>

  # 3. Добавление колонки
  curl -i -X POST -H 'Cookie: <session>' -H 'X-Org-Id: <orgId>' \
       -H 'Content-Type: application/json' \
       -d '{"name":"Имя","type":"text"}' \
       https://prod.host/api/v1/tables/$TABLE_ID/properties
  # Ожидаемо: 200 { id, tableId: <TABLE_ID>, name: 'Имя', type: 'text', order: 1 }
  PROP_ID=<id из ответа>

  # 4. Добавление строки
  curl -i -X POST -H 'Cookie: <session>' -H 'X-Org-Id: <orgId>' \
       -H 'Content-Type: application/json' \
       -d "{\"cells\":{\"$PROP_ID\":\"Иван Иванов\"}}" \
       https://prod.host/api/v1/tables/$TABLE_ID/rows
  # Ожидаемо: 200 { id, tableId, cells: { <PROP_ID>: 'Иван Иванов' }, ... }

  # 5. Список строк
  curl -i -H 'Cookie: <session>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/tables/$TABLE_ID/rows
  # Ожидаемо: 200 { items: [{...}], total: 1 }

  # 6. Превышение лимита cell size
  curl -i -X POST -H 'Cookie: <session>' -H 'X-Org-Id: <orgId>' \
       -H 'Content-Type: application/json' \
       -d "{\"cells\":{\"$PROP_ID\":\"$(python3 -c 'print(\"x\"*1100000)')\"}}" \
       https://prod.host/api/v1/tables/$TABLE_ID/rows
  # Ожидаемо: 400 с code='cell_too_large', message содержит propertyId

  # 7. Swagger smoke
  curl -s https://prod.host/api/docs-json | jq '.paths | keys[] | select(startswith("/api/v1/tables"))' | wc -l
  # Ожидаемо: 19

  # 8. UI:
  # - /tables/<id> — открывается Grid view (Glide Data Grid), редактирование text-ячейки работает,
  #   копирование из Excel через Ctrl+V вставляет диапазон, перетаскивание заголовков колонок и
  #   ручек строк меняет порядок. Кнопка «+ Колонка» в шапке открывает popover с 14 типами.
  ```

- **Откат:**
  ```bash
  git revert <commit_range>
  docker compose up -d --build backend frontend
  ```
  Schema-добавления безопасны (новые таблицы, не теряем данные). Если откатываем — таблицы остаются в БД пустыми (на старом коде их никто не дёрнет). Можно вычистить руками: `DROP TABLE "TableAutomation", "TableView", "TableRow", "TableProperty", "Table" CASCADE; DROP TYPE "TableViewVisibility", "TableViewType", "TablePropType";`.

⚠️ **Известное ограничение Фазы 1.** Bubble cells (status / selectSingle / selectMulti) в Glide Data Grid отображаются, но не редактируются inline (overlay-edit не поддержан Glide для Bubble). В коде помечено комментарием. Доработка — Фаза 2 (custom popover-редактор поверх Bubble).

**Дополнение Волны 3 / Smart Tables Фазы 2 + 3 (2026-05-31, тот же общий cut):**

**Фаза 2 — карточка строки = мини-документ**:
- Frontend: новый `RowDetail.tsx` (Sheet-панель), Tiptap-editor для `TableRow.pageContent` (поле уже было в Prisma из Фазы 0).
- Новые зависимости фронта: `@tiptap/react@^3.24.0`, `@tiptap/starter-kit@^3.24.0`, `@tiptap/extension-link@^3.24.0`.
- Backend: никаких изменений (`UpdateRowBodySchema.pageContent` уже принимался).

**Фаза 3 — сохраняемые срезы (saved views)**:
- Backend: новый `TableViewsController` + `TableViewsService` в `backend/src/modules/tables/`. **5 новых эндпоинтов** под `/api/v1/tables/:tableId/views`.
- Никаких Prisma-изменений (модель `TableView` уже была в Фазе 0).
- Frontend: `ViewSelector`, `SaveViewDialog`. URL state `/tables/:id?view=:viewId`.

**Прод-операций НЕ нужно** (нет новых ENV, нет Prisma-push, нет seed/patch/migrate, нет новых очередей). Достаточно `docker compose up -d --build backend frontend` — Шаг 11 общий с Фазами 0+1 и остальной Волной 3.

**Дополнительные smoke-проверки (опц.):**
```bash
# Список views — пустой для новой таблицы
curl -i -H 'Cookie:<session>' -H 'X-Org-Id:<orgId>' \
     https://prod.host/api/v1/tables/$TABLE_ID/views
# Ожидаемо: 200 []

# Создать view
curl -i -X POST -H 'Cookie:<session>' -H 'X-Org-Id:<orgId>' \
     -H 'Content-Type: application/json' \
     -d '{"name":"Только важное","type":"grid","visibility":"personal","config":{"hiddenProps":["<propId>"]}}' \
     https://prod.host/api/v1/tables/$TABLE_ID/views
# Ожидаемо: 201 { id, ownerId, ... }

# UI:
# /tables/<id> — в шапке dropdown «Виды» (пустой) + «Колонки» (видимость колонок и плотность)
# Кликнул на маркер строки → справа выезжает Sheet с property'ями + Tiptap editor «Содержимое»
```

---

### 🌊 2026-05-31 — Волна 3 Блок B: document-ingest Фаза 0 smoke-test (RESEARCH, без прод-выкатки)

План: [plans/archive/2026-05-31-document-ingest-universal.md](../../plans/archive/2026-05-31-document-ingest-universal.md) §Фаза 0.

**Сделано:** smoke-test финального стека (Docling 2.96 + RapidOCR + PP-OCRv5 eslav-веса) на 5 публичных фикстурах. Все гейты §0.3 либо пройдены, либо имеют архитектурное решение в Фазе 1.

**Прод-операций НЕТ.** Это research-фаза — она ничего не выкатывает в прод. Артефакты:
- `backend/test/fixtures/documents/{README.md, download-fixtures.sh, .gitignore}` — фикстуры скачиваются локально (бинарники не в git).
- `infra/document-conversion/smoke/{Dockerfile, docker-compose.yml, run.py}` — smoke-CLI, запускается локально через docker.
- `plans/analysis/2026-05-31-document-conversion-stack.md` — дополнен разделом «Smoke-test results» с цифрами.
- `plans/archive/2026-05-31-document-ingest-universal.md` — статус «Фаза 0 закрыт 2026-05-31».

**Локально воспроизвести** (для другой машины разработчика):
```bash
cd backend/test/fixtures/documents && bash download-fixtures.sh
cd ../../../../infra/document-conversion/smoke
docker compose build
docker compose run --rm smoke
```

**Решение по Фазе 1**: ✅ Docling+RapidOCR подтверждён. Не переходим на план B (OpenDataLoader PDF). Фаза 1 (полноценный DCS sidecar) разблокирована для отдельной сессии.

⚠️ **Критическая находка для Фазы 1:** PP-OCRv5 eslav-веса (`monkt/paddleocr-onnx`) обязательны. С дефолтным китайским ch_PP-OCRv4 — OCR на русском 0%. С eslav — 100%. Зафиксировать в ТЗ Фазы 1.

---

### 🌊 2026-05-31 — Pulse Этапы A+A2+B+C (gaps + 3.2/4.6/4.7 + Волна 5 + Волна 6)

---

### 🌊 2026-05-31 — Pulse Этапы A+A2+B+C (gaps + 3.2/4.6/4.7 + Волна 5 + Волна 6)

План: [plans/tz/2026-05-30-pulse-full.md](../../plans/tz/2026-05-30-pulse-full.md) §5-10.
Коммиты: `84b0f89` + `572f31b` + `ef9cd5a` + `1491d7f` + `dda094e` + `050d094`.
Рефлексия: [`second-brain/05_история/2026-05-31-pulse-volna-5-6.md`](../../second-brain/05_история/2026-05-31-pulse-volna-5-6.md).

**Сделано** (≈22 фазы ТЗ):
- A: backend gaps — viewedUserId в ActivityFeed (разблокировка PersonPulse 9.5) + meeting_activity в Engagement-Scorer.
- A2: Conflict-Detector extension (CheckInConflictDetectorCron) + Forecaster (новая модель ForecastSnapshot + LLM cron Mon 04:00) + hr_partner роль (+ canViewEmployeeFullCard в RbacService).
- Волна 5: Sprint Daily/Weekly табы + new endpoints, Архив гипотез `/sprints/archive`, Telegram sprint section, 5 Concierge tools.
- Волна 6: 5 weekly cron-агентов Mon 05:00 (Bus Factor / Topic Recurrence / Promise Network / Goal Vector / Knowledge Velocity) + 2 event-driven worker'а (Meeting ROI после analyze, Decision Hygiene после specialist-3-3) + единый `GET /api/v1/dashboard/pulse-patterns` endpoint + 7 виджетов на главной.

**Schema-изменения** (одной prisma:push):
- +6 новых моделей: `ForecastSnapshot` (4.6), `KnowledgeRiskSnapshot` (6.1), `RecurringTopic` (6.2), `PromiseNetworkSnapshot` (6.5), `PersonGoalContribution` (6.6, unique по tenant+person+goal+week), `KnowledgeVelocitySnapshot` (6.7).
- +5 новых полей в существующих: `Meeting.roiScore/roiScoreAt` (6.3, Decimal(8,3) — не 4,3 как в ТЗ §4.1, защита от переполнения), `Decision.reversibility/reversibilityAt` (6.8).
- +1 enum value: `MembershipRole.hr_partner` (4.7).
- Все nullable/defaulted — без data-loss.

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — без новых ENV (все feature-flags inline в коде).
- **Шаг 4 — Prisma** — **обязательно** (новые модели и поля):
  ```bash
  docker compose exec backend bun run prisma:push
  docker compose exec backend bun run prisma:generate
  ```
- **Шаг 5 — postgres-init.sql** — не трогали.
- **Шаги 6–10 (patch/seed/backfill/migrate/setup)** — НЕТ. Все новые модели снапшотные (cron сам наполнит при первом запуске); enum hr_partner не требует backfill (никто пока не назначен).
- **Шаг 11 — Docker rebuild** — обязателен:
  ```bash
  docker compose up -d --build backend
  ```
- **Шаг 12 — Smoke**:
  ```bash
  # 1. Pulse-patterns endpoint:
  curl -i -H 'Cookie:<auth>' -H 'X-Org-Id:<orgId>' \
       https://prod.host/api/v1/dashboard/pulse-patterns?period=week
  # Ожидаемо: 200 { busFactor, recurringTopics, lowRoiMeetings, bottlenecks, goalVector, knowledgeVelocity, irreversibleDecisions }

  # 2. Sprint dashboard daily/weekly:
  curl -i -H 'Cookie:<auth>' -H 'X-Org-Id:<orgId>' \
       https://prod.host/api/v1/cycles/<cycleId>/dashboard/daily
  curl -i ... /api/v1/cycles/<cycleId>/dashboard/weekly

  # 3. Sprints archive:
  curl -i ... /api/v1/sprints/archive?period=quarter

  # 4. ActivityFeed viewedUserId (PersonPulse 9.5):
  curl -i ... '/api/v1/feed/probe_question?viewedUserId=<userId>&scopedToMe=false&limit=10'

  # 5. Concierge tools (через chat):
  curl -i -X POST ... /api/v1/concierge/chat \
       -d '{"message":"что с Иваном"}'  # должен вызвать get_person_pulse

  # 6. Cron-агенты зарегистрированы:
  docker compose logs backend | grep -E 'Forecaster|BusFactorAnalyzer|TopicRecurrence|PromiseNetwork|GoalVectorTracker|KnowledgeVelocity'
  # Также после Mon 05:00 UTC — увидеть «проход завершён» от каждого.

  # 7. Frontend:
  # /dashboard — 7 новых виджетов + KnowledgeVelocity KpiHero + IrreversibleDecisions banner
  # /sprints/[id] — табы Main/Daily/Weekly
  # /sprints/archive — список всех Cycle
  # /persons/[id]/pulse — секция «Вопросы AI этому человеку» теперь живая
  ```

- **Откат:** `git revert <commit_range>` + `docker compose up -d --build`. Schema-добавления nullable — данные не теряются. Cron'ы можно остановить через рестарт (они идемпотентны).

⚠️ **Юридический check** для irreversible decisions UI: алерт «3 необратимых решения без альтернатив» виден только owner/admin (через RBAC dashboard_operations). Для hr_partner новые правила — см. policy.csv новый раздел «Pulse Wave 4 §4.7 — hr_partner».

---

### 🌊 2026-05-31 — Единая per-user квота AI-чата (Concierge + клоны)

План: [plans/archive/2026-05-31-ai-chat-quota-unified-per-user.md](../../plans/archive/2026-05-31-ai-chat-quota-unified-per-user.md).

**Сделано:** новый глобальный модуль `ai-chat-quota` (`AiChatQuotaService` + `AiChatQuotaController`) — один счётчик `ai_chat_messages_per_day` на пользователя, считает Concierge + клоны вместе; лимит зависит от роли в Org (admin/member). Concierge и Clones переключены на него. UI-эндпоинт `GET /api/v1/me/ai-chat/quota` для индикатора «осталось N сообщений сегодня». Старый Redis-ключ `clone:ask:*` и ENV `CLONE_ASK_PER_USER_PER_DAY` оставлены как deprecated code-fallback (удалим в следующем выкате после rollback-окна).

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — **3 новых опциональных** (есть код-дефолты, можно не выставлять). Рекомендуется задать явно в `.env`:
  ```env
  AI_CHAT_DAILY_LIMIT_ADMIN=50
  AI_CHAT_DAILY_LIMIT_MEMBER=20
  AI_CHAT_ADMIN_ROLES=owner,admin,coo
  ```
  `CLONE_ASK_PER_USER_PER_DAY` (старый) оставляем как есть — deprecated, не удаляем в этот выкат для безопасного rollback.
- **Шаги 4–10 (Prisma / postgres-init / patch / seed / backfill / migrate / setup)** — НЕТ. Счётчик живёт в Redis (existing `QuotaService`), снапшоты в `UserQuotaCounter` уже создаются автоматически.
- **Шаг 11 — Docker rebuild** — обязателен (новый модуль и контроллер):
  ```bash
  docker compose up -d --build backend
  ```
- **Шаг 12 — Smoke**:
  ```bash
  # 1. Endpoint в Swagger:
  docker compose exec backend curl -fsS http://localhost:3000/api/docs-json \
    | jq '.paths["/api/v1/me/ai-chat/quota"]'
  # Ожидаемо: объект с methods.get (Swagger включается только в dev — в prod
  # /api/docs за basic-auth, проверять curl'ом напрямую).

  # 2. Метрика счётчика в Prometheus:
  docker compose exec backend curl -fsS http://localhost:3000/metrics \
    | grep ai_chat_messages_per_day
  # Ожидаемо: одна и та же метрика растёт от Concierge-сообщений
  # И от ask_role_clone — это и есть единый счётчик.

  # 3. UI-проверка: открыть /concierge, отправить сообщение → счётчик
  # `dailyUsed` в `GET /api/v1/me/ai-chat/quota` увеличивается на 1.
  # Открыть карточку клона, спросить клона → тот же `dailyUsed` растёт.
  ```

- **Откат:** `git revert <commit>` + `docker compose up -d --build`. `CLONE_ASK_PER_USER_PER_DAY` остался — старая ветка кода после revert'а снова заработает без потерь.

---

### 🌊 2026-05-31 — Z-Admin standalone route group (frontend only)

План: [plans/archive/2026-05-31-z-admin-standalone-route-group.md](../../plans/archive/2026-05-31-z-admin-standalone-route-group.md).

**Изменения:** только frontend — перенос /admin/* в свою route-группу
`app/(admin)/admin/*` + новый `AdminAuthGuard`. Backend/БД/ENV — без изменений.

- **Шаг 1 (ENV)** — без новых.
- **Шаг 4 (Prisma)** — не требуется.
- **Шаг 11 (Docker image rebuild)** — обязательно (frontend image меняется):
  ```bash
  docker compose up -d --build frontend
  ```
- **Шаг 12 (Smoke)**:
  ```bash
  # Под super_admin: должен открыться /admin БЕЗ пользовательского сайдбара
  docker compose exec frontend curl -i -H 'Cookie: <super_admin_session>' http://localhost:3000/admin
  # Без cookie → 200 + клиентский redirect на /admin/login (SSR не редиректит,
  # AdminAuthGuard делает это в браузере)
  docker compose exec frontend curl -i http://localhost:3000/admin
  # Под обычным юзером → 200, в браузере redirect на /dashboard
  ```
- **Откат:** `git revert <hash>` + `docker compose up -d --build frontend`.
  Бэкенд не трогали — откат бесплатный.

---

### 🌊 2026-05-30 — Pulse Волна 4 (152-ФЗ + audit + Risk-агенты)

План: [plans/tz/2026-05-30-pulse-full.md](../../plans/tz/2026-05-30-pulse-full.md) §8.
Коммит: `2039d77`. **Сделано:** Фазы 4.1, 4.2, 4.3, 4.4, 4.5. **Отложено:** 4.6 Forecaster, 4.7 hr_partner.

**Краткое содержание:**
- 2 новых модели: `ConsentLog` (152-ФЗ согласия), `KnowledgeAccessLog` (audit просмотров карточки).
- Новые поля: `Person.analyticsOptIn`/`analyticsOptInAt`/`riskFlagsJson`, `Org.region`, `MeetingParticipantBehavior.sentimentTextPerSpeakerJson`.
- 2 новых cron: `MeetingSpeakerAnalyzerWorker` (hourly), `BurnoutRiskDetectorCron` (daily). Оба под `analyticsOptIn=true` gate.
- 1 interceptor: `KnowledgeAccessLoggerInterceptor` на view-эндпоинтах PersonsController (best-effort).
- REST: `GET/POST /api/v1/me/consents`, `GET /api/v1/me/privacy/access-log`.
- 3 новые frontend-страницы: `/onboarding/consents` (Блок C), `/me/privacy/consents`, `/me/privacy/access-log`.
- PersonPulse получил секцию «Сигналы для разговора 1:1» (из Burnout-Risk-Detector).

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — без новых ENV.
- **Шаг 4 — Prisma** — **обязательно**:
  ```bash
  docker compose exec backend bun run prisma:push
  docker compose exec backend bun run prisma:generate
  ```
  Добавляет 5 полей в существующие модели + 2 новые модели (ConsentLog, KnowledgeAccessLog). Все nullable/defaulted, без data-loss.
- **Шаг 7 — Seed LLM task routes**:
  ```bash
  docker compose exec backend bun run scripts/seed-llm-task-routes-pulse-w4.ts
  ```
  Регистрирует `meeting-speaker-analyzer`. Уже в `apply-prod-deploy.ts STEPS`.
- **Шаг 11 — Docker image rebuild** — обязателен (новые модули/endpoints/cron'ы/frontend).
- **Шаг 12 — Smoke**:
  ```bash
  # 1. Consents endpoint (cookie self):
  curl -i -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/me/consents
  # Ожидаемо: 200 { items: [] } (пусто до первого согласия)

  # 2. POST consent:
  curl -i -X POST -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       -H 'Content-Type: application/json' \
       -d '{"dataType":"checkin_processing","consented":true}' \
       https://prod.host/api/v1/me/consents

  # 3. Access log self:
  curl -i -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/me/privacy/access-log
  # Ожидаемо: 200 { items: [{accessedAt, viewerUserName, sectionAccessed, ...}, ...] }

  # 4. Cron'ы зарегистрированы:
  docker compose logs backend | grep -E 'MeetingSpeakerAnalyzer|BurnoutRiskDetector'

  # 5. Frontend:
  # /onboarding/consents — Блок C onboarding с 3 чекбоксами
  # /me/privacy/consents — текущие согласия + отозвать
  # /me/privacy/access-log — таблица «кто открывал твою карточку»
  # /persons/<id>/pulse — новая секция «Сигналы 1:1» (видна при наличии flags)
  ```
- **Откат:** `git revert 2039d77` + restart. Schema-добавления нерушительные. Если включить опять — пользовательские согласия сохранятся (ConsentLog не удаляется).

⚠️ **Юридический check рекомендуется** до релиза текстов в `/onboarding/consents` (см. ТЗ §8.4): согласия покрывают 152-ФЗ для РФ; для EU понадобится отдельный flow (region='eu') в будущей волне.

---

### 🌊 2026-05-30 — Pulse Волна 3 (Карточка сотрудника + 4 AI-агента)

План: [plans/tz/2026-05-30-pulse-full.md](../../plans/tz/2026-05-30-pulse-full.md) §7.
Коммит: `1791fd5`.

**Краткое содержание:**
- 4 новых cron-агента:
  - `team-health-analyzer.cron.ts` (daily 04:30 UTC) — LLM deepseek-v4-flash, 5 Gallup-факторов per Department.
  - `engagement-scorer.cron.ts` (daily 03:00 UTC) — детерминированный composite (sentiment+regularity+commitments+meeting), пишет в Person + PersonEngagementSnapshot.
  - `reflection-quality-scorer.cron.ts` (hourly batch) — LLM 3-axis quality, пишет в DailyCheckIn.qualityScore.
  - `hr-recommender.cron.ts` (weekly Mon 06:00 UTC) — LLM deepseek-v4-pro, рекомендации руководителю 5 типов.
- 5 новых Prisma полей: `Department.healthSummaryJson`, `Person.engagementScore/engagementScoreAt/hrSuggestionsJson`, `DailyCheckIn.qualityScore`.
- 1 новая модель: `PersonEngagementSnapshot` (история тренда).
- Новый endpoint `GET /api/v1/persons/:id/pulse` + `PersonPulseService`.
- Новая frontend-страница `/persons/[id]/pulse` — карточка сотрудника с AI Resume, Mood trend, Check-ins regularity, Promises KpiHero.

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — без новых ENV.
- **Шаг 4 — Prisma** — **обязательно**:
  ```bash
  docker compose exec backend bun run prisma:push
  docker compose exec backend bun run prisma:generate
  ```
  Все 5 новых полей nullable/defaulted, новая модель PersonEngagementSnapshot создаётся пустой — без data-loss.
- **Шаг 7 — Seed LLM task routes** — добавился новый seed:
  ```bash
  docker compose exec backend bun run scripts/seed-llm-task-routes-pulse-w3.ts
  ```
  Регистрирует `team-health-analyzer`, `reflection-quality-scorer`, `hr-recommender` task types. Идемпотентен, защищает editedByAdmin. Уже в `apply-prod-deploy.ts STEPS`.
- **Шаг 11 — Docker image rebuild** — обязателен (4 новых cron'а + новый endpoint + новая страница).
- **Шаг 12 — Smoke**:
  ```bash
  # 1. PersonPulse endpoint (cookie owner/admin или self):
  curl -i -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/persons/<personId>/pulse
  # Ожидаемо: 200 PersonPulseDto / 403 forbidden если не privileged и не self /
  #            404 person_not_found

  # 2. Cron'ы должны зарегистрироваться в Nest schedule:
  docker compose logs backend | grep -E 'TeamHealthAnalyzer|EngagementScorer|HrRecommender|ReflectionQuality'
  # Ожидаемо: "Cron registered" сообщения при старте процесса.

  # 3. После первого прогона (engagement-scorer 03:00 UTC):
  docker compose exec backend bun -e "
    import { PrismaClient } from '@prisma/client';
    const p = new PrismaClient();
    const count = await p.personEngagementSnapshot.count();
    console.log('PersonEngagementSnapshot rows:', count);
    await p.\$disconnect();
  "
  # Ожидаемо: >0 после первого прогона.

  # 4. Frontend:
  # /persons/<id>/pulse — карточка с AI Resume, mood trend, regularity, promises
  ```
- **Откат:** `git revert 1791fd5` + restart. Schema-добавления нерушительные. Cron'ы дальше работать не будут, но persisted данные (Department.healthSummaryJson, Person.engagementScore, etc) останутся (можно занулить вручную если нужно полное забвение).

---

### 🌊 2026-05-30 — Pulse Волны 1+2 (Фундамент + Усиление операций)

План: [plans/tz/2026-05-30-pulse-full.md](../../plans/tz/2026-05-30-pulse-full.md) §5-6.
Коммиты: `0f0bf03` (Волна 1, 8 фаз), `801ba61` (Волна 2, 5 фаз).

**Краткое содержание:**
- 8 новых сервисов в `backend/src/modules/dashboard/`: CommitmentReliability, HangingDecisions, SentimentIndex, NarrativeCitationsParser, TeamHealth, TeamDetail, SampleStoryDataset.
- 2 новых эндпоинта: `GET /api/v1/dashboard/team-health`, `GET /api/v1/dashboard/teams/:id`.
- 2 новых эндпоинта операций: `GET /api/v1/dashboard/operations/missing-checkins`, `GET /api/v1/dashboard/operations/stale-issues`.
- TenantMiddleware (`backend/src/modules/rbac/middleware/tenant.middleware.ts`) — резолв `req.tenantId` ДО глобальных guards (SubscriptionGuard, EntitlementGuard, MustChangePasswordGuard). Фикс бага `403 tenant_required` на эндпоинтах с `@RequireEntitlement`.
- 2 новых поля в Prisma модели `Decision`: `raisedCount Int @default(1)`, `lastRaisedAt DateTime?`. specialist-3-3 теперь инкрементит счётчик при merge-verdict.
- Новые frontend-страницы: `/teams` (список с сортировкой), `/teams/[id]` (детальная карточка).
- 4 runtime-секции в Daily-Digest DTO: eventsToday, urgentItems, whoShined (stub), whoStruggled.
- 3 runtime-секции в Weekly-Digest DTO: kpiDeltas, teamDynamics, forecast.
- 4 новых компонента UI: KpiHero (с threshold-coloring), TeamHealthGrid, ActivityFeedWidget, AiNarrativeWithSources, TeamTemperatureHeatmap, SampleStoryBanner.

**Тесты:** 186/186 passed (dashboard 76 + operations 110). Frontend typecheck чисто.

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — **нет новых ENV**. Все сервисы используют существующие настройки (Redis, Prisma).
- **Шаг 4 — Prisma** — **обязательно** перед запуском backend:
  ```bash
  docker compose exec backend bun run prisma:push
  docker compose exec backend bun run prisma:generate
  ```
  Добавляет в `Decision` два поля: `raisedCount Int @default(1)` и `lastRaisedAt DateTime?`. Существующие строки получат `raisedCount=1`, `lastRaisedAt=null`. Никакого data-loss, безопасно.
- **Шаги 6-10 — Patches/Seeds/Backfill/Migrations/Setup** — **без изменений**. Backfill для `Decision.raisedCount` не нужен (default=1 покрывает существующие). Для `lastRaisedAt` — null допустим, заполнится при следующем specialist-3-3 merge.
- **Шаг 11 — Docker image rebuild** — **обязателен** (новые backend-модули и frontend-страницы).
- **Шаг 12 — Smoke**:
  ```bash
  # 1. KPI Hero endpoints доступны (требует cookie owner/admin Org):
  curl -i -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/dashboard/director?period=week
  # Ожидаемо: 200 с полями kpiSentimentIndex, kpiCommitmentReliability, kpiHangingDecisions, isEmpty
  # На empty tenant: isEmpty=true + синтетический sample-story dataset

  # 2. Новый team-health endpoint:
  curl -i -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/dashboard/team-health
  # Ожидаемо: 200 { teams: [...], totalDepartments: N }

  # 3. Новый team-detail endpoint (404 для несуществующего отдела):
  curl -i -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/dashboard/teams/<deptId>
  # Ожидаемо: 200 c TeamDetailDto / 404 department_not_found

  # 4. Operations missing-checkins (today default):
  curl -i -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/dashboard/operations/missing-checkins
  # Ожидаемо: 200 { date, totalEmployees, missing: [...] }

  # 5. Frontend страницы:
  # /dashboard — новые KpiHero (3 шт), AI narrative с цитатами [1][2], TeamHealthGrid, ActivityFeedWidget
  # /teams — список команд с сортировкой
  # /teams/<deptId> — детальная карточка команды
  # /dashboard/operations — heatmap + missing-checkins + stale-issues + probe widget
  # /dashboard/operations/daily — 4 новых секции (eventsToday/urgentItems/whoShined/whoStruggled)
  # /dashboard/operations/weekly — 3 новых секции (kpiDeltas/teamDynamics/forecast)
  ```
- **Откат:** Никакого ENV-флага нет (все фичи активны по умолчанию). Для отката — `git revert 0f0bf03 801ba61` + redeploy. Schema-добавления Decision не требуют отката — поля nullable/defaulted, не блокируют старый код.

---

### 🧬 2026-05-30 — Agents v2 Phase C2 (GEPA prompt evolution)

План: [plans/tz/2026-05-29-agents-v2-umbrella.md](../../plans/tz/2026-05-29-agents-v2-umbrella.md) §C2.

**Краткое содержание:**
- Новая Prisma модель `PromptCandidate` + enum `CandidateStatus` + back-relation в `Org`.
- В `LlmTaskRoute` добавлены 2 поля: `evolutionEnabled Boolean @default(true)`, `promptOverride String?`.
- **(ревизия 2026-06-02)** GEPA вынесен в **отдельный контейнер `z-gepa`** — HTTP-сервис на FastAPI (`backend/python/gepa/server.py` + `backend/python/Dockerfile`, base `python:3.11-slim`). Backend больше НЕ спавнит Python: `GepaRunnerService` ходит по `POST {GEPA_SERVICE_URL}/optimize`. Из `backend/Dockerfile` убраны `python3 py3-pip` и `pip install gepa` → образ backend легче. `requirements.txt`: gepa, dspy-ai, requests, tiktoken + fastapi, uvicorn.
- 3 cron'a в `prompt-evolution` модуле: `GepaOptimizeCron` (Sun 04:00), `GepaPromoteCron` (Sun 05:00), `GepaAbMonitorCron` (каждые 15 мин).
- `LlmRouterService` теперь подхватывает `PromptCandidate(status='testing')` через минутный refresh кэша; на каждый `call()` deterministic-hash A/B sampling → подменяет systemPrompt + помечает `AiUsageLog.experimentGroup='gepa_candidate'`.
- 4 admin REST-эндпоинта в `/api/v1/admin/prompt-evolution/`: `GET candidates`, `PATCH candidates/:id/reject`, `POST rollback/:promptKey`, `PATCH lock/:promptKey`.
- 7 новых метрик: `z_gepa_optimizations_total`, `z_gepa_candidates_total`, `z_gepa_promoted_total`, `z_gepa_rejected_total`, `z_gepa_ab_active_total`, `z_gepa_cost_usd_total`, `z_gepa_rollback_total`.

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — **10 новых опциональных**, все безопасные дефолты, мастер-флаг `PROMPT_EVOLUTION_ENABLED=false`. Включать ПОСЛЕ ручной валидации Python subprocess в staging:
  - `PROMPT_EVOLUTION_ENABLED=false` — мастер-флаг 3 cron'ов GEPA.
  - `GEPA_MAX_METRIC_CALLS=150` — лимит rollouts (~$15 за прогон).
  - `GEPA_REFLECTION_LM=deepseek-v4-pro` / `GEPA_TASK_LM=deepseek-v4-pro` — модели Python-runner'а.
  - `GEPA_AB_TRAFFIC_SHARE=0.1` — 10% трафика на candidate.
  - `GEPA_AB_MIN_INVOCATIONS_BEFORE_DECISION=100` — минимум B-вызовов для promote.
  - `GEPA_AB_PROMOTE_THRESHOLD=0.05` / `GEPA_AB_REJECT_THRESHOLD=0.10` — пороги composite score.
  - `GEPA_SERVICE_URL=http://gepa:8000` — base URL gepa-сервиса (контейнер `z-gepa`, DNS внутри `z-internal`). Заменил `GEPA_PYTHON_PATH` (ревизия 2026-06-02). На dev — `http://127.0.0.1:58000`.
  - `GEPA_TIMEOUT_MS=3600000` — hard-timeout HTTP-вызова /optimize (1ч).
  - **Важно:** gepa-контейнер получает `.env` целиком (`env_file: [.env]`) — нужны те же LLM-креды (litellm/deepseek), что раньше наследовал subprocess.
- **Шаг 4 — Prisma** — безопасное добавление: новая модель `PromptCandidate` + 2 nullable/defaulted поля в `LlmTaskRoute`. Применить через `docker compose exec backend bun run prisma:push`.
- **Шаг 11 — Docker image rebuild** — **обязателен новый сервис `gepa`**: `docker compose build backend gepa && docker compose up -d`. Образ backend стал легче (без Python). Если `gepa` не поднят — GEPA-cron'ы пропускают optimization (status=`skipped_no_python`) — безопасный no-op.
- **Шаг 12 — Smoke**:
  ```bash
  # 1. gepa-контейнер жив (health + version):
  docker compose exec backend wget -qO- http://gepa:8000/health    # {"status":"ok"}
  docker compose exec backend wget -qO- http://gepa:8000/version   # {"runner":"gepa-runner",...}

  # 2. Метрики GEPA появляются после первого optimize-cron (Sun 04:00 + при PROMPT_EVOLUTION_ENABLED=true):
  curl -s https://prod.host/metrics | grep -E 'z_gepa_(optimizations|candidates|promoted|rejected|ab_active|cost_usd|rollback)_total'
  # Help-комментарии видны сразу; серии — после первого прогона.

  # 3. Admin REST: список кандидатов (требует cookie Org-admin'а):
  curl -i -H 'Cookie: <auth>' https://prod.host/api/v1/admin/prompt-evolution/candidates
  # Ожидаемо: 200 { items: [], total: 0, page: 1, limit: 50 } до первого optimize-cron.
  ```
- **Откат:** установить `PROMPT_EVOLUTION_ENABLED=false` → restart backend. Cron'ы no-op, существующие `PromptCandidate(status='testing')` ничего не сломают (LlmRouter перестанет их подхватывать). Для полного rollback `promoted` промпта: `POST /api/v1/admin/prompt-evolution/rollback/:promptKey`.

---

### 📦 2026-05-30 — Commercial-reliability pack (4 фазы)

План: [plans/tz/2026-05-29-commercial-reliability-package.md](../../plans/tz/2026-05-29-commercial-reliability-package.md).
Коммиты: `7cacf5f` (Фаза 1), `e452aa0` (Фаза 2), `acc5477` (Фаза 3), `cf5adfe` (Фаза 4).

**Краткое содержание:**
- Фаза 1: `ConversationalFreeNoteBridge` — Telegram free-note теперь попадает в граф знаний (раньше терялся в DEBUG-логе).
- Фаза 2: first-touch атрибуция — `AttributionService.attributeOrg` через `updateMany WHERE pendingAttributionSlug IS NULL`; раньше last-touch.
- Фаза 3: Zoom-rename — `PATCH /api/v1/meetings/:id/participants/:pid` + inline-edit в UI результата встречи.
- Фаза 4: 11 счётчиков + 1 гистограмма + 3 алёрта + Grafana-дашборд для биллинга и рефералов.

**Шаги прод-инструкции:**
- **Шаг 1 — ENV** — без изменений.
- **Шаг 4 — Prisma** — без изменений (schema.prisma не трогалась).
- **Шаг 6/7/8/9/10 — Patches/Seeds/Backfill/Migrations/Setup** — без изменений.
- **Шаг 11 — Prometheus rules + Grafana dashboards** — **2 новых файла**, подцепятся автоматически при перезагрузке Prometheus и Grafana provisioner:
  - `infra/prometheus/alerts/billing-referrals.rules.yml` — 3 алёрта (`BillingNoPaymentsLong`, `BillingWebhookSignatureFailures`, `ReferralPayoutCronDidNotRun`). Прометей мониторит `/etc/prometheus/alerts/*.yml`, перезагрузка через `docker compose exec prometheus kill -HUP 1` или `curl -X POST http://prometheus:9090/-/reload`.
  - `infra/grafana/dashboards/billing-referrals.json` — 4 панели (биллинг сегодня, webhook здоровье, реф-воронка, latency банка). Подцепится автоматически provisioner'ом если он наблюдает за `infra/grafana/dashboards/`.
- **Шаг 12 — Smoke**:
  ```bash
  # Метрики появляются после первого вызова (Counter с labels) или сразу (Counter без labels):
  curl https://prod.host/metrics | grep -E 'billing_invoice_paid_total|billing_subscription_renewed_total|referral_click_total|referral_signup_total|referral_payout_created_total|referral_payout_amount_rub_total|referral_attribution_first_touch_locked_total|participant_renamed_total|billing_provider_request_duration_seconds'
  # Должны увидеть help-комментарии + типы. После реальной оплаты появятся серии с лейблами.

  # Endpoint Zoom-rename доступен (host-only):
  curl -i -X PATCH https://prod.host/api/v1/meetings/<id>/participants/<pid> \
       -H 'Content-Type: application/json' \
       -d '{"name":"Иван Петров"}'
  # Ожидаемо: 401 без cookie / 403 'not_authorized' если не хост / 403 'participant_rename_forbidden' если isRegisteredUser=true / 404 'participant_not_found' / 200 + {id, name}.
  ```
  В Swagger под тегом **meetings** должен появиться `PATCH /api/v1/meetings/:id/participants/:pid` (UpdateParticipantSchema).
- **Шаг 12 — Smoke (free_note)**: отправить Telegram-боту короткое сообщение «тест заметки» → проверить что появился `RawEvent(sourceType='conversational')`:
  ```bash
  docker compose exec backend bun -e '
  import { createPrismaClient } from "./scripts/_lib/prisma";
  const p = createPrismaClient();
  p.rawEvent.findMany({
    where: { sourceType: "conversational" },
    orderBy: { createdAt: "desc" },
    take: 5,
  }).then(r => { console.log(JSON.stringify(r.map(e => ({id: e.id, occurredAt: e.occurredAt})), null, 2)); process.exit(0) })
  '
  ```

**Откатить нельзя** (точечные баг-фиксы, без миграций). При проблеме — отдельный hotfix.

---

### 🛡 2026-05-29 — Audit-fixes (Б1-Б15, В1-В17, С1-С31) + Admin Subscription UI v2

Ветка `fix/audit-2026-05-29`, **66 коммитов**. Включает 30 `fix(audit)` (15 блокеров + 15 high-risk), 24 `fix(audit) С*` (medium), 4 `feat(admin-sub-ui)` (фронт-табы Подписка/Биллинг), 6 `fix(tests)` (моки после смен логики). `typecheck`/`lint`/`test:unit` — зелёные на backend и frontend.

**Краткое содержание (фактически опасное идёт в Шаги ниже):**
- Auth: единый argon2id-hash в инвайтах (Б1), глобальный `MustChangePasswordGuard` (Б2), 120 бит энтропии в tempPassword.
- Billing: webhook-replay защита (Б4 — `maxAge:5m` + `jti @unique` + JWK TTL), AES-256-GCM на OAuth-токены Точки (Б5), уникальность по `(providerName, externalEventId)` и `triggerInvoiceId` (Б7), customerCode-сверка вебхука (В3), recurring создаёт Invoice ДО charge (Б15), `Promise.race` 30с timeout LLM-router (С30), BullMQ для referral-payout (С4), `billing_emit_failed_total` метрика (С3).
- Demo: precondition + `externalSource='demo'` фильтр + tx во всех `deleteMany` resetDemoWorkspace (Б3).
- Referrals: self-referral блок + INN-mismatch (Б6), composite-unique для public-attribution (Б8), TenantGuard на `attribute-current-org` (Б14), fingerprint min(32) (С5).
- Tracker: race-fix в подзадачах через `pg_advisory_xact_lock` + lock-ordering (Б9), per-tenant cap=5 в sprint-helper cron (Б10), `deletedAt:null` в `requireItem` (Б11), reorder под FOR UPDATE (В11), WS-RBAC `subscribe.project/issue` (В12), cycle-check + cascading soft-delete документов (С19+С20), recountCounters в tx с advisory-lock (С16), `complete` идемпотентность под advisory-lock (С18), pg_trgm index на `Cycle.name` (С17).
- Clones/RBAC: privacy для history клон-conversations после revoke (Б13), re-grant через UPDATE (В15), `assertCloneRefExists` после RBAC (В14), defense-in-depth tenantId-проверка в `canAccess*Clone` (С14), POST `/clones/:type/:id/access-grants/request` (В17), Role.created hook → grants owner'ам (С25).
- Misc: маскировка PII в логах (С1, С2), retry P2002 на placeholder email (С9), Telegram-proxy ping-timeout ENV (С28).
- **Frontend admin v2:** карточка Org теперь содержит **два таба** «Тариф и лимиты» (entitlements) и «Подписка и счета» (subscription + invoices + events). Старые `/admin/orgs/[id]/billing` и `/subscription` редиректят на `?tab=*`. В таблице инвойсов — кнопки `mark-paid` (для `issued`) и `void` (для `draft|issued`). Новые диалоги: `AdjustSeatsDialog`, `ForceStatusDialog` (с чекбоксом «обхожу FSM»), `SubscriptionEventsTimeline` (последние 100). Бэк не трогали — все методы `billingApi` уже были. В левом меню — пункт «Биллинг — обзор».

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — **2 новых опциональных**, дефолты безопасные, можно не выставлять:
  - `LLM_ROUTER_DISPATCH_TIMEOUT_MS=30000` (С30) — global timeout на dispatch модели.
  - `TELEGRAM_PROXY_PING_TIMEOUT_SEC=5` (С28) — timeout для health-cron ping'а.
- **Шаг 4 — Prisma (опасные изменения)** — **новые `@unique`/composite, требуют dedupe ДО `prisma db push`**:
  - `BillingEventLog.jti String? @unique` (Б4).
  - `BillingEventLog @@unique([providerName, externalEventId])` (Б7).
  - `ReferralPayout.triggerInvoiceId @unique` (Б7).
  - `ReferralAttribution.dateBucket String? VARCHAR(10)` + `@@unique([referralId, fingerprint, dateBucket])` (Б8).
  - Порядок: **сначала Шаг 6 (patch-dedupe-*)**, потом `docker compose exec backend bun run prisma:push`.
- **Шаг 5 — Postgres init (нативный SQL)** — **1 новое**:
  - `CREATE EXTENSION IF NOT EXISTS pg_trgm` + `CREATE INDEX Cycle_name_trgm_idx ON "Cycle" USING gin (name gin_trgm_ops)` — для substring-поиска спринтов (С17). Команда: `docker compose exec backend bun run apply-postgres-init`.
- **Шаг 6 — Patches** — **7 новых, все идемпотентные**, все зарегистрированы в `apply-prod-deploy.ts` STEPS (`phase: 'patch'`, `skipBootstrap: true` — на чистой БД нечего бэкфилить):
  - `patch-rehash-pending-invitations.ts` — sha256→argon2id для `OrgInvitation.tempPasswordHash` с `acceptedAt=NULL` (Б1). После него existing инвайты заработают.
  - `patch-mark-demo-data.ts` — backfill `externalSource='demo'` для existing demo-Org (Б3). Обязательно ПЕРЕД prod-выкатом фикса reset.
  - `patch-encrypt-tochka-oauth.ts` — AES-256-GCM на plain OAuth-токены Точки (Б5). Безопасно поверх уже шифрованных (skip если уже `enc:`).
  - `patch-dedupe-billing-event-log.ts` (Б7) — **запустить до `prisma:push`**. Поддерживает `--dry-run`.
  - `patch-dedupe-referral-payout.ts` (Б7) — **запустить до `prisma:push`**. Поддерживает `--dry-run`. Приоритет `paid > pending`, void-ит pending дубли с reason.
  - `patch-backfill-referral-attribution-date-bucket.ts` (Б8) — **запустить до `prisma:push`** composite unique. Идемпотентен.
  - `patch-audit-user-email-conflicts.ts` (С31) — **dry-run only**, печатает SQL-инструкции при обнаружении дублей email или несогласованности pwd-хешей; не правит автоматически. `skipBootstrap+skipUpdate` (вне агрегатора, запускать руками).
  - **Incident-only (не в агрегаторе):** `patch-rollback-to-deepseek-flash.ts --update-existing` — откат LLM-миграции при инциденте, новый флаг `--include-feature-flagged` для clone-respond-v2/specialists-combined (С29).
- **Шаг 12 — Smoke** (curl/UI):
  - **Auth:** `POST /api/v1/orgs/:id/invitations` → инвайт-email; вход по `/login` с tempPassword из письма → 200 + `mustChangePassword:true`; `curl /api/v1/meetings` → 403 `must_change_password`; `POST /me/change-password` → новая cookie; `curl /api/v1/meetings` → 200.
  - **Demo reset:** `POST /api/v1/admin/demo/orgs/:id/reset` на Org без `demoSeededAt` → 400 `no_demo_to_reset`.
  - **Tochka webhook replay:** повторный JWT с тем же `jti` → 409 `replay_detected`.
  - **Billing double-pay:** одновременно два webhook с одним `externalEventId` → один Invoice paid, `totalPaidKopecks` не удвоился.
  - **Referral self-ref:** signup со своим slug → `attribute-current-org` отвергает с 403 `self_referral_denied`.
  - **WS RBAC:** `socket.emit('subscribe.project', {projectId: 'чужой'})` → reject `access_denied`.
  - **Sprint search (pg_trgm):** `POST /api/v1/sprints/search?q=Q3` для близкого имени цикла — возвращает hit.
  - **Admin UI subscription tab:**
    - `/admin/orgs/[id]` → видны два таба «Тариф и лимиты» и «Подписка и счета».
    - В `?tab=subscription` для `issued` Invoice — кнопка «Отметить оплаченным» (с обязательным `externalRef`); для `paid`/`bonus` — кнопки не видны.
    - `AdjustSeatsDialog` показывает pro-rata подсказку (monthly: `daysLeft/30`, yearly: `monthsLeft*0.8`).
    - `ForceStatusDialog` submit disabled пока не отмечен чекбокс «обхожу FSM» И `reason ≥ 3`.
    - `SubscriptionEventsTimeline` показывает последние 100 событий с цветными бейджами.
  - **`/admin/billing-overview`** доступен по ссылке из левого меню «Биллинг — обзор».
  - **Redirects:** `/admin/orgs/[id]/billing` → 307 на `?tab=billing`. То же для `/subscription`.

---

### 🆕 2026-05-29 — единый логин `/login` + демо-кабинеты из админки

Чистые code-изменения: **ENV нет, schema нет, seed/patch/backfill нет.** Достаточно `docker compose up -d --build` (backend + frontend).

- **Единый логин:** новый `POST /api/v1/auth/login` (try standalone→admin). Старые `/accounts/login` и `/auth/admin-login` живы (deprecated). Фронт `/login` — единая форма, `/admin/login` редиректит на `/login`.
- **Демо из админки:** `GET/POST /api/v1/admin/demo/*` (super_admin), страница `/admin/demo`. Переиспользует `OnboardingService` — ничего нового в БД.
- **Шаг 12 — smoke** (эндпоинты `@ApiExcludeController`, в Swagger их нет — проверять curl'ом):
  - `POST /api/v1/auth/login` обычным юзером → 200 + cookie; супер-админом → 200 + `isSuperAdmin:true`; неверный пароль → единый `login_invalid`.
  - вход супер-админа через `/login` → доступен `/admin`.
  - `/admin/demo` (super_admin) → список Org; «Создать демо» на тестовой Org → ~4600 записей; «Сбросить» → чисто.

---

### 🔒 ТЗ 2026-05-28 — paywall без trial (Фазы 1–5)

Ветка: `dev`. Коммиты `fcde0aa..этот-commit`. Backend SubscriptionGuard + декораторы `@RequireSubscription` на ~141 мутирующем эндпоинте, frontend Paywall UI (Banner/Modal/SubscriptionContext) + страница `/settings/subscription` для DEMO/ACTIVE/BLOCKED, скрипт backfill для существующих Org.

- **Шаг 1 — ENV** — без изменений. Paywall работает на существующих ENV биллинга (`BILLING_PROVIDER`, `BILLING_PUBLIC_API_URL`).
- **Шаг 4 — Prisma** — без изменений. Используется существующая модель `Subscription` + enum `SubscriptionStatus`.
- **Шаг 8 — Backfill** — 1 новый: `backfill-demo-subscriptions.ts`. Для каждой Org без записи `Subscription` создаёт `Subscription{status=DEMO}` + `SubscriptionEvent{CREATED}`. Идемпотентен (skip существующих). Через apply-prod-deploy агрегатор автоматически.
- **Шаг 12 — Smoke** — проверить:
  - `POST /api/v1/projects` от DEMO-юзера → 403 с телом `{error: {code: 'subscription_required', currentStatus: 'DEMO', price: 60000}}`.
  - `GET /api/v1/projects` от DEMO-юзера → 200 (read-only пропускается).
  - `POST /api/v1/billing/pay/card` от DEMO-юзера → пропущен guard'ом (path bypass), доходит до контроллера.
  - `POST /api/v1/projects` от ACTIVE-юзера → 201.
  - Frontend `/settings/subscription` для DEMO → DemoHero + slider 31..100 + расчёт через Quote API.

---

### 💳 ТЗ 2026-05-27 — billing/tochka/referrals/dadata (новый блок)

Ветка: `feature/billing-tochka-referral-dadata`. 8 коммитов (52cde75..4416801). Введены 5 новых модулей backend: `billing`, `inn-lookup`, `meetings-balance`, `referrals` + интеграция в `entitlements`/`meetings`/`quotas`. **Frontend ещё не сделан** (Фаза 9 ТЗ §14) — поэтому новые эндпоинты пока доступны только через Swagger `/api/docs`.

**Кратко по шагам прод-инструкции (полные команды — в соответствующих секциях ниже):**

- **Шаг 1 — ENV** — 36 новых переменных. Все опциональные с дефолтами; backend стартует без них. На MVP минимум: `BILLING_PROVIDER=manual` (default), оставить feature-flags `false`. Реальные значения для Tochka — после регистрации app в кабинете Точки.
- **Шаг 4 — Prisma** — auto через `migrate`-сервис. 10 новых моделей: `Subscription`, `SubscriptionEvent`, `Invoice`, `BillingEventLog`, `BillingProviderConfig`, `MeetingsBalance`, `Referral`, `ReferralAttribution`, `ClientReferralLink`, `ReferralPayout`. 7 новых enum.
- **Шаг 6 — Patch** — 1 новый: `migrate-entitlements-to-standard.ts` (legacy `tier_basic/pro/enterprise` → `tier_standard`). Идемпотентный.
- **Шаг 7 — Seed** — ничего не нужно (плановых seed'ов в фазах нет).
- **Шаг 8 — Backfill** — 1 новый: `backfill-meetings-balance.ts` (стартовый `MeetingsBalance(balance=150)` для всех existing Org).
- **Шаг 10 — Per-tenant: Tochka OAuth** — отдельная операция владельца (не код). См. ниже «Tochka подключение в production».
- **Шаг 12 — Smoke** — проверить:
  - `GET /api/v1/billing/subscription` отдаёт null для свежей Org с DEMO,
  - `GET /api/v1/billing/meetings-balance` отдаёт balance после backfill,
  - `GET /api/v1/internal/billing/provider-events` отдаёт `{ok:true}` (webhook probe),
  - `POST /api/v1/admin/orgs/:tenantId/billing/activate {paymentMode:'bonus',...}` создаёт Subscription+Invoice+SubscriptionEvent+AdminAuditLog + грантует 150 встреч.

#### Tochka подключение в production

Делается **один раз** при первом включении реального провайдера Tochka:

1. Зарегистрировать приложение в кабинете Точки → получить `client_id`/`client_secret`.
2. Прописать в `.env`:
   ```bash
   BILLING_PROVIDER=tochka
   FEATURE_BILLING_TOCHKA=true
   FEATURE_BILLING_CARD_RECURRING=true     # вкл. оплату картой через рекуррент
   FEATURE_BILLING_BANK_INVOICE=true       # вкл. безналичный счёт
   TOCHKA_MODE=production
   TOCHKA_CUSTOMER_CODE=<выдан Точкой>
   TOCHKA_ACCOUNT_ID=<счёт/БИК>
   TOCHKA_CLIENT_ID=<выдан Точкой>
   TOCHKA_CLIENT_SECRET=<секрет>
   TOCHKA_REDIRECT_URI=https://api.kora.app/api/v1/internal/billing/tochka/oauth/callback
   TOCHKA_WEBHOOK_URL=https://api.kora.app/api/v1/internal/billing/provider-events
   TOCHKA_WEBHOOK_AUTO_REGISTER=true
   BILLING_PUBLIC_API_URL=https://api.kora.app
   BILLING_LEGAL_ENTITY_NAME=<ООО/ИП>
   BILLING_LEGAL_ENTITY_INN=<наш ИНН>
   BILLING_LEGAL_ENTITY_KPP=<наш КПП>
   BILLING_LEGAL_ENTITY_ADDRESS=<юр.адрес>
   BILLING_LEGAL_ENTITY_BIK=<БИК>
   BILLING_LEGAL_ENTITY_ACCOUNT=<р/с>
   # DaData (для inn-lookup fallback)
   DADATA_API_KEY=<токен dadata>
   INN_LOOKUP_PROVIDER=tochka_then_dadata
   ```
   `docker compose up -d --force-recreate backend`
3. Открыть backend-логи: `docker compose logs -f backend | grep "TOCHKA OAuth"`
   → увидеть строку `откройте URL в браузере: https://enter.tochka.com/connect/authorize?...`
   → открыть URL в браузере, авторизоваться в кабинете Точки → callback придёт на `/internal/billing/tochka/oauth/callback`.
4. Альтернатива через admin-API (если super_admin уже залогинен):
   ```bash
   curl -s https://api.kora.app/api/v1/admin/billing/tochka/oauth/authorize-url \
     -H "Cookie: <session>" -H "X-Org-Id: <org>"
   # → {url:"https://enter.tochka.com/connect/authorize?..."}
   # Открыть url в браузере. После callback'а проверить:
   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -c "SELECT key, jsonb_pretty(value_json::jsonb) FROM billing_provider_config;"
   # Должна быть запись 'tochka.production.oauth_tokens' с accessToken и refreshToken.
   ```
5. Webhook регистрируется автоматически при старте backend через 1.5с (если `TOCHKA_WEBHOOK_AUTO_REGISTER=true`).
6. Канарейка: на тестовой Org → `POST /api/v1/billing/pay/card` с `billingPeriod=monthly, seatsExtra=0` → 1 ₽ (потребуется снижение `BASE_MONTHLY_PRICE_KOPECKS` в коде для канарейки, либо использовать stage-окружение).

#### Реферальная программа — что проверить

После выката `referrals` модуль работает автоматически:
- Лендинг должен бить `POST /api/v1/public/referrals/attribution {slug, fingerprint?, referer?}` (throttle 10/min/IP) когда юзер заходит по `?ref=<slug>`.
- Фронт после signup зовёт `POST /api/v1/referrals/attribute-current-org` с заголовками `X-Z-Ref` (из cookie) и `X-Z-Fingerprint`.
- Cron `0 10 10 * *` Europe/Moscow закрывает прошлый месяц — на проде убедиться что `@nestjs/schedule` поднимает его.
- Партнёру нужно: `POST /referrals/me` (создать профиль), `POST /referrals/me/verify-inn`, `POST /referrals/me/accept-contract` — без этого cron 10-го числа переведёт payout в `void`.

---

### 🧭 2026-06-10 — Query Understanding Волна 1 (понимание структуры запроса + recall-safe фильтр chat-v2)

> Контракт: `plans/tz/2026-06-10-query-understanding-tier0-tier1.md` (Tier 0 + Tier 1).
>
> **Зачем для прода:** разговорный AI-чат начинает понимать структуру запроса (время/тип/сущность/тема/«я») и применять её как recall-safe структурный фильтр поверх графа — вместо чистого смыслового top-K. «Что решали по маркетингу на этой неделе» больше не возвращает решение трёхмесячной давности по другому отделу. **Новых обязательных ENV нет** (kill-switch — code-default ON). **Миграции БД нет.**

- **Шаг 1 — ENV / kill-switch** — `QUERY_PLAN_EXTRACTION_ENABLED` (bool, **default true**, kill-switch ON) — извлечение структуры запроса (dialog-extract-plan) + структурный фильтр chat-v2. OFF (`=false` в `.env` + рестарт) → чат работает как раньше (чистый смысловой top-K). ENV-fallback опционален (code-default ON).
- **Шаг 7 — Seed** — `docker compose exec backend bun run scripts/seed-llm-task-routes-dialog-extract-plan.ts` — маршрут `dialog-extract-plan` на `deepseek-v4-flash` (Query Understanding Волна 1, Р9); идемпотентен; **уже в `apply-prod-deploy.ts` STEPS** (`--mode update` его покрывает): `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 12 — Smoke** (после выката):
  - Новый taskType `dialog-extract-plan` виден в `/admin/ai-models` (primary deepseek-v4-flash) и отвечает.
  - Флагманский запрос «что решали по маркетингу на этой неделе» фильтрует: `curl -s localhost:3000/metrics | grep z_query_plan_retrieval_filtered_total` — `{filtered="yes"}` растёт.
  - Пустое окно (заведомо «нет данных» период) → честный ответ «в памяти нет» (метрика `z_query_plan_empty_pool_total{result="empty"}` растёт), а не правдоподобное неверное число.
  - Метрики присутствуют: `curl -s localhost:3000/metrics | grep -E 'z_query_plan_extraction_total|z_query_plan_retrieval_filtered_total|z_query_plan_empty_pool_total'`.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

## 🚀 Полный чек-лист обновления (Сценарий A: данные сохраняем)

> Стандартный workflow обновления работающего прода. Если БД жалко потерять — это твой путь.

```bash
# ─── 1. SSH на сервер + в директорию проекта ───────────────────────
ssh root@prod
cd /home/docker/z
set -a && source .env && set +a              # подтянуть POSTGRES_USER/DB в shell

# ─── 2. БЭКАП БД ────────────────────────────────────────────────────
mkdir -p backups && \
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "backups/z_main_$(date +%F-%H%M).dump" && \
ls -lh backups/ | tail -3
# Размер должен быть > 0 байт. Сохрани файл — нужен для отката.

# ─── 3. Pull кода ──────────────────────────────────────────────────
git pull origin dev
git log -1 --oneline                          # увидь последний коммит

# ─── 4. Sanity-check lockfile ──────────────────────────────────────
grep -c npmmirror backend/bun.lock frontend/bun.lock   # должно быть 0 и 0

# ─── 5. .env — проверить новые ENV ─────────────────────────────────
# Открой .env и сверься с разделом «Шаг 1 — ENV» ниже.
# Если добавлял новые NEXT_PUBLIC_* — нужна пересборка frontend в Шаге 9.
nano .env
set -a && source .env && set +a

# ─── 6. GATE — защитный backfill ДО migrate ────────────────────────
# Только если у тебя legacy Meeting с tenantId=NULL (есть до этого выката).
# postgres уже up с прошлого деплоя — `run --rm` стартует одноразовый контейнер.
docker compose run --rm backend bun run scripts/backfill-orgs-fase0.ts
docker compose run --rm backend bun run scripts/backfill-meeting-tenant-id.ts --apply
docker compose run --rm backend bun run scripts/tighten-meeting-tenant-not-null.ts
# Последняя команда: exit 0 = можно идти дальше, exit 1 = STOP, разбирайся.

# ─── 7. Build + up (миграция автоматически через migrate-сервис) ───
docker compose build                          # 5-15 минут на холодную, 1 на инкремент
docker compose up -d --build                  # postgres + redis + migrate (one-shot) + backend + frontend

# Дождаться миграции:
docker compose logs -f migrate
# Жди: "✓ postgres-init.sql выполнен" + "=== apply-postgres-init DONE ===", Ctrl+C
docker compose ps                             # все 4 контейнера healthy

# ─── 8. Подхват новых ENV / NEXT_PUBLIC_* ──────────────────────────
# Если правил .env (Шаг 5):
docker compose up -d --force-recreate backend
# Если правил NEXT_PUBLIC_*:
docker compose up -d --build frontend

# ─── 9. ОДНА КОМАНДА: применить patch + seed + backfill + migrate ──
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update --continue-on-fail
# В конце: "=== SUMMARY === Всего: NN, OK: M, FAIL: K"
# Если есть FAIL — посмотри список упавших, разбирайся индивидуально.

# ─── 10. Per-tenant setup (опц., только если меняются токены/URL) ──
# Telegram (глобальный, БЕЗ --tenant-id):
docker compose exec backend bun run setup:telegram-bot \
  -- --token=$TG_TOKEN --public-host-url=https://api.prod.host --webhook-secret=<секрет>

# ─── 11. Включение CLONE_V2_ENABLED (только если бизнес-готово) ────
# Убедись что в /admin/clones корректно отображаются гранты после
# patch-migrate-clone-access (он внутри агрегатора). Только тогда:
# В .env: CLONE_V2_ENABLED=true
# Подхват:
# docker compose up -d --force-recreate backend

# ─── 12. nginx (только если меняешь BACKEND_HOST_PORT/FRONTEND_HOST_PORT) ─
# sudo nginx -t && sudo systemctl reload nginx

# ─── 13. Smoke ─────────────────────────────────────────────────────
curl https://api.prod.host/health
curl https://api.prod.host/health/ready       # пара post/redis/livekit = ok
curl -s https://api.prod.host/api/docs > /dev/null && echo "Swagger OK"
curl -s https://api.prod.host/metrics | grep -E 'bullmq_(probe|conversational|chat-v2|knowledge-clone|skill|tracker)' | head
```

**Если что-то пошло не так — см. [🆘 Troubleshooting](#-troubleshooting) внизу.**

---

## 🆕 Полный чек-лист для чистого старта (Сценарий B: данные сносим)

> Beta/staging, или прод где volume PG несовместим с composite-образом. **Все данные пользователей будут потеряны.**

```bash
ssh root@prod
cd /home/docker/z
set -a && source .env && set +a

# ─── 1. (опц.) Бэкап перед wipe — на случай если передумаешь ──────
mkdir -p backups && \
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "backups/z_main_before_wipe_$(date +%F-%H%M).dump" 2>/dev/null || echo "БД уже сломана — пропускаем бэкап"

# ─── 2. WIPE: down -v снесёт volumes (БД + redis-AOF) ─────────────
docker compose down -v --remove-orphans
docker volume ls | grep z_                    # должно быть пусто

# ─── 3. Pull + проверка lockfile + .env ────────────────────────────
git pull origin dev
grep -c npmmirror backend/bun.lock frontend/bun.lock     # 0 и 0
# Минимальный .env (см. ниже «Шаг 1 — ENV»):
nano .env
set -a && source .env && set +a

# ─── 4. Build + up (на чистой БД gate не нужен) ────────────────────
docker compose build
docker compose up -d
docker compose logs -f migrate                # жди "DONE", Ctrl+C
docker compose ps                             # все healthy

# ─── 5. Проверка composite-образа postgres + расширений ───────────
docker compose ps postgres                    # IMAGE: z-postgres-age-pgvector:pg16
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT extname, extversion FROM pg_extension WHERE extname IN ('age','vector');"
# Должно вернуть 2 строки

# ─── 6. ОДНА КОМАНДА: bootstrap super-admin + все seed'ы ──────────
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode bootstrap --continue-on-fail
# Минует patch/backfill/migrate (на пустой БД нечего бэкфилить).

# ─── 7. Setup ботов + smoke ────────────────────────────────────────
docker compose exec backend bun run setup:telegram-bot \
  -- --token=$TG_TOKEN --public-host-url=https://api.prod.host --webhook-secret=<секрет>

curl https://api.prod.host/health
curl https://api.prod.host/health/ready
```

---

## 🚀 TL;DR — что делает агрегатор

`backend/scripts/apply-prod-deploy.ts` — единая точка для всех ~80 prod-операций:

```bash
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode bootstrap   # чистый старт
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update      # обновление
docker compose exec backend bun run scripts/apply-prod-deploy.ts                    # all (default)

# Полезные флаги:
#   --dry-run            показать что будет запущено, не выполнять
#   --continue-on-fail   продолжать после ошибки скрипта (default: stop)
```

В конце: `=== SUMMARY === Всего: NN, OK: M, FAIL: K` + список упавших. Если есть FAIL — `exit 1`.

> При добавлении нового `seed-*` / `patch-*` / `backfill-*` / `migrate-*` скрипта **обязательно** допиши его в массив `STEPS` в `backend/scripts/apply-prod-deploy.ts` — иначе на проде он не запустится.
>
> ⚠️ **Скрипт, который бутает `NestFactory.createApplicationContext(AppModule)`, ОБЯЗАН завершаться `process.exit(0)` на успехе** (`main().then(() => process.exit(0)).catch(...)`). Иначе после `app.close()` blocking-соединения BullMQ-воркеров уходят в reconnect-шторм (`ioredis: Connection is closed`), процесс не завершается, и аггрегатор виснет на `await proc.exited`. Грабля 2026-05-29 — подвисли `seed-global-channels`, `patch-backfill-dataclass-audit`, `skill-trait-concepts-backfill`, `person-knowledge-embeddings-backfill`.

---

## Два сценария выката

| Сценарий | Когда | Куда смотреть |
|---|---|---|
| **A. Обновление (данные сохраняем)** | Стандартный workflow: prod уже работает, данные пользователей важны | Шаги 0..12 ниже (с GATE-backfill'ами и patch/migrate-скриптами для legacy) |
| **B. Чистый выкат с нуля (wipe & fresh)** | Beta/staging без важных данных; или postgres-volume несовместим с новым образом (например, был pg17 → стал composite pg16) | См. [📦 Сценарий B: Чистый выкат с нуля](#-сценарий-b-чистый-выкат-с-нуля) ниже. **Минует patch/backfill/migrate — на пустой БД они не нужны.** |

⚠️ Если `docker compose up` падает с ошибкой про `database files are incompatible with server` или `migrate` exit 1 на CREATE EXTENSION — у тебя НЕ composite postgres-образ запущен (или volume старого PG). Перейди в [Сценарий B](#-сценарий-b-чистый-выкат-с-нуля).

---

### Шаг 0 — Pre-flight (один раз перед выкатом)

**0.1. Apache AGE в postgres-образе.**
`migrate`-сервис compose выполняет `bunx prisma db push && bun scripts/apply-postgres-init.ts`. Последний создаёт `CREATE EXTENSION age` и `ag_catalog.create_graph('z_graph')` для онтологии (Фаза 0).

В `docker-compose.yml` (корневой) postgres-сервис собирается из `infra/postgres/Dockerfile` — composite-образ `z-postgres-age-pgvector:pg16` с уже включёнными `age 1.5+`, `pgvector 0.8+` и `shared_preload_libraries = 'age'`. Ничего отдельно настраивать не нужно — образ соберётся при первом `docker compose build`.

Если у тебя на проде **managed Postgres** (Yandex / Selectel) вместо composite-образа:
- В настройках кластера прописать `shared_preload_libraries = 'age'` → рестарт инстанса.
- Проверить:
  ```bash
  docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SHOW shared_preload_libraries;"
  ```

См. `second-brain/02_architecture/age-deployment-decision.md`.

**0.2. Бэкап БД.** Обязательно перед `prisma:push` (Шаг 4) и `patch-*` (Шаг 6).

```bash
# Одной командой — mkdir + pg_dump (директория backups/ может ещё не существовать на свежем сервере):
mkdir -p backups && docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "backups/z_main_$(date +%F-%H%M).dump" && ls -lh backups/ | tail -3
```

> ⚠ `$POSTGRES_USER` и `$POSTGRES_DB` берутся из shell-окружения хоста. Если они не экспортированы — подставь явные значения (`-U z_app -d z_main`) или сначала `set -a && source .env && set +a`.

Восстановление:
```bash
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  < backups/z_main_<TIMESTAMP>.dump
```

**0.3. Lockfile-санитизация (одноразовое).**
Если `bun.lock` в репо ссылается на `cdn.npmmirror.com` (китайский CDN — пакеты оттуда удаляются произвольно), `docker compose build` упадёт на `error: GET https://cdn.npmmirror.com/... - 404`. Фикс уже закоммичен (`backend/bunfig.toml` + `frontend/bunfig.toml` с `registry = "https://registry.npmjs.org"` + перегенерированные `bun.lock`). Проверка:
```bash
grep -c npmmirror backend/bun.lock frontend/bun.lock     # должно быть по 0
```

**0.4. ENV** — см. Шаг 1.

---

### Шаг 1 — ENV (новые ключи за период)

Все ENV, добавленные за окно, **опциональны (имеют дефолты)** — backend стартует без них. Но рекомендованный минимум для прода:

```bash
# === Conversational channels β-9 (2026-05-25) — глобальный Telegram-бот ===
KORA_BOT_USERNAME=kora_bot          # без @, для deep-link
INVITE_TTL_DAYS=14
INVITE_REMINDER_DAYS=7
MAGIC_LINK_TTL_MINUTES=15
MAGIC_LINK_RATE_LIMIT_PER_HOUR=5
INACTIVE_BINDING_DAYS=30

# === Telegram через прокси telegram.crossmark.ru (2026-05-26) ===
# ТЗ: plans/tz/2026-05-26-telegram-via-crossmark-proxy.md.
# Прод по умолчанию через прокси — backend и Telegram не имеют прямой связи из ДЦ.
# ВАЖНО: PUBLIC_HOST_URL — публичный https-адрес БЭКЕНДА, на который прокси
# шлёт вебхуки. Из него собирается targetWebhookUrl=${PUBLIC_HOST_URL}/api/v1/webhooks/telegram-bot/s/<secret>.
# Кодом НЕ определяется. Если пуст — fallback на PUBLIC_FRONTEND_URL (обычно домен
# фронта → вебхуки уйдут не туда). В проде задавать обязательно.
PUBLIC_HOST_URL=https://<публичный-хост-бэкенда>
TELEGRAM_PROXY_ENABLED=true                       # default true; false = аварийный rollback на api.telegram.org
TELEGRAM_PROXY_API_BASE=https://telegram.crossmark.ru
TELEGRAM_PROXY_FILE_BASE=https://telegram.crossmark.ru
# 2026-06-04: авторизация админ-API прокси переведена на статический Bearer-токен.
# Токен создаётся один раз в веб-админке прокси (POST /api/tokens) и кладётся сюда.
# Старые TELEGRAM_PROXY_ADMIN_EMAIL/PASSWORD/JWT_PREFETCH_SEC — УДАЛЕНЫ из схемы, не нужны.
TELEGRAM_PROXY_TOKEN=<статический Bearer-токен из веб-админки прокси>  # хранить в vault
TELEGRAM_PROXY_REQUEST_TIMEOUT_MS=15000              # потолок одного outbound-вызова
TELEGRAM_PROXY_HEALTH_INTERVAL_SEC=30                # интервал health-cron

# === Web Push (если включается push-уведомления) ===
# ВНИМАНИЕ: VAPID_* НЕ в EnvSchema → опечатки не валидируются zod'ом, фича просто молча отключится.
VAPID_PUBLIC_KEY=<docker compose run --rm backend bunx web-push generate-vapid-keys>
VAPID_PRIVATE_KEY=<...>
VAPID_SUBJECT=mailto:noreply@kora.app
PUSH_MAX_FAILURES=5
# Frontend (build-arg!) — тот же public key:
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<тот же public>

# === Email-to-task (T5, опц., default OFF) ===
MAIL_INBOX_ENABLED=false                 # включить ТРЕБУЕТ заполнения остальных
MAIL_INBOX_DOMAIN=inbox.kora.app
MAIL_INBOX_IMAP_HOST=imap.kora.app
MAIL_INBOX_IMAP_PORT=993
MAIL_INBOX_IMAP_USER=inbox@kora.app
MAIL_INBOX_IMAP_PASS=<secret>
MAIL_INBOX_IMAP_TLS=true
MAIL_INBOX_IMAP_FOLDER=INBOX
MAIL_INBOX_POLL_CRON=*/2 * * * *
MAIL_INBOX_MAX_PER_RUN=50

# === T3 LLM провайдеры (kie + grsai) ===
KIE_API_KEY=<secret>
GRSAI_API_KEY=<secret>

# === Kill-switch'и (все default false — можно не дублировать) ===
BITEMPORAL_ENABLED=false
BITEMPORAL_SUPERSEDE_ENABLED=false
CLONE_V2_ENABLED=false                   # ТОЛЬКО ПОСЛЕ Шага 6.10 (patch-migrate-clone-access)
SPECIALISTS_COMBINED_ENABLED=false
COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM=false
DATACLASS_POLICY_ENFORCEMENT=shadow      # off | shadow | enforce — на проде сначала shadow

# === Волна 4 B0 (2026-06-10) — client-meeting-split (kill-switch, default ON) ===
# Нейтральный ПРОТОКОЛ встречи наружу для клиента (free-text Markdown) для
# клиентских типов (sales/customer_success/partner/custdev). analyze.worker
# мержит результат в AiResult.structuredData.client_protocol_md. Граница D6:
# ноль внутренних оценок. Default ON — действий владельца не требует; рубильник
# для экстренного выключения. AdminSetting-зеркало: aiFeatures.clientProtocolEnabled.
CLIENT_PROTOCOL_ENABLED=true

# === Concierge → dialog-layer integration (ТЗ 2026-05-27) ===
# При CONCIERGE_DIALOG_LAYER_ENABLED=true главный AI-агент использует
# 5-шаговый pipeline DialogService (contextualize → confidence → classify →
# multi-query + AnswerCache) и параллельный pre-retrieval по queries через
# ToolRouter.execute('search_knowledge'). Default false — на проде сначала
# включаем на 1 dev-tenant, потом полный raise. Откат — одной ENV.
CONCIERGE_DIALOG_LAYER_ENABLED=false        # фича-флаг pipeline (default false)
CONCIERGE_PRE_RETRIEVAL_TOP_K=12            # cap items в pre-retrieval после dedup
CONCIERGE_PRE_RETRIEVAL_TIMEOUT_MS=3000     # per-query timeout (мс), не блокирует основной flow
```

**Применение в compose.** ENV читаются из корневого `.env` через `env_file: [.env]` (см. `docker-compose.yml`). После правки `.env`:
```bash
docker compose up -d --force-recreate backend
```
(`restart` НЕ перечитает env-переменные — нужен именно `--force-recreate`.)

⚠️ **NEXT_PUBLIC_\*** вшиваются в frontend-бандл во время **сборки** (build-args). При смене любой `NEXT_PUBLIC_*` — обязательная пересборка:
```bash
docker compose up -d --build frontend
```

Полный список — `backend/src/common/config/env.schema.ts`. VAPID_*, CONCIERGE_* сознательно вне EnvSchema (TS2589 при глубоких `.merge()`) — читаются через `process.env` напрямую.

---

### Шаг 2 — Pull + сборка образов

```bash
# на хосте, в корне репо
git pull origin dev

# Пересобрать backend + frontend + postgres-композит (если изменился infra/postgres/Dockerfile).
docker compose build
```

`docker compose build` использует `bun install --frozen-lockfile` внутри Dockerfile и `bunfig.toml` (registry = npmjs.org). Никакого `bun install` на хосте не нужно.

---

### Шаг 3 — PRE-MIGRATION gate (защитный backfill ДО `migrate`-сервиса)

`prisma db push` (внутри `migrate`-сервиса) сделает `Meeting.tenantId` NOT NULL. Если есть legacy-Meeting с NULL — push упадёт и весь `docker compose up` зависнет.

> ⚠️ **Если прод уже проходил этот выкат раньше** (`Meeting.tenantId` уже NOT NULL) — **GATE пропусти целиком.** Сначала прогони только `backfill-meeting-tenant-id.ts` (он на raw-SQL, безопасен): если он пишет «Найдено … IS NULL: 0» — миграция уже применена, `backfill-orgs-fase0.ts` и `tighten-*` НЕ запускай. С версии после 2026-05-29 эти два скрипта на уже-мигрированной схеме сами печатают «обновление не требуется» и выходят `0` (раньше — падали Prisma 7-валидацией на `where:{tenantId:null}`, что пугало оператора). С 2026-06-01 такое самопроверочное поведение распространено на ВСЕ update-скрипты — см. раздел [🛡️ Идемпотентность update-скриптов](#️-2026-06-01--идемпотентность-update-скриптов-самопроверка-вместо-сырых-падений).

Сначала чиним — через `run --rm backend` (одноразовый контейнер с новым кодом, postgres уже запущен с прошлого выката):

```bash
# postgres должен быть up (со старого деплоя). Если нет:
docker compose up -d postgres redis

docker compose run --rm backend bun run scripts/backfill-orgs-fase0.ts
docker compose run --rm backend bun run scripts/backfill-meeting-tenant-id.ts                  # dry-run
docker compose run --rm backend bun run scripts/backfill-meeting-tenant-id.ts --apply          # реальный прогон
docker compose run --rm backend bun run scripts/tighten-meeting-tenant-not-null.ts             # exit 1 == STOP
```

Если `tighten-*` падает → разбирайся, **не запускай Шаг 4** пока не вернёт 0.

---

### Шаг 4 — Прогон миграций (автоматически через `migrate`-сервис)

Запуск всего стека. `migrate` отработает первым (`prisma db push` + `apply-postgres-init.ts`), потом стартанёт `backend`.

```bash
docker compose up -d
docker compose logs -f migrate     # пока не увидишь "DONE" / exit 0
```

⚠️ **`prisma:push` спросит подтверждение на:**
1. **DROP колонки `Transcript.rawIndexS3Url`** (NOT NULL) — данные перенесены в новую модель `TranscriptTrack`. Если потребуется — добавь `--accept-data-loss` в команду `migrate`-сервиса (`docker-compose.yml` → `migrate.command`) и пересобери. Перед этим убедиться, что нет внешних потребителей S3-ключа.
2. **`Meeting.tenantId` → NOT NULL** — gate из Шага 3 должен был всё прибрать. Если не сработал — вернись.

**Что нового в схеме** (за окно ~165 новых моделей):
- Kora-v2 фундамент: AdminSetting, EmailTemplate, RetentionPolicy, CronSchedule, FeatureFlag
- knowledge-core graph: Decision, Insight, Idea, IdeaCluster, IdeaBlockLink, EntityLink, Interaction
- Tracker (~20 моделей): Issue, IssueState, IssueComment, IssueAttachment, IssueLink, IssueRelation, IssueWebhook, IssueWebhookLog, IntakeIssue, Project, ProjectMember, Label, Cycle, Plan, ImportLog, HolidayCalendar
- Company Foundation (Фаза 0): Person, Role, Department, JobDescription, Document, Mission, Vision, Strategy, Process, ProcessStep, Regulation, Policy, Tool, Metric, Market, OrgUnit, Vendor, CompanyProfile, FunctionalDomain, Appointment, RoleProfile
- Skill / Clone (γ-1): Skill, SkillProfile, SkillTrait, SkillTraitCategory, SkillTraitConcept, ExecutablePersona, PersonKnowledgeCategoryEmbedding, CloneAccessGrant
- AI/LLM Admin: LlmProvider, LlmModel, LlmModelExperiment, LlmTaskRouteChange, PromptTemplate, PromptTemplateVersion, AiResultFeedback, AiCostDaily, OrgBudgetCap, CurrencyRate
- Meetings/Curation: TranscriptTrack, MeetingBehaviorMetrics, MeetingQualityScore, MeetingReport, CurationItem, CardVersion, CompletenessSlot
- Operations β: Experiment, DailyCheckIn, DailyOperationsDigest, WeeklyOperationsDigest, ProactiveNotification, ProbeEvent
- Gamification: ActivityFeedItem, Recognition, HelpfulnessTrait, HelpfulnessSpotlight, Badge, UserBadge, TeamTemplate
- Channels: Channel, ChannelBinding, Notification, NotificationDelivery, MailInboundLog, ChatV2Conversation, ChatV2Message
- Calendar (MVP): Event, EventParticipant, EventReminder
- Concierge / Push: ConciergeConversation, ConciergeMessage, OrgConciergeQuota, OrchestratorRun, PushSubscription

Расширение существующих:
- `Meeting`: +linkedIssueId, +reportFastStatus, +recordByDefault, +behaviorMetricsStatus, +qualityScoreStatus
- `Transcript`: +turns(Json), +roomChat, +cleanedS3Url, +cleaningStatus; **DROP rawIndexS3Url**
- `AiResult`: +summaryFast, +promptTemplateVersionId, +experimentGroup
- `AiUsageLog`: +inputCostPerMillionTokensSnapshot, +costRub, +dataClassAudit
- `Task`: +assigneeUserId (FK на User)
- `User`: +calendarFeedToken (VarChar 80)
- `User` (2026-05-29, онбординг v2): +`companyRole UserCompanyRole?` (enum: founder, general_director, operations_director, department_head, team_lead, specialist), +`profileCompletedAt DateTime?`. Оба nullable — обратно совместимо, простой db push.
- `Org` (2026-05-29, онбординг v2): +`teamSize VarChar(20)?`, +`painPoints String[]`, +`currentStack String[]`, +`plannedFeatures String[]`, +`welcomeCompletedAt DateTime?`, +`companyInfoCompletedAt DateTime?`, +`departmentsCompletedAt DateTime?`, +`rolesCompletedAt DateTime?`, +`teamInvitedAt DateTime?`, +`firstSprintCreatedAt DateTime?`, +`firstMeetingCreatedAt DateTime?`, +`setupCompletedAt DateTime?`. Все nullable — обратно совместимо, простой db push.
- `Org` (2026-05-28, демо-воркспейс): +`demoWorkspaceSeededAt DateTime?`. Nullable — обратно совместимо, простой db push. Отмечает, что для этой Org уже загружен демо-кабинет «ТехноСтрим».
- `Org` (2026-05-31, демо-контент Pulse v2): +`demoUserIds String[] @default([])`. Список id-шников демо-User'ов (5 шт. для «ТехноСтрим»). Используется `resetDemoWorkspace` для точечного удаления именно демо-юзеров. Обратно совместимо, простой db push.
- `User` (2026-05-27, коммит `ade4c25`): +`phone VarChar(20)?`, +`signupRef VarChar(255)?`, +`consentDataProcessing Boolean @default(false)`, +`consentMarketing Boolean @default(false)`, +`consentAcceptedAt DateTime?`. Lead-style регистрация: телефон, два чекбокса согласий, ref-tracking из URL. Все nullable / с дефолтом — обратно совместимо, простой db push без `--accept-data-loss`.
- `CloneAccessGrant` (2026-05-26, коммит `fc3d6fe`): +`revokedAt DateTime?`, +`revokedBy String?`, +`expiresAt DateTime?` + 2 индекса. Все поля nullable — обратно совместимо, простой db push.
- **Sprints (2026-05-27, коммиты `bb4aa6e`/`9df3d6c`/`bc34ea6`):**
  - `Project` +4 опц. scope-поля (`customerCardId/vendorId/subjectPersonId/departmentId`) + 4 индекса. Обратные relations добавлены в `Card/Vendor/Person/Department` как `scopedProjects Project[]` с уникальными relation-name'ами (ProjectCustomerCard / ProjectVendor / ProjectSubjectPerson / ProjectDepartment).
  - `Cycle` — обратные relations `linkedMeetings Meeting[]` (MeetingLinkedCycle) и `sprintHints SprintHint[]` + индекс `(tenantId, completedAt)`.
  - `Meeting` +`linkedCycleId String?` + relation MeetingLinkedCycle + индекс. Простой db push, обратно совместимо.
  - Новая модель `SprintHint` (cycleId, kind, severity, status, title, body, affectedIssueIds[], sourceBlockIds[], contentHash для дедупа, confidence). 3 новых enum: `SprintHintKind` (10 значений), `SprintHintSeverity`, `SprintHintStatus`.
  - `MeetingType` +`sprint_review` (для встречи «Итоги спринта»).
- **Telegram self-initiated checkins (2026-05-30):**
  - `DailyCheckIn` +`source DailyCheckInSource @default(cron_prompted)` — откуда пришла запись. Обратно совместимо (default backfill всех записей в `cron_prompted`, см. patch-скрипт Шаг 6).
  - Новый enum `DailyCheckInSource { cron_prompted, self_initiated, manual }`. Простой db push, без `--accept-data-loss`.

Enum расширения (без удалений — Postgres не умеет DROP VALUE):
- `MeetingType`: +review, +retrospective, +task_discussion
- `SignalType`: +30 значений
- `EntityType`: +customer, +vendor, +document, +goal, +event, +technology, +metric, +market, +org_unit
- `EntityLinkType`: +30 значений
- `IdeaBlockLinkType`: +resolves, +supersedes
- `MembershipRole`: +coo
- `SourceType`: +conversational, +tracker_event
- `VerificationPurpose`: +magic_link, +invite_accept
- ~50 новых enum-типов целиком

---

### Шаг 5 — Postgres-init (HNSW + GIN + partial unique + AGE graph)

Выполняется автоматически внутри `migrate`-сервиса (см. Шаг 4) после `prisma db push`. Если нужно прогнать вручную (например, после ручной правки SQL):
```bash
docker compose run --rm backend bun run apply-postgres-init
```

Что создаёт (всё через `IF NOT EXISTS`, идемпотентно):
- **Extensions:** `vector`, `age` (+ `LOAD 'age'`, `SET search_path`)
- **Graph:** `ag_catalog.create_graph('z_graph')`
- **HNSW (cosine) на embedding-колонках:** Decision, Insight, Idea, IdeaCluster, SkillTrait, SkillTraitConcept, PersonKnowledgeCategoryEmbedding, HelpfulnessTrait, Issue, MeetingTranscriptChunk, IdeaBlock, Entity
- **GENERATED tsvector + GIN (словарь `russian`):** IdeaBlock.search_tsv, decisions.decision_search_tsv, insights.insight_search_tsv
- **GIN на массивах:** Event.participantsPersonIds, Vendor.contractIds, decisions/insights/ideas/EntityLink.* массивы IDs
- **Partial unique индексы:** meeting_report_pending_unique, Vendor_tenantId_inn_unique_idx, Entity_strong_inn/ogrn/email/domain_uniq, channels_global_unique
- **Composite:** probe_events_tenant_status_created_idx, Entity_strong_phone_idx

---

### Шаг 6 — One-off patch-скрипты (порядок важен!)

> Все patch-скрипты — через `exec backend` (контейнер уже запущен после Шага 4).

```bash
# 6.1 — Knowledge-core: переименования + entityId
docker compose exec backend bun run scripts/patch-rename-client-to-customer.ts --dry-run
docker compose exec backend bun run scripts/patch-rename-client-to-customer.ts
docker compose exec backend bun run scripts/patch-migrate-entity-custom-to-topic.ts
docker compose exec backend bun run scripts/patch-backfill-entity-id-document.ts
docker compose exec backend bun run scripts/patch-backfill-entity-id-goal.ts
docker compose exec backend bun run scripts/patch-backfill-entity-id-person.ts
# либо composite alias (запускает все три выше):
# docker compose exec backend bun run patch:backfill-entity-id
docker compose exec backend bun run scripts/patch-person-relationship.ts

# 6.2 — Card versioning + document defaults
docker compose exec backend bun run scripts/patch-backfill-card-versions.ts
docker compose exec backend bun run scripts/patch-document-use-cases-default.ts

# 6.3 — Org / Person timezone (Europe/Moscow по умолчанию)
docker compose exec backend bun run scripts/patch-org-timezone-default.ts
docker compose exec backend bun run scripts/patch-person-timezone-default.ts

# 6.4 — Mission/Vision/Strategy → CompanyProfile (по умолчанию dry-run!)
docker compose exec backend bun run scripts/patch-migrate-mvs-to-company-profile.ts            # dry-run
docker compose exec backend bun run scripts/patch-migrate-mvs-to-company-profile.ts --apply    # запись

# 6.5 — PersonRole → Appointment (по умолчанию dry-run!)
docker compose exec backend bun run scripts/patch-migrate-person-role-to-appointment.ts            # dry-run
docker compose exec backend bun run scripts/patch-migrate-person-role-to-appointment.ts --apply    # запись

# 6.6 — Skill traits категории (γ-1)
docker compose exec backend bun run scripts/patch-skill-trait-categories-from-strings.ts --dry-run
docker compose exec backend bun run scripts/patch-skill-trait-categories-from-strings.ts

# 6.7 — KC-Temporal (bitemporal + dataclass + strong-ids + channel-binding)
docker compose exec backend bun run scripts/patch-bitemporal-backfill.ts --dry-run
docker compose exec backend bun run scripts/patch-bitemporal-backfill.ts
docker compose exec backend bun run scripts/patch-clones-role-versioning.ts
docker compose exec backend bun run scripts/patch-clones-dataclass-update.ts
docker compose exec backend bun run scripts/patch-backfill-dataclass-audit.ts
docker compose exec backend bun run scripts/patch-channel-binding-defaults.ts
docker compose exec backend bun run scripts/patch-extract-strong-ids.ts

# 6.8 — Prompt registry no-op (для будущей совместимости; сейчас ничего не пишут)
docker compose exec backend bun run scripts/patch-prompt-block-ingest-v2-fase0b.ts
docker compose exec backend bun run scripts/patch-prompt-role-profile-build-fase0d.ts

# 6.9 — LLM миграция на DeepSeek-V4-Pro (chat-v2 + 19 одиночек)
docker compose exec backend bun run scripts/patch-chat-v2-to-pro.ts
docker compose exec backend bun run scripts/patch-mass-migrate-to-deepseek-pro.ts --dry-run
docker compose exec backend bun run scripts/patch-mass-migrate-to-deepseek-pro.ts --update-existing

# 6.12 — Восстановить fallback-цепочку meeting-report-fast (2026-06-03)
# Нормализованный primary (deepseek-v4-pro) затенял legacy 3-провайдерную
# цепочку → single-provider timeout без fallback. Дописывает secondary
# (openai-via-proxy/gpt-5.4-mini) + tertiary (ollama/qwen3.5:9b). Идемпотентен.
docker compose exec backend bun run scripts/patch-ensure-meeting-report-fast-fallback.ts --dry-run
docker compose exec backend bun run scripts/patch-ensure-meeting-report-fast-fallback.ts

# 6.10 — Первичная миграция грантов CloneAccessGrant (2026-05-26, коммит 87fef5d)
# ОБЯЗАТЕЛЬНО ДО переключения CLONE_V2_ENABLED=true (см. Шаг 1).
docker compose exec backend bun run scripts/patch-migrate-clone-access.ts
# опц. для одного тенанта:
# docker compose exec backend bun run scripts/patch-migrate-clone-access.ts --tenant <orgId>

# 6.11 — Регистрация глобального Telegram-бота в прокси telegram.crossmark.ru
# (2026-05-26). Идемпотентен.
#
# ⚠ В обычном выкате этот скрипт НЕ нужен — после первой установки
# токена в /admin/system/telegram-bot backend сам авто-регистрирует бот
# в прокси (см. AdminTelegramBotService.updateToken → autoRegisterInProxy).
# Скрипт остаётся для двух кейсов:
#   1. Bootstrap старого прода, где токен уже был в БД ДО появления
#      прокси-флоу — скрипт зарегистрирует существующий токен без захода
#      в админку.
#   2. Аварийный режим, когда веб-админка временно недоступна.
#
# Предусловия:
#   - TELEGRAM_PROXY_TOKEN в .env (см. Шаг 1); статический токен из веб-админки прокси;
#   - PUBLIC_HOST_URL в .env (публичный хост бэкенда — из него собирается targetWebhookUrl);
#   - в /admin/system/telegram-bot уже установлен токен бота (иначе скрипт
#     выходит с инструкцией и кодом 0).
docker compose exec backend bun run scripts/patch-telegram-register-in-proxy.ts
# опц. — ротация webhookSecret (старый перестаёт работать сразу):
# docker compose exec backend bun run scripts/patch-telegram-register-in-proxy.ts --rotate-secret

# 6.12 — Backfill source=manual для DailyCheckIn без notificationId
# (2026-05-30, ТЗ telegram-self-initiated-checkins). Идемпотентен.
# После добавления поля source все существующие записи получили default
# 'cron_prompted', но manual-создания через POST /me/check-ins должны быть
# перевешены в 'manual' (notificationId IS NULL — точный признак). Безопасен
# на чистой БД (0 кандидатов).
docker compose exec backend bun run scripts/patch-daily-checkin-backfill-source.ts --dry-run
docker compose exec backend bun run scripts/patch-daily-checkin-backfill-source.ts
```

⚠️ **НЕ запускать на проде** (помечен внутри файла «без согласования»):
- `backfill-task-assignee-userid.ts`

ℹ️ **Доступно оператору при инциденте — НЕ плановая операция** (коммит `177e465`):
- `patch-rollback-to-deepseek-flash.ts` — массовый откат всех LlmTaskRoute с `deepseek-v4-pro` обратно на `deepseek-v4-flash`. Запуск только при подтверждённой регрессии:
  ```bash
  docker compose exec backend bun run scripts/patch-rollback-to-deepseek-flash.ts --dry-run --update-existing
  docker compose exec backend bun run scripts/patch-rollback-to-deepseek-flash.ts --update-existing
  ```

### Шаг 6.11 — Переключение `CLONE_V2_ENABLED` (после Шага 6.10)

После того как миграция грантов отработала и владелец сверил список в `/admin/clones`:

```bash
# 1. правка .env на хосте:
#    CLONE_V2_ENABLED=true
# 2. подхват без пересборки (force-recreate перечитывает env_file):
docker compose up -d --force-recreate backend
```

Откат:
```bash
# .env: CLONE_V2_ENABLED=false
docker compose up -d --force-recreate backend
```

---

### Шаг 7 — Seed-скрипты

```bash
# 7.1 — Базовый каркас LLM (порядок важен: providers → models → prices → routes)
docker compose exec backend bun run scripts/seed-default-llm-providers-and-models.ts
docker compose exec backend bun run scripts/seed-llm-model-prices.ts
docker compose exec backend bun run scripts/seed-prompt-templates.ts                          # 13 системных шаблонов
docker compose exec backend bun run scripts/seed-llm-task-routes-default.ts                   # дефолтные цепочки

# 7.2 — Тарифы / Entitlements / Retention / Календарь / Шаблоны команд / Домены
docker compose exec backend bun run scripts/seed-entitlements.ts                              # OrgEntitlement(tier_pro)
docker compose exec backend bun run scripts/seed-retention-policies.ts
docker compose exec backend bun run scripts/seed-holiday-calendar-ru-2026.ts                  # производственный календарь РФ
docker compose exec backend bun run scripts/seed-team-templates.ts                            # 10+5 системных TeamTemplate
docker compose exec backend bun run scripts/seed-functional-domains.ts                        # 8 базовых FunctionalDomain per Org

# 7.3 — Admin settings
docker compose exec backend bun run scripts/seed-admin-settings.ts
docker compose exec backend bun run scripts/seed-admin-setting-daily-digest.ts

# 7.4 — Бейджи (gamification T1)
docker compose exec backend bun run scripts/seed-badges.ts                                    # 5 базовых

# 7.5 — Глобальный Telegram канал (β-9)
docker compose exec backend bun run scripts/seed-global-channels.ts

# 7.6 — LLM TaskRoutes для всех новых taskType (за период, безопасно идемпотентно)
docker compose exec backend bun run scripts/seed-llm-task-routes-phase-B.ts                   # behavior-refine
docker compose exec backend bun run scripts/seed-llm-task-routes-phase-C.ts                   # meeting-quality-score
docker compose exec backend bun run scripts/seed-llm-task-routes-phase-D.ts                   # transcript-clean-refine
docker compose exec backend bun run scripts/seed-llm-task-routes-phase-E.ts                   # custom-report
docker compose exec backend bun run scripts/seed-llm-task-routes-regulations.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-knowledge-clone.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-knowledge-core.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-decisions.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-insights.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-ideas-and-probe.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-skill-and-clone.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-skill-concept.ts             # skill-trait-concept-name
docker compose exec backend bun run scripts/seed-llm-task-routes-chat-v2.ts                   # chat-v2-conversation-title, chat-v2-cite-select
docker compose exec backend bun run scripts/seed-llm-task-routes-recognition.ts               # recognition-formulate
docker compose exec backend bun run scripts/seed-llm-task-routes-helpfulness.ts               # 3 helpfulness taskType
docker compose exec backend bun run scripts/seed-llm-task-routes-beta-8.ts                    # checkin-parse, operations-summary
docker compose exec backend bun run scripts/seed-llm-task-routes-beta-8-1.ts                  # checkin-sentiment(+batch), operations-weekly-digest
docker compose exec backend bun run scripts/seed-llm-task-routes-beta-8-2.ts                  # commitment-extract-dates/status
docker compose exec backend bun run scripts/seed-llm-task-routes-beta-8-3.ts                  # operations-daily-digest
docker compose exec backend bun run scripts/seed-llm-task-routes-axis-classify.ts             # axis-classify, router-fallback
docker compose exec backend bun run scripts/seed-llm-task-routes-brand-voice.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-company-foundation.ts        # department-extract, domain-expand, maturity-rationale
docker compose exec backend bun run scripts/seed-llm-task-routes-concierge.ts                 # concierge-respond, concierge-toolcall-validate
docker compose exec backend bun run scripts/seed-llm-task-routes-cross-functional.ts          # cross-functional-friction-summary
docker compose exec backend bun run scripts/seed-llm-task-routes-experiments.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-process-template.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-role-map.ts                  # role-map-extract, role-completeness-rationale
docker compose exec backend bun run scripts/seed-llm-task-routes-orchestrator.ts              # 4 orchestrator-*
docker compose exec backend bun run scripts/seed-llm-task-routes-proactive.ts                 # proactive-message-craft
docker compose exec backend bun run scripts/seed-llm-task-routes-tracker-phase3.ts            # meeting-extract-actions, intake-auto-triage
docker compose exec backend bun run scripts/seed-llm-task-routes-tracker-phase3-c.ts          # issue-infer-fields, issue-goal-suggest
docker compose exec backend bun run scripts/seed-llm-task-routes-tracker-phase4-telegram.ts   # telegram-create-task и др. (4 шт.)
docker compose exec backend bun run scripts/seed-llm-task-routes-feedback-cluster.ts          # feedback.cluster (4 уровня)
docker compose exec backend bun run scripts/seed-llm-task-routes-clone-v2.ts                  # dialog-multi-query-clone, clone-respond v2 → deepseek-v4-pro
docker compose exec backend bun run scripts/seed-llm-task-routes-specialists-combined.ts      # knowledge-specialists-combined (Variant Б+)
docker compose exec backend bun run scripts/seed-llm-task-routes-dialog-layer.ts              # 5 dialog-* taskType
docker compose exec backend bun run scripts/seed-llm-task-routes-temporal.ts                  # fact-supersede-detect
docker compose exec backend bun run scripts/seed-llm-task-routes-kie-grsai-ab.ts              # A/B на dialog-multi-query (status=draft)
docker compose exec backend bun run scripts/seed-llm-task-routes-sprints.ts                   # Sprints (2026-05-27): sprint-helper-suggest + sprint-review-summary (deepseek-v4-pro → gpt-5.4-mini → qwen3.5:9b)

# 7.7 — Глобальный default: DeepSeek-V4-Pro primary на ВСЕ taskType
docker compose exec backend bun run scripts/seed-llm-default-primary-deepseek-pro.ts
# Если хочешь перебить уже существующие primary:
# docker compose exec backend bun run scripts/seed-llm-default-primary-deepseek-pro.ts --update-existing
```

ℹ️ Большинство `seed-llm-task-routes-*` принимают `--update-existing` — без него существующие записи не трогаются. Защита `editedByAdmin` блокирует затирание ручных правок.

---

### Шаг 7.8 — Демо-воркспейс «ТехноСтрим» (per-Org, по запросу)

**Два способа запуска** (выбери один):

**Способ А — через UI (рекомендуется):**
1. Залогинься под owner/admin нужной Org.
2. Перейди на `/onboarding/demo-choice` или вызови `POST /api/v1/orgs/<orgId>/demo-workspace` из Swagger (`/api/docs`).
3. После успешного seed фронтенд перенаправит на `/dashboard` и запустит демо-тур (5 шагов).

**Способ Б — CLI-скрипт (для тестирования / массового seed):**
```bash
# Узнать tenantId (slug Org) и ownerUserId:
docker compose exec backend bun run scripts/seed-demo-workspace.ts --tenant <orgId> --owner <userId>
```
Скрипт создаёт ~4600 строк демо-данных: 12 человек, 7 отделов, 3 проекта, 38 задач, 7 встреч с AI-отчётами, 20 IdeaBlock, 15 Entity, 7 Theme, 4 клона, 100 check-ins, дайджесты, чат-диалоги, уведомления, карточки, процессы. Все записи помечены `externalSource: 'demo'`.

**Сброс демо-данных:**
```bash
# CLI:
docker compose exec backend bun run scripts/seed-demo-workspace.ts --tenant <orgId> --owner <userId> --reset
# API: POST /api/v1/orgs/<orgId>/reset-demo (owner only)
```

⚠️ Скрипт **не зарегистрирован в `apply-prod-deploy.ts`** — это per-org операция, не глобальный seed. Вызывается по требованию из UI или CLI.

---

### Шаг 8 — Backfill (после schema + seed)

```bash
docker compose exec backend bun run scripts/backfill-meeting-sources-fase1.ts                 # дефолтный Source(type=meeting) per Org
docker compose exec backend bun run scripts/backfill-entity-link-types-fase0.ts               # EntityLink.fromType/toType → 'entity'
docker compose exec backend bun run scripts/backfill-commitment-due-dates.ts --dry-run
docker compose exec backend bun run scripts/backfill-commitment-due-dates.ts                  # β-8.2
docker compose exec backend bun run scripts/backfill-onboarding-setup-completed.ts            # онбординг v2: Org с отделами → setupCompletedAt = createdAt (идемпотентен, батчами по 100)
docker compose exec backend bun run scripts/backfill-demo-subscriptions.ts                    # ТЗ paywall: Subscription{DEMO} для Org без подписки (идемпотентен)

# Опционально (дорого по LLM-quota):
docker compose exec backend bun run scripts/skill-trait-concepts-backfill.ts
docker compose exec backend bun run scripts/person-knowledge-embeddings-backfill.ts --dry-run
docker compose exec backend bun run scripts/person-knowledge-embeddings-backfill.ts

# НЕ запускать (помечен «без согласования»):
# docker compose exec backend bun run scripts/backfill-task-assignee-userid.ts
```

---

### Шаг 9 — Миграции (β-9 Telegram + Tracker legacy Task)

```bash
# β-9: per-tenant Telegram-каналы → один глобальный
docker compose exec backend bun run scripts/migrate-telegram-channels-to-global.ts --dry-run
# Изучи output (cases A/B/C/D/E). Если ок:
docker compose exec backend bun run scripts/migrate-telegram-channels-to-global.ts
# Аварийный откат:
# docker compose exec backend bun run scripts/migrate-telegram-channels-back.ts

# Tracker: legacy Task → Issue (по умолчанию dry-run!)
docker compose exec backend bun run migrate-task-to-issue                # = bun run scripts/migrate-task-to-issue.ts (dry-run)
docker compose exec backend bun run migrate-task-to-issue --apply        # реальная запись
```

---

### Шаг 10 — Per-tenant: настройка ботов

```bash
# Telegram (β-9, 2026-05-25): теперь ГЛОБАЛЬНЫЙ — один на всю инсталляцию, без --tenant-id!
docker compose exec backend bun run setup:telegram-bot \
  -- --token=$TG_TOKEN --public-host-url=https://prod.host --webhook-secret=<секрет>

# MAX (платформа Дзен): пока per-tenant
docker compose exec backend bun run setup:max-bot \
  -- --token=$MAX_TOKEN --tenant-id=$ORG_ID --public-host-url=https://prod.host --webhook-secret=<секрет>
```

⚠️ В старых рефлексиях `setup-telegram-bot` мог упоминаться с `--tenant-id` — **это устарело с β-9**.

---

### Шаг 11 — Рестарт после ENV / кода

```bash
# Поднять / пересоздать с новым образом (миграция уже отработала в Шаге 4):
docker compose up -d --build

# Только подхватить новый .env (без пересборки кода):
docker compose up -d --force-recreate backend

# Если worker'ы вынесены в отдельный сервис (см. ниже) — рестарт его тоже:
# docker compose up -d --force-recreate worker
```

⚠️ В текущем `docker-compose.yml` **backend и BullMQ-воркеры — один контейнер** (worker'ы in-process по `backend/src/workers/main.ts`, который тоже грузится в HTTP-приложение). Один рестарт `backend` подхватывает и новые REST/WS-роуты, и новые BullMQ-очереди, и новые `@Cron`'ы.

Если когда-нибудь будет добавлен отдельный сервис `worker` — рестарт строго оба, иначе новые очереди не подцепятся.

---

### Шаг 12 — Smoke-проверка

```bash
# Health endpoints (изнутри compose-сети nginx → backend):
curl https://prod.host/health
curl https://prod.host/api/docs                  # Swagger UI

# Или напрямую к контейнеру (если nginx ещё не настроен):
docker compose exec backend wget -qO- http://127.0.0.1:3000/health
docker compose exec backend wget -qO- http://127.0.0.1:3000/health/ready
```

В Swagger должны появиться разделы: **tracker, projects, issues, cycles, intake, webhooks, comments, labels, attachments, relations, team-templates, chat-v2, conversational, curation, decisions, events, ideas, insights, knowledge-clone, clones, probe, regulations, vendors, calendar (events)**.

**Sprints (2026-05-27 / расширено 2026-05-28).** В Swagger под тегом `tracker / cycles` должны появиться `GET /api/v1/cycles/:id/dashboard`, `POST /api/v1/cycles/:id/start-meeting`, `GET /api/v1/cycles/:id/hints`, `GET /api/v1/cycles/:id/review`, `POST /api/v1/cycles/:id/review/regenerate`; под тегом `tracker / sprint-hints` — `POST /api/v1/sprint-hints/:id/{dismiss,resolve}`; под тегом `tracker / sprints` (2026-05-28) — `GET /api/v1/sprints` (master-detail список с фильтрами) и `POST /api/v1/sprints/quick-create` (атомарное создание Project+Cycle); под тегом `vendors` — `POST /api/v1/vendors`, `PATCH /api/v1/vendors/:id`, `DELETE /api/v1/vendors/:id`. Smoke модели и базового потока:

```bash
docker compose exec backend bun run scripts/smoke-sprints.ts
```

(создаёт временный Department + Project с departmentId scope + Cycle + 3 Issue + Meeting(sprint_review) + SprintHint, проверяет dismiss; 2026-05-28: расширен — также проверяет list-фильтр scope=department, inline-create Vendor, quick-create scope=vendor с cleanup. Чистит за собой).

```bash
curl https://prod.host/metrics | grep -E 'z_voice_ws|z_mail_inbound|z_llm_cache|z_prompt_injection|bullmq_'
```

Должны быть `bullmq_*` метрики под новые очереди: `probe-*, conversational-send, chat-v2-cleanup, card-stale-detector, idea-clusterer, insight-clusterer, knowledge-clone-rebuild, skill-profile-*, executable-persona-build, skill-manager-digest, tracker.webhook-delivery`.

**Демо-воркспейс (2026-05-28).** В Swagger под тегом `onboarding` должны появиться `POST /api/v1/orgs/:orgId/demo-workspace` и `POST /api/v1/orgs/:orgId/reset-demo`. Smoke-проверка:

```bash
# Seed демо-данных (замени <orgId> и <userId> на реальные):
docker compose exec backend bun run scripts/seed-demo-workspace.ts --tenant <orgId> --owner <userId>
# Ожидаемый вывод: "=== Демо-воркспейс «ТехноСтрим» успешно создан ===" + JSON stats
# Проверка: Org.demoWorkspaceSeededAt != null
docker compose exec backend bun -e '
import { createPrismaClient } from "./scripts/_lib/prisma";
const p = createPrismaClient();
p.org.findUnique({ where: { id: "<orgId>" }, select: { demoWorkspaceSeededAt: true } })
  .then(r => { console.log("demoWorkspaceSeededAt:", r?.demoWorkspaceSeededAt); process.exit(0) })
'

# Reset:
docker compose exec backend bun run scripts/seed-demo-workspace.ts --tenant <orgId> --owner <userId> --reset
# Ожидаемый вывод: "Демо-данные удалены."
```

**Telegram через прокси (2026-05-26).** После Шага 6.11 проверь, что:

```bash
# Метрики прокси — outcome должен быть ok после первого outbound:
curl https://prod.host/metrics | grep -E 'telegram_proxy_request_total|telegram_proxy_health_check_total'

# Health-cron: после ~30с в Redis должен появиться ключ tg:proxy:healthy='1'.
docker compose exec backend bun -e 'import("ioredis").then(m=>{const r=new m.default(process.env.REDIS_URL);r.get("tg:proxy:healthy").then(v=>{console.log("tg:proxy:healthy=",v);process.exit(0)})})'
```

В админке `/admin/system/telegram-bot` — карточка «Прокси telegram.crossmark.ru»
должна быть зелёной (бот зарегистрирован, healthy=true). Кнопка
«Проверить прокси сейчас» возвращает HTTP 200 и < 1000 мс.

```bash
# Hot-reload Prometheus alerts (если изменялись правила, и Prometheus в этом же compose):
docker compose exec prometheus kill -HUP 1
```

---

## 📦 Сценарий B: Чистый выкат с нуля

> Используй когда: данные в БД можно потерять (beta/staging), ИЛИ postgres-volume несовместим с composite-образом `z-postgres-age-pgvector:pg16` (например, был унаследован старый `pgvector/pgvector:pg17`). На чистой БД **не нужны** patch/backfill/migrate-скрипты (Шаги 6, 8, 9) — нечего бэкфилить.

### B.1 — Down + wipe volumes

```bash
cd /home/docker/z         # путь к docker-compose.yml на проде
docker compose down -v    # -v удаляет volumes: z_z-postgres-data, z_z-redis-data
```

⚠️ **Безвозвратно стирает БД и redis-AOF.** Если есть хоть какие-то данные, которые жалко — сначала `Шаг 0.2` бэкап.

### B.2 — Pull + ENV

```bash
git pull origin dev
set -a && source .env && set +a   # подтянуть POSTGRES_USER/DB в shell
```

**Обязательный минимум в `.env`:**
```bash
POSTGRES_DB=z_main
POSTGRES_USER=z_app
POSTGRES_PASSWORD=<openssl rand -hex 16>
DATABASE_URL=postgresql://z_app:<тот_же_пароль>@postgres:5432/z_main

JWT_SESSION_SECRET=<openssl rand -hex 32>
JWT_DEEP_LINK_SECRET=<openssl rand -hex 32>
WEBHOOK_SECRETS_ENCRYPTION_KEY=<openssl rand -base64 32>
IP_HASH_DAILY_SALT=<openssl rand -hex 16>

LIVEKIT_API_KEY=<совпадает с infra/livekit/livekit.yaml>
LIVEKIT_API_SECRET=<совпадает>
LIVEKIT_WEBHOOK_API_KEY=<тот же>
LIVEKIT_WEBHOOK_API_SECRET=<тот же>

# NEXT_PUBLIC_* — вшиваются в frontend-бандл на сборке
NEXT_PUBLIC_API_BASE_URL=https://api.your-domain.tld
NEXT_PUBLIC_BACKEND_URL=https://api.your-domain.tld
NEXT_PUBLIC_LIVEKIT_URL=wss://media.your-domain.tld
NEXT_PUBLIC_FRONTEND_URL=https://app.your-domain.tld

# Первый супер-админ (создаётся через bun prisma/seed.ts в Шаге B.6)
ADMIN_BOOTSTRAP_EMAIL=<твой email>
ADMIN_BOOTSTRAP_NAME=Admin

# Все Kill-switch'и оставь false:
BITEMPORAL_ENABLED=false
BITEMPORAL_SUPERSEDE_ENABLED=false
CLONE_V2_ENABLED=false                   # на чистой БД сразу можно true (нет existing pol'ей)
SPECIALISTS_COMBINED_ENABLED=false
COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM=false
DATACLASS_POLICY_ENFORCEMENT=shadow

# Опциональное (если используешь Telegram-бот):
KORA_BOT_USERNAME=kora_bot
```

### B.3 — Sanity-check + build

```bash
grep -c npmmirror backend/bun.lock frontend/bun.lock     # должно быть 0 / 0
docker compose build                                     # 5-15 мин на холодную
```

### B.4 — Up (postgres → init.sql → migrate → backend → frontend)

```bash
docker compose up -d
docker compose logs -f migrate
# Жди:
#   "✓ postgres-init.sql выполнен"
#   "=== apply-postgres-init DONE ==="
# затем Ctrl+C
```

### B.5 — Проверка composite-образа PG + extensions

```bash
docker compose ps postgres
# IMAGE должно быть: z-postgres-age-pgvector:pg16

docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT extname, extversion FROM pg_extension WHERE extname IN ('age','vector');"
# 2 строки: age 1.5+, vector 0.8+

docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT name FROM ag_catalog.ag_graph WHERE name = 'z_graph';"
# 1 строка: z_graph
```

Если postgres image не composite — пересобери и форсируй recreate:
```bash
docker compose build postgres
docker compose up -d --force-recreate postgres
```

### B.6 — Бутстрап первого супер-админа

**Интерактивно (рекомендуется)** — вводишь только email и пароль, скрипт сам хеширует (bcrypt 12) и ставит `role='admin'` + `isSuperAdmin=true`:
```bash
docker compose exec backend bun run scripts/set-admin-password.ts <email> '<пароль>' --super
# нет юзера → создаст; есть с role=admin → обновит пароль (+ isSuperAdmin при --super)
```
Логин: `POST /api/v1/auth/admin-login {email,password}` → session-cookie → Z-Admin на `/admin`.

⚠️ `role='admin'` **обязателен** — `admin-login` ищет юзера именно по нему (`admin-login.service.ts`). Флаг `--super` добавляет `isSuperAdmin=true` для доступа к супер-функциям Z-Admin. Ручной bcrypt+SQL больше не нужен.

**Альтернатива** — env-bootstrap (если задан `ADMIN_BOOTSTRAP_EMAIL`):
```bash
docker compose run --rm backend bun prisma/seed.ts
# Создаст User по ADMIN_BOOTSTRAP_EMAIL + Org "default" + role=admin (БЕЗ isSuperAdmin).
```

### B.7 — Базовый каркас LLM (без него AI-фичи не работают)

```bash
docker compose exec backend bun run scripts/seed-default-llm-providers-and-models.ts
docker compose exec backend bun run scripts/seed-llm-model-prices.ts
docker compose exec backend bun run scripts/seed-prompt-templates.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-default.ts
```

### B.8 — Прочие seed'ы (тарифы, календарь, шаблоны, домены, бейджи, Telegram)

```bash
docker compose exec backend bun run scripts/seed-entitlements.ts
docker compose exec backend bun run scripts/seed-retention-policies.ts
docker compose exec backend bun run scripts/seed-holiday-calendar-ru-2026.ts
docker compose exec backend bun run scripts/seed-team-templates.ts
docker compose exec backend bun run scripts/seed-functional-domains.ts
docker compose exec backend bun run scripts/seed-admin-settings.ts
docker compose exec backend bun run scripts/seed-admin-setting-daily-digest.ts
docker compose exec backend bun run scripts/seed-badges.ts
docker compose exec backend bun run scripts/seed-global-channels.ts
```

### B.9 — LLM TaskRoutes для всех новых taskType (35 скриптов одним циклом)

```bash
for s in phase-B phase-C phase-D phase-E regulations knowledge-clone knowledge-core \
         decisions insights ideas-and-probe skill-and-clone skill-concept chat-v2 \
         recognition helpfulness beta-8 beta-8-1 beta-8-2 beta-8-3 axis-classify \
         brand-voice company-foundation concierge cross-functional experiments \
         process-template role-map orchestrator proactive tracker-phase3 \
         tracker-phase3-c tracker-phase4-telegram feedback-cluster clone-v2 \
         specialists-combined dialog-layer temporal kie-grsai-ab; do
  echo "=== seed-llm-task-routes-$s ==="
  docker compose exec backend bun run scripts/seed-llm-task-routes-$s.ts
done

# Глобальный primary: DeepSeek-V4-Pro
docker compose exec backend bun run scripts/seed-llm-default-primary-deepseek-pro.ts
```

### B.10 — Setup глобального Telegram-бота (если используешь)

```bash
docker compose exec backend bun run setup:telegram-bot \
  -- --token=$TG_TOKEN --public-host-url=https://prod.host --webhook-secret=<секрет>
```

### B.11 — Smoke

```bash
curl https://prod.host/health
curl https://prod.host/health/ready
# {"ok":true,"checks":{"postgres":"ok","redis":"ok","livekit":"ok"}}

curl -s https://prod.host/api/docs > /dev/null && echo "Swagger OK"
curl -s https://prod.host/metrics | grep -E 'bullmq_(probe|conversational|chat-v2|knowledge-clone|skill|tracker)' | head
```

### Чего в Сценарии B НЕ делать

- ❌ Шаг 3 (PRE-MIGRATION gate) — нет legacy Meeting с NULL tenantId.
- ❌ Шаг 6 (patch-*) — нечего патчить, БД пустая. Исключение: `patch-migrate-clone-access.ts` безопасно запустить (no-op, нет existing Appointment), если планируешь сразу `CLONE_V2_ENABLED=true`.
- ❌ Шаг 8 (backfill-*) — нечего бэкфилить.
- ❌ Шаг 9 (migrate-telegram-channels-to-global / migrate-task-to-issue) — нет legacy данных.

---

## 🆘 Troubleshooting

### `apply-prod-deploy.ts` упал на конкретном скрипте

Запусти с `--continue-on-fail` — увидишь полный список упавших. Идемпотентные скрипты безопасно перезапустить, уже сделанные пройдут как `skipped`:

```bash
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode bootstrap --continue-on-fail
```

### `Cron Job with the given name (...) already exists`

9 скриптов используют `NestFactory(AppModule)` и поднимают весь Nest — это может конфликтовать с уже запущенными `@Cron`-декораторами. Известный технический долг, скрипты:

- `seed-global-channels.ts`
- `migrate-telegram-channels-to-global.ts` / `migrate-telegram-channels-back.ts`
- `patch-backfill-dataclass-audit.ts`
- `backfill-commitment-due-dates.ts`
- `backfill-task-assignee-userid.ts`
- `person-knowledge-embeddings-backfill.ts`
- `skill-trait-concepts-backfill.ts`
- `e2e-feedback-clustering.ts`

Обходные пути:
1. **Запускать в одноразовом контейнере** (где Nest ещё не работает с @Cron):
   ```bash
   docker compose run --rm backend bun run scripts/seed-global-channels.ts
   ```
   НЕ через `exec backend` (там Nest уже инициализирован с cron'ами в основном процессе).
2. **Долгосрочно** — переписать эти скрипты на `createPrismaClient()` из `_lib/prisma`, без `NestFactory`. См. правило в `CLAUDE.md` → Триггер 1 → Шаг 5.

### `migrate` exit 1 при `docker compose up`

Смотри логи:
```bash
docker compose logs --tail=100 migrate
```

Типичные причины:
| Лог | Что делать |
|---|---|
| `extension "age" is not available` | Postgres-контейнер НЕ composite-образ. Проверь `docker compose ps postgres` → IMAGE должно быть `z-postgres-age-pgvector:pg16`. Если нет — `docker compose build postgres && docker compose up -d --force-recreate postgres`. |
| `database files are incompatible with server` | Старый volume (от другой версии PG) и новый образ несовместимы. Только Сценарий B (wipe). |
| `Meeting.tenantId NOT NULL violation` | Не запустил GATE (Шаг 6 в Сценарии A). Сначала backfill, потом retry migrate. |
| `Cannot find module '../src/...'` | Старый backend-образ без `src/` в runner. Пересобери: `docker compose build backend && docker compose up -d --force-recreate backend`. |

### `bun install` падает на `cdn.npmmirror.com - 404` в docker build

Lockfile прибит к китайскому зеркалу. Проверь:
```bash
grep -c npmmirror backend/bun.lock frontend/bun.lock     # должно быть 0 и 0
```
Если ≠ 0 — что-то пошло не так с pull или последний коммит откатил фикс. Перегенерация:
```bash
cd backend && rm bun.lock && bun install && cd ..
cd frontend && rm bun.lock && bun install && cd ..
git diff bun.lock                              # проверь что нет npmmirror
git add backend/bun.lock frontend/bun.lock && git commit -m "fix(deploy): regen bun.lock"
```

### Backend не стартует после `docker compose up`

```bash
docker compose logs --tail=200 backend
```

Чаще всего:
- **Невалидный ENV** (zod fail): в логе будет «Невалидная конфигурация ENV» + поле. Открой `.env`, исправь, `docker compose up -d --force-recreate backend`.
- **DATABASE_URL** не дозвонился до postgres: проверь `docker compose ps postgres` — должен быть healthy. URL внутри compose: `postgres:5432`, не `localhost`.

### LiveKit `fail` в `/health/ready`

```json
{"checks":{"livekit":"fail:Unable to connect..."}}
```

`LIVEKIT_URL` из `.env` (внутри backend-контейнера) не дозвонился до media-сервера. Проверь:
- `LIVEKIT_URL` в `.env` указывает на доступный domain/IP (НЕ `localhost` если media в другом контейнере/сети).
- Media-сервер запущен и порт 7880/443 доступен.
- `LIVEKIT_API_KEY/SECRET` совпадают с `infra/livekit/livekit.yaml` на media-сервере.

### Откатить выкат

```bash
# 1. Откатить код
git log --oneline -10
git reset --hard <previous_commit>
# 2. Откатить БД из бэкапа
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists < backups/z_main_<TIMESTAMP>.dump
# 3. Поднять с откатанным кодом
docker compose up -d --build
```

---

## ⚠️ Особо опасные операции (требуют согласования владельца)

| Операция | Чем опасна | Защита |
|---|---|---|
| `prisma:push` + `--accept-data-loss` (внутри `migrate`-сервиса) | DROP `Transcript.rawIndexS3Url` — данные исчезнут | Данные перенесены в `TranscriptTrack` (Wave 5). Проверить отсутствие внешних потребителей S3-ключа. |
| Запуск `migrate` без AGE в postgres-образе | Падение с `extension "age" is not available` | Шаг 0.1 |
| `patch-mass-migrate-to-deepseek-pro.ts --update-existing` | Перезатирает primary провайдер у НЕ-admin-edited LlmTaskRoute | Сначала `--dry-run`. `editedByAdmin` защищён. |
| `seed-llm-default-primary-deepseek-pro.ts --update-existing` | Меняет primary у ВСЕХ taskType | `editedByAdmin` НЕ трогается. ТОЛЬКО для сброса ручных настроек. |
| `migrate-task-to-issue --apply` | Конвертирует legacy Task → Issue | Идемпотентен. Сначала dry-run. Task не удаляется. |
| `backfill-task-assignee-userid.ts` | В шапке файла «НЕ ЗАПУСКАТЬ НА ПРОДЕ без согласования» | Пропустить. |
| `patch-rollback-to-deepseek-flash.ts --update-existing` | Массовый откат 26 LlmTaskRoute pro→flash. Не плановая | Защищён флагом `--update-existing`; `editedByAdmin=true` не трогает. Сначала `--dry-run`. |
| `CLONE_V2_ENABLED=true` без `patch-migrate-clone-access.ts` | У всех пользователей пропадёт доступ к клонам | См. Шаг 6.10 + 6.11. Порядок: миграция грантов → сверка в `/admin/clones` → ENV → `force-recreate backend`. |

---

## 📂 Архив применённых

_(пусто — это первый накопительный документ; после первого выката переносим блок «Накоплено к выкату» сюда с датой)_

---

## 🔄 Правила поддержки файла

### Жёсткие правила формата команд

1. **Все команды — через `docker compose`.** Никаких `cd backend && bun run ...` на хосте. Z в проде целиком в контейнерах.
2. **Patch/seed/backfill/migrate-скрипты** — через `docker compose exec backend bun run scripts/<file>.ts` (backend уже запущен) ИЛИ `docker compose run --rm backend bun run scripts/<file>.ts` (одноразовый контейнер, если backend ещё не стартовал — например, в Шаге 3).
3. **Schema/postgres-init** — автоматически через `migrate`-сервис при `docker compose up`. Вручную: `docker compose run --rm backend bun run apply-postgres-init`.
4. **Бэкап БД** — только через `docker compose exec -T postgres pg_dump`, никаких локальных `pg_dump` к ip-сервера.
5. **ENV** — правка корневого `.env` + `docker compose up -d --force-recreate backend` (для `NEXT_PUBLIC_*` — `--build frontend`).
6. **Restart** — `docker compose up -d --build backend` (новый код) или `docker compose up -d --force-recreate backend` (новый ENV).

### Когда обновлять

После каждого `git push` в `dev`/`main`, если push содержит:

| Что изменилось | Куда писать в разделе «Накоплено к выкату» |
|---|---|
| `backend/prisma/schema.prisma` (новая модель / nullable→NOT NULL / drop / новый enum) | Шаг 4 |
| `backend/scripts/postgres-init.sql` (HNSW / GIN / partial unique / extension) | Шаг 5 |
| Новый файл `backend/scripts/patch-*.ts` | Шаг 6 |
| Новый файл `backend/scripts/seed-*.ts` | Шаг 7 |
| Новый файл `backend/scripts/backfill-*.ts` | Шаг 8 |
| Новый файл `backend/scripts/migrate-*.ts` | Шаг 9 |
| Новый файл `backend/scripts/setup-*.ts` | Шаг 10 |
| `backend/src/common/config/env.schema.ts` (новая ENV) | Шаг 1 |
| Новая модель worker / cron / BullMQ-очередь | Шаг 12 (smoke: добавить в grep по `bullmq_`) |
| Новый REST/Swagger раздел | Шаг 12 (smoke: добавить в список разделов Swagger) |
| Включение нового feature flag по умолчанию | Шаг 1 («Kill-switch'и») |
| Изменения в `docker-compose.yml` (новые сервисы / порты / depends_on) | Pre-flight 0 или Шаг 11 |
| Изменения в `Dockerfile` / `bunfig.toml` / `bun.lock` | Шаг 2 |

### Как обновлять

1. После `git push` запусти у себя:
   ```bash
   git show --stat HEAD
   git diff HEAD~N --name-only | grep -E '(prisma/schema|scripts/(seed|patch|migrate|backfill|setup|smoke)|postgres-init\.sql|env\.schema\.ts|Dockerfile|bunfig|docker-compose)'
   ```
2. Для каждого попавшего файла добавь строчку в соответствующий шаг — **обязательно с префиксом `docker compose exec backend …`** (или `run --rm backend …` для pre-up сценариев).
3. Если переименовываешь существующий скрипт или меняешь поведение — **обнови запись inline**, не дублируй.
4. Если запись становится неактуальной (фича откатили) — удали из «Накоплено к выкату».

### Когда переносить в архив

После триггера «выкат прошёл / прод обновили / выкатили» — целиком копируешь блок «🚨 Накоплено к выкату» в новый подраздел `## 📂 Архив применённых` → `### 2026-MM-DD — выкат N` с пометкой кто выкатил и какие были инциденты. Раздел «Накоплено к выкату» обнуляется (Pre-flight + пустой Шаг 1..12).

### Связь с рефлексией

При записи рефлексии в `second-brain/05_история/` всегда ссылайся на этот файл («prod-инструкция обновлена → см. `docs/operations/prod-deploy-log.md`»), вместо того чтобы дублировать команды в рефлексии.
