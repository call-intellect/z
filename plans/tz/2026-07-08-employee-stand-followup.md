---
type: tz
status: ready
feature: employee-stand-followup
date: 2026-07-08
owner: Сергей (svmazur)
source: >
  Прод-диагностика 2026-07-08 (Playwright-логин под тестовым manager Chydo_002 + SSH read-only + чтение кода).
  Факты: personal_day_narrative = 0 строк во ВСЕЙ БД, AiUsageLog taskType=personal-day-narrative = 0 вызовов,
  крон логирует итог на debug (в проде подавлено), блоки 4а/4б без фронта, переатрибуция обещаний на загрузившего.
relates_to:
  - plans/tz/2026-07-06-employee-stand.md
  - second-brain/01_projects/employee-stand.md
---

> ТЗ на доработку стенда сотрудника (`/me/stand`). Основано на прод-диагностике, без отдельного блюпринта (санкция владельца 2026-07-08). Три фазы строго по порядку: **P0 оживить письмо + наблюдаемость → P1 паритет по данным → P2 паритет по интерактиву**. Все `file:line` подтверждены по коду. Роль рядового = `manager`; person.relationship при этом должна быть `employee` (крон письма фильтрует по `relationship='employee'`). Никаких комментариев в коде; крутилки — только `AdminSetting`.

# ТЗ: Стенд сотрудника — доработка (followup)

## Диагностический контекст (зачем這 ТЗ)

Стенд `/me/stand` рендерится (борд задач, обещания, футер), но:
1. **Письмо «Твой день» ни разу не сгенерировалось в проде** — не баг вайринга (крон зарегистрирован в [operations.module.ts:145](../../backend/src/modules/operations/workers/personal-day-narrative.cron.ts), `ScheduleModule.forRoot()` есть). Причина: `evening_hour=20` МСК = 17:00 UTC, а инстанс рестартовал 07-07 18:24 UTC (после дневного тика), сегодняшний 17:00 UTC ещё не наступил → крон не совпал с целевым часом, пока жив.
2. **Наблюдаемости нет**: итог крона логируется на `.debug` ([personal-day-narrative.cron.ts:71](../../backend/src/modules/operations/workers/personal-day-narrative.cron.ts#L71)), в проде `LOG_LEVEL` его подавляет. Соседние croны пишут итог на `.log` и видны.
3. **Блоки 4а «Кора на твоей стороне» и 4б «Ты двигаешь» отсутствуют на фронте** — при том что бэкенд-эндпоинты, фронт-API ([me-stand.api.ts](../../frontend/src/api/me-stand.api.ts)) и домен-типы готовы.
4. **Переатрибуция обещаний**: при слабой диаризации автор обещания резолвится по `authorUserId`/`authorEmail` (загрузивший), поэтому все обещания встречи вешаются на одного человека ([block-ingest.worker.ts:1654-1674](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L1654-L1674)).
5. **Идеи компании — заглушка на фронте** (бэк отдаёт реальный `top`, фронт не рендерит).

**Продуктовое решение владельца:** письмо переносим с вечера (20:00, про сегодня) на **утро (07:00, про вчера)** — по образцу директорского «День компании» ([operations-daily-digest.cron.ts:26](../../backend/src/modules/operations/workers/operations-daily-digest.cron.ts#L26): `@Cron('0 7 * * *', {timeZone:'Europe/Moscow'})`).

---

## Фаза P0 — Оживить письмо + наблюдаемость (реализуется ПЕРВОЙ, отдельным PR)

Цель: письмо реально генерится утром про вчера, и мы это видим в логах.

### P0.1 — Перенос генерации на утро про вчера (крон)
`backend/src/modules/operations/workers/personal-day-narrative.cron.ts`
- **Оставляем** `@Cron('0 * * * *')` почасовой и per-person timezone-гейт (это соблюдает правило №9 «час доставки = крутилка» и учитывает таймзону — в отличие от хардкода директора). **НЕ** копировать хардкод `@Cron('0 7 …')`.
- Крутилку `operations.personal_day_narrative.evening_hour` (default 20) → **переименовать в `operations.personal_day_narrative.morning_hour` (int 0-23, default 7)**. `resolveEveningHour()`→`resolveMorningHour()` с новым ключом и дефолтом 7.
- Для каждого сотрудника, у кого `getLocalHour(now, tz) === morningHour`: вычислить `packageRef = new Date(now.getTime() - 86_400_000)` (вчера) и передать в сервис (см. P0.2). Письмо про вчера.
- Логика фильтра persons (`relationship='employee', userId not null, deletedAt null`) — без изменений.

### P0.2 — Рефактор сервиса: явный день пакета ≠ now
`backend/src/modules/operations/services/personal-day-narrative.service.ts`
- Сигнатуры `getOrGenerate`/`generate`/`buildPersonDayPackage` принимают доп. поле **`packageRef: Date`** (дата ВНУТРИ целевого локального дня; дефолт = `now`, для обратной совместимости).
- `dateLocal` и день-окно строить от `packageRef`, а НЕ от `now`:
  - `dateLocal = getLocalDate(packageRef, tz)` (строки 88, 108, 205 — заменить источник);
  - `localDayWindowUtc(packageRef, tz)` (строка 206).
- **`now` (реальный) сохраняем** для расчётов «относительно сейчас»:
  - `collectCommitments(... now)` — `commitmentDueDate < now` для overdue (строка 393) остаётся на реальном `now`;
  - `collectContribution(... now)` — неделя/понедельник от реального `now` (строка 535).
- Итог: письмо про вчера (задачи закрытые вчера, чек-ины за вчера, встречи вчера, голос вчера), но «просрочено» и «вклад на этой неделе» — актуальные на момент отправки.
- Логи per-person уже на `.log` (строка 140) / `.warn` fallback (156) — **не трогаем, они правильные**.

### P0.3 — Промпт: «вчерашний день» (кэш-safe)
`backend/src/modules/operations/prompts/personal-day-narrative.prompt.ts`
- В `PERSONAL_DAY_NARRATIVE_SYSTEM_PROMPT` формулировки «за завершающийся/сегодняшний день» → **«за прошедший (вчерашний) день»**. Текст остаётся **статической константой без персональных подстановок** (требование кэша из базового ТЗ) — меняем только generic-формулировку, не ломая идентичность префикса.
- Если версия промпта завязана на `PERSONAL_DAY_NARRATIVE_PROMPT_VERSION` — инкрементировать (`personal-day-v2`).

### P0.4 — Дефолт даты в эндпоинте письма
`backend/src/modules/operations/controllers/my-day-narrative.controller.ts:51`
- `const dateLocal = q.date ?? getLocalDate(new Date(), 'Europe/Moscow')` → **дефолт на вчера**: `q.date ?? yesterdayInMoscow(new Date())` (переиспользовать экспорт `yesterdayInMoscow` из `operations-daily-digest.cron.ts` или вынести в `utils/local-date.ts`).
- Причина: стенд зовёт `dayLetter()` без даты; после переноса письмо лежит под `dateLocal=вчера`. Без правки фронт будет спрашивать сегодня и всегда получать пусто.

### P0.5 — Наблюдаемость крона
`backend/src/modules/operations/workers/personal-day-narrative.cron.ts`
- Итог прохода: `this.logger.debug({generated, skippedOutsideWindow, errors, total}, …)` (строка 71) → **`this.logger.log(...)`** (зеркало [operations-daily-digest.cron.ts:43](../../backend/src/modules/operations/workers/operations-daily-digest.cron.ts#L43)).
- Обернуть тело `run()` в top-level try/catch с `this.logger.error({err}, 'personal-day-narrative.cron: непойманная ошибка')` (зеркало digest:47-52) — сейчас если `person.findMany` упадёт, ошибка немая.
- Debug-строку «disabled, skip» оставить как есть.

### P0.6 — Реестр крутилки
- `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` — запись `evening_hour` → `morning_hour` (int 0-23, default 7, описание «час утренней рассылки письма “Твой день”, по МСК»).
- Сид: `backend/scripts/seed-*` где сидится ключ — переименовать значение; **patch-скрипт** `patch-personal-day-narrative-morning-hour.ts` (idempotent): если в проде есть `AdminSetting key='operations.personal_day_narrative.evening_hour'` — создать `…morning_hour`=7 (если нет) и удалить старый. Зарегистрировать в `apply-prod-deploy.ts STEPS` (phase update, skipBootstrap).
- `enabled` (kill-switch) — без изменений.

### P0.7 — Фронт: плейсхолдер письма
`frontend/app/(authenticated)/me/stand/StandClient.tsx:79` — «Письмо появится вечером — Кора соберёт итог твоего дня.» → **«Письмо придёт утром — Кора соберёт итог твоего вчерашнего дня.»**

### P0.8 — Скрипт ручного запуска генерации (SSH-triggerable) — ОБЯЗАТЕЛЬНО (требование владельца)
Нужна возможность самим запустить генерацию писем командой через SSH, не дожидаясь утреннего крона и минуя гейт часа.
- Новый `backend/scripts/force-personal-day-narrative.ts`. Бутстрапит Nest-контекст (`NestFactory.createApplicationContext(AppModule)`), резолвит `PersonalDayNarrativeService`, гоняет генерацию **напрямую, без проверки `morning_hour`**.
- Флаги: `--date=YYYY-MM-DD` (по умолчанию — вчера по МСК), `--tenant=<orgId>` (опц., иначе все орги), `--person=<personId>` (опц., иначе все `relationship='employee', userId not null` в скоупе), `--all` (все сотрудники всех оргов). `packageRef` = указанная дата.
- Идемпотентность: если строка `personal_day_narrative` за (`tenant,person,date`) уже есть — `getOrGenerate` вернёт существующую; для форс-перегенерации — флаг `--force` (вызвать `generate`, не `getOrGenerate`).
- Вывод в stdout: сколько сгенерено/скип/ошибок + per-person `{personId, model, cachedTokens}` — чтобы сразу видеть результат в SSH.
- `require.main`-guard + экспортируемая функция (правило локального тулинга). **НЕ** регистрировать в `apply-prod-deploy.ts STEPS** (это ручной инструмент, не деплой-шаг).
- **Дополнительно:** дать нашему `@Cron` имя (`{ name: 'personal-day-narrative-morning' }`) — чтобы он был виден в admin cron-manager (`cron-manager.service.ts`) и в `diag-clone.ts run-cron`; но **основной ручной путь — скрипт** (форс крона всё равно упрётся в гейт часа).

**Acceptance P0:**
- В указанный час (default 07:00 МСК) для сотрудников-`employee` создаётся строка `personal_day_narrative` с `dateLocal=вчера`, есть запись `AiUsageLog taskType=personal-day-narrative`.
- **`docker compose exec backend bun run scripts/force-personal-day-narrative.ts --tenant=<org>` немедленно генерит письма и печатает итог** — проверяемо по SSH в любой момент.
- В логах прода видна строка `personal-day-narrative.cron: проход завершён` с `{generated,…}` на уровне LOG.
- Стенд показывает вчерашнее письмо (обложка + 4 оси + «письмо целиком»), а не плейсхолдер.
- Юнит: `packageRef=вчера` → `dateLocal` и окно = вчера, а overdue-обещания считаются от реального `now` (граничный тест: обещание со сроком «позавчера» попадает в overdue и сегодня).

---

## Фаза P1 — Паритет по данным (фронт поверх готового бэка + атрибуция + идеи)

Всё, кроме P1.5, — чистый фронт: методы `meStandApi` и домен-типы уже есть.

### P1.1 — Блок 4а «Кора на твоей стороне»
`StandClient.tsx` — новый компонент после `NightLedger`, до лент. Источники (готовы):
- `meStandApi.load()` → `MyLoad.row.level` (`overloaded/normal/idle`) → строка «Ты взял N задач — перегруз», если `overloaded`.
- `meStandApi.stuck()` → `MyStuck.items` → «N задач зависли >{staleDaysThreshold} дней».
- `meStandApi.planSignal()` → `PlanSignal.triggered` → «{streakDays}-й день план не закрывается», список `lastNotDoneItems`.
- Заголовок с меткой «ты видишь это первым». Пустое состояние — не рендерить блок, если все три пусты.

### P1.2 — Блок 4б «Ты двигаешь»
`StandClient.tsx` — рядом с 4а (2 колонки, как в прототипе). Источники:
- Вклад: из письма (`verdict` ось `contribution`) ИЛИ отдельного `weekly-per-person` — для v1 взять из `metricsJson`/оси письма, доп. запрос не плодить; hero-число «+N к цели за неделю».
- `meStandApi.cloneImpact()` → `CloneImpact.answeredGroundedCount` → «клон ответил за тебя N раз».
- `meStandApi.expertise()` → `MyExpertise.themes[0..1]` → «эксперт по {theme}».

### P1.3 — Значок «🎤 расскажи как делал»
`StandClient.tsx` `BucketColumn` (колонка «Сделано») — `meStandApi.methodCapturePending()` даёт список `id` задач, ждущих захвата метода; на совпадающих done-карточках показать значок-ссылку «🎤 расскажи как делал» (ведёт в probe/трекер задачи). Реализация: подгрузить сет `pendingIds`, помечать `done`-карточки из него.

### P1.4 — Идеи компании — реальный список (снять заглушку)
- `frontend/src/domain/me-stand.ts:131-134` — типизировать `CompanyIdeas.top` вместо `unknown` (форма = результат `IdeasService.getTop`; взять из соответствующего домена ideas).
- `StandClient.tsx` `CompanyIdeas` — рендерить список идей из `top` (заголовок, статус, метка «твоя» по автору), как `CompanyBlockers`. Счётчик `myIdeasThisMonth` оставить.

### P1.5 — Фикс переатрибуции автора обещания
`backend/src/modules/knowledge-core/workers/block-ingest.worker.ts` (~1654-1674)
- Проблема: при отсутствии сегментного `authorPersonId` автор резолвится по цепочке до `authorUserId`/`authorEmail` — это загрузивший встречу, не говорящий. Обещания чужих людей налипают на одного.
- Правка: **не проставлять `commitmentAuthorPersonId`, когда единственный источник — `authorUserId`/`authorEmail` без `speakerParticipantId`/`speakerName`/сегментного автора** (т.е. `via ∈ {'authorUserId'}` и нет говорящего). Лучше `null` (обещание без автора — не покажем «Ты обещал»), чем ложная атрибуция.
- Krutilka `knowledge.commitmentAuthorAttributionEnabled` (есть, default true) — оставить; поведение менять внутри, не флагом.
- Разовый backfill НЕ обязателен для MVP (новые встречи пойдут правильно); при желании — отдельный `backfill-commitment-author-cleanup.ts`, вычищающий атрибуции, сделанные только по uploader (отдельным решением, не блокирует).

**Acceptance P1:**
- На стенде видны блоки 4а и 4б с реальными числами (или скрыты при пустоте).
- На закрытых задачах, ждущих метода, есть значок «🎤».
- Идеи компании — список, не заглушка.
- Новое обещание, извлечённое из встречи, где говорящий не определён и есть только загрузивший, **не** получает `commitmentAuthorPersonId` (юнит на `via='authorUserId'`-ветку → null).

---

## Фаза P2 — Паритет по интерактиву (по прототипу)

`plans/analysis/2026-07-06-employee-stand-prototype/index.html` — эталон. Добавить срезанную интерактивность:
- **Кнопки действий** в «Требует тебя» (Ответить/Завести/Перенести) и в лентах (Напомнить) — на существующие эндпоинты pending-actions/probe.
- **Инлайн-чекбокс** отметки задачи «сделано» на карточках борда (через существующий трекер-эндпоинт смены статуса).
- **Ссылки «все →»** в колонках борда (в трекер с фильтром).
- **Баннер «не отчитался за вчера»** над бордом (по `planSignal`/отсутствию вечернего чек-ина) с кнопкой «Проверить и сдать».
- **Ручной перезапуск письма сотрудником с обложки — НЕ делаем** (решение владельца 2026-07-08). «🔊 Озвучить» — опционально, низкий приоритет. Ручной запуск генерации — только наш, через SSH-скрипт (см. P0.8), не кнопкой в UI.

**Acceptance P2:** ключевые действия выполнимы с самого стенда без перехода; баннер чек-ина появляется при незакрытом плане.

---

## Кросс-каттинг

**prod-deploy-log (`docs/operations/prod-deploy-log.md`):**
- Шаг 6/7: `patch-personal-day-narrative-morning-hour.ts` (переименование крутилки) — зарегистрировать в `apply-prod-deploy.ts STEPS` (phase update, skipBootstrap).
- Шаг 1 / `feature-flags.md`: крутилка `operations.personal_day_narrative.evening_hour` → `…morning_hour` (default 7); `…enabled` без изменений.
- Шаг 12 (smoke): после выката проверить лог `personal-day-narrative.cron: проход завершён` и появление строк `personal_day_narrative`.
- **Раздел «Ручные прогоны» (on-demand, НЕ деплой-шаг):** `docker compose exec backend bun run scripts/force-personal-day-narrative.ts --tenant=<orgId> [--date=YYYY-MM-DD] [--force]` — ручной запуск генерации писем по SSH (P0.8). Также добавить строку в `docs/operations/prod-ssh-access.md` (частые точечные команды).

**second-brain по завершении:** `01_projects/employee-stand.md` (утро/вчера, блоки 4а/4б, атрибуция), `01_projects/ai-jobs.md` + `workers-queues.md` (изменение расписания письма), `docs/methodology/prompts/` (промпт v2).

**Тесты:** P0 — юнит на `packageRef` (день пакета ≠ now), юнит на дефолт даты контроллера; P1 — юнит на ветку атрибуции `via='authorUserId'`→null, рендер-тесты блоков 4а/4б (пустое/наполненное); P2 — интеграционные на действия.

## Порядок и оценка
**P0 (обязательно первым)** ~8 build-items (крон, сервис-рефактор, промпт, контроллер, логи, крутилка+patch, фронт-плейсхолдер, force-скрипт) — S/M, backend-heavy. **P1** ~5 items — фронт (4 рендера) + 1 backend-фикс атрибуции. **P2** ~5 items — фронт-интерактив. Реализовывать строго P0 → P1 → P2, чтобы письмо ожило и стало наблюдаемым раньше всего.

## Решения владельца (зафиксированы)
1. **Утро про вчера** — да, как директор (но через крутилку `morning_hour`=7 + per-person tz, а НЕ хардкод — соблюдаем правило №9). ✅
2. **Одно ТЗ, все фазы** — да; реализация строго по порядку P0→P1→P2. ✅
3. **Реализуем ВСЕ фазы сейчас** (владелец 2026-07-08: «всё меняем, всё делаем, вносим, завтра смотрим»). Порядок P0→P1→P2 сохраняется.
4. **P2 «Пересобрать письмо» ручным перезапуском — НЕ делаем** (решение владельца). ✅
5. **P1.5 backfill старых кривых атрибуций** — код-фикс делаем (новые обещания пойдут верно); сам разовый backfill-скрипт на проде **отложен** (запускать только по отдельному явному «да», т.к. это write на проде). Форвард-фикс не блокируется backfill'ом.
6. **Ручной запуск генерации по SSH — ОБЯЗАТЕЛЬНО** (владелец 2026-07-08): скрипт `force-personal-day-narrative.ts` (P0.8), чтобы «взять и запустить самим командой», не дожидаясь крона. ✅
