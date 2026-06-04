---
type: tz
status: ready-to-implement
feature: meeting-identity-and-clones-attribution
date: 2026-06-04
owner: Сергей (владелец продукта)
relates_to:
  - plans/analysis/2026-06-04-meetings-invite-identity-and-clones-graph-audit.md
  - plans/tz/2026-06-04-razblokirovka-konveyera.md
  - plans/archive/2026-05-25-hard-participant-identification.md
  - second-brain/01_projects/skill-and-clone.md
  - second-brain/01_projects/telegram-user-flows.md
---

> Анализ-первоисточник: `plans/analysis/2026-06-04-meetings-invite-identity-and-clones-graph-audit.md` (24 субагента, факты верифицированы по коду). Статус согласования с владельцем: 2026-06-04 — «реши всё сам, ничего не спрашивай».
>
> **Исполнение этого ТЗ — отдельная сессия** через `tz-orchestrator` (парный orchestrator-prompt: `2026-06-04-meeting-identity-and-clones-attribution-orchestrator-prompt.md`).

# ТЗ: Сквозная identity участника + атрибуция «чьё это» в графе (оживление клонов)

## Принцип
Система **узнаёт человека на входе, но теряет привязку до графа**. Этот контракт протягивает identity сотрудника сквозь весь конвейер встречи и текстовых каналов, чтобы: (а) приглашённый сотрудник был распознан (не аноним), (б) клоны строились из реальных рассуждений конкретного человека, (в) «Настя, твоя задача» доходила до трекера для всех, а не только для хоста. **Чинить корень, не симптом** — один незаписанный `IdeaBlockEntity.role='subject'` обнуляет клонов, WHO-ось, дашборд-агентов; это класс-фикс.

## Вне scope / отложено владельцем
- **Автоингест корпоративных групповых чатов** («система сама с чатов забирает») — отдельный трек, внешние блокеры (прокси per-source webhook, резолв внешнего автора, ФЗ-41). Здесь работаем только с источниками, где identity автора уже известна на входе.
- **Голосовой отпечаток / speaker embedding** (несколько голосов на одной дорожке) — vNext-страховка; сейчас «чей голос = чья дорожка».
- ~~Объединение двух путей задач~~ — **включено как Фаза 5** (по запросу владельца 2026-06-04). См. Фазу 5 ниже.
- **2-way OAuth календаря, перенос `EventParticipant`→`Meeting.Participant`** — не трогаем (календарный путь живёт отдельно).

---

## Цель + Зачем
Болезненное состояние (по аудиту, всё подтверждено по коду):
1. `Participant` не имеет `personId`, `userId` без FK и **обнуляется для всех, кроме хоста** → диаризация знает только display-имя; приглашённый сотрудник неотличим от анонима.
2. `IdeaBlockEntity.role='subject'` **не пишет ни одна строка кода** (`block-ingest.worker.ts:851-886` всегда `'mentioned'`) → ролевые клоны (`Specialist 3.7` / `ExecutablePersona`), `router.hasEmployeeSubject`, WHO-ось, дашборд-агенты читают пустую выборку. **Главная ценность продукта пустая.**
3. Приглашения сотрудников из списка в форме встречи нет; доставки приглашения на встречу (email/Telegram) нет.
4. Активный воркер `meeting-report-fast` пишет задачу строкой `assigneeRaw` **без** `assigneeUserId` (резолвер висит на `@deprecated meeting-analyze-v2`).

Чем решение лучше: оживляет клонов на уже имеющихся источниках (встречи + личный Telegram/in-app), включает адресацию задач для приглашённых, даёт «пригласить сотрудника» из готовых кирпичей.

---

## REALITY-CHECK (что уже есть / мертво / сломано по факту)
| Факт | Доказательство | Влияние на фазы |
|---|---|---|
| `enum IdeaBlockEntityRole { subject object mentioned }` **уже есть** | `schema.prisma:387-391` | Фаза 1: **enum НЕ менять**, только начать писать `subject` |
| `Task.assigneeUserId` + relation `TaskAssignee` **уже есть** | `schema.prisma:1478-1519` | Фаза 4: **миграции БД НЕ нужно**, только заполнять поле |
| `TaskAssigneeResolverService.resolve(...)` готов и оттестирован | `task-assignee-resolver.service.ts:9-92` | Фаза 4: переиспользовать as-is, не переписывать |
| `TranscriptTrack` уже несёт `participantId`+`livekitIdentity` | `schema.prisma:1291-1308`, `transcribe.worker.ts:519-538` | Фаза 0: identity спикера есть в БД, теряется только на merge — дешёвый фикс |
| Pre-seed приглашённых с `userId` **уже существует** (трекер) | `issue-meetings.service.ts:110-138` | Фаза 2: переиспользовать паттерн `participant.createMany` |
| Готовый `ParticipantPicker` (имя+почта, мультивыбор) + `org-members/search` | `ParticipantPicker.tsx:46-78`, `org-members.service.ts:36-124` | Фаза 2: backend отдаёт email, фронт его роняет в `toValueFromSearch` — встроить + не ронять |
| `MailService.sendPlain` + Handlebars-шаблоны + `ConversationalService.sendNotification` готовы | `mail.service.ts:159-281`, `conversational.service.ts:180-384` | Фаза 3: доставка — это новый шаблон + новый `eventType`, не новый движок |
| `meeting-report-fast` энкьюится из **MergeWorker**, НЕ из `analyze.worker` | `merge.worker.ts:283-315` | Фаза 4: точка интеграции в самом fast-воркере, флаг `MEETING_REPORT_FAST_ENABLED` |
| `participant-context.service.ts:64` обнуляет `userId` для не-host | verbatim ниже | Фаза 0: одна строка-источник всей проблемы адресации для приглашённых |

⚠️ **path:line дрейфует** — у каждого якоря дан уникальный символ/текст. **Перед правкой re-Read файл и найди символ**, не доверяй номеру строки вслепую (оркестратор это верифицирует).

---

## Принятые решения владельца (не пересматривать)
| # | Решение | Обоснование (Почему) | Дата |
|---|---|---|---|
| Р1 | Приглашённый = **расширенный `Participant`** (`personId` + поля приглашения), НЕ отдельная `MeetingInvitation` | Переиспользуем существующий pre-seed-паттерн (`issue-meetings.service.ts`), минимум новой поверхности; `Participant` и есть «кто в/ожидается на встрече». `feedback_fix_the_whole_class` | 2026-06-04 |
| Р2 | Атрибуция `role:'subject'` — **детерминированно** по известной identity (speaker→participant→Person.entityId; `payload.userId`→User→Person), **НЕ через LLM** | identity известна структурно (`payload.participants[]` уже несёт `userId`, `TranscriptTrack` несёт `participantId`); LLM-разметка ненадёжна **и ломает prompt-cache** (правка SYSTEM-схемы = деньги). `feedback_llm_prompts_cache_friendly`, `feedback_verify_framework_behavior_empirically` | 2026-06-04 |
| Р3 | Приоритет: **Фаза 0 → (Фаза 1 ∥ Фаза 2) → (Фаза 3 ∥ Фаза 4)** | Фаза 0 — корень всего; клоны (Ф1) — «самое важное» по словам владельца; приглашение (Ф2) — дёшево и видимо; доставка/задачи следом | 2026-06-04 |
| Р4 | Автоингест корпоративных чатов — **вне scope** | Внешние блокеры (прокси, ФЗ-41, резолв внешнего автора); сначала оживить клонов на готовых источниках | 2026-06-04 |
| Р5 | Фаза 4: резолв assignee — **пост-фактум из `assigneeRaw`** через готовый `TaskAssigneeResolverService`, БЕЗ добавления `assigneeUserId` в LLM-схему fast-промпта | Сохраняет prompt-cache fast-воркера (как в Р2); резолвер уже умеет матчить по имени к participants | 2026-06-04 |
| Р6 | Фаза 5: единственная видимая задача из встречи = **tracker `Issue`**; внутренний `Task` сводится к служебному/legacy | Проект уже выбрал это направление: `TasksController` `@deprecated` → `/api/v1/issues`, есть `migrate-task-to-issue.ts` (Task→Issue, проект «Из встреч»). `Issue` несёт жизненный цикл (доска/состояния/назначения/overdue/webhooks) + `linkedMeetingIds`/`externalSource='meeting'`; `Task` — плоская запись | 2026-06-04 |

## Доказательство выбора (кратко)
Полная состязательная таблица — в анализе §5–6. Ключевое сведение проходов A (минимальная правка под текущий код) vs B (LLM-разметка автора / отдельная invite-модель):

| Критерий | A: детерминированно + расширить Participant | B: LLM-author + MeetingInvitation |
|---|---|---|
| Надёжность атрибуции | ✓ identity структурна | ✗ LLM путает «кто сказал» vs «о ком» |
| Prompt-cache | ✓ не трогаем SYSTEM | ✗ правка схемы ломает кэш |
| Объём кода | ✓ переиспуем pre-seed/picker | ✗ новая модель + новый поток |
| Учёт «приглашён, но не зашёл» | ⚠ через статус на Participant | ✓ чище в отдельной модели |
| Историч. backfill | ✓ из payload source-event | ✗ нужен ре-LLM всех блоков |
**Вывод:** A по 4/5 осям. Минус A (учёт статуса) закрываем полями `invitationStatus` на `Participant`.

---

## Scope
**Входит:** Фазы 0–4 ниже. **Не входит:** см. «Вне scope» выше.

### Граничные контракты с другими подсистемами
- **LiveKit** — только медиа; токены только на бэке (`livekit.service.ts:46-85`). Персональную identity протаскиваем своим JWT-токеном приглашения (как `signGuestSession`/deep-link), НЕ через секреты LiveKit гостю.
- **knowledge-core block-ingest** — НЕ менять LLM-промпт/JSON-схему (`block-ingest.prompt.ts:212-240`) и `ExtractedBlock`/Zod (`block-extraction.service.ts:49-191`). Атрибуция — отдельный детерминированный шаг в воркере (Р2).
- **tracker `IntakeIssue`** — не трогаем; Фаза 4 чинит только `Task`-путь.
- **Курация / DataClassPolicy** — атрибуция `subject` пишет внутренние рёбра графа; `dataClass` блоков не меняем.

### Границы автономии суб-агента (локально для этой фичи)
- ✅ Always: переиспользовать существующие сервисы/паттерны (pre-seed, picker, resolver, sendPlain); re-Read файла перед Edit; `bun run typecheck/lint/build` после каждой фазы.
- ⚠️ Ask first: любое изменение LLM-промптов (запрещено Р2/Р5 — значит НЕ делать); изменение FSM встречи; новый ENV вместо AdminSetting.
- 🚫 Never: `prisma migrate*` (только `prisma:push`); `new PrismaClient()` в скриптах (только `createPrismaClient()`); правка SYSTEM-промптов block-ingest/fast; `git push` без подтверждения владельца; английские слова в пользовательском UI.

---

## Зависимости и пересечения с МТЗ «Разблокировка конвейера» (параллельная сессия)

Параллельно на ветке `feature/pipeline-unblock` реализуется [`plans/tz/2026-06-04-razblokirovka-konveyera.md`](2026-06-04-razblokirovka-konveyera.md) — оно чинит, что **сам конвейер встреча→граф→специалисты вообще работает** (Ф1 транскрибация, Ф2 specialist-routing, Ф3 draft→canonical, Ф4 projection-rebuilder, Ф5 AGE/граф, Ф6 пороги, Ф7 мост ingestMeeting, Ф8 dataClassAudit, Ф9 владелец без Person, Ф10 free_note, Ф11 развязка записи от AI-статуса). Статус 2026-06-04: **Ф1–Ф4, Ф6, Ф10 закоммичены; Ф5/Ф7/Ф8/Ф9/Ф11 в работе.**

**Это ТЗ и МТЗ — две половины одной проблемы клонов:**
- МТЗ чинит **ТРУБУ** — без их Ф2/Ф3 reasoning-блок не доезжает до Specialist 3-7 даже при наличии `subject`.
- Это ТЗ чинит **ПОДПИСЬ** «чьё рассуждение» — без нашей Ф1 `router.hasEmployeeSubject` всегда `false`, и 3-7 не получает блок даже при рабочей трубе.
- **Клоны оживают только при ОБОИХ.** Наша Ф1 (`role:'subject'`) + их Ф2/Ф3 (доставка + canonical-диспатч) дополняют друг друга; ни одно не достаточно само по себе.

**Порядок:** это ТЗ стартует ПОСЛЕ закрытия МТЗ Ф1–Ф4 и Ф7 (труба жива — иначе наша атрибуция пишет `subject` в блоки, которых нет / которые не доезжают). Допустимо параллелить наши Ф0/Ф2 (identity-фундамент, приглашение) — они от трубы не зависят.

**Переиспользование (НЕ дублировать):**
- **МТЗ Ф9 даёт `PersonsService.ensurePersonForUser(tenantId, userId)`** (User→Person + Person владельца в `createForOwner` + backfill `backfill-owner-person.ts`). Наша Ф1.1 (`ensurePersonEntity`: Person→Entity) — **верхнее звено той же цепи**: полная привязка `User → Person (Ф9) → Entity (наша Ф1.1) → role:'subject' (наша Ф1.2)`. Если Ф9 закрыт — Ф1.1 ВЫЗЫВАЕТ `ensurePersonForUser`, затем `ensurePersonEntity`; НЕ строить параллельное создание Person.
- **МТЗ Ф10 (free_note)** уже даёт чистый `Segment.text` без JSON-обёртки — наша Ф1.2 (атрибуция текстовых каналов по `payload.userId`) строится поверх, не трогая сборку сегмента.
- **МТЗ Ф7** делает мост `ingestMeeting` видимым + reingest — предусловие, чтобы встречи доезжали до `block-ingest`, где наша Ф1.2 ставит `subject`.

**Координация общего git-дерева:**
- Обе правят `schema.prisma` (их Ф1 `TranscriptTrack @@unique`, Ф8 `dataClassAudit` в Insight/Decision; наша Ф0 — `Participant`) и `persons.service.ts` (их `ensurePersonForUser`, наш `ensurePersonEntity`). **Перед стартом — `git pull`/rebase; наши правки ДОБАВЛЯТЬ, не перезатирая их `@@unique`/`ensurePersonForUser`.**
- Их Ф11 (развязка записи от AI-статуса) и наша Ф0 — обе в meeting-модуле; сверить, что join/recording-логика не конфликтует.

---

# Фазы

## Граф зависимостей
```
Ф0 (identity-фундамент)
 ├─→ Ф1 (атрибуция subject — meeting-часть зависит от Ф0; text-часть независима)
 ├─→ Ф2 (приглашение из списка — pre-seed + единый join зависят от Ф0)
 │     └─→ Ф3 (доставка — нужны приглашённые из Ф2 + персональная ссылка из Ф0)
 └─→ Ф4 (голос→задача: assigneeUserId в активном Task-воркере; зависит от Ф0.2)
       └─→ Ф5 (единый путь голос→задача в трекере с identity; переиспует резолвер Ф4)
```
**Волны для оркестратора:** Волна 1 = Ф0. Волна 2 = Ф1 ∥ Ф2. Волна 3 = Ф3 ∥ Ф4 → Ф5 (после Ф4).

---

## Фаза 0 — Identity-фундамент участника
**Цель:** участник встречи может нести `personId`+`userId` с реальными FK; identity спикера доходит до `DialogTurn`; AI-контекст отдаёт identity всем зарегистрированным (не только host); единый join переиспользует pre-seeded запись.

### 0.1 — Prisma: `Participant.personId` + реальные FK + поля приглашения
Файл `backend/prisma/schema.prisma`, model `Participant` (символ `model Participant {`, ~1207-1229). Текущее:
```prisma
model Participant {
  id               String          @id @default(cuid())
  meetingId        String
  meeting          Meeting         @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  livekitIdentity  String
  name             String
  role             ParticipantRole
  isRegisteredUser Boolean         @default(false)
  userId           String?
  ...
}
```
Добавить (образец именованных relation — `EventParticipant` `schema.prisma:3250-3266`):
```prisma
  // Реальная FK на User (была голая строка). Имя relation уникально.
  user             User?           @relation("ParticipantUser", fields: [userId], references: [id], onDelete: SetNull)
  // Связь с узлом графа знаний (для атрибуции «чей голос/мысль»).
  personId         String?
  person           Person?         @relation("ParticipantPerson", fields: [personId], references: [id], onDelete: SetNull)
  // Приглашение (Р1): pre-seeded участник до входа.
  invitationStatus ParticipantInvitationStatus @default(none)
  /// Персональный токен приглашения (JWT-jti или nanoid); по нему join проставляет identity.
  inviteToken      String?         @unique
  invitedAt        DateTime?
```
Новый enum рядом с `enum ParticipantRole` (`schema.prisma:88`):
```prisma
enum ParticipantInvitationStatus {
  none      // обычный участник (host/гость, не приглашён заранее)
  invited   // приглашён, ещё не заходил
  joined    // приглашённый вошёл
}
```
Back-relation в `model User` (символ `model User {`) и `model Person` (символ `model Person {`): добавить массивы `participantsAsUser Participant[] @relation("ParticipantUser")` и `participantsAsPerson Participant[] @relation("ParticipantPerson")`.
После правки: `bun run prisma:push` + `bun run prisma:generate`.
**Acceptance 0.1:**
- `grep -n "ParticipantInvitationStatus" backend/prisma/schema.prisma` → enum + поле найдены.
- `grep -n 'relation("ParticipantPerson"' backend/prisma/schema.prisma` → 2 совпадения (Participant + Person back-relation).
- `bun run prisma:generate` без ошибок; `bun run typecheck` зелёный.
- **prod-deploy-log Шаг 4** обновлён (новые колонки `Participant.personId/inviteToken/invitationStatus/invitedAt` + enum).
**Закрывает:** R1, R2.

### 0.2 — Снять обнуление `userId` для не-host в AI-контексте
Файл `backend/src/modules/ai/services/participant-context.service.ts`, метод `loadForMeeting` (символ `const isHost = p.role === 'host';`), строка ~64. Текущее:
```ts
return {
  livekitIdentity: p.livekitIdentity,
  displayName: p.name,
  userId: isHost && p.userId ? p.userId : null,   // ← обнуляет для всех не-host
  fullName: user?.name ?? null,
  role: isHost ? 'host' : 'guest',
};
```
Заменить условие на **`isRegisteredUser && userId`** (а не `isHost`): зарегистрированный приглашённый сотрудник должен отдавать `userId`/`fullName`. Подгрузку `User` (`userIds`/`findMany`) расширить, чтобы `fullName` подтягивался не только для host. Тип `AiParticipantContext.role` оставить `'host'|'guest'` (используется в промптах), но `userId` отдавать по `isRegisteredUser`.
**Acceptance 0.2:**
- Мини-e2e (`bunx vitest run`): participant с `role='guest'`, `isRegisteredUser=true`, `userId='u1'` → `loadForMeeting` вернёт `userId='u1'` (а не null).
- Регресс: анонимный guest (`isRegisteredUser=false`, `userId=null`) → `userId=null`.
**Закрывает:** R2, R8.

### 0.3 — Протащить identity спикера сквозь merge до `DialogTurn`
Файлы и точки (verbatim-якоря):
- `backend/src/modules/ai/services/prompts/common.ts` (символ `export interface DialogTurn`): добавить опц. поля
  ```ts
  export interface DialogTurn {
    speaker: string;
    text: string;
    startSec: number;
    endSec: number;
    speakerParticipantId?: string | null;   // NEW
    speakerLivekitIdentity?: string | null;  // NEW
  }
  ```
- `backend/src/modules/ai/services/merger.ts` (символ `export interface PerTrackWords`): добавить `participantId?: string | null; livekitIdentity?: string | null;`. В `AbsoluteWord` (строки ~29-34) и в `allWords.push({ speaker: track.speakerName, ... })` пробросить эти поля. В сборке turn (символ `turns.push({`) — перенести `speakerParticipantId/speakerLivekitIdentity` из текущего спикера (группировку по смене спикера оставить по `speaker`).
- `backend/src/modules/ai/workers/merge.worker.ts` (символ `const perTrack: PerTrackWords[] = meeting.transcript.tracks.map`): добавить в возвращаемый объект `participantId: track.participantId, livekitIdentity: track.livekitIdentity` (поля у `TranscriptTrack` уже есть). Финальный `dialog` материализуется в `Transcript.turns` + S3 (символ `turns: dialog`) — новые поля попадут автоматически.
- `backend/src/modules/ingest/adapters/meeting.adapter.ts` (символ `turns: merged.turns`) — `turns` берутся из `Transcript.turns`, новые поля доедут в payload без правок (проверить тип `MergedTranscript.turns`).
**Acceptance 0.3:**
- Мини-e2e merger: вход `PerTrackWords` с `participantId='p1'` → выход `DialogTurn[0].speakerParticipantId='p1'`.
- `bun run build` зелёный (типы DialogTurn консистентны во всех потребителях).
**Закрывает:** R3.

### 0.4 — Единый join: переиспользовать pre-seeded `Participant`
Файл `backend/src/modules/participants/participants.service.ts`. Проблема (verbatim `joinAsGuest`, символ `const livekitIdentity = \`guest:${guestId}\``): при входе зарегистрированного приглашённого создаётся новый `guest:<nanoid>`, а pre-seeded `guest:<userId>`/`inviteToken` остаётся висеть.
Контракт: ввести резолв входа по identity ДО `joinAsGuest`:
1. Если в запросе есть `inviteToken` (из персональной ссылки) → найти `Participant` по `inviteToken`, проставить `joinedAt`, `invitationStatus='joined'`, вернуть его identity (НЕ создавать нового).
2. Если залогинен и есть pre-seeded `Participant` по `userId` в этой встрече → переиспользовать его.
3. Иначе — текущая ветка анонимного гостя.
`JoinMeetingApiRequest` (DTO + `join-meeting.dto.ts`) расширить опц. `inviteToken?: string`.
**Acceptance 0.4:**
- Мини-e2e: pre-seed `Participant{inviteToken:'t1', userId:'u1', invitationStatus:'invited'}` → join с `inviteToken='t1'` НЕ создаёт второго participant, ставит `joinedAt`/`joined`, identity совпадает с pre-seeded.
- Регресс: join без токена и без pre-seed → анонимный guest как раньше.
**Закрывает:** R1, R4.

---

## Фаза 1 — Атрибуция `role:'subject'` (оживление клонов) — КЛАСС-ФИКС
**Цель:** для блоков-рассуждений автор детерминированно помечается `IdeaBlockEntity.role='subject'` → клоны/WHO-ось/дашборд-агенты получают данные. **Без правки LLM-промптов** (Р2).

### 1.1 — Усилить `Person.entityId` (двойная точка отказа)
Файл `backend/src/modules/knowledge-core/services/entity-resolution.service.ts`.
1. `linkPersonEntity` (символ `async linkPersonEntity(args: {`, ~765-804) — баг: `findFirst Entity{type:person}` **без фильтра по имени**. Исправить: фильтровать кандидатов по `canonicalName` на стороне БД (или findMany + match по `normalizeName`), как сделано в `linkEntityPerson`.
2. **Проактивное создание person-Entity при инвайте сотрудника.** В `persons.service.ts` (метод создания Person, символ `prisma.person.create` в транзакции) — после создания Person для `relationship='employee'` вызвать `entityResolution.ensurePersonEntity(personId)` (новый тонкий метод: `findOrCreateEntity{type:'person', name}` + проставить `Person.entityId`). Это снимает зависимость «ждать упоминания имени в блоке». **Цепочка с МТЗ Ф9:** полная привязка = `User → Person` (МТЗ `ensurePersonForUser`) → `Person → Entity` (этот метод). Если МТЗ Ф9 закрыт — вызывать `ensurePersonForUser` ПЕРЕД `ensurePersonEntity` и НЕ дублировать создание Person (см. раздел «Зависимости и пересечения с МТЗ»).
**Acceptance 1.1:**
- Мини-e2e: создать 2 Person с разными именами + 2 Entity{person}; `linkPersonEntity` линкует КАЖДОГО к своему (не к первому попавшемуся).
- Мини-e2e: создать employee-Person → `Person.entityId != null` сразу (без блоков).
**Закрывает:** R5.

### 1.2 — Детерминированная запись `subject` в block-ingest
Файл `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts`.
Контекст: `linkEntity` (символ `private async linkEntity(args: {`, ~851-886) хардкодит `role:'mentioned'`. Воркер имеет `event` (→ `event.payload` с `participants[]`/`userId`) и итерирует сегменты (у сегмента есть `speakers`/, после Ф0 — `speakerParticipantId`).
Контракт — новый шаг атрибуции (НЕ трогая LLM):
1. Новый helper в `EntityResolutionService`: `resolveSubjectEntityId(tenantId, { speakerParticipantId?, speakerName?, authorUserId?, participants? }): Promise<string | null>` (возвращает **Entity.id** type=person):
   - meeting: `speakerParticipantId` → `participants[].userId` → `Person{userId}` → `Person.entityId`; fallback `speakerName` → match `participants[].displayName` → `userId` → entityId; fallback `resolvePersonByHint(speakerName)` → `Person.id` → `Person.entityId`.
   - text (free_note/in_app): `authorUserId` (`payload.userId`) → `Person{userId}` → `Person.entityId`.
2. В воркере при персисте блока с `signalType ∈ {reasoning, rationale, decision_basis, expertise, experience, competence}` — после `linkEntity`-цикла вызвать `resolveSubjectEntityId` (источник: сегмент блока для meeting; `event.payload.userId` для text) и **upsert** связь:
   ```ts
   await this.prisma.ideaBlockEntity.upsert({
     where: { blockId_entityId: { blockId, entityId: subjectEntityId } },
     create: { blockId, entityId: subjectEntityId, mentionContext: 'author', role: 'subject' },
     update: { role: 'subject' },  // апгрейд mentioned→subject если уже была связь
   });
   ```
   (PK `@@id([blockId, entityId])` — поэтому upsert по композитному ключу; решает коллизию «имя автора уже как mentioned».)
3. **Kill-switch (AdminSetting, не ENV — `feedback_admin_settings_not_env_or_code`):** ключ `knowledgeCore.subjectAttributionEnabled` через `TypedConfigService.getDynamic`, code-fallback `true`. При `false` — шаг пропускается (на случай регресса).
**Acceptance 1.2:**
- Мини-e2e meeting: блок `signalType='reasoning'` из сегмента со `speakerParticipantId=p1` (participant `userId=u1`, Person `entityId=e1`) → создан `IdeaBlockEntity{blockId, entityId:e1, role:'subject'}`.
- Мини-e2e text: free_note payload `{userId:u1}`, Person(u1).entityId=e1, блок reasoning → `role:'subject'` на e1.
- Идемпотентность: повторный прогон upsert = no-op (role остаётся subject).
- **LLM-промпт block-ingest НЕ изменён** (`git diff` по `block-ingest.prompt.ts`/`block-extraction.service.ts` пуст). Раздел «Совместимость с prompt caching»: SYSTEM не тронут → кэш сохранён.
**Закрывает:** R6 (корень), R9.

### 1.3 — Backfill `mentioned→subject` + ре-rebuild клонов
Новый `backend/scripts/backfill-subject-attribution.ts` (образец `backfill-knowledge-clone-after-router-fix.ts`; `createPrismaClient()` из `_lib/prisma`, импорты из `../src`).
Логика: для каждого `IdeaBlock{status:'canonical', signalType ∈ reasoning-семейство}` → найти source-`RawEvent` через `IdeaBlockEvidence` → определить автора (meeting: по turns/participants payload; text: `payload.userId`) → `resolveSubjectEntityId` → upsert `role:'subject'`. Затем ре-enqueue `core.skill-profile-rebuild` для затронутых Person.
**Идемпотентность (acceptance-критерий):** повторный прогон = no-op (upsert + dedup ре-enqueue по personId). Зарегистрировать в `apply-prod-deploy.ts` `STEPS` (`phase` backfill, `skipBootstrap:true`).
**Acceptance 1.3:**
- `bun run scripts/backfill-subject-attribution.ts --dry-run` печатает counts без записи.
- Повторный прогон не плодит дублей (count `role='subject'` стабилен).
- **prod-deploy-log Шаг 8** + регистрация в `STEPS`.
**Закрывает:** R6 (исторические данные).

### 1.4 — Досев демо-данных
Файл `backend/src/modules/onboarding/demo-data/knowledge-graph.ts` (символ `ideaBlock.create`). Сейчас демо не создаёт `IdeaBlockEntity` вовсе (авторство — тег `author:<key>`). Добавить: для reasoning-блоков создавать `IdeaBlockEntity{role:'subject', entityId: <entity автора>}` (резолв author-Person → entityId; при необходимости создать person-Entity). Иначе демо клонов навсегда пустое (`safe-seed-rules`: не ломать admin-edited; демо-данные идемпотентны).
**Acceptance 1.4:**
- После сидинга демо: `SELECT count(*) FROM "IdeaBlockEntity" WHERE role='subject'` > 0.
- Клон демо-сотрудника на reasoning-данных возвращает не `starved_profile` (мини-проверка `loadSubjectReasoningBlocks` непустой).
**Закрывает:** R6 (демо).

### 1.5 — Верификация класс-фикса (каждая ветка-следствие отдельно)
Мини-e2e/grep на каждого потребителя `role:'subject'` (после 1.2 на тестовых данных):
- `specialist-3-7-skill.service.ts:375-408` `loadSubjectReasoningBlocks` → непустой.
- `router.service.ts:631-649` `hasEmployeeSubject` → `true` для employee-subject-блока → reasoning роутится в 3-7.
- `axis-classifier.service.ts` (WHO-ось, символ `role: 'subject'`) → отдаёт автора.
- дашборд-агенты (`promise-network-analyzer.cron`, `goal-vector-tracker.cron`, `knowledge-velocity-tracker.cron`) — smoke: запрос по subject не пуст.
- clone-respond (`clones.service.ts loadPersonSubgraph`) → reasoningBlocks непуст → ответ клона не `refused`.
**Acceptance 1.5:** перечисленные мини-проверки зелёные; список веток приложен в коммит-описании.
**Закрывает:** R6 (полнота класса).

---

## Фаза 2 — Приглашение сотрудников из списка (UI + DTO + pre-seed)
**Цель:** при создании встречи хост выбирает сотрудников из списка (имя+почта), они пред-создаются как identity-привязанные `Participant`.

### 2.1 — Backend: расширить DTO + pre-seed
- `backend/src/modules/meetings/dto/create-meeting.dto.ts` (символ `CreateMeetingForUserSchema`): добавить
  ```ts
  invitees: z.array(z.object({
    userId: z.string().nullish(),
    personId: z.string().nullish(),
    email: z.string().email().nullish(),
    sendVia: z.array(z.enum(['email', 'telegram'])).default([]),
  })).max(50).optional().default([]),
  ```
- `backend/src/modules/meetings/meetings.service.ts` (`createForUser`, после host-`participant.create` ~260): pre-seed приглашённых по паттерну `issue-meetings.service.ts:110-138`, но с identity-привязкой Р1: для каждого invitee с `userId`/`personId` создать `Participant{ role:'guest', isRegisteredUser:true, userId, personId, invitationStatus:'invited', inviteToken: <nanoid/JWT> }`. `livekitIdentity` для приглашённого — НЕ `guest:<userId>` (перегружен), а `invitee:<participantId>` или по `inviteToken` (см. 2.2 единый join из Ф0.4).
- Резолв `personId`↔`userId`: type='user' → `userId`; type='person' с `userId` → оба; type='person' без `userId` → только `personId` (доставка только email).
**Acceptance 2.1:**
- Мини-e2e: `createForUser` с `invitees:[{userId:'u1', sendVia:['email']}]` → создан `Participant{userId:'u1', invitationStatus:'invited', inviteToken!=null}`.
- `bun run typecheck`/Swagger smoke: DTO `invitees` в схеме эндпоинта.
**Закрывает:** R10, R1.

### 2.2 — Frontend: встроить пикер + не ронять email
- `frontend/src/ui/shared/ParticipantPicker.tsx` (символ `export type ParticipantPickerValue`): расширить value полем `email?: string` и каналами `sendVia?: ('email'|'telegram')[]`; в `toValueFromSearch` (символ `function toValueFromSearch`) **пробросить `item.email`** (backend уже отдаёт — `org-members.service.ts`).
- `frontend/src/ui/components/create-meeting-form/CreateMeetingFormV2.tsx` (символ `const result = await meetingsApi.create`): добавить в step-2 блок «Пригласить сотрудников» с `<ParticipantPicker>` + чекбоксы канала на чипе; пробросить `invitees` в `meetingsApi.create`.
- `frontend/src/api/meetings.api.ts` (символ `export type CreateMeetingApiRequest`): добавить `invitees?`.
- UI — только русский (`feedback_admin_ui_russian_only`); парные токены `bg-*`+`text-*-fg` (`feedback_paired_color_tokens`); без `text-white`/hex/slate.
**Acceptance 2.2:**
- `grep -n "ParticipantPicker" frontend/src/ui/components/create-meeting-form/CreateMeetingFormV2.tsx` → найден (встроен).
- `grep -n "item.email" frontend/src/ui/shared/ParticipantPicker.tsx` → email пробрасывается.
- `bun run typecheck`/`bun run lint`/`bun run build` (frontend) зелёные.
- Нет английских слов в добавленном UI (ручной review-маркер).
**Закрывает:** R10.

---

## Фаза 3 — Доставка приглашения (email + Telegram + персональная ссылка)
**Цель:** приглашённому уходит ссылка на встречу по выбранному каналу; переход проставляет identity.

### 3.1 — Персональная join-ссылка
- В `meetings.service.ts` при pre-seed (2.1) ссылка вида `/m/:id?inv=<inviteToken>`. Фронт `m/[id]` читает `inv`, кладёт в `meetingsApi.join({ inviteToken })` (Ф0.4). На входе `Participant.userId/personId` уже проставлены → диаризация/резолвер видят сотрудника.
**Acceptance 3.1:** мини-e2e join по `?inv=` ставит `joinedAt`/`joined`, не плодит participant (повтор Ф0.4 на интеграционном уровне).
**Закрывает:** R1, R3 (для приглашённых).

### 3.2 — Email-приглашение на встречу
- `backend/src/modules/mail/mail.templates.ts` (символ `export const INVITE_WITH_CREDENTIALS_TEMPLATE`): добавить `export const MEETING_INVITE_TEMPLATE = \`...{{hostName}}...{{meetingTitle}}...{{joinUrl}}...{{telegramDeepLink}}\`` (plain-text, `{{var}}`, без HTML).
- `backend/src/modules/mail/mail.service.ts` (символ `async sendInviteWithCredentials`): добавить `sendMeetingInvite(input)` по образцу; зарегистрировать шаблон в `CompiledTemplates`+`loadTemplates`. Шаблон также завести в `STATIC_TEMPLATES` (`email-templates-admin.service.ts`) → авто-появление в админ-редакторе (`admin-content`).
- В `meetings.service.ts` для invitee с `sendVia.includes('email')` (или внешний email без `userId`) → `mail.sendMeetingInvite` напрямую (внешних `sendNotification` не умеет — `conversational.service.ts:48-80`).
**Acceptance 3.2:**
- Мини-e2e (MAIL_DRY_RUN): `sendMeetingInvite` рендерит шаблон с `joinUrl`, не падает.
- `grep -n "MEETING_INVITE_TEMPLATE" backend/src/modules/mail/mail.templates.ts` → найден.
- **prod-deploy-log Шаг 7** (bootstrap-sync шаблона) при необходимости.
**Закрывает:** R11.

### 3.3 — Telegram-приглашение на встречу
- `backend/src/modules/conversational/conversational.service.ts` (символ `const EVENT_TYPE_CHANNEL_POLICY`): добавить ключ
  `'meeting.invite': ['telegram_bot', 'email_smtp', 'in_app']`.
- `backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts` (символ `private renderText(notification: Notification)`): добавить `case 'meeting.invite'` с человекочитаемым шаблоном (название встречи, кто пригласил, ссылка `joinUrl` с `inv`-токеном); `escapeHtml`, `.slice(0,4000)`.
- В `meetings.service.ts` для invitee с `sendVia.includes('telegram')` и существующим `userId` → `conversational.sendNotification({ recipientUserId: userId, eventType:'meeting.invite', payload:{ joinUrl, meetingTitle, hostName }, preferredChannelKinds:['telegram_bot','email_smtp','in_app'] })`. **Каскад:** нет verified telegram-binding → доедет email_smtp/in_app (встроено в `sendNotification`). Метрика `meeting_invite_no_telegram_binding` (Prometheus, `prom-client`).
- ⚠️ НЕ использовать `destinations/senders/telegram-bot.sender.ts` (другой механизм, не привязан к userId).
**Acceptance 3.3:**
- `grep -n "'meeting.invite'" backend/src/modules/conversational/conversational.service.ts` + `case 'meeting.invite'` в адаптере → найдены.
- Мини-e2e: `sendNotification(eventType:'meeting.invite')` рендерит ссылку, не падает в default-ветке.
**Закрывает:** R3 (Telegram-доставка), R11.

---

## Фаза 4 — Цепочка голос→задача для всех (assigneeUserId в активном воркере)
**Цель:** активный `meeting-report-fast` ставит `assigneeUserId` для всех зарегистрированных участников (после Ф0.2 — включая приглашённых), **без правки LLM-промпта** (Р5).

Файл `backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts`.
- Constructor (символ `private async writeTasks`/конструктор ~80-87): добавить DI `ParticipantContextService` + `TaskAssigneeResolverService` (образец `meeting-analyze-v2.worker.ts:75-79`; проверить регистрацию в `workers.module.ts`).
- `process()` (рядом с `extractTurns`/`formatTranscript`): загрузить `participants = await this.participantContext.loadForMeeting(meetingId)` и пробросить в `writeTasks`.
- `writeTasks` (символ `private async writeTasks(args: {`): резолвить пост-фактум (образец `meeting-analyze-v2.worker.ts:326-376`):
  ```ts
  const resolved = this.assigneeResolver.resolve(
    args.tasks.map((t) => ({ assigneeRaw: t.assigneeRaw ?? null, assigneeUserId: null })),
    args.participants, args.tenantId,
  );
  // в цикле: r = resolved[idx];
  // в task.create.data: assigneeUserId: r?.assigneeUserId ?? null,
  //                     assigneeRaw:   r?.assigneeRaw ?? task.assigneeRaw ?? null,
  ```
- **НЕ менять** `meeting-report-fast.prompt.ts` (Zod/JSON-схема, Р5) — `assigneeUserId` НЕ из LLM. `Task.assigneeUserId` уже в схеме (миграции нет).
**Acceptance 4:**
- Мини-e2e: `writeTasks` с `assigneeRaw='Настя'` и participant `{userId:'u-nastya', displayName:'Настя', isRegisteredUser:true}` → `Task.assigneeUserId='u-nastya'`.
- Регресс: имя не совпало / тёзки → `assigneeUserId=null`, задача создаётся.
- `git diff` по `meeting-report-fast.prompt.ts` пуст (prompt-cache сохранён).
- `bun run typecheck`/`build` зелёные; `workers.module.ts` содержит оба провайдера.
**Закрывает:** R7.

---

## Фаза 5 — Единый путь «голос → задача в трекере» с identity-привязкой
**Цель:** из встречи рождается ОДНА видимая задача — в трекере (`Issue`), привязанная к исполнителю **по identity участников встречи** (а не по тексту-имени по всему тенанту). Внутренний `Task` сводится к служебному/legacy (решение Р6).

**REALITY-CHECK (картография 2026-06-04):** одна встреча сейчас порождает ДВА несвязанных артефакта без общего дедупа: (а) `Task` (`meeting-report-fast.worker` → таб «Задачи» карточки встречи `MeetingResultPageReal` + страница `/tasks`); (б) `Issue` (`analyze.worker` шаг 14 → `meeting-extract-actions` → `IntakeIssue` → `intake-auto-triage` ≥0.92 → `Issue` в проекте «Из встреч»). Связи `Task↔Issue` в схеме НЕТ (ни `issueId`, ни `taskId`). Tracker-путь резолвит исполнителя **substring `Person.name` по всему тенанту** (`meeting-extract-actions.service.ts:356-393` + дубль `intake-auto-triage.worker.ts:534-556`), участников встречи не грузит; докблок: «vNext: подключить полноценный AssigneeResolverService». `TasksController` уже `@deprecated`; существует `backend/scripts/migrate-task-to-issue.ts`. `Issue` хранит исполнителей через M:M `IssueAssignee` (не скаляр).

### 5.1 — Identity-резолвер в tracker-пути (must; закрывает TODO в коде, низкий риск)
- `backend/src/modules/tracker/services/meeting-extract-actions.service.ts` (символ `async extract(args:`, ~74-78): расширить вход/догрузить участников `participantContext.loadForMeeting(meetingId)` (после Ф0 — с identity и для приглашённых). Заменить `resolveAssigneeId` (substring по всему тенанту, ~356-393) на резолв через **общий `TaskAssigneeResolverService.resolve(...)`** (тот же сервис, что в Ф4) — матч имени/`userId` ТОЛЬКО среди участников встречи.
- `backend/src/modules/tracker/workers/intake-auto-triage.worker.ts` (символ `function resolveAssigneeUserId`, ~534-556): использовать уже резолвнутый `suggestedAssigneeId` либо тот же резолвер против участников; убрать дубль substring-логики.
- Эффект: «Настя, подготовь Х» → `IntakeIssue.suggestedAssigneeId = userId Насти` по identity; тёзки/гости-не-сотрудники → null (без ложного назначения), как в резолвере.
**Acceptance 5.1:**
- `grep -n "loadForMeeting\|TaskAssigneeResolver" backend/src/modules/tracker/services/meeting-extract-actions.service.ts` → резолв через участников встречи (substring-only убран или оставлен лишь как явный fallback).
- Мини-e2e: транскрипт «Настя, …», участник Настя c `userId` → `suggestedAssigneeId = userId Насти`, а не первый Person по substring; участник не из встречи с тем же именем НЕ выбирается.
- `bun run typecheck`/`build`/затронутые `vitest` зелёные.
**Закрывает:** R12.

### 5.2 — Единая видимая задача (дедуп + репойнт потребителей на `Issue`)
Источник правды для action-items встречи = **`Issue`**. 
- Прекратить создавать ПОЛЬЗОВАТЕЛЬСКУЮ `Task` для action-items встречи: gate `writeTasks` в `meeting-report-fast.worker` за AdminSetting `meetingTasksToTrackerOnly` (поэтапная раскатка; code-fallback оставляет текущее поведение до включения). (Резюме отчёта-саммари не трогаем — речь только про action-items.)
- **Репойнт 6 потребителей `Task` → `Issue` по `linkedMeetingId`** (иначе деградируют молча — список из картографии):
  1. таб «Задачи» карточки встречи — `frontend/src/hooks/use-meeting-tasks.ts` + `MeetingResultPageReal.tsx` → читать Issue по `linkedMeetingId` (вместо `/meetings/:id/tasks`);
  2. экспорт markdown/zip — `exports.worker.ts:139`, `bulk-zip.generator.ts:84`;
  3. AI-чат контекст — `chat.service.ts:104`;
  4. полнотекстовый поиск — `search.service.ts:248`;
  5. **Public API** `GET /meetings/:id/tasks` — `public-api/meetings.public.controller.ts:100` (СОХРАНИТЬ форму ответа — отдавать из Issue, не ломать внешний контракт);
  6. admin — `meetings-admin.controller.ts:293`.
- Происхождение: `Issue.linkedMeetingIds` + `externalSource='meeting'` уже есть — доп. поле не нужно.
**Acceptance 5.2:**
- Из одной встречи — ОДИН видимый артефакт (Issue): при `meetingTasksToTrackerOnly=true` meeting-`Task` (action-items) не создаётся; таб встречи читает Issue.
- 6 потребителей репойнтнуты; `GET /meetings/:id/tasks` сохраняет форму ответа (контракт-тест).
- `bun run typecheck`/`build`/`test` зелёные.
**Закрывает:** R12.

**⚠️ Blast radius / порядок:** 5.2 — самая широкая правка ТЗ (6 потребителей + публичный API-контракт). **5.1 поставляет identity-ценность независимо** и обязательна; **5.2 — консолидация, отдельной под-волной** с тщательным репойнтом и контракт-тестом Public API.
**Связь с Фазой 4:** Ф4 — недорогой interim-фикс «правильный исполнитель в текущей видимой `Task`» (пока 5.2 не репойнтнул карточку на Issue), и её резолвер переиспользуется в 5.1. После 5.2 заполнение `Task.assigneeUserId` для встреч становится необязательным (Task — служебный). Если 5.2 делается сразу — Ф4 можно свернуть до «общий резолвер вынесен в shared-сервис для 5.1».

---

## Требования (трассировка)
- **R1** Приглашённый сотрудник создаётся как identity-привязанный `Participant` (`userId`/`personId`/статус/токен). — Ф0.1, Ф0.4, Ф2.1, Ф3.1
- **R2** AI-контекст отдаёт `userId` всем зарегистрированным участникам, не только host. — Ф0.2
- **R3** Identity спикера доходит до `DialogTurn`; приглашённый входит под своей identity. — Ф0.3, Ф3.1, Ф3.3
- **R4** Единый join переиспользует pre-seeded запись, не плодит дубли. — Ф0.4
- **R5** `Person.entityId` надёжно заполняется (проактивно + без бага findFirst). — Ф1.1
- **R6** Блоки-рассуждения получают `IdeaBlockEntity.role='subject'` (новые + backfill + демо + все ветки-потребители). — Ф1.2–1.5
- **R7** Активный fast-воркер ставит `assigneeUserId`. — Ф4
- **R8** Зарегистрированный приглашённый резолвится как assignee. — Ф0.2 + Ф4
- **R9** Атрибуция управляется AdminSetting kill-switch. — Ф1.2
- **R10** Форма создания встречи позволяет выбрать сотрудников из списка (имя+почта). — Ф2.1–2.2
- **R11** Приглашение доставляется по email и/или Telegram. — Ф3.2–3.3
- **R12** Из встречи рождается одна видимая задача — `Issue` в трекере, привязанная к исполнителю по identity участников. — Ф5.1–5.2

---

## Совместимость с prompt caching
**Критично для стоимости.** Ни одна фаза НЕ меняет SYSTEM-промпты/JSON-схемы LLM:
- Ф1 — атрибуция детерминированная, `block-ingest.prompt.ts`/`block-extraction` не тронуты (Р2; acceptance 1.2 проверяет пустой diff).
- Ф4 — резолв пост-фактум, `meeting-report-fast.prompt.ts` не тронут (Р5; acceptance 4 проверяет пустой diff).
- Email-шаблоны (Ф3) — не LLM, кэш не релевантен.
→ Prompt cache DeepSeek/OpenAI-proxy сохранён на 100%.

## Pre-mortem / Риски + ревью-аспекты (для strict-production-review-gate)
- **Двойные Participant** при миграции на единый join — проверить, что Ф0.4 покрывает host-ветку (owner идёт в `joinAsHost`, приглашённый-невладелец — по `inviteToken`). Ревью: нет ли пути, создающего второй participant на одного человека.
- **`livekitIdentity` коллизии** — `invitee:<participantId>` уникален; `@@unique([meetingId, livekitIdentity])` соблюдён.
- **entityId=null** обнуляет атрибуцию — Ф1.1 обязателен ПЕРЕД массовым backfill (1.3).
- **upsert role downgrade** — апгрейд `mentioned→subject` односторонний; не должно быть обратного `subject→mentioned` (ревью update-ветки).
- **tenant-границы** — все новые запросы (resolveSubjectEntityId, search) требуют `tenantId`; `@@index([tenantId, …])`.
- **Доставка внешним** — `sendNotification` не умеет внешних (нет `recipientUserId`); внешний email только через `sendPlain` (ревью: не уронить на Person без User).
- **AdminSetting kill-switch** — при `subjectAttributionEnabled=false` backfill/новые блоки не пишут subject (документировать в prod-инструкции).

## Idempotency / feature-flag / prod-deploy
- **Feature-flag/kill-switch:** `knowledgeCore.subjectAttributionEnabled` (AdminSetting, code-fallback `true`). Email/Telegram-доставка — без флага (новый eventType аддитивен).
- **Идемпотентность:** backfill (1.3) и демо-сид (1.4) — повторный прогон no-op (upsert + dedup). Зарегистрировать backfill в `apply-prod-deploy.ts` `STEPS`.
- **prod-deploy-log:** Шаг 4 (колонки Participant + enum) · Шаг 8 (backfill-subject-attribution) · Шаг 7 (демо-сид + meeting-invite шаблон bootstrap) · Шаг 1 (AdminSetting `subjectAttributionEnabled` — если как ENV-fallback) · Шаг 12 (smoke: новый эндпоинт invitees / eventType meeting.invite).

## DoD (общий чек-лист)
- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` зелёные (backend и frontend).
- `bunx vitest run` по затронутым файлам зелёный; добавлены мини-e2e из Acceptance.
- second-brain обновлён по таблице производных заметок: `02_architecture/data-model.md` (Participant.personId, DialogTurn speaker-identity), `02_architecture/knowledge-core.md` (механизм subject-атрибуции), `02_architecture/code-pitfalls.md` (3 ловушки: «role всегда mentioned», «userId обнулялся для не-host», «два движка email»), `01_projects/ai-jobs.md` (fast-воркер + assignee), `01_projects/recording.md`/`meeting-types.md` при необходимости.
- `docs/operations/prod-deploy-log.md` обновлён (Шаги 4/7/8/12 + AdminSetting).
- Строки в `second-brain/04_не-сделано/README.md` (role:'subject' и identity встречи) — перенести в «Закрытые (архив)» после реализации.
- Рефлексия в `second-brain/05_история/`.

## Итог (заполнит оркестратор)
- [x] Ф0 · [x] Ф1 · [x] Ф2 · [x] Ф3 · [x] Ф4 · [x] Ф5 — **реализовано целиком** (dev, 2026-06-05).
  - Коммиты: Ф0 `158a33d8`, Ф1 `b4ac1ebd`, Ф2 `b2fde6c9`, Ф3 `b5a07ebe`, Ф4 `d0609a90`, Ф5.1 `779b4811`, Ф5.2 (см. лог), контракт+Ф5 `0e3b2208`, docs.
  - Верификация: backend+frontend typecheck/lint/build зелёные; затронутые модули 417 тестов зелёные; prompt-cache цел.
  - Осталось (прод, локальной БД в сессии не было): `prisma:push` Ф0; прогон `backfill-subject-attribution.ts`; боевая проверка ветки `meetingTasksToTrackerOnly=ON` перед включением флага. См. `docs/operations/prod-deploy-log.md` и рефлексию `second-brain/05_история/2026-06-05-meeting-identity-and-clones-attribution-realizacia.md`.
