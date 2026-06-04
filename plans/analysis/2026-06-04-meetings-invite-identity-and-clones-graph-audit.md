---
title: "Аудит: приглашения на встречу, идентификация участников и связь клонов с графом"
date: 2026-06-04
type: analysis
status: draft
audience: владелец продукта + разработчики
source: 2 параллельных аудит-воркфлоу (24 субагента, ~3.07M токенов, каждое gap-утверждение состязательно верифицировано по коду)
---

# Аудит: приглашения, идентификация участников и связь клонов с графом

> **Как собрано.** Два независимых fan-out аудита по реальному коду (`backend/`, `frontend/`, git-история): (1) приглашения/identity встреч — 8 направлений; (2) клоны↔граф + источники — 4 направления. Каждый заявленный пробел перепроверен вторым независимым агентом-скептиком (verdict: confirmed / partial / refuted) с привязкой `file:line`. Ложных «этого нет» не выявлено. Документ read-only — код не менялся.

---

## 0. Один абзац (TL;DR)

Система **узнаёт человека на пороге, но выбрасывает эту идентичность до того, как знание попадёт в граф**. На встрече гость заходит по общей ссылке как аноним (`Participant.userId=null`, поля `personId` вообще нет); в текстовых каналах `userId` автора доходит до события, но `block-ingest` его не читает. Из-за этого: (а) приглашения сотрудников из списка в форме встречи нет (есть только «скопировать ссылку»); (б) «Настя, твоя задача» долетает до трекера только если Настя — владелец встречи; (в) **главная ценность продукта — клоны сотрудников — фактически пустая**, потому что ни один путь записи не проставляет в графе метку «чьё это рассуждение» (`IdeaBlockEntity.role='subject'` не пишется **нигде** — всегда `'mentioned'`). При этом 80% нужных кирпичей уже построены и лежат рядом (готовый пикер сотрудников, поиск по почте, рассылка email, таргет-доставка в Telegram, привязка Telegram к userId). Работа — **дособрать из готового и протянуть identity сквозь pipeline**, а не строить с нуля.

---

## 1. Главный вывод: единый корень — «identity теряется на пороге»

Все запросы владельца упираются в одну сквозную проблему — **атрибуция «чьё это»**. Она рвётся в трёх точках одного конвейера:

```
[кто в комнате / кто пишет]  ──X1──>  [Participant / RawEvent]  ──X2──>  [граф знаний]  ──X3──>  [клон / задача / дашборд]
   identity известна на входе       но не фиксируется как личность      и не доходит как «subject»     поэтому downstream пуст/анонимен
```

- **X1 — на входе встречи:** `Participant` не имеет `personId`, а `userId` без FK-связи и **намеренно обнуляется для всех, кроме хоста** (`backend/src/modules/ai/services/participant-context.service.ts:64`). Гость по ссылке = аноним по самоназванному имени.
- **X2 — на стадии графа:** единственный продюсер связки «блок ↔ сущность» (`backend/src/modules/knowledge-core/workers/block-ingest.worker.ts:866`) **жёстко пишет `role:'mentioned'`** для всех. Значение `role:'subject'` («это сказал/рассуждал вот этот человек») не пишет **ни одна строка кода** во всём backend — только читается ~10 потребителями.
- **X3 — на выходе:** клоны (`SkillProfile → SkillTrait → ExecutablePersona`), WHO-ось классификатора, маршрутизация reasoning-блоков, дашборд-агенты — **все** фильтруют по `role:'subject'` и получают пустую выборку.

> **Простыми словами.** Кора умеет записать встречу и разобрать её на «мысли», но не привязывает мысль к человеку, который её произнёс. Поэтому «второй мозг» помнит *что* было сказано, но не помнит *кто это знает* — а именно второе и есть клон сотрудника.

Это **класс-баг, а не точечный** (по правилу «чини весь класс»): один незаписанный `role:'subject'` обнуляет клонов, навыки, WHO-ось, часть дашборда и адресацию. Чинить нужно корень + все ветки-следствия с отдельной верификацией каждой.

---

## 2. Запросы владельца → краткий вердикт

### Сессия 1 (встречи)
| # | Запрос | Вердикт по коду |
|---|---|---|
| 1 | Вернуть приглашение сотрудников + фиксировать, что приглашённые — наши сотрудники | **Этого в форме встречи не было никогда** (git подтвердил: ни V1, ни V2). Владелец, вероятно, помнит **календарный** `ParticipantPicker` (он жив, но на экране «Событие»). «Вернуть» = собрать из готовых деталей. |
| 2 | Выпадающий список сотрудников с фильтром по почте + галочка «кому отправить» + email | Backend-поиск по имени/почте (`org-members/search`) и UI-пикер с почтой — **готовы**, но не подключены к встрече. Email-рассылка приглашения **на встречу** — нет (есть рассылка приглашения в *компанию*). |
| 3 | Ссылка в Telegram + индивидуальная привязка → диаризация знает «чей голос» → голосом дал задачу → задача в трекере / идея у сотрудника → клон знает чей голос | Таргет-доставка в Telegram конкретному сотруднику и привязка `chatId↔userId` — **готовы**. Но: модуль meetings к доставке **не подключён вовсе**; цепочка «голос→задача» работает **только для хоста**; «чей голос» на уровне конкретного сотрудника — **не реализовано** (теряется при merge). |

### Сессия 2 (клоны и источники)
| # | Запрос | Вердикт по коду |
|---|---|---|
| 4 | Связь клонов с графом — «почему-то нету, хотя это самое важное» | **Подтверждено жёстко.** Связь спроектирована и читается корректно, но **фактически пустая**: `role:'subject'` не пишется нигде → клоны строятся из пустого множества. |
| 5 | Откуда забираем знания и знаем ли «чьё это» | Карта источников ниже (§4.7). Короткий ответ: identity автора **известна на входе почти везде, но не доходит до графа ни по одному источнику**. |
| 6 | Сотрудники подключают свой Telegram, или система сама с чатов забирает? | **Личная привязка — рабочая модель** (сотрудник линкует свой Telegram, его личные сообщения боту → граф). **Автоингест корпоративного чата — нет как продукта** (есть узкий per-Source бот без привязки автора, к тому же заблокирован прокси в проде; «Кора-Чат»/мост чужого мессенджера — пока анализ). |

---

## 3. Карта «готово / сломано / нет» (что переиспользуем)

| Кирпич | Статус | Где |
|---|---|---|
| Поиск сотрудников Org по имени **и почте** (User+Person, dedup) | ✅ готов | `backend/src/modules/org-members/services/org-members.service.ts:36-82` |
| UI-пикер: мультивыбор, фильтр, **имя+почта** в строке, чипы, quick-create | ✅ готов (но только в календаре) | `frontend/src/ui/shared/ParticipantPicker.tsx:91-388` |
| Предсоздание приглашённых `Participant` **с `userId`** | ✅ есть прецедент (трекер) | `backend/src/modules/tracker/services/issue-meetings.service.ts:121-138` |
| Рассылка email (nodemailer+SMTP, dry-run, шаблоны в БД, редактор в админке) | ✅ готов | `backend/src/modules/mail/mail.service.ts:163` (`sendPlain`) |
| Таргет-доставка сотруднику в Telegram по `userId` | ✅ готов, обкатан в проде | `ConversationalService.sendNotification` + `ChannelBinding` |
| Привязка `chatId↔userId` (deep-link/код) | ✅ готов | `backend/src/modules/conversational/link-code.service.ts:40-119` |
| Per-track ASR (отдельная дорожка на участника, identity дорожки есть) | ✅ есть, но identity теряется на merge | `transcribe.worker.ts:350-362` → `merger.ts:67` |
| Жёсткий резолвер исполнителя задачи → `userId` | ⚠️ реализован, но висит на `@deprecated`-ветке | `task-assignee-resolver.service.ts` (зовётся только из `meeting-analyze-v2`) |
| `Participant.personId` / FK на User | ❌ нет | `schema.prisma:1207-1229` |
| Приглашение на встречу из списка (DTO/модель/REST/UI) | ❌ нет | — |
| Email/Telegram-приглашение **на встречу** | ❌ нет (есть только в *компанию*) | — |
| `IdeaBlockEntity.role='subject'` (атрибуция автора блока) | ❌ **не пишется нигде** | `block-ingest.worker.ts:866` (всегда `mentioned`) |
| `speaker → Person` маппинг | ❌ нет | теряется в `merger.ts`/`segment-builder.ts` |
| Автоингест корпоративных чатов с привязкой автора | ❌ нет (план) | research `2026-06-03-internal-messenger-anti-ban-research.md` |

---

## 4. Детальный разбор по областям (с доказательствами)

### 4.1 Приглашение на встречу (запросы 1–2)
- Создание встречи принимает только `type/title/custom_prompt/card_id/record_by_default` — поля приглашённых нет (`create-meeting.dto.ts:29-37`). `createForUser` заводит **одного** `Participant` (хоста) — `meetings.service.ts:201-284`. Финал UI — модалка «скопируйте ссылку» (`CreateMeetingFormV2.tsx:438-441`).
- **Git-археология:** пикера приглашённых в форме встречи **не было никогда** (`git log -S` по invitee/inviteEmails/ParticipantPicker в `create-meeting-form` пуст; старая V1-форма `e067b325` имела только выбор типа). То, что помнит владелец, — **календарный** `EventForm`+`ParticipantPicker` (Calendar MVP, коммит `5c4c6c18`) и/или org-инвайт `InviteEmployeeDialog`. Оба живы, но не на экране «Создать встречу».
- `OrgInvitation` — про вступление **в компанию** (`schema.prisma:2575`), не подходит для встречи. `EventParticipant` (`schema.prisma:3245-3264`) — правильный образец модели приглашённого (`userId?`+`personId?`), но к LiveKit-встрече не подключён (`createForCalendarEvent` создаёт только хоста).

### 4.2 Идентификация участника (`Participant ↔ User ↔ Person`)
- `Participant.userId` — просто строка без `@relation`; `personId` отсутствует (`schema.prisma:1207-1229`). Связь голос↔сотрудник графа невозможна на уровне данных.
- Гость создаётся `guest:<nanoid>`, `userId=null` (`participants.service.ts:197-207`). Даже трекер-прецедент, который пред-создаёт `guest:<userId>` с `userId`, **не переиспользуется** при реальном входе — `joinAsGuest` плодит новую анонимную запись (двойные `Participant` на одного человека).
- `participant-context.service.ts:64` отдаёт `userId` в AI-контекст **только для хоста** (`isHost && p.userId ? p.userId : null`) — это вторая точка обрыва: даже если `userId` есть в БД, для AI он обнуляется.
- LiveKit-токен несёт только `identity+name`, без `userId/personId` в метаданных (`livekit.service.ts:62-85`) — конвенция `host:`/`guest:` завязана в 3 местах (grant, join, webhook); новый тип `invitee:<personId>` потребует синхронной правки всех трёх (класс-фикс).

### 4.3 Доставка: email + Telegram
- **Email готов как механизм**, но нет шаблона «приглашение на встречу» (все 6 шаблонов — про онбординг в компанию; нет переменных `meetingTitle/joinUrl/hostName`). Модуль meetings к почте **не подключён** (0 ссылок на `MailService`). ⚠️ Нюанс: conversational-email-адаптер и админ-редактируемые `EmailTemplate` — **два разных движка письма**; conversational-email доставляет только привязанным пользователям (нужен verified binding), внешних адресатов не умеет — поэтому org-инвайты шлются прямым `MailService` мимо conversational.
- **Telegram готов как канал.** Целевой путь — `sendNotification({recipientUserId, eventType:'meeting.invite', preferredChannelKinds:['telegram_bot','email_smtp','in_app']})`. Нужны: новый `eventType 'meeting.invite'` в `EVENT_TYPE_CHANNEL_POLICY` (`conversational.service.ts:83`) + ветка рендера в `telegram-bot.adapter.ts` + payload-схема. ⚠️ Не путать с `destinations/senders/telegram-bot.sender.ts` — это **другой** механизм (бот в произвольный chat_id), не привязан к сотруднику Org.
- ⚠️ Telegram-доставка работает **только для уже привязавших** Telegram. Нужен каскад: нет telegram-binding → email → просто ссылка; в письмо зашивать deep-link привязки бота.

### 4.4 Диаризация → «чей голос»
- Это **не** диаризация общего микса, а **per-track ASR**: одна дорожка = один участник, `speaker = participantName` (снимок имени). Identity дорожки (`participantId`, `livekitIdentity`) **есть** в `TranscriptTrack` (`schema.prisma:1295-1297`), но **отбрасывается на merge** — в `DialogTurn` попадает только строка-имя (`merger.ts:67`). Это удешевляет фикс: данные есть, нужно лишь не терять их.
- Привязки `speaker → Person` нет **нигде**. `AudioTrack` не несёт `userId/personId`. Голосового отпечатка (speaker embedding) нет — «чей голос» = «чья дорожка» (риск при общем ноутбуке/госте рядом — vNext-страховка).

### 4.5 Цепочка «голосом дал задачу» → трекер
- **Неприятный сюрприз:** активный боевой воркер `meeting-report-fast` пишет задачу со строкой `assigneeRaw` **без `assigneeUserId`** (participants в промпт не передаются). Жёсткая идентификация исполнителя реализована, но подключена только к `@deprecated meeting-analyze-v2`. Т.е. по основному пути «голос→задача конкретному человеку» сейчас **не работает даже для хоста**.
- Два несвязанных пути: knowledge-core `Task` (умеет `assigneeUserId`) и tracker `Issue` (через `IntakeIssue`, auto-accept при confidence ≥ 0.92) живут отдельно; `Task` не превращается в `Issue`. Адресат в трекер-пути резолвится **substring по имени** (`Person.name contains firstToken`), в knowledge-core — **exact-name**; оба не используют identity. Тёзки → null/ambiguous; гость без `userId` → никогда.
- Идеи (Specialist 3.6) привязываются к автору только через упомянутых в тексте subject-Person, а не по говорящему; для `client_request` владелец-сотрудник не выставляется.

### 4.6 Клоны знаний ↔ граф — **КРИТИЧНО** (ответ на «почему-то нету»)
Связь спроектирована сквозной: и сборка клона (`specialist-3-7-skill`), и ответ клона (`clones.service loadPersonSubgraph`), и роутинг reasoning-блока берут строки через один фильтр:

```
Person.entityId → IdeaBlockEntity{role:'subject'} → IdeaBlock{signalType ∈ reasoning|rationale|decision_basis, status:'canonical'}
```

**Два независимых отказа делают её пустой:**
1. **`role:'subject'` не пишется НИГДЕ.** Во всём backend ровно 4 записи `IdeaBlockEntity` (1 create + 3 update); единственный create (`block-ingest.worker.ts:866-872`) хардкодит `role:'mentioned'`; три update двигают только `entityId/blockId`. DB-дефолт поля = `mentioned`. `git pickaxe` подтверждает: `subject`-запись **никогда** не существовала. LLM-схема извлечения (`block-ingest.prompt.ts:212-240`) вообще **не имеет** поля «кто автор/субъект» — модель физически не может это пометить.
2. **`Person.entityId` хрупкий.** Линковка только по **точному** нормализованному имени (`entity-resolution.service.ts:791`, fuzzy/cosine — TODO); прямой `linkPersonEntity` — мёртвый код без вызовов и баговый (`findFirst` без фильтра по имени); проактивного создания person-Entity при инвайте сотрудника нет. Тёзки/«Настя↔Анастасия»/отчества → `entityId=null` → клон пуст даже при исправленном `subject`.

**Следствие:** `router.hasEmployeeSubject` почти всегда `false` → reasoning не доходит до `3-7-skill` → `SkillTrait` не создаются → у клона <3 черт → `askPerson` отдаёт `no_clone/starved_profile`. **Демо это маскирует:** demo-данные не создают `IdeaBlockEntity` вовсе (авторство — текстовый тег `author:<key>`), поэтому любая приёмка клонов на демо ложно-зелёная.

> **Важно для доклада:** есть **два разных «клона»** с разными контрактами роли:
> - **Knowledge Clone** (`Person.knowledgeProfile`, Specialist 3.2) читает `role IN (subject, mentioned)` → частично жив на `mentioned`.
> - **Ролевой клон / ExecutablePersona** («Клон Маркетолога», Specialist 3.7) читает **строго `subject`** → **полностью пуст**.

Затронуты не только клоны: `role:'subject'` читают и дашборд-агенты (`promise-network-analyzer`, `goal-vector-tracker`, `knowledge-velocity-tracker`), operations (`promise-keeper`, `commitments`), `card-rollup-v2`, `axis-classifier`, `temporal-probe`. Один корень бьёт по всему Слою 3.

### 4.7 Полная карта источников (откуда забираем) + identity по каждому
| Источник | В графе? | Identity автора на входе | Доходит до графа как `subject`? |
|---|---|---|---|
| Встречи (meeting-adapter) | ✅ | `participants[].userId/participantId` + `turns[].speaker` в payload | ❌ теряется (speaker→participant связки нет; merge роняет identity) |
| Личный Telegram-бот (free_note/голос/документы) | ✅ | ✅ достоверный `userId` через `ChannelBinding` | ❌ `block-ingest` не читает `payload.userId` |
| In-app free-note | ✅ | ✅ `userId` в payload | ❌ так же игнорируется |
| Документы (document-ingest) | ✅ | загрузивший известен | ❌ не атрибутируется как subject |
| Трекер (Issue-события) | ✅ | `authorUserId` события | ❌ не превращается в `subject` |
| Корпоративный Telegram (per-Source `type=bot`) | ⚠️ узко | только `fromUserId` (внешний tg-id, **не наш** Person) | ❌ + заблокирован прокси в проде |
| Телефония (phone_call, Mango) | ❌ не в графе | — | — |
| Кора-Чат / мост чужого мессенджера | ❌ план | — | — |

**Вывод по §5-запросу:** identity почти везде известна на входе, но **ни один источник не материализует автора в графе**. На встречах теряется больше всего (нет даже `userId` в тексте), на текстовых — `userId` есть в событии, но `block-ingest` его не использует.

### 4.8 Telegram/чаты: личная привязка vs автоингест (ответ на запрос 6)
- **Рабочая модель — личная привязка.** Сотрудник линкует **свой** Telegram (`/me/channels` код или deep-link приглашения) → verified `ChannelBinding(userId↔from.id)`. Бот при каждом сообщении: `from.id → binding → userId → Membership → tenantId`; незалинкованных отшивает. Его личные заметки/голос/документы → `free_note` с `userId` → граф. Бот **только в личке 1-на-1**.
- **Автоингеста корпоративного чата как продукта нет.** Per-Source бот (`ingest/adapters/telegram`) может читать чат, в который добавлен, но: (а) автор = сырой внешний `fromUserId`, в Person **не резолвится**; (б) в проде через прокси `telegram.crossmark.ru` per-source `setWebhook` **отвергается** (только заранее зарегистрированные боты). «Кора-Чат» и мост чужого мессенджера — **только анализ** (`2026-06-03-internal-messenger-anti-ban-research.md`, draft), кода нет; блокеры — прокси, резолв автора, ФЗ-41.

---

## 5. Предложения (фазами, от корня к UI)

Порядок намеренно «снизу вверх»: сначала чиним identity и оживляем клонов (это и есть главная ценность), потом надстраиваем приглашение/доставку. Приглашение из списка — самое заметное, но самое дешёвое (кирпичи готовы); клоны — самое ценное и сейчас сломаны.

### Фаза 0 — Фундамент identity участника (разблокирует всё остальное)
1. `Participant.personId String?` + `@relation` на `Person`; превратить `userId` в полноценную `@relation` на `User` (зеркало `EventParticipant`). *(новая колонка → Prisma `db push` + `prod-deploy-log` Шаг 4)*
2. Снять обнуление `userId` для не-host в `participant-context.service.ts:64` — отдавать `userId/personId` всем `isRegisteredUser`-участникам.
3. Единый join: при входе по персональной ссылке/токену искать pre-seeded `Participant` по `userId`, а не плодить `guest:<nanoid>`.
4. Протащить identity сквозь диаризацию: добавить `speakerUserId/speakerPersonId` (или `speakerParticipantId`) в `DialogTurn` и заполнять в `merger.ts` из `TranscriptTrack.participantId` — данные уже есть, просто не теряем.

### Фаза 1 — Оживить клонов (САМОЕ ВАЖНОЕ; класс-фикс `role:'subject'`)
1. **Детерминированно** проставлять `IdeaBlockEntity.role='subject'` для автора reasoning-блока (`signalType ∈ reasoning|rationale|decision_basis|expertise|experience|competence`): для встреч — `speaker → participant → Person.entityId` (после Фазы 0); для текстовых каналов — `payload.userId → User → Person.entityId`. **Не через LLM** — identity известна структурно (надёжнее + не ломает prompt-кэш).
2. Усилить `Person↔Entity`: fuzzy/cosine + strong-id (email) по образцу других типов; **проактивно** создавать person-Entity при инвайте сотрудника (а не ждать упоминания имени).
3. Backfill `mentioned→subject` для существующих employee-Person в reasoning-блоках + ре-enqueue rebuild клонов (есть образец `backfill-knowledge-clone-after-router-fix.ts`).
4. Досеять демо-данные `IdeaBlockEntity{role:'subject'}` — иначе демо клонов навсегда пустое.
5. Верифицировать **каждую** ветку-следствие отдельным мини-e2e (3-7-skill, clone-respond, axis WHO, router, дашборд-агенты) — это класс-фикс.

### Фаза 2 — Приглашение сотрудников из списка (запросы 1–2)
1. Подключить готовый `ParticipantPicker` в `CreateMeetingFormV2` (шаг 2, блок «Пригласить сотрудников»); источник — `org-members/search` (имя+почта уже есть). Расширить `ParticipantPickerValue` полями `email` + `sendVia:('email'|'telegram')[]` + чекбоксы на чипе.
2. Расширить `CreateMeetingForUserSchema` полем `invitees: {userId?|personId?, email?, sendVia[]}[]`; пред-создавать `Participant` с `userId/personId` (паттерн трекера) + статус приглашения + персональный токен.
3. REST `POST /meetings/:id/invitees` (для приглашения уже в идущую встречу).
4. Маркировка «наш сотрудник»: выбор из `org-members` (`relationship=employee`) = identity-привязанный; ручной email = внешний гость без `personId`.

### Фаза 3 — Доставка приглашения (email + Telegram, запрос 3)
1. Шаблон `meeting-invite` (константа + `STATIC_TEMPLATES` → авто-появление в админ-редакторе) + `MailService.sendMeetingInvite` с персональной join-ссылкой.
2. `eventType 'meeting.invite'` в conversational + рендер в `telegram-bot.adapter` → таргет-доставка по `ChannelBinding`. Каскад: telegram → email → ссылка. Метрика «не доставлено в Telegram — нет привязки».
3. **Персональная join-ссылка** с подписанным токеном (`personId/userId + meetingId`): переход проставляет `Participant.userId/personId` без ручного ввода имени — это и замыкает «подключился именно конкретный сотрудник» и кормит диаризацию.

### Фаза 4 — Цепочка «голос → задача/идея» для всех (не только хоста)
1. Перенести `TaskAssigneeResolverService` + participants в активный `meeting-report-fast.worker` (добавить `assigneeUserId` в схему/промпт) — закрывает главный пробос минимальной правкой.
2. Использовать identity **говорящего** (из Фазы 0) для адресации, а не только совпадение имени; различать «Настя дала задачу» vs «Насте дали задачу».
3. Связать пути: единый `AssigneeResolver` для `Task` и `IntakeIssue` (в трекере уже стоит TODO «подключить полноценный резолвер»).

### Вне ближайшего scope (отдельный трек)
- Автоингест корпоративных чатов («система сама с чатов») — Кора-Чат / мост чужого мессенджера. Блокеры: прокси per-source webhook, резолв автора→Person, ФЗ-41. Сначала довести личную привязку + meeting-identity (это уже оживляет клонов на имеющихся источниках).
- Speaker embedding (голосовой отпечаток) — страховка для «несколько голосов на одной дорожке».

---

## 6. Решения, нужные от владельца (с моей рекомендацией)

1. **Модель приглашённого:** ⟶ **рекомендую расширить `Participant`** (`personId` + поля приглашения: статус, персональный токен), а не плодить отдельную `MeetingInvitation`. Почему: трекер уже пред-создаёт `Participant` с `userId` — переиспользуем паттерн, минимум новой поверхности, `Participant` и есть «кто в/ожидается на встрече». (Альтернатива — отдельная лёгкая `MeetingInvitation` для чистого учёта «приглашён, но не зашёл» — приемлема, но дороже по коду.)
2. **Атрибуция автора (`role:'subject'`):** ⟶ **рекомендую детерминированно** по известной identity (speaker/userId), **не** через LLM. Почему: identity уже известна структурно; LLM-разметка ненадёжна и ломает prompt-кэш (деньги).
3. **Приоритет:** ⟶ **рекомендую Фаза 0 + Фаза 1 первыми** (identity + оживление клонов — это «самое важное» по словам владельца и корень всего), и **параллельно** Фаза 2 (приглашение из списка — дёшево, кирпичи готовы, видимая ценность). Фазы 3–4 следом.
4. **Автоингест чатов:** ⟶ **рекомендую отложить** до закрытия личной привязки/meeting-identity (отдельный трек с внешними блокерами).

---

## 7. Что зафиксировать в second-brain (по итогам аудита)
- Добавлены строки в `second-brain/04_не-сделано/README.md` («Открыто»): (а) `role:'subject'` не производится → клоны пустые; (б) identity участника встречи теряется (нет `personId`, обнуление `userId`).
- При реализации обновить: `02_architecture/data-model.md` (Participant.personId, DialogTurn speaker-identity), `02_architecture/knowledge-core.md` (механизм `subject`-атрибуции), `01_projects/ai-jobs.md` (meeting-report-fast + assignee), `02_architecture/code-pitfalls.md` (ловушка «role всегда mentioned», «userId обнуляется для не-host», «два движка email»).

---

### Приложение: ключевые `file:line` (быстрая навигация)
- Создание встречи без приглашённых: `backend/src/modules/meetings/dto/create-meeting.dto.ts:29-37`, `meetings.service.ts:201-284`
- Обнуление userId для не-host: `backend/src/modules/ai/services/participant-context.service.ts:64`
- Гость-аноним: `backend/src/modules/participants/participants.service.ts:197-207`
- Потеря identity при merge: `backend/src/modules/ai/services/merger.ts:67`
- **`role:'mentioned'` хардкод (корень клонов):** `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts:866-872`
- Хрупкий Person↔Entity: `backend/src/modules/knowledge-core/services/entity-resolution.service.ts:765-851`
- Активный воркер без assignee: `backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts:462-478`
- Готовый пикер/поиск: `frontend/src/ui/shared/ParticipantPicker.tsx`, `backend/src/modules/org-members/services/org-members.service.ts:36-82`
- Таргет-доставка: `backend/src/modules/conversational/conversational.service.ts:180-283`, `link-code.service.ts:40-119`
