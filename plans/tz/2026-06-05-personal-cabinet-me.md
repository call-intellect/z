---
type: tz
status: ready-to-implement
feature: personal-cabinet-me
date: 2026-06-05
owner: Сергей (владелец продукта)
relates_to:
  - plans/analysis/2026-06-05-dashboards-improvements-reality-check-and-tz-map.md
  - plans/analysis/2026-06-05-dashboards-prostym-yazykom.md
  - plans/tz/2026-06-05-employee-pulse-and-people-at-risk.md
---

> Анализ-карта: plans/analysis/2026-06-05-dashboards-improvements-reality-check-and-tz-map.md (секция «ТЗ-E») · Решения владельца: 2026-06-05

# ТЗ-E — Личный кабинет «Я» (единый раздел с вкладками)

## Цель

Свести пять отдельных пунктов сайдбара (`/me/pulse`, `/me/contributions`, `/me/social-contribution`, `/me/promises` + сводная `/me`) в один личный кабинет «Я» с вкладками. Сделать так, чтобы сотрудник на своих страницах видел тон «про меня», а не «про подчинённого»: убрать с личного «Пульса» служебные блоки руководителя (резюме для HR, ревью зарплаты, «поговорить срочно»). Починить «Обещания»: показать источник (на какой встрече сказано), подсветить просрочку, дать «Перенести срок» вместо безвозвратного «Не сделано». Заменить фейковый тумблер приватности на «Вкладе в команду» на реальный опт-аут. Снять вечный «0» в счётчике «Фидбек». Удалить мёртвую `/me/dashboard`.

## Зачем (болезненное состояние по факту)

- **Четыре близких пункта `/me/*` подряд = паралич выбора.** В сайдбаре `Sidebar.tsx:282-286` четыре пункта «Мой пульс / Мой вклад / Мой вклад в команду / Мои обещания» — два из них называются «Мой вклад…» и не различимы.
- **Личный «Пульс» — дословно карточка начальника.** `MyPulseClient.tsx:49` рендерит `PersonPulseClient` 1-в-1, сотрудник видит «Pulse · карточка сотрудника», «AI-резюме для HR», «Ревью ЗП», «Поговорить срочно», «Вопросы AI этому человеку», ссылки «Открыть полный профиль» / «Назад к карточке» в начальственный раздел `/persons/:id`.
- **Обещания без источника, без подсветки просрочки, без переноса срока.** `MyPromisesClient.tsx` — 5 колонок + 3 кнопки (на телефоне не влезает), нет столбца «Откуда», просроченные не выделены, кнопка «Не сделано» вызывает `mark(status:'missed')` — закрывает обещание навсегда.
- **Фейковый тумблер приватности.** `MySocialContributionClient.tsx:94-102` — `handleToggleOptOut` только пишет в локальный `useState` и показывает toast «поставлен в очередь»; ничего не сохраняется на бэке.
- **Счётчик «Фидбек» всегда 0.** `helpfulness.ts:252` — `constructive_feedback: 0` захардкожен в маппере, потому что в DTO нет отдельного поля.
- **Мёртвая `/me/dashboard`.** `MyDashboardClient.tsx` — Phase 2 каркас с заглушками «появится в Sprint 3/4», нигде не используется как точка входа.

## REALITY-CHECK

| Факт | Доказательство (path:line + символ) | Влияние на фазы |
|---|---|---|
| 4 пункта `/me/*` в `ME_GROUP` + сводный `/me` | `Sidebar.tsx:273` (`href: '/me'`), `:282` (`'/me/pulse'`), `:283` (`'/me/contributions'`), `:284` (`'/me/social-contribution'`), `:286` (`'/me/promises'`) | Ф1 — оставить один пункт «Я» |
| `MyPulseClient` рендерит `PersonPulseClient` без режима | `MyPulseClient.tsx:49` — `<PersonPulseClient personId={personId} />` | Ф2 — добавить проп `mode` |
| HR-резюме / Ревью ЗП / Поговорить срочно — внутри `PersonPulseClient` | `PersonPulseClient.tsx:428` `HrResumeSection`, `:531` `compensation_review`/«Ревью ЗП», `:553` `urgent_talk`/«Поговорить срочно», `:159` `HeaderBlock` («Pulse · карточка сотрудника», «Открыть полный профиль»), `:230` `BackLink` («Назад к карточке») | Ф2 — скрывать при self |
| HR-suggestions приходят с бэка всегда | `person-pulse.service.ts:182` `parseHrSuggestions`, `:201` `hrSuggestions` в DTO | Ф2 — при self не отдавать (defense-in-depth) |
| `getPulse` не знает, кто смотрит | `person-pulse.service.ts:116` `async getPulse({tenantId, personId})` — нет флага self | Ф2 — добавить `forSelf` |
| `/me/promises` без источника/просрочки/переноса, не адаптивна | `MyPromisesClient.tsx:119-171` (таблица 5 колонок), `:136` `formatDate(c.dueDate)` без подсветки, `:150-157` кнопка «Не сделано» → `mark('missed')` | Ф3 |
| `CommitmentDto` без полей источника | `commitments.dto.ts:64-79` — нет `sourceMeetingId`/`sourceMeetingTitle` | Ф3 |
| Источник обещания выводим через evidence→rawEvent (sourceType='meeting' → sourceExternalId = meetingId) | `schema.prisma:3083` `IdeaBlockEvidence` (`rawEventId`, `sourceType`), `RawEvent` `:2901` (`sourceExternalId`), `block-ingest.worker.ts:557` `event.sourceType === 'meeting' ? event.sourceExternalId : null` | Ф3 — без db push, derive на лету |
| `mark` принимает только терминальные статусы | `commitments.dto.ts:31` `MarkPromiseBodySchema` (`fulfilled`/`missed`/`cancelled`/`superseded`) | Ф3 — НЕ расширять mark, отдельный reschedule |
| Фейковый opt-out тумблер | `MySocialContributionClient.tsx:94-102` `handleToggleOptOut` (только local state), `:466` `<Switch>` | Ф4 |
| Готовый паттерн opt-out (Redis) для переиспользования | `recognition-preference.service.ts:31` `get`, `:56` `set`, ключ `recognition:pref:` | Ф4 |
| «Фидбек» = 0 захардкожен | `helpfulness.ts:252` `constructive_feedback: 0` | Ф4 |
| Мёртвая `/me/dashboard` | `MyDashboardClient.tsx:13` `MyDashboardClient`, заглушки «появятся в Sprint 3/4/5» | Ф5 |
| Координация: `PersonPulseClient` правят ТЗ-G (manager) и ТЗ-E (self) | анализ-карта строка 35 («ТЗ-G раньше ТЗ-E») | граничный контракт ниже |

## Принятые решения владельца

| # | Решение | Обоснование | Дата |
|---|---|---|---|
| Р3 | Объединить 5 страниц `/me/*` в кабинет «Я» с вкладками + редиректы старых URL | Четыре близких пункта = паралич выбора; «Мой вклад» дважды не различить | 2026-06-05 |
| E-1 (локальное) | Self-режим Pulse — проп `mode:'self'` в `PersonPulseClient`, бэк при `forSelf=true` не отдаёт `hrSuggestions` | Одна страница не может одинаково говорить «про него» (начальнику) и «про меня» (человеку); HR-резюме/ЗП/срочно — это контроль, а не помощь | 2026-06-05 |
| E-2 (локальное) | Источник обещания выводить из `evidence` БЕЗ новой колонки (derive на лету) | Привязка через `RawEvent.sourceExternalId` уже есть; новая колонка не нужна, не пересекаемся со схемными ТЗ B/D/F | 2026-06-05 |
| E-3 (локальное) | «Перенести срок» — отдельный эндпоинт `PATCH /:blockId/reschedule`, статус остаётся `open` | Расширять `mark` нельзя — он только для терминальных статусов; перенос не должен закрывать обещание | 2026-06-05 |
| E-4 (локальное) | Opt-out социального вклада — Redis-preference по образцу `recognition-preference.service` (не AdminSetting) | Это персональная настройка пользователя, а не tenant-крутилка super_admin; AdminSetting тут не применим | 2026-06-05 |
| E-5 (локальное) | «Фидбек» — протянуть `constructive_feedback` из бэка (отдельное поле счётчика в DTO) | Скрытие нулевого счётчика прячет реальные данные; данные есть в traits, нужно лишь агрегировать | 2026-06-05 |

## Доказательство выбора (развилки)

- **Источник обещания: новая колонка vs derive.** Колонку `sourceMeetingId` на `IdeaBlock` отвергаем: (а) пересекаемся с тремя схемными ТЗ (B/D/F) и нарушаем порядок «последовательно, каждый re-Read схемы»; (б) связь уже выводима из `IdeaBlockEvidence → RawEvent` (`sourceType='meeting'` → `sourceExternalId` = meetingId), что подтверждено `block-ingest.worker.ts:557`. Derive дешевле и без миграции. Принято E-2.
- **«Фидбек»: скрыть vs протянуть.** Скрытие нулевого счётчика — обман (данные есть в `recentTraits` типа `constructive_feedback`). Протягиваем реальное число из бэка. Принято E-5.
- **Opt-out: AdminSetting vs Redis-preference.** AdminSetting — для tenant-крутилок super_admin (прайсы/пороги/флаги). Здесь — персональный выбор сотрудника; канон в проекте уже есть (`recognition-preference.service`). Принято E-4.

## Scope

### Входит
- Ф1 — единый кабинет «Я» с вкладками (Обзор / Пульс / Вклад / Помощь коллегам / Обещания) + редиректы `/me/pulse`, `/me/contributions`, `/me/social-contribution`, `/me/promises` на соответствующие вкладки; один пункт «Я» в сайдбаре.
- Ф2 — self-режим `PersonPulseClient` (`mode:'self'`): скрыть HR-резюме / Ревью ЗП / Поговорить срочно / «Вопросы AI этому человеку» / ссылки в `/persons/:id`; тон от первого лица; бэк при `forSelf=true` не отдаёт `hrSuggestions`.
- Ф3 — обещания: поля источника (`sourceMeetingId`/`sourceMeetingTitle`) в `CommitmentDto` + API + колонка «Откуда» (derive из evidence), подсветка просрочки, эндпоинт «Перенести срок» (`PATCH /:blockId/reschedule`), мобильная (card-stack) раскладка.
- Ф4 — backend opt-out социального вклада (реальный эндпоинт + флаг, замена фейкового `Switch`) + «Фидбек» (протянуть `constructive_feedback`).
- Ф5 — удалить `/me/dashboard` + редирект на `/me`.

### Не входит (out of scope)
- Manager-улучшения `PersonPulseClient` (вход в «Пульс» с карточки человека, «Сотрудники под риском», pulseScore-сервис, фокус «чем помочь», Р2-приватность) — **ТЗ-G** `plans/tz/2026-06-05-employee-pulse-and-people-at-risk.md`.
- Привязка обещаний к автору (`commitmentAuthorPersonId`) и недельный план-факт по людям — **ТЗ-D** `plans/tz/2026-06-05-weekly-per-person-plan-fact.md` (Р4).
- Постановка цели голосом, ответственный за цель — **ТЗ-F** `plans/tz/2026-06-05-goals-improvements.md`.
- Голосовой ВЫВОД где-либо (только текст; см. feedback `concierge_text_only_output`) — не вводим.
- Полноценный личный дашборд «что важно сегодня» (упоминания/спотлайты/чек-ин-нудж) — vNext, отдельное ТЗ; пока вкладка «Обзор» = текущий `MeClient`.

## Граничные контракты с другими ТЗ

- **`PersonPulseClient.tsx` правят и ТЗ-G, и ТЗ-E.** Порядок: **ТЗ-G раньше ТЗ-E** (анализ-карта строка 35). К моменту старта ТЗ-E файл может содержать manager-правки G. **ТЗ-E НЕ трогает** manager-логику G (вход в Пульс с карточки, pulseScore, people-at-risk, фокус «чем помочь»). ТЗ-E добавляет ТОЛЬКО проп `mode?: 'self' | 'manager'` (default `'manager'`) и условный рендер по нему. Перед правкой — re-Read файла; если ТЗ-G уже ввёл свой проп/режим — согласовать сигнатуру (предпочесть единый проп `mode`), не плодить второй флаг.
- **`getPulse` (бэк) правят ТЗ-G (Р2-приватность, pulseScore) и ТЗ-E (forSelf).** ТЗ-E добавляет ТОЛЬКО опц. параметр `forSelf?: boolean` и поведение «при self не отдаём hrSuggestions». НЕ трогать Р2-логику настроения/чек-инов (это G: owner/admin видят всегда, hr_partner — gate по analyticsOptIn).
- **`CommitmentDto` правят ТЗ-E (источник) и ТЗ-D (автор).** ТЗ-E добавляет `sourceMeetingId`/`sourceMeetingTitle`. ТЗ-D добавит `authorPersonId`-атрибуцию по автору (поле в DTO `authorPersonId` уже есть — `commitments.dto.ts:76`). Не перезатирать: добавлять свои поля, чужие не трогать.
- **Схему `schema.prisma` ТЗ-E НЕ трогает** (нет db push). Схемные ТЗ — B (isPrimary), D (commitmentAuthorPersonId), F (ownerPersonId).

## Контракт-first (единый источник правды фронт↔бэк)

### 1. Self-режим Pulse — фронт-проп

`PersonPulseClient.tsx` — публичная сигнатура компонента расширяется опциональным пропом (default сохраняет текущее manager-поведение):

```ts
export type PersonPulseMode = 'manager' | 'self';

export function PersonPulseClient({
  personId,
  mode = 'manager',
}: {
  personId: string;
  /** 'self' — личный кабинет «Я»: тон от первого лица, без HR-блоков и ссылок в /persons. */
  mode?: PersonPulseMode;
}) { /* ... */ }
```

При `mode === 'self'`:
- НЕ рендерить `HrResumeSection` (`PersonPulseClient.tsx:428`).
- НЕ рендерить `PersonProbeQuestionsSection` («Вопросы AI этому человеку», `:959`).
- НЕ рендерить `ComingSoonSection` (`:1132`) — это служебный roadmap-блок.
- `HeaderBlock` (`:242`): подпись «Pulse · карточка сотрудника» → «Мой пульс»; скрыть ссылки «Открыть полный профиль» (`:285`) и `BackLink` «Назад к карточке» (`:230`).
- Заголовки-секции от первого лица: «Здоровье и настроение» → «Моё здоровье и настроение»; `PromisesCard` пояснение (`:829-832`) для self переформулировать «Здесь — обещания, адресованные мне (как коллеги держат слово передо мной)» (чтобы не читалось как «моя дисциплина»).
- `RiskFlagsSection` (`:868`) — в self НЕ рендерить (это «сигналы для разговора 1:1» руководителю, не самому человеку).

### 2. Backend — `getPulse` параметр `forSelf`

`person-pulse.service.ts` — сигнатура (`:116`):

```ts
async getPulse(args: {
  tenantId: string;
  personId: string;
  /** true — запрос self-view (личный кабинет «Я»). При этом HR-suggestions
   *  не отдаются (это служебный сигнал руководителя, не для самого человека). */
  forSelf?: boolean;
}): Promise<PersonPulseDto>
```

При `forSelf === true`: в результирующем DTO `hrSuggestions = null`, `hrSuggestionsGeneratedAt = null` (defense-in-depth; фронт всё равно не рендерит). **Кэш разделить по режиму** — ключ `person_pulse:${tenantId}:${personId}:${forSelf ? 'self' : 'mgr'}` (иначе self-ответ перетрёт manager-кэш и наоборот). `person-pulse.service.ts:120` `cacheKey`.

Контроллер `persons.controller.ts:122` `pulse()` — определить self и прокинуть `forSelf`:

```ts
const isSelf = await this.isSelfPerson(user.id, t, id); // Person.userId === user.id
return this.personPulseSvc.getPulse({ tenantId: t, personId: id, forSelf: isSelf });
```

> Если запрос делает owner/admin/coo про САМОГО себя — `isSelf=true`, HR-блок скрывается. Это корректно: на своём «Пульсе» руководитель тоже видит «про меня». Доступ к чужой карточке (`forSelf=false`) не меняется.

### 3. `CommitmentDto` — поля источника

`commitments.dto.ts` `CommitmentDto` (`:64`) — добавить два поля (после `authorPersonName`, не перезатирая):

```ts
export interface CommitmentDto {
  // ...существующие поля...
  authorPersonId: string | null;
  authorPersonName: string | null;
  /** ТЗ-E — id встречи-источника обещания (derive из evidence: первое
   *  IdeaBlockEvidence с sourceType='meeting' → RawEvent.sourceExternalId).
   *  null если обещание извлечено не из встречи (чат/дамп) или источник не найден. */
  sourceMeetingId: string | null;
  /** ТЗ-E — заголовок встречи-источника (Meeting.title). null если meeting не найден. */
  sourceMeetingTitle: string | null;
  askedAt: string | null;
  escalatedAt: string | null;
  createdAt: string;
}
```

Зеркало во фронте `promises.api.ts` `CommitmentApi` (`:21`) — те же два поля.

`commitments.service.ts` — derive источника в `listMine` (`:76`). В `commitmentSelect()` (`:256`) добавить выборку evidence c rawEvent:

```ts
evidence: {
  where: { sourceType: 'meeting' },
  orderBy: { sourceTimestamp: 'asc' },
  take: 1,
  select: { rawEvent: { select: { sourceExternalId: true } } },
},
```

Затем одним батч-запросом подтянуть `Meeting.title` по собранным `sourceExternalId` (meetingId) той же `tenantId`, и в `toDto` проставить `sourceMeetingId`/`sourceMeetingTitle`. N+1 запрещён — заголовки тянуть одним `meeting.findMany({ where: { id: { in: ids }, tenantId } })`.

### 4. «Перенести срок» — эндпоинт

DTO `commitments.dto.ts` (новый, после `MarkPromiseBodySchema`):

```ts
export const ReschedulePromiseBodySchema = z
  .object({
    /** Новый срок исполнения (ISO date|datetime). Должен быть в будущем. */
    dueDate: z.string().datetime({ offset: true }),
    note: z.string().max(2_000).optional(),
  })
  .strict();

export type ReschedulePromiseBody = z.infer<typeof ReschedulePromiseBodySchema>;
```

Контроллер `my-promises.controller.ts` — новый метод (рядом с `mark`, `:95`):

```ts
@Patch(':blockId/reschedule')
@ApiOperation({ summary: 'Перенести срок моего обещания (статус остаётся open)' })
async reschedule(
  @CurrentOrg() tenantId: string | undefined,
  @Req() req: Request,
  @Param('blockId') blockId: string,
  @Body(new ZodValidationPipe(ReschedulePromiseBodySchema)) body: ReschedulePromiseBody,
): Promise<CommitmentDto> { /* resolveSelfPerson → svc.rescheduleMine */ }
```

Сервис `commitments.service.ts` — `rescheduleMine`:
- найти блок тем же self-фильтром, что `markMine` (`:129`);
- валидация: `new Date(body.dueDate) > now` иначе `BadRequestException` код `due_date_in_past`;
- валидация: текущий `commitmentStatus ∈ ('open','asked',null)` иначе `BadRequestException` код `commitment_terminal` (нельзя переносить уже закрытое);
- `update`: `commitmentDueDate = new Date(body.dueDate)`, `commitmentStatus = 'open'`, дописать в `trustedAnswer` строку `[reschedule → <ISO>] <note?>` (как делает `markMine:156`);
- вернуть `toDto`.

Машинные коды ошибок: `due_date_in_past` (400), `commitment_terminal` (400), `commitment_not_found` (404), `no_person` (403), `tenant_required` (400).

Фронт `promises.api.ts`:

```ts
reschedule: (blockId: string, body: { dueDate: string; note?: string }) =>
  apiClient.patch<CommitmentApi>(`/api/v1/me/promises/${blockId}/reschedule`, body),
```

### 5. Opt-out социального вклада — эндпоинт

Сервис (новый, по образцу `recognition-preference.service.ts`): Redis-ключ `helpfulness:optout:<tenantId>:<userId>` → JSON `{ optedOut: boolean, updatedAt: string }`, дефолт `optedOut=false`.

DTO `helpfulness.dto.ts`:

```ts
export const SocialContributionOptOutBodySchema = z
  .object({ optedOut: z.boolean() })
  .strict();
export type SocialContributionOptOutBody = z.infer<typeof SocialContributionOptOutBodySchema>;
export interface SocialContributionOptOutDto { optedOut: boolean; updatedAt: string; }
```

Контроллер `helpfulness.controller.ts` (рядом с `getMyProfile`, `:61`):

```
GET  /api/v1/me/social-contribution/opt-out  → SocialContributionOptOutDto
POST /api/v1/me/social-contribution/opt-out  body={ optedOut } → SocialContributionOptOutDto
```

Auth: `CookieAuthGuard + TenantGuard`, self-only (`CurrentUser.id`). Фронт `helpfulness.api.ts`: `getMyOptOut()`, `setMyOptOut(optedOut: boolean)`.

> **Учёт opt-out в выдаче профиля** (минимально для честности UI): при `optedOut=true` cron-агрегатор `social-contribution-profile.cron.ts` и публичная лента «Спасибо команде» должны исключать этого user'а. Это уже за рамками первой итерации UI — в Ф4 реализуем хранение+чтение настройки и реальное сохранение из UI; фактическое исключение из публичной ленты — отметить TODO в коде сервиса спотлайтов (`team-spotlight.service.ts:22` уже имеет аналогичный TODO по recognition). Acceptance Ф4 проверяет сохранение/чтение настройки, не фильтрацию ленты.

### 6. «Фидбек» — реальный счётчик

`helpfulness.dto.ts` `SocialContributionProfileDto` — добавить `constructiveFeedbackCount: number`. Сервис `helpfulness-api.service.ts` — посчитать из `HelpfulnessTrait` (`traitType='constructive_feedback'`, тот же фильтр, что для остальных публичных счётчиков). Маппер `helpfulness.ts:252` — заменить `constructive_feedback: 0` на `dto.constructiveFeedbackCount`.

### 7. ASCII-поток (self vs manager)

```
GET /api/v1/persons/:id/pulse
        │
   isSelfPerson(user.id, tenantId, id)?
     ├── да  → getPulse({..., forSelf:true})  → DTO с hrSuggestions=null  → <PersonPulseClient mode="self">
     └── нет → canViewPulse (owner/admin/coo)
                 ├── да  → getPulse({..., forSelf:false}) → DTO с hrSuggestions → <PersonPulseClient mode="manager">
                 └── нет → 403 forbidden

Кабинет «Я» /me  →  Tabs[Обзор|Пульс|Вклад|Помощь коллегам|Обещания]
   вкладка «Пульс» → MyPulseClient → <PersonPulseClient mode="self">
```

## Границы автономии (для этой фичи)

- ✅ **Always:** добавлять вкладки/редиректы; добавлять опц. проп `mode` и опц. параметр `forSelf` (с дефолтами, не меняющими текущее поведение); добавлять поля в DTO (additive); новый эндпоинт reschedule/opt-out; русификация копий; парные токены.
- ⚠️ **Ask first:** менять сигнатуру/семантику существующих эндпоинтов (`mark`, `getMyProfile`); менять структуру навигации сверх «5→1»; вводить новую модель Prisma (в этом ТЗ db push НЕ предполагается — если выяснится потребность, сначала спросить).
- 🚫 **Never:** расширять `MarkPromiseBodySchema` статусом «reschedule»/«open» (отдельный эндпоинт); трогать manager-логику ТЗ-G в `PersonPulseClient`/`getPulse`; трогать Р2-приватность настроения; вводить голосовой вывод; англ. слова в UI; `text-white`/hex/slate-классы; `process.env.*`.

## Фазы (dependency-ordered)

Граф зависимостей:
```
Ф2 (self-режим Pulse, бэк+фронт)  ─┐
Ф3 (обещания: источник+reschedule)─┤
Ф4 (opt-out + Фидбек)             ─┼─→ Ф1 (кабинет с вкладками собирает готовые вкладки)
                                   │
Ф5 (удалить /me/dashboard) ── независима, можно в любой момент
```
Рекомендуемый порядок: **Ф2 → Ф3 → Ф4 → Ф1 → Ф5** (сначала чинят содержимое вкладок, потом собирают каркас; Ф5 независима). Допустимо Ф5 первой.

| Фаза | Зависит от |
|---|---|
| Ф1 | Ф2, Ф3, Ф4 (вкладки рендерят их готовые компоненты) |
| Ф2 | — |
| Ф3 | — |
| Ф4 | — |
| Ф5 | — |

---

### Ф2 — Self-режим «Пульса»

**Цель.** На личном «Пульсе» сотрудник видит «про меня», без служебных блоков руководителя.

**Что входит.**
- Фронт: проп `mode?: 'manager'|'self'` (default `'manager'`) в `PersonPulseClient`; условный рендер (см. Контракт §1); `MyPulseClient.tsx:49` передаёт `mode="self"`.
- Бэк: параметр `forSelf` в `getPulse` (Контракт §2); раздельный кэш-ключ; контроллер определяет self и прокидывает `forSelf`; при self `hrSuggestions=null`.

**Что НЕ входит.** Manager-улучшения (вход в Пульс с карточки, pulseScore, people-at-risk) — ТЗ-G.

**Точные файлы.**
- `frontend/app/(authenticated)/persons/[id]/pulse/PersonPulseClient.tsx:65` (`PersonPulseClient`), `:155` (рендер секций), `:428` `HrResumeSection`, `:868` `RiskFlagsSection`, `:959` `PersonProbeQuestionsSection`, `:1132` `ComingSoonSection`, `:242` `HeaderBlock`, `:230` `BackLink`, `:790` `PromisesCard`.
- `frontend/app/(authenticated)/me/pulse/MyPulseClient.tsx:49` (`<PersonPulseClient personId={personId} />`).
- `backend/src/modules/persons/services/person-pulse.service.ts:116` (`getPulse`), `:120` (`cacheKey`), `:201` (`hrSuggestions`).
- `backend/src/modules/persons/persons.controller.ts:122` (`pulse`), `:254` (`canViewPulse`) — добавить `isSelfPerson`.

**Зависимости.** Перед правкой `PersonPulseClient` — re-Read (ТЗ-G мог его изменить); согласовать единый проп `mode`.

**Acceptance.**
- `grep -n "mode?: PersonPulseMode" frontend/app/(authenticated)/persons/[id]/pulse/PersonPulseClient.tsx` → найдено.
- `grep -n "mode=\"self\"" frontend/app/(authenticated)/me/pulse/MyPulseClient.tsx` → найдено.
- `grep -n "forSelf" backend/src/modules/persons/services/person-pulse.service.ts` → найдено (≥2: сигнатура + кэш-ключ).
- `grep -n "isSelfPerson" backend/src/modules/persons/persons.controller.ts` → найдено.
- Пример вход→выход (бэк): `getPulse({tenantId, personId, forSelf:true})` → `result.hrSuggestions === null`; `forSelf:false` (или не задан) → `hrSuggestions` как раньше.
- Негатив: запрос `/persons/:id/pulse` другим owner про чужого сотрудника → `forSelf=false`, `hrSuggestions` присутствуют (manager-вид не сломан).
- `cd backend && bun run typecheck && bun run lint`; `cd frontend && bun run typecheck && bun run lint`.
- `cd backend && bunx vitest run src/modules/persons/services/person-pulse.service.spec.ts` (если файла нет — создать spec: self скрывает hrSuggestions, кэш self/mgr не пересекается).

**Закрывает: R1, R2.**

---

### Ф3 — Обещания: источник, просрочка, перенос срока, мобильная раскладка

**Цель.** Обещание видно «откуда», просрочка красная, срок можно перенести, таблица читается на телефоне.

**Что входит.**
- Бэк: поля `sourceMeetingId`/`sourceMeetingTitle` в `CommitmentDto` + derive в `listMine` (Контракт §3); эндпоинт `PATCH /:blockId/reschedule` + `rescheduleMine` (Контракт §4).
- Фронт: зеркало полей в `CommitmentApi` + `promises.api.ts.reschedule`; колонка «Откуда» (ссылка `/meetings/:id/result` если есть, иначе «—»); подсветка просрочки (красный, если `dueDate < now` и статус `open`/`asked`); кнопка «Перенести срок» (открывает date-picker, шлёт reschedule); card-stack раскладка на `< sm` (вместо `<table>`).

**Что НЕ входит.** Атрибуция по автору (`commitmentAuthorPersonId`) — ТЗ-D. Расширение `mark`.

**Точные файлы.**
- `backend/src/modules/operations/dto/commitments.dto.ts:64` (`CommitmentDto`), `:31` (`MarkPromiseBodySchema` — НЕ трогать), новый `ReschedulePromiseBodySchema`.
- `backend/src/modules/operations/services/commitments.service.ts:76` (`listMine`), `:256` (`commitmentSelect`), `:317` (`toDto`), новый `rescheduleMine`.
- `backend/src/modules/operations/controllers/my-promises.controller.ts:95` (`mark`) — рядом новый `reschedule`.
- `frontend/src/api/promises.api.ts:21` (`CommitmentApi`), `:41` (`promisesApi`).
- `frontend/app/(authenticated)/me/promises/MyPromisesClient.tsx:119-171` (таблица), `:136` (`formatDate`), `:150` (кнопка «Не сделано»).

**Зависимости.** —

**Acceptance.**
- `grep -n "sourceMeetingId" backend/src/modules/operations/dto/commitments.dto.ts` и `.../promises.api.ts` → найдено в обоих.
- `grep -n "ReschedulePromiseBodySchema" backend/src/modules/operations/dto/commitments.dto.ts` → найдено.
- `grep -n "reschedule" backend/src/modules/operations/controllers/my-promises.controller.ts` → найдено (`@Patch(':blockId/reschedule')`).
- `grep -n "rescheduleMine" backend/src/modules/operations/services/commitments.service.ts` → найдено.
- `grep -n "Перенести срок" frontend/app/(authenticated)/me/promises/MyPromisesClient.tsx` → найдено.
- Пример вход→выход: `PATCH /me/promises/<id>/reschedule {dueDate:"2099-01-01T00:00:00Z"}` → 200, `status:'open'`, `dueDate` обновлён. Негатив: `dueDate` в прошлом → 400 `due_date_in_past`; блок со статусом `fulfilled` → 400 `commitment_terminal`; чужой blockId → 404 `commitment_not_found`.
- `MarkPromiseBodySchema` НЕ изменён: `grep -n "'reschedule'\|'open'" backend/src/modules/operations/dto/commitments.dto.ts` в блоке `MarkPromiseBodySchema` → отсутствует.
- Swagger smoke: `/api/docs` содержит `PATCH /api/v1/me/promises/{blockId}/reschedule`.
- `cd backend && bun run typecheck && bun run lint`; `cd frontend && bun run typecheck && bun run lint`.
- `cd backend && bunx vitest run src/modules/operations/services/commitments.service.spec.ts` (reschedule: ok / past / terminal; источник derive из evidence).

**Закрывает: R3, R4, R5, R6.**

---

### Ф4 — Opt-out социального вклада (реальный) + счётчик «Фидбек»

**Цель.** Тумблер приватности реально сохраняется; счётчик «Фидбек» показывает реальное число.

**Что входит.**
- Бэк: Redis-preference сервис opt-out (Контракт §5) + GET/POST эндпоинты; поле `constructiveFeedbackCount` в `SocialContributionProfileDto` + подсчёт (Контракт §6).
- Фронт: `helpfulness.api.ts` — `getMyOptOut`/`setMyOptOut`; в `MySocialContributionClient.tsx` `handleToggleOptOut` (`:94`) шлёт реальный POST, начальное состояние читает GET; `helpfulness.ts:252` — `constructive_feedback: dto.constructiveFeedbackCount`.

**Что НЕ входит.** Фактическая фильтрация публичной ленты по opt-out (TODO в сервисе спотлайтов).

**Точные файлы.**
- Новый `backend/src/modules/specialist-3-8-helpfulness/services/social-contribution-preference.service.ts` (по образцу `recognition-preference.service.ts`).
- `backend/src/modules/specialist-3-8-helpfulness/controllers/helpfulness.controller.ts:61` (рядом — opt-out GET/POST).
- `backend/src/modules/specialist-3-8-helpfulness/dto/helpfulness.dto.ts` (`SocialContributionProfileDto`, новые opt-out схемы/DTO).
- `backend/src/modules/specialist-3-8-helpfulness/services/helpfulness-api.service.ts` (подсчёт `constructiveFeedbackCount`).
- `frontend/src/api/helpfulness.api.ts:169` (`getMySocialContribution`) — рядом opt-out методы.
- `frontend/src/domain/helpfulness.ts:239` (`mapSocialContributionProfile`), `:252` (`constructive_feedback: 0`).
- `frontend/app/(authenticated)/me/social-contribution/MySocialContributionClient.tsx:75` (`optOut` state), `:94` (`handleToggleOptOut`).

**Зависимости.** —

**Acceptance.**
- `grep -n "helpfulness:optout:" backend/src/modules/specialist-3-8-helpfulness/services/social-contribution-preference.service.ts` → найдено.
- `grep -n "social-contribution/opt-out" backend/src/modules/specialist-3-8-helpfulness/controllers/helpfulness.controller.ts` → найдено (GET+POST).
- `grep -n "constructiveFeedbackCount" backend/src/modules/specialist-3-8-helpfulness/dto/helpfulness.dto.ts` → найдено.
- `grep -n "constructive_feedback: dto.constructiveFeedbackCount" frontend/src/domain/helpfulness.ts` → найдено; `grep -n "constructive_feedback: 0" frontend/src/domain/helpfulness.ts` → отсутствует.
- `grep -n "setMyOptOut\|getMyOptOut" frontend/src/api/helpfulness.api.ts` → найдено; `grep -n "поставлен в очередь\|в очередь" frontend/app/(authenticated)/me/social-contribution/MySocialContributionClient.tsx` → отсутствует (фейковый toast убран).
- Пример вход→выход: `POST /me/social-contribution/opt-out {optedOut:true}` → 200 `{optedOut:true, updatedAt}`; затем `GET .../opt-out` → `{optedOut:true}`. Дефолт (нет записи): GET → `{optedOut:false}`. Негатив: тело без `optedOut` → 400 (Zod strict).
- `cd backend && bun run typecheck && bun run lint`; `cd frontend && bun run typecheck && bun run lint`.
- `cd backend && bunx vitest run src/modules/specialist-3-8-helpfulness/services/social-contribution-preference.service.spec.ts` (set→get round-trip, дефолт false).

**Закрывает: R7, R8.**

---

### Ф1 — Кабинет «Я» с вкладками + редиректы + один пункт сайдбара

**Цель.** Один раздел «Я» с пятью вкладками; старые URL ведут на вкладки; в сайдбаре один пункт.

**Что входит.**
- Вкладки на `/me`: «Обзор» (текущий `MeClient`), «Пульс» (`MyPulseClient`, self-режим из Ф2), «Вклад» (`ContributionsView title="Чем я полезен компании"`), «Помощь коллегам» (`MySocialContributionClient`), «Обещания» (`MyPromisesClient`). Управление вкладкой — query `?tab=` (`overview|pulse|contributions|social|promises`), дефолт `overview`. Заголовки вкладок — простым языком: «Обзор», «Пульс», «Чем я полезен компании», «Чем я помогаю коллегам», «Мои обещания».
- Редиректы (Next.js): `/me/pulse` → `/me?tab=pulse`, `/me/contributions` → `/me?tab=contributions`, `/me/social-contribution` → `/me?tab=social`, `/me/promises` → `/me?tab=promises`. Реализация: в `page.tsx` каждой старой страницы — серверный `redirect()` из `next/navigation` (страницы остаются как redirect-stubs, чтобы внешние ссылки/тур/закладки не били 404).
- Сайдбар `ME_GROUP` (`Sidebar.tsx:270`): оставить только `{ href:'/me', label:'Я' }` + `/me/channels`, `/actions`, `/feedback`, `/referrals`. Удалить пункты `/me/pulse`, `/me/contributions`, `/me/social-contribution`, `/me/promises`.
- `nav-help.ts` (`:54-65`): удалить записи `/me/contributions`, `/me/social-contribution`, `/me/promises`; запись `/me` оставить.
- Внутренние ссылки на старые URL — оставить (редиректы их подхватят) ИЛИ обновить на `?tab=` где тривиально: `DirectorDashboardClient.tsx:357` (`href="/me/promises"`) → `/me?tab=promises`.

**Что НЕ входит.** Полноценный личный дашборд «что важно сегодня» (vNext). Вкладка «Обзор» = текущий `MeClient` без изменений.

**Точные файлы.**
- `frontend/app/(authenticated)/me/page.tsx:17` (`MePage`) + `MeClient.tsx` — обернуть в Tabs (вкладки рендерят существующие клиенты; «Обзор» = текущий `MeClient`-контент).
- `frontend/app/(authenticated)/me/pulse/page.tsx`, `.../contributions/page.tsx`, `.../social-contribution/page.tsx`, `.../promises/page.tsx` — заменить тело на `redirect('/me?tab=...')`.
- `frontend/src/ui/components/app-shell/Sidebar.tsx:270` (`ME_GROUP`), `:282-286`.
- `frontend/src/lib/nav-help.ts:54-65`.
- `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx:357`.
- UI Tabs — использовать существующий `frontend/src/ui/shadcn/tabs` (Radix) если есть; иначе паттерн как в других многотабовых клиентах (проверить наличие перед написанием своего).

**Зависимости.** Ф2 (Пульс self-режим), Ф3 (Обещания), Ф4 (Вклад в команду) — вкладки рендерят их готовый результат.

**Acceptance.**
- `grep -n "tab=pulse\|tab=promises\|tab=social\|tab=contributions" frontend/app/(authenticated)/me` (рекурсивно) → найдено в redirect-stubs.
- `grep -n "redirect(" frontend/app/(authenticated)/me/pulse/page.tsx` → найдено (и в остальных трёх).
- `grep -n "'/me/pulse'\|'/me/contributions'\|'/me/social-contribution'\|'/me/promises'" frontend/src/ui/components/app-shell/Sidebar.tsx` → отсутствует (пункты удалены).
- `grep -n "href: '/me'" frontend/src/ui/components/app-shell/Sidebar.tsx` → найдено (единственный пункт «Я»).
- `grep -n "/me/promises" frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx` → отсутствует (заменено на `/me?tab=promises`).
- Тур/хуки на старые URL не бьют 404 (редиректы покрывают) — ручная навигация по `/me/pulse` ведёт на `/me?tab=pulse`.
- Все вкладки рендерятся без ошибок (нет англ. слов в заголовках вкладок: `grep` по англ. в новом коде вкладок отсутствует).
- `cd frontend && bun run typecheck && bun run lint && bun run build`.

**Закрывает: R9, R10, R11.**

---

### Ф5 — Удалить `/me/dashboard`

**Цель.** Убрать мёртвую страницу-заглушку.

**Что входит.** Удалить `frontend/app/(authenticated)/me/dashboard/MyDashboardClient.tsx` и заменить `page.tsx` на `redirect('/me')` (на случай закладок). Удалить упоминания в комментариях (`TopHelpfulWidget.tsx:14`, `RecognitionFeedWidget.tsx`) — только текст комментариев, без логики.

**Что НЕ входит.** —

**Точные файлы.**
- `frontend/app/(authenticated)/me/dashboard/MyDashboardClient.tsx` (удалить), `frontend/app/(authenticated)/me/dashboard/page.tsx` (→ redirect).
- `frontend/src/ui/components/helpfulness/TopHelpfulWidget.tsx:14` (комментарий).

**Зависимости.** —

**Acceptance.**
- `MyDashboardClient.tsx` отсутствует (файл удалён).
- `grep -n "redirect('/me')" frontend/app/(authenticated)/me/dashboard/page.tsx` → найдено.
- `grep -rn "/me/dashboard" frontend/app frontend/src` → только в комментариях/redirect-stub, ни одной активной ссылки-навигации.
- `cd frontend && bun run typecheck && bun run lint && bun run build`.

**Закрывает: R12.**

---

## Требования (EARS) и трассировка

| R | Требование | Фаза |
|---|---|---|
| R1 | Когда `PersonPulseClient` получает `mode='self'`, система shall не рендерить `HrResumeSection`, `PersonProbeQuestionsSection`, `RiskFlagsSection`, `ComingSoonSection` и ссылки в `/persons/:id`, и показывать заголовки от первого лица. | Ф2 |
| R2 | Когда контроллер `pulse()` определяет `Person.userId === currentUser.id`, система shall вызвать `getPulse({forSelf:true})`, и в ответе `hrSuggestions=null`; иначе (manager-вид) `hrSuggestions` отдаётся как прежде. Кэш self и manager не пересекаются. | Ф2 |
| R3 | Система shall возвращать в `CommitmentDto` поля `sourceMeetingId` и `sourceMeetingTitle`, выводимые из первого `IdeaBlockEvidence` с `sourceType='meeting'`; если источник-встреча не найден — оба `null`. | Ф3 |
| R4 | Когда сотрудник на `/me?tab=promises` видит просроченное обещание (`dueDate < now`, статус `open`/`asked`), система shall отображать срок красным (парный токен `text-chip-danger-fg`). | Ф3 |
| R5 | Когда сотрудник вызывает `PATCH /me/promises/:blockId/reschedule {dueDate}` с будущей датой по своему обещанию в статусе `open`/`asked`/`null`, система shall установить `commitmentDueDate=dueDate`, оставить `commitmentStatus='open'` и вернуть обновлённый `CommitmentDto`. При `dueDate` в прошлом shall вернуть 400 `due_date_in_past`; при терминальном статусе — 400 `commitment_terminal`; при чужом/несуществующем blockId — 404 `commitment_not_found`. | Ф3 |
| R6 | Система shall не добавлять статусы `reschedule`/`open` в `MarkPromiseBodySchema` (перенос — отдельный эндпоинт). | Ф3 |
| R7 | Когда сотрудник переключает тумблер приватности на «Помощь коллегам», система shall сохранить `optedOut` в Redis (`helpfulness:optout:<tenantId>:<userId>`) через `POST /me/social-contribution/opt-out` и при следующем GET вернуть сохранённое значение; дефолт (нет записи) — `optedOut=false`. | Ф4 |
| R8 | Система shall возвращать `SocialContributionProfileDto.constructiveFeedbackCount` равным числу trait'ов `constructive_feedback`, и фронт shall показывать его в счётчике «Фидбек» вместо захардкоженного 0. | Ф4 |
| R9 | Система shall предоставлять `/me` с вкладками `overview|pulse|contributions|social|promises`, выбираемыми через `?tab=`, дефолт `overview`. | Ф1 |
| R10 | Когда пользователь открывает `/me/pulse`, `/me/contributions`, `/me/social-contribution` или `/me/promises`, система shall выполнить redirect на соответствующую вкладку `/me?tab=...` (без 404). | Ф1 |
| R11 | Система shall отображать в сайдбаре ровно один пункт раздела «Я» (`/me`) вместо пяти. | Ф1 |
| R12 | Когда пользователь открывает `/me/dashboard`, система shall выполнить redirect на `/me`; файл `MyDashboardClient.tsx` отсутствует. | Ф5 |

## Совместимость с prompt caching

Не релевантно: ТЗ не добавляет и не меняет LLM-вызовы и SYSTEM-промпты. Источник обещания выводится из БД (evidence→rawEvent→meeting), без обращений к LLM. `social-contribution-profile.cron` (LLM-агрегатор) в этом ТЗ не правится по логике промптов (только опц. чтение opt-out — за рамками Ф4-acceptance).

## Pre-mortem / Риски + ревью-аспекты

- **Конфликт с ТЗ-G в `PersonPulseClient`/`getPulse`.** Митигация: ТЗ-G раньше; перед правкой re-Read; единый проп `mode`, единый параметр `forSelf`; не трогать manager/Р2-логику. (Ревью: дифф не задевает строки G.)
- **Кэш Pulse: self-ответ перетирает manager.** Митигация: раздельный кэш-ключ (`:self`/`:mgr`). (Ревью: проверить ключ в spec.)
- **Источник обещания: N+1 по Meeting.** Митигация: один батч `findMany({id:{in:[...]}})`. (Ревью: нет findFirst в цикле.)
- **Reschedule на терминальном/чужом обещании.** Митигация: self-фильтр как в `markMine` + проверка статуса; коды ошибок 400/404. (Ревью: негативные тесты.)
- **Opt-out не фильтрует ленту в этой итерации** — UI обещает «не показывать публично». Митигация: формулировка тумблера честная («сохранится; исключение из ленты — в ближайшем обновлении») ИЛИ TODO в `team-spotlight.service`; не обещать в копи того, чего нет (инвариант приватности).
- **Tabs ломают глубокие ссылки.** Митигация: `?tab=` + серверные redirect-stubs со старых URL.
- **Multi-tenancy.** Все чтения/мутации обещаний и opt-out — с `tenantId` (self-фильтр по Person.userId внутри tenant). Redis-ключ включает `tenantId`.

## Idempotency / feature-flag / prod-deploy

- **db push:** НЕТ (нет изменений `schema.prisma`). → Шаг 4 prod-deploy-log **не затрагивается**.
- **ENV / AdminSetting:** НЕТ (opt-out — Redis-preference пользователя, не ENV/AdminSetting). → Шаг 1 **не затрагивается**.
- **Скрипты seed/patch/backfill/migrate:** НЕТ. → Шаги 5–10 **не затрагиваются**, `apply-prod-deploy.ts` не правится.
- **Feature-flag:** не требуется — изменения аддитивные и не рискованные (UI-перекомпоновка + новые эндпоинты с дефолтами, сохраняющими старое поведение). Kill-switch не нужен.
- **Idempotency:** reschedule и opt-out идемпотентны по смыслу (повторный вызов с тем же телом даёт тот же результат). Redis opt-out — overwrite, без накопления.
- **Prod-deploy:** **Шаг 12 (smoke)** — добавить в Swagger-smoke проверку `PATCH /api/v1/me/promises/{blockId}/reschedule` и `GET/POST /api/v1/me/social-contribution/opt-out`. Иных prod-операций нет → достаточно `docker compose up -d --build`.

## DoD (Definition of Done)

- `cd backend && bun run typecheck && bun run lint && bun run build` — зелёные (вкл. новые `.spec.ts`).
- `cd frontend && bun run typecheck && bun run lint && bun run build` — зелёные.
- `bunx vitest run` для новых spec (Ф2 person-pulse self, Ф3 commitments reschedule+source, Ф4 opt-out round-trip) — зелёные.
- Все grep-маркеры из Acceptance каждой фазы присутствуют/отсутствуют как указано.
- Ни одного англ. слова в новом пользовательском UI; парные токены (без `text-white`/hex/slate).
- **second-brain (по таблице производных заметок):**
  - Новый API-эндпоинт → `01_projects/api-layer.md` (`/me/promises/:id/reschedule`, `/me/social-contribution/opt-out`).
  - Новая публичная страница/перекомпоновка → `01_projects/frontend-pages.md` (кабинет «Я» с вкладками, удаление `/me/dashboard`).
  - Профильная заметка `01_projects/<feature>.md` — обновить разделы «Пульс»/«Обещания»/«Социальный вклад».
- `docs/operations/prod-deploy-log.md` — обновить **Шаг 12** (Swagger-smoke новых эндпоинтов); прочих шагов нет.
- Prod-инструкция в чате: «prod-операций нет (нет db push / ENV / скриптов), достаточно `docker compose up -d --build`; в smoke добавлены 2 новых эндпоинта».
- Рефлексия в `second-brain/05_история/`.

## Итог

- [ ] Ф2 — Self-режим «Пульса» (бэк `forSelf` + фронт `mode='self'`)
- [ ] Ф3 — Обещания: источник + просрочка + reschedule + мобильная раскладка
- [ ] Ф4 — Opt-out социального вклада (реальный) + счётчик «Фидбек»
- [ ] Ф1 — Кабинет «Я» с вкладками + редиректы + один пункт сайдбара
- [ ] Ф5 — Удалить `/me/dashboard`

_Реализовано целиком / частично — заполнит оркестратор._
