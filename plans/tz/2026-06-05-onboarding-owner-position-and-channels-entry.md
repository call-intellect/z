---
type: tz
status: ready-to-implement
feature: onboarding-owner-position-and-channels-entry
date: 2026-06-05
owner: sergrv80@gmail.com (владелец Z)
relates_to:
  - plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md
  - plans/tz/2026-05-25-telegram-bot-global-and-invites.md
  - second-brain/01_projects/conversational-channels.md
---
> Контекст исследован в сессии 2026-06-05 (диалог про Telegram-канал и должность собственника). Статус согласования развилок: 2026-06-05 (3 развилки закрыты владельцем через AskUserQuestion — см. «Принятые решения»).

# ТЗ — Онбординг собственника: должность на «Я» + единый вход в Telegram-каналы

## Цель

Закрыть два UX-пробела, найденные владельцем при первом запуске компании:

1. **Должность собственника не задаётся.** После регистрации Person владельца создаётся без должности, на странице «Я» висит «Должность не назначена», и нет очевидного способа её назначить себе. Нужно дать карточку «Должность» прямо на «Я» — выбрать существующую или создать новую и назначить себе в один-два клика.
2. **Привязка Telegram спрятана и задублирована.** Привязка живёт на двух страницах (`/me/channels` и `/settings/integrations`), причём первая (богаче) не выведена ни в меню, ни со страницы «Я». Настройка уведомлений `/me/notifications-telegram` доступна только со «спрятанной» `/me/channels`. Нужно: единый канонический вход (карточка «Telegram» на «Я» + пункт меню «Каналы»), устранить дубль, сделать настройку уведомлений достижимой.

### Зачем (болезненное состояние → как решение лучше)

- Должность собственника нужна графу знаний, атрибуции встреч и Employee Clones (см. [meeting-identity-and-clones-attribution](plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md)). Пустая должность владельца — слепое пятно ровно у самого активного участника.
- Без видимого входа в Telegram собственник не получает отчёты/уведомления и не понимает, как подключить сотрудников. Бот — основной канал доставки (`telegram_bot` — первый приоритет в большинстве `eventType`, см. [conversational.service.ts](backend/src/modules/conversational/conversational.service.ts)).

## REALITY-CHECK (что уже есть по факту — проверено по коду 2026-06-05)

**Бэкенд для должности готов на 100% — изменений НЕ требуется:**

- Person владельца создаётся автоматически при регистрации: [orgs.service.ts:105](backend/src/modules/orgs/orgs.service.ts#L105) `ensurePersonForUser` (`relationship='employee'`, name/email из User), `Membership.personId` проставляется.
- Назначение должности уже реализовано через `PATCH /api/v1/persons/:id { roleId }` → создаёт `PersonRole` (validFrom=now) **и** `Appointment`, плюс `EntityLink` — [persons.service.ts:342-372](backend/src/modules/persons/services/persons.service.ts#L342-L372). При смене roleId старая `PersonRole` закрывается (validTo=now) — [persons.service.ts:524](backend/src/modules/persons/services/persons.service.ts#L524).
- `GET /api/v1/me/profile` отдаёт `{ person, role, department, roleProfile }`, причём `role` резолвится из `person.personRoles[0]` — [me.service.ts:86-94](backend/src/modules/me/me.service.ts#L86-L94). **Вывод:** после `PATCH /persons/:id {roleId}` шапка «Я» и карточка покажут должность без доработок бэка.
- Каталог должностей (`Role`, «бизнес-должность», НЕ `Membership.role`): `GET/POST /api/v1/roles` — [roles-domain.controller.ts](backend/src/modules/roles-domain/roles-domain.controller.ts). `CreateRoleSchema = { name, departmentId? }` — [roles-domain.dto.ts:33](backend/src/modules/roles-domain/dto/roles-domain.dto.ts#L33). RBAC-ресурс `role`, write = owner/admin.
- **Грабля, которую закрываем:** на свежей компании роли НЕ сидируются (`createForOwner` создаёт только Source + Subscription + tables, но не Role — [orgs.service.ts:113-130](backend/src/modules/orgs/orgs.service.ts#L113-L130)). Значит карточка должна уметь СОЗДАТЬ роль, а не только выбрать.
- RBAC `PATCH /persons/:id` требует write на `person` — у owner есть.

**Фронтовые API-обёртки уже существуют — реализация это композиция, не новый слой:**

- `meProfileApi.get(orgId): MyProfileApi` — [structure.api.ts:367](frontend/src/api/structure.api.ts#L367). `MyProfileApi = { person: PersonDomainApi|null, role: RoleDomainApi|null, department, roleProfile }`. `person.id` доступен.
- `rolesDomainApi.list(orgId, query)` и `rolesDomainApi.create(orgId, { name, departmentId? })` — [structure.api.ts:243-259](frontend/src/api/structure.api.ts#L243-L259).
- `personsDomainApi.update(orgId, personId, { roleId })` → `PATCH /persons/:id` — [structure.api.ts:303-315](frontend/src/api/structure.api.ts#L303-L315).
- Telegram: `listMyChannels`, `generateLinkCode`, `unlinkChannelBinding` — [conversational.api.ts:103-130](frontend/src/api/conversational.api.ts#L103-L130); `resetTelegramBinding` — [me-channels.api.ts:64](frontend/src/api/me-channels.api.ts#L64); доменный маппер `mapTelegramChannelEntry` — [me-channels.ts](frontend/src/domain/me-channels.ts).

**Telegram-страницы и навигация (факт):**

- `/me/channels` → [ChannelsClient.tsx](frontend/app/(authenticated)/me/channels/ChannelsClient.tsx) — богаче: статусы `linked/not_linked/bot_blocked/channel_disabled`, «Сбросить привязку», ссылка на `/me/notifications-telegram`. **НЕ выведена нигде.**
- `/settings/integrations/page.tsx` рендерит ДВА блока: `<TelegramLinkSection />` (дубль привязки) **и** `<DestinationsClient />` (outbound-направления доставки Email/Slack/Telegram-bot/Webhook — отдельная легитимная фича, свой API `destinations.api`). **ПОПРАВКА к первоначальному ТЗ (2026-06-05, при реализации):** изначально REALITY-CHECK ошибочно утверждал «только TelegramLinkSection» (узкий grep пропустил `DestinationsClient`). Дедуп Telegram НЕ должен убивать `DestinationsClient`. Секция-дубль — [TelegramLinkSection.tsx](frontend/app/(authenticated)/settings/integrations/TelegramLinkSection.tsx). Выведена в меню как «Интеграции» — [Sidebar.tsx](frontend/src/ui/components/app-shell/Sidebar.tsx).
- `ME_GROUP` («Моё пространство») — [Sidebar.tsx:269-287](frontend/src/ui/components/app-shell/Sidebar.tsx#L269-L287); пункта «Каналы» нет.
- Страница «Я» = [MeClient.tsx](frontend/app/(authenticated)/me/MeClient.tsx): `ProfileHeader` (показывает «Должность не назначена» при `role===null` — строки 135-139) + `RoleProfileBlock` («Моя карта должности») + `MyDocumentsBlock` + `MyMeetingsBlock`.
- Установленный в кодовой базе паттерн «страница-редирект»: [settings/admin/members/page.tsx](frontend/app/(authenticated)/settings/admin/members/page.tsx) → `redirect('/settings/organization')`.

**Вывод REALITY-CHECK: фича целиком фронтовая (frontend/). Бэкенд, Prisma, ENV, очереди, prod-deploy — НЕ затрагиваются.**

## Принятые решения владельца (2026-06-05, не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | **Канон Telegram — `/me/channels`** (ChannelsClient). В «Моё пространство» добавить пункт «Каналы». **ПОПРАВКА при реализации (2026-06-05):** изначально решили `/settings/integrations`→`redirect` и «убрать Интеграции из меню». Но эта страница хостит ещё `DestinationsClient` (направления доставки) — слепой redirect его осиротил бы. Скорректировано: на `/settings/integrations` оставить ТОЛЬКО `<DestinationsClient />` (убрать `<TelegramLinkSection />`), пункт «Интеграции» в меню **сохранить** (страница не пустая). Дедуп Telegram достигается тем, что привязка остаётся ровно в одном месте — `/me/channels`. `TelegramLinkSection.tsx` удалить как мёртвый код. | Одна реализация привязки — нет рассинхрона двух копий; `/me/channels` богаче. `DestinationsClient` — отдельная фича, её нельзя терять. |
| Р2 | **Карточка «Должность» на «Я»: выбрать существующую ИЛИ создать новую.** Поле с поиском по `GET /api/v1/roles` + кнопка «Создать должность» (`POST /api/v1/roles`), затем `PATCH /persons/:id {roleId}`. | На свежей компании ролей нет — без «создать» собственник упрётся в пустой список. |
| Р3 | **Лёгкий баннер-подсказка на «Я» + постоянные карточки.** Баннер сверху «Я» показывается, пока не заполнены должность и/или Telegram; кликает на якорь нужной карточки. Без отдельного onboarding-wizard. | Дёшево, не перегружает, закрывает 90% пользы. Полноценный wizard — vNext (см. Scope). |

## Доказательство выбора (сжатый proof-loop)

**Проход A (выбран):** композиция поверх существующих API — карточки на «Я» + правка Sidebar + redirect-страница. Ноль изменений бэка/схемы.

**Проход B (отвергнут):** новый онбординг-wizard-флоу как отдельная route-группа с шагами и серверным `onboardingState`. Отличие по оси «точка интеграции + модель данных» (новое серверное состояние онбординга).

| Критерий | A (карточки+редирект) | B (wizard+server state) |
|---|---|---|
| Изменения бэка/Prisma | ✓ нет | ✗ новая модель `OnboardingState` + миграция |
| Переиспользование готовых API | ✓ полностью | ✗ частично |
| Время до результата | ✓ часы | ✗ дни |
| Риск регресса | ✓ низкий (аддитивно) | ✗ выше (новый флоу, FSM) |
| Достаточность для задачи владельца | ✓ да | ⚠ избыточно |

**Challenge-loop по A:** (1) Корень, не симптом? — да: проблема в том, что вход спрятан и должность некуда назначить; решаем оба, а не маскируем. (2) Эффективнее? — да, ноль бэка. (3) Код ради кода? — нет, удаляем дубль (`TelegramLinkSection`), а не плодим. vNext-wizard явно отложен с триггером.

## Scope

### Входит
- Карточка «Должность» на «Я» с выбором/созданием роли и назначением себе.
- Карточка «Telegram» на «Я» (статус + CTA на `/me/channels`).
- Баннер-подсказка «заполните профиль» на «Я» (должность и/или Telegram не заполнены).
- Пункт меню «Каналы» → `/me/channels` в группе «Моё пространство».
- Удаление дубля: `/settings/integrations` → redirect на `/me/channels`; удаление `TelegramLinkSection.tsx`; удаление пункта «Интеграции» из Sidebar.
- Репойнт существующих ссылок на `/settings/integrations` (если есть) на `/me/channels`.

### Не входит (vNext / отложено)
- **Полноценный онбординг-wizard** после регистрации (пошаговый мастер должность→Telegram→…). Триггер выноса: если после этого ТЗ retention на заполнение профиля < целевого — открыть отдельное ТЗ `plans/tz/<date>-owner-onboarding-wizard.md`.
- **Сидирование дефолтных должностей** при создании Org. Намеренно НЕ делаем: набор должностей у каждой компании свой; карточка «создать должность» закрывает потребность. Если позже понадобится — отдельное ТЗ + правка `createForOwner`.
- **Назначение должностей другим сотрудникам с «Я»** — это уже есть в разделе «Структура» (`/structure`, `/persons/[id]/appointments`); не дублируем.
- Любые изменения бэкенда, Prisma, ENV, воркеров.

### Граничные контракты
- Бэкенд-эндпоинты `GET/POST /api/v1/roles`, `PATCH /api/v1/persons/:id`, `GET /api/v1/me/profile` используются **как есть**, без изменений. Если в ходе работы окажется, что какой-то контракт расходится с описанным здесь — СТОП, не менять бэк, сверить и обновить ТЗ.

## Границы фичи

- ✅ **Always:** только `frontend/`; слои `ApiDto→DomainModel→UiModel`; единый `apiClient`; SWR; парные цветовые токены `bg-*`/`text-*-fg`; весь UI — только русский (ни одного английского слова в видимом тексте); состояния loading/empty/error для каждого нового блока.
- ⚠️ **Ask first:** любое желание тронуть бэкенд/Prisma/Sidebar-группы кроме описанных; любое изменение поведения `ChannelsClient` сверх «сделать достижимым».
- 🚫 **Never:** новые эндпоинты; `process.env.*` в коде; правка `me.service`/`persons.service`/`orgs.service`; добавление англоязычных строк; жёсткие hex/slate-классы; `text-white` на цветном фоне.

## Контракты (дословно, для копипасты)

### Назначение должности себе (frontend-флоу)
```
1. GET /api/v1/me/profile (meProfileApi.get(orgId)) → person.id, role
2a. (выбор) GET /api/v1/roles?q=<ввод> (rolesDomainApi.list) → список { id, name }
2b. (создание) POST /api/v1/roles { name: "<введённое>" } (rolesDomainApi.create) → { role: { id } }
3. PATCH /api/v1/persons/{person.id} { roleId } (personsDomainApi.update) → { person }
4. mutate(['me-profile', orgId])  // SWR-ключ из MeClient.tsx:51 — шапка/карточка обновятся
```
Коды ошибок (уже отдаёт бэк, обрабатывать через `ApiError`): `forbidden` (нет прав), `tenant_required`, валидация Zod (имя должности пустое — `name` через `NameSchema`).

### Telegram-карточка на «Я» (read-only статус + CTA)
```
GET /api/v1/me/channels (listMyChannels(orgId)) → items[]
  → mapTelegramChannelEntry(...) → status: 'linked'|'not_linked'|'bot_blocked'|'channel_disabled'
CTA «Подключить Telegram» / «Управлять» → Link href="/me/channels"
```
Карточка на «Я» НЕ дублирует мастер привязки — только статус + переход на канон `/me/channels`.

### Пункт меню «Каналы» (NavItem — форма из Sidebar.tsx)
```ts
// в ME_GROUP.items (Sidebar.tsx:271), после пункта «Я»:
{ href: '/me/channels', label: 'Каналы', icon: <ИКОНКА>, matchPrefix: '/me/channels' },
```
`[ASSUMPTION]` иконка — `Send` или `Plug` (lucide-react). Рекомендую `Send` (символ отправки/мессенджера). Добавить в import lucide, если ещё не импортирована.

### Redirect-страница `/settings/integrations`
```tsx
// frontend/app/(authenticated)/settings/integrations/page.tsx — заменить тело на:
import { redirect } from 'next/navigation';
export default function SettingsIntegrationsPage(): never {
  redirect('/me/channels');
}
```
Образец — [settings/admin/members/page.tsx](frontend/app/(authenticated)/settings/admin/members/page.tsx).

## Фазы (dependency-ordered)

Зависимости: Ф1 и Ф2 независимы (можно параллельно). Ф3 зависит от Ф2 (общий каркас карточек на «Я»). Ф4 зависит от Ф2+Ф3 (баннер ссылается на обе карточки). Ф5 — финальная чистка, зависит от Ф1.

### Ф1 [x] — Telegram: навигация и устранение дубля (СКОРРЕКТИРОВАНО)
**Цель:** канон `/me/channels` доступен из меню; дубль привязки убран со страницы интеграций; `DestinationsClient` сохранён.
**Файлы:**
- [Sidebar.tsx](frontend/src/ui/components/app-shell/Sidebar.tsx): в `ME_GROUP.items` добавить пункт «Каналы»→`/me/channels` (icon `Send`, добавлен в import). Пункт «Интеграции» в `SETTINGS_BASE_ITEMS` **СОХРАНИТЬ** (ведёт на `/settings/integrations`, где остаётся `DestinationsClient`).
- [settings/integrations/page.tsx](frontend/app/(authenticated)/settings/integrations/page.tsx): убрать `<TelegramLinkSection />`, оставить `<DestinationsClient />` (страница НЕ редиректит).
- НЕ репойнтить ссылки на `/settings/integrations` — страница остаётся живой.
**Что НЕ входит:** изменение `ChannelsClient`/`DestinationsClient`; удаление `TelegramLinkSection.tsx` (это Ф5).
**Acceptance:**
- `rg -n "label: 'Каналы'" frontend/src/ui/components/app-shell/Sidebar.tsx` → 1 совпадение с `href: '/me/channels'`.
- `rg -n "label: 'Интеграции'" frontend/src/ui/components/app-shell/Sidebar.tsx` → 1 (сохранён, ведёт на `/settings/integrations`).
- `rg -n "TelegramLinkSection" frontend/app/(authenticated)/settings/integrations/page.tsx` → 0; `rg -n "DestinationsClient" .../page.tsx` → 1.
- `bun run typecheck && bun run lint` зелёные.
**Закрывает:** R5, R6, R7.

### Ф2 [x] — Карточка «Telegram» на «Я»
**Цель:** на странице «Я» виден статус Telegram и переход к привязке.
**Мини-картография:** карточки на «Я» рендерятся в [MeClient.tsx `Content`](frontend/app/(authenticated)/me/MeClient.tsx#L85-L99) (SWR-ключ профиля `['me-profile', orgId]`, [:51](frontend/app/(authenticated)/me/MeClient.tsx#L51)). Стиль карточек — `Card/CardHeader/CardTitle/CardContent` из `@/ui/shadcn/card` (как `RoleProfileBlock`).
**Файлы:**
- Новый компонент `frontend/app/(authenticated)/me/MyTelegramCard.tsx` (или функция-блок в `MeClient.tsx` рядом с `RoleProfileBlock`): SWR `['me-channels', orgId]` → `listMyChannels(orgId)` → `mapTelegramChannelEntry`. Рендер: заголовок «Telegram», бейдж статуса (по `status`), краткий текст, кнопка-ссылка `Link href="/me/channels"` («Подключить Telegram», если `not_linked`/`channel_disabled`/`bot_blocked`; «Управлять» — если `linked`).
- [MeClient.tsx](frontend/app/(authenticated)/me/MeClient.tsx): добавить `<MyTelegramCard orgId={orgId} />` в `Content` (после `RoleProfileBlock` или рядом с шапкой — см. Ф4 про порядок). Дать карточке `id="me-card-telegram"` (якорь для баннера Ф4).
**Что НЕ входит:** мастер привязки (deep-link/код) — он остаётся на `/me/channels`; настройки уведомлений.
**Acceptance:**
- На «Я» виден блок «Telegram» с состояниями loading (Skeleton) / error (текст) / данные.
- Статусы маппятся: `not_linked` → бейдж «Не подключён» + кнопка «Подключить Telegram»; `linked` → «Подключён» + «Управлять». Все подписи — на русском.
- Клик ведёт на `/me/channels` (`rg -n "href=\"/me/channels\"" frontend/app/(authenticated)/me` → ≥1).
- `id="me-card-telegram"` присутствует.
- typecheck/lint зелёные; `bun run test:unit` (если добавлен маппинг-тест) зелёный.
**Закрывает:** R3, R4.

### Ф3 [x] — Карточка «Должность» на «Я» (выбрать/создать + назначить)
**Цель:** собственник назначает себе должность в 1–2 клика; шапка «Я» перестаёт показывать «Должность не назначена».
**Файлы:**
- Новый компонент `frontend/app/(authenticated)/me/MyPositionCard.tsx`: props `{ orgId, profile }` (profile из `meProfileApi`). Поведение:
  - если `profile.role` задан → показать текущую должность + кнопка «Изменить»;
  - если `role===null` → поле-комбобокс: ввод имени → debounce → `rolesDomainApi.list(orgId, { q })` → список; выбор существующей → `personsDomainApi.update(orgId, profile.person.id, { roleId })`; если совпадений нет → кнопка «Создать должность “<ввод>”» → `rolesDomainApi.create(orgId, { name })` → затем `update` с новым `roleId`;
  - после успеха → `mutate(['me-profile', orgId])` + toast «Должность назначена».
  - guard: если `profile.person===null` (нет карточки) — показать мягкое «Профиль ещё формируется», без падения.
- [MeClient.tsx](frontend/app/(authenticated)/me/MeClient.tsx): вставить `<MyPositionCard orgId={orgId} profile={profile ?? null} />` в `Content` (рекомендуемый порядок — сразу под шапкой, перед «Моя карта должности»). Дать `id="me-card-position"`.
**Что НЕ входит:** редактирование отдела (`departmentId`) — опционально, по умолчанию `null` (бэк допускает); KPI/loadPercent; назначение другим сотрудникам.
**Acceptance:**
- На пустой компании (ролей нет): ввод «Генеральный директор» → кнопка «Создать должность “Генеральный директор”» → клик → должность создана и назначена; шапка «Я» меняет «Должность не назначена» на ссылку с названием (`role` в `meProfileApi` теперь не null — проверяется перерисовкой после `mutate`).
- При наличии ролей: ввод подстроки фильтрует список через `GET /api/v1/roles?q=`; выбор назначает без создания дубля роли.
- Повторное назначение другой должности закрывает прошлую (поведение бэка) — UI показывает новую.
- Состояния loading/saving/error; ошибки `ApiError` (`forbidden` и пр.) — человекочитаемый toast на русском.
- `rg -n "personsDomainApi.update|rolesDomainApi.(create|list)" frontend/app/(authenticated)/me/MyPositionCard.tsx` → присутствует все три вызова.
- typecheck/lint зелёные.
**Закрывает:** R1, R2.

### Ф4 [x] — Баннер-подсказка «заполните профиль»
**Цель:** пока должность и/или Telegram не заполнены — мягко подсказать сверху «Я».
**Файлы:**
- [MeClient.tsx](frontend/app/(authenticated)/me/MeClient.tsx) `Content`: над шапкой рендерить баннер, если `profile.role===null` ИЛИ Telegram `status!=='linked'`. Баннер: одна строка текста + ссылки-якоря на `#me-card-position` / `#me-card-telegram` (или плавный scroll). Цвет — мягкий info через парные токены (например `bg-accent-muted`/`text-accent`), без жёстких hex.
- Источник Telegram-статуса для условия — переиспользовать SWR `['me-channels', orgId]` из Ф2 (не дёргать API повторно: вынести в `Content` или лёгкий общий хук).
**Что НЕ входит:** dismiss-состояние с серверным хранением (одноразовость через сервер) — НЕ делаем; баннер просто исчезает, когда оба заполнены. Локальный `localStorage`-dismiss — опционально, `[ASSUMPTION]` не добавляем в этой фазе.
**Acceptance:**
- Должность не назначена И/ИЛИ Telegram не подключён → баннер виден; обе ссылки скроллят/ведут к нужным карточкам (`#me-card-position`, `#me-card-telegram`).
- Должность назначена И Telegram `linked` → баннер не рендерится.
- Текст полностью на русском; токены парные; typecheck/lint зелёные.
**Закрывает:** R8.

### Ф5 [x] — Чистка мёртвого кода
**Цель:** удалить осиротевший после Ф1 `TelegramLinkSection`.
**Файлы:**
- Удалить `frontend/app/(authenticated)/settings/integrations/TelegramLinkSection.tsx`.
- Убедиться, что он больше нигде не импортируется: `rg -n "TelegramLinkSection" frontend` → 0 совпадений после удаления.
**Что НЕ входит:** трогать `ChannelsClient`/`/me/notifications-telegram`.
**Acceptance:**
- `rg -n "TelegramLinkSection" frontend` → 0.
- `bun run typecheck && bun run lint && bun run build` зелёные (нет битых импортов).
**Закрывает:** R6 (завершение дедупа).

## Требования (трассировка)

- **R1.** Когда собственник на «Я» без назначенной должности вводит название и подтверждает, система shall создать/выбрать `Role` и вызвать `PATCH /persons/:id {roleId}`, после чего `GET /me/profile` возвращает непустой `role`.
- **R2.** Если на компании нет ни одной `Role`, then карточка «Должность» shall предложить «Создать должность “<ввод>”» (а не оставлять пустой список).
- **R3.** Когда собственник на «Я», система shall показать карточку «Telegram» со статусом привязки из `GET /me/channels`.
- **R4.** Карточка «Telegram» на «Я» shall вести на `/me/channels` и не дублировать мастер привязки.
- **R5.** В боковом меню в группе «Моё пространство» shall присутствовать пункт «Каналы» → `/me/channels`.
- **R6.** Дубль привязки shall быть устранён: со страницы `/settings/integrations` убран `TelegramLinkSection`, файл `TelegramLinkSection.tsx` удалён; привязка Telegram доступна ровно в одном месте — `/me/channels`. `DestinationsClient` на странице сохранён.
- **R7.** Страница `/settings/integrations` и пункт меню «Интеграции» shall остаться рабочими (на странице — только `DestinationsClient`).
- **R8.** Если должность и/или Telegram не заполнены, then на «Я» shall отображаться баннер-подсказка со ссылками на соответствующие карточки; при заполнении обоих баннер исчезает.

## Pre-mortem / Риски и ревью-аспекты

- **Гонка SWR:** после `update` обязательно `mutate(['me-profile', orgId])` — иначе шапка покажет старое «Должность не назначена». Ревью: проверить ключ совпадает с `MeClient.tsx:51`.
- **Дубликаты ролей:** при «создать» одинаковые имена могут плодить роли. Бэк сам не дедупит по имени — но это вне scope (управление каталогом — в «Структуре»). Зафиксировать как известное поведение, не чинить здесь.
- **RBAC:** если фичей воспользуется НЕ owner/admin (обычный сотрудник на своей «Я»), `PATCH /persons` и `POST /roles` вернут `forbidden`. Карточка должна показать понятный текст, а не белый экран. Ревью: путь ошибки `forbidden`.
- **i18n:** ни одной английской строки в видимом UI (правило админки — только русский).
- **Битые импорты после Ф5:** обязательный `bun run build`.

## Idempotency / feature-flag / prod-deploy

- **Feature-flag:** не требуется — аддитивный фронт без риска внешне-наблюдаемого поведения; быстрый откат через revert.
- **Prod-deploy:** prod-операций НЕТ (нет schema/scripts/ENV/очередей/эндпоинтов). Достаточно пересборки фронта. В завершающем блоке чата указать «prod-операций нет».
- **Совместимость с prompt caching:** не релевантно (LLM не затрагивается).

## DoD

- `bun run typecheck` (вкл. `.spec`), `bun run lint`, `bun run build` во `frontend/` — зелёные.
- `bun run test:unit` — зелёный (если добавлены тесты маппинга/карточек).
- Ручная проверка на свежей компании: назначил себе должность с «Я» (создание новой роли) → шапка обновилась; увидел карточку Telegram и перешёл в `/me/channels`; пункт «Каналы» в меню работает; `/settings/integrations` редиректит; баннер исчезает после заполнения.
- second-brain обновлён: [frontend-pages.md](second-brain/01_projects/frontend-pages.md) (новые карточки на «Я», redirect `/settings/integrations`), при необходимости [frontend-contexts-hooks.md] (если введён общий хук Telegram-статуса). Запись в `04_не-сделано/README.md`: строка про отложенный onboarding-wizard (vNext) с причиной.
- Рефлексия в `second-brain/05_история/`.

## Итог

**Реализовано целиком (2026-06-05, ветка `feature/onboarding-owner-position-and-channels-entry`).** Все 5 фаз закрыты. Фича чисто фронтовая — бэкенд/Prisma/ENV не тронуты; prod-операций нет.

| Фаза | Коммит | Что сделано |
|---|---|---|
| Ф1 | `25cb46d2` | Пункт меню «Каналы»→`/me/channels` в «Моё пространство»; со страницы `/settings/integrations` убран дубль `TelegramLinkSection`, оставлен `DestinationsClient`; пункт «Интеграции» сохранён |
| Ф2 | `b97db12c` | Карточка «Telegram» на «Я» (статус + CTA→`/me/channels`, якорь `#me-card-telegram`) |
| Ф3 | `33f16eae` | Карточка «Должность» на «Я» (Popover+Command, выбор/создание роли, `PATCH /persons/:id {roleId}`, якорь `#me-card-position`) |
| Ф4 | `c2d9bb8d` | Баннер-подсказка «заполните профиль» (показ пока нет должности/Telegram) |
| Ф5 | `7a9704e8` | Удалён мёртвый `TelegramLinkSection.tsx` |

**Отклонение от исходного ТЗ (зафиксировано выше в Р1/REALITY-CHECK):** изначальный план «redirect `/settings/integrations`→`/me/channels` + убрать пункт «Интеграции»» был ошибочным — страница хостит ещё `DestinationsClient` (направления доставки). Скорректировано при реализации: страница и пункт «Интеграции» сохранены, удалён только дубль-блок Telegram. Цель Р1 (одна точка привязки Telegram) достигнута полностью.

**Верификация:** `typecheck`, `lint`, `build` фронта — зелёные после каждой фазы и финально. Ручная боевая проверка (реальное назначение должности + привязка Telegram в проде) — НЕ выполнялась, оставлена владельцу.
