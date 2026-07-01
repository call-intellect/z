# Полный план функционального тестирования — ветка `work/2026-06-29`

- **Статус:** черновик на утверждение владельцем (не запускать до одобрения §0)
- **Дата:** 2026-07-01
- **Цель:** убедиться, что система работает так, как задумано последними итерациями, и её МОЖНО СПОКОЙНО ВЫКАТИТЬ В ПРОД — весь функционал корректен, всё достаётся: задачи и подзадачи заходят в трекер, память собирается, клоны строятся, AI-агент отвечает и правильно задаёт вопросы, календарь работает, дайджесты приходят, встречи/записи/отчёты работают.
- **Двойной scope:**
  1. **Акцент — 228 коммитов за 4 дня** (2026-06-27 … 2026-07-01): глубокий регресс изменённого — убедиться, что «да, вот это поменялось и реально заработало». Это §6.1 (A–M) + §7.
  2. **Параллельно — весь остальной функционал**, коммитами НЕ тронутый: встречи/9 типов/запись/ASR/AI-отчёт, календарь, трекер целиком, авторизация/RBAC/мультитенант, entitlements/биллинг, документы/регламенты, уведомления/боты, интеграции, админка, поиск, онбординг, поддержка, фидбек и т.д. — проверка готовности к проду (sanity + функционал). Это §6.2 (N1–N22).
- **Кому:** агенту-исполнителю тестирования (наполняет базу синтетикой → прогоняет конвейер → сверяет артефакты).
- **Метод:** синтетический ВХОД прогоняется через РЕАЛЬНЫЙ текущий конвейер (не через готовый граф), артефакты сверяются в БД / diag-скриптами / в кабинете / в /metrics.

> ⚠️ **Почему НЕ через «Демо: ТехноСтрим».** `seed-demo-workspace` (`onboarding/demo-data`) пишет граф/сущности напрямую через `prisma.*.create` с захардкоженным контентом — минуя ingest, воркеры, LLM, эмбеддинги. Его формы сущностей устарели (~50% кода с тех пор поменялось). Он проверяет только read-path кабинета на «идеальных» данных и НЕ ловит баги «из транскрипта родился граф не той формы». Для проверки нашего кода он непригоден. Используем `combat-harness` (реальный ingest). Demo-seed допустим лишь как отдельная негативная проверка изоляции demo-данных (см. §6-M), не как источник тестовой синтетики.

---

## §0. Решения владельца (подтверди перед стартом)

Три развилки материально меняют прогон. Рекомендации — первым.

**Р1. Где тестировать?**
- **(рекомендую) Локальный гибрид-стенд** (инфра в Docker на 127.0.0.1, backend+frontend нативно). Плюсы: можно инъектить через `combat-harness` (реальный конвейер), понижать пороги графа, оставлять данные (`KEEP_TENANT=1`), сносить/пересоздавать БД без риска. Минусы: нужно поднять backend (порт 3000 занят `open-webui`), нужен живой LLM (ключи в `backend/.env` есть). Единственная среда, где combat-harness вообще разрешён (`assertNotProd`).
- Прод-кабинет korateam.ru. Плюсы: «как у клиента». Минусы: инъекции только через `/chat` (прямой `POST /ingest` из браузера не работает), нельзя понижать пороги/оставлять мусор, combat-harness заблокирован prod-guard'ом. Годится только для финальной визуальной приёмки, не для наполнения.

**Р2. На какой БД?**
- **(рекомендую) Свежая пустая БД** (пересоздать локальную, прогнать всю цепочку миграций с нуля). Причина: миграции этой ветки (партиционирование `IdeaBlock`/`Entity` по tenantId, слой источника, дроп соц-слоя обещаний, дроп полей контролёра решений) писались БЕЗ локальной БД и на проде ещё не прогонялись — прогон с нуля заодно проверяет саму цепочку миграций (высокий риск, см. §10-Р). Тест на свежей БД = чистая дельта, легко считать «сколько создалось».
- Существующая локальная БД (данные прошлых сессий). Быстрее, но: `migrate deploy` может конфликтовать на партиционировании, а baseline-дельту считать труднее.

**Р3. Объём прогона — ПОДТВЕРЖДЁН владельцем: полный.**
- Цель — уверенность для выката в прод, поэтому проверяется ВЕСЬ функционал: акцент §6.1 (A–M, изменённое коммитами, глубокий регресс) + §7 (регресс-чеклист коммитов) + **параллельно §6.2 (N1–N22, весь остальной функционал)**. Коммиты = на что сделать акцент; остальное проверяется в тот же прогон.
- Остаётся лишь тактическая развилка глубины §6.2: полный проход каждого экрана/сценария (рекомендую) vs sanity-обход (быстрее). По умолчанию — полный.

---

## §0.5. СТЕНД ПОДГОТОВЛЕН (готов к прогону тестировщиком)

> Обновлено 2026-07-01. Локальный гибрид-стенд поднят и проверен ассистентом. Тестировщику НЕ нужно поднимать окружение — оно уже работает; сразу переходить к §3–§6.

**Что уже сделано и проверено (факты, не на словах):**
- ✅ **LLM жив** — `smoke-llm-providers`: deepseek-v4-flash/pro/chat отвечают. Извлечение будет работать на реальных вызовах.
- ✅ **Миграции 4 дней применены на populated БД** (репетиция прод-cut): `20260630020000_drop_decision_implementation_fields`, `20260630030000_add_intake_issue_checklist_json`, `20260701000000_drop_commitment_social_layer`. Подтверждено в БД: у `decisions` нет `implementationStatus/implementationCheckedAt`; у `IdeaBlock` нет `commitmentStatus/commitmentAskedAt/commitmentEscalatedAt`; таблицы `promise_network_snapshots` нет; `IntakeIssue.checklistJson` добавлена.
- ✅ **Индексы** `apply-postgres-init` (HNSW/GIN + trgm + AGE-граф `z_graph`) построены; **Prisma-клиент** сгенерён.
- ✅ **Прод-агрегатор** `apply-prod-deploy --mode update`: 204 шага OK (5 backfill FAIL — не критично, см. ниже). Засеяны все крутилки (21 целевая, `ai.kie.timeoutMs=180000`, утренняя сводка ×5), LLM-маршруты на deepseek-v4-pro, shipped-флаги включены.
- ✅ **Устранён дрейф локальной схемы**: не хватало 12 таблиц единого чата (`Conversation/ConversationMember/ConversationAccessLink/Message/MessageOutbox/MessageReport/Poll/PollOption/PollVote/PushToken/SupportTicket/UserBlock`) — досозданы в `public`. Финальный `prisma migrate diff` БД↔schema.prisma = **0 CREATE TABLE / 0 ADD COLUMN / 0 ADD CONSTRAINT**. Схема стенда соответствует коду.
- ✅ **Ключевые флаги** (AdminSetting, global): `knowledge.specialists_combined_enabled=true` (🔴 иначе задачи не создаются — combo единственный движок), `knowledge.router_v2_enabled=true`, `dayReport.enabled=true`, `tracker.morningDigest.enabled=true`, `probe.dialogEnabled=true`, `ai.kie.timeoutMs=180000`.
- ✅ **Аккаунты входа** (см. `.local-dev-accounts.md`): `admin@crossmark.ru` (super-admin) + `test@kora.local` (owner). Оба в БД.
- ✅ **Отладочные `[PIPE]`-логи** в 8 звеньях конвейера — встроены в существующий pino-логгер, остаются в проде. Спайн-вехи (ingest, block-ingest START/DONE, combo START/DONE, task-materializer, goals, clone-rebuild) на уровне **INFO** (видны в проде для мониторинга на реальных данных); per-block (block-distill verdict, router dispatch) — **debug**. `bun run typecheck` зелёный.
- ✅ **backend поднят** на :3000 (`bun src/main.ts` из `backend/`, `NODE_ENV=development`, `LOG_LEVEL=debug`): `/health`=ok, Swagger `/api/docs`=200, **0 ошибок при старте**, BullMQ-воркеры/cron in-process запущены, 557 AdminSetting hydrated, 187 LLM-маршрутов. **frontend** — на :3001. Логи стенда: `backend/stand.log` и `frontend/stand.log` (grep `'\[PIPE\]'` по backend-логу).
- ✅ **Дашборд «День компании v2» влит и подхвачен.** Код Ф1–Ф8 (коммиты `df237ab2`…`0d23551d`, рефлексия `9f27e1b8`) приехал в ветку уже во время подготовки стенда. Стенд догнан: применена миграция `20260701053438_idx_evidence_author_day` (индекс `IdeaBlockEvidence_tenantId_authorPersonId_sourceTimestamp_idx` подтверждён физически в БД), Prisma-клиент перегенерён, засеяны `operations.daily_digest.*`, LLM-маршрут дайджеста (deepseek-v4-pro→gpt-5.4-mini→kie/gemini) на месте. **backend + frontend перезапущены на свежем коде** — стенд полностью актуален ветке.
- ✅ **Сквозной e2e через реальный конвейер ПОДТВЕРЖДЁН.** Вброс синтетики (`smoke-pipeline-e2e`, KEEP_TENANT) → в backend-логе прошла полная `[PIPE]`-цепочка: `block-ingest START/DONE → block-distill (×26) → router dispatch (×13) → combo START → combo DONE`. В сохранённом синтетическом тенанте создано: **13 canonical-блоков, 3 решения, 2 идеи** (реальные LLM-вызовы, AGE-граф доступен). `task-materializer`/`goals`/`clone-rebuild` в этом smoke не возбудились — минимальный smoke-транскрипт («проект Альфа», 3 реплики) не содержал явных поручений/целей; на богатой синтетике §4 они сработают. Вывод: цепочка агентов запускается и отрабатывает, наблюдаемость через `[PIPE]` работает.

**Как управлять стендом:**
- Логи backend: файл фоновой задачи (или перезапустить в терминале `cd backend && bun src/main.ts`). Грепать цепочку: `grep '\[PIPE\]'` в логе — увидишь `ingest → block-ingest START/DONE → combo START/DONE → task-materializer/goals/clone-rebuild` по каждому источнику.
- Порт 3000 держал контейнер `open-webui` — он **остановлен** (`docker stop open-webui`); вернуть после тестов: `docker start open-webui`.
- Ручной триггер кронов (не ждать расписания): `POST /api/v1/admin/crons/:name/run` (super-admin) или `bun run scripts/diag-clone.ts run-cron <name>`. См. §5.
- Наполнение синтетикой: §3 (написать `seed-synthetic-company.ts` поверх combat-harness) + сценарий §4.

**Выводы для прод-выката (цель «чтобы в проде так же работало»):**
- 🟢 **Миграции безопасны на данных** — применились чисто на 495-табличной БД. На прод-cut `migrate deploy` применит те же 3 миграции.
- 🟠 **Проверить дрейф прод-схемы ДО/ПОСЛЕ cut.** Локально обнаружен дрейф (12 чат-таблиц были помечены applied, но DDL не легло — БД строилась через db push/baseline). Если прод-БД строилась похоже — часть таблиц может отсутствовать. **Рекомендация к cut:** на проде выполнить `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (read-only) и убедиться, что нет недостающих CREATE TABLE/ADD COLUMN (DROP INDEX/DROP COLUMN _search_tsv/_deploy_applied_step — игнорировать, это postgres-init/ledger).
- 🟠 **5 backfill FAIL в агрегаторе** (не блокеры схемы, backend стартует): `backfill-commitment-due-dates`, `backfill-subject-attribution-all-types`, `backfill-block-access`, `backfill-issuecomment-to-message`, `backfill-message-contentstripped` — падали на старых/отсутствовавших данных локальной БД. На проде их прогнать отдельно и проверить (особенно issuecomment-to-message и message-contentstripped — зависят от чат-таблиц).
- 🟢 **Логи в проде:** спайн-`[PIPE]` на INFO → видны по умолчанию; для полной цепочки (вкл. per-block) временно `LOG_LEVEL=debug`.

**Дневной дашборд «День компании v2» — ВЛИТ, проверяется в этом прогоне:**
- Код влит (Ф1–Ф8, архитектура+ТЗ — `plans/architecture/`/`plans/tz/` «День компании v2», рефлексия `second-brain/05_история/…день-компании-v2…`). Что нового в дневном: `buildDayPackage` (голос/сырьё/сигналы/конфликты/план-факт/вчера), промпт v2 письма COO (12 секций, имена, петля, взгляд, строгая JSON-схема), виджеты по прототипу (блокеры/риски-по-причине/идеи-кластеры), герой-only для owner, маршрут дайджеста deepseek-v4-pro→gpt→kie, крон 06:00→07:00 МСК (после сбора чек-инов), индекс `IdeaBlockEvidence(author,day)`, усиленная разметка `team_friction`. **Проверка — §6.1-J1 (verdict/letter/goalAlignment заполнены, письмо 12 секций, clamp) + §6.2-N10 (раскладка героя, дедуп блокеров, риски-по-причине, идеи-кластеры).**
- **Неделя/месяц** пока БЕЗ изменений — проверяются как есть (§6.1-J2/J3). Если дневной v2 заходит хорошо — тем же подходом раскатываем на неделю/месяц и тогда перепроверяем их отдельно.

---

## §1. Что изменилось за 4 дня (карта 12 тредов → что проверять)

Сгруппировано по фич-тредам. Детальная тест-матрица — в §6; регресс-риски — в §7.

| # | Тред (что менялось в коде) | Ключевое для теста |
|---|---|---|
| T0 | **Извлекающий слой combo** (block-ingest единый канало-агностичный агент) | Чат разбирается КАК встреча; few-shot реестр 57 signalType; скелет встречи→шапка (кореференции); нахлёст окон+gleaning+дедуп; хроносверка `sourceTimestamp`; граф-детектор конфликтов автор↔стороны. **Ядро** — от него зависит всё ниже. |
| T1 | **Единый движок задач** (combo→`tasks[]`→`TaskDraftMaterializer`) | Задачи рождаются из ЛЮБОГО канала одним движком; snesены старые пути (спайн 3-15 + `MeetingExtractActions`); subtasks→`IntakeIssue.checklistJson`→чек-лист при accept; дедуп-suggest. 🔴 **Если `specialistsCombinedEnabled=OFF` — задачи не создаются вообще** (фолбэка нет). |
| T2 | **Три класса идея/задача/решение + сквозное исполнение** | Разведение предложение/поручение/выбор; `Decision.impliesAction`→авто-задача; закрытие из разговора (`IssueProgressUpdate`); P0-фикс advisory-lock; `raw-event-recovery.cron`. |
| T3 | **Решения как память — снос надзора** | Удалён контролёр внедрения, «висящие решения», throughput/stalled эндпоинты, 5 метрик, 2 крутилки; DROP 2 колонок `Decision`. Решения ДОЛЖНЫ по-прежнему извлекаться; бейдж «необратимое». |
| T4 | **Снос соц-слоя обещаний** | Удалены promise-cascade, promise-network, reliability, «Мои обещания»; DROP 3 колонок `IdeaBlock` + таблицы. `commitment` как факт (dueDate/author/recipient) ЖИВ. |
| T5 | **Движок целей — консолидация (Ф1–Ф9)** | Все goal/ops-кроны на Europe/Moscow; продюсер движения; KNN-темы ручным целям; суточная пересборка иерархии (арбитр); каскад статуса; строже промпт (outcome≠output); 21 крутилка; вектор людей без обещаний. |
| T6 | **Клоны — Person↔Entity + авторство** | lazy-резолв `Person.entityId` в rebuild клона + backfill; single-author fallback в attributeSubject (источники без таймкодов). |
| T7 | **Слой источника + маршрутизатор поиска** | Партиц. `IdeaBlock`/`Entity`; `SourceEpisode/Participant/Entity`; роутер 5 классов запроса (list/topic/temporal/overview/fact) + both-ways; документы как объект; contextual-header v2; rerank. Движок AI-чата компании. |
| T8 | **Единый чат Коры / messaging** | Ядро `Conversation/Message` (seq/outbox/AES/dedup); внутр+внешн чат, work_chat, support, push, huddles/опросы; мосты в граф (`message-bridge`, `chat-ingest`); всё сведено на движок Мастера (concierge). |
| T9 | **Дайджесты День/Неделя/Месяц/Утро + DayReport** | 4 ритма поверх графа; verdict/letter/goalAlignment JSONB; DayReport из графа (4 ведра), `DailyCheckIn` +notDone/ideas/completeness; кроны на МСК; навигатор периодов/архив. |
| T10 | **Probe/clarify + уточняющие вопросы + method-capture** | Многоходовый диалог (`ProbeDialogState`); probe адресуется постановщику; probe про срок; «расскажи как решал» при закрытии задачи→reasoning-знание; снос probe-инспекторов решений/обещаний. |
| T11 | **chat-v2 dataClass-routing / KIE / bitrix TZ** | deepseek/openai подняты до `maxDataClass=private` (чинит зависание помощника на приватных данных); таймаут KIE в крутилку; chat-v2 сид на deepseek-v4-pro; bitrix-sync на 00:00 МСК. |

---

## §2. Предпосылки локального запуска (чек-лист)

Топология — гибрид (`docs/operations/local-dev-setup.md`): инфра в Docker, backend+frontend нативно через Bun.

Готово (проверено на машине 2026-07-01):
- [x] Ветка `work/2026-06-29`.
- [x] Docker-инфра поднята: `z-dev-postgres` (127.0.0.1:55435), `z-dev-redis` (56381), `z-dev-minio` (59000/59001). gepa не нужен.
- [x] `backend/.env` (локальный, инфра на 127.0.0.1) + `/.env` (ПРОД — не трогать) существуют.
- [x] `.local-dev-accounts.md` — креды тест-юзера (`test@kora.local` / `Korateam2026`, owner двух орг) и супер-админа (`admin@crossmark.ru` / `Korateam2026`).
- [x] Frontend уже на :3001.
- [x] LLM-ключи в `backend/.env`: `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `KIE_API_KEY`, `VOX_API_TOKEN`, `PROXY_BASE_URL`.

Требует действия ПЕРЕД прогоном:
- [ ] **Порт 3000** держит контейнер `open-webui` (`0.0.0.0:3000->8080`). Разрешить: `docker stop open-webui` (вернуть потом `docker start open-webui`). Альтернатива: `PORT=3010` в `backend/.env` + синхронно `NEXT_PUBLIC_API_BASE_URL`/`NEXT_PUBLIC_BACKEND_URL` в `frontend/.env.local`.
- [ ] **psql в PATH** (для агрегатора сидов): `brew install libpq && export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`.
- [ ] **Схема БД** (из `backend/`): `bunx prisma migrate deploy` → `bun run apply-postgres-init` (HNSW+GIN, вкл. новые Theme/SourceEpisode/trgm) → `bun run prisma:generate`. При Р2=свежая БД — сначала пересоздать БД (drop/create) для чистого прогона миграций.
- [ ] **Сиды** (одной командой, всё в STEPS агрегатора): `bun scripts/apply-prod-deploy.ts --mode bootstrap --continue-on-fail --no-fail-on-steps`. Покрывает `seed-admin-settings`, `seed-llm-*`, `seed-global-channels`, новые крутилки целей/kie-timeout/morning-digest и т.д. Идемпотентно.
- [ ] **Запуск backend** (из корня, лаунчер берёт `backend/.env`): `bun run dev:local`. `NODE_ENV=development` обязателен (иначе secure-кука по http не сохраняется → логин сбрасывается). Осиротевшие процессы: `lsof -ti tcp:3000 tcp:3001 | xargs kill -9`.
- [ ] **Smoke живости:** `curl :3000/health` → `{"status":"ok"}`; `:3000/api/docs` 200; `:3001` 200.
- [ ] **🔴 Проверить что LLM жив ДО прогона извлечения** (иначе извлечение не тестируется — конвейер создаст `RawEvent`+draft-блоки, но block-distill/специалисты упадут `llm_error`, задачи/решения/идеи НЕ родятся): `cd backend && bun run scripts/agent-replay.ts --task decision-extract --user <фикстура>` (должен напечатать реальный вход/выход/цену) ИЛИ `bun run scripts/smoke-llm-providers.ts --only=deepseek,proxy`.
- [ ] **🔴 Проверить рубильник задач:** `bun run scripts/diag-flags.ts <orgId>` — `knowledge.specialistsCombinedEnabled` должен быть ON. Иначе combo не эмитит `tasks[]` и задачи не создаются.

Известные macOS-грабли: все инфра-URL через `127.0.0.1` (не `localhost` → IPv6); НЕ `bun run dev` из корня (потащит прод-`.env`); backend без `--watch` на arm64 (ломает `as const`) — после правок перезапускать.

---

## §3. Механизм наполнения базы

### 3.1. Основной инструмент — `combat-harness` (реальный конвейер)

`backend/scripts/_lib/combat-harness.ts` + образец `smoke-pipeline-e2e.ts`. Пишет `RawEvent` напрямую в БД + ставит job в очередь `core.raw-events` — **точно как прод `IngestService`**, но минуя REST/квоты/S3. Всё что ниже `RawEvent` (segment-builder → block-ingest combo → сущности → граф → проекции → клоны → дайджесты) тестируется по-настоящему. Выше `RawEvent` (парсинг Bitrix/Chatbox API, вебхуки Telegram, ASR) — этим путём НЕ тестируется (для адаптеров — Способ C, §3.5).

Ключевые функции:
- `bootstrapTenant(prisma)` → `{tag, userId, orgId(=tenantId), personId}` (User+Org+Membership+**один** Person-owner).
- `upsertSource(prisma,{tenantId,type,name})` → `Source` нужного `SourceType` (ленивый upsert по `tenantId_type_name`).
- `injectRawEventDirect(infra,{tenantId,sourceId,sourceType,sourceExternalId,occurredAt,payload,dataClass?})` → `RawEvent` + job. Идемпотентность: `idempotencyKey=sha256(sourceId:sourceExternalId||checksum:occurredAtIso)` — повтор с тем же ключом ничего не создаёт.
- `pollUntil` + `loadCounts(prisma,tenantId)` (22 счётчика: rawEvent/processed, ideaBlock/canonical, entity, links, theme, decision/insight/idea/process/regulation/…, commitment, card, goal, intakeIssue) + `renderMatrix`/`computeExitCode` + `probeAge` (граф AGE).
- `teardownTenant` — зачистка по FK-порядку (не запускать при `KEEP_TENANT=1`).

ENV-рычаги: `MODE=direct` (осн.), `VERIFY_TIMEOUT_MS` (увеличить под объём), `KEEP_TENANT=1` (оставить данные для ручного QA), `LINKER_MIN_BLOCKS` (понизить порог линкера), `GRAPH_AGE_ENABLED=true`, `ALLOW_PROD=1` (снять prod-guard — на локали не нужно).

### 3.2. Что дописать — `backend/scripts/seed-synthetic-company.ts` (новый, поверх combat-harness)

Из коробки `smoke-pipeline-e2e` = 1 сотрудник / 1 день / 4 канала. Нужен скрипт под сценарий §4. Строительные блоки готовы, дописывается оркестрация:

1. `bootstrapTenant(prisma)` → `orgId`, owner-Person.
2. **N сотрудников:** `prisma.person.create({tenantId, name, relationship:'employee', ...})` × 4 (+ опц. `User`+`Membership`, если сотруднику нужен вход). Их `name` → `turn.speaker`, `person.id` → `turn.authorPersonId`.
3. **Клиенты:** `Person` c `relationship='customer'` (или в turns клиента `authorPersonId=null` + `messageExternalId`).
4. **Источники** (`upsertSource`, по одному на канал): `meeting`/«Встречи», `bitrix`/«Bitrix24», `chatbox`/«ChatBox», `conversational`/«Каналы» (telegram/free-note), `daily_checkin`/«Чек-ины», `external`/«Документы».
5. **Несколько дней:** `occurredAt = new Date(base - d*86400000)`; уникальный `sourceExternalId` на эпизод (`meet:day-4:planning`), иначе идемпотентность схлопнет.
6. **Встречи** (шаблон `injectMeetingDirect`, `smoke-pipeline-e2e.ts:138`): свой `meetingId` (pseudoUlid), `type ∈ MeetingType` (team/standup/sales/custdev/project/retrospective/…), payload `{meetingId,type,title,participants,transcript:{turns:[{speaker,text,startSec,endSec,authorPersonId,speakerParticipantId}]}}`. Внутренняя = только сотрудники; клиентская = + клиент-спикер (`authorPersonId=null`). Для реального `Meeting`/`Transcript`+FSM — создать строки и звать `MeetingIngestAdapter.ingestMeeting(id)` (Способ C).
7. **Bitrix:** `injectRawEventDirect` `sourceType:'bitrix'`, `dataClass:'sensitive'`, payload `{kind:'bitrix_dialog_session', transcript:{turns:[…]}}`, `sourceExternalId`=id диалога-дня (форма — `bitrix-ingest.service.ts:269`).
8. **ChatBox:** `sourceType:'chatbox'`, `dataClass:'sensitive'`, payload `{kind:'chatbox_chat_session', customer, transcript:{turns}}`, авторы клиента `authorPersonId=null` (`chatbox-ingest.service.ts:333`).
9. **Telegram/канал/free-note:** `sourceType:'conversational'`, payload `{kind:'free_note', userId, text}` ИЛИ `{kind:'chat_message', text}` (segment-builder распознаёт только чистый `text`).
10. **daily_checkin:** `sourceType:'daily_checkin'` — сверить точную форму у `CheckinIngestService` перед использованием.
11. **Объём:** чтобы возбудились `IdeaBlockLink` и `Theme`, нужно ≥ `knowledge.linkerMinBlocks` canonical-блоков (деф. 50). Либо дать десятки содержательных эпизодов, либо понизить `LINKER_MIN_BLOCKS`/`THEME_CLUSTERING_MIN_BLOCKS`/`THEME_CLUSTER_MIN_SIZE`/`ENTITY_GRAPH_MIN_COMENTIONS` на стенде (зафиксировав исходные значения). На коротком объёме эти узлы честно останутся SKIP — это порог, не баг.
12. Запуск с `KEEP_TENANT=1`; пометить синтетику (`externalSource='qa-test'`, префикс `[QA-test]` в тайтлах) для чистки.

### 3.3. Формы payload, которые понимает конвейер

`SegmentBuilderService.buildSegments` распознаёт (иначе `buildFallback` = шум, избегать):

| Форма payload | Ветка | Каналы |
|---|---|---|
| `{transcript:{turns:[{speaker,text,startSec,endSec,authorPersonId?,messageExternalId?}]}}` | `tryAsMeeting` | **meeting, chatbox, bitrix** (одинаковая turn-структура!) |
| `{fullText:"…"}` | `tryGetFullText` | tracker_event |
| `{kind:'free_note',userId,text}` | `tryGetFreeNoteText` | conversational |
| `{kind:'chat_message',text}` | `tryGetChatMessageText` | чат-сообщение / мост |
| `{kind:'meeting_report',reportFacts[],reportSummaryMarkdown}` | `tryGetReportSegments` | meeting_report |
| `{kind:'notification_response',questionText,response}` | `tryGetNotificationResponseText` | ответ на probe |

`SourceType`: `meeting, chat, phone_call, bot, email, web_form, external, conversational, tracker_event, chatbox, daily_checkin, meeting_report, bitrix` (нет отдельных `document`/`telegram` — документы под `external`, telegram под `bot`/`conversational`). `DataClass`: `public/internal/sensitive/private`.

### 3.4. Готовые фикстуры (переиспользовать)

`plans/analysis/qa-extraction-test/fixtures.md` — 3 реалистичных текста с размеченными ожиданиями (грузить как есть, разметку в транскрипт НЕ вставлять):
- **Т1** командная планёрка (~13к): решение retention, идеи, 3 задачи, блокер, риск, сущности + мусор-ловушки.
- **Т2** переговоры с клиентом «Логистик Плюс» (~12к): решение-ловушка «пилот -30%», задачи, факт-ловушки.
- **Т3** чат-день (100+ сообщений): кросс-канальный дедуп, задача vs идея, сигналы исполнения → `TaskClosureCandidate(pending)`.

Дописать под новое (не покрыто): 4-й текст на **цели** (outcome vs output — Ф6), 5-й на **method-capture** (закрытие задачи → «как решал»), реплики-**обещания** (commitment без соц-слоя), приватный запрос для **chat-v2 dataClass=private**. Формат — таблица «Ожидаем / Не должно появиться».

### 3.5. Способы инъекции — итог

- **Способ A (осн.)** — `injectRawEventDirect` (combat-harness): матрица канал×узел, реальный конвейер ниже RawEvent.
- **Способ B (HTTP)** — проверка реальных guard/квот: `POST /api/v1/ingest` (Bearer `zik_…`/`INGEST_INTERNAL_TOKEN`), `POST /ingest/dump`, `POST /conversational/notifications/free-note`, `POST /ingest/telegram/:sourceId` (заголовок `x-telegram-bot-api-secret-token`).
- **Способ C (доменные мосты)** — тест адаптеров/FSM: `Meeting`+`Transcript`→`MeetingIngestAdapter.ingestMeeting`; `Conversation(feedsGraph=true)`+`Message`→`chatIngestQueue.enqueue` (нужен `CHAT_INGEST_ENABLED=true`); `BitrixDialogSession(endedAt≠null)`→`BitrixIngestService.ingestSession`; `ChatboxChatSession(endedAt≠null)`→`ChatboxIngestService.ingestSession`; `Document(status='uploaded')`→очередь `core.document-uploaded`; `MessageBridgeService.ingestChatMessage` (нужен `MESSAGE_BRIDGE_ENABLED=true`).
- **Из кабинета (прод-приёмка)** — только через `/chat`-ассистента (он сам зовёт ingest); прямой `POST /ingest` из браузера не работает.

---

## §4. Синтетический сценарий «Компания Стрела» (5 дней)

5 сотрудников + 2 клиента, 5 рабочих дней (день −4 пн … день 0 пт), параллельные встречи, Bitrix, chatbox, telegram, чек-ины, документ.

**Люди:** Сергей (владелец/CEO, owner-User), Анна (product), Михаил (разработка), Дарья (аккаунт-менеджер), Елена (маркетинг). **Клиенты:** «Логистик Плюс» (контакт Пётр), «Ромашка» (контакт Ольга).

| День | Канал | Контент (кратко) | Что должно родиться (проверка) |
|---|---|---|---|
| −4 пн | **meeting** team «Планёрка недели» (все 5) | цели квартала (outcome), 3 поручения с исполнителями/сроком, решение (обратимое), идея | Goal(measurable), 3×IntakeIssue, Decision(impliesAction), Idea; SourceEpisode(meeting); клоны участников |
| −4 пн | **bitrix** Дарья↔Логистик Плюс | обсуждение пилота, обещание «пришлю КП в среду» | IdeaBlock signalType=commitment (dueDate/author/recipient, БЕЗ commitmentStatus); Entity «Логистик Плюс» |
| −3 вт | **meeting** standup (команда) | статусы, блокер «Битрикс 429» | IdeaBlock blocker; day-report ведро blocker |
| −3 вт | **meeting** sales/custdev с Логистик Плюс (Дарья+Сергей+Пётр) | решение-ловушка «пилот −30% → контракт» (это Decision, НЕ задача «сделать 30%») | Decision (не Task); клиент-Entity; проверка «поручение≠решение» |
| −3 вт | **chatbox** Ромашка↔Дарья | клиент жалуется, задача-поручение | Customer-Entity (Ромашка); IntakeIssue из чата (channel=chatbox) |
| −2 ср | **conversational**/telegram канал команды | обсуждение задач, идея vs задача из одного контекста, обещание | Idea + IntakeIssue (разведены); commitment; кросс-дедуп с Т1 (задача не раздваивается) |
| −2 ср | **bitrix** CRM-дайджест дня | контакты/сделки | bitrix_crm_digest RawEvent переварен |
| −1 чт | **meeting** project review | прогресс по цели; задача завершена («база готова, отправил») | сигнал исполнения → TaskClosureCandidate(pending); method-capture probe исполнителю |
| −1 чт | **daily_checkin** сотрудники | планы утром / факты вечером + «не успел X» + идея | DailyCheckIn notDone/ideas/reportCompleteness; DayReport 4 ведра |
| 0 пт | **meeting** retrospective | что улучшить, решение | Decision; Insight (pain/risk) |
| 0 пт | **external** документ-регламент | загрузка регламента | Document→document-summarize→SourceEpisode(document); Regulation с scope роли+owner |
| 0 пт | (после наполнения) | — | Утренняя сводка задач; День/Неделя-дайджест; AI-чат отвечает на вопросы по всем каналам |

Сценарий покрывает: параллельные встречи (внутр+клиент), Bitrix, chatbox, telegram, чек-ины, документ; несколько сотрудников; несколько дней; кросс-канальный дедуп; полный жизненный цикл задачи (рождение→дубль→сигнал исполнения→подтверждение→закрыто).

---

## §5. Как прогнать асинхронный конвейер без ожидания кронов

🔴 **Ключевой факт:** синхронен только `RawEvent`. Всё дальше — отложенные BullMQ-джобы (сек–мин дебаунса) ЛИБО @Cron (часы/сутки). После ingest сразу видны `IdeaBlock`/typed-`Entity`; `Theme`/граф-связи/цели/клоны/дашборды — только после ручного триггера крона или ожидания.

| Артефакт | Появляется | Триггер для теста |
|---|---|---|
| RawEvent | сразу | — |
| IdeaBlock+Evidence+Entity, SourceEpisode, Idea(direct) | после `core.raw-events` (сек) | `pollUntil` |
| IdeaBlock canonical/merged | после `core.block-distill` (дебаунс ~30с) | ждать |
| Decision, Idea(3-6), Goal, IntakeIssue, регуляции | после `core.specialist-routing` | ждать |
| IdeaBlockLink | block-linker, ТОЛЬКО при ≥`linkerMinBlocks` | объём или понизить порог |
| EntityLink, дедуп Entity | @Cron 5мин/час | **triggerNow** `entity-resolver`, `entity-graph-builder` |
| Theme, ThemeMember | @Cron :15/:35 | **triggerNow** `theme-clusterer`, `theme-summarize` |
| Цели: иерархия/линки/движение | @Cron суточно/30мин МСК | **triggerNow** `goal-hierarchy-rebuild`, `goal-task-linker`, `goal-theme-linker`, `strategic-alignment`; `POST /goals/:id/recompute` |
| Клоны (KnowledgeProfile/RoleProfile/Skill) | @Cron 4–6ч + очереди | **triggerNow** `knowledge-clone-rebuild`; `POST /role-profiles/:roleId/rebuild`; `POST /clones/:roleId/force-new-version` |
| День/Неделя/Месяц/Утро дайджест, DayReport | @Cron ночь/неделя МСК | **triggerNow** соответствующих кронов ИЛИ `POST /dashboard/operations/{daily,weekly,monthly}-digest/generate` |

Механика ручного триггера:
- `POST /api/v1/admin/crons/:name/run` (`CronManagerService.triggerNow`) — дёргает любой @Cron. Имена — `GET /api/v1/admin/crons` или `bun run scripts/diag-clone.ts list-crons`; история — `GET /api/v1/admin/crons/:name/history`.
- `bun run scripts/diag-clone.ts run-cron <name> [orgId]` — то же из скрипта.
- Перепрогон существующего RawEvent (после правки промпта): `POST /api/v1/admin/.../raw-events/:id/reprocess`.
- Застрявший `RawEvent(processingStatus='received')` подхватит `raw-event-recovery.cron` (`*/15`), draft-блоки без distill — `block-distill-reconcile.cron` (`*/30мин`).

**Рекомендуемый порядок прогона:** ingest всей синтетики §4 → `pollUntil` (IdeaBlock/Entity) → ждать canonical → проверить специалистов (Decision/Idea/Goal/IntakeIssue) → triggerNow entity-resolver+entity-graph-builder → triggerNow theme-clusterer(+summarize) → triggerNow goal-* + recompute → rebuild клонов → generate дайджестов + triggerNow day-report-collector + morning-tasks-digest → визуальная приёмка в кабинете.

---

## §6.1. Тест-матрица — АКЦЕНТ на изменённом коммитами (A–M)

Формат строки: **вход → триггер → проверка (diag/psql/UI/metrics) → pass-критерий**. 🔴 = критично для 4-дневных изменений.

### A. Ingest, идемпотентность, каналы (T0, T8)
- **A1** Вброс `RawEvent` по каждому из 6 каналов (§4) → `pollUntil`/`loadCounts` → `smoke-pipeline-e2e` матрица канал×узел. **Pass:** `rawEventProcessed==rawEvent`, `ideaBlock>0`, для chatbox/bitrix блоки создаются (не только meeting).
- **A2** 🔴 Идемпотентность: повторный вброс с тем же `sourceExternalId`+`occurredAt` → `idempotent:true`, число RawEvent не растёт (`smoke-ingest-fase1`).
- **A3** Гейты: `feedsGraph=false`/`*_ENABLED=false` → RawEvent не создан.
- **A4** Мультитенант: чужой `tenantId` для Source → `source_tenant_mismatch`.

### B. Извлечение combo — классы idea/task/decision/goal (T0, T2)
- **B1** 🔴 Чат разбирается КАК встреча: chatbox/bitrix/telegram RawEvent → появляются Decision/Idea/Insight/Regulation (не только из встреч). **Проверка:** `diag.ts graph --meeting`/psql по signalType; `diag-day-report-recall`.
- **B2** 🔴 «предложение → idea, поручение → task, выбор → decision»: фикстура Т1/Т2 + `diag-idea-classifier-test`, `diag-decision-classifier-test` (нужен `DEEPSEEK_API_KEY`). **Pass:** «пилот −30%» = Decision, не Task; «пока не завожу» = ни то ни другое; backoff = idea+commitment без decision.
- **B3** few-shot 57 signalType + страж enum↔реестр: `bunx vitest run` спека `signal-type-registry`. **Pass:** нет пропусков/лишних типов.
- **B4** Скелет встречи→шапка (кореференции): длинная встреча (>skeletonMinSegments) → `kc_meeting_skeleton_total{outcome}` в /metrics; кореференции («он/этот проект») разрешаются.
- **B5** Нахлёст окон+gleaning+дедуп: встреча > windowSize → `kc_block_overlap_dedup_total`, `kc_block_gleaning_rounds_total` растут; блоки на стыке не дублируются.
- **B6** Граф-детектор конфликтов автор↔стороны: две противоречащие реплики разных авторов → `EntityLink type=conflicted_with` (`diag-conflicts <orgId>`).
- **B7** Хроносверка `sourceTimestamp`: более поздний противоречащий факт supersedes ранний.

### C. Единый движок задач (T1)
- **C1** 🔴 Задачи из ЛЮБОГО канала: встреча/чат/telegram с поручением → `IntakeIssue` (status=pending, `externalId` начинается `mat_`). **Проверка:** psql `IntakeIssue`; `/metrics` `task_draft_materialized_total{channel,status}`; `ai_meeting_actions_extracted_total` ОТСУТСТВУЕТ (старый путь снесён).
- **C2** 🔴 Отсутствие двойного создания: `diag-task-issue-overlap` — нет дублей Task/Issue от снесённых путей. **Pass:** задача создаётся РОВНО одним движком (combo).
- **C3** Subtasks→checklist: поручение с шагами одного автора → `IntakeIssue.checklistJson` заполнен; после accept (PATCH triage decision=accept) → реальные `Checklist`+`ChecklistItem`. Проверить ОБА пути accept (intake.service + auto-triage.worker).
- **C4** Дедуп-suggest: та же задача из Т1 и Т3 → `suggestedDuplicateOfIssueId` (без авто-merge).
- **C5** 🔴 Гейт качества: поручение без исполнителя И без срока → падает в intake с priority=low (не теряется), не создаёт полноценную задачу.

### D. Решения как память — снос надзора (T3)
- **D1** 🔴 Decision по-прежнему извлекается: строка в `decisions` с reversibility (`diag-decision-classifier-test`).
- **D2** DROP колонок: `\d decisions` в psql — нет `implementationStatus`/`implementationCheckedAt`.
- **D3** Удалённые эндпоинты → 404: `GET /operations/.../decisions/throughput` и `/decisions/stalled` (Swagger `/api/docs` их не содержит).
- **D4** `/metrics` не содержит `decision_stalled_total`/`decision_throughput_percent`/`decision_auto_implemented_total`.
- **D5** Дашборд директора отдаёт 6 KPI (не 7), нет «висящих решений»; дневной/недельный дайджест без блоков решений; месячный «что решить собственнику» СОХРАНЁН.
- **D6** Карточка решения `/decisions`: type-1 → бейдж «необратимое»; type-2/null → нет.

### E. Снос соц-слоя обещаний (T4)
- **E1** 🔴 commitment как факт жив: обещание в реплике → IdeaBlock signalType=commitment с `commitmentDueDate/Author/Recipient`, БЕЗ `commitmentStatus` (колонки нет).
- **E2** DROP: `\d ideablocks` — нет `commitmentStatus/commitmentAskedAt/commitmentEscalatedAt`; таблицы `promise_network_snapshots` нет.
- **E3** Удалённые эндпоинты → 404: `/me/promises`, `/dashboard/operations/promise-network`, `open-commitments`, `personal-relations/commitments`.
- **E4** Кроны не падают без обещаний: triggerNow `burnout-risk-detector`, `engagement-scorer`, `forecaster`, `goal-vector-tracker`, `hr-recommender` — без ошибок, не читают commitmentStatus.
- **E5** `backfill-commitment-due-dates.ts` — идемпотентен, проставляет dueDate=createdAt+5 раб.дней.
- **E6** Дашборд директора / личный бриф / дайджест — без секций обещаний, не 500.

### F. Движок целей (T5)
- **F1** 🔴 Все goal/ops-кроны на Europe/Moscow: проверить `timeZone` в @Cron (9 файлов); `strategic-alignment.cron` = `0 2 * * *` МСК; продюсер движения отрабатывает ДО компаса (06:00).
- **F2** Вектор людей без обещаний: `GoalContribution.signalsJson` содержит только kind ∈ {idea, issue_closed, goal_work}; метки на execution-dashboard без «обязательств»; `commitment_author_coverage_ratio` исчезла из /metrics.
- **F3** KNN-темы ручным целям: создать ручную цель без sourceBlockIds (нужен `Goal.embedding` — прогнать `backfill-goal-embeddings`) → triggerNow `goal-theme-linker` → `GoalTheme` со `source='ai'`.
- **F4** Суточная пересборка иерархии: triggerNow `goal-hierarchy-rebuild` → часть целей меняет `parentGoalId` (только non-manual, child_of, conf≥0.7, без циклов); Redis-lock `goal-hierarchy-rebuild:lock`.
- **F5** Каскад статуса: `PATCH /goals/:id` status=achieved (все siblings achieved) → родитель→achieved вверх; abandoned родителя → дети `cascadeMissed=true`. **Проверка:** `goal.status_changed` → `GoalCascadeHandler`.
- **F6** Строже промпт (outcome≠output): snapshot-тест `goal-extract.snapshot.spec`; «запустить кампанию»→isGoal=false, «50 кастдев-встреч»→isGoal=true.
- **F7** Фронт `/goals` + `/goals/:id`: блок «Прогресс по задачам» (из `/goals/:id/alignment-snapshot`); единый бейдж movementVerdict в списке и дереве; виджетов StrategicAlignment/GoalVectorVerdict нет.
- **F8** 21 крутилка: psql `AdminSetting` (category goals/tracker) — 21 новая строка; `diag-flags`.

### G. Клоны сотрудников (T6, T5)
- **G1** 🔴 lazy Person→Entity: `Person(entityId=NULL)` + блоки на него → прямой enqueue `KNOWLEDGE_CLONE_REBUILD` (штатный cron фильтрует entityId≠null!) → в БД проставлены `entityId` И `entityTenantId`; `/metrics` `knowledge_clone_person_no_entity_total` вырос; KnowledgeProfile собрался.
- **G2** single-author fallback: источник без таймкодов (chat/telegram, startMs=0), event-автор пуст, все сегменты одного автора → `kc_subject_attribution_total{via="author_fallback"}`; два автора → `{via="none"}`.
- **G3** Backfill: `backfill-knowledge-clone-person-entity.ts` dry-run → `--apply` (идемпотентно).
- **G4** Собранный клон: `diag-clone.ts skill-person <personId>`/`list-clones`; UI `/clones`,`/persons`,`/roles`. **Pass:** профиль знаний/навыков непустой у сотрудников из §4.

### H. Слой источника + AI-чат компании / роутер (T7, T11)
- **H1** SourceEpisode/Participant/Entity заполняются при ingest: psql после встречи/документа — `SourceEpisode` (kind meeting/document), `SourceParticipant`, `SourceEntity`.
- **H2** 🔴 Роутер 5 классов: задать в AI-чате вопросы — list («какие встречи с Логистик Плюс»), temporal («итоги за неделю»), overview («что по продажам»), fact («что решили по пилоту»), topic («обсуждали retention»). `/metrics` `z_router_query_class_total{class}`, `z_router_both_ways_total`.
- **H3** both-ways инвариант: если структурный маршрут пуст, ответ = семантике (не пустой).
- **H4** Уточняющий вопрос: запрос-список с именем, дающим ≥2 равных кандидата → clarification (без synthesis).
- **H5** Документы как объект: загрузка документа → AI-title+summary (`document-summarize`), эпизод-узел.
- **H6** 🔴 dataClass=private не зависает: приватный запрос по сотруднику → chat-v2 отвечает (не `NoEligibleProviderError`), `modelUsed` начинается с `deepseek:`. Регресс: sensitive-задачи теперь тоже eligible для deepseek/openai — проверить `diag-llm-routes chat-v2 concierge-respond`.
- **H7** KIE-таймаут: `ai.kie.timeoutMs=180000` в AdminSetting (`diag-flags`); chat-v2 не рвётся раньше синтеза.
- **H8** answerKind/episodes в ответе chat-v2; `diag-concierge --user <email>` — нет partial/abstain/сырого JSON.

### I. Единый чат Коры / messaging (T8)
- **I1** Внутренний чат: `POST /conversations` (dm/group/channel) → `POST /conversations/:id/messages` дважды с одним `clientMessageId` → dedup (тот же messageId, seq не растёт); параллельные отправки → gap-free seq.
- **I2** WS: `conversation.join` → второй клиент шлёт → `message.new`; офлайн-пуш БЕЗ тела (ФЗ-41 `assertNoExternalBody`).
- **I3** work_chat: комментарий к Issue через tracker → `Message` в связанном `Conversation`.
- **I4** Внешний чат: `startExternalConversation` → `POST /external/access` (cookie) → guest видит только external/normal (не internal); превышение rate-limit → 429; register OTP.
- **I5** Мост в граф: `backfill-chat-bridge-telegram.ts` ИЛИ Message в conversation `feedsGraph=true` (`CHAT_INGEST_ENABLED=true`) → RawEvent `msg:<id>` → IdeaBlock (ветка chat_message).
- **I6** Закрытие встречи: `Meeting`→ai_ready → системное `Message` в work_chat связанных Issue (идемпотентно).
- **I7** AI-надстройки: `/conversations/:id/whats-new` («Что пропустил»), `/ask`, `/messages/:id/to-task|to-decision`.
- **I8** Poll→decision: createPoll→vote→closePoll → IdeaBlock signalType=decision.
- **I9** Фронт-Мастер (Playwright): `/chat` отвечает движком Мастера; Cmd+K; `/c/[token]` — лента клиента. Нет мёртвых legacy-сёрфейсов (`/assistant`,`/chat-v2` редиректят).
- **I10** Boot: backend стартует (health 200, все эндпоинты в Swagger) — регресс RedisIoAdapter (6f700b68).

### J. Дайджесты День/Неделя/Месяц/Утро + DayReport (T9)
- **J1** 🔴 День компании: `POST /daily-digest/generate` (или triggerNow) → в `daily_operations_digests` заполнены `verdictJson/letterJson/goalAlignmentDayJson`; UI `/dashboard` герой. clamp: overall не зелёный при client-risk.
- **J2** Неделя: 5 дневных снапшотов пн–пт → `POST /weekly-digest/generate` → verdict/letter/dayTrend; `GET /weekly-digest/latest`; UI `/dashboard?rhythm=week`. clamp: план/факт<50%→execution не ok.
- **J3** Месяц: 4 недельных → `POST /monthly-digest/generate` → `monthly_operations_digests`; UI `/month`; навигатор периодов/архив (`available-periods?limit=`).
- **J4** 🔴 DayReport из графа: triggerNow `day-report-collector` → `DailyCheckIn.notDoneJson/ideasJson/reportCompleteness`; 4 ведра (plan/done/blocker/notDone/idea) по человек×день; `diag-day-report-recall --tenant=<id>` — % покрытия. `/metrics` `day_report_collected_total`, `day_report_block_dropped_no_person_total`.
- **J5** 🔴 Утренняя сводка задач: открытые Issue + triggerNow `morning-tasks-digest` (или cron.run с now в hourMsk) → контракт `tasks.daily_open`, рендер в telegram/max/email; per-user дедуп по Notification за МСК-сутки.
- **J6** Мост встреч в чек-ины: `MEETING_AI_READY` → участники резолвятся → assembleAndUpsert same-day (`meeting-checkin.listener`).

### K. Probe/clarify + method-capture (T10)
- **K1** 🔴 Многоходовый диалог: задача без исполнителя/срока → probe.suggest постановщику → неоднозначный ответ (confidence<0.6) → probe.clarify → понятный ответ → probe.confirm echo-back → «да» → applied. `ProbeDialogState` фазы; `/metrics` `probe_dialog_transition_total`,`probe_dialog_outcome_total`.
- **K2** probe адресуется постановщику (автору реплики), не первому owner (`resolveSetterRecipient`).
- **K3** probe про срок: задача с исполнителем но dueDate=null → probe.due_date_missing.
- **K4** 🔴 method-capture: задача → completed (через transitionState И через PATCH stateId) на значимой задаче (сложность ≥ порога) → probe task.method_capture исполнителю; ответ → RawEvent(kind=notification_response, signalTypeHint=reasoning). Проверить что нет ДВОЙНОГО вопроса (оба пути).
- **K5** Снос probe-инспекторов: нет вопросов Коры про решения/обещания; Decision-извлечение и commitment-факт не затронуты.
- **K6** TTL-cron: зависший `ProbeDialogState` старше `dialogConfirmTtlHours` → resolved+abandoned.

### L. LLM routing / bitrix TZ (T11)
- **L1** `diag-routes` (админ-таблица моделей) + `diag-llm-routes` (tier-маршруты БД): chat-v2 primary = deepseek-v4-pro, tertiary = kie/gemini.
- **L2** Bitrix-sync на 00:00 МСК (не 00:00 UTC); analyze 03:00 МСК — нет гонки sync↔analyze.
- **L3** Fallback-цепь: падение deepseek → openai-via-proxy → kie (`smoke-llm-tertiary`).

### M. Изоляция demo-данных (негативная, T-demo)
- **M1** `seed-demo-workspace --tenant <пустая org> --owner <userId>` → все сущности `externalSource='demo'`; фильтры кабинета не показывают demo где не должны; `--reset` сносит demo, прод-данные целы; повтор без `--force` → skip. (Только как проверка изоляции; НЕ источник тестовой синтетики.)

### S. 🔴 Целостность системы сохранения: роутинг → рёбра → сущности → клоны (сквозная проверка «второго мозга»)

> **Зачем секция.** A–M проверяют «фича сработала». S проверяет отдельно то, о чём просил владелец: что извлечённое **правильно легло в хранилище** — блок ушёл в нужное из направлений (не «разбросался»), рёбра графа записались корректно, сущности не задвоились и не схлопнулись лишнего, клон собран из блоков правильного человека. Это НЕ про экран — про инварианты БД/графа. Все проверки read-only (psql/cypher/metrics), гоняются на синтетике §4 ПОСЛЕ полного прогона конвейера (§5). psql — через libpq (`/opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -c "…"`). `<org>` = orgId синтетического тенанта.

**Матрица «направлений» роутинга (что и куда материализуется).** «12 направлений» владельца — это статик-роутер `RouterService`: **10 именованных специалистов** (3-1…3-15) + event-emit `task.completion` + LLM-fallback (по умолчанию OFF). Маппинг `signalType → специалист → таблица`:

| # | Специалист | signalType (условие) | Целевая таблица | В combined? |
|---|---|---|---|---|
| 3-3 | decisions | decision/rationale/decision_basis | `decisions` (+ curation, embedding) | да |
| 3-1 | regulations | regulation/process_step | `Regulation` (combined: instruction→`Instruction`) | да |
| 3-1 | process-detector | process_step/methodology_step | `ProcessTemplate` | **нет (только router)** |
| 3-5 | insights | pain/risk/churn_risk/objection/blocker/resource_gap/team_friction/process_friction | `Insight` | да |
| 3-6 | ideas | idea/feature_request/suggestion/client_request | `Idea` (+ event, curation, embedding) | да |
| 3-7 | skill | reasoning/expertise/experience/competence/… (только если `hasEmployeeSubject`) | `SkillProfile`+`SkillTrait` | да |
| 3-4 | project-customer | fact (только если `hasProjectCustomerOrVendor`) | Project/Customer/Vendor-граф | **нет (только router)** |
| 3-2 | knowledge-clone | fact при `hasEmployeeMention`; knowledge_gap/question; expertise/… при subject | `KnowledgeProfile`/`KnowledgeCategory` | да |
| 3-9 | experiments | lesson/hypothesis/result | `Experiment` | да |
| 3-12 | personal-relation | team_friction/process_friction | `EntityLink` (manages/collaborates_with) | **нет (только router)** |
| 3-8 | helpfulness | help_provided/mentoring/thanks_explicit/… | `HelpfulnessTrait` | да |
| 3-14 | goals | commitment/plan_item (LLM решает isGoal) | `Goal` (source=ai, suggested) | **нет (только router)** |
| — | event-emit | done_item/task_completed/task_status_changed | → `task.completion_signalled` → кандидат закрытия Issue | — |
| — | **tasks (3-15)** | **НЕ в статик-роутере вовсе** | `Task`/`Issue` — **только** через `combined.persistTasks`→`TaskDraftMaterializer` | только combined |

🔴 **Ключевой инвариант:** при `specialistsCombinedEnabled=ON` (деф.) один блок обслуживают **ДВА параллельных пути** (оба стартуют в `block-distill.worker.ts:187` markCanonical): (A) per-block `RouterService.dispatch` держит структурных вне combined (project-customer, personal-relation, goals, process-detector) + event-emit; (B) `SpecialistsCombinedWorker` (delay 90с, по всему источнику) держит 8 `COMBINED_COVERED` категорий + задачи. Router вычитает `COMBINED_COVERED` из своих targets (`router.service.ts:187`). **Задачи идут ТОЛЬКО через combined** — путать с router нельзя. `knowledge.router_v2_enabled` — это роутер **чата** (retrieval), к материализации блоков отношения НЕ имеет; крутить его «чтобы блоки лучше роутились» бесполезно.

#### S-R. Роутинг: «ничего не ушло не туда и не потерялось»
- **S-R1** 🔴 Осиротевшие canonical-блоки (ушли в никуда): по каждому «однозначному» signalType посчитать блоки без строки в целевой таблице. `SELECT b."signalType", count(*) blocks, count(d.id) decisions, count(i.id) ideas, count(ins.id) insights FROM idea_blocks b LEFT JOIN decisions d ON d."sourceIdeaBlockId"=b.id LEFT JOIN ideas i ON b.id=ANY(i."sourceBlockIds") LEFT JOIN insights ins ON b.id=ANY(ins."sourceBlockIds") WHERE b.status='canonical' AND b."tenantId"='<org>' GROUP BY 1 ORDER BY 1;` **Pass:** для decision/idea/pain/risk доля блоков без соответствующей строки ≈ 0 (поправка на combined-дедуп по источнику и условные ветки). Массив «signalType=decision без Decision» = потеря маршрутизации.
- **S-R2** 🔴 Двойная материализация (гонка combined↔router или ретрай пробил дедуп): `SELECT "sourceBlockIds", count(*) FROM decisions WHERE "tenantId"='<org>' GROUP BY 1 HAVING count(*)>1;` (то же по ideas/insights/experiments/regulations); для Decision — уникальность `sourceIdeaBlockId`. **Pass:** 0 групп. Дубли = баг дедупа `sourceBlockIds:{has}`.
- **S-R3** Метрики роутера: `curl :3000/metrics | grep -E 'core_router_(dispatched|trimmed)_total|router_fallback_calls_total'`. **Pass:** `dispatched` соразмерен (число canonical × ср. fan-out); `trimmed` мал; `router_fallback llm_error≈0`.
- **S-R4** Здоровье очередей материализации: длина failed в `core.specialist-routing` и `core.specialists-combined` (BullMQ/Redis); grep лога `'specialists-combined: parse error'`, `'router.dispatch(canonical) упал'`. **Pass:** failed≈0, нет parse-error с нулевым результатом combo.
- **S-R5** Флаги: `SELECT key,value FROM "AdminSetting" WHERE key IN ('knowledge.specialists_combined_enabled','router.llmFallbackEnabled','router.maxSpecialistsPerBlock');`. **Pass:** combined=ON; maxSpecialistsPerBlock=4. ⚠ анти-fan-out cap=4 молча роняет низкоприоритетных (knowledge-clone/helpfulness/project-customer) на богато-размеченных блоках → следить за `core_router_trimmed_total>0`.

#### S-E. Рёбра графа: реляционка ↔ AGE
- **S-E1** 🔴 IdeaBlockLink по типам (9 значений: develops/contradicts/causes/consequences_of/shares_topic/shares_entity/question_answered_by/resolves/supersedes): `SELECT "relationType", count(*) FROM "IdeaBlockLink" WHERE "tenantId"='<org>' AND status='active' AND "deletedAt" IS NULL GROUP BY 1 ORDER BY 2 DESC;`. **Pass:** непустое распределение; пустой `shares_entity` = не отработал `createStructuralEntityEdges` (block-ingest); пустой `develops/causes` = block-linker не добрал порог (`linker_min_canonical`/confidence) или мало блоков.
- **S-E2** EntityLink по типам: `SELECT "relationType","fromType","toType", count(*) FROM "EntityLink" WHERE "tenantId"='<org>' AND status='active' AND "deletedAt" IS NULL AND "validUntil" IS NULL GROUP BY 1,2,3 ORDER BY 4 DESC;`. **Pass:** рёбра works_at/mentions_with/… от entity-graph-builder.
- **S-E3** 🔴 Сверка AGE ↔ Postgres (главный риск рассинхрона). Вершины: `SELECT count(*)::text FROM ag_catalog.cypher('z_graph', $$ MATCH (n) WHERE n.tenant_id='<org>' RETURN n $$) AS (n agtype);` рёбра — аналогично `MATCH (a)-[r]->(b)`. Сравнить с `count(*)` активных EntityLink/IdeaBlockLink. **ОЖИДАЕМО:** AGE << Postgres — это **архитектурная асимметрия, а не рантайм-сбой**: `IdeaBlockLink` в AGE **не пишется никогда**; `EntityLink` от почасового `entity-graph-builder` пишется prisma-only (минуя `GraphService`), в AGE попадает лишь `derived_from` из block-ingest + ручные `GraphService.addEdge`. **Pass-решение владельца:** подтвердить, что это **намеренно** (AGE держит только типизированные сущности/`derived_from`, полный граф живёт в реляционке) — ИЛИ это дыра (если чат/дашборд ждут полный граф в AGE, он будет почти пуст). См. §10-нов.
- **S-E4** 🔴 Кросс-тенантная утечка рёбер (изоляция): IdeaBlockLink — `SELECT l.id FROM "IdeaBlockLink" l JOIN "IdeaBlock" fb ON fb.id=l."fromBlockId" JOIN "IdeaBlock" tb ON tb.id=l."toBlockId" WHERE fb."tenantId"<>tb."tenantId" OR fb."tenantId"<>l."tenantId";` (**Pass: 0**, гарантируется композитным FK). EntityLink — `SELECT el.id FROM "EntityLink" el JOIN "Entity" ef ON ef.id=el."fromEntityId" JOIN "Entity" et ON et.id=el."toEntityId" WHERE ef."tenantId"<>el."tenantId" OR et."tenantId"<>el."tenantId";` (**Pass: 0**; у EntityLink FK на Entity НЕТ — изоляция держится только логикой писателей, аудит обязателен).
- **S-E5** Висящие рёбра на удалённые блоки: `SELECT count(*) FROM "IdeaBlockLink" l WHERE l.status='active' AND l."deletedAt" IS NULL AND (NOT EXISTS(SELECT 1 FROM "IdeaBlock" b WHERE b.id=l."fromBlockId") OR NOT EXISTS(SELECT 1 FROM "IdeaBlock" b WHERE b.id=l."toBlockId"));`. **Pass:** 0.
- **S-E6** Дубли рёбер по направлению (A→B и B→A с тем же типом — @@unique направление не нормализует): `SELECT a."fromEntityId",a."toEntityId",a."relationType" FROM "EntityLink" a JOIN "EntityLink" b ON a."fromEntityId"=b."toEntityId" AND a."toEntityId"=b."fromEntityId" AND a."relationType"=b."relationType" AND a."tenantId"=b."tenantId" WHERE a.status='active' AND b.status='active';`. **Pass:** пусто (иначе задвоение связи).
- **S-E7** Метрики графа + AGE-гейт: `curl :3000/metrics | grep -E 'core_links_total|kc_entity_graph_fallback_none_total|kc_block_linker_fallback_none_total|kc_risk_edge_total'`; `SELECT value FROM "AdminSetting" WHERE key='graph.ageEnabled';` (или ENV `GRAPH_AGE_ENABLED`). **Pass:** `fallback_none` низкий (иначе LLM-арбитр рёбер деградирует, рёбра молча не создаются); AGE включён. ⚠ `core_links_total` считает ТОЛЬКО IdeaBlockLink — у EntityLink/AGE отдельной метрики нет.

#### S-M. Резолв/дедуп сущностей + канонизация блоков
- **S-M1** 🔴 Under-merge (дубли одной сущности — клиент/человек двоится): `SELECT type, lower("canonicalName") n, count(*) c, array_agg(id) FROM "Entity" WHERE "tenantId"='<org>' AND "mergedIntoId" IS NULL GROUP BY 1,2 HAVING count(*)>1 ORDER BY c DESC LIMIT 50;`. **Pass:** малое число (нет БД-unique на canonicalName — так задумано; арбитр домёрживает асинхронно). Большое/растущее = сломан entity-resolver-cron или embedding не проставился (`SELECT count(*) FROM "Entity" WHERE embedding IS NULL AND "mergedIntoId" IS NULL AND "tenantId"='<org>';` — такие KNN не видит навсегда).
- **S-M2** 🔴 Over-merge (две РАЗНЫЕ сущности схлопнуты — смешение людей/клиентов): ручной аудит Entity с большим `mentionsCount` и разнородными `aliases[]`; сверить контексты в `IdeaBlockEntity`. Отката нет (mergedIntoId необратим) — критично поймать на тесте. **Pass:** aliases одной Entity — реально один субъект.
- **S-M3** 🔴 Битая родословная мёржа (латентный баг компаньона партиции): `SELECT count(*) FROM "Entity" WHERE "mergedIntoId" IS NOT NULL AND "mergedIntoTenantId" IS NULL AND "tenantId"='<org>';` **Ожидаемо >0** — merge-воркер пишет `mergedIntoId` без `mergedIntoTenantId`; SQL-резолв по id работает, но Prisma-relation `mergedInto` вернёт null (тихая потеря родословной). Зафиксировать как находку (§10-нов). Также broken-chain: `SELECT e.id FROM "Entity" e LEFT JOIN "Entity" t ON t.id=e."mergedIntoId" AND t."tenantId"=e."tenantId" WHERE e."mergedIntoId" IS NOT NULL AND t.id IS NULL;` **Pass: 0**.
- **S-M4** Canonical-блоки без evidence (пустой узел): `SELECT b.id FROM "IdeaBlock" b LEFT JOIN "IdeaBlockEvidence" e ON e."blockId"=b.id AND e."tenantId"=b."tenantId" WHERE b.status='canonical' AND b."tenantId"='<org>' AND e.id IS NULL LIMIT 50;`. **Pass:** 0 (иначе evidence не перенеслось при merge).
- **S-M5** Застрявшие draft (канонизация не прошла): `SELECT count(*) FROM "IdeaBlock" WHERE status='draft' AND "tenantId"='<org>' AND "createdAt" < now()-interval '30 minutes';`. **Pass:** ≈0 после `block-distill-reconcile.cron` (30 мин). Растёт = сломан distill или Redis.
- **S-M6** merged_into с не-canonical таргетом: `SELECT b.id FROM "IdeaBlock" b LEFT JOIN "IdeaBlock" c ON c.id=b."mergedIntoId" AND c."tenantId"=b."tenantId" WHERE b.status='merged_into' AND b."tenantId"='<org>' AND (c.id IS NULL OR c.status<>'canonical');`. **Pass:** 0.
- **S-M7** Cross-tenant утечка сущности в блок: `SELECT count(*) FROM "IdeaBlockEntity" ibe JOIN "Entity" e ON e.id=ibe."entityId" WHERE e."tenantId"<>ibe."tenantId";`. **Pass:** 0 (композитные FK).
- **S-M8** Пороги дедупа (значения на стенде): `SELECT key,value FROM "AdminSetting" WHERE key IN ('knowledge.entityMergeThreshold','knowledge.distillMergeThreshold','knowledge.entity_name_resolve_threshold');` + метрика `kc_entity_resolve_path_total{path}` — `path=create` не должен доминировать над exact/knn (иначе дедуп не работает).

#### S-C. Клоны: правильный человек, правильные блоки
- **S-C1** 🔴 У сотрудников §4 непустой профиль: `SELECT name,"profileBuildVersion",("knowledgeProfile" IS NOT NULL) has_kp, jsonb_array_length("knowledgeProfile"->'categories') cats FROM "Person" WHERE "tenantId"='<org>' AND relationship='employee' AND "deletedAt" IS NULL;`. **Pass:** has_kp=true, cats>0, version>0 у активных.
- **S-C2** 🔴 Все employee-Person имеют entityId (иначе штатный cron их НИКОГДА не пересоберёт — фильтр `entityId:{not:null}`): `SELECT count(*) FROM "Person" WHERE relationship='employee' AND "deletedAt" IS NULL AND "entityId" IS NULL AND "tenantId"='<org>';`. **Pass:** 0 — иначе прогнать `backfill-knowledge-clone-person-entity.ts --apply`.
- **S-C3** 🔴 entityId не указывает на merged-away сущность (иначе блоки автора уехали → клон пустой): `SELECT p.name,p."entityId",e."mergedIntoId" FROM "Person" p JOIN "Entity" e ON e.id=p."entityId" AND e."tenantId"=p."entityTenantId" WHERE p.relationship='employee' AND p."tenantId"='<org>' AND e."mergedIntoId" IS NOT NULL;`. **Pass:** 0. ⚠ `applyMerge` при слиянии двух person-Entity НЕ re-point'ит `Person.entityId` → два сотрудника в один клон (§10-нов).
- **S-C4** 🔴 Знания привязаны к ПРАВИЛЬНОМУ человеку (не перепутаны авторы): `SELECT e."canonicalName", count(*) FROM "IdeaBlockEntity" ibe JOIN "Entity" e ON e.id=ibe."entityId" AND e."tenantId"=ibe."tenantId" WHERE ibe.role='subject' AND e.type='person' AND ibe."tenantId"='<org>' GROUP BY 1 ORDER BY 2 DESC;` — затем в 2-3 блоках сверить `canonicalName` с фактическим автором цитаты (`IdeaBlockEvidence.authorLabel`). **Pass:** subject-Entity = реальный автор; одна person-Entity не тянет аномально больше блоков, чем её активность (over-merge).
- **S-C5** Метрики атрибуции: `curl :3000/metrics | grep -E 'knowledge_clone_person_no_entity_total|kc_subject_attribution_total'`. **Pass:** `no_entity` ≈0 и не растёт; в `subject_attribution` преобладают personId/participant/userId, доля `via='none'`/`'name'`(fuzzy) низкая (высокая = блоки без автора не попадут ни в чей клон, либо привязаны не туда).
- **S-C6** Ручная приёмка: `bun run scripts/diag-clone.ts skill-person <personId> <org>` + `list-clones <org>`; при необходимости форс — `run-cron knowledge-clone-rebuild`. **Pass:** трейты именно этого человека; list-clones показывает всех employee с непустыми профилями.

**🔴 Латентные дыры системы сохранения, вскрытые разбором кода (проверить прицельно, вынесены в §10):** (1) AGE-граф асимметричен реляционке — рёбра почти не зеркалятся (S-E3); (2) компаньоны партиции `Entity.mergedIntoTenantId` и `Person.entityTenantId` не проставляются писателями → Prisma-relation рвётся (S-M3); (3) `entity-resolver` может слить две person-Entity, `applyMerge` не re-point'ит `Person.entityId` → клоны сотрудников схлопываются (S-C3); (4) анти-fan-out cap=4 молча роняет низкоприоритетных специалистов (S-R5); (5) tasks материализуются ТОЛЬКО через combined — при OFF задач нет вовсе (§7-1).

---

## §6.2. Остальной функционал — ПАРАЛЛЕЛЬНАЯ проверка готовности к проду (N1–N22)

Коммитами НЕ тронуто (или тронуто краем), но обязано работать для спокойного выката. Глубина — sanity + основной сценарий (легче, чем регресс §6.1, но покрыть ВСЁ). Привязка к реальным модулям/экранам. Отметка «зона риска» = смежно с изменениями §6.1 (проверять чуть плотнее).

**N1. Встречи — полный жизненный цикл** (`meetings`, `livekit`, `recordings`, `meeting-uploads`, `meeting-reports`, `chapters`, `participants`, `voice`, `quality-score`, `behavior-metrics`, `room-messages`, `highlights`, `meetings-balance`; экран `/meetings`).
- Создать встречу каждого из 9 типов; гостевой вход без регистрации (`/m/…`); LiveKit-комната (токен только с backend, гость без секретов); запись (общая + отдельные аудиодорожки на участника); транскрибация/ASR (Vox/GigaAM) + разделение по спикерам; FSM встречи (created→live→ended→ai_ready/ai_failed); **AI-отчёт под тип встречи** (главный дифференциатор — шаблон свой на каждый тип); ROI/quality/behavior-метрики; главы (chapters); баланс минут (meetings-balance).
- Проверка: `/meetings` в кабинете (Playwright); `diag.ts trace/report/llm-calls --meeting <id>`; запись доступна в плеере (Vidstack); отчёт соответствует типу. 🔴 зона риска: событие `MEETING_AI_READY`→мост в чек-ины/чаты (§6.1 I6,J6) переписан — проверить, что переход встречи не ломается.

**N2. Календарь / встречи-события** (`appointments`, `events`; экран `/events`).
- Создать событие/встречу в календаре; напоминания; связь appointment↔meeting; интеграция календаря (если есть внешняя). Проверка: `/events`; событие создаётся/редактируется/удаляется; напоминание уходит в канал (`diag-checkin-reminders`).

**N3. Трекер — доски, проекты, циклы, спринты, статусы** (`tracker`, `cards`; экраны `/tasks`,`/issues`,`/projects`,`/sprints`,`/cards`).
- Ручное создание Issue; проекты/доски (Board)/состояния (IssueState) и переходы (transitions); циклы/спринты (Cycle, SprintHint); метки (Label); **подзадачи (sub-issues) и чек-листы**; assignee/приоритет/срок; связи (relations, duplicates); комментарии (теперь через Message, §6.1 I3); Gantt/представления. 🔴 зона риска: advisory-lock P0-фикс (§6.1) — создание Issue/подзадачи не крашится; unified «задача/подзадача в трекер» из combo (§6.1 C).

**N4. Входящие / курация / pending-actions** (`intake`, `curation`, `pending-actions`; экраны `/intake`,`/curation`,`/actions`).
- Авто-триаж IntakeIssue (accept при confidence≥0.75); ручной accept/reject; жизненный цикл `TaskClosureCandidate(pending)` → подтверждение человеком (авто-закрытие запрещено, R13); конфликты курации. Проверка: `/intake`,`/curation`,`/actions`; `diag-curation-stats <orgId>`.

**N5. Память / граф / поиск** (`knowledge-core`, `search`, `embeddings`, `entities`, `themes`, `insights`, `sources`, `knowledge-access`, `shares`; экраны `/memory`,`/entities`,`/themes`,`/insights`,`/search`).
- Обзор памяти; граф сущностей и связей; темы (кластеры); инсайты (pain/risk); полнотекстовый+семантический поиск; provenance (откуда факт); доступы к знаниям (knowledge-access), шеры. 🔴 зона риска: партиционирование IdeaBlock/Entity (§6.1) — чтение памяти/поиск не сломаны; слой источника (SourceEpisode).

**N6. Решения и идеи** (`decisions`, `ideas`, `insights`; экраны `/decisions`,`/ideas`).
- Список/карточка решения (reversibility-бейдж, §6.1 D6); список/карточка идеи; кластеры идей (IdeaCluster); гигиена (idea≠task, §6.1 B2).

**N7. Цели и зрелость** (`goals`, `kpi`, `company-foundation`; экраны `/goals`,`/maturity`,`/domains`).
- Дерево/список целей (§6.1 F7); KR/прогресс; зрелость компании (maturity); функциональные домены; MVV/фундамент компании (company-foundation).

**N8. Клоны, люди, роли, навыки** (`clones`, `knowledge-clone`, `role-profiles`, `roles-domain`, `role-map`, `persons`, `skills`, `practice-skills`, `job-descriptions`, `structure`, `departments`, `org-members`; экраны `/clones`,`/persons`,`/roles`,`/structure`,`/departments`,`/teams`,`/domains`).
- Профили сотрудников; Employee Clones (KnowledgeProfile/SkillProfile/ExecutablePersona/CloneAccessGrant); карта ролей; оргструктура/отделы/назначения; описания должностей; навыки/практики. 🔴 зона риска: Person↔Entity линковка клона (§6.1 G).

**N9. AI-чат компании / ассистент** (`chat-v2`, `concierge`, `dialog-layer`, `chat`, `conversational`; экраны `/chat`,`/assistant`,`/messages`,`/chats`).
- Задать ассистенту вопросы по всем каналам (встречи/чаты/bitrix/документы); citations/provenance; asOf/scope (Мастер); Cmd+K. 🔴 зона риска: роутер 5 классов + dataClass-routing (§6.1 H) — здесь основной регресс, но проверить и «обычные» вопросы.

**N10. Дашборд / пульс / операции / лента** (`dashboard`, `operations`, `activity-feed`, `behavior-metrics`; экраны `/dashboard`,`/week`,`/month`,`/feed`,`/metrics`).
- Дашборд CEO (пульс за 30 сек); director-dashboard KPI; пульс-паттерны (риски знаний, recurring topics, forecasts, bus-factor); лента активности (cora-feed); переключатель ритмов День↔Неделя↔Месяц. 🔴 зона риска: снятие KPI решений/обещаний (§6.1 D5,E6) — дашборд не 500, число виджетов сошлось.

**N11. Регламенты / процессы / документы / шаблоны** (`regulations`, `processes`, `documents`, `templates`, `brand-voice`, `team-templates`; экраны `/regulations`,`/processes`,`/documents`,`/brand-voice`,`/team-templates`).
- Загрузка документа (parsing→summary, §6.1 H5); регламенты/инструкции (scope роли+owner, §6.1); процессы (ProcessTemplate); brand voice; шаблоны команд.

**N12. Уведомления / каналы / боты / почта** (`conversational`, `push`, `mail`, `destinations`).
- Доставка в in-app/Telegram/MAX/email/push; настройка каналов; quiet-hours; бюджет уведомлений; регистрация push-токенов. Проверка: `diag-checkin-reminders`; реальная доставка тест-сообщения в каждый канал (боты — `setup-telegram-bot`/`setup-max-bot`).

**N13. Интеграции — Bitrix / Chatbox / прочее** (`bitrix`, `chatbox`, `integrations-crossmark`, `integrations-observability`, `webhooks`, `webhooks-out`, `api-keys`, `public-api`, `inn-lookup`; экран `/integrations`).
- Полный sync Bitrix (не только ingest): подключение, забор диалогов/CRM, cron 00:00 МСК (§6.1 L2); Chatbox sync (клиентские чаты, Customer-резолв); исходящие вебхуки; API-ключи (`zik_…`); public-api; INN-lookup; observability интеграций. Проверка: `/integrations`; `check-integrations-overnight.ts`.

**N14. Авторизация / доступ / мультитенант** (`auth`, `accounts`, `orgs`, `rbac`, `users`, `me`, `security`, `knowledge-access`; экраны `/me`,`/company`,`/settings`,`/invitations`).
- Логин/логаут/сессии (secure-кука); регистрация; переключение организаций (owner двух орг); роли/права (Casbin `policy.csv`); TenantGuard (X-Org-Id); приглашения/членство; удаление аккаунта (§6.1 I, `POST /account/delete`); блокировка пользователя. 🔴 зона риска: изоляция тенантов в новом сыром SQL (§10).

**N15. Онбординг** (`onboarding`, `company-foundation`; экран `/onboarding`).
- Регистрация → приветствие → настройка компании → первые данные; onboarding tour; setup-completed флаг. Проверка: свежий юзер проходит онбординг без 400/500 (в прецеденте `qa-cabinet-full-test` были баги тура B4/B5 — перепроверить).

**N16. Биллинг / лимиты / тарифы / рефералы** (`billing`, `entitlements`, `quotas`, `ai-chat-quota`, `meetings-balance`, `referrals`; экран `/referrals`).
- Тариф/энтайтлменты (feature-гейты); квоты (`ingest_bytes_per_month`, ai-chat-quota, баланс минут) — превышение → корректная ошибка (`QuotaExceededError`), не краш; реферальная программа (ReferralLink/payout). Проверка: `/referrals`; `seed-entitlements`/`migrate-entitlements-to-standard` применены.

**N17. Админка** (`admin`, `orchestrator`, `prompt-evolution`, `logging`, `audit`, `health`; экраны `/company-admin`,`/admin`,`/orchestrator`,`/settings`,`/policies`).
- Вход супер-админа; AdminSetting-крутилки (редактирование, `diag-flags`); промпты (PromptTemplate — правка+preview для отчётов встреч); LLM-провайдеры/маршруты (`diag-routes`); ручной запуск кронов (`/admin/crons`); управление очередями (retry-failed/pause/resume); аудит; health/metrics. 🔴 зона риска: 21 новая крутилка целей + kie-timeout (§6.1 F8,H7) — засеяны и редактируются.

**N18. Поддержка** (`support`; экран `/support`).
- Тикет от клиента (SupportTicket на ядре Conversation/Message, §6.1 I); desk reply/note/assign; SLA; clone-draft; клиент видит только external. 🔴 зона риска: support полностью переписан на новое ядро — плотная проверка тикет-флоу.

**N19. Фидбек / признание / бейджи / хайлайты** (`feedback`, `recognition`, `specialist-3-8-helpfulness`, `highlights`; экран `/feedback`).
- Сбор фидбека; кластеризация фидбека; признание/благодарности (Recognition); бейджи (UserBadge); helpfulness-spotlight; хайлайты встреч.

**N20. Smart tables** (`tables`; экран `/tables`).
- Умные таблицы (генерация/заполнение из графа); в прецеденте `2026-06-08-smart-tables-live-test` — сверить с ним.

**N21. Retention / данные / экспорт** (`retention`, `exports`, `shares`, `audit`).
- Политики retention (записи встреч, сообщения — `message_retention_days`, §6.1); экспорт данных; ретеншн-свипы; voice-note retention. Проверка: `seed-retention-policies`; свип не удаляет раньше срока и (для feedsGraph) ingest ПЕРЕД soft-delete.

**N22. Клиенты / вендоры / эксперименты / прочее** (`customers`, `vendors`, `experiments`, `brand-voice`; экраны `/customers`,`/vendors`,`/experiments`).
- Карточки клиентов (Customer-риск); вендоры; эксперименты (Experiment); прочие витрины. Проверка: экраны открываются, данные из §4 отображаются (клиенты «Логистик Плюс»/«Ромашка»).

> Глубина §6.2: для каждого N — открыть экран (Playwright), выполнить основной сценарий, убедиться «нет 400/500, данные из §4 видны, фича делает что обещает». Найденное — в отчёт (§9). Прецеденты багов для перепроверки: `plans/analysis/2026-06-15-qa-cabinet-full-test-bugs.md` (B1 «В задачи» 400, B2 valueStrip 500, B3 должность в /me, B4/B5 онбординг-тур, B12 деградация LLM).

---

## §7. Регресс-чеклист по 4-дневным изменениям («что должно было заработать»)

Сжатый список приоритетных проверок, привязанных к рискам тредов (полное — в §6):

1. 🔴 **Задачи создаются** одним движком combo (`specialistsCombinedEnabled=ON`), из встреч И чатов; старые пути снесены, дублей нет (§6 C1,C2; риск T1-1: OFF → задачи не создаются совсем).
2. 🔴 **Классы разведены** (idea≠task≠decision), «поручение≠решение», «пилот −30%»=Decision (§6 B2).
3. 🔴 **Решения живут как память**, но надзорный слой снят (эндпоинты 404, метрики/колонки удалены, дашборд 6 KPI) (§6 D).
4. 🔴 **Обещания-факт живы**, соц-слой снят (колонки/таблицы/эндпоинты удалены, кроны не падают) (§6 E).
5. 🔴 **Цели**: кроны на МСК, движение цели до компаса, KNN-темы, иерархия, каскад, вектор без обещаний, 21 крутилка засеяна (§6 F; риск T5: продюсер не успевает до 06:00 на объёме).
6. 🔴 **Клоны**: lazy Person→Entity, single-author fallback, backfill (§6 G; риск: штатный cron не лечит entityId=null — нужен ручной enqueue/backfill).
7. 🔴 **AI-чат не зависает** на приватных данных (deepseek eligible), роутер 5 классов, both-ways, KIE-таймаут (§6 H).
8. 🔴 **Единый чат**: backend стартует (boot-регресс), dedup/seq, ФЗ-41 пуш без тела, мост в граф, изоляция internal от клиента (§6 I).
9. 🔴 **Дайджесты**: День/Неделя/Месяц с verdict/letter, DayReport из графа, утренняя сводка задач (§6 J; риск: крон дня 03:00 UTC должен идти ПОСЛЕ ночных синков).
10. 🔴 **Probe**: многоходовый диалог, адресность постановщику, method-capture без двойного вопроса (§6 K).
11. **Надёжность**: `raw-event-recovery.cron` переставляет застрявшие RawEvent; strategic-alignment глотает битый JSON без падения job; P0 advisory-lock не крашит создание задач (§6 A, B).
12. **Слой источника**: партиционирование `IdeaBlock`/`Entity` не сломало чтение/запись (~140 call-sites); tenant-изоляция в сыром SQL (§10-Р).
13. 🔴 **Целостность сохранения (§6.1-S)**: блоки уходят в правильное направление и не теряются (нет осиротевших/двойных), рёбра графа корректны и tenant-изолированы, сущности не задвоены/не схлопнуты, клоны собраны из блоков правильного человека. + 5 латентных дыр из §10-нов (AGE-асимметрия, NULL-компаньоны партиции, слияние person-клонов, cap=4, тихий дроп) — по каждой явный вердикт «дыра / намеренно».

---

## §8. Инструменты верификации (каталог)

**diag-\*** (read-only, безопасны):
- `diag.ts` — `orgs` (узнать orgId), `graph --meeting <id>` (распределение signalType + Decision/Idea/Goal), `trace/report/llm-calls/call/chain` (встреча), `subject-memory --org` (самообучение), `logs`.
- `diag-idea-classifier-test` / `diag-decision-classifier-test` (офлайн на фикстурах, нужен `DEEPSEEK_API_KEY`).
- `diag-task-issue-overlap` (дубли задач), `diag-conflicts <orgId>`, `diag-curation-stats <orgId>`, `diag-regulations --org`.
- `diag-clone` (`skill-person`/`skill-role`/`list-clones`/`run-cron`/`list-crons`).
- `diag-day-report-recall --tenant=<id>`, `diag-checkin-reminders`.
- `diag-concierge --user <email>` (качество ответов помощника), `diag-routes` / `diag-llm-routes` (маршруты), `diag-flags <orgId>` (крутилки+метрики).

**smoke-\*** (пишут в БД, только локаль): `smoke-pipeline-e2e` (матрица канал×узел), `smoke-ingest-fase1` (идемпотентность), `smoke-knowledge-core-fase2` (счётчики блоков/сущностей), `smoke-llm-providers` (живость LLM), `smoke-llm-tertiary`.

**UI-разделы** (Playwright, skill `qa-tester`, локаль): `/memory`,`/entities`,`/themes`,`/insights`; `/tasks`,`/issues`,`/intake`,`/curation`; `/decisions`,`/ideas`; `/goals`,`/goals/:id`; `/clones`,`/persons`,`/roles`; `/dashboard`,`/week`(?rhythm=week),`/month`,`/feed`,`/metrics`; `/chat`,`/messages`,`/c/[token]`; `/meetings`,`/regulations`,`/processes`.

**/metrics** (Prometheus): `kc_meeting_skeleton_total`, `kc_block_overlap_dedup_total`, `kc_block_gleaning_rounds_total`, `task_draft_materialized_total`, `task_dedup_suggested_total`, `knowledge_clone_person_no_entity_total`, `kc_subject_attribution_total{via}`, `z_router_query_class_total`, `z_router_both_ways_total`, `probe_dialog_*`, `day_report_*`, `raw_event_recovery_*`, `strategic_alignment_parse_skip_total`.

**psql** (структурные проверки; через libpq `/opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -c "…"`): `\d decisions` (нет impl-колонок), `\d ideablocks` (нет commitmentStatus), `\d daily_operations_digests` (есть verdictJson), `\d monthly_operations_digests` (существует), `AdminSetting` (21 крутилка целей).

**Интегрити-аудит сохранения (§6.1-S, read-only):** готовый набор SQL/cypher/metrics по 4 подсистемам — роутинг (осиротевшие/двойные блоки), рёбра (типы + AGE↔Postgres + кросс-тенант), сущности (under/over-merge, битая родословная, застрявшие draft), клоны (entityId, правильный автор). Все запросы — в §6.1-S с pass-критериями. AGE-граф: `ag_catalog.cypher('z_graph', $$ MATCH (n) WHERE n.tenant_id='<org>' RETURN n $$)` (вершины) — как `probeAge` в `combat-harness.ts:491`. Рекомендация: обернуть набор в новый `scripts/diag-storage-integrity.ts <org>` (одна команда → таблица PASS/FAIL по S-R/S-E/S-M/S-C) — необязательно, но ускоряет прогон.

---

## §9. Формат отчёта тестировщика

Перенять из эталона `plans/tz/2026-06-27-qa-extraction-pipeline-test.md`:
- **Метод «дельта, не абсолют»**: baseline-снимок счётчиков (`?limit=1`→`.total`) до вброса, все проверки на прирост.
- **Тайминг = поллинг**, не фикс-задержка (хелпер `poll()`: опрос каждые 30с, стоп когда дельта не растёт 2 раза, максимум ~4 мин на текст).
- Пошаговые чек-боксы по каждому входу; сквозной сценарий жизненного цикла карточки.
- Итог: сводная таблица по ВСЕМ проверкам `A1…M1` (акцент §6.1) **и** `N1…N22` (остальной функционал §6.2) со статусом **PASS / FAIL / PARTIAL / SKIP** + для FAIL: `severity · узел · слой / Что / Шаги / Ожидал–Получил / Доказательство (лог/psql/скрин) / Гипотеза file:line`.
- Отдельная секция «регресс 4 дней» (§7) с явным вердиктом по каждому из 12 пунктов.
- **Вердикт готовности к проду:** сводный «можно/нельзя выкатывать» с перечнем блокеров (любой 🔴-FAIL = блокер).

---

## §10. Известные риски и ограничения (учесть при прогоне)

- **🔴 LLM обязателен для извлечения.** Нет детерминированного фолбэка: без живого LLM конвейер создаст RawEvent+draft-блоки, но block-distill/специалисты упадут `llm_error` → задачи/решения/идеи/цели НЕ родятся. Проверять живость ДО прогона (§2).
- **🔴-Р Миграции ветки не прогонялись на локальной БД.** Партиционирование `IdeaBlock`/`Entity` (составной PK, 64 партиции, ~140 call-sites), слой источника, дропы решений/обещаний — писались без БД. `migrate deploy` на существующей БД может конфликтовать. Рекомендация Р2 (свежая БД) заодно валидирует цепочку. Если падает — это находка №1.
- **🔴 `specialistsCombinedEnabled` = единая точка отказа задач.** OFF → задачи не создаются совсем (оба старых пути снесены). Проверить ON перед стартом.
- **Пороги гейтят граф.** `IdeaBlockLink` от ~50 canonical, Theme от ~100, граф сущностей от co-mention, клон от ~reasoning-блоков. На коротком объёме — SKIP (порог, не баг). Понижать только на стенде, фиксируя исходные значения.
- **Приватность ослаблена (T11).** deepseek/openai теперь `maxDataClass=private` → приватные И sensitive данные уходят во внешние прокси. Это ожидаемо по коммиту, но проверить что не сломало маршрутизацию задач с явным requiredDataClass.
- **Best-effort глотает ошибки.** `persistTasks`/`materialize`/`persistSourceLayer` — try/catch с тихим return: сбой материализатора может молча потерять ВСЕ задачи источника. Проверять что при частичном сбое (dedup/assignee) задача всё равно создаётся.
- **Прямой SQL в новом коде.** `runStructuralAggregate`/`listEpisodesByActors`/goal KNN — `$queryRawUnsafe`: проверить `tenantId` в каждом WHERE (изоляция) и `Number.isInteger`-guard на LIMIT (анти-инъекция).
- **Кроны минуют GoalsService.** `goal-hierarchy-rebuild` и `GoalCascadeService` пишут `parentGoalId`/статус прямым `prisma.goal.update` — обходят аудит/валидации/пересчёт embedding; проверить корректность reparent и отсутствие цикла событий.
- **🆕 Дыры системы сохранения (вскрыты разбором кода 2026-07-01, проверяются в §6.1-S — доложить владельцу отдельным вердиктом):**
  - **AGE-граф асимметричен реляционке.** `IdeaBlockLink` в AGE `z_graph` не пишется никогда; `EntityLink` от почасового `entity-graph-builder.cron` пишется prisma-only через `EntityLinkService.upsertRichEdge` (минуя `GraphService`); в AGE попадает лишь `derived_from` из `block-ingest.worker.ts:2122` + ручные `GraphService.addEdge`. Итог: AGE почти пуст относительно реляционного графа. **Решение владельца:** это намеренно (AGE — только типизированные сущности) или дыра (если retrieval/дашборд ждут полный граф в AGE)? См. S-E3. `graph.service.ts:172` (best-effort try/catch), `cypher-builder.ts:5` (whitelist `ALL_LINK_TYPES` НЕ включает 9 SBA-типов reports_to/manages/conflicted_with/… → `BadRequestException` при попытке записать их в AGE).
  - **Компаньоны партиции не проставляются (тихая потеря родословной).** `Entity.mergedIntoTenantId` (`entity-resolver.worker.ts:214`, `entity-merge.service.ts:427`) и `Person.entityTenantId` (`entity-resolution.service.ts:1267/1332/1394`) пишутся частично/никогда. Композитный self-FK не срабатывает при NULL-компаньоне → Prisma-relation `mergedInto`/`entity` возвращает null (SQL-by-id работает, но `include:{entity}` пуст). Проверка S-M3 / клон S-C3.
  - **Слияние двух person-Entity схлопывает клоны.** `entity-resolver.cron.ts:134` findCandidatePairs НЕ исключает `type='person'`; LLM-арбитр может вернуть `verdict='merge'` для двух сотрудников; `applyMerge` (`entity-resolver.worker.ts:230`) переносит `IdeaBlockEntity` на target, но НЕ re-point'ит `Person.entityId` — один клон удваивается, второй пустеет, отката нет. Проверка S-C3/S-C4.
  - **Анти-fan-out cap=4 молча роняет специалистов.** `router.service.ts:194` при >4 targets оставляет top-N по PRIORITY; низкоприоритетные (knowledge-clone=7, helpfulness=5.5, project-customer=6) отбрасываются (только debug-лог + `core_router_trimmed_total`). Богато-размеченный блок недосчитывается в этих таблицах. Проверка S-R5.
  - **Тихий дроп блока при best-effort.** `router.service.ts:176/239` (catch → продолжает) + `block-distill.worker.ts:193` `dispatch().catch()` глотает ошибку целиком; ре-enqueue только при новом block-ingest. Блок canonical без строк в таблицах и без job в очереди. Проверка S-R1/S-R4.
  - **Профиль клона пишется только при triage='auto'.** `specialist-3-2-knowledge-clone.service.ts:233` — при provisional/light/deep уходит в CurationItem, `Person.knowledgeProfile` НЕ обновляется до подтверждения. Если у сотрудника пусто при наличии блоков — проверить `core_specialist_cards{type=knowledge_profile,status=pending}`.
- Тестировщику: перед прогоном заново сверять цепочки по коду (не по этому плану/памяти) — код клонов/доступа/схемы активно менялся.

---

## Приложение. Источники (что и где смотреть в коде)

- Инъектор: `backend/scripts/_lib/combat-harness.ts`, `smoke-pipeline-e2e.ts`.
- Ingest-ворота: `backend/src/modules/ingest/ingest.service.ts`; адаптеры `ingest/adapters/*`.
- Конвейер: `knowledge-core/workers/{block-ingest,block-distill,block-linker}.worker.ts`, `services/router.service.ts`, `specialist-routing-dispatcher.worker.ts`, `services/specialists-combined.service.ts`.
- Задачи: `tracker/services/{task-draft-materializer,intake,intake-checklist-materialize}.*`, `specialist-3-15-tasks.service.ts`.
- Цели: `knowledge-core/workers/{goal-hierarchy-rebuild,goal-task-linker,goal-theme-linker,strategic-alignment}.cron.ts`, `services/specialist-3-14-goals.service.ts`, `operations/services/goal-cascade.handler.ts`, `goals/goals.controller.ts`.
- Клоны: `knowledge-core/services/specialist-3-2-knowledge-clone.service.ts`, `workers/block-ingest.worker.ts` (attributeSubject), `scripts/backfill-knowledge-clone-person-entity.ts`.
- AI-чат: `knowledge-core/services/{chat-v2,chat-v2-retrieval}.service.ts`, `dialog-layer/services/{query-classifier,dialog,query-plan-extractor}.service.ts`, `ai/services/llm-router.service.ts`.
- Чат/messaging: `messaging/services/{message,chat-ingest}.service.ts`, `queue/message-outbox.worker.ts`, `external/*`, `message-bridge/message-bridge.service.ts`, `concierge/services/concierge.service.ts`.
- Дайджесты: `operations/services/{daily,weekly,monthly}-digest.service.ts`, `day-report-collector.service.ts`, `closure-verifier.service.ts`, `daily-checkin.service.ts`, `tracker/services/morning-tasks-digest.service.ts`.
- Probe: `probe/{probe-response.handler,probe-dialog.service}.ts`, `conversational/probe-response-inbound.bridge.ts`, `tracker/services/issues.service.ts` (method-capture).
- Прецеденты формата/фикстур: `plans/tz/2026-06-27-qa-extraction-pipeline-test.md`, `plans/analysis/qa-extraction-test/fixtures.md`, `plans/analysis/2026-06-06-agents-brain-clones-test-plan.md`, `plans/analysis/2026-06-20-agents-big-test-TESTER-BRIEF.md`.
</content>
</invoke>
