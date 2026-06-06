---
type: tz
status: ready-to-implement
feature: weekly-per-person-plan-fact
date: 2026-06-05
owner: Сергей (владелец продукта)
relates_to:
  - plans/analysis/2026-06-05-dashboards-improvements-reality-check-and-tz-map.md
  - plans/analysis/2026-06-05-dashboards-prostym-yazykom.md
  - plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md
---

> Анализ-карта: plans/analysis/2026-06-05-dashboards-improvements-reality-check-and-tz-map.md (секция «ТЗ-D») · Решения владельца: 2026-06-05 (Р4).

# ТЗ-D — Персональный план-факт по людям за неделю

## Цель

Дать руководителю в «Недельной сводке» ответ на вопрос **«кто что обещал и сделал ли»** — по конкретным людям, а не по компании и отделам. Дозированно: топ-5 «держат слово» / топ-5 «зоны риска» прямо на сводке, полный список по клику. План-факт здесь — про **обещания, задачи и чек-ины людей**, НЕ про деньги (Кора не про финансы).

## Зачем (болезненное состояние по факту)

- Недельная сводка отвечает по компании и отделам, **разреза по людям нет** — это прямой запрос клиента владельца (`plans/analysis/2026-06-05-dashboards-prostym-yazykom.md:79,84`).
- Показатель «Надёжность обещаний» меряет **не того**: фильтр идёт по `commitmentRecipientPersonId` (кому обещали), а не по тому, кто обещал. По нему делают ложный вывод «отдел перестал держать слово» (`commitment-reliability.service.ts:179-182,250-251`).
- У `IdeaBlock` есть адресат обещания (`commitmentRecipientPersonId`), но **нет автора** — без поля «кто дал обещание» честный персональный план-факт построить нельзя (`schema.prisma:2984`).

---

## REALITY-CHECK

| Факт | Доказательство (path:line + символ) | Влияние на фазы |
|---|---|---|
| Фундамент identity готов: автор-рассуждение детерминированно пишется как `role='subject'` | `block-ingest.worker.ts:53` (`REASONING_SUBJECT_SIGNAL_TYPES`), `:970` (`attributeSubject`), `:1044` (`resolveSubjectEntityId`) | Ф2 строит **поверх** того же резолвера, не с нуля |
| Резолвер identity → Entity готов (3 источника: authorUserId / speakerParticipantId / speakerName) | `entity-resolution.service.ts:908` (`async resolveSubjectEntityId`) | Ф1/Ф2: добавляем sibling-метод, возвращающий **Person id** (поле ссылается на Person, не Entity) |
| `IdeaBlock` имеет адресата, но НЕ автора обещания | `schema.prisma:2984` (`commitmentRecipientPersonId`), нет `commitmentAuthorPersonId` | Ф1 добавляет поле (Р4) |
| Адресат заполняется fuzzy-match'ем по имени; для автора нужен детерминированный путь | `block-ingest.worker.ts:1195` (`linkCommitmentRecipient`), `:1246` (`update commitmentRecipientPersonId`) | Ф2: автор — НЕ fuzzy, а детерминированно по identity спикера |
| `commitment-reliability` фильтрует person-scope по получателю | `commitment-reliability.service.ts:250` (`return { ...base, commitmentRecipientPersonId: args.scopeId }`) | Ф3: новый режим scope по автору/исполнителю |
| `Task.assigneeUserId` уже заполняется по участникам встречи (фундамент готов) | `schema.prisma:1513` (`assigneeUserId`), `:1536` (`@@index([assigneeUserId])`) | Ф4: «выполненные задачи» через `assigneeUserId` (но это **User**, не Person — мапить через `Person.userId`) |
| Недельная агрегация по отделам существует, по людям — нет | `weekly-digest.service.ts:821` (`computeTeamDynamics`), `:863` (department group) | Ф4: новый сервис/эндпоинт по `personId`, НЕ ломаем department-агрегацию |
| Backfill subject-атрибуции — рабочий шаблон | `backfill-subject-attribution.ts:286` (`resolveSubjectEntityId`), регистрация `apply-prod-deploy.ts:365` | Ф2: backfill автора пишем по этому образцу, регистрируем в STEPS |
| `DailyCheckIn` есть, агрегируется по person | `schema.prisma:6364` (`model DailyCheckIn`), `:6367` (`personId`), `:6392` (`completedAt`) | Ф4: «чек-ины» в план-факте по `personId` |
| Фронт «Недельная сводка» на месте | `frontend/app/(authenticated)/dashboard/operations/weekly/WeeklyDigestClient.tsx`, api `frontend/src/api/weekly-digest.api.ts:96` | Ф5: виджет встраивается сюда |

---

## Принятые решения владельца

| # | Решение | Обоснование | Дата |
|---|---|---|---|
| Р4 | Добавить `IdeaBlock.commitmentAuthorPersonId` (prisma db push, без migrate) | Без поля «кто дал обещание» персональный план-факт честно не построить — прямой пункт карты | 2026-06-05 |
| D-1 | Автор заполняется **детерминированно** по identity спикера/автора (как `subject`), НЕ fuzzy-match по имени | У адресата имя угадывает LLM (`commitmentRecipientNameGuess`), у автора есть точная identity сегмента/`payload.userId` — детерминизм надёжнее и не трогает SYSTEM-промпт | 2026-06-05 |
| D-2 | «Выполненные задачи» в план-факте — через `Task.assigneeUserId` (фундамент Ф0–Ф5), мапинг Person→User через `Person.userId` | `assigneeUserId` ссылается на `User`, а план-факт строится по `personId`; берём `Person.userId` для соединения | 2026-06-05 |
| D-3 | Дозированная выдача: топ-5 «держат слово» / топ-5 «зоны риска», полный список — отдельным запросом (`limit`/`offset`) | Сохраняет «за 30 секунд» и при этом отвечает на вопрос клиента (карта `:84`) | 2026-06-05 |
| D-4 | Новый эндпоинт живёт в `operations` модуле под `/api/v1/dashboard/operations/weekly-per-person`, доступ — `canViewOperationsDashboard` | Это часть операционной недельной сводки; права уже есть у `WeeklyDigestController` (`weekly-digest.controller.ts:120`) | 2026-06-05 |

## Доказательство выбора (детерминизм vs fuzzy для автора)

Развилка одна: как привязать автора обещания к Person. Вариант «расширить fuzzy `linkCommitmentRecipient` на автора» отклонён — у автора, в отличие от адресата, есть **точная identity сегмента** (`speakerParticipantId`) либо `payload.userId` для текстовых каналов; fuzzy по имени дал бы ложные привязки и неоднозначность (карта `:71`). Выбран путь D-1: новый sibling-резолвер `resolveSubjectPersonId` поверх существующей логики `resolveSubjectEntityId` (`entity-resolution.service.ts:908`).

---

## Scope

### Входит
- Ф1: `IdeaBlock.commitmentAuthorPersonId` (Prisma поле + relation + `@@index`), prisma db push + generate.
- Ф2: заполнение автора при ingest (детерминированно) + опц. расширение subject-набора на `commitment` (для клонов) + идемпотентный backfill истории + регистрация в `apply-prod-deploy.ts` STEPS.
- Ф3: `commitment-reliability` — новый scope-режим по автору/исполнителю (новый `buildWhere`), без слома существующего person=получатель.
- Ф4: backend эндпоинт + сервис недельной агрегации по `personId`: дал/сдержал/просрочил обещания (по автору) + выполненные задачи (`Task.assigneeUserId`) + чек-ины; дозированная выдача топ-5/топ-5.
- Ф5: фронт-виджет недельного план-факта по людям + drill-down + интеграция в «Недельную сводку».

### Не входит
- Финансовые KPI любого рода (выручка/маржа/деньги) — вне продукта.
- Редизайн «Недельной сводки» (markdown, светофор срочности, кнопки действий, русификация `pts`/`pp`) → **ТЗ-C** (`plans/tz/2026-06-05-operations-dashboards-redesign.md`). ТЗ-D добавляет только виджет план-факта.
- Изменение `Goal.ownerPersonId` / `Goal.isPrimary` → **ТЗ-F / ТЗ-B** (общая схема, см. координацию).
- Личный кабинет «Я» и self-режим обещаний → **ТЗ-E** (`plans/tz/2026-06-05-personal-cabinet-me.md`).
- Векторный компас → **ТЗ-B**.
- Перенос commitment-reliability на новый scope по умолчанию в существующих вызовах — НЕ делаем; новый режим — opt-in параметром, существующее поведение не меняется.

---

## Граничные контракты с другими ТЗ

- **Схему `schema.prisma` трогают также ТЗ-B (`Goal.isPrimary`) и ТЗ-F (`Goal.ownerPersonId`)** — выполнять последовательно (карта `:34`). ТЗ-D добавляет **только** `IdeaBlock.commitmentAuthorPersonId` — перед правкой re-Read `model IdeaBlock` (около `schema.prisma:2950`) и НЕ перезатирать чужие поля. Своё поле кладём рядом с `commitmentRecipientPersonId` (`:2984`).
- **НЕ трогать** `linkCommitmentRecipient` (`block-ingest.worker.ts:1195`) — это адресат, чужой контракт.
- **НЕ менять** существующее поведение `commitment-reliability.service.ts` scope=person (получатель) — добавляем новый режим параметром, существующие вызовы (`DirectorDashboardController`) остаются на получателе.
- **НЕ менять** department-агрегацию `weekly-digest.service.ts:821` (`computeTeamDynamics`) — новый сервис по людям отдельный.
- Расширение `REASONING_SUBJECT_SIGNAL_TYPES` на `'commitment'` (опц., Ф2) — это **чужой по смыслу** набор (клоны). Делаем за отдельным флагом, чтобы не раздуть subject-атрибуцию неожиданно; основной путь Ф2 — `commitmentAuthorPersonId`, не subject.

---

## Контракт-first (единый источник правды фронт↔бэк)

### 1. Prisma — новое поле `IdeaBlock.commitmentAuthorPersonId` (Ф1)

Добавить в `model IdeaBlock` рядом с `commitmentRecipientPersonId` (`schema.prisma:2984`):

```prisma
  /// ТЗ-D (2026-06-05) — АВТОР обещания (кто дал слово), Person той же Org.
  /// Заполняется ТОЛЬКО для блоков signalType='commitment'. Для остальных
  /// типов всегда NULL. В отличие от commitmentRecipientPersonId (fuzzy по
  /// имени от LLM), автор заполняется ДЕТЕРМИНИРОВАННО по identity спикера
  /// сегмента (speakerParticipantId) или payload.userId — резолвер
  /// EntityResolutionService.resolveSubjectPersonId. NULL если identity не
  /// разрешилась. Атрибуция БЕЗ LLM — prompt-cache сохранён.
  commitmentAuthorPersonId    String?
```

В блок relation'ов `model IdeaBlock` (рядом с `commitmentRecipient`, `schema.prisma:3033`):

```prisma
  /// ТЗ-D — автор обещания (для блоков signalType='commitment').
  commitmentAuthor    Person?              @relation("CommitmentAuthor", fields: [commitmentAuthorPersonId], references: [id], onDelete: SetNull)
```

В `model Person` добавить обратную сторону relation (рядом с `CommitmentRecipient`-обраткой; найти `@relation("CommitmentRecipient")` в Person и положить рядом):

```prisma
  /// ТЗ-D — обещания, ДАННЫЕ этим человеком (автор).
  commitmentsAuthored   IdeaBlock[]        @relation("CommitmentAuthor")
```

Новый индекс в `@@index`-блоке `model IdeaBlock` (после `:3043`):

```prisma
  /// ТЗ-D — выборка «обещания, данные человеком» (план-факт по автору).
  @@index([tenantId, commitmentAuthorPersonId])
  /// ТЗ-D — план-факт за неделю: автор × статус × срок.
  @@index([tenantId, signalType, commitmentAuthorPersonId, commitmentDueDate])
```

После правки: `bun run prisma:push` затем `bun run prisma:generate` (НИКОГДА `prisma migrate*`).

### 2. Резолвер Person id автора (Ф2) — `entity-resolution.service.ts`

Новый метод-sibling рядом с `resolveSubjectEntityId` (`:908`). Возвращает **Person id** (не Entity id), переиспользует те же 3 источника identity:

```ts
/**
 * ТЗ-D — детерминированный резолв АВТОРА обещания в Person id.
 * Зеркало resolveSubjectEntityId, но возвращает person.id (поле
 * IdeaBlock.commitmentAuthorPersonId ссылается на Person, не Entity).
 * Приоритет: authorUserId → speakerParticipantId → speakerName.
 * NULL если identity не разрешилась (best-effort, не валит ingest).
 */
async resolveSubjectPersonId(
  tenantId: string,
  input: {
    speakerParticipantId?: string | null;
    speakerName?: string | null;
    authorUserId?: string | null;
  },
): Promise<string | null>
```

Логика — 1:1 копия первых трёх блоков `resolveSubjectEntityId` (`:924-969`), но вместо `personToEntity(p)` возвращаем `p.id`. Для `deletedAt`-проверок — те же условия.

### 3. Заполнение автора при ingest (Ф2) — `block-ingest.worker.ts`

В `persistBlock` рядом с `linkCommitmentRecipient` (`:949-964`) добавить для `isCommitment`:

```ts
// ТЗ-D — детерминированная атрибуция АВТОРА обещания (по identity спикера).
// Best-effort: ошибка/выключенный kill-switch не валит persist.
// LLM-промпт НЕ трогается. Под флагом knowledge.commitmentAuthorAttributionEnabled.
if (isCommitment && blockId) {
  await this.attributeCommitmentAuthor({
    event, block, blockId, segments: args.segments, authorUserId: args.authorUserId,
  }).catch((err) => {
    this.logger.warn(
      { blockId, err: err instanceof Error ? err.message : String(err) },
      'block-ingest: атрибуция автора обещания не удалась — пропуск',
    );
  });
}
```

Новый приватный метод `attributeCommitmentAuthor` — зеркало `attributeSubject` (`:1017`), но:
- источник identity тот же (seg по таймкоду evidence / authorUserId);
- вызывает `resolveSubjectPersonId` (не `resolveSubjectEntityId`);
- пишет `prisma.ideaBlock.update({ where: { id: blockId }, data: { commitmentAuthorPersonId: personId } })` (как `linkCommitmentRecipient:1246`);
- kill-switch — AdminSetting `knowledge.commitmentAuthorAttributionEnabled` (code-fallback `true`), читать через `cfg.getDynamic`.

Опц. (за отдельным флагом `knowledge.commitmentInSubjectSet`, default `false`): расширить `REASONING_SUBJECT_SIGNAL_TYPES` (`:53`) на `'commitment'` — но это для клонов, НЕ основной путь Ф2; не включать по умолчанию.

### 4. Backfill истории (Ф2) — `backend/scripts/backfill-commitment-author.ts`

По образцу `backfill-subject-attribution.ts`. Отличия:
- `blockWhere`: `{ signalType: 'commitment', commitmentAuthorPersonId: null, status: 'canonical', ...tenant }`.
- резолв через `resolveSubjectPersonId`; запись через `ideaBlock.update(... commitmentAuthorPersonId)`.
- идемпотентность: `where: { commitmentAuthorPersonId: null }` ⇒ повторный прогон no-op; флаги `--dry-run` / `--tenant=` / `--limit=` сохранить.
- `createPrismaClient()` из `./_lib/prisma`, импорты из `../src` (НИКОГДА `new PrismaClient()`).
- ре-enqueue клонов НЕ нужен (это не subject) — Stats только scanned/attributed/skipped.

Регистрация в `apply-prod-deploy.ts` STEPS после `backfill-subject-attribution` (`:365`):

```ts
{
  phase: 'backfill',
  script: 'scripts/backfill-commitment-author.ts',
  hint: 'ТЗ-D: заполнение commitmentAuthorPersonId для исторических обещаний',
  skipBootstrap: true,
},
```

### 5. commitment-reliability — новый scope-режим (Ф3)

`CommitmentReliabilityArgs` (`commitment-reliability.service.ts:46`) расширить опциональным дискриминатором:

```ts
export interface CommitmentReliabilityArgs {
  tenantId: string;
  scope: 'company' | 'team' | 'person';
  scopeId?: string;
  windowDays?: number;
  /** ТЗ-D — для scope='person': по кому считать. Default 'recipient'
   *  (обратная совместимость). 'author' — обещания, ДАННЫЕ человеком. */
  personMode?: 'recipient' | 'author';
}
```

`buildWhere` (`:239`) для `scope==='person'`:

```ts
if (args.scope === 'person') {
  if (args.personMode === 'author') {
    return { ...base, commitmentAuthorPersonId: args.scopeId };
  }
  return { ...base, commitmentRecipientPersonId: args.scopeId };
}
```

`buildCacheKey` (`:135`) — включить `personMode` в ключ, чтобы author/recipient не делили кэш:
`commit_reliability:${tenantId}:${scope}:${scopeId}:${windowDays}:${personMode ?? 'recipient'}`.
Существующие вызовы (`DirectorDashboardController`) `personMode` не передают ⇒ остаются на получателе (ключ совместим — суффикс `recipient` стабилен).

### 6. Новый эндпоинт недельной агрегации по людям (Ф4)

`backend/src/modules/operations/controllers/weekly-per-person.controller.ts`:

```
GET /api/v1/dashboard/operations/weekly-per-person?weekStart=YYYY-MM-DD&limit=5&offset=0&sort=reliability
  Auth: CookieAuthGuard + TenantGuard + canViewOperationsDashboard
  → 200 WeeklyPerPersonDto
  → 400 { ok:false, error:{ code:'tenant_required' } }       — нет tenantId
  → 400 { ok:false, error:{ code:'invalid_week_start' } }     — weekStart не YYYY-MM-DD
  → 403 { ok:false, error:{ code:'forbidden_role' } }         — нет доступа к операциям
```

Zod-DTO `weekly-per-person.dto.ts`:

```ts
export const WeeklyPerPersonQuerySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_week_start'),
  limit: z.coerce.number().int().min(1).max(100).default(5),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(['reliability', 'risk']).default('reliability'),
});
export type WeeklyPerPersonQuery = z.infer<typeof WeeklyPerPersonQuerySchema>;

/** Строка план-факта по одному человеку за неделю. */
export interface WeeklyPersonRowDto {
  personId: string;
  personName: string;
  departmentName: string | null;
  /** Обещания, ДАННЫЕ человеком (по commitmentAuthorPersonId). */
  promisesGiven: number;       // всего обещаний-автора, попавших в неделю по сроку
  promisesKept: number;        // commitmentStatus='fulfilled'
  promisesBroken: number;      // commitmentStatus='missed'
  promisesOverdue: number;     // open|asked AND срок < now
  /** kept / max(1, kept+broken+overdue) * 100; null если знаменатель=0. */
  reliabilityPercent: number | null;
  /** Закрытые задачи (Task.assigneeUserId через Person.userId), status='done'/закрыта в неделю. */
  tasksDone: number;
  /** Завершённые чек-ины (DailyCheckIn.completedAt в неделю). */
  checkInsCompleted: number;
}

export interface WeeklyPerPersonDto {
  weekStart: string;           // YYYY-MM-DD (понедельник)
  weekEnd: string;             // YYYY-MM-DD (воскресенье)
  generatedAt: string;         // ISO — момент расчёта (свежесть)
  total: number;               // всего людей с активностью за неделю
  /** Топ-5 «держат слово» (reliability desc, при равенстве — promisesKept desc). */
  topReliable: WeeklyPersonRowDto[];
  /** Топ-5 «зоны риска» (broken+overdue desc, при равенстве — reliability asc). */
  topRisk: WeeklyPersonRowDto[];
  /** Полный список (для drill-down), пагинированный limit/offset по sort. */
  rows: WeeklyPersonRowDto[];
}
```

Сервис `weekly-per-person.service.ts`:
- одна выборка `ideaBlock.findMany({ where: { tenantId, signalType:'commitment', commitmentAuthorPersonId: { not: null }, commitmentDueDate: { gte: weekStart, lte: weekEnd } }, select: { commitmentAuthorPersonId, commitmentStatus, commitmentDueDate } })` — расклад по автору (использует индекс п.1);
- задачи: `task.findMany` по `assigneeUserId in (userIds недели)` со статусом-закрытия в окне; мапинг `userId→personId` через `Person.userId`;
- чек-ины: `dailyCheckIn` по `personId` с `completedAt` в окне;
- `topReliable`/`topRisk` отбираются по D-3; `rows` — пагинация;
- кэш Redis TTL 5 мин (паттерн `commitment-reliability.service.ts:159`), ключ `weekly_per_person:${tenantId}:${weekStart}:${sort}:${limit}:${offset}`.
- `topReliable`/`topRisk` считаются всегда от полного множества (не от страницы).

### 7. ASCII-поток

```
встреча/чат → RawEvent → block-ingest.worker (persistBlock)
                              │ isCommitment?
                              ├─ linkCommitmentRecipient (адресат, fuzzy)   [НЕ трогаем]
                              └─ attributeCommitmentAuthor (автор, ДЕТЕРМИНИРОВАННО)
                                     │ resolveSubjectPersonId(identity сегмента / payload.userId)
                                     ▼
                          IdeaBlock.commitmentAuthorPersonId = personId   [Ф1/Ф2]
                                     │
  ┌──────────────────────────────────┼──────────────────────────────────┐
  ▼                                   ▼                                   ▼
commitment-reliability            weekly-per-person.service          backfill-commitment-author
(scope=person, personMode=author) (агрегация по автору + Task         (история, идемпотентно)
   [Ф3]                            .assigneeUserId + DailyCheckIn)
                                       │  [Ф4]
                                       ▼
                          GET /dashboard/operations/weekly-per-person
                                       │
                                       ▼
                          WeeklyPerPersonWidget → «Недельная сводка»   [Ф5]
```

---

## Границы автономии (локально для фичи)

**✅ Always**
- Добавлять `commitmentAuthorPersonId` + индексы + relation (Р4).
- Писать новый sibling-резолвер `resolveSubjectPersonId` (не меняя `resolveSubjectEntityId`).
- Новый сервис/контроллер/DTO/виджет план-факта.
- Идемпотентный backfill + регистрация в STEPS.

**⚠️ Ask first**
- Включение `knowledge.commitmentInSubjectSet` по умолчанию (расширение subject-набора на `commitment`) — затрагивает клоны, по умолчанию OFF.
- Любая правка SYSTEM-промптов (по умолчанию НЕ нужна — атрибуция детерминированная).
- Перевод существующих вызовов commitment-reliability на `personMode='author'` по умолчанию.

**🚫 Never**
- `prisma migrate*` (только `prisma:push`).
- `new PrismaClient()` в скриптах (только `createPrismaClient()`).
- Финансовые поля/метрики.
- Англоязычный текст в UI.
- Трогать `linkCommitmentRecipient` / department-агрегацию `computeTeamDynamics`.

---

## Фазы

Граф зависимостей: **Ф1 → Ф2 → Ф3 → Ф4 → Ф5**. Ф3 зависит только от Ф1 (поле), Ф4 зависит от Ф1 (поле) + Ф3 (опц., если переиспользует buildWhere). Линейный порядок безопасен.

| Фаза | Зависит от | Тема |
|---|---|---|
| Ф1 | — | Prisma `commitmentAuthorPersonId` + db push |
| Ф2 | Ф1 | Заполнение автора (ingest + backfill) |
| Ф3 | Ф1 | commitment-reliability scope по автору |
| Ф4 | Ф1 (Ф3) | Эндпоинт+сервис недельной агрегации |
| Ф5 | Ф4 | Фронт-виджет + интеграция |

### Ф1 — Prisma: `commitmentAuthorPersonId` + db push
**Цель:** появилось поле автора обещания со связью и индексами.
**Что входит:** правки `model IdeaBlock` и `model Person` (см. Контракт §1); `bun run prisma:push` + `bun run prisma:generate`.
**Что НЕ входит:** заполнение значения (Ф2), любые `Goal.*` поля (ТЗ-B/F).
**Файлы:** `backend/prisma/schema.prisma` — `model IdeaBlock` (около `:2950`, поле рядом с `commitmentRecipientPersonId:2984`, relation рядом с `:3033`, `@@index` после `:3043`); `model Person` (около `:4339`, обратка рядом с `CommitmentRecipient`-обраткой).
**Зависимости:** перед правкой re-Read схему (координация: ТЗ-B/F тоже её трогают).
**Acceptance:**
- grep `commitmentAuthorPersonId` в `schema.prisma` ⇒ ≥1 (поле) + индексы.
- grep `@relation("CommitmentAuthor"` ⇒ 2 (IdeaBlock + Person).
- grep `@@index(\[tenantId, commitmentAuthorPersonId\]` ⇒ ≥1.
- `bun run prisma:generate` без ошибок; `bun run typecheck` зелёный.
**Тесты:** не требуются (схема). Косвенно проверяется Ф2/Ф3 спеками.
**Закрывает: R1**

### Ф2 — Заполнение автора (ingest + backfill)
**Цель:** новые обещания получают автора детерминированно; история заполнена идемпотентным backfill'ом.
**Что входит:** `resolveSubjectPersonId` (Контракт §2); `attributeCommitmentAuthor` в воркере + вызов рядом с `linkCommitmentRecipient` (§3) под флагом `knowledge.commitmentAuthorAttributionEnabled` (code-fallback `true`); `backfill-commitment-author.ts` (§4) + регистрация в STEPS.
**Что НЕ входит:** включение `knowledge.commitmentInSubjectSet` (⚠️ Ask first, OFF); правка SYSTEM-промптов.
**Файлы:** `entity-resolution.service.ts` (новый метод рядом с `:908`); `block-ingest.worker.ts` (вызов рядом с `:949`, метод рядом с `:1017`); `backend/scripts/backfill-commitment-author.ts` (новый); `backend/scripts/apply-prod-deploy.ts` (STEPS после `:365`).
**Зависимости:** Ф1.
**Acceptance:**
- grep `resolveSubjectPersonId` в `entity-resolution.service.ts` ⇒ ≥1.
- grep `attributeCommitmentAuthor` в `block-ingest.worker.ts` ⇒ ≥2 (вызов + метод).
- grep `commitmentAuthorAttributionEnabled` в воркере ⇒ ≥1.
- grep `createPrismaClient` в `backfill-commitment-author.ts` ⇒ ≥1; grep `new PrismaClient` ⇒ 0.
- grep `backfill-commitment-author` в `apply-prod-deploy.ts` ⇒ 1.
- Идемпотентность (вход→выход): backfill на наборе из 1 commitment-блока с разрешимым автором → 1-й прогон `attributed=1`, 2-й прогон (где `commitmentAuthorPersonId IS NULL` уже не выберет) `scanned=0, attributed=0`.
- `bunx vitest run backend/src/modules/knowledge-core/services/entity-resolution.service.spec.ts` (новый кейс: author по `speakerParticipantId` и по `authorUserId`) зелёный.
**Тесты:** unit на `resolveSubjectPersonId` (3 источника + null); unit на идемпотентность backfill (mock prisma: повторный прогон не пишет).
**Закрывает: R2, R3**

### Ф3 — commitment-reliability: scope по автору
**Цель:** «Надёжность обещаний» можно считать по тому, КТО обещал, не только кому.
**Что входит:** `personMode` в `CommitmentReliabilityArgs`; ветка в `buildWhere`; `personMode` в `buildCacheKey` (Контракт §5).
**Что НЕ входит:** смена дефолта существующих вызовов на `author` (⚠️ Ask first); team-scope по автору (vNext — пока team остаётся по получателю).
**Файлы:** `commitment-reliability.service.ts:46` (args), `:135` (cache key), `:239-260` (buildWhere).
**Зависимости:** Ф1.
**Acceptance:**
- grep `personMode` в `commitment-reliability.service.ts` ⇒ ≥3 (тип, ключ, where).
- grep `commitmentAuthorPersonId` в том же файле ⇒ ≥1.
- Вход→выход: `getReliability({ scope:'person', scopeId:'P1', personMode:'author' })` фильтрует по `commitmentAuthorPersonId='P1'`; без `personMode` — по `commitmentRecipientPersonId` (обратная совместимость).
- Негатив: `scope:'person'` без `scopeId` → `BadRequestException('scope_id_required')` (поведение `:130` не сломано).
- `bunx vitest run backend/src/modules/dashboard/services/commitment-reliability.service.spec.ts` зелёный (+ кейс author-режима).
**Тесты:** unit на buildWhere обоих режимов; кэш-ключ author≠recipient.
**Закрывает: R4**

### Ф4 — Backend эндпоинт+сервис недельной агрегации
**Цель:** один запрос отдаёт план-факт по людям за неделю: дал/сдержал/просрочил + задачи + чек-ины, дозированно топ-5/топ-5 + полный список.
**Что входит:** `weekly-per-person.dto.ts`, `weekly-per-person.service.ts`, `weekly-per-person.controller.ts` (Контракт §6); регистрация в `operations.module.ts` (controllers + providers).
**Что НЕ входит:** фронт (Ф5); финансы; пере-генерация (read-only).
**Файлы:** новые `backend/src/modules/operations/dto/weekly-per-person.dto.ts`, `.../services/weekly-per-person.service.ts`, `.../controllers/weekly-per-person.controller.ts`; `operations.module.ts:73` (controllers), `:84` (providers).
**Зависимости:** Ф1 (поле), Ф3 (опц. переиспользование). Данные: `Task.assigneeUserId` (`schema.prisma:1513`), `DailyCheckIn.completedAt` (`:6392`), `Person.userId` (`:4346`).
**Acceptance:**
- grep `weekly-per-person` в `operations.module.ts` ⇒ ≥2 (controller + service import).
- grep `commitmentAuthorPersonId` в `weekly-per-person.service.ts` ⇒ ≥1.
- grep `assigneeUserId` в `weekly-per-person.service.ts` ⇒ ≥1.
- grep `topReliable` и `topRisk` в `weekly-per-person.dto.ts` ⇒ по ≥1.
- Swagger smoke: тег `dashboard-operations-weekly-per-person` присутствует в `/api/docs`.
- Вход→выход: `GET ?weekStart=2026-06-01&limit=5&sort=reliability` → `200` с `topReliable.length≤5`, `topRisk.length≤5`, `rows.length≤5`, `total≥0`, `generatedAt` ISO.
- Негатив: `weekStart=2026/06/01` → `400 invalid_week_start`; без tenant-header → `400 tenant_required`; роль без операций → `403 forbidden_role`.
- `bunx vitest run backend/src/modules/operations/services/weekly-per-person.service.spec.ts` зелёный.
**Тесты:** unit на сервис (фикстуры: 3 человека, разные kept/broken/overdue/tasks/checkins → корректные top-5 и reliability); контроллер-спека на коды ошибок.
**Закрывает: R5, R6, R7, R8**

### Ф5 — Фронт-виджет + интеграция
**Цель:** в «Недельной сводке» видно топ-5 «держат слово» / топ-5 «зоны риска» с drill-down на полный список.
**Что входит:** `weekly-per-person.api.ts` (ApiDto + вызов), domain-маппер, `WeeklyPerPersonWidget` (UiModel), drill-down (полный список через limit/offset), встраивание в `WeeklyDigestClient.tsx`.
**Что НЕ входит:** редизайн самой сводки (markdown/светофор/кнопки → ТЗ-C); финансы; англ. текст.
**Файлы:** новые `frontend/src/api/weekly-per-person.api.ts`, `frontend/src/domain/weekly-per-person.ts`, `frontend/app/(authenticated)/dashboard/operations/weekly/WeeklyPerPersonWidget.tsx`; правка `frontend/app/(authenticated)/dashboard/operations/weekly/WeeklyDigestClient.tsx`.
**Зависимости:** Ф4.
**Acceptance:**
- grep `weekly-per-person` в `frontend/src/api/weekly-per-person.api.ts` ⇒ ≥1.
- grep `WeeklyPerPersonWidget` в `WeeklyDigestClient.tsx` ⇒ ≥1.
- В виджете ни одного англ. слова для пользователя (заголовки: «Держат слово», «Зоны риска», «Дал», «Сдержал», «Просрочил», «Задачи», «Чек-ины»); парные токены `bg-{c}`/`text-{c}-fg`, без `text-white`/hex/`slate-`.
- Drill-down открывает полный список (limit/offset), пустое состояние человеческим текстом.
- `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные.
**Тесты:** `frontend ... bun run test:unit` для domain-маппера (ApiDto→UiModel: проценты, склонения).
**Закрывает: R9, R10**

---

## Требования (EARS) + трассировка

| R | Формулировка | Фаза |
|---|---|---|
| R1 | Когда применяется схема, система shall иметь `IdeaBlock.commitmentAuthorPersonId String?` с relation `CommitmentAuthor` (onDelete SetNull) и `@@index([tenantId, commitmentAuthorPersonId])`. | Ф1 |
| R2 | Когда block-ingest сохраняет блок с `signalType='commitment'` и identity спикера/автора разрешается, система shall записать `commitmentAuthorPersonId = resolveSubjectPersonId(identity)`; если identity не разрешилась — оставить NULL и не падать. | Ф2 |
| R3 | Когда backfill запущен повторно, система shall не изменять уже заполненные `commitmentAuthorPersonId` (выборка `WHERE commitmentAuthorPersonId IS NULL`), т.е. 2-й прогон даёт `attributed=0`. | Ф2 |
| R4 | Когда вызван `getReliability({ scope:'person', personMode:'author', scopeId })`, система shall фильтровать по `commitmentAuthorPersonId=scopeId`; при отсутствии `personMode` — по `commitmentRecipientPersonId` (без изменения существующего поведения). | Ф3 |
| R5 | Когда вызван `GET /dashboard/operations/weekly-per-person?weekStart=<понедельник>`, система shall вернуть для каждого человека за неделю: `promisesGiven/Kept/Broken/Overdue`, `reliabilityPercent`, `tasksDone` (по `Task.assigneeUserId`), `checkInsCompleted` (по `DailyCheckIn.completedAt`). | Ф4 |
| R6 | Когда формируется ответ, система shall вернуть `topReliable` (≤5, reliability desc) и `topRisk` (≤5, broken+overdue desc), вычисленные от полного множества людей недели, а `rows` — пагинированный по `limit/offset/sort`. | Ф4 |
| R7 | Когда `weekStart` не соответствует `^\d{4}-\d{2}-\d{2}$`, система shall вернуть `400 invalid_week_start`; когда нет tenant-header — `400 tenant_required`; когда роль без доступа к операциям — `403 forbidden_role`. | Ф4 |
| R8 | Когда у человека знаменатель обещаний за неделю = 0, система shall вернуть `reliabilityPercent = null` (не 0 и не делить на ноль). | Ф4 |
| R9 | Когда руководитель открывает «Недельную сводку», система shall показать виджет план-факта по людям (топ-5/топ-5) с заголовками на русском без англ. слов и парными цветовыми токенами. | Ф5 |
| R10 | Когда руководитель нажимает на drill-down, система shall открыть полный список людей (через limit/offset) с человеческим пустым состоянием при отсутствии данных. | Ф5 |

---

## Совместимость с prompt caching

Атрибуция автора **детерминированная** (по identity сегмента / `payload.userId`), LLM не вызывается. SYSTEM-промпты (`block-distill`, `block-ingest-v2` и др.) **не трогаются** — prompt-cache DeepSeek/OpenAI-proxy сохранён на 100%. Опц. расширение subject-набора на `commitment` (за флагом, OFF) тоже не меняет промпты. **Раздел релевантен: гарантия — ни одной правки SYSTEM.**

---

## Pre-mortem / Риски + ревью-аспекты

- **Двойная атрибуция (subject + author) для commitment-блоков.** Если включить `knowledge.commitmentInSubjectSet`, один блок получит и `role='subject'`, и `commitmentAuthorPersonId` — это ОК (разные потребители), но default OFF, чтобы не раздуть клоны неожиданно.
- **`Task.assigneeUserId` — это User, не Person.** Риск пустого пересечения, если у Person нет `userId`. Митигировать: мапить через `Person.userId IS NOT NULL`; люди без User в `tasksDone` дают 0 (честно, не падаем).
- **Кэш-коллизия author/recipient.** Решено включением `personMode` в cache key (§5) — ревьюеру проверить.
- **Производительность недельной выборки.** Один `findMany` по новому индексу `[tenantId, signalType, commitmentAuthorPersonId, commitmentDueDate]` + раскладка в JS (паттерн `commitment-reliability:184`); кэш 5 мин. Нет N+1.
- **Multi-tenancy.** Все выборки фильтруют `tenantId`; новые индексы — `@@index([tenantId, …])`.
- **Backfill на больших объёмах.** Курсорная пагинация (`BATCH_SIZE=200`), `--limit`/`--tenant` для дозированного прогона; идемпотентность по `IS NULL`.
- **Ревью strict-production-review-gate:** проверить, что существующие вызовы commitment-reliability не сменили семантику; что backfill не пишет при `commitmentAuthorPersonId` уже заполнен; что эндпоинт под `canViewOperationsDashboard`.

---

## Idempotency / feature-flag / prod-deploy

- **Feature-flag (AdminSetting, super_admin, history+audit):** `knowledge.commitmentAuthorAttributionEnabled` (code-fallback `true`, kill-switch для атрибуции автора); `knowledge.commitmentInSubjectSet` (code-fallback `false`, OFF по умолчанию). Не ENV, не хардкод — через `cfg.getDynamic`.
- **Идемпотентность:** backfill — `WHERE commitmentAuthorPersonId IS NULL`; повторный прогон no-op (acceptance R3).
- **Затронутые шаги `docs/operations/prod-deploy-log.md`:**
  - **Шаг 4** — `schema.prisma`: новое поле `IdeaBlock.commitmentAuthorPersonId` + 2 индекса (prisma push, не migrate).
  - **Шаг 1** — AdminSetting: добавить дефолты `knowledge.commitmentAuthorAttributionEnabled=true`, `knowledge.commitmentInSubjectSet=false` (через seed-admin-settings или seed-скрипт; зарегистрировать в STEPS если новый seed).
  - **Шаг 8** — backfill: `scripts/backfill-commitment-author.ts` (зарегистрирован в `apply-prod-deploy.ts` STEPS, phase `backfill`, `skipBootstrap`).
  - **Шаг 12** — smoke: Swagger-тег `dashboard-operations-weekly-per-person`; новый эндпоинт `GET /api/v1/dashboard/operations/weekly-per-person`.

---

## DoD

- `cd backend && bun run typecheck` (вкл. `.spec`) / `bun run lint` / `bun run build` зелёные.
- `bunx vitest run` для новых/затронутых спек (entity-resolution, commitment-reliability, weekly-per-person service+controller) зелёные.
- `cd frontend && bun run typecheck && bun run lint && bun run build && bun run test:unit` зелёные.
- **second-brain (таблица производных заметок):** новая колонка в БД → `02_architecture/data-model.md` + prod-deploy-log Шаг 4; новый API-эндпоинт → `01_projects/api-layer.md` + prod-deploy-log Шаг 12; новый backfill → prod-deploy-log Шаг 8; новый ENV/AdminSetting → prod-deploy-log Шаг 1; профильная заметка по фиче (обещания/план-факт) обновлена.
- `docs/operations/prod-deploy-log.md` — записи в Шагах 1/4/8/12; блок «Prod-инструкция» в чате после push.
- Рефлексия в `second-brain/05_история/`.

---

## Итог

- [ ] Ф1 — Prisma `commitmentAuthorPersonId` + db push
- [ ] Ф2 — Заполнение автора (ingest + backfill)
- [ ] Ф3 — commitment-reliability scope по автору
- [ ] Ф4 — Backend эндпоинт+сервис недельной агрегации
- [ ] Ф5 — Фронт-виджет + интеграция в «Недельную сводку»
