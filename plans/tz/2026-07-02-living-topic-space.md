---
type: tz
status: ready-to-implement
feature: living-topic-space
date: 2026-07-02
owner: Сергей (владелец продукта)
relates_to:
  - plans/architecture/2026-07-02-living-topic-space.md
  - plans/analysis/2026-07-02-living-topic-space.md
  - plans/analysis/2026-07-02-notion-agent-teardown-and-borrow.md
  - plans/analysis/2026-07-02-expert-ideas-backlog-kora-strengthening.md
---
> Архитектура (одобрена владельцем 2026-07-02): `plans/architecture/2026-07-02-living-topic-space.md` · Анализ: `plans/analysis/2026-07-02-living-topic-space.md` · Статус согласования: approved 2026-07-02.

# ТЗ — «Живое пространство темы» (living-topic-space)

**Принцип.** Менеджер заводит свою тему словами → Кора семантически предлагает релевантный контент в статусе «предложено» → менеджер подтверждает/отклоняет/пинит → тема показывается живой читаемой страницей. Ядро: **«ИИ предложил — человек подтвердил и владеет» (HITL)**, не «ИИ сам раскидал». Переиспользуем существующий движок Theme, ничего умного с нуля не плодим.

## Вне scope / отложено владельцем (vNext)
- **«Пульс темы для руководителя»** (срез письма COO на уровень темы) — vNext, отдельным ТЗ (В3). Здесь только лицо менеджера.
- **No-code конструктор правил-автоматизаций на тему** («когда X → сделай Y») — отдельная фича (см. банк идей), не здесь.
- **Встройка темы во вкладку проекта трекера** — vNext; первый дом фичи — раздел «Темы» (Р5).
- **Дизайн-полировка** (цвета/шрифты/анимации) — после ТЗ, скилл `frontend-design`/`impeccable`. Здесь — UI-контракт и состояния.

---

## Цель + Зачем
Менеджер SMB не может собрать всё по клиенту/проекту в одном месте без ручного тегирования; в Notion/аналогах это держится на дисциплине и разваливается за 3–6 недель (см. [[../analysis/2026-07-02-notion-agent-teardown-and-borrow]]). У Коры движок авто-сбора тем есть, но темы рождаются только машиной, read-only, вид сырой. Даём менеджеру **его** тему, которая **сама наполняется** (предложениями) и **красиво читается**. Отстройка: авто-стекание на **командном** графе + владение через HITL — чего single-user PKM и РФ-аналоги не делают.

## REALITY-CHECK (факт по коду на 2026-07-02)
- **Есть и переиспользуется:** модель `Theme` [backend/prisma/schema.prisma:4393] с `embedding vector(1536)`, `summary`, связями `ThemeIdeaBlock`/`ThemeEntity`/`Document.attachedThemeId`/`Card`/`GoalTheme`; воркеры `theme-clusterer.cron.ts` (embedding→`clusterByEmbedding`→создание темы + `themeIdeaBlock.createMany`), `theme-summarize.cron.ts` (инкрементальный `summary`), `theme-classification.service.ts` (LLM name/description/branch через `llm-router` taskType `theme-classify`), `KnowledgeEmbeddingService.embedQuery` (используется clusterer'ом, `theme-clusterer.cron.ts:248`).
- **Read-API готов, писать нечем:** `KnowledgeThemesController` [themes.controller.ts:50] — `GET /api/v1/knowledge/themes` (list), `GET :id` (byId), `POST :id/save-as-card`. Guards `CookieAuthGuard, TenantGuard`, `@RequireEntitlement('feature.theme')`, доступ через `rbac.canRead(user.id, tenantId, 'theme')`, tenant из `@CurrentOrg()`, коды ошибок `tenant_required`/`forbidden`. DTO — `theme.dto.ts` (`ThemeItemDto`, `ThemeDetailDto`, `ListThemesQuerySchema`).
- **Нет:** пользовательского создания темы, статуса привязки «предложено/подтверждено», провенанса предложения, живого вида, моста к задачам. `origin`/`createdByUserId`/`visibility` у `Theme` отсутствуют.
- **Ядро retrieval доведено 2026-07-02** (H3 закрыт, резолв людей/клон-коллапс починены — [[../../second-brain/05_история/2026-07-02-retest-fixes-a-e-i-dashboardy-nedelya-mesyac]]). Фича НЕ блокирована. Остаточное ограничение — диаризация «кто сказал» (~30%) → авторство/привязку подаём через HITL, не как факт.
- **Партиционирование:** `IdeaBlock`/`Entity` партиционированы по `tenantId`; составные FK требуют `tenantId`-компаньон (урок Пакета A, `937bf7b8`). Новая таблица `ThemeSuggestion` обязана нести `tenantId` в каждом FK.

## Принятые решения владельца (не пересматривать)
| # | Решение | Обоснование |
|---|---|---|
| Р1 | Тема-от-человека — та же `Theme` с полями `origin(auto\|user)` + `createdByUserId` + `visibility(personal\|team)`, НЕ новая сущность | Сразу получает весь движок (наполнение/summary/сущности/документы); не строим второй механизм |
| Р2 | Контент приходит в тему через «предложено → подтверди» (HITL), не молча | Рынок платит за контроль/владение; на живой речи привязка ошибается — подтверждение страхует |
| Р3 | Неуверенные предложения по умолчанию НЕ отмечены | Лучше пропустить, чем засорить тему |
| Р4 | Всегда показываем «почему предложено» (упоминания/участники/score) | Снимает страх «ИИ выдумал», растит доверие (провенанс = ров) |
| Р5 | Первый дом — раздел «Темы» | Дешевле/быстрее; экран и данные уже есть |
| В1 | Личные темы — любой сотрудник; командную (видит вся компания) — менеджер+ | Личные = вовлечение снизу; командная затрагивает доступ → право у́же (решение владельца про доступ) |
| В2 | Бейдж «N новое» тихо копит + 1 ненавязчивое напоминание/день | Проактивность полезна, спам бесит SMB |
| В3 | Первая версия — лицо менеджера; пульс руководителю — vNext | Живой вид важнее и он же основа пульса |

## Доказательство выбора (2 прохода + challenge-loop)

**Развилка: где хранить «предложенные» привязки.**
| Критерий | A: статус-колонка в `ThemeIdeaBlock`/`ThemeEntity` | B: отдельная таблица `ThemeSuggestion` (выбрано) |
|---|---|---|
| Не ломает существующий подтверждённый граф | ✗ clusterer и все reads/`_count` считают `ThemeIdeaBlock` как истину → «предложенное» протечёт в auto-темы, дашборд, retrieval | ✓ `ThemeIdeaBlock` остаётся «подтверждённой правдой»; предложения изолированы |
| Провенанс (score, причина) | ✗ грузим M:M-таблицу лишними полями | ✓ естественно живёт в suggestion |
| Отклонённое не переспрашивать | ✗ надо третий статус в M:M | ✓ `status=rejected` в suggestion |
| Стоимость | средняя (миграция M:M + правка всех reads) | низкая (новая таблица, reads не трогаем) |
**Вывод:** B. На accept пишем в `ThemeIdeaBlock` (как сейчас), suggestion → `accepted`. `ThemeIdeaBlock` = подтверждённый граф, `ThemeSuggestion` = очередь HITL.

**Развилка: как генерировать предложения.**
| Критерий | A: хук в ingest hot-path (per-block, `block-linker.worker`) | B: cron-скан по pgvector (выбрано, как `theme-clusterer.cron`) |
|---|---|---|
| Троттлинг/дебаунс | ✗ на каждый блок, трудно ограничить | ✓ окно+порог в кроне (крутилки) |
| User-тема создана ПОСЛЕ блоков | ✗ хук уже не сработает на старые | ✓ cron бэкфиллит естественно |
| Изоляция от горячего пути | ✗ рискует замедлить ingest | ✓ отдельный воркер |
**Вывод:** B — `theme-suggest.cron`: для каждой user-темы найти свежие `IdeaBlock` по близости к `Theme.embedding` выше порога, исключив уже привязанные/предложенные/отклонённые, создать `ThemeSuggestion`. При создании темы — тот же скан немедленно (первичный «улов»).

**Challenge-loop.** (1) Корень, не симптом: решаем весь класс «менеджеру нужна своя наполняемая тема» через переиспользование движка, а не частный «красивый вид». (2) Эффективность: cron дешевле хука, порог/окно — крутилки, не хардкод. (3) Код ради кода: не плодим сущность (Р1), не дублируем clusterer — переиспользуем `embedQuery`/summarize/reframe.

## Scope
**Входит:** пользовательские темы (create/rename/archive) с `origin/createdByUserId/visibility`; `ThemeSuggestion` + генерирующий cron + первичный улов; HITL-эндпоинты (suggestions list, confirm/reject, pin/unpin); бейдж «N новое» + 1 напоминание/день; живой вид (frontend: страница темы, экран подтверждения, флоу создания); мост «обязательство → задача»; permission (personal/team + manager+ для team); **показ регламентов/документов темы на живой странице** (переиспользуя связки `Regulation.entityId`/`Document.attachedThemeId` — первый шаг «всё знание в одном месте», ведёт к [[../architecture/2026-07-02-second-brain-by-branches]]).
**Не входит:** см. «Вне scope» выше.

## Граничные контракты
- **Мост «обязательство→задача» (Ф6)** переиспользует существующий сервис создания задачи трекера (`backend/src/modules/tracker/**` — перед реализацией перечитать актуальный сервис материализации задачи; НЕ реализовывать логику трекера заново, только вызов + связь `bornFrom`).
- **Уведомление-напоминание (Ф5)** переиспользует существующий слой destinations/нотификаций (перечитать актуальный notifications-сервис). Не вводить новый канал.
- **Retrieval «Мастера»** темы уже фильтрует — здесь только гарантируем, что personal-темы не протекают между пользователями (Ф4 acceptance).

---

## Контракты (контракт-first)

### Prisma (Ф1) — дословно, перед правкой перечитать `schema.prisma:4393` (Theme) и enum-блок `:818`
```prisma
enum ThemeOrigin {
  auto   /// рождена кластеризацией (текущее поведение)
  user   /// заведена человеком
}

enum ThemeVisibility {
  personal /// видит только автор (в рамках Org)
  team     /// видит вся компания (Org)
}

/// добавить в model Theme (schema.prisma:4393):
  origin          ThemeOrigin      @default(auto)
  createdByUserId String?
  visibility      ThemeVisibility  @default(team)
  createdByUser   User?            @relation("ThemeAuthor", fields: [createdByUserId], references: [id], onDelete: SetNull)
  suggestions     ThemeSuggestion[]
  // индекс для «мои темы»:
  @@index([tenantId, origin, createdByUserId])

/// новая таблица — очередь HITL. tenantId-компаньон обязателен (партиции IdeaBlock/Entity).
enum ThemeSuggestionStatus {
  pending
  accepted
  rejected
}

enum ThemeSuggestionKind {
  block
  entity
}

model ThemeSuggestion {
  id         String                @id @default(cuid())
  tenantId   String
  themeId    String
  kind       ThemeSuggestionKind
  blockId    String?
  entityId   String?
  score      Decimal               @db.Decimal(4, 3)   /// косинусная близость 0..1
  reason     String                @db.Text            /// человекочитаемо: «4 упоминания клиента, участник Смирнов»
  autoChecked Boolean              @default(false)     /// Р3: отмечать в UI по умолчанию только уверенные
  status     ThemeSuggestionStatus @default(pending)
  createdAt  DateTime              @default(now())
  decidedAt  DateTime?
  decidedByUserId String?

  theme  Theme      @relation(fields: [themeId], references: [id], onDelete: Cascade)
  block  IdeaBlock? @relation(fields: [blockId, tenantId], references: [id, tenantId], onDelete: Cascade)
  entity Entity?    @relation(fields: [entityId, tenantId], references: [id, tenantId], onDelete: Cascade)
  org    Org        @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([themeId, kind, blockId, entityId])   /// идемпотентность: одно предложение на (тема,объект)
  @@index([tenantId, themeId, status])
  @@index([tenantId, status])
}
```
Обратные relation-поля добавить в `User` (`themesAuthored ThemeSuggestion?`… нет — только `Theme[] @relation("ThemeAuthor")`), `IdeaBlock`, `Entity`, `Org`. Миграция файлом (`bun run prisma:migrate -- --name living-topic-space`), ревью SQL, `prisma:generate`. Дефолты `origin=auto`/`visibility=team` покрывают существующие темы (бэкфилл кодом не нужен — проверить в acceptance, что старые темы читаются как auto/team).

### Zod-DTO + эндпоинты (Ф4) — `theme.dto.ts` + `themes.controller.ts`
```ts
// создать тему словами
export const CreateThemeSchema = z.object({
  phrase: z.string().trim().min(3).max(300),        // «Всё про клиента Логистик Плюс»
  visibility: z.enum(['personal', 'team']).default('personal'),
});
// переименовать / архивировать
export const RenameThemeSchema = z.object({ name: z.string().trim().min(1).max(200) });
// решение по предложению
export const DecideSuggestionSchema = z.object({ decision: z.enum(['accept', 'reject']) });
// ручной pin/unpin
export const PinToThemeSchema = z.object({
  kind: z.enum(['block', 'entity']),
  id: z.string().min(1),
});
export interface ThemeSuggestionDto {
  id: string; kind: 'block' | 'entity';
  blockId: string | null; entityId: string | null;
  title: string;            // имя блока/сущности для показа
  score: number; reason: string; autoChecked: boolean; createdAt: string;
}
export interface ThemeSuggestionsResultDto { items: ThemeSuggestionDto[]; pendingCount: number; }
```
Новые маршруты в `KnowledgeThemesController` (те же guards/entitlement/tenant/rbac что и list):
- `POST /api/v1/knowledge/themes` — создать (тело `CreateThemeSchema`). **team → требует manager+** (`rbac.canManage(user.id, tenantId, 'theme')` или явная роль; при отказе — код `forbidden_team_theme`). Возвращает `ThemeItemDto` + первичный улов запускается синхронно/джобой.
- `PATCH /api/v1/knowledge/themes/:id` — rename (только автор personal / manager+ team).
- `POST /api/v1/knowledge/themes/:id/archive` — `status=archived`.
- `GET /api/v1/knowledge/themes/:id/suggestions` — `ThemeSuggestionsResultDto` (status=pending).
- `POST /api/v1/knowledge/themes/:id/suggestions/:sid/decide` — accept→пишем `ThemeIdeaBlock`/`ThemeEntity` + suggestion `accepted`; reject→`rejected`. Идемпотентно (повтор → тот же результат).
- `POST /api/v1/knowledge/themes/:id/pin` — ручная привязка (`PinToThemeSchema`) без предложения.
- `DELETE /api/v1/knowledge/themes/:id/pin/:kind/:objectId` — отвязать.
Коды ошибок: `tenant_required`, `forbidden`, `forbidden_team_theme`, `theme_not_found`, `suggestion_not_found`, `not_theme_owner`. Каждый — Swagger + машинный код в теле `{ ok:false, error:{ code, message } }` (как в текущем контроллере).

**Расширить `ThemeItemDto`** (living view) полями: `origin`, `visibility`, `isMine: boolean`, `pendingSuggestionsCount: number`. **Расширить `ThemeDetailDto`** секциями живого вида: `decisions` (решения/обязательства по теме), `tasks` (связанные задачи-мост), `documents` (по `attachedThemeId`), `regulations` (регламенты/инструкции темы — те, чья `Regulation.entityId`/`Instruction.entityId` входит в множество сущностей темы `ThemeEntity(themeId)`) — переиспользуя существующие связи; `summary` уже есть в `Theme`. Регламенты/документы — read-only список со ссылкой в свой раздел (не редактируем их здесь).

### AdminSetting-крутилки (Ф3) — реестр `admin-setting-schema-registry.ts` (образец строки `['share.defaultExpirationDays', POSITIVE_INT]`)
```
['theme.autolink.enabled',            z.boolean()]              // kill-switch воркера предложений (ON)
['theme.autolink.similarityThreshold', z.number().min(0).max(1)] // порог близости, default 0.78
['theme.autolink.scanWindowDays',      POSITIVE_INT]             // окно свежих блоков, default 14
['theme.autolink.maxPendingPerTheme',  POSITIVE_INT]            // потолок pending на тему, default 20
['theme.suggest.reminderHourMsk',      z.number().int().min(0).max(23)] // час напоминания, default 9
```
Читать через `resolveSync`/`getDynamic` (admin→ENV→code-fallback), code-fallback = указанные default. Сид + UI-поле обязательны. Пороги/окно/час — **крутилки, не хардкод** (принцип №9).

### BullMQ / cron (Ф3, Ф5)
- `theme-suggest.cron` (по образцу `theme-clusterer.cron.ts`): для каждой user-темы Org (`origin=user`, `status=active`) — pgvector-поиск `IdeaBlock` по близости к `Theme.embedding` ≥ `similarityThreshold`, в окне `scanWindowDays`, исключая уже привязанные (`ThemeIdeaBlock`), уже `pending`/`rejected` (`ThemeSuggestion`), потолок `maxPendingPerTheme`. Создать `ThemeSuggestion(kind=block, score, reason, autoChecked = score≥высокий_порог)`. Пропускать при `theme.autolink.enabled=false` (kill-switch). Идемпотентно (`@@unique`). `reason` строит человекочитаемую причину из общих сущностей/участников.
- Первичный улов при создании темы: `embedQuery(phrase)` → записать `Theme.embedding` → тот же скан немедленно (синхронно или enqueue job с тем же кодом).
- `theme-suggest-reminder.cron` (раз в день в `reminderHourMsk`): владельцам тем с `pending>0` — одно ненавязчивое уведомление через существующий слой destinations (В2, без спама).

---

## Границы фичи
- ✅ **Always:** переиспользовать `Theme`/`embedQuery`/summarize/existing reads; писать в `ThemeIdeaBlock` только на accept; крутилки через AdminSetting; TenantGuard на всех эндпоинтах; personal-тема невидима чужим.
- ⚠️ **Ask first:** менять поведение `theme-clusterer`/auto-тем; трогать retrieval «Мастера»; вводить новый `signalType`.
- 🚫 **Never:** писать «предложенное» напрямую в `ThemeIdeaBlock`; `process.env.*` мимо `env.schema.ts`; `new PrismaClient()` в скриптах; хардкод порогов; английский в UI; выкат с дефолтом OFF (Ship-On).

---

## Фазы (dependency-ordered)

Граф: **Ф1 → Ф2 → {Ф3, Ф4}**; Ф4 → Ф7; Ф3 → Ф5; Ф2 → Ф6; Ф7 → Ф8. Ф3 и Ф4 параллельны после Ф2. Frontend (Ф7/Ф8) после Ф4 (контракт API).

### Ф1 — Модель данных [ ]
**Ценность:** как система хранения, получаю поля user-темы и очередь HITL, чтобы остальные фазы имели на что опираться.
**Что входит:** enum `ThemeOrigin/ThemeVisibility/ThemeSuggestionStatus/ThemeSuggestionKind`; колонки `Theme.origin/createdByUserId/visibility` + relation `ThemeAuthor`; таблица `ThemeSuggestion` (со `@@unique`/`@@index`, tenantId-компаньоны); обратные relation-поля в `User`/`IdeaBlock`/`Entity`/`Org`; файл миграции; `prisma:generate`.
**Что НЕ входит:** любая логика/эндпоинты/воркеры.
**Файлы:** `backend/prisma/schema.prisma` (Theme :4393, enum-блок :818, IdeaBlock :3415, User/Entity/Org — перечитать перед правкой, номера дрейфуют).
**Acceptance:** `bun run prisma:migrate -- --name living-topic-space` создаёт таблицу+колонки; `bun run prisma:generate` зелёный; `bun run typecheck` зелёный; существующая тема из seed читается как `origin=auto,visibility=team` (SQL-проверка); повторный `migrate deploy` = no-op.
**Тесты:** миграционный smoke (создать user-тему + suggestion в интеграционном тесте, `@@unique` ловит дубль).
**Закрывает:** R1, R2.

### Ф2 — Backend-сервисы: запись темы + решения по предложениям [ ]
**Ценность:** как менеджер, получаю возможность создать/переименовать/архивировать тему и принять/отклонить/пин-предложение, чтобы владеть темой.
**Что входит:** `theme-write.service` (create с `embedQuery(phrase)`→`Theme.embedding`, rename, archive; проставляет `origin=user`, `createdByUserId`, `visibility`); `theme-suggestion.service` (list pending; decide accept→запись `ThemeIdeaBlock`/`ThemeEntity` (weight из score) + suggestion `accepted`; reject→`rejected`; pin/unpin; всё идемпотентно и tenant-scoped); правила доступа (personal→автор; team-create→manager+).
**Что НЕ входит:** HTTP-слой (Ф4), воркер (Ф3).
**Файлы:** новые сервисы в `backend/src/modules/knowledge-core/services/`; переиспользовать `KnowledgeEmbeddingService` (`embedding.service.ts`), `RbacService.canRead/canManage`.
**Acceptance:** unit-тесты: create пишет embedding+origin+author; accept переносит в `ThemeIdeaBlock` и не создаёт дубль при повторе; reject не переспрашивается; personal-тема чужому недоступна (сервис бросает `not_theme_owner`); team-create без manager+ → отказ. `bunx vitest run` по новым spec зелёный.
**Закрывает:** R1, R2, R3, R6.

### Ф3 — Воркер предложений + крутилки + первичный улов [ ]
**Ценность:** как менеджер, вижу, что тема сама наполняется предложениями (в т.ч. сразу после создания), чтобы не раскладывать вручную.
**Что входит:** `theme-suggest.cron` (pgvector-скан → `ThemeSuggestion`, `reason`, `autoChecked`, kill-switch `theme.autolink.enabled`); регистрация крутилок в `admin-setting-schema-registry.ts` + сид + UI-поле; первичный улов при создании темы (вызов того же кода из Ф2).
**Что НЕ входит:** напоминание (Ф5), UI (Ф7).
**Файлы:** `backend/src/modules/knowledge-core/workers/theme-suggest.cron.ts` (образец `theme-clusterer.cron.ts`); `backend/src/modules/admin/settings/admin-setting-schema-registry.ts`; сид крутилок (перечитать актуальный seed-паттерн настроек); UI admin-поле.
**Acceptance:** на синтетике «Стрела» user-тема «Логистик Плюс» получает ≥1 `pending` с непустым `reason` и `score≥порог`; при `theme.autolink.enabled=false` новых предложений 0; уже привязанный блок не предлагается; потолок `maxPendingPerTheme` соблюдён; повторный прогон крона дублей не создаёт (`@@unique`). Метрика prom-client `z_theme_suggestions_created_total`. `bunx vitest run` по spec крона зелёный.
**Закрывает:** R2, R4, R7.

### Ф4 — HTTP-API (эндпоинты + DTO + Swagger + permission) [ ]
**Ценность:** как фронт, получаю контракт для создания темы, подтверждения предложений и живого вида, чтобы построить экраны.
**Что входит:** маршруты `POST /themes`, `PATCH :id`, `POST :id/archive`, `GET :id/suggestions`, `POST :id/suggestions/:sid/decide`, `POST :id/pin`, `DELETE :id/pin/:kind/:objectId`; DTO из раздела «Контракты»; расширение `ThemeItemDto`/`ThemeDetailDto` (origin/visibility/isMine/pendingSuggestionsCount + decisions/tasks/documents); permission-фильтр в `list`/`byId` (`OR: team | personal&&автор`); team-create gate; коды ошибок + Swagger.
**Что НЕ входит:** frontend (Ф7).
**Файлы:** `themes.controller.ts` (:50), `api/dto/theme.dto.ts`.
**Прим.:** `ThemeDetailDto.regulations` собирается join'ом `Regulation`/`Instruction` по `entityId ∈ ThemeEntity(themeId)` (read-only, для R8).
**Acceptance:** Swagger `/api/docs` показывает новые маршруты; `POST /themes {visibility:'personal'}` создаёт «мою» тему и возвращает её с `isMine:true`; чужая personal-тема в `GET /themes` не видна (негативный тест: user B не получает personal-тему user A → список без неё); `POST /themes {visibility:'team'}` рядовым (не manager) → 403 `forbidden_team_theme`; `decide accept` дважды → один `ThemeIdeaBlock` (идемпотентно). Интеграционные spec зелёные; `bun run typecheck && bun run lint && bun run build` зелёные. `ThemeDetailDto.regulations` возвращает регламенты, чья сущность входит в тему (тест: тема с регламентом через общую сущность → регламент в ответе).
**Закрывает:** R1, R2, R3, R6, R8.

### Ф5 — Ежедневное ненавязчивое напоминание [ ]
**Ценность:** как менеджер, раз в день мягко узнаю, что в теме есть неразобранные предложения, чтобы не пропустить, но без спама.
**Что входит:** `theme-suggest-reminder.cron` в `reminderHourMsk`; одно уведомление владельцам тем с `pending>0` через существующий слой destinations; без повторов в тот же день.
**Что НЕ входит:** новые каналы уведомлений.
**Файлы:** `backend/src/modules/knowledge-core/workers/theme-suggest-reminder.cron.ts`; переиспользовать notifications-слой (перечитать актуальный).
**Acceptance:** при `pending>0` уведомление ставится один раз/день; при `pending=0` — не ставится; час берётся из крутилки. Spec зелёный.
**Закрывает:** R7 (часть В2).

### Ф6 — Мост «обязательство темы → задача трекера» [ ]
**Ценность:** как менеджер, из открытого обязательства темы одной кнопкой завожу задачу, чтобы обещание не потерялось.
**Что входит:** эндпоинт `POST /api/v1/knowledge/themes/:id/commitments/:blockId/to-task` → вызывает существующий сервис создания задачи трекера, связывает задачу с блоком-обязательством и темой; возвращает `taskId`.
**Что НЕ входит:** логика трекера (переиспользуется), автосоздание задач без клика.
**Файлы:** `themes.controller.ts`; сервис трекера (перечитать актуальный сервис материализации задачи в `backend/src/modules/tracker/**`).
**Acceptance:** из блока-обязательства создаётся задача трекера, видимая в трекере, связанная с темой; повтор не плодит дубль. Интеграционный spec зелёный.
**Закрывает:** R5.

### Ф7 — Живой вид (frontend) [ ]
**Ценность:** как менеджер, вижу тему красивой читаемой страницей и подтверждаю предложения одним кликом, а не листаю списки.
**Что входит:** слой `ApiDto→DomainModel→UiModel` (`frontend/src/api/themes.api.ts`, `frontend/src/domain/theme.ts` — расширить); флоу создания темы одной фразой + первичный улов; экран подтверждения предложений (Р3: уверенные отмечены, неуверенные нет; Р4: показ `reason`); живая страница темы (суть/summary, лента событий хронологически, «кто в теме», решения/обязательства с кнопкой «завести задачу», связанные задачи, **регламенты и документы темы** read-only со ссылкой в свой раздел); состояния пусто/загрузка/ошибка; бейдж «N новое»; UI только по-русски, парные токены цветов.
**Что НЕ входит:** дизайн-полировка (frontend-design после), пульс руководителю (vNext).
**Файлы:** `frontend/src/api/themes.api.ts`, `frontend/src/domain/theme.ts`, `frontend/app/(authenticated)/themes/ThemesClient.tsx`, `.../themes/[id]/ThemeDetailClient.tsx` (перечитать перед правкой), новый компонент создания темы + экран предложений.
**Acceptance:** менеджер создаёт тему фразой → видит первичный улов и подтверждает; страница темы рендерит все секции живого вида (макет из blueprint §4б); неуверенные предложения не отмечены по умолчанию; на каждом предложении виден «почему»; `bun run typecheck && bun run lint && bun run build` зелёные; `bun run test:unit` по новым компонентам зелёный; проверка playwright: заведение темы + подтверждение (скриншот).
**Закрывает:** R1, R2, R3, R4, R8.

### Ф8 — Бейдж и вплетение напоминания в UI [ ]
**Ценность:** как менеджер, ненавязчиво вижу «N новое» на теме и в списке тем, чтобы вернуться и разобрать.
**Что входит:** бейдж `pendingSuggestionsCount` в списке тем и на странице; ненавязчивый индикатор.
**Что НЕ входит:** пуш-нотификации.
**Файлы:** `ThemesClient.tsx`, `ThemeDetailClient.tsx`.
**Acceptance:** бейдж показывает число pending, обнуляется после разбора; `typecheck/lint/build` зелёные.
**Закрывает:** R7.

---

## Требования (трассировка)
- **R1** Когда менеджер вводит фразу темы, система shall создать `Theme(origin=user, createdByUserId, visibility)` и посчитать `embedding` из фразы.
- **R2** Когда появляется релевантный контент, система shall создавать `ThemeSuggestion(pending)`, и привязка в `ThemeIdeaBlock`/`ThemeEntity` происходит только после `accept` (HITL).
- **R3** Если `score` предложения ниже порога уверенности, then `autoChecked=false` (в UI не отмечено по умолчанию).
- **R4** Система shall хранить и показывать `reason` каждого предложения (провенанс).
- **R5** Когда менеджер жмёт «завести задачу» на обязательстве темы, система shall создать задачу трекера, связанную с темой и блоком.
- **R6** Если тема `personal`, then её видит только автор (в рамках Org); `team`-тему создаёт только manager+.
- **R7** Система shall тихо копить pending-предложения (бейдж) и раз в день слать одно напоминание владельцам тем с `pending>0`.
- **R8** Когда менеджер открывает живую страницу темы, система shall показывать регламенты/инструкции темы (через сущности темы) и документы темы (`attachedThemeId`) read-only со ссылкой в свой раздел — первый шаг «всё знание в одном месте».

## Pre-mortem / Риски и ревью-аспекты
- **Протечка personal-темы между пользователями** → негативный тест в Ф4 (user B не видит personal user A); ревью `strict-production-review-gate` на tenant/owner-фильтр.
- **«Предложенное» протекло в подтверждённый граф** → изоляция таблицей `ThemeSuggestion`; тест «pending не влияет на `_count.blocks`/retrieval».
- **Шум предложений** (диаризация ~30%) → HITL + `autoChecked=false` для неуверенных + порог-крутилка.
- **Дубли предложений/задач** → `@@unique(ThemeSuggestion)`, идемпотентность accept и моста (acceptance).
- **Стоимость LLM/embedding** → предложения на pgvector (без LLM на каждый блок); `reason` собирается кодом из общих сущностей, не отдельным LLM-вызовом (если нужен LLM для формулировки — дешёвый `deepseek-v4-flash`, батч; иначе шаблон).
- **Observability:** метрики `z_theme_suggestions_created_total`, `z_theme_suggestions_decided_total{decision}`; логи pino в кронах.

## Сквозные аспекты
- **RBAC/tenant:** TenantGuard на всех новых эндпоинтах; `tenantId` в каждом запросе/FK; personal-owner-фильтр. **[covered Ф2/Ф4]**
- **Observability:** метрики+логи в кронах и decide-эндпоинте. **[covered Ф3/Ф4]**
- **Ошибки+идемпотентность:** коды ошибок; accept/reject/мост идемпотентны; `@@unique`. **[covered Ф1/Ф2/Ф4/Ф6]**
- **Миграция данных:** дефолты покрывают старые темы; отдельный backfill не нужен `[N/A: дефолты origin=auto/visibility=team]`.
- **Rollout/флаг (Ship-On):** фича выкатывается включённой. `theme.autolink.enabled` — аварийный kill-switch (ON). В1 (team-тема manager+) — «решение владельца про доступ», выкатывается с ролью-порогом manager+. Строки в `docs/operations/feature-flags.md`. **[covered]**
- **Тесты:** unit (Ф2), крон-spec (Ф3), интеграция API (Ф4), мост (Ф6), frontend unit+playwright (Ф7).

## Prod-deploy (обновить `docs/operations/prod-deploy-log.md`)
- **Шаг 4:** новая таблица `ThemeSuggestion` + колонки `Theme.origin/createdByUserId/visibility` + enum → миграция применяется авто (`migrate deploy`).
- **Шаг 1:** новые AdminSetting-крутилки `theme.autolink.*`/`theme.suggest.reminderHourMsk` (не ENV, но зафиксировать в реестре/сиде).
- **Шаг 12:** smoke новых кронов (`theme-suggest`, `theme-suggest-reminder`) + Swagger-теги новых эндпоинтов.
- **feature-flags.md:** `theme.autolink.enabled` (kill-switch, ON); право team-темы (manager+).
- Если добавится `seed-*`/`patch-*` для крутилок — зарегистрировать в `apply-prod-deploy.ts` `STEPS`.

## DoD
`typecheck` (вкл. `.spec`) / `lint` / `build` зелёные; `test:unit`/`test:integration` по затронутому зелёные; second-brain обновлён по таблице производных (`01_projects/` тем/knowledge-core, `02_architecture/data-model.md` — новая таблица, `module-map.md` — новые воркеры/эндпоинты, `api-layer.md` — новые маршруты, `01_projects/admin.md` — новые крутилки, `workers-queues.md` — новые кроны); `prod-deploy-log.md` обновлён (Шаги 1/4/12); рефлексия записана.

## Итог
_(заполнит tz-orchestrator по завершении: что реализовано целиком, что осталось.)_

---
> Дальше → реализация `tz-orchestrator` (по явному «начни реализацию» владельца). Опциональный парный orchestrator-prompt можно добавить перед стартом, если понадобится (крупное многофазное ТЗ).
