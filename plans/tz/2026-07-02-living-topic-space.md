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
  - plans/tz/2026-07-02-second-brain-by-branches.md
---
> Архитектура (одобрена владельцем 2026-07-02): `plans/architecture/2026-07-02-living-topic-space.md` · Анализ: `plans/analysis/2026-07-02-living-topic-space.md` · Статус согласования: approved 2026-07-02. **UPD 2026-07-02: модель наполнения перевёрнута с HITL «подтверди каждое» на АВТО-наполнение + удаление лишнего (решение владельца — постоянные подтверждения = спам).**

# ТЗ — «Живое пространство темы» (living-topic-space)

**Принцип.** Тему заводит **человек, руками** (Кора темы не создаёт и не навязывает). Дальше тема **сама наполняется** релевантным контентом (встречи/решения/задачи/документы) — **без вопросов**; человек **убирает лишнее**, убранное не возвращается. Против свалки — **высокий порог** (сомнительное само не кладётся и не спрашивается) + дедуп + исключения. Тема показывается живой читаемой страницей. Переиспользуем существующий движок Theme.

## Вне scope / отложено владельцем (vNext)
- **«Пульс темы для руководителя»** (срез письма COO на уровень темы) — vNext (В3).
- **No-code конструктор правил-автоматизаций на тему** — отдельная фича.
- **Встройка темы во вкладку проекта трекера** — vNext; первый дом — раздел «Темы» (Р5).
- **Дизайн-полировка** — `frontend-design`/`impeccable` после ТЗ.

## Цель + Зачем
Менеджер SMB не может собрать всё по клиенту/проекту без ручного тегирования, а в Notion/аналогах это держится на дисциплине и разваливается (см. [[../analysis/2026-07-02-notion-agent-teardown-and-borrow]]). Даём: человек **завёл** тему словами → она **сама наполняется** и **красиво читается**, а он лишь **чистит** редкое лишнее. Отстройка: авто-наполнение на **командном** графе (single-user PKM/РФ-аналоги не умеют), без ручной раскладки и без спама подтверждениями.

## REALITY-CHECK (факт по коду 2026-07-02)
- **Есть и переиспользуется:** `Theme` [schema.prisma:4393] (`embedding vector(1536)`, `summary`, связи `ThemeIdeaBlock`/`ThemeEntity`/`Document.attachedThemeId`/`Card`/`GoalTheme`); воркеры `theme-clusterer.cron.ts` (embedding→`clusterByEmbedding`→создание темы + `themeIdeaBlock.createMany`), `theme-summarize.cron.ts`, `theme-classification.service.ts`, `KnowledgeEmbeddingService.embedQuery` (`theme-clusterer.cron.ts:248`).
- **Read-API готов, писать нечем:** `KnowledgeThemesController` [themes.controller.ts:50] — `GET /api/v1/knowledge/themes`, `GET :id`, `POST :id/save-as-card`. Guards `CookieAuthGuard, TenantGuard`, `@RequireEntitlement('feature.theme')`, `rbac.canRead(user.id, tenantId, 'theme')`, tenant из `@CurrentOrg()`, коды `tenant_required`/`forbidden`. DTO — `theme.dto.ts`.
- **Нет:** пользовательского создания темы, авто-наполнения user-темы, «почему в теме», исключений при удалении, живого вида, моста к задачам. `origin`/`createdByUserId`/`visibility` у `Theme` отсутствуют; `ThemeIdeaBlock` не различает источник привязки.
- **Ядро retrieval доведено 2026-07-02** (H3 закрыт, резолв людей/клоны починены — [[../../second-brain/05_история/2026-07-02-retest-fixes-a-e-i-dashboardy-nedelya-mesyac]]). Фича НЕ блокирована. Диаризация «кто сказал» ~30% → **порог авто-добавления высокий**, лишнее убирается вручную.
- **Партиционирование:** `IdeaBlock`/`Entity` партиционированы по `tenantId`; составные FK требуют `tenantId`-компаньон (Пакет A).

## Принятые решения владельца (не пересматривать)
| # | Решение | Обоснование |
|---|---|---|
| Р1 | Тему заводит только человек: `Theme` + `origin(auto\|user)` + `createdByUserId` + `visibility(personal\|team)`. Кора темы НЕ создаёт и НЕ предлагает создавать | Анти-спам: никаких ежедневных «заведи тему» |
| Р2 | Наполнение **автоматическое, без подтверждений**: контент ≥ порога сам кладётся в тему | Постоянные «подтверди это/это» = спам/замучка (решение владельца, перевешивает прежний HITL) |
| Р3 | Против свалки без спама: авто-кладём **только ≥ высокого порога**; ниже — тихо НЕ кладём и НЕ спрашиваем; дедуп | Авто ≠ помойка; и при этом ничего не дёргает |
| Р4 | Удалил лишнее → в «исключения», больше не подкладывается | Чистка одним кликом вместо подтверждения каждого |
| Р5 | «Почему это в теме» (упоминания/score) — по клику, не как уведомление | Провенанс/доверие (ров) без спама |
| Р6 | Первый дом — раздел «Темы» | Дешевле/быстрее; экран и данные есть |
| В1 | Личные темы — любой сотрудник; командную (видит вся компания) — менеджер+ | Личные = вовлечение снизу; командная затрагивает доступ (решение владельца про доступ) |
| В3 | Первая версия — лицо менеджера; пульс руководителю — vNext | Живой вид важнее и он же основа пульса |

## Доказательство выбора (2 прохода + challenge-loop)
**Развилка: как наполнять (opt-in HITL vs opt-out авто).**
| Критерий | A: предложи→подтверди (HITL, opt-in) | B: авто-добавление + удаление (opt-out) — ВЫБРАНО владельцем |
|---|---|---|
| Трение/спам | ✗ дёргает по каждому предложению — «замучает» | ✓ ноль вопросов, само |
| Риск мусора | низкий (ничего без клика) | средний → снимается высоким порогом + дедуп + исключения + лёгкое удаление |
| Соответствие желанию владельца | ✗ прямо назвал спамом | ✓ прямо попросил «чтобы само» |
| Отзыв рынка (red-team) | «контроль важнее» | контроль сохранён через удаление + видимость «почему» + порог |
**Вывод:** B. Порог высокий (`autofill.threshold`), сомнительное не кладётся (тихо), убранное — в `ThemeExclusion` (не возвращается). **Challenge-loop:** (1) корень — «наполнять без ручного труда И без спама», решаем авто+удаление, а не подтверждениями; (2) эффективность — авто-кладём в `ThemeIdeaBlock` напрямую, без промежуточной очереди; (3) не код ради кода — нет таблицы предложений, нет бейджей/напоминаний-подтверждений.

**Развилка: где хранить «источник привязки и почему».** Не отдельная таблица предложений (её нет), а поля на `ThemeIdeaBlock` (`addedVia`, `score`, `reason`) — привязка и есть результат; провенанс живёт на ней.

## Scope
**Входит:** пользовательские темы (create/rename/archive) с `origin/createdByUserId/visibility`; **авто-наполнение** user-темы воркером (порог/дедуп/окно — крутилки); ручное добавление (pin) и **удаление с исключением** (unpin→exclusion); живой вид (страница темы + флоу создания); показ регламентов/документов темы (связки `entityId`/`attachedThemeId` — первый шаг [[../architecture/2026-07-02-second-brain-by-branches]]); мост «обязательство → задача»; permission (personal/team + manager+ для team); «почему в теме» по клику.
**Не входит:** любые подтверждения/бейджи «на разбор»/ежедневные напоминания-подтверждения (сознательно убрано); см. «Вне scope».

## Граничные контракты
- **Мост «обязательство→задача»** переиспользует существующий сервис создания задачи трекера (`backend/src/modules/tracker/**` — перечитать перед реализацией; логику трекера не переписывать).
- **Дедуп** авто-наполнения переиспользует существующий порог/механизм дедупа `IdeaBlock` (перечитать актуальный дедуп-сервис).

---

## Контракты (контракт-first)

### Prisma (Ф1) — перечитать `schema.prisma:4393` (Theme), enum-блок `:818`, `ThemeIdeaBlock:4435`
```prisma
enum ThemeOrigin { auto  user }
enum ThemeVisibility { personal  team }
enum ThemeLinkOrigin { clustered  autofill  manual }   /// источник привязки блока к теме

/// в model Theme:
  origin          ThemeOrigin      @default(auto)
  createdByUserId String?
  visibility      ThemeVisibility  @default(team)
  createdByUser   User?            @relation("ThemeAuthor", fields: [createdByUserId], references: [id], onDelete: SetNull)
  exclusions      ThemeExclusion[]
  @@index([tenantId, origin, createdByUserId])

/// в model ThemeIdeaBlock (провенанс авто-наполнения):
  addedVia ThemeLinkOrigin @default(clustered)   /// как блок попал в тему
  score    Decimal?        @db.Decimal(4, 3)     /// близость при autofill (для «почему»)
  reason   String?         @db.Text              /// человекочитаемо: «4 упоминания клиента, участник Смирнов»

/// исключения — «пользователь убрал, не подкладывать снова». tenantId-компаньоны обязательны.
enum ThemeExclusionKind { block  entity }
model ThemeExclusion {
  id        String            @id @default(cuid())
  tenantId  String
  themeId   String
  kind      ThemeExclusionKind
  blockId   String?
  entityId  String?
  createdByUserId String?
  createdAt DateTime          @default(now())

  theme  Theme      @relation(fields: [themeId], references: [id], onDelete: Cascade)
  block  IdeaBlock? @relation(fields: [blockId, tenantId], references: [id, tenantId], onDelete: Cascade)
  entity Entity?    @relation(fields: [entityId, tenantId], references: [id, tenantId], onDelete: Cascade)
  org    Org        @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([themeId, kind, blockId, entityId])
  @@index([tenantId, themeId])
}
```
Обратные relation-поля в `User`(`ThemeAuthor`), `IdeaBlock`, `Entity`, `Org`. Миграция файлом (`bun run prisma:migrate -- --name living-topic-space`), ревью SQL, `prisma:generate`. Дефолты `origin=auto`/`visibility=team`/`addedVia=clustered` покрывают существующие темы/привязки (бэкфилл кодом не нужен).

### Zod-DTO + эндпоинты (Ф4) — `theme.dto.ts` + `themes.controller.ts`
```ts
export const CreateThemeSchema = z.object({
  phrase: z.string().trim().min(3).max(300),
  visibility: z.enum(['personal', 'team']).default('personal'),
});
export const RenameThemeSchema = z.object({ name: z.string().trim().min(1).max(200) });
export const PinToThemeSchema = z.object({ kind: z.enum(['block', 'entity']), id: z.string().min(1) });
```
Маршруты в `KnowledgeThemesController` (guards/entitlement/tenant/rbac как в `list`):
- `POST /api/v1/knowledge/themes` — создать (`CreateThemeSchema`). **team → manager+** (`rbac.canManage(...)`; иначе `forbidden_team_theme`). Возвращает `ThemeItemDto`; авто-наполнение запускается сразу (может дать 0 — норма).
- `PATCH /api/v1/knowledge/themes/:id` — rename (автор personal / manager+ team).
- `POST /api/v1/knowledge/themes/:id/archive` — `status=archived`.
- `POST /api/v1/knowledge/themes/:id/pin` — ручное добавление (`PinToThemeSchema`) → `ThemeIdeaBlock(addedVia=manual)`.
- `DELETE /api/v1/knowledge/themes/:id/pin/:kind/:objectId` — убрать: удалить привязку + записать `ThemeExclusion` (не подкладывать снова).
Коды ошибок: `tenant_required`, `forbidden`, `forbidden_team_theme`, `theme_not_found`, `not_theme_owner`. **Нет** эндпоинтов подтверждения/предложений/бейджа — их не существует в этой модели.

**Расширить `ThemeItemDto`:** `origin`, `visibility`, `isMine`. **Расширить `ThemeDetailDto`** секциями живого вида: `blocks` (с `addedVia`/`score`/`reason` для «почему»), `entities`, `decisions`, `tasks`, `documents` (`attachedThemeId`), `regulations` (регламенты/инструкции, чья `entityId` ∈ `ThemeEntity(themeId)`, read-only со ссылкой). `summary` уже есть.

### AdminSetting-крутилки (Ф3) — реестр `admin-setting-schema-registry.ts`
```
['theme.autofill.enabled',       z.boolean()]                 // kill-switch авто-наполнения (ON)
['theme.autofill.threshold',     z.number().min(0).max(1)]    // порог АВТО-добавления, default 0.72 (склоняемся ВКЛЮЧАТЬ — решение владельца: лишнее убрать дешевле, чем недобрать; tunable в админке)
['theme.autofill.scanWindowDays', POSITIVE_INT]              // окно свежих блоков, default 14
['theme.autofill.maxPerScan',    POSITIVE_INT]               // потолок авто-добавлений за прогон на тему, default 50
```
Через `resolveSync`/`getDynamic`, code-fallback = default. Сид + UI-поле. Пороги — крутилки, не хардкод (принцип №9).

### BullMQ / cron (Ф3)
- `theme-autofill.cron` (образец `theme-clusterer.cron.ts`): для каждой user-темы Org (`origin=user`, `status=active`) — pgvector-поиск `IdeaBlock` по близости к `Theme.embedding` **≥ `threshold`**, в окне `scanWindowDays`, исключая уже привязанные (`ThemeIdeaBlock`), **исключённые** (`ThemeExclusion`), near-дубликаты (дедуп); потолок `maxPerScan`. **Авто-вставка** в `ThemeIdeaBlock(addedVia=autofill, score, reason, weight из score)` — БЕЗ подтверждения. Пропуск при `theme.autofill.enabled=false`. `reason` — шаблоном из общих сущностей/участников (без LLM). Идемпотентно. Метрика `z_theme_autofill_added_total`.
- Первичное наполнение при создании темы: `embedQuery(phrase)` → `Theme.embedding` → тот же скан немедленно (может дать 0 — тема пустая, это норма).
- **Напоминаний/бейджей-подтверждений НЕТ.** Опционально пассивная не-actionable инфа «добавлено за неделю: N» на странице темы (не уведомление).

---

## Границы фичи
- ✅ **Always:** переиспользовать Theme/`embedQuery`/summarize; авто-вставка только ≥ порога; дедуп; уважать `ThemeExclusion`; крутилки через AdminSetting; TenantGuard; personal-тема невидима чужим.
- ⚠️ **Ask first:** менять `theme-clusterer`/auto-темы; трогать retrieval «Мастера».
- 🚫 **Never:** авто-создавать/предлагать темы (только человек); подтверждения/бейджи-разбора/ежедневные напоминания (это спам, которого владелец не хочет); хардкод порогов; `process.env.*` мимо `env.schema.ts`; `new PrismaClient()` в скриптах; английский в UI; выкат с дефолтом OFF (Ship-On).

---

## Фазы (dependency-ordered)
Граф: **Ф1 → Ф2 → {Ф3, Ф4}**; Ф4 → Ф6; Ф2 → Ф5.

### Ф1 — Модель данных [x]
**Ценность:** как хранилище знаний, получаю поля user-темы, провенанс авто-привязки и таблицу исключений, чтобы авто-наполнение и чистка имели опору.
**Что входит:** enum `ThemeOrigin/ThemeVisibility/ThemeLinkOrigin/ThemeExclusionKind`; колонки `Theme.origin/createdByUserId/visibility`; колонки `ThemeIdeaBlock.addedVia/score/reason`; таблица `ThemeExclusion` (tenantId-компаньоны, `@@unique`); relation-поля; миграция; `prisma:generate`.
**Что НЕ входит:** логика/эндпоинты/воркеры.
**Файлы:** `backend/prisma/schema.prisma` (перечитать якоря — номера дрейфуют).
**Acceptance:** миграция создаёт колонки+таблицу; `prisma:generate`/`typecheck` зелёные; существующая тема читается `origin=auto`; существующие `ThemeIdeaBlock` читаются `addedVia=clustered`; повторный `migrate deploy` = no-op.
**Закрывает:** R1, R2, R3.

### Ф2 — Сервисы: запись темы + авто-наполнение + удаление-исключение [x]
**Ценность:** как менеджер, создаю тему, а она сама наполняется, и я убираю лишнее навсегда.
**Что входит:** `theme-write.service` (create с `embedQuery`→embedding, rename, archive; `origin=user`, `createdByUserId`, `visibility`; team→manager+); `theme-fill.service` (кандидаты ≥ порога, дедуп, исключить `ThemeExclusion`+уже привязанные, вставка `addedVia=autofill` с `score`/`reason`); `pin` (manual), `unpin` (удалить привязку + записать `ThemeExclusion`).
**Что НЕ входит:** HTTP (Ф4), cron (Ф3).
**Файлы:** новые сервисы в `knowledge-core/services/`; переиспользовать `KnowledgeEmbeddingService`, `RbacService`, существующий дедуп.
**Acceptance:** unit: create пишет embedding+origin+author; авто-наполнение кладёт блок ≥ порога и НЕ кладёт < порога; near-дубликат не кладётся; unpin удаляет и добавляет исключение → повторный fill НЕ возвращает блок; personal-тема чужому недоступна; team-create без manager+ → отказ. `bunx vitest run` зелёный.
**Закрывает:** R1, R2, R3, R4, R6.

### Ф3 — Воркер авто-наполнения + крутилки [x]
**Ценность:** как менеджер, тема наполняется сама (в т.ч. сразу после создания), без единого вопроса.
**Что входит:** `theme-autofill.cron` (скан ≥ порога → авто-вставка, kill-switch, дедуп, исключения, `maxPerScan`); крутилки в реестр + сид + UI; первичное наполнение при создании темы.
**Что НЕ входит:** UI (Ф6).
**Файлы:** `knowledge-core/workers/theme-autofill.cron.ts`; `admin-setting-schema-registry.ts`; сид; UI admin-поле.
**Acceptance:** на «Стреле» тема «Логистик Плюс» **сама** получает ≥1 привязку `addedVia=autofill` с `reason` и `score ≥ threshold`; блок < порога НЕ добавлен; исключённый блок не возвращается; при `enabled=false` авто-добавлений 0; `maxPerScan` соблюдён; повтор не дублирует. Метрика `z_theme_autofill_added_total`. `bunx vitest run` зелёный.
**Закрывает:** R2, R3.

### Ф4 — HTTP-API [x]
**Ценность:** как фронт, получаю контракт создания темы, ручного pin/unpin и живого вида (с «почему»).
**Что входит:** маршруты `POST /themes`, `PATCH :id`, `POST :id/archive`, `POST :id/pin`, `DELETE :id/pin/...`; DTO; расширение `ThemeItemDto`/`ThemeDetailDto` (blocks с `addedVia/score/reason`; decisions/tasks/documents/regulations); permission-фильтр (`OR: team | personal&&автор`); team-create gate; Swagger + коды ошибок.
**Что НЕ входит:** frontend (Ф6).
**Файлы:** `themes.controller.ts`(:50), `api/dto/theme.dto.ts`. `ThemeDetailDto.regulations` — join `Regulation`/`Instruction` по `entityId ∈ ThemeEntity(themeId)`.
**Acceptance:** Swagger показывает маршруты; `POST /themes {personal}` → `isMine:true`; чужая personal-тема не видна user B (негативный тест); `POST /themes {team}` рядовым → 403 `forbidden_team_theme`; `DELETE pin` удаляет и исключает; `GET :id` отдаёт блоки с `addedVia/score/reason` и regulations. `typecheck && lint && build` зелёные.
**Закрывает:** R1, R3, R5(часть), R6, R7.

### Ф5 — Мост «обязательство → задача» [x]
**Ценность:** как менеджер, из обязательства темы одной кнопкой завожу задачу.
**Что входит:** `POST /api/v1/knowledge/themes/:id/commitments/:blockId/to-task` → существующий сервис задачи трекера, связь задача↔блок↔тема; `taskId`.
**Файлы:** `themes.controller.ts`; сервис трекера (перечитать).
**Acceptance:** из обязательства создаётся задача, видимая в трекере, связанная с темой; повтор не дублирует. Spec зелёный.
**Закрывает:** R5.

### Ф6 — Живой вид (frontend) [x]
**Ценность:** как менеджер, вижу тему красивой читаемой страницей; лишнее убираю кликом; «почему» — по клику.
**Что входит:** слой `ApiDto→DomainModel→UiModel` (`frontend/src/api/themes.api.ts`, `frontend/src/domain/theme.ts`); флоу создания темы фразой; живая страница (суть/summary, лента событий, «кто в теме», решения/обязательства с кнопкой «завести задачу», связанные задачи, **регламенты/документы темы** read-only, «почему в теме» по клику, кнопка убрать); состояния пусто/загрузка/ошибка; UI по-русски, парные токены. **Без бейджей «на подтверждение».**
**Что НЕ входит:** дизайн-полировка; пульс руководителю (vNext).
**Файлы:** `themes.api.ts`, `domain/theme.ts`, `themes/ThemesClient.tsx`, `themes/[id]/ThemeDetailClient.tsx` (перечитать), новый компонент создания.
**Acceptance:** менеджер создаёт тему фразой → видит наполнение; страница рендерит секции (макет blueprint §4б); «почему это здесь» открывается по клику; «убрать» удаляет и не возвращает; `typecheck && lint && build` зелёные; `test:unit` зелёный; playwright: создание темы + удаление привязки (скриншот).
**Закрывает:** R1, R4, R5, R7.

---

## Требования (трассировка)
- **R1** Когда человек вводит фразу темы, система shall создать `Theme(origin=user, createdByUserId, visibility)` и посчитать embedding; система shall НЕ создавать и НЕ предлагать темы автоматически.
- **R2** Когда появляется контент с близостью к теме **≥ `threshold`**, система shall **сам** привязать его (`ThemeIdeaBlock(addedVia=autofill)`) без подтверждения; контент **< `threshold`** shall НЕ добавляться и НЕ выноситься на подтверждение.
- **R3** Когда пользователь убирает привязку, система shall удалить её и записать `ThemeExclusion`; повторное авто-наполнение shall НЕ возвращать исключённое. Near-дубликаты shall не добавляться.
- **R4** Система shall показывать «почему в теме» (`score`/`reason`/`addedVia`) по запросу пользователя (не уведомлением).
- **R5** Когда менеджер жмёт «завести задачу» на обязательстве темы, система shall создать задачу трекера, связанную с темой и блоком.
- **R6** Если тема `personal`, then её видит только автор (в рамках Org); `team`-тему создаёт только manager+.
- **R7** Живая страница темы shall показывать регламенты/инструкции (через сущности темы) и документы (`attachedThemeId`) read-only со ссылкой в раздел.

## Pre-mortem / Риски и ревью-аспекты
- **Авто-наполнение кладёт лишнее** (диаризация ~30%) → высокий `threshold` + дедуп + лёгкое удаление + `ThemeExclusion`; НЕ решаем это подтверждениями (владелец против). Ревью — на разумность дефолта порога.
- **Протечка personal-темы** → негативный тест (Ф4); ревью tenant/owner-фильтра.
- **Наводнение темы** (слишком много авто-добавлений) → `maxPerScan` + порог; метрика `z_theme_autofill_added_total`.
- **Стоимость** → pgvector без LLM на блок; `reason` шаблоном.
- **Observability:** `z_theme_autofill_added_total`, `z_theme_exclusions_total`; логи pino.

## Сквозные аспекты
- **RBAC/tenant:** TenantGuard на всех эндпоинтах; personal-owner-фильтр. **[Ф2/Ф4]**
- **Observability:** метрики+логи. **[Ф3/Ф4]**
- **Ошибки+идемпотентность:** коды ошибок; авто-вставка/unpin/мост идемпотентны; `@@unique(ThemeExclusion)`. **[Ф1/Ф2/Ф4/Ф5]**
- **Миграция данных:** дефолты покрывают старое `[N/A: origin=auto/visibility=team/addedVia=clustered]`.
- **Rollout/флаг (Ship-On):** выкатывается включённой; `theme.autofill.enabled` — kill-switch (ON); В1 (team-тема manager+) — решение владельца про доступ, с ролью-порогом. Строки в `docs/operations/feature-flags.md`.
- **Тесты:** unit (Ф2), крон-spec (Ф3), интеграция API (Ф4), мост (Ф5), frontend unit+playwright (Ф6).

## Prod-deploy (`docs/operations/prod-deploy-log.md`)
- **Шаг 4:** таблица `ThemeExclusion` + колонки `Theme.origin/createdByUserId/visibility` + `ThemeIdeaBlock.addedVia/score/reason` + enum → миграция авто.
- **Шаг 1:** крутилки `theme.autofill.*` (реестр/сид).
- **Шаг 12:** smoke крона `theme-autofill` + Swagger новых эндпоинтов.
- **feature-flags.md:** `theme.autofill.enabled` (kill-switch ON); право team-темы (manager+).

## DoD
`typecheck`(вкл. `.spec`)/`lint`/`build` зелёные; тесты зелёные; second-brain обновлён (`01_projects/` knowledge-core/темы, `02_architecture/data-model.md` — новая таблица/колонки, `module-map.md` — воркер/эндпоинты, `api-layer.md` — маршруты, `admin.md` — крутилки, `workers-queues.md` — крон); `prod-deploy-log.md` Шаги 1/4/12; рефлексия.

## Итог
**Реализовано целиком (Ф1–Ф6), 2026-07-03.** Коммиты: Ф1 `229c108e` (модель+миграция `20260703000000_living_topic_space`), Ф2 `41ae5351` (ThemeWriteService/ThemeFillService + `RbacService.canCreateTeamTheme`), Ф3 `3d58ff80` (ThemeAutofillCron + 5 крутилок `theme.autofill.*` + метрика `z_theme_autofill_added_total` + сид + UI), Ф4 `599fba33` (HTTP-API create/rename/archive/pin/unpin + живой вид DTO + `z_theme_exclusions_total`), Ф5 `128e844a` (мост «обязательство→задача» через IssuesService+inbox-проект, идемпотентно), Ф6 `cbdb8471` (фронтенд: живая страница, создание, «почему», unpin).

Верификация: typecheck (8GB) 0 ошибок на всех фазах; vitest зелёный (unit сервисов/крона/контроллера + фронт-мапперы); backend `bun run build` (DI со всеми контроллерами/сервисами/кроном/мостом) `BUILD_EXIT=0`; frontend build — роуты `/themes/[id]` собраны; миграция применена `migrate deploy` (hand-write из-за out-of-order pending), колонки/таблица/FK/enum проверены в БД; сид крутилок идемпотентен (created=5→updated=5).

**Ключевые решения:** миграция hand-write+`migrate deploy` (не `migrate dev` — риск reset на out-of-order pending); идемпотентность `ThemeExclusion` через app-level `findFirst`-guard (PG NULLS DISTINCT); authz на контроллере, сервисы чистые; `themeAutofillOpts()` async `getDynamic`; 5-я крутилка `dedupeSimilarity` под R3.

**Осталось (на ручную приёмку после прод-выката):** playwright-скриншоты живой страницы и удаления привязки (нужен живой стенд) — через `qa-tester`.

---
> Дальше → реализация `tz-orchestrator` (по явному «начни реализацию»).
