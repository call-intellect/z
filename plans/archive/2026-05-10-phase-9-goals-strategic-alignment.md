---
type: tz
status: draft
phase: 9
feature: Цели компании (Goal) + стратегический согласователь — индикатор «движемся ли к цели»
date: 2026-05-10
parent_tz: plans/tz/2026-05-10-knowledge-core-tz.md
references:
  - plans/tz/2026-05-10-knowledge-core-tz.md (Фаза 9)
  - plans/tz/2026-05-10-phase-8-director-dashboard.md (Фаза 8 — расширяем дашборд индикатором)
  - second-brain/01_projects/themes.md
---

# ТЗ: Фаза 9 — Цели компании + стратегический согласователь

> Самостоятельный документ для агента-исполнителя. Все архитектурные решения зафиксированы. Если возникает развилка — выбирай вариант, явно прописанный в разделе «Архитектурные решения», или следуй базовым правилам Z (skill `core-engineering-standards`, `nestjs-rules`, `frontend-rules`, `prisma-db-push-rules`, `z-ai-agent-rules`).

## Цель фазы

Ввести **цели компании** как первоклассную сущность в ядре знаний и **стратегический согласователь** — суточный AI-агент, оценивающий «движется ли компания к каждой цели» на основе свежих сигналов из связанных тем.

Конкретно:
- Owner Org может создать 1–10 целей (название, описание, дедлайн, вес).
- Каждая цель связана с одной или несколькими `Theme` (M:M, ручной выбор + AI-предложения).
- Раз в сутки воркер `strategic-alignment.worker` для каждой активной цели:
  - Берёт связанные темы + блоки за период (по умолчанию 30 дней).
  - LLM (`taskType='goal-alignment'`) оценивает **alignment 0–100** + текстовое объяснение + 3 ключевых сигнала pro/contra.
  - Записывает в `GoalAlignmentSnapshot` (history).
- Если оценка цели **резко упала** (≥-15 пунктов от прошлого snapshot и абсолютная ≤60) — flag `alertPending=true`, виджет на дашборде директора подсвечивается.
- На дашборде директора (Фаза 8) — топ-индикатор **«Согласованность стратегии»** — взвешенное среднее по `weight` всех активных целей.
- На странице `/goals` — список целей с текущим alignment, история (timeline), сводка pro/contra.

## Что входит

### Backend / Schema

#### 9.1. Новые сущности

**`Goal`** — цель Org.
```prisma
/// Цель компании (Фаза 9 knowledge-core).
/// Создаётся owner/admin Org вручную. Связь с Theme — M:M (GoalTheme).
/// Ежесуточно strategic-alignment.worker оценивает движение к цели.
model Goal {
  id           String       @id @default(cuid())
  tenantId     String
  tenant       Org          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name         String
  description  String       @db.Text
  /// Опциональный дедлайн. Используется как контекст для LLM-судьи.
  targetDate   DateTime?
  status       GoalStatus   @default(active)
  /// Вес в среднем "Согласованность стратегии" (Фаза 8). Default 1.0.
  weight       Decimal      @default(1.0) @db.Decimal(4, 3)
  createdById  String
  createdBy    User         @relation("GoalCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  archivedAt   DateTime?
  /// Кэш последнего snapshot для быстрого чтения списка целей без JOIN'а.
  /// Обновляется воркером после каждого расчёта.
  cachedAlignment      Int?     /// 0..100, NULL = ещё не считалось.
  cachedAlignmentAt    DateTime?
  cachedAlignmentDelta Int?     /// разница со снапшотом сутки назад, для подсветки падений.
  cachedSnapshotId     String?  /// FK на последний GoalAlignmentSnapshot.

  themes     GoalTheme[]
  snapshots  GoalAlignmentSnapshot[]

  @@index([tenantId, status])
  @@index([tenantId, archivedAt])
}

enum GoalStatus {
  active
  paused
  achieved
  abandoned
}
```

**`GoalTheme`** — M:M между `Goal` и `Theme`. На старте — ручная привязка от owner; AI-предложения (см. 9.5) добавляются через тот же эндпоинт с флагом `source='ai'`.
```prisma
model GoalTheme {
  goalId     String
  themeId    String
  /// Источник связи: manual (owner добавил) | ai (предложено strategic-alignment.suggester).
  source     GoalThemeSource @default(manual)
  /// Вес (1.0 — основная, ниже — частично связанная). По умолчанию 1.0.
  weight     Decimal         @default(1.0) @db.Decimal(4, 3)
  createdAt  DateTime        @default(now())

  goal  Goal  @relation(fields: [goalId], references: [id], onDelete: Cascade)
  theme Theme @relation(fields: [themeId], references: [id], onDelete: Cascade)

  @@id([goalId, themeId])
  @@index([themeId])
}

enum GoalThemeSource {
  manual
  ai
}
```

**`GoalAlignmentSnapshot`** — суточный снапшот alignment.
```prisma
/// Суточный снапшот «движения к цели» от strategic-alignment.worker.
/// Используется для timeline'а и вычисления delta.
model GoalAlignmentSnapshot {
  id              String   @id @default(cuid())
  tenantId        String
  goalId          String
  /// 0..100 — оценка движения за окно (default 30 дней).
  score           Int
  /// Разница со снапшотом 24h назад (для подсветки падений). NULL для первого snapshot.
  delta           Int?
  /// 1-3 предложения объяснения от LLM.
  explanation     String   @db.Text
  /// Структура: { pro: ['…'], contra: ['…'] } — по 3-5 пунктов.
  signals         Json
  /// Какое окно использовалось (в днях).
  windowDays      Int      @default(30)
  /// Сколько связанных тем участвовало в оценке.
  themesCount     Int
  /// Сколько блоков LLM проанализировал.
  blocksCount     Int
  /// AiUsageLog.id (для drill-down в Z-Admin).
  aiUsageLogId    String?
  /// Если delta <= -15 и score <= 60 — alertPending=true.
  alertPending    Boolean  @default(false)
  createdAt       DateTime @default(now())

  goal  Goal @relation(fields: [goalId], references: [id], onDelete: Cascade)
  /// Не делаем FK на AiUsageLog — может быть очищен ретеншеном; храним id текстом.

  @@index([goalId, createdAt])
  @@index([tenantId, createdAt])
  @@index([tenantId, alertPending])
}
```

**Расширение `Org`** — глобальные настройки воркера:
```prisma
/// Window strategic-alignment в днях (default 30).
strategicAlignmentWindowDays  Int  @default(30)
```

**Связь от `User`** (для FK на Goal.createdById):
```prisma
goalsCreated  Goal[]  @relation("GoalCreatedBy")
```

**Связь от `Theme`**:
```prisma
goalLinks  GoalTheme[]
```

#### 9.2. Воркер `strategic-alignment.worker` + cron

`backend/src/modules/knowledge-core/workers/strategic-alignment.worker.ts`:
- Consumer очереди `core.strategic-alignment` (новая).
- Каждый job — `{tenantId, goalId, windowDays?}`.
- Логика:
  1. Загрузить `Goal` + `GoalTheme[]` + связанные `Theme[]`.
  2. Если `GoalTheme[]` пуст — пропустить (нечего анализировать), логировать предупреждение.
  3. Собрать блоки: `IdeaBlock WHERE tenantId AND status='canonical' AND createdAt >= now-windowDays AND id IN (SELECT blockId FROM ThemeIdeaBlock WHERE themeId IN (...))`. LIMIT 200 (контекст для LLM ограничен).
  4. Сформировать LLM-context: цель {name, description, targetDate}, темы (id+name+weight+dynamic), топ-50 блоков (signalType, criticalQuestion, trustedAnswer truncated). 
  5. LLM-вызов через `LlmRouterService.invoke({taskType:'goal-alignment', tenantId, sourceRef:{type:'goal',id:goalId}, ...})` с **JSON Schema strict**:
     ```json
     {
       "score": "integer 0-100",
       "explanation": "string 1-3 предложения",
       "signals": {
         "pro":   ["string", "..."],
         "contra":["string", "..."]
       }
     }
     ```
  6. Загрузить **предыдущий snapshot** (24-50h назад, чтобы delta была устойчивой к мелким нерегулярностям): `GoalAlignmentSnapshot WHERE goalId AND createdAt < now-20h ORDER BY createdAt DESC LIMIT 1`.
  7. `delta = score - prev.score` (или null если нет prev).
  8. `alertPending = delta !== null && delta <= -15 && score <= 60`.
  9. Транзакция: `create GoalAlignmentSnapshot(...)` → `update Goal SET cachedAlignment=score, cachedAlignmentAt=now, cachedAlignmentDelta=delta, cachedSnapshotId=newSnap.id`.
  10. Если `alertPending=true` — оставить как флаг (без email/push на этой фазе; обработка в UI).

**Concurrency:** 2.

**Cron-плановщик `strategic-alignment.cron.ts`:**
- `@Cron('0 4 * * *')` — каждый день в 04:00 (тихое время).
- Берёт все `Org WHERE deletedAt IS NULL`.
- Для каждой Org берёт `Goal WHERE status='active' AND archivedAt IS NULL`.
- Для каждой `Goal` enqueue в `core.strategic-alignment` с jobId `strat_${goalId}_${YYYYMMDD}` (dedup на сутки).
- Логирует в `AuditLog`: `goal.alignment.scheduled` с counters.

**Промпт:** `backend/src/modules/knowledge-core/prompts/goal-alignment.prompt.ts`:
- system: «Ты — стратегический аналитик. Оцени, движется ли компания к указанной цели за период, на основе сводки сигналов. Score 0-100. Верни JSON по схеме».
- userMessage builder: ferrying цель + темы + блоки в чёткой структуре.
- На фейл LLM (всё провалилось) — НЕ создаём snapshot (не пишем заглушку). Логируем в `AuditLog`. Воркер ретраит через стандартные attempts BullMQ.

**Создать `LlmTaskRoute`** для `goal-alignment` через одноразовый патч `backend/scripts/patch-goal-alignment-route.ts` (skill `safe-seed-rules`):
- providers: `[{provider: 'anthropic'}, {provider: 'deepseek'}, {provider: 'openai-via-proxy'}]`.

#### 9.3. (Опционально) AI-suggester тем для цели

При создании/редактировании цели Owner может нажать «Предложить темы» — `POST /api/v1/goals/:id/suggest-themes`. Backend:
- Берёт топ-N тем Org (`status='active'`, `weight DESC`, `LIMIT 50`).
- LLM-вызов `goal-alignment-suggest` (новый taskType, добавить в union) — формирует список релевантных themeId с обоснованием.
- Возвращает массив `[{themeId, reason, score}]`. Owner подтверждает (или отклоняет) — на подтверждение делается `INSERT INTO GoalTheme(source='ai')`.

**Решение по умолчанию:** **не входит в Фазу 9**, отнесём в vNext. Минимум — ручная привязка.

#### 9.4. API — Goals

`backend/src/modules/goals/`:
- `goals.module.ts`.
- `services/goals.service.ts` — CRUD + список + history.
- `goals.controller.ts`:
  - `GET /api/v1/goals?status=active|all&limit=` — список целей Org с `cachedAlignment`.
  - `GET /api/v1/goals/:id` — детальная: цель + связанные темы + последний snapshot + последние 30 snapshots для timeline.
  - `POST /api/v1/goals` body `{name, description, targetDate?, weight?}` (только `owner`).
  - `PATCH /api/v1/goals/:id` body `{name?, description?, targetDate?, status?, weight?, archived?}` (только `owner`).
  - `DELETE /api/v1/goals/:id` — soft `archivedAt=now, status='abandoned'` (только `owner`).
  - `POST /api/v1/goals/:id/themes` body `{themeIds: string[]}` — добавить темы (manual).
  - `DELETE /api/v1/goals/:id/themes/:themeId` — отвязать тему.
  - `POST /api/v1/goals/:id/recompute` — ручной триггер пересчёта (enqueue в `core.strategic-alignment`). **Только `owner`/`admin`/`super_admin`.** Quota: 5 пересчётов/сутки/Org (через `QuotaService`).
- DTO: `goals.dto.ts` — Zod-схемы.

**Авторизация:**
- Read (`GET /goals`, `GET /goals/:id`) — `RbacService.canRead(userId, tenantId, 'goal')`.
- Write/Delete — только `owner` (через `canWrite` с `obj='goal'`, или явная проверка через `canManageOrg`). **Решение:** добавить ресурс `'goal'` в `RbacService.ResourceType` + правила в `policy.csv`.

**Расширить `RbacService.ResourceType`:**
- Добавить `'goal'` в union.
- В `policy.csv` добавить правила:
  ```
  p, owner, *, *, goal, read
  p, owner, *, *, goal, write
  p, owner, *, *, goal, delete
  p, admin, *, *, goal, read
  p, admin, *, *, goal, read    (admin не может писать — управление целями только у owner)
  p, manager, *, *, goal, read
  ```
  **Уточнение:** на фазе 9 даём `admin` только read; write — exclusively `owner`. Пересмотр в Z-Admin/Org-Admin позже не предусмотрен.

**Расширить `RbacService.isResourceType`** добавлением 'goal' в массив.

#### 9.5. Расширение Дашборда директора (Фаза 8)

`DirectorDashboardService.getDirectorView` дополняется:
- Новый блок **`strategicAlignment`**: `{average: number\|null, goalsCount: number, alertGoals: Array<{id,name,score,delta}>}`. Считается:
  - `Goal[]` где `tenantId AND status='active' AND archivedAt IS NULL`.
  - `average = SUM(weight*cachedAlignment) / SUM(weight)` для целей с `cachedAlignment IS NOT NULL`. Если ни одной — null.
  - `alertGoals` = цели с `alertPending=true` (через JOIN на последний snapshot или через `cachedAlignmentDelta <= -15 AND cachedAlignment <= 60`).
- DTO `DirectorDashboardDto` дополняется `strategicAlignment` (опциональное поле для backward compatibility — на проде Фаза 8 уже задеплоена без него).

`DirectorDashboardClient.tsx` дополняется:
- Топ-индикатор «Согласованность стратегии» — крупная карточка над сеткой 5 виджетов: `average` (0-100, цветовая шкала: 0-40 красный, 40-70 жёлтый, 70-100 зелёный) + число активных целей + список `alertGoals` (если есть, с подсветкой).
- Клик → `/goals`.

### Frontend / Pages

#### 9.6. Страница `/goals`

`frontend/app/(authenticated)/goals/page.tsx` + `GoalsClient.tsx`:
- Список целей: карточки с `name`, `description` (truncate), `cachedAlignment` (прогресс-бар с цветом), `cachedAlignmentDelta` (зелёная стрелка вверх / красная вниз), `targetDate` (если есть, с расчётом «осталось N дней»), `status`-бэйдж.
- Кнопка «Создать цель» (только `owner`).
- Фильтры: `status` (active/paused/achieved/abandoned/all), search по name.
- Empty state: «Цели компании не заданы. Owner может создать первую цель — это включит еженедельный мониторинг движения компании к стратегии».

#### 9.7. Страница `/goals/[id]`

`frontend/app/(authenticated)/goals/[id]/page.tsx` + `GoalDetailClient.tsx`:
- Header: name, description, status, targetDate, кнопки «Редактировать», «Пересчитать сейчас», «Архивировать».
- Карточка «Текущая согласованность»: `cachedAlignment` крупно, `delta`, объяснение (`explanation` из последнего snapshot).
- Блок «Сигналы pro/contra» — последние из snapshot.
- Блок «Связанные темы»: список тем с весами, кнопка «Добавить тему» (поиск по `Theme` Org).
- **Timeline согласованности** — линейный график за 30 дней (если ≥3 snapshots, иначе мелкая надпись «недостаточно данных»). Простой канвас или recharts (если уже подключен; иначе можно SVG-line).
- Список snapshots ниже (rollback не нужен — только просмотр).

#### 9.8. Sidebar

`frontend/src/ui/components/app-shell/Sidebar.tsx`:
- Добавить пункт «Цели» (icon `Target` lucide-react) между «AI-темы» и «AI-чат» — для `owner`/`admin`. Manager не видит (или видит read-only — **решение:** видит, поскольку `canRead='goal'` у manager).

#### 9.9. API + Domain frontend

- `frontend/src/api/goals.api.ts` — `goalsApi.{list, get, create, update, delete, addThemes, removeTheme, recompute}`.
- `frontend/src/domain/goal.ts` — типы `GoalApi/Domain`, `GoalAlignmentSnapshotApi/Domain`, mapper, лейблы статусов и цветовых шкал.

### Документация

#### 9.10. Second-brain

- **Создать `second-brain/01_projects/goals-and-strategic-alignment.md`** — описание сущности, воркера, метрик, UI, авторизации.
- **Обновить `second-brain/02_architecture/data-model.md`** — добавить `Goal`, `GoalTheme`, `GoalAlignmentSnapshot`, `GoalStatus`, `GoalThemeSource`.
- **Обновить `second-brain/02_architecture/module-map.md`** — добавить `goals` модуль и `strategic-alignment.worker`.
- **Обновить `second-brain/01_projects/ai-jobs.md`** — добавить `taskType='goal-alignment'`.
- **Обновить `second-brain/01_projects/workers-queues.md`** — `core.strategic-alignment`.
- **Обновить `second-brain/01_projects/api-layer.md`** — `/api/v1/goals/*`.
- **Обновить `second-brain/01_projects/director-dashboard.md`** (Фаза 8) — секция про `strategicAlignment`.
- **Обновить `second-brain/01_projects/roles-and-permissions.md`** — добавить ресурс `goal`.

## Архитектурные решения (зафиксированы)

| # | Решение |
|---|---|
| 1 | **`Goal` хранит кэш `cachedAlignment*`** для быстрого чтения списка без JOIN'а на последний snapshot. Обновляется атомарно в транзакции воркера. |
| 2 | **Snapshot — иммутабельный**, не редактируется и не пересчитывается. Перерасчёт = новый snapshot. История = `ORDER BY createdAt DESC`. Soft-delete не нужен. |
| 3 | **delta вычисляется относительно snapshot 20-50h назад** (не «вчерашнего») — на случай пропуска суточного запуска. Если предыдущего нет — `delta=null`. |
| 4 | **Alert** = `delta <= -15 AND score <= 60`. Никаких email/push на этой фазе (vNext). Только UI-индикация. |
| 5 | **Окно по умолчанию 30 дней**, настраивается через `Org.strategicAlignmentWindowDays`. Минимум 7, максимум 90 (валидация). |
| 6 | **Voтвлекает Goal на отдельные темы**. Если у цели нет связанных тем — расчёт пропускается, `cachedAlignment=null`, в UI: «Подключите хотя бы одну тему — без них AI не может оценить движение». |
| 7 | **`weight` цели** — Decimal(4,3) [0.001..1.000], default 1.0. Используется в среднем "Согласованность стратегии" на дашборде. |
| 8 | **Авторизация:** только `owner` создаёт/редактирует/удаляет цели. `admin` — read. `manager` — read. Это закладывает правильную ответственность стратега. |
| 9 | **Quota на ручной пересчёт:** 5/сутки/Org через `QuotaService` (новая квота `MAX_GOAL_RECOMPUTE_PER_DAY=5`). Защита от LLM-злоупотреблений. |
| 10 | **JSON Schema strict в LLM-вызове** — чтобы score всегда был integer 0-100, signals.pro/contra массивы. На invalid response — retry через LlmRouter. |
| 11 | **Cron в 04:00 локального времени сервера** (PostgreSQL/server timezone). Если Org в другом TZ — не критично; разница в часах допустима. |
| 12 | **На пустой Org (нет тем/блоков)** воркер пропускает Goal без ошибки; в UI: «Недостаточно данных. Проведите ≥5 встреч и дождитесь обработки в темы». |
| 13 | **Никаких прямых LLM-вызовов**, только через `LlmRouter` с `taskType='goal-alignment'` (skill `z-ai-agent-rules`). |
| 14 | **Расширение Phase-8-дашборда** — это часть Фазы 9 (DTO `DirectorDashboardDto.strategicAlignment` опциональное поле). Если Фаза 8 ещё не закрыта на момент работы агента над Фазой 9 — агент **сначала** ждёт закрытия Фазы 8 (зависимость), не пытается реализовать дашборд внутри Фазы 9. |
| 15 | **AI-suggester тем** — НЕ входит. Только manual-привязка от owner. |
| 16 | **Пересчёт по триггеру (новая встреча → перерасчёт всех целей)** — НЕ делаем. Только суточный cron + ручной trigger. Это снижает стоимость LLM. |

## Что не входит

- AI-suggester тем для цели (`POST /goals/:id/suggest-themes`) — vNext.
- Email/push алерт при падении alignment — vNext (можно добавить в Фазу 11 вместе с notifications).
- Иерархия целей (родитель/потомок) — vNext.
- Кросс-Org стратегические сравнения — vNext.
- KPI/метрики (числовые цели типа «MRR=$1M») — vNext, отдельная сущность Metric.
- Триггерный перерасчёт при новых блоках — vNext.
- Полные unit-тесты на воркер. Минимум — smoke на `goals.service.ts` + on-demand проверка воркера в dev.

## DoD

- [ ] Owner создаёт 3 цели через UI, привязывает 1-3 темы к каждой.
- [ ] После cron-запуска (или ручного recompute) видит alignment по каждой цели.
- [ ] При резком падении alignment виджет на дашборде директора подсвечивается, в `alertGoals` появляется цель.
- [ ] Топ-индикатор «Согласованность стратегии» считается как взвешенное среднее (weight × cachedAlignment), отображается на `/dashboard` директора.
- [ ] Manager видит `/goals` (read-only), кнопок редактирования нет.
- [ ] Manager делает `POST /api/v1/goals` руками — `403`.
- [ ] Voркер устойчив к фейлу LLM: snapshot не создаётся, AuditLog с `goal.alignment.failed`, повтор через стандартные BullMQ attempts.
- [ ] Quota на ручной recompute работает: на 6-й попытке за сутки — `429 quota_exceeded`.
- [ ] `bun run prisma:push --accept-data-loss` после Шага 1 проходит чисто.
- [ ] `bun run typecheck` (backend + frontend) — зелёные.
- [ ] LlmTaskRoute для `goal-alignment` создан патч-скриптом.
- [ ] Создан `second-brain/01_projects/goals-and-strategic-alignment.md`.
- [ ] Обновлены `data-model.md`, `module-map.md`, `ai-jobs.md`, `workers-queues.md`, `api-layer.md`, `director-dashboard.md`, `roles-and-permissions.md`.
- [ ] Обновлён `decisions-log.md`.
- [ ] Создан `plans/2026-05-10-phase-9-execution.md` со `status: completed`.

## Риски и митигации

| Риск | Митигация |
|---|---|
| LLM выдаёт нестабильный score (то 70, то 50 на одинаковых данных) | JSON Schema strict + температура 0.0 в провайдере + `prompt-cache` ключевых блоков. На бенчмарке владелец видит дельту, но абсолютные значения — индикативные, не точные. UI это коммуницирует подписью «AI-индикатор движения, точность ±10 пунктов». |
| Большое окно (30 дней) → большой контекст → высокая стоимость | LIMIT 200 блоков в выборке. На бенчмарке стоимость одного `goal-alignment` ≤ $0.05. На Org с 5 целями × 30 дней = $7.5/мес. Приемлемо. |
| Cron в 04:00 — задержка показа на дашборде | Owner делает `POST /goals/:id/recompute` (квота 5/день). Достаточно для ad-hoc проверки. |
| Цикл «owner добавляет темы, видит alignment, меняет темы» — без перерасчёта старые цифры | UI на странице цели после изменения тем показывает плашку «Темы изменены. Запустите пересчёт». Сам пересчёт — только по кнопке (не auto, чтобы не тратить LLM при каждом редактировании). |
| Goal без связанных тем висит навсегда | UI показывает empty state «Подключите хотя бы одну тему». Воркер пропускает (без ошибки). |
| Удаление темы оставляет orphan-связь | `onDelete: Cascade` на `GoalTheme.themeId` — связь чистится автоматически. cachedAlignment не пересчитывается до следующего cron'а — допустимо. |

## Текущее состояние (на чём строим)

### Что уже есть
- **`Theme`** (Фаза 4) с `weight, dynamic, status`, индексами `(tenantId, status)`. Содержит `ThemeIdeaBlock` для связи с блоками.
- **`IdeaBlock`** (Фаза 2) с `tenantId, status, signalType, createdAt`. Индекс `(tenantId, status)`, `(tenantId, signalType)`.
- **`LlmRouterService`** с `taskType='goal-alignment'` уже в union'е ([llm-router.service.ts:63](backend/src/modules/ai/services/llm-router.service.ts#L63)).
- **`LlmTaskRoute`** + `experiment` (Фаза 0).
- **`CoreQueueService`** + BullMQ (Фаза 1) — добавляем новую очередь `core.strategic-alignment`.
- **`RbacService`** — добавляем ресурс `'goal'` + правила.
- **`QuotaService`** — добавляем `MAX_GOAL_RECOMPUTE_PER_DAY`.
- **`AuditLog`** — добавляем actions `goal.created`, `goal.updated`, `goal.deleted`, `goal.theme.added`, `goal.theme.removed`, `goal.alignment.computed`, `goal.alignment.failed`, `goal.alignment.scheduled`.
- **`DirectorDashboardService`** (Фаза 8) — расширяется новым блоком `strategicAlignment`.
- **Dashboard `/dashboard`** (Фаза 8) — расширяется индикатором.

### Что нужно добавить
- 3 новые модели + 2 enum'а в Prisma schema.
- Расширение `Org.strategicAlignmentWindowDays`.
- Новый модуль `backend/src/modules/goals/`.
- Новый воркер + cron `strategic-alignment.*`.
- Новая очередь `core.strategic-alignment` в `CoreQueueService`.
- Промпт `goal-alignment.prompt.ts`.
- Патч-скрипт для `LlmTaskRoute`.
- Расширение `RbacService` + `policy.csv`.
- Расширение `DirectorDashboardService` + DTO + UI.
- Frontend: 2 новые страницы (`/goals`, `/goals/[id]`), API-клиент, domain.

## Пошаговый план для агента-исполнителя

Фаза 9 разбита на **8 шагов**. Каждый — атомарный коммит. После шагов 1, 7 — `bun run prisma:push --accept-data-loss` + `bun run build`. После шагов 2, 4, 6, 8 — `bun run typecheck`.

### Шаг 1 — Prisma schema + db push

1. Добавить enum'ы `GoalStatus`, `GoalThemeSource`.
2. Добавить модели `Goal`, `GoalTheme`, `GoalAlignmentSnapshot`.
3. Расширить `Org.strategicAlignmentWindowDays`.
4. Добавить обратные связи в `User`, `Theme`.
5. `bun run prisma:push --accept-data-loss && bun run prisma:generate`.

**Коммит:** `feat(knowledge-core): фаза 9 шаг 1 — schema (Goal, GoalTheme, GoalAlignmentSnapshot)`.

### Шаг 2 — RBAC: ресурс 'goal' + policy.csv + Quota

1. Расширить `RbacService.ResourceType` добавлением `'goal'`.
2. Расширить `isResourceType` массив.
3. Добавить правила в `policy.csv` (см. §9.4).
4. Добавить квоту `MAX_GOAL_RECOMPUTE_PER_DAY=5` в `QuotaService` (если такого constants-файла ещё нет — добавить inline).
5. Smoke-тест на RBAC.
6. `bun run typecheck`.

**Коммит:** `feat(knowledge-core): фаза 9 шаг 2 — RBAC ресурс goal + quota MAX_GOAL_RECOMPUTE_PER_DAY`.

### Шаг 3 — Модуль `goals` (CRUD + темы)

1. Создать `backend/src/modules/goals/`:
   - `goals.module.ts`.
   - `services/goals.service.ts` — CRUD, привязка/отвязка тем.
   - `goals.controller.ts` — REST.
   - `dto/goals.dto.ts` — Zod-схемы (включая validate `weight ∈ [0.001, 1.0]`, `name` 1-200 chars).
2. Регистрация в `AppModule`.
3. Smoke-тест на CRUD.
4. `bun run typecheck`.

**Коммит:** `feat(knowledge-core): фаза 9 шаг 3 — модуль goals (CRUD + темы)`.

### Шаг 4 — Очередь + воркер + cron `strategic-alignment`

1. В `core-queue/queues.ts` добавить `STRATEGIC_ALIGNMENT = 'core.strategic-alignment'`.
2. В `CoreQueueService` добавить `enqueueStrategicAlignment({tenantId, goalId})` с jobId `strat_${goalId}_${YYYYMMDD}` (для дневной dedup).
3. Создать `backend/src/modules/knowledge-core/workers/strategic-alignment.worker.ts` — concurrency 2.
4. Создать `backend/src/modules/knowledge-core/workers/strategic-alignment.cron.ts` — `@Cron('0 4 * * *')`.
5. Создать `backend/src/modules/knowledge-core/prompts/goal-alignment.prompt.ts` — system + user-builder + JSON Schema.
6. Создать одноразовый патч `backend/scripts/patch-goal-alignment-route.ts` (по skill `safe-seed-rules`).
7. Регистрация воркера и cron в модуле.
8. Smoke: запустить воркер вручную (`prisma`-seed + создать Goal + GoalTheme + блоки → recompute → проверить snapshot).
9. `bun run typecheck`.

**Коммит:** `feat(knowledge-core): фаза 9 шаг 4 — strategic-alignment worker + cron + промпт + LlmTaskRoute`.

### Шаг 5 — Endpoint `/goals/:id/recompute`

1. В `goals.controller.ts` добавить `POST /:id/recompute` под `RbacService.canManageOrg` (owner/admin/super_admin).
2. Quota check `MAX_GOAL_RECOMPUTE_PER_DAY` через `QuotaService`.
3. Enqueue в `core.strategic-alignment` с jobId `strat_manual_${goalId}_${Date.now()}` (без дневной dedup, чтобы можно было сразу).
4. Возвращать `{enqueued: true, jobId}`.
5. Smoke: ручной recompute, после ~10s видит новый snapshot.
6. `bun run typecheck`.

**Коммит:** `feat(knowledge-core): фаза 9 шаг 5 — POST /goals/:id/recompute с quota`.

### Шаг 6 — Расширение DirectorDashboardService (Фаза 8)

1. В `DirectorDashboardService.getDirectorView` добавить блок `strategicAlignment`:
   - Загрузка `Goal[] WHERE tenantId AND status='active' AND archivedAt IS NULL`.
   - Расчёт `average` (взвешенный по weight).
   - `alertGoals` — `cachedAlignmentDelta <= -15 AND cachedAlignment <= 60`.
2. Расширить DTO `DirectorDashboardDto` опциональным `strategicAlignment`.
3. Smoke на seed-данных.
4. `bun run typecheck`.

**Коммит:** `feat(knowledge-core): фаза 9 шаг 6 — DirectorDashboardService.strategicAlignment блок`.

### Шаг 7 — Frontend: domain + API + страница `/goals`

1. `frontend/src/domain/goal.ts` — типы + mappers + лейблы.
2. `frontend/src/api/goals.api.ts` — все методы.
3. `frontend/app/(authenticated)/goals/page.tsx` + `GoalsClient.tsx` — список целей, создание, редактирование (через диалог).
4. `Sidebar.tsx` — пункт «Цели».
5. `bun run typecheck`.
6. Ручной smoke в браузере: владелец создаёт цель, видит её в списке, alignment пока null.

**Коммит:** `feat(knowledge-core): фаза 9 шаг 7 — frontend /goals (список + создание)`.

### Шаг 8 — Frontend: страница `/goals/[id]` + расширение DirectorDashboardClient

1. `frontend/app/(authenticated)/goals/[id]/page.tsx` + `GoalDetailClient.tsx` — детальная страница: связанные темы, текущая alignment, timeline (SVG-line простая).
2. `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx` — добавить блок «Согласованность стратегии» (топ-индикатор + alertGoals).
3. `bun run typecheck`.
4. Ручной smoke: после cron'а (или мануального recompute) — видим alignment + timeline + alertGoal.

**Коммит:** `feat(knowledge-core): фаза 9 шаг 8 — frontend /goals/[id] + дашборд директора (strategicAlignment)`.

### Шаг 9 — Документация + execution-план

1. Создать `second-brain/01_projects/goals-and-strategic-alignment.md`.
2. Обновить `second-brain/02_architecture/data-model.md` (Goal, GoalTheme, GoalAlignmentSnapshot).
3. Обновить `second-brain/02_architecture/module-map.md` (модуль goals + воркер).
4. Обновить `second-brain/01_projects/ai-jobs.md` (`goal-alignment`).
5. Обновить `second-brain/01_projects/workers-queues.md` (`core.strategic-alignment`).
6. Обновить `second-brain/01_projects/api-layer.md` (`/api/v1/goals/*`).
7. Обновить `second-brain/01_projects/director-dashboard.md` (strategicAlignment).
8. Обновить `second-brain/01_projects/roles-and-permissions.md` (ресурс goal).
9. Обновить `plans/decisions-log.md`.
10. Обновить родителя `plans/tz/2026-05-10-knowledge-core-tz.md` — отметить Фазу 9.
11. Создать `plans/2026-05-10-phase-9-execution.md` со `status: completed`.

**Коммит:** `docs(second-brain): рефлексия Фазы 9 — Goal/strategic-alignment + обновление data-model/module-map/api-layer`.

## Затронутые файлы (полный список)

### Backend / schema
- `backend/prisma/schema.prisma` — `Goal`, `GoalTheme`, `GoalAlignmentSnapshot`, `GoalStatus`, `GoalThemeSource`, `Org.strategicAlignmentWindowDays`.

### Backend / RBAC + Quota
- `backend/src/modules/rbac/rbac.service.ts` — `ResourceType` + `isResourceType` + 'goal'.
- `backend/src/modules/rbac/policies/policy.csv` — правила для 'goal'.
- `backend/src/modules/quotas/quota.service.ts` — `MAX_GOAL_RECOMPUTE_PER_DAY=5`.

### Backend / goals module
- `backend/src/modules/goals/goals.module.ts` — новый.
- `backend/src/modules/goals/services/goals.service.ts` — новый.
- `backend/src/modules/goals/goals.controller.ts` — новый.
- `backend/src/modules/goals/dto/goals.dto.ts` — новый.

### Backend / knowledge-core (alignment)
- `backend/src/modules/core-queue/queues.ts` — `STRATEGIC_ALIGNMENT`.
- `backend/src/modules/core-queue/core-queue.service.ts` — `enqueueStrategicAlignment`.
- `backend/src/modules/knowledge-core/workers/strategic-alignment.worker.ts` — новый.
- `backend/src/modules/knowledge-core/workers/strategic-alignment.cron.ts` — новый.
- `backend/src/modules/knowledge-core/prompts/goal-alignment.prompt.ts` — новый.
- `backend/src/modules/knowledge-core/knowledge-core.module.ts` — providers + workers (если воркеры там регистрируются).
- `backend/scripts/patch-goal-alignment-route.ts` — новый одноразовый патч.

### Backend / dashboard (расширение Фазы 8)
- `backend/src/modules/dashboard/services/director-dashboard.service.ts` — блок `strategicAlignment`.
- `backend/src/modules/dashboard/dto/director-dashboard.dto.ts` — поле.

### Frontend
- `frontend/app/(authenticated)/goals/page.tsx` + `GoalsClient.tsx` — новые.
- `frontend/app/(authenticated)/goals/[id]/page.tsx` + `GoalDetailClient.tsx` — новые.
- `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx` — блок «Согласованность стратегии».
- `frontend/src/api/goals.api.ts` — новый.
- `frontend/src/domain/goal.ts` — новый.
- `frontend/src/domain/director-dashboard.ts` — поле `strategicAlignment` (если ещё нет).
- `frontend/src/ui/components/app-shell/Sidebar.tsx` — пункт «Цели».

### Documentation
- `second-brain/01_projects/goals-and-strategic-alignment.md` — новый.
- `second-brain/01_projects/director-dashboard.md` — обновление.
- `second-brain/01_projects/ai-jobs.md` — обновление.
- `second-brain/01_projects/workers-queues.md` — обновление.
- `second-brain/01_projects/api-layer.md` — обновление.
- `second-brain/01_projects/roles-and-permissions.md` — обновление.
- `second-brain/02_architecture/data-model.md` — обновление.
- `second-brain/02_architecture/module-map.md` — обновление.
- `plans/decisions-log.md` — обновление.
- `plans/tz/2026-05-10-knowledge-core-tz.md` — обновление итогов.
- `plans/2026-05-10-phase-9-execution.md` — новый.

## Сквозные правила

- **Все LLM — через `LlmRouter`** с `taskType='goal-alignment'` (skill `z-ai-agent-rules`).
- **Промпт админ-редактируемый** — НЕ в этой фазе. Code fallback. Если в момент работы Фаза 7 уже закрыта — можно сразу зарегистрировать в prompt-registry (если он есть). Если registry нет — code fallback.
- **`bun run prisma:push --accept-data-loss`** (skill `prisma-db-push-rules`).
- **Patch-script для LlmTaskRoute** — по skill `safe-seed-rules`. Не трогать admin-edited записи.
- **Все DTO — Zod через `ZodValidationPipe`**, FiltersDto-паттерн где применимо (skill `nestjs-rules`).
- **Frontend ApiDto → DomainModel → UiModel** (skill `frontend-rules`).
- **Commit-сообщения** в Conventional Commits, область `knowledge-core`.

## Открытые вопросы (агент сам выбирает решение)

1. **Какая JSON-библиотека для валидации LLM-ответа** — `zod` (универсально для бэка) или строгая JSON Schema через провайдер. **Решение по умолчанию:** zod на стороне Z после получения ответа. JSON Schema strict — на стороне провайдера, если поддерживается (anthropic — да через `tool_use`, deepseek — да через `response_format`).
2. **Цвет timeline на странице цели** — линия одного цвета или цвет точек по score-диапазонам. **Решение по умолчанию:** одна линия neutral, точки цветные по диапазонам. Простой SVG.
3. **Что делать если все snapshots на 0** (LLM возвращает 0 для пустых тем) — UI показывает баннер «Недостаточно сигналов». Триггер: если последние 3 snapshots score=0 или 100 — баннер «Подозрительно постоянная оценка, проверьте темы цели».
4. **Что делать с `targetDate`** в LLM-контексте — если меньше 7 дней до targetDate, добавлять в системный prompt пометку «Дедлайн близок (N дней)». **Решение:** да, добавлять — это улучшает качество объяснения.

## Связанные документы

- Родитель: [plans/tz/2026-05-10-knowledge-core-tz.md](plans/tz/2026-05-10-knowledge-core-tz.md) (Фаза 9).
- Фаза 7 (Z-Admin / Org-Admin): [plans/tz/2026-05-10-phase-7-admin.md](plans/tz/2026-05-10-phase-7-admin.md).
- Фаза 8 (Дашборд директора, который мы расширяем): [plans/tz/2026-05-10-phase-8-director-dashboard.md](plans/tz/2026-05-10-phase-8-director-dashboard.md).
- Themes: [second-brain/01_projects/themes.md](second-brain/01_projects/themes.md).

## Итог (заполняется агентом)

- [ ] Шаг 1 — schema + db push.
- [ ] Шаг 2 — RBAC + Quota.
- [ ] Шаг 3 — модуль goals (CRUD).
- [ ] Шаг 4 — strategic-alignment worker + cron + prompt.
- [ ] Шаг 5 — recompute endpoint.
- [ ] Шаг 6 — DirectorDashboardService.strategicAlignment.
- [ ] Шаг 7 — frontend /goals.
- [ ] Шаг 8 — frontend /goals/[id] + дашборд индикатор.
- [ ] Шаг 9 — документация + execution-план.
- [ ] Создан `phase-9-execution.md` со `status: completed`.
- [ ] Обновлён `decisions-log.md`.
- [ ] Обновлён `second-brain/`.
