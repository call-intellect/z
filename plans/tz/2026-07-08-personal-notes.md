---
type: tz
status: ready-to-implement
feature: personal-notes
date: 2026-07-08
owner: Сергей (владелец продукта)
relates_to:
  - plans/architecture/2026-07-08-personal-notes.md
  - plans/analysis/2026-07-07-personal-notes-capture-review.md
  - plans/tz/2026-07-07-freenote-null-source-no-tasks.md
---
> Архитектура (одобрена владельцем 2026-07-08): `plans/architecture/2026-07-08-personal-notes.md` (status: approved) · Анализ: `plans/analysis/2026-07-07-personal-notes-capture-review.md` (research-complete) · Статус согласования: все 5 продуктовых развилок + развилка «only_me» решены владельцем 2026-07-08.

# ТЗ — «Мои заметки» (личный рабочий блокнот: захват → лента по дням → авто-тип → разбор)

## Принцип

Это **витрина + перевод поверх готового движка**, а не новый движок. Захват (`/dump` + `free_note` голосом/текстом), авто-классификация (`~50 SignalType`), материализация (`Idea`/`Decision`/`Issue`), разбор дня (`personal-day-narrative`) **уже работают**. Новое: (1) лёгкая сущность `Note` как видимая карточка захвата; (2) страница «Мои заметки» (лента по дням + карточка с исходом); (3) UI-тип на заметке (маппинг `SignalType`→5 ярлыков) с правкой постфактум; (4) жесты «в задачу/в идею»; (5) секция заметок в «Твой день» + личный recall; (6) флажок `only_me`. **Не оптимизируй в сторону «переписать конвейер» — конвейер переиспользуется.**

**Вне scope / отложено владельцем:** полноценный PKM-редактор, ручные backlinks, вложенные страницы, «сущность день», resurfacing («эта мысль всплыла снова» / «этот день год назад») — vNext, отдельным ТЗ. Личные заметки как у физлица (быт) — не наш сценарий (рамка владельца: заметки рабочие).

---

## Цель + Зачем

**Цель:** дать сотруднику/руководителю видимый личный рабочий блокнот — где брошенная на ходу мысль сохраняется, листается по дням, сама получает понятный тип, возвращается разобранной («Кора разобрала: 2 задачи · 1 идея») и одним касанием превращается в задачу/идею — при этом по умолчанию кормит память компании.

**Болезненное состояние (по анализу §1):** захват уже есть, но он «write-only в граф» — захваченную мысль **негде увидеть**, нельзя полистать по дням, не виден тип и исход. Пользователь ощущает «второй мозг, в который ничего не возвращается» и **бросает захват**. Рыночная дыра (анализ §0, §5): полной петли «накидал → само разложилось по типам → вернулось разобранным» не даёт **никто** (ни зарубеж, ни РФ, ни OSS) — у Коры движок для неё уже есть, не выставлен в UX. `[research: plans/analysis/2026-07-07-personal-notes-capture-review.md §0,§5]`

**Метрика «решено» (глазами пользователя):** доля заметок с видимым исходом (стала задачей/идеей/фактом, видна в ленте) → ~100% захваченного видно в «Моих заметках»; недельное удержание захвата (человек продолжает писать на 2-й/4-й неделе).

---

## REALITY-CHECK (что есть по факту, проверено по коду 2026-07-08)

| Компонент | Статус | Путь-якорь | Вывод для ТЗ |
|---|---|---|---|
| Захват текстом `/dump` | **работает** | `frontend/app/(authenticated)/dump/DumpClient.tsx`; `backend/src/modules/ingest/adapters/web-form/dump.controller.ts` (`WebFormDumpController` → `DumpService.createDump({tenantId,userId,userName,text,...})` → `{rawEventId, idempotent}`) | Хук создания `Note` встраиваем в `DumpService.createDump`. Guards: `CookieAuthGuard`+`TenantGuard`+`@RequireEntitlement('feature.adapter_web_form')` |
| Захват `free_note` (in-app + Telegram/MAX голос→ASR) | **работает** | `backend/src/modules/conversational/adapters/conversational-ingest.adapter.ts` (`ingestFreeNote({tenantId,userId,text,...})` → `RawEvent(sourceType='conversational')`); `POST /api/v1/me/notifications/free-note` | Второй хук создания `Note` — здесь |
| Авто-классификация в блоки | **работает** | `enum SignalType` `backend/prisma/schema.prisma:412` (~50 значений); block-ingest → `IdeaBlock(signalType)` | UI-тип = маппинг `SignalType`→5 ярлыков поверх готового |
| Провенанс заметка→блоки | **работает** | `IdeaBlockEvidence(rawEventId, blockId, tenantId)` `@@index([rawEventId])`; `IdeaBlock @@id([id, tenantId])` | Grounding: `Note.rawEventId` → `IdeaBlockEvidence` → `IdeaBlock` |
| Материализация исхода | **работает** | `Idea`/`Issue`/`Decision` несут `sourceBlockIds String[]` | «Кора разобрала» = блоки заметки ∩ `sourceBlockIds` сущностей |
| Прецедент staging-модели | **работает** | `model IntakeIssue` `backend/prisma/schema.prisma` (status/rawContent/extracted*/suggested*/sourceBlockIds/triagedByUserId/createdIssueId); `intake-auto-triage.worker.ts`; `MeInboxController` (`@Controller('api/v1')`, `GET me/inbox`, cursor-пагинация) | `Note` моделируем зеркалом; `/me/notes`-контроллер по образцу `MeInboxController` |
| Разбор дня | **работает (эксп.)** | `PersonalDayNarrativeService.buildPersonDayPackage(...)` + `personal-day-narrative.prompt.ts` (`PERSONAL_DAY_NARRATIVE_TASK_TYPE='personal-day-narrative'`, JSON verdict+letter) `backend/src/modules/operations/` | Добавляем секцию «заметки за день» в package + prompt |
| **`RawEvent` НЕ имеет `userId`** | **ограничение** | `model RawEvent` `backend/prisma/schema.prisma` — userId живёт в `payload` JSON, без индекса | Листинг «мои заметки по дням» — по **новой** `Note.authorUserId` + индекс, НЕ по RawEvent |
| Страница «Мои заметки» / листинг заметок / UI-тип | **НЕТ** | — | Главный объём ТЗ |
| free_note без источника → задача не заводится | **известный баг**, отдельное ТЗ | `plans/tz/2026-07-07-freenote-null-source-no-tasks.md` | Граничный контракт (см. ниже): наш жест «в задачу» создаёт `Issue` **напрямую** из заметки, не полагаясь на авто-путь |

**Пересчёт scope по факту:** ~90% — витрина/перевод поверх готового; ~10% — новая модель `Note` + деривация типа + scoping `only_me`. Фазы нарезаны под остаток.

---

## Принятые решения владельца (2026-07-08, не пересматривать)

| # | Решение | Обоснование (почему) |
|---|---|---|
| В1 | Заметка по умолчанию **кормит память компании**; граница «сырьё↔результат» (сырьё в «Моих заметках», результат `Idea`/`Decision`/`Issue` — общий слой) | Рабочий контент — в этом смысл; наполнение памяти = фокус месяца `[project_prod-scale-early]` |
| В2 | `only_me` заметка **всё равно разбирается для автора** (тип + личный поиск + разбор), но **не** в общий граф / чужим помощникам / в клоны | Иначе «только для меня» = чёрная дыра «записал и потерял» — та боль, что чиним |
| В3 | Hero экрана — **recall + «что Кора сделала»** (поиск по своим + видимый исход с grounding); лента по дням вторична, «вспомнить», не архив | Данные оттока: архив-лента угасает (Roam 80/20) `[analysis §7, red-team]` |
| В4 | Тип — **авто**, read-only на карточке, правится задним числом одним касанием; **никогда** не спрашивать тип на входе | Вопрос «куда это?» на 5-сек захвате — прямая причина оттока Roam `[analysis §8.3]` |
| В5 | Модель — **лёгкая `Note`** (зеркало `IntakeIssue`), группировка по дате на выдаче, **не** «сущность день», **не** PKM | Чистые edit/delete, дешёвая лента, свой проверенный прецедент |
| В6 | Разбор — **секция в `personal-day-narrative`** + pull «разбери по запросу»; **не** новый push-дайджест | digest-fatigue + дубль существующего разбора дня |
| В7 | Быстрый ввод переезжает наверх «Моих заметок»; `/dump` поглощаем, старый вход временно оставить | Одно понятное место «пишу и вижу» |
| В8 | 5 ярлыков типа: **заметка · задача · идея · рассуждение · вопрос** (остальные ~50 `SignalType` сворачиваются) | Аудитории нужна понятная горстка, не 50 типов |

Полное доказательство выбора (матрица вариантов A/B/C + JTBD + состязательный red-team) — `plans/analysis/2026-07-07-personal-notes-capture-review.md §6–§7`. Здесь не дублируется.

---

## Scope

**Входит:** модель `Note` + миграция + запись при захвате (оба канала) + бэкфилл существующих free_note; авто-деривация UI-типа (маппинг `SignalType`→5); страница «Мои заметки» (лента по дням, карточка с исходом+grounding); правка типа; жесты «в задачу»/«в идею»; секция заметок в «Твой день» + pull-разбор; личный recall «спроси свои заметки»; флажок `only_me` + retrieval-scoping.

**Не входит (→ судьба):**
- Полный PKM-редактор / ручные backlinks / «сущность день» → **vNext, отдельное ТЗ** (не планируется по решению владельца).
- Resurfacing («мысль всплыла снова», «этот день год назад») → **vNext-заглушка** (анализ §2 ветвь 7, отдельным треком).
- Фикс авто-пути free_note→задача → **отдельное ТЗ** `plans/tz/2026-07-07-freenote-null-source-no-tasks.md` (наш жест «в задачу» независим — создаёт Issue напрямую).
- Мобильное приложение / оффлайн-очередь захвата → вне scope (захват уже покрыт Telegram/веб).

---

## Граничные контракты с другими ТЗ

- **`plans/tz/2026-07-07-freenote-null-source-no-tasks.md`** (авто-создание задачи из free_note без источника): НАШ жест «Сделать задачей» (Ф3/Ф5) создаёт `Issue` **явно по действию пользователя** через существующий `IssuesService.create(...)` с `sourceBlockIds` заметки — НЕ ждёт и не реализует авто-путь того ТЗ. Оба могут сосуществовать: авто-путь (когда починят) заведёт кандидата в «Входящие», наш путь — прямую задачу по кнопке. Пересечение дедуплится штатным дедупом задач (существует).
- **`IssuesService` / трекер** — используем как есть (создание `Issue`), не меняем его контракт. `Issue.sourceBlockIds` заполняем блоками заметки для замыкания петли decision-task-link (существующий механизм).
- **`Specialist36IdeasService` / `ideas`** — жест «в идею» вызывает существующий путь материализации идеи (или линкует уже созданную из блоков `Idea`), не дублирует движок идей.

---

## Доказательство выбора (сводка; полное — в анализе)

Два прохода:
- **A (реализованный):** лёгкая `Note` поверх существующего конвейера, тип деривится из `IdeaBlock.signalType`, исход — из `sourceBlockIds`.
- **B (отвергнутый):** тонкая проекция на `RawEvent` без модели `Note`.

| Критерий | A: лёгкая `Note` | B: проекция на `RawEvent` |
|---|---|---|
| Листинг «по дням» по автору | ✓ `@@index([tenantId, authorUserId, capturedAt])` | ✗ у `RawEvent` нет `userId`-колонки/индекса |
| Правка/удаление «моей заметки» | ✓ обычная запись | ✗ `RawEvent` — неизменяемый конверт (`idempotencyKey`/`checksum`) |
| Флажок `only_me` / связь с исходом | ✓ поля на `Note` | ✗ негде хранить чисто |
| Соответствие своему прецеденту | ✓ зеркало `IntakeIssue` | ✗ ломает event-sourced инвариант |
| Стоимость | средняя | «дешевле», но упирается в тупики выше |

**Challenge-loop:** (1) корень — «невидимость исхода захвата», не «нет ленты»; лечим показом исхода, не только лентой. (2) эффективность — не новый конвейер, а деривация поверх готового; тип считаем **on-write при готовности блоков** (реконсиль), не на каждом чтении. (3) без кода ради кода — `Note` не дублирует `IdeaBlock`/`Issue`, а ссылается (`rawEventId`/`convertedIssueId`).

---

## Границы фичи (автономия суб-агента)

- **✅ Always:** переиспользовать `DumpService`/`ingestFreeNote`/`IdeaBlockEvidence`/`IssuesService`/`PersonalDayNarrativeService`; `TenantGuard` на всех эндпоинтах; фильтр по `authorUserId = currentUser` для «моих заметок»; крутилки (квота, маппинг типов) через `getDynamic`(AdminSetting)+code-fallback; UI только по-русски; Zod-DTO+Swagger на каждом эндпоинте; слои `ApiDto→DomainModel→UiModel`.
- **⚠️ Ask first:** менять контракт `IssuesService`/`Idea`/`personal-day-narrative` prompt-версию (только расширение секции, не ломать `personal-day-v1` кэш); добавлять новый `SignalType` (НЕ требуется — маппинг поверх существующих).
- **🚫 Never:** спрашивать тип на входе; авто-создавать задачу/идею без подтверждения (R13); писать `Note` вместо `RawEvent` (пишем **и** то, и то — заметка кормит граф); `process.env.*` мимо `env.schema.ts`; `new PrismaClient()` в скриптах; `prisma migrate` руками без файла-миграции; хардкод порогов/маппинга в коде без code-fallback+AdminSetting.

---

## Требования (R1…Rn)

- **R1.** Когда пользователь создаёт заметку (`/dump` или `free_note` любым каналом), система shall создать запись `Note{tenantId, authorUserId, capturedAt, text, source, visibility='company'(default), noteType=null, status='captured', rawEventId}` в той же транзакции/сразу после создания `RawEvent`, идемпотентно по `rawEventId` (повтор → тот же `Note`).
- **R2.** Когда block-ingest завершил разбор `RawEvent` заметки, система shall вычислить `noteType` ∈ {note,task,idea,reasoning,question} по доминирующему `SignalType` производных `IdeaBlock` через маппинг-таблицу и записать `Note.noteType`, `noteTypeSource='auto'`, `status='analyzed'`. Если блоков нет — `noteType='note'`.
- **R3.** Если пользователь меняет тип заметки (`PATCH /me/notes/:id {noteType}`), then система shall записать новый `noteType`, `noteTypeSource='user'` и больше не перетирать его авто-деривацией.
- **R4.** Когда пользователь открывает «Мои заметки», система shall вернуть его заметки (`authorUserId = currentUser`, `tenantId`), отсортированные по `capturedAt DESC`, cursor-пагинация; каждая — с `noteType`, `text`, `capturedAt`, `source`, `visibility` и сводкой исхода `{tasks:n, ideas:n, decisions:n, facts:n}`.
- **R5.** Когда пользователь раскрывает заметку, система shall вернуть разбор с grounding: список производных `IdeaBlock` (тип+текст) и материализованных `Idea`/`Issue`/`Decision` (через `sourceBlockIds ∩` блоки заметки) с ссылками-идентификаторами на источник.
- **R6.** Если пользователь нажимает «Сделать задачей» (`POST /me/notes/:id/convert-to-task`), then система shall создать `Issue` из текста/блоков заметки (с `sourceBlockIds`), записать `Note.convertedIssueId`, вернуть ссылку; авто-создания без нажатия НЕТ (R13).
- **R7.** Если пользователь нажимает «В идею» (`POST /me/notes/:id/convert-to-idea`), then система shall создать/слинковать `Idea` и записать `Note.convertedIdeaId`.
- **R8.** Когда строится «письмо Твой день», система shall включить секцию «твои заметки за день» (счётчики по типам + что стало задачами/идеями + «висит без действия»), при наличии ≥1 заметки за день; при 0 — секцию пропустить.
- **R9.** Когда пользователь спрашивает «спроси свои заметки» (`POST /me/notes/search {query}`), система shall вернуть ответ по **его** заметкам (личный срез retrieval, включая `only_me`) с ссылкой на источник-заметку.
- **R10.** Если `Note.visibility='only_me'`, then её производные блоки shall быть исключены из общекомпанейского retrieval (чужие помощники / дашборд / клоны), но включены в личный recall автора (R9) и в его «Твой день».
- **R11.** Заметка shall кормить память компании по умолчанию (`visibility='company'`): её `RawEvent` идёт в конвейер как сейчас, без регресса.
- **R12.** Существующие free_note до выката shall быть отражены в ленте: бэкфилл создаёт `Note` для прошлых `RawEvent(sourceType='conversational'|web-form dump)` идемпотентно.

---

## Фазы

Граф зависимостей: **Ф1 → Ф2 → Ф3 → Ф4**; **Ф5** зависит от Ф1+Ф3(бэкенд); **Ф6** зависит от Ф1; **Ф7** зависит от Ф1+Ф3. Ф2 и Ф6 можно вести параллельно после Ф1. Ф4 (фронт) — после Ф3 (эндпоинты).

```
Ф1 модель+захват ──┬── Ф2 авто-тип ──┐
                   │                 ├── Ф3 бэкенд /me/notes ── Ф4 фронт «Мои заметки»
                   ├── Ф6 «Твой день»+recall (парал.)
                   └── Ф7 only_me+scoping (после Ф3)
```

---

### Ф1 — Модель `Note` + миграция + запись при захвате + бэкфилл

**Ценность:** как сотрудник, получаю невидимую пока, но сохранённую и адресуемую запись каждой моей заметки, чтобы её можно было показать и листать по дням.

**Что входит:**
- Prisma-модель `Note` (зеркало подмножества `IntakeIssue`), enum `NoteType`, `NoteVisibility`, `NoteStatus`. Дословный контракт:
```prisma
enum NoteType {
  note
  task
  idea
  reasoning
  question
}

enum NoteVisibility {
  company     /// по умолчанию: кормит память компании (В1)
  only_me     /// разбирается для автора, но не в общий граф (В2)
}

enum NoteStatus {
  captured    /// создана, блоки ещё не разобраны
  analyzed    /// noteType вычислен
}

model Note {
  id             String         @id @default(cuid())
  tenantId       String
  authorUserId   String
  capturedAt     DateTime       @default(now())
  text           String         @db.Text
  source         String         /// web_form | free_note_in_app | telegram | max | api
  noteType       NoteType?      /// null пока status=captured
  noteTypeSource String?        /// 'auto' | 'user' (после правки не перетирать авто)
  visibility     NoteVisibility @default(company)
  status         NoteStatus     @default(captured)
  rawEventId     String?        @unique  /// связь с конвейером; @unique = идемпотентность R1
  convertedIssueId String?
  convertedIdeaId  String?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  org      Org      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  rawEvent RawEvent? @relation(fields: [rawEventId], references: [id], onDelete: SetNull)

  @@index([tenantId, authorUserId, capturedAt])   /// лента «мои заметки по дням» (R4)
  @@index([tenantId, status])                       /// реконсиль авто-типа (Ф2)
}
```
  > `[ASSUMPTION]` обратную relation `notes Note[]` добавить в `Org` и `RawEvent` (иначе Prisma не сгенерит). Проверить перед правкой — номера строк дрейфуют.
- Миграция: `bun run prisma:migrate -- --name add-note-model` (версионируемая, CLAUDE.md; **не** `db push`), ревью SQL, затем `bun run prisma:generate`.
- Хук записи `Note` в **обоих** каналах захвата:
  - `DumpService.createDump(...)` — после создания `RawEvent` создать `Note{source:'web_form', authorUserId:userId, text, rawEventId}`.
  - `ConversationalIngestAdapter.ingestFreeNote(...)` — создать `Note{source: маппинг канала (in_app/telegram/max), authorUserId:userId, text, rawEventId}`. (Только для `kind='free_note'`, не для `notification_response`.)
  - Идемпотентность: `upsert` по `rawEventId` (`@unique`).
- Бэкфилл-скрипт `backend/scripts/backfill-notes-from-free-events.ts` (R12): по `RawEvent(sourceType='conversational')` с `payload.kind='free_note'` + web-form dump за окно (напр. 90 дней) создать `Note` идемпотентно (`upsert` по `rawEventId`); `createPrismaClient()` из `scripts/_lib/prisma.ts`, импорты из `../src`; регистрация в `apply-prod-deploy.ts` `STEPS` (phase=backfill, `skipBootstrap:true`).
- Kill-switch `NOTES_SURFACE_ENABLED` (default ON, аварийный рубильник — только гасит выдачу UI/эндпоинтов; запись `Note` идёт всегда) → строка в `docs/operations/feature-flags.md`.

**Что НЕ входит:** деривация типа (Ф2), эндпоинты чтения (Ф3), UI (Ф4).

**Файлы:** `backend/prisma/schema.prisma` (+модель/enum, +обратные relations); `backend/prisma/migrations/*`; `backend/src/modules/ingest/adapters/web-form/dump.service.ts`; `backend/src/modules/conversational/adapters/conversational-ingest.adapter.ts`; `backend/scripts/backfill-notes-from-free-events.ts`; `backend/scripts/apply-prod-deploy.ts` (STEPS); `docs/operations/feature-flags.md`; `docs/operations/prod-deploy-log.md` (Шаг 4 модель, Шаг 8 backfill).

**Зависимости:** нет (стартовая).

**Acceptance:**
- `bun run prisma:generate` без ошибок; миграция в `prisma/migrations/` содержит `CREATE TABLE "Note"` + индексы `(tenantId, authorUserId, capturedAt)` и `(tenantId, status)`.
- Grep: `enum NoteType` и `model Note` в `schema.prisma`; `@@unique`/`@unique` на `rawEventId`.
- Юнит-тест: создание dump → в БД есть `Note` с тем же `rawEventId`, что вернул эндпоинт; повторный вызов с тем же `nonce` → тот же `Note` (idempotent, R1).
- Юнит-тест: `ingestFreeNote` создаёт `Note(source='telegram')` при metadata-канале telegram.
- Бэкфилл идемпотентен: повторный прогон = 0 новых `Note` (acceptance-критерий).
- `bunx vitest run backend/src/modules/ingest/adapters/web-form` зелёный; `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` зелёные.

**Закрывает:** R1, R11, R12.

---

### Ф2 — Авто-деривация UI-типа (`SignalType`→5 ярлыков)

**Ценность:** как сотрудник, вижу на заметке понятный ярлык (заметка/задача/идея/рассуждение/вопрос) без единого действия, чтобы не разбирать инбокс руками.

**Что входит:**
- Маппинг-таблица `SignalType`→`NoteType` как **code-fallback** + крутилка AdminSetting `notes.typeMap` (`getDynamic`, resolveSync admin→ENV→code). Дефолт (`[ASSUMPTION]`, тюнится владельцем через AdminSetting — LOW-impact):
  - `task` ← `task_created, action_item, plan_item, task_status_changed, task_blocked, task_completed, task_overdue, task_reassigned`
  - `idea` ← `idea, feature_request, suggestion, hypothesis`
  - `question` ← `question, knowledge_gap`
  - `reasoning` ← `reasoning, rationale, decision_basis, lesson, experience, methodology_step`
  - `note` ← всё остальное (`fact, mood, decision, commitment, risk, pain, ...`) + fallback при отсутствии блоков
- Деривация `noteType` из доминирующего типа производных блоков заметки: `Note.rawEventId` → `IdeaBlockEvidence(rawEventId)` → `IdeaBlock.signalType` → маппинг → мода (при ничьей — приоритет `task > question > idea > reasoning > note`).
- Триггер: реконсиль-крон `@Cron` (in-process, `WorkersModule`) каждые N минут (крутилка `notes.typeReconcileIntervalMin`, default 2) — берёт `Note(status='captured')` чей `RawEvent.processingStatus='processed'`, деривит `noteType`, ставит `status='analyzed'`. (Событийный листенер на завершение block-ingest — опц. оптимизация, `[ASSUMPTION]` реконсиль-крон достаточен и проще.)
- Правка типа не трогается авто-деривацией: реконсиль пропускает `noteTypeSource='user'`.

**Что НЕ входит:** UI-показ (Ф4), правка через API (Ф3).

**Файлы:** `backend/src/modules/notes/*` (новый модуль: `notes.module.ts`, `services/note-type.service.ts`, `services/note-type.map.ts`, `workers/note-type-reconcile.cron.ts`); `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` (+`notes.typeMap`, `notes.typeReconcileIntervalMin`); сид AdminSetting.

**Зависимости:** Ф1.

**Acceptance:**
- Юнит-тест `note-type.map.spec.ts`: `SignalType.task_created→task`, `idea→idea`, `question→question`, `lesson→reasoning`, `fact→note`, неизвестный→`note`.
- Юнит-тест деривации: заметка с блоками `[idea, fact]` → `noteType='idea'`; `[fact, fact]` → `note`; без блоков → `note`.
- Реконсиль: `Note(status=captured)` с обработанным `RawEvent` → после прогона `status='analyzed'`, `noteType` заполнен, `noteTypeSource='auto'`; `noteTypeSource='user'` не перезаписан.
- Grep: `notes.typeMap` в `admin-setting-schema-registry.ts`; `@Cron` в `note-type-reconcile.cron.ts`.
- `bunx vitest run backend/src/modules/notes` зелёный; typecheck/lint/build зелёные.

**Закрывает:** R2 (частично R3 — «не перетирать user»).

---

### Ф3 — Бэкенд `/me/notes`: лента + карточка с исходом + правка типа + конвертация

**Ценность:** как сотрудник, получаю данные для ленты по дням и разбора заметки (что из неё стало), чтобы фронт показал исход и дал жесты.

**Что входит (эндпоинты, `@Controller('api/v1')`, `CookieAuthGuard`+`TenantGuard`, Zod-DTO+Swagger, по образцу `MeInboxController`):**
- `GET /me/notes?cursor=&limit=&type=&from=&to=` — мои заметки (`authorUserId=currentUser`), `capturedAt DESC`, cursor-пагинация; каждая с `outcomeSummary{tasks,ideas,decisions,facts}` (агрегат по блокам ∩ материализованным сущностям). Группировку по дате делает **фронт** (В5 — не «сущность день»).
- `GET /me/notes/:id` — заметка + разбор: производные `IdeaBlock[]{signalType→ярлык, text}` + `Idea[]`/`Issue[]`/`Decision[]` через `sourceBlockIds ∩ blockIds(note)` с идентификаторами-ссылками (grounding «моё vs Кора»).
- `PATCH /me/notes/:id` — правка `noteType` (→ `noteTypeSource='user'`), правка `text` (edit своей заметки), soft-delete (`DELETE /me/notes/:id`). Только автор (403 иначе).
- `POST /me/notes/:id/convert-to-task` — создать `Issue` через `IssuesService.create` с `sourceBlockIds` заметки, записать `convertedIssueId`, вернуть `{issueId}` (R6, HITL — только по вызову).
- `POST /me/notes/:id/convert-to-idea` — материализовать/слинковать `Idea`, записать `convertedIdeaId` (R7).
- `NoteService` + DTO-цепочка; метрики prom-client (`notes_created_total{source}`, `notes_converted_total{target}`, `notes_type_edited_total`).

**Что НЕ входит:** фронт (Ф4); recall-поиск (Ф6); only_me-scoping (Ф7 — здесь `GET` уже фильтрует по автору, но исключение из чужого retrieval — в Ф7).

**Файлы:** `backend/src/modules/notes/notes.controller.ts` (`MeNotesController`); `backend/src/modules/notes/services/note.service.ts`; `backend/src/modules/notes/dto/*` (Zod: `NoteListQuery`, `NoteResponse`, `NoteDetailResponse`, `NotePatch`, `ConvertResponse`); `backend/src/common/metrics/*` (счётчики).

**Зависимости:** Ф1 (модель), Ф2 (noteType); `IssuesService`, `Idea`-материализация.

**Acceptance:**
- Swagger smoke: `/api/v1/me/notes` GET/PATCH/DELETE, `/me/notes/:id`, `/me/notes/:id/convert-to-task`, `/me/notes/:id/convert-to-idea` в `/api/docs`.
- e2e: создать 2 заметки → `GET /me/notes` вернул обе в `capturedAt DESC`, чужую заметку не вернул (tenant+author фильтр).
- e2e: `GET /me/notes/:id` для заметки с блоком типа idea, у которой есть `Idea(sourceBlockIds ∋ blockId)` → в ответе `ideas:[{id,...}]` (grounding).
- e2e: `convert-to-task` → создан `Issue`, `Note.convertedIssueId` заполнен, повторный вызов не плодит второй Issue (идемпотентность по `convertedIssueId`).
- e2e negative: `PATCH` чужой заметки → 403 `{code:'forbidden'}`.
- `bunx vitest run backend/src/modules/notes` (unit+integration) зелёный; typecheck/lint/build зелёные.

**Закрывает:** R3, R4, R5, R6, R7.

---

### Ф4 — Фронт «Мои заметки» (лента по дням + карточка + чипы + жесты + захват)

**Ценность:** как сотрудник, открываю «Мои заметки» и вижу всё, что накидал, по дням, с типами и исходом, пишу новую заметку сверху — чтобы захват перестал быть «выстрелил и забыл».

**Что входит (Next.js App Router, слои `ApiDto→DomainModel→UiModel`, единый `api-client.ts`, SWR, только русский):**
- Раздел `app/(authenticated)/notes/` (`page.tsx` + `NotesClient.tsx`): быстрый ввод сверху (текст + 🎤 — переиспользовать логику `DumpClient`, В7), лента заметок, свёрнутая по дням (группировка на клиенте по `capturedAt`), чип типа слева на карточке, «Кора разобрала: N задач · N идей» с раскрытием.
- Карточка раскрыта (макет 2 блюпринта): твой текст ↔ визуально отделённый блок «Кора разобрала» с ссылками на `Idea`/`Issue`; жесты «Сделать задачей»/«В идею»; смена типа (dropdown, PATCH); флажок видимости (заглушка UI до Ф7 — показываем «🌐 в памяти компании», переключатель активируется в Ф7).
- `src/api/notes.api.ts` (ApiDto), `src/domain/note.ts` (DomainModel: маппинг типа→русский ярлык, иконка), UI-компоненты.
- Пункт «Мои заметки» в sidebar (группа «Личное»/`me`); `/dump` временно оставить (редирект-баннер «переехало в Мои заметки» — В7).

**Что НЕ входит:** recall-поиск (Ф6, добавит поле «Спроси свои заметки»); реальный переключатель `only_me` (Ф7).

**Файлы:** `frontend/app/(authenticated)/notes/{page.tsx,NotesClient.tsx,NoteCard.tsx}`; `frontend/src/api/notes.api.ts`; `frontend/src/domain/note.ts`; sidebar-конфиг; `frontend/app/(authenticated)/dump/*` (баннер-редирект).

**Зависимости:** Ф3.

**Acceptance:**
- `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные.
- Playwright/ручной smoke (skill `qa-tester`): создать заметку → появилась под «Сегодня» с чипом; раскрыть → виден блок «Кора разобрала» с ссылкой; «Сделать задачей» → тост+`✓ в трекере`.
- Нет ни одного английского слова в UI; парные токены `bg-*`/`text-*-fg`, без `text-white`/hex.
- Группировка по дням — на клиенте (grep: нет запроса «сущность день»).

**Закрывает:** R4, R5 (UI), R6, R7 (UI-жесты).

---

### Ф6 — Секция «заметки за день» в «Твой день» + личный recall «спроси свои заметки»

**Ценность:** как сотрудник, получаю в письме «Твой день» короткий разбор моих заметок и могу спросить свои заметки словами — чтобы «накидал → вернулось разобранным» реально закрылось.

**Что входит:**
- Секция «заметки за день» в `PersonalDayNarrativeService.buildPersonDayPackage` (+ `personal-day-narrative.prompt.ts`): в package добавить `notesToday{count, byType, becameTasks[], becameIdeas[], danglingNoAction[]}`; в prompt — новая секция letter `key:'notes'` (расширение, **не** ломать `personal-day-v1` кэш — стабильный SYSTEM-префикс, переменные данные в конце user; если требуется bump — новая версия `personal-day-v2` с явной пометкой). Секция включается при ≥1 заметке за день (R8).
- Pull-разбор: `POST /me/notes/digest {from,to}` — сгруппировать заметки периода по темам (переиспользовать `Theme`-кластеры/блоки) + счётчики + «висит без действия»; вернуть текст (живой образец — блюпринт). Кнопка «Разобрать подробнее» на фронте.
- Recall: `POST /me/notes/search {query}` — ответ по заметкам **автора** (личный срез существующего retrieval chat-v2/Мастер, фильтр `authorUserId` + включая `only_me` автора) с ссылкой на источник-заметку (R9). Поле «🔎 Спроси свои заметки» на странице (Ф4).

**Что НЕ входит:** общий разбор всей команды (это дашборд/письмо COO — существует).

**Файлы:** `backend/src/modules/operations/services/personal-day-narrative.service.ts`; `backend/src/modules/operations/prompts/personal-day-narrative.prompt.ts`; `backend/src/modules/notes/notes.controller.ts` (+`digest`, +`search`); `backend/src/modules/notes/services/note-digest.service.ts`; фронт — поле поиска + кнопка разбора.

**Зависимости:** Ф1 (модель); использует Ф2 (типы) и Ф3 (сервис). Может идти параллельно Ф3/Ф4 в части package.

**Acceptance:**
- Юнит-тест: `buildPersonDayPackage` с 3 заметками за день → `notesToday.count=3`, разбивка по типам; с 0 → секция отсутствует.
- Prompt-совместимость: `PERSONAL_DAY_NARRATIVE_PROMPT_VERSION` не понижает кэш-хит (тест на стабильность SYSTEM-префикса) ИЛИ явный bump на `personal-day-v2` с записью в `docs/methodology/prompts/`.
- e2e: `POST /me/notes/search {query:"конкурент X"}` → ответ содержит ссылку на заметку автора; чужие заметки не попадают.
- `POST /me/notes/digest` за период → текст с счётчиками и «висит без действия».
- Тесты зелёные; typecheck/lint/build зелёные.

**Закрывает:** R8, R9.

---

### Ф7 — Флажок `only_me` + retrieval-scoping

**Ценность:** как сотрудник, могу отметить недозревшее наблюдение «только для меня» — оно разбирается для меня, но не транслируется команде, чтобы я свободно писал сырое.

**Что входит:**
- UI-переключатель видимости на карточке (Ф4-заглушка → рабочий): `PATCH /me/notes/:id {visibility}`.
- Проброс `visibility` на конвейерный слой: производные `IdeaBlock` заметки помечаются владельцем-автором и признаком приватности (через существующую модель `dataClass`/sensitivity или новый флаг `authorPrivateUserId` на блоках заметки — `[ASSUMPTION]` реюз `dataClass` предпочтителен; проверить, различает ли retrieval per-author-private от sensitivity-tier — если нет, добавить фильтр).
- Retrieval-scoping: общекомпанейские контексты (чужой chat-v2/Мастер, дашборд, клоны) **исключают** блоки `only_me`-заметок чужого автора; личный recall автора (R9) и его «Твой день» — **включают** (R10). Точка фильтра — на этапе ретрива ДО подачи в LLM (инвариант permission-aware retrieval).
- Смена `company→only_me` постфактум: ретроактивно исключить уже созданные блоки из общего слоя (обновить признак).

**Что НЕ входит:** тонкие уровни («команда/отдел») — только `company`/`only_me` (В1).

**Файлы:** `backend/src/modules/notes/*` (visibility-проброс); точка ретрива chat-v2/knowledge (фильтр `only_me` чужого автора); фронт-переключатель.

**Зависимости:** Ф1, Ф3, Ф4 (UI), точка ретрива Мастера.

**Acceptance:**
- e2e: заметка автора A `visibility='only_me'` → в ответе Мастера пользователю B её блоки НЕ участвуют; в личном recall A (R9) — участвуют.
- e2e: смена `company→only_me` → повторный запрос B больше не видит блоки заметки.
- e2e: клон/дашборд не поднимает `only_me`-блоки чужого автора.
- Negative: `only_me` не ломает `visibility='company'` путь (регресс R11 — общие заметки по-прежнему в общем retrieval).
- Тесты зелёные; typecheck/lint/build зелёные.

**Закрывает:** R10 (+ рабочий В2).

---

## Сквозные аспекты (чек анти-забывания)

- **RBAC/tenant:** все `/me/notes` — `TenantGuard` + фильтр `authorUserId=currentUser`; чужая заметка → 403. Retrieval-scoping (Ф7) — permission-aware до LLM. `@@index([tenantId, authorUserId, capturedAt])`.
- **Observability:** метрики `notes_created_total{source}`, `notes_converted_total{target}`, `notes_type_edited_total`, `notes_search_total`; логи pino на конвертацию/ошибки деривации. `[Ф3]`
- **Errors + идемпотентность:** `Note` upsert по `rawEventId` (R1); convert идемпотентен по `convertedIssueId`/`convertedIdeaId`; бэкфилл повторно = no-op.
- **Миграции/backfill:** версионируемая миграция (Ф1); backfill-скрипт в `apply-prod-deploy.ts STEPS`.
- **Rollout/флаг (Ship-On):** фича выкатывается **включённой**; `NOTES_SURFACE_ENABLED` — аварийный kill-switch (default ON), строка в `docs/operations/feature-flags.md`. Каждая фаза — самостоятельно отгружаемый слайс (Ф4 без Ф7 = все заметки company-visible = дефолт, честно и работоспособно).
- **Тесты:** unit (маппинг типов, деривация, idempotency), integration (эндпоинты, tenant/author-фильтр, convert), e2e (Ф7 scoping), фронт typecheck/lint/build + qa-tester smoke.

## Совместимость с prompt caching (Ф6)

Секция «заметки за день» добавляется в `personal-day-narrative` так, чтобы **SYSTEM-промпт остался стабильным** (кэш-префикс), а данные заметок шли в конце user-сообщения (как остальные данные дня). Если структура letter требует нового ключа `notes` в JSON-схеме — это меняет SYSTEM → тогда **явный bump `personal-day-v2`** с записью в `docs/methodology/prompts/` и обновлением few-shot. Не менять SYSTEM молча (уронит кэш-хит).

## Pre-mortem / Риски (ревью-аспекты для strict-production-review-gate)

- **Дубль записи заметки** (оба канала создают `Note`) → защита `@unique(rawEventId)` + upsert; проверить, что `notification_response` НЕ создаёт `Note`.
- **Регресс кэша `personal-day`** → Ф6 держит SYSTEM стабильным или явный bump.
- **`only_me` протекает в общий retrieval** (главный риск Ф7) → e2e-негатив на чужого пользователя + клон + дашборд; фильтр до LLM.
- **noteType «залипает» неверным** → правка пользователя (`noteTypeSource='user'`) финальна; реконсиль её не трогает.
- **Пустая лента на старте** → бэкфилл существующих free_note (R12).
- **Конвертация плодит дубли задач** → идемпотентность по `convertedIssueId` + штатный дедуп трекера.

## DoD (общий чек качества)

- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` — зелёные (backend и frontend).
- Все `bunx vitest run` по затронутым модулям — зелёные.
- Миграция закоммичена вместе с кодом; `prisma:generate` выполнен.
- Обновлены: `second-brain/01_projects/` (новая заметка `personal-notes.md` или раздел в `conversational-channels.md`/`ideas.md`), `02_architecture/data-model.md` (модель `Note`), `02_architecture/module-map.md` (модуль `notes`), `01_projects/api-layer.md` (эндпоинты `/me/notes`), `01_projects/frontend-pages.md` (раздел «Мои заметки»), `01_projects/workers-queues.md` (реконсиль-крон), `docs/operations/feature-flags.md` (`NOTES_SURFACE_ENABLED`), `docs/operations/prod-deploy-log.md` (Шаг 4 модель, Шаг 8 backfill, Шаг 12 smoke `/me/notes`+cron).
- Рефлексия в `second-brain/05_история/` после выката.

## Итог

_(заполняет tz-orchestrator по завершении: что реализовано целиком, что осталось, ссылки на коммиты/фазы.)_
