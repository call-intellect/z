---
type: tz
status: ready-to-implement
feature: day-company-daily-brief
date: 2026-06-28
owner: Сергей (svmazur)
relates_to:
  - plans/analysis/2026-06-28-day-company-daily-brief-blueprint.md
  - plans/analysis/2026-06-28-day-company-prototype/index.html
  - second-brain/01_projects/director-dashboard.md
  - second-brain/01_projects/goals-and-strategic-alignment.md
  - second-brain/01_projects/insights.md
  - second-brain/01_projects/ideas.md
---

> Анализ-основание: `plans/analysis/2026-06-28-day-company-daily-brief-blueprint.md` · Эталон вёрстки/состава: `plans/analysis/2026-06-28-day-company-prototype/index.html` (открыть в браузере) · Статус согласования развилок: 2026-06-28.

# ТЗ — «День компании»: ежедневный брифинг владельца на главном экране

## Принцип

Верх главного экрана `/dashboard` для роли owner — **связный текстовый отчёт «как прошёл день»** (Executive-брифинг) с обложкой-вердиктом по 4 осям, одной кнопкой «Читать полный отчёт» (всё письмо целиком), и постоянными квадратиками ниже. Реализуется как **расширение существующего дневного дайджеста** (`DailyOperationsDigest` + `operations-daily-digest` + `OperationsDailyDigestCron` + `DailyDigestService`), а не как новый пайплайн. Все «умные» источники уже считаются существующими агентами — **новые извлекающие агенты не вводим**.

## Зачем (болезненное состояние → решение)

Сейчас при входе owner видит на `/dashboard` **сетку из ~10 виджетов-цифр** (`DashboardCanvas rhythm=today`), а текстовая сводка спрятана во вкладке «Аналитика» → `/dashboard/operations/daily` (`DailyDigestClient`), которую владелец может не открыть. Числа без истории не отвечают на вопрос «как прошёл день и что делать». Решение разворачивает приоритет: сверху — повествование + вердикт, цифры — ниже одним блоком «Польза».

Доп. проблема, вскрытая в коде (REALITY-CHECK): дайджест-крон бежит **до** ночных синков переписок — отчёт за день не видит свежие чаты.

---

## REALITY-CHECK (что уже есть / сломано — по факту кода на 2026-06-28)

Перед правкой перечитать файлы: номера строк указаны на момент написания ТЗ, верифицировать якорь-символом.

**Уже работает и переиспользуется как есть (НЕ переписывать):**
- Модель `DailyOperationsDigest` — `backend/prisma/schema.prisma:7959` (якорь `model DailyOperationsDigest {`). Поля: `tenantId`, `dateLocal VarChar(10)`, `bodyMarkdown Text`, `metricsJson Json`, `sourcesJson Json`, `llmTaskRouteId String?`, `shortSummary Text?`, `deliveredAt DateTime?`, `externalSource String?`; `@@unique([tenantId, dateLocal])`, `@@index([tenantId, dateLocal])`, `@@map("daily_operations_digests")`.
- Сервис `DailyDigestService` — `backend/src/modules/operations/services/daily-digest.service.ts`. Методы (якоря): `getStored` (:72), `getLatest` (:88), `getOrGenerate` (:97), `generate` (:106), `markDelivered` (:231), `buildPendingActionsLine` (:241), `buildCustomersAtRiskLine` (:265). Хелперы: `daily-digest.who-shined.spec.ts`, `daily-digest.chronic-blockers.spec.ts`, `daily-digest.trend.spec.ts`.
- Контроллер `DailyDigestController` — `backend/src/modules/operations/controllers/daily-digest.controller.ts`. Эндпоинты (база `api/v1/dashboard/operations/daily-digest`): `GET /` (`?date=`, :38), `GET /latest` (:65), `POST /generate` (`?date=`, owner/admin/super — это «Пересобрать», :87). RBAC чтения — `rbac.canViewOperationsDashboard` (:127); запись — owner/admin/super (:139).
- DTO — `backend/src/modules/operations/dto/daily-digest.dto.ts` (`GetDailyDigestQuerySchema`, `DailyOperationsDigestDto`).
- Промпт + taskType — `backend/src/modules/operations/prompts/daily-digest.prompt.ts`, taskType `operations-daily-digest` (двухстадийный map-reduce; `seed-llm-task-routes-beta-8-3.ts`).
- Доставка — `OperationsDailyDigestCron.notifyRecipients` шлёт owner/coo через `ConversationalService.sendNotification({ eventType: 'operations.daily_digest' })`, идемпотентность по `deliveredAt` + `markDelivered`. kill-switch `operations.daily_digest.enabled`.
- Снапшот цели для компаса — `GoalAlignmentSnapshot` (`schema.prisma`, якорь `model GoalAlignmentSnapshot {`): `score Int (0..100)`, `delta Int?`, `explanation Text`, `signals Json ({pro:[],contra:[]})`, `windowDays`, `alertPending`. Пишет `strategic-alignment.worker` (cron 04:00, taskType `goal-alignment`).
- Радар рисков — Specialist 3.5 (`Specialist35Service`, `GET /api/v1/insights/top?limit=5`, поле динамики `dynamicLabel ∈ {spike,growing,stable,declining}`). Идеи — Specialist 3.6 (`Specialist36Service`, `GET /api/v1/ideas`, `IdeaCluster`, `weight`/`supporterCount`). Клиенты — `CustomerRiskRadarService`. Зависшие — `GET /api/v1/dashboard/stuck/cross-project` + stale-issues. Польза/счётчики — director `fetchValueStrip` (`director-dashboard.service.ts`). Дисциплина/план-факт — `day-signal-detect`/`checkin-discipline`/`WeeklyPerPersonService`.
- Главный экран — `frontend/app/(authenticated)/dashboard/*` → `DirectorDashboardClient` → `DashboardCanvas(role, rhythm='today')` (реестр `frontend/src/ui/components/dashboard/registry/`).

**Сломано / требует фикса (входит в scope):**
- **Тайминг крона.** `OperationsDailyDigestCron` — `@Cron('0 22 * * *')` (22:00 UTC), `backend/src/modules/operations/workers/operations-daily-digest.cron.ts:26`. Синки `chatbox-sync.cron` и `bitrix-sync.cron` — `CronExpression.EVERY_DAY_AT_MIDNIGHT` (00:00 UTC). Дайджест бежит за 2 ч ДО chatbox-синка → отчёт за день не содержит свежие переписки. **Фикс — Ф3.**
- **Поверхность.** «Отчёт» спрятан в `/dashboard/operations/daily`; на главной `/dashboard` — только цифры. **Фикс — Ф5** (новый герой на `/dashboard`).

---

## Принятые решения владельца (2026-06-28 — не пересматривать)

| # | Решение | Обоснование (почему) |
|---|---|---|
| Р1 | Снапшот «Дня компании» — **расширить `DailyOperationsDigest`** (новые JSON-поля), не новая модель | У модели уже есть `@@unique([tenantId,dateLocal])`, доставка, идемпотентность, провенанс, вход «вчера» через `getStored`. Новая модель = дубль инфраструктуры и второй источник правды. |
| Р2 | Синтез — **расширить taskType `operations-daily-digest`** (один промпт), не новый | Он уже двухстадийный map-reduce с маршрутом/кэшем; один LLM-проход дешевле; одна точка правды. |
| Р3 | Тайминг — **крон на `0 3 * * *` (03:00 UTC = 06:00 МСК)** | Синки идут 00:00 UTC (захватывают весь вчерашний МСК-день); 03:00 UTC — после синков и после конца МСК-дня; отчёт за вчера готов к утру владельца. Зазор 3 ч. |
| Р4 | Вердикт — **4 оси** (Команда · Клиенты · Исполнение · Общий), гибрид: детерминированные сигналы → LLM пишет нарратив и назначает цвет с ограничителями | Покрывает «огонь/проблемы с командой/клиентами/в целом» + «исполнение» (сделано/не сделано — сердце «как прошёл день»). Гибрид = объяснимость + человеческий текст. |
| Р5 | Письмо — **чистая проза, одно разворачивание целиком** (без вложенных «развернуть»); кнопка «Озвучить» — заглушка vNext | Прицел на TTS без переделки; UX: владелец читает отчёт целиком, не кликает по 10 блокам. |
| Р6 | Сборка — **map-reduce, переиспользуем существующих агентов**, новые извлекающие агенты не вводим | Всё сырьё/«умное» уже считается (3.5/3.6/goal-alignment/customer-risk/checkins/meeting-report-fast). Синтез только сводит. |
| Р7 | Состав главного экрана и порядок — по прототипу: обложка-вердикт → «Читать полный отчёт» → Цель и компас → Зависшие задачи ↔ кто просрочил → Что мешает ↔ Идеи → Польза Коры за период | Согласовано на кликабельном прототипе (эталон). |

Доказательство выбора (двухпроходное сведение) — `plans/analysis/2026-06-28-day-company-daily-brief-blueprint.md` §6; сводка: Проход A (расширить дайджест) vs Проход B (новый `company-day-synthesize` + `CompanyDaySnapshot`). A выигрывает по reuse / идемпотентности / уже готовой доставке / отсутствию второго источника правды; B проигрывает дублированием инфраструктуры. Challenge-loop: корень (нарратив + тайминг + поверхность) закрыт; самое дешёвое (reuse); без кода-ради-кода (ни новой модели, ни нового агента).

---

## Scope

**Входит:**
1. Расширение `DailyOperationsDigest` тремя nullable JSON-полями (вердикт, письмо-секции, дневной компас).
2. Расширение синтеза (`operations-daily-digest` промпт + `DailyDigestService.generate`) — сбор пакета (8 блоков) + детерминированные сигналы + ОДИН LLM-проход → строгий JSON → персист в новые поля + `bodyMarkdown`/`shortSummary`/`metricsJson`.
3. Перенос крона на `0 3 * * *`.
4. Расширение `DailyOperationsDigestDto` (вердикт/письмо/компас) + доступ чтения для owner/admin (главный экран).
5. Новый герой `/dashboard` (owner): обложка-вердикт + письмо (одно разворачивание) + компас (разворот «почему») + квадратик «Зависшие задачи ↔ кто просрочил» (связаны фильтром, клик задачи → трекер) + квадратик «Что мешает ↔ Идеи» (дневное AI-резюме + бейджи повторяемости) + «Польза Коры за период» (5 счётчиков). Кнопка «Пересобрать» (реюз `POST generate`).
6. Доставка: тело/`actionUrl` рассылки указывают на «День компании» (`/dashboard`).

**Не входит (vNext, с судьбой):**
- TTS «Озвучить» — заглушка-кнопка без логики (vNext-ТЗ; задел оставляем как disabled-кнопку).
- Событийная цепочка тайминга на завершение синков (Р3 решает фикс-часом; vNext если зазор окажется мал).
- Удаление/слияние старой страницы `/dashboard/operations/daily` и старых today-виджетов канвы — НЕ трогаем (владелец: «по шагам, потом»). Старый экран остаётся.
- Мобильная вёрстка / светлая тема героя — отдельным проходом (тёмная — канон прототипа).
- Ось «Деньги/финансы» в вердикте — нет источника (в реестр не-сделанного).

**Граничные контракты (мокать/не реализовывать здесь):**
- `Specialist35Service`/`Specialist36Service`/`strategic-alignment.worker`/`CustomerRiskRadarService`/`day-signal`/`meeting-report-fast` — **читаем их выход**, их логику не трогаем.
- Виджет-данные квадратиков (зависшие задачи, риски-топ, идеи-топ, польза-счётчики, клиенты) — тянем LIVE из существующих эндпоинтов; снапшотим только LLM-нарратив (вердикт/письмо/компас-почему/AI-резюме рисков-идей).

---

## Контракты (контракт-first)

### Ф1 — Prisma: расширить `DailyOperationsDigest`

Добавить в `model DailyOperationsDigest` (`backend/prisma/schema.prisma`, якорь `model DailyOperationsDigest {`) три nullable-поля (обратная совместимость — старые строки = NULL, рендерятся «сухим» fallback):

```prisma
  /// Вердикт дня: { overall:{state,emoji,title,oneLiner}, axes:[{key,state,label,why}] }.
  /// state ∈ 'ok'|'warn'|'risk'; key ∈ 'team'|'clients'|'execution'|'overall'. NULL для legacy/сухого fallback.
  verdictJson         Json?
  /// Письмо «как прошёл день»: [{ key, title, prose, cites:[{label,ref}] }] — чистая проза (TTS-friendly).
  /// key ∈ 'main'|'done'|'not_done'|'reporting'|'blocked'|'decisions'|'clients'|'ideas'|'reflection'|'actions'|'delta'.
  letterJson          Json?
  /// Дневной компас к цели: { direction:'to_goal'|'drift'|'against', score, todayDelta, why, pro:[], contra:[], goalId, goalName }.
  goalAlignmentDayJson Json?
```

Миграция (НЕ `migrate`, по правилам Z — версионируемые файловые миграции через `prisma:migrate -- --name add_day_company_fields_to_digest`; на проде `migrate deploy`). Аддитивная, без backfill (NULL валиден). После — `bun run prisma:generate`.

### Ф2 — Контракт выхода LLM-синтеза (строгий JSON)

`operations-daily-digest` (capable-цепочка) на финальной стадии возвращает (Zod + JSON Schema strict, prompt-caching: стабильный SYSTEM, переменные данные в конце USER):

```jsonc
{
  "verdict": {
    "overall": { "state": "warn", "emoji": "⚠️", "title": "День с трением", "oneLiner": "…" },
    "axes": [
      { "key": "team",      "state": "ok",   "label": "Норма",   "why": "настроение 5/6 · отчёт сдали 3/6" },
      { "key": "clients",   "state": "risk", "label": "Риск",    "why": "…" },
      { "key": "execution", "state": "warn", "label": "Буксует", "why": "закрыто 3 из 7 · блокер 6-й день" },
      { "key": "overall",   "state": "warn", "label": "Трение",  "why": "1 красная зона, 1 жёлтая" }
    ]
  },
  "letter": [ { "key": "main", "title": "Главное за день", "prose": "…", "cites": [ { "label": "встреча 27.06", "ref": "meeting:abc" } ] } ],
  "goalAlignmentDay": { "direction": "drift", "score": 41, "todayDelta": "+1 из 10", "why": "…", "pro": ["…"], "contra": ["…"] },
  "risksSummary": "Повторяется молчание поддержки (3-й день)…",
  "ideasSummary": "Растёт спрос на онбординг-чеклист…"
}
```

**Ограничители вердикта (детерминированные, поверх LLM):** если в сигналах есть негативный клиентский сигнал по ключевому клиенту (`severity ∈ {high,critical}` из insights/customer-risk) → ось `clients.state` принудительно ≠ `ok`. Если план-факт компании < 50% или есть блокер с возрастом ≥ порога → `execution.state` ≠ `ok`. Реализовать как post-LLM clamp в `DailyDigestService`.

### Ф4 — DTO расширение

`DailyOperationsDigestDto` (`daily-digest.dto.ts`) += опциональные `verdict?`, `letter?`, `goalAlignmentDay?` (Zod-типы зеркалят контракт Ф2). Существующие поля не трогаем (обратная совместимость текущего `DailyDigestClient`).

### Ф5 — Frontend контракт

Слои `ApiDto → DomainModel → UiModel` (skill `frontend-rules`). Новый герой `DayCompanyHero` рендерит из `GET /dashboard/operations/daily-digest/latest`; квадратики-данные — из существующих эндпоинтов (insights/top, ideas, stuck/cross-project, customer-risk, value-strip, goal-vector). Вёрстка/состав/порядок — 1:1 по `plans/analysis/2026-06-28-day-company-prototype/index.html` (обложка, одно «Читать полный отчёт», компас с «Почему так?», связка «сотрудник → фильтр задач», бейджи повторяемости, 5 счётчиков пользы: встреч запротоколировано · задач извлечено · задач решено · идей собрано · ответов из памяти). UI только русский; парные токены, без `text-white` на цветном.

---

## Границы фичи

- ✅ Always: переиспользовать существующие сервисы/эндпоинты/агентов; персист только LLM-нарратив; идемпотентность по `(tenantId,dateLocal)`; крутилки в AdminSetting; UI русский.
- ⚠️ Ask first: менять контракт старого `DailyDigestController`/`DailyDigestClient`; трогать логику 3.5/3.6/goal-alignment; новый ENV вместо AdminSetting; менять RBAC за пределами чтения дайджеста для owner/admin.
- 🚫 Never: новый извлекающий LLM-агент; новая модель снапшота; `prisma migrate`/`new PrismaClient()`/`process.env.*`; удалять старую страницу `/dashboard/operations/daily`; дефолт-OFF флаг.

---

## Фазы (dependency-ordered)

Граф: **Ф1 → Ф2 → {Ф3 ∥ Ф4} → Ф5 → Ф6**. Ф3 (крон) и Ф4 (DTO) независимы между собой, оба после Ф2. Ф5 (фронт) после Ф4. Ф6 (доставка/прод) после Ф5.

### Ф1 — Схема: поля снапшота `[x]`
- Файлы: `backend/prisma/schema.prisma` (модель `DailyOperationsDigest`), миграция `prisma/migrations/*_add_day_company_fields_to_digest/`.
- Что входит: 3 nullable JSON-поля (Ф1-контракт). `prisma:generate`.
- Что НЕ входит: backfill (NULL валиден), правки сервиса/промпта.
- Acceptance: `grep -n "verdictJson\|letterJson\|goalAlignmentDayJson" backend/prisma/schema.prisma` → 3 совпадения; миграция аддитивная (только `ADD COLUMN`); `bun run prisma:generate` без ошибок; `bun run typecheck` зелёный. Повторный `migrate deploy` = no-op (идемпотентность).
- Закрывает: R1.

### Ф2 — Синтез: пакет + детерминированные сигналы + один LLM-проход → персист `[x]`
- Файлы: `backend/src/modules/operations/services/daily-digest.service.ts` (`generate`/`getOrGenerate`), `backend/src/modules/operations/prompts/daily-digest.prompt.ts` (расширить SYSTEM/USER + JSON Schema strict), `seed-llm-task-routes-beta-8-3.ts` (если меняется max_tokens — capable-бюджет на reasoning).
- Что входит: сбор пакета 8 блоков (reuse: meeting-report-fast, chatbox-summary, day-signal/checkin-discipline, intake, tracker execution, decisions throughput/stalled, insights `top`, ideas/clusters, goal-alignment latest, customer-risk, вчерашний `getStored`); вычисление детерминированных сигналов; ОДИН capable LLM-вызов (taskType `operations-daily-digest`) → строгий JSON (Ф2-контракт); post-LLM clamp вердикта (ограничители); персист в `verdictJson`/`letterJson`/`goalAlignmentDayJson` + `bodyMarkdown` (конкатенация прозы для TTS/Telegram) + `shortSummary` + `metricsJson`; «сухой» fallback при провале LLM (NULL в новых полях, как сейчас).
- Что НЕ входит: новый taskType; новая очередь; правки 3.5/3.6.
- Acceptance: `bunx vitest run backend/src/modules/operations/services/daily-digest.*.spec.ts` зелёные; новый unit-тест на clamp — «красный клиентский сигнал по ключевому клиенту ⇒ `verdict.axes[clients].state !== 'ok'`» (negative-кейс); `generate` пишет 3 новых поля непустыми при успешном LLM и NULL при смоук-фейле; prompt-caching раздел в промпте (стабильный SYSTEM) — `grep` маркера кэш-структуры; `bun run typecheck/lint/build` зелёные.
- Закрывает: R2, R4, R6.

### Ф3 — Крон: запуск после ночных синков `[x]`
- Файл: `backend/src/modules/operations/workers/operations-daily-digest.cron.ts:26`.
- Что входит: `@Cron('0 22 * * *')` → `@Cron('0 3 * * *')`. Комментария-нарратива не добавлять. `yesterdayInMoscow` и kill-switch не трогать.
- Что НЕ входит: событийная цепочка (vNext).
- Acceptance: `grep -n "@Cron('0 3 \* \* \*')" backend/src/modules/operations/workers/operations-daily-digest.cron.ts` → 1; `operations-daily-digest.cron.spec.ts` адаптирован и зелёный; на момент 03:00 UTC `yesterdayInMoscow` даёт полностью завершённый МСК-день.
- Закрывает: R3.

### Ф4 — DTO + доступ чтения для главного экрана `[x]`
- Файлы: `backend/src/modules/operations/dto/daily-digest.dto.ts` (опц. `verdict`/`letter`/`goalAlignmentDay`), `backend/src/modules/operations/controllers/daily-digest.controller.ts` (`requireReadAccess` — допустить owner/admin наряду с coo; запись «Пересобрать» оставить owner/admin/super).
- Что входит: расширение DTO (зеркало Ф2); чтение `/latest` и `/?date=` доступно owner/admin/coo/super.
- Что НЕ входит: новые эндпоинты (используем существующие 3).
- Acceptance: Swagger smoke — `GET /api/v1/dashboard/operations/daily-digest/latest` под owner отдаёт 200 с `verdict`; под member — 403 `forbidden_role`; `POST /generate` под owner — 200; DTO-поля опциональны (старый клиент не падает); `bun run typecheck` зелёный.
- Закрывает: R5 (контракт), R7 (доступ owner).

### Ф5 — Frontend: герой «День компании» на `/dashboard` `[x]`
- Файлы: `frontend/app/(authenticated)/dashboard/*` (монтаж героя над `DashboardCanvas` для owner), новые компоненты в `frontend/src/ui/components/dashboard/day-company/*` (`DayCompanyHero`, `DayLetter`, `GoalCompassCard`, `StaleTasksLinked`, `RisksIdeas`, `PeriodValue`), `src/api/*.api.ts` + `src/domain/*.ts` (мапперы DTO→Domain→Ui), SWR-хук на `daily-digest/latest`.
- Что входит: рендер по прототипу — обложка-вердикт (4 оси) → «Читать полный отчёт» (одно разворачивание всего письма из `letterJson`) → компас (`goalAlignmentDay`, разворот «Почему так?» pro/contra) → «Зависшие задачи ↔ кто просрочил» (live: stuck/cross-project + агрегат по assignee; клик задачи → роут трекера; клик сотрудника → фильтр списка) → «Что мешает ↔ Идеи» (live: insights/top + ideas; дневное AI-резюме из `risksSummary`/`ideasSummary`; бейджи повторяемости из `dynamicLabel`/`cluster`) → «Польза Коры за период» (5 счётчиков из value-strip). «Озвучить» — disabled-кнопка (vNext). «Пересобрать» → `POST generate`.
- Что НЕ входит: удаление старых today-виджетов/страницы operations/daily; мобилка/светлая тема.
- Acceptance: герой виден первым на `/dashboard` под owner; одно «Читать полный отчёт» раскрывает всё письмо (нет вложенных тогглов); клик по сотруднику фильтрует список задач (проверка Playwright по прототипу-эталону); `bun run typecheck/lint/build` (frontend) зелёные; `grep -rn "text-white" frontend/src/ui/components/dashboard/day-company` → 0; UI строк на английском в новых компонентах — 0.
- Закрывает: R5, R7.

### Ф6 — Доставка + прод `[x]`
- Файлы: `operations-daily-digest.cron.ts` (`notifyRecipients`: `actionUrl` → `/dashboard`; заголовок/тело — «День компании»), `docs/operations/prod-deploy-log.md` (Шаг 4 — миграция), `docs/operations/feature-flags.md` (реестр — kill-switch уже есть, обновить строку при необходимости).
- Что входит: рассылка ведёт на главный экран; прод-запись о миграции.
- Что НЕ входит: новый ENV/флаг (kill-switch `operations.daily_digest.enabled` переиспользуем).
- Acceptance: `grep -n "/dashboard" backend/src/modules/operations/workers/operations-daily-digest.cron.ts` (actionUrl обновлён); `prod-deploy-log.md` Шаг 4 содержит миграцию `add_day_company_fields_to_digest`; идемпотентность доставки (`deliveredAt`) сохранена.
- Закрывает: R3, R5.

---

## Требования (трассировка)

- **R1.** Когда применяется миграция Ф1, `DailyOperationsDigest` имеет поля `verdictJson`/`letterJson`/`goalAlignmentDayJson` (nullable), старые строки = NULL.
- **R2.** Когда крон/`generate` отрабатывает успешно, система shall сохранить вердикт (4 оси), письмо-секции (проза) и дневной компас в снапшот за `(tenantId, dateLocal)`; повторный прогон того же дня = no-op по `getStored`.
- **R3.** Синтез shall запускаться в `0 3 * * *` (после синков chatbox/bitrix 00:00 UTC) и отчитываться за полностью завершённый вчерашний МСК-день.
- **R4.** Если в сигналах есть негативный клиентский сигнал `severity ∈ {high,critical}`, then ось `clients` вердикта shall быть не `ok` (детерминированный clamp поверх LLM).
- **R5.** Owner на `/dashboard` shall видеть «День компании» первым блоком: обложка-вердикт + одно разворачивание всего письма + квадратики (компас, задачи↔сотрудники, риски↔идеи, польза) по порядку прототипа; «Пересобрать» вызывает `POST generate`.
- **R6.** Синтез shall переиспользовать существующих агентов (3.5/3.6/goal-alignment/customer-risk/meeting-report-fast/day-signal) и НЕ вводить новый извлекающий агент/taskType.
- **R7.** Чтение дайджеста на главном экране shall быть доступно owner/admin/coo/super; «Пересобрать» — owner/admin/super.

---

## Инварианты Z (проверить, не нарушено)

- Prisma — файловые миграции (`prisma:migrate -- --name …`), не `migrate dev` руками на проде; `prisma:generate` после; в скриптах `createPrismaClient()`.
- ENV/крутилки — kill-switch и пороги через AdminSetting/`TypedConfigService`; никаких `process.env.*`.
- LLM — capable DeepSeek V4 Pro для синтеза (как `operations-daily-digest`), Anthropic нет; **раздел «Совместимость с prompt caching»**: стабильный SYSTEM, переменные данные (пакет дня) в конце USER.
- Ship-On — выкат включённым; новый флаг не вводим (есть kill-switch дайджеста).
- Multi-tenancy — все выборки по `tenantId`; снапшот `@@unique([tenantId,dateLocal])`.
- Контракты — Zod-DTO + Swagger; фронт `ApiDto→DomainModel→UiModel`, единый `api-client.ts`, SWR.
- UI — только русский; парные токены, без `text-white`/hex на цветном.

## Pre-mortem / Риски

- **LLM не вернёт строгий JSON** → Zod-валидация + «сухой» fallback (NULL новых полей, рендер деградирует до структуры) — как уже сделано для `bodyMarkdown`.
- **Зазор тайминга мал** (синк затянулся за 3 ч) → лог + следующий прогон до‑генерит (`getOrGenerate` идемпотентен); событийная цепочка — vNext.
- **Рассинхрон live-виджетов и снапшота** (числа польза/задачи свежее, чем письмо за вчера) → допустимо by design: письмо = «вчера» (снапшот), квадратики = текущее состояние; подписать периоды в UI.
- **Промпт раздувается** → строгий JSON Schema + few-shot; следить за prompt-cache hit (метрики `z_llm_cache_*`).

## Ревью-аспекты (для `strict-production-review-gate`)
RBAC чтения/записи дайджеста; tenant-изоляция снапшота; идемпотентность `generate`/доставки; отсутствие нового извлекающего агента; clamp вердикта (нельзя «зелёный» при красном клиенте); обратная совместимость старого `DailyDigestClient`.

## Idempotency / feature-flag / prod-deploy
- Миграция Ф1 — аддитивная, повторный `migrate deploy` = no-op → `prod-deploy-log.md` Шаг 4.
- Флаг — переиспользуем kill-switch `operations.daily_digest.enabled` (строка в `feature-flags.md`); новый не вводим.
- Seed/patch/backfill — нет (NULL валиден).

## DoD
`bun run typecheck` (вкл. `.spec`) / `lint` / `build` зелёные (backend и frontend); vitest затронутых файлов зелёные; second-brain обновлён по таблице производных заметок (director-dashboard.md / ai-jobs.md / data-model.md / api-layer.md); `prod-deploy-log.md` Шаг 4 (миграция); рефлексия в `05_история/`.

## Итог

**Реализовано целиком (Ф1–Ф6, R1–R7).** Ветка `feature/day-company-daily-brief`, 8 коммитов:
- `dd9b809d` Ф1 — 3 nullable JSONB-поля + миграция `20260629000000_add_day_company_fields_to_digest` (обход shadow-БД: ручной `migration.sql` + `migrate deploy`).
- `dbd5a1a5` Ф2 — синтез (пакет прямыми Prisma-запросами без кросс-модульного DI, один capable LLM-вызов json_schema strict, `clampVerdict` R4, fallback) + DTO-типы.
- `f1063397` Ф3+Ф6 — крон `0 3 * * *` (R3) + доставка `/dashboard` «День компании».
- `28203eb5` Ф5a — stuck/cross-project +assignee/dueDate; value-strip +tasksResolved/ideasCollected.
- `ef104a87` Ф5b — герой `DayCompanyHero` + 6 под-компонентов (owner-only, токены приложения, без text-white).
- `a66e13ee` фикс — устойчивый парс LLM (toolCalls + обёртка `{result}` + lenient Zod), вскрыт E2E на реальном deepseek.
- `d79671be` + `336ce3f2` — docs (second-brain/prod-deploy-log/feature-flags) + рефлексия.

**Ф4** — оказался no-op по RBAC: `canViewOperationsDashboard` уже пускает owner/admin/coo/super; только DTO (в Ф2).

**Верификация:** backend typecheck(вкл.spec)/build/lint 0 errors, frontend typecheck/build/lint 0 errors; vitest 44 (daily-digest, вкл. negative clamp + extract) + 225 (dashboard) + 21 (mobile exec). **E2E на реальном deepseek-v4-pro локально:** 3 дня синтетики (org «Тест Компания») → реальные отчёты, меняются по нарративу (D2 clients=risk при критич. клиенте — clamp; D3 «частичная стабилизация»); герой отрендерился в браузере (Playwright).

**vNext (вне scope, объявлено в ТЗ):** TTS «Озвучить» (disabled-заглушка стоит), событийная цепочка тайминга на завершение синков, слияние/чистка старой страницы `/dashboard/operations/daily`, мобилка/светлая тема героя, ось «Деньги» в вердикте.

**Прод-операция:** одна аддитивная миграция (авто через migrate-контейнер); seed/patch/backfill/ENV/флаги не требуются. Детали — `docs/operations/prod-deploy-log.md` Шаг 4.
