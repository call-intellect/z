---
type: tz
status: ready-to-implement
feature: assistant-fab-notifications-and-clone-picker
date: 2026-06-20
owner: Сергей (владелец)
relates_to:
  - plans/analysis/2026-06-20-assistant-fab-notifications-and-clone-picker.md
  - plans/tz/2026-06-02-action-center-pending-confirmations.md
  - plans/tz/2026-06-02-main-screen-umbrella-tails-finalization.md
  - plans/tz/2026-06-05-chat-surfaces-and-honest-buttons.md
  - plans/tz/2026-06-20-assistant-assign-task-to-others-and-notify.md
  - plans/tz/2026-06-11-assistant-channels-telegram-max.md
  - plans/tz/2026-06-17-cora-feed-into-dashboards.md
supersedes_partially: plans/tz/2026-06-02-main-screen-umbrella-tails-finalization.md  # роль FAB у AssistantSidebar
---
> ⚑ **ПОГЛОЩЕНО (2026-06-25):** фронтенд-часть (плавающая кнопка → сразу чат, слим-пикер «Помощник | Клоны», единый колокольчик уведомлений) вошла в Ф1 единого ТЗ [`2026-06-25-edinyy-pomoshnik-arhitektura.md`](2026-06-25-edinyy-pomoshnik-arhitektura.md). Реализацию вести по нему; этот файл — детальная картография фронта (компоненты, маппинг уведомлений, фазы Ф1–Ф4) для копипасты.
>
> Анализ: `plans/analysis/2026-06-20-assistant-fab-notifications-and-clone-picker.md` (status: research-complete) · Решения владельца согласованы: 2026-06-20

# ТЗ — Яркий вход в помощника + кликабельные уведомления в колокольчике + пикер собеседника

## Принцип
Развести **две поверхности**: внизу справа — одна яркая кнопка = **сразу чат-помощник**; наверху — колокольчик = **единственный кликабельный центр уведомлений**. Никакого кода ради кода: переиспользуем уже существующие `ConciergeFloatingButton`, `PendingActionsBell`, `proactiveApi`, `clonesApi` — НЕ строим новое рядом. **Работа целиком фронтовая** (все нужные эндпоинты и данные уже есть на бэке). К реализации — `tz-orchestrator`, фаза за фазой, только по «начни реализацию».

## Цель + Зачем
**Болезненное состояние (факт по коду):** плавающая кнопка внизу справа открывает не чат, а панель уведомлений `AssistantSidebar` («Помощник компании»), где живой чат задвинут в 4-ю вкладку; карточки уведомлений некликабельны и низкоконтрастны; счётчиков уведомлений два (вверху «N» + внизу «24») из разных источников. Регресс введён коммитом `d9730afb` (убрал собственный FAB у Консьержа). Это нарушает принятый принцип `feedback_concierge_entry_visible_button` («Concierge — главный вход = плавающий значок»).

**Чем решение лучше:** клик до поля ввода = 1 (было 2); 100% уведомлений кликабельны через уже существующий `actionUrl`; один счётчик; выбор собеседника (помощник/ролевые клоны) виден, но не мешает. Доказательная база и состязательные матрицы — в анализе §8–10 (Intercom bypass, Material actionable-notifications, Setproduct persona-tabs, WCAG-контраст).

## REALITY-CHECK (факт по коду 2026-06-20)
| Что | Статус по факту | Вывод для ТЗ |
|---|---|---|
| `ConciergeFloatingButton` (`frontend/src/ui/concierge/ConciergeFloatingButton.tsx`) | панель чата есть, **видимой кнопки нет** — открывается только по `window`-событию `concierge:open` (deep-link из `TablesListClient.tsx:92`) | вернуть видимую кнопку, событие сохранить |
| `AssistantSidebar` (`frontend/src/ui/components/dashboard/AssistantSidebar.tsx`) | видимый FAB `bottom-6 right-6 z-40`, смонтирован в `AuthenticatedShell.tsx:101`; 4 вкладки urgent/feed/probes/ask; `ProactiveItem` (~406-413) **некликабелен** (только dismiss); `humanizeRule` (~442-454) даёт сырой слаг для неизвестного ruleType | демонтировать как FAB; контент увести в колокольчик |
| `PendingActionsBell` (`frontend/src/ui/components/app-shell/PendingActionsBell.tsx`) | **уже есть и кликабелен** (`handleOpen`→`router.push(action.actionUrl)`), в шапке `AppShell.tsx:37`, `hidden md:flex` (десктоп) | расширить, не переписывать |
| `ProactiveNotification` | у всех 8 правил `payload.actionUrl` есть (`proactive-watcher.service.ts:~592`); фронт `proactive.api.ts` отдаёт `payload: unknown` → фронт его игнорирует | прокинуть `payload.actionUrl` в onClick |
| Эндпоинты клонов | `clonesApi.listClones`, `clonesApi.askRole` (`frontend/src/api/clones.api.ts:210,247`) уже есть; `AskCloneResponseApi` с `citations/refused/isOwner` | пикер строится на готовом API |
| Бэкенд | изменений НЕ требуется — все данные уже отдаются | прод-операций нет (только пересборка фронта) |

**Висящий контракт не обнаружен** (фронт↔бэк по proactive/clones согласованы). Главный «висяк» — игнорируемый `payload.actionUrl` — становится Ф1.

## Принятые решения владельца (2026-06-20, НЕ пересматривать)
| # | Решение | Обоснование (почему) |
|---|---|---|
| Р1 | Выбор собеседника — **слим-вкладки в чате** «Помощник компании \| Клоны ролей» (дефолт помощник, 1 клик до ввода), НЕ блокирующее меню | минимум шагов до ввода (Intercom bypass `verified`); выбор виден, но не барьер (Setproduct persona-tabs) |
| Р2 | Консолидация уведомлений — **фронт-first в существующий `PendingActionsBell`** (влить Proactive + срочный Feed, кликабельность через готовый `payload.actionUrl`), **БЕЗ бэкенд-мёржа таблиц** | цель (1 счётчик, всё кликабельно) достигается фронтом; ниже риск, чем бэкенд-рефактор (анализ §8.2 N-B) |
| Р3 | Пикер клонов — **«Помощник компании» + 2-4 недавних/закреплённых ролевых клона + ссылка «Все клоны»**; роли с единственным носителем скрывать (152-ФЗ) | паттерн Copilot/ChatGPT (недавние+закреплённые, не весь каталог); не перегружает не-техническую ЦА |
| Р4 | Пузырь Поддержки **развести по позиции** (не стопкой над FAB-помощником) | два пузыря в одном якоре = визуальный шум и риск промаха на мобиле |

## Доказательство выбора (сведение из анализа §8)
| Решение (Б#) | Выбор | Отвергнутая альтернатива → причина |
|---|---|---|
| Б1. Вход с FAB | один видимый FAB = прямой `ConciergeChat` | **откат `d9730afb`** → воскрешает 2 наложенных FAB (тот самый баг); **промежуточное меню** → лишний шаг (Intercom антипаттерн) |
| Б2. Уведомления | фронт-merge в колокольчик | **полный бэкенд-мёрж** → большой рефактор, выше риск; **оставить 2 места** → два счётчика, путаница сохраняется |
| Б3. Пикер | слим-вкладки в чате | **блокирующее меню** → +1 шаг; **авто-маршрутизация без выбора** → прячет клонов (наш moat) |
| Б4. Кликабельность | переиспользовать `payload.actionUrl` (+фронт-fallback ruleType→route) | реализовывать новый адресный слой → код ради кода, данные уже есть |

Состязательный red-team (анализ §10) пройден; единственная развилка (форма пикера) закрыта владельцем Р1.

## Scope
**Входит:** видимый яркий FAB прямого чата; демонтаж `AssistantSidebar`-FAB; консолидация Proactive+срочный Feed в `PendingActionsBell` (фронт); кликабельность+контраст+перевод слагов уведомлений; слим-пикер «помощник/клоны» в чате; разведение пузыря Поддержки; мобильная раскладка (FAB без коллизии + доступ к уведомлениям).

**Не входит (с судьбой):**
- Изменения бэкенда concierge/инструментов помощника → ТЗ `2026-06-20-assistant-assign-task-to-others-and-notify.md` (уже в работе) — НЕ трогать.
- Telegram/MAX как окно помощника → ТЗ `2026-06-11-assistant-channels-telegram-max.md` — этот ТЗ только in-app.
- Генерация probe-вопросов и их формулировка → ТЗ `2026-06-20-probe-smart-questions-module.md` (T7) — здесь только показ probe в колокольчике через уже существующий probe-провайдер.
- Бэкенд-приватность клонов single-incumbent (фильтрация на сервере) → если в Ф3 выяснится, что `listClones` не скрывает single-incumbent роли, открыть отдельный ТЗ в модуле `clones`; здесь полагаемся на существующий RBAC/access-grants клонов.
- Полный бэкенд-мёрж источников уведомлений в один провайдер → vNext (анализ §8.2 N-C), не сейчас.

## Пересечения и границы с другими ТЗ
| ТЗ | Пересечение | Граница (что делаю / НЕ делаю) |
|---|---|---|
| `action-center-pending-confirmations` / `action-center-remaining` | построили `PendingActionsBell` + `/actions` + модуль pending-actions | **расширяю** колокольчик (доп. секции Proactive/Feed), переиспользую хуки/провайдеры; НЕ переписываю модуль pending-actions |
| `main-screen-umbrella-tails-finalization` / `pulse-full` | создали `AssistantSidebar` | **снимаю его роль FAB** (см. `supersedes_partially`); контент переезжает в колокольчик/FAB-чат |
| `chat-surfaces-and-honest-buttons` | честность кнопок ConciergeChat/OrgChatPanel | сохраняю honesty; добавляю только пикер-вкладки |
| `assistant-assign-task-to-others-and-notify` (landed) | concierge backend-инструмент `assign_task` + уведомление `issue.assigned` | НЕ трогаю concierge backend/инструменты; FAB лишь открывает `ConciergeChat` |
| `assistant-channels-telegram-max` | concierge как окно в Telegram | in-app FAB только; общий `ConciergeService` НЕ меняю |
| `cora-feed-into-dashboards` | потребление `ActivityFeed` | тяну только **срочный** insight-feed в колокольчик; источник feed не меняю |
| crossover-map T1–T8 (`plans/analysis/2026-06-20-tz-crossover-map.md`) | бэкенд knowledge-core (block-ingest/decisions/ideas/regulations) | **нет файловых пересечений** — мой scope фронтовый |

**Файлы, которые правлю, не заявлены ни в одном параллельном ТЗ** (греп `AssistantSidebar/PendingActionsBell/ConciergeFloatingButton/ConciergeChat` по `plans/tz` дал только завершённые предшественники выше) → конфликт волн низкий.

## Контракты (file-first)

### Данные уведомления в колокольчике (единый UI-тип, фронт)
Колокольчик показывает три группы, сведённые к единому ряду. **Pending-actions** уже маппятся (`PendingAction`, `frontend/src/domain/pending-action.ts:55-66`). **Proactive** и **Feed** добавляются новым маппером в тот же UI-ряд:
```ts
interface BellRow {
  key: string;            // `${source}:${id}`
  group: 'pending' | 'proactive' | 'signal';
  title: string;          // ВСЕГДА человекочитаемый (никаких latin_snake)
  actionUrl: string;      // обязателен — иначе ряд не показываем
  severity: 'urgent' | 'normal';
  ageDays?: number;
  canQuickConfirm?: boolean;   // только для pending
  dismissable?: boolean;       // только для proactive (dismiss)
}
```
Proactive → BellRow: `actionUrl = (payload as {actionUrl?: string}).actionUrl ?? PROACTIVE_RULE_ROUTE[ruleType]`; `title = (payload as {title?: string}).title ?? PROACTIVE_RULE_LABEL[ruleType]`. Если после фолбэков `actionUrl` или человекочитаемого `title` нет — ряд **скрываем** (не показываем сырой слаг).

`PROACTIVE_RULE_LABEL` — перенести из `AssistantSidebar.humanizeRule` (8 правил) + гард-тест «каждый ruleType из watcher имеет метку». `PROACTIVE_RULE_ROUTE` — фронт-зеркало маршрутов watcher (`decision_no_owner→/decisions/{id}` и т.д.) как fallback, если `payload.actionUrl` пуст.

### Пикер собеседника (Ф3)
```ts
type Interlocutor =
  | { kind: 'company' }                          // ConciergeChat (SSE, инструменты)
  | { kind: 'role_clone'; roleId: string; roleName: string };  // clonesApi.askRole
```
Список клонов: `clonesApi.listClones(orgId, { status: 'active' })` → `CloneListItemApi[]` (`clones.api.ts:116-129`); показываем ≤4 (по `confidence` desc) + ссылка «Все клоны» → `/clones`. Диалог клона: `clonesApi.askRole(orgId, roleId, { question, conversationId? })` → `AskCloneResponseApi`.

## Границы фичи
- ✅ **Always:** UI только на русском; парные токены `bg-accent`+`text-accent-fg` (никогда `text-white`/hex/slate); вывод помощника — только текст (голос лишь на ВВОД, `feedback_concierge_text_only_output`); переиспользовать существующие компоненты/хуки/эндпоинты.
- ⚠️ **Ask first:** любое изменение бэкенда (по умолчанию его НЕТ — если фаза «захотела» бэкенд, остановиться и вынести в отдельный ТЗ); смена дефолтного собеседника с «помощника» на что-то иное.
- 🚫 **Never:** не вводить feature-flag «на всякий случай» (это UI-перекомпоновка, Ship-On); не трогать concierge backend-инструменты и `ConciergeService`; не реализовывать здесь приватность клонов на сервере; не показывать сырой `latin_snake_case` как заголовок уведомления.

## Фазы

### Граф зависимостей
```
Ф1 (колокольчик = дом уведомлений)  ──►  Ф2 (FAB-чат + демонтаж AssistantSidebar)  ──►  Ф3 (пикер собеседника)
                                                         └──────────────►  Ф4 (мобайл)
```
Ф1 строго раньше Ф2: нельзя снимать `AssistantSidebar`-FAB, пока его уведомления не переехали в колокольчик (иначе они станут недостижимы). Ф3 после Ф2 (пикер живёт в FAB-панели). Ф4 после Ф2 (мобильная раскладка нового FAB + доступа к колокольчику).

---

### Ф1 — Колокольчик = единый кликабельный центр уведомлений
**Цель:** `PendingActionsBell` показывает все три группы (pending + proactive + срочный feed) одним счётчиком; каждое уведомление кликабельно, контрастно, с человекочитаемым заголовком.

**Мини-картография** (перечитать номера строк перед правкой — могли сместиться; якоря по символам):
- `frontend/src/ui/components/app-shell/PendingActionsBell.tsx` — якорь `usePendingActionsCount`, `handleOpen`, `PopoverContent`.
- `frontend/src/api/proactive.api.ts` — `proactiveApi.list` (есть).
- `frontend/src/api/activity-feed.api.ts` — `activityFeedApi.list` (используется в `AssistantSidebar.tsx:48-70`, скопировать паттерн).
- `frontend/src/ui/components/dashboard/AssistantSidebar.tsx:442-454` — `humanizeRule` (8 правил) — источник для `PROACTIVE_RULE_LABEL`.
- `backend/src/modules/proactive/services/proactive-watcher.service.ts` — якоря по строкам с `actionUrl:` для зеркала `PROACTIVE_RULE_ROUTE` (8 правил).

**Что входит:**
1. Новый хук `useAssistantSignals(orgId, enabled)` (рядом с `usePendingActions`) — `proactiveApi.list` + `activityFeedApi.list({feedType:'insight', status:'emitted'})` фильтр `severity ∈ {critical, high}`, маппинг в `BellRow[]` (group `proactive`/`signal`) с фолбэками `actionUrl`/`title` по контракту.
2. Бейдж колокольчика = `pendingTotal + signalsCount` (расширить `usePendingActionsCount` ИЛИ суммировать в `PendingActionsBell` рядом). `hasUrgent` учитывает proactive `severity:high`.
3. В `PopoverContent` — секции: «Подтверждения» (как есть), «Требует внимания» (proactive), «Сигналы» (срочный feed). Каждый ряд — `onClick`/ссылка → `router.push(actionUrl)`; pending сохраняет «Подтвердить/Отложить»; proactive — «Открыть» + dismiss.
4. Перевод слагов: `PROACTIVE_RULE_LABEL` покрывает все ruleType; неизвестный слаг без человекочитаемого title → ряд скрыт. Гард-тест паритета (см. Acceptance).
5. Контраст: ряды на токенах `bg-bg-card`/`text-fg-primary`, действия без `opacity-40`; бейдж дублируется текстом (`aria-label`).

**Что НЕ входит:** демонтаж `AssistantSidebar` (Ф2); пикер (Ф3); мобильная раскладка (Ф4); любые правки бэкенда.

**Acceptance (машинно):**
- Греп `useAssistantSignals` в `PendingActionsBell.tsx` → найден; грепа `proactiveApi` и `activityFeedApi` в файле колокольчика → найдены.
- Юнит-тест: маппер Proactive→BellRow: вход `{ruleType:'decision_no_owner', payload:{}}` → `title='Решение без ответственного'`, `actionUrl='/decisions/...'` (через `PROACTIVE_RULE_ROUTE`); вход с неизвестным `ruleType` и пустым payload → ряд = `null` (скрыт).
- Гард-тест: для каждого `ruleType` из списка watcher (8) `PROACTIVE_RULE_LABEL[ruleType]` определён (нет `undefined`/возврата сырого ключа).
- Негатив: ни один `BellRow.title` не матчит `/^[a-z][a-z0-9_]+$/` (нет сырых latin_snake).
- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` — зелёные.

**Закрывает:** R3, R4, R5, R6.

---

### Ф2 — Яркий FAB прямого чата + демонтаж AssistantSidebar + чистка угла
**Цель:** одна видимая яркая кнопка внизу справа открывает `ConciergeChat` напрямую; `AssistantSidebar` как FAB удалён; пузырь Поддержки разведён.

**Мини-картография:**
- `frontend/src/ui/concierge/ConciergeFloatingButton.tsx` — добавить видимую кнопку-триггер (panel уже есть).
- `frontend/app/(authenticated)/AuthenticatedShell.tsx:101` — снять `<AssistantSidebar />`.
- `frontend/src/ui/components/dashboard/AssistantSidebar.tsx` — удалить файл (после Ф1 его контент покрыт колокольчиком).
- `frontend/src/ui/support/SupportWidgetMount.tsx` / `SupportWidget.tsx` — `bottom-24 right-6` → развести (см. ниже).
- грепнуть оставшиеся импорты `AssistantSidebar`, `assistant-sidebar:open-ask` — удалить/перенаправить (`AskSection`-вызов больше не нужен — вход в чат теперь FAB).

**Что входит:**
1. `ConciergeFloatingButton`: видимая круглая кнопка `fixed bottom-6 right-6 z-40`, `bg-accent text-accent-fg`, иконка-искра; клик → `setOpen(true)` (панель `ConciergeChat`). Событие `concierge:open` сохранить (deep-link из Таблиц). `data-tour-target="welcome.concierge"` перенести на эту кнопку.
2. Снять `<AssistantSidebar />` из `AuthenticatedShell`; удалить файл `AssistantSidebar.tsx`; вычистить мёртвые импорты/события.
3. Пузырь Поддержки развести: `[ASSUMPTION: переносим SupportWidget в bottom-left (bottom-6 left-6) — освобождает нижний правый угол под единственный FAB-помощник; если владелец предпочтёт пункт в меню — тривиально менять]`.
4. На экране ровно ОДИН плавающий FAB-помощник.

**Что НЕ входит:** пикер собеседника (Ф3 — пока FAB открывает только `ConciergeChat`); мобильная раскладка (Ф4).

**Acceptance:**
- Греп `AssistantSidebar` по `frontend/` (искл. node_modules/.next) → 0 совпадений.
- Греп `bottom-6 right-6` по `frontend/src/ui` → встречается у FAB-помощника; у SupportWidget якорь иной (не `right-6 bottom-6`).
- Визуальный предикат (Playwright, прод/локально по подтверждению): один яркий FAB внизу справа; клик → поле ввода чата видно без промежуточных экранов (1 действие).
- `typecheck`/`lint`/`build` зелёные; нет битых импортов.

**Закрывает:** R1, R2, R10, R12.

---

### Ф3 — Пикер собеседника (слим-вкладки «Помощник компании | Клоны ролей»)
**Цель:** в панели FAB вверху — слим-переключатель; дефолт «Помощник компании» (`ConciergeChat`); «Клоны ролей» → короткий список → диалог с ролевым клоном; имя активного собеседника видно в ответах.

**Мини-картография:**
- `frontend/src/ui/concierge/ConciergeFloatingButton.tsx` — host панели (добавить переключатель над чатом).
- `frontend/src/ui/concierge/ConciergeChat.tsx` — режим «помощник» (как есть).
- `frontend/src/api/clones.api.ts` — `listClones` (`:247`), `askRole` (`:210`).
- Грепнуть существующий клон-чат компонент (`askRole` usage в `frontend/`) — **переиспользовать**, если есть; иначе минимальный клон-чат на `askRole`.

**Что входит:**
1. Слим-сегмент-контрол (взаимоисключающие вкладки, одна активна) вверху панели: «Помощник компании» (дефолт) · «Клоны ролей».
2. Режим «Клоны»: список `listClones({status:'active'})`, ≤4 по `confidence` desc, карточка = `publicName`/`roleName`; ссылка «Все клоны» → `/clones`. Выбор клона → клон-чат через `askRole`; показывать `publicName` собеседника над/в каждом ответе клона; рендерить `citations`; при `refused` — показать `refusalReason` человекочитаемо.
3. Single-incumbent: `[ASSUMPTION: listClones уже RBAC/access-grants-фильтрует клонов, которые пользователю нельзя видеть; если в проде single-incumbent роль всё же видна — фиксируем как находку и открываем отдельный ТЗ в модуле clones (см. Scope «Не входит»)]`.

**Что НЕ входит:** изменения бэкенда клонов; диалог с клоном конкретного человека (только роли в v1); «недавние/закреплённые» как персист (v1 — сорт по confidence; персональные pin — vNext).

**Acceptance:**
- Грепы `listClones`, `askRole` в коде панели/пикера → найдены.
- Дефолт-режим = «Помощник компании» (юнит/рендер-тест: при первом открытии активна вкладка company, фокус в поле ввода — 1 клик до ввода).
- Список клонов ограничен ≤4 + видна ссылка «Все клоны» (рендер-тест с моком 10 клонов → отрендерено 4 + ссылка).
- Ответ клона показывает `publicName` собеседника (рендер-тест).
- `typecheck`/`lint`/`build` зелёные.

**Закрывает:** R7, R8, R9.

---

### Ф4 — Мобильная раскладка
**Цель:** на мобиле FAB-помощник не перекрывается `MobileTabBar`; уведомления-колокольчик доступны на мобиле.

**Мини-картография:**
- `frontend/src/ui/concierge/ConciergeFloatingButton.tsx` — мобильный отступ FAB.
- `frontend/src/ui/mobile/MobileTabBar.tsx`, `MobileShell.tsx`, `frontend/src/ui/components/app-shell/Header.tsx` (`MobileHeader`) — точка входа в уведомления на мобиле.
- `frontend/src/ui/components/app-shell/AppShell.tsx:35-38` — `PendingActionsBell` сейчас `hidden md:flex`.

**Что входит:**
1. FAB на мобиле поднять над таб-баром (напр. `bottom-20` на `<md`, `bottom-6` на `md+`) — не перекрывает `MobileTabBar`.
2. Доступ к уведомлениям на мобиле: показать `PendingActionsBell` в `MobileHeader` (снять `hidden md:flex` для мобильного размещения ИЛИ отрендерить колокольчик в мобильной шапке).
3. `[ASSUMPTION: мобильный таб «/ask» (MobileAskClient) оставляем как есть в этой волне; согласование его с пикером — vNext, не блокирует]`.

**Что НЕ входит:** редизайн `MobileTabBar`; пикер на мобиле (наследуется из Ф3 автоматически, отдельной работы не требует).

**Acceptance:**
- Визуальный предикат (Playwright, эмуляция мобильного вьюпорта): FAB виден и не перекрыт нижним таб-баром; колокольчик/счётчик уведомлений доступен на мобиле.
- Греп: у FAB есть адаптивный bottom-класс (`bottom-20`/`md:bottom-6` или эквивалент).
- `typecheck`/`lint`/`build` зелёные.

**Закрывает:** R11.

---

## Требования (EARS, сквозная трассировка)
- **R1.** Когда пользователь нажимает плавающую кнопку, система shall открыть чат-помощника с фокусом в поле ввода без промежуточных экранов (1 действие). *(Ф2)*
- **R2.** Система shall отображать ровно одну плавающую кнопку-помощник в нижнем правом углу. *(Ф2)*
- **R3.** Колокольчик shall показывать уведомления всех трёх групп (pending-actions, proactive, срочный feed) с единым счётчиком. *(Ф1)*
- **R4.** Когда пользователь кликает уведомление в колокольчике, система shall выполнить переход по его `actionUrl`. *(Ф1)*
- **R5.** Система shall НЕ рендерить сырой `latin_snake_case` слаг как заголовок уведомления (перевод или скрытие). *(Ф1)*
- **R6.** Уведомления shall соответствовать контрасту WCAG (текст ≥4.5:1, иконки ≥3:1) и не использовать прозрачность на интерактивных элементах. *(Ф1)*
- **R7.** Чат-панель shall содержать слим-переключатель «Помощник компании \| Клоны ролей» с дефолтом «Помощник компании». *(Ф3)*
- **R8.** Когда выбран режим «Клоны», система shall показать ≤4 доступных активных ролевых клона и ссылку «Все клоны»; выбор клона shall вести диалог через `askRole`. *(Ф3)*
- **R9.** Система shall показывать имя активного собеседника в ответах режима клона. *(Ф3)*
- **R10.** Система shall не монтировать `AssistantSidebar`; файл удалён, функции покрыты колокольчиком и FAB. *(Ф2)*
- **R11.** На мобильном вьюпорте FAB shall не перекрываться `MobileTabBar`, а уведомления shall быть доступны. *(Ф4)*
- **R12.** Пузырь Поддержки shall не находиться в том же якоре (`bottom-6 right-6`), что FAB-помощник. *(Ф2)*

## Pre-mortem / Риски + ревью-аспекты
| Риск | Митигизация |
|---|---|
| Часть proactive-уведомлений приходит без `payload.actionUrl` | фронт-fallback `PROACTIVE_RULE_ROUTE[ruleType]`; если и его нет — ряд скрыт (R5/R4 не ломаются) |
| `humanizeRule` не покрывает новый ruleType (как «table_cells_enriched») | гард-тест паритета + правило «нет метки → скрыть»; **в Ф1 грепнуть источник слага** и при необходимости добавить метку |
| Удаление `AssistantSidebar` оставит битые импорты/события | греп `AssistantSidebar`/`assistant-sidebar:open-ask` = 0 в acceptance Ф2 |
| Два FAB во время перехода | строгий порядок Ф1→Ф2; Ф2 одновременно добавляет FAB-помощник и снимает FAB AssistantSidebar |
| single-incumbent клон протечёт в пикер (152-ФЗ) | полагаемся на RBAC `listClones`; `[ASSUMPTION]` + явная находка→отдельный ТЗ |
| Дубль счётчиков, если бейдж не объединить | R3 проверяет единый счётчик; `usePendingActionsCount` расширить, не плодить второй бейдж |

**Ревью-аспекты для `strict-production-review-gate`:** нет утечки сырых слагов в UI; нет `text-white`/hex/slate; парные токены; нет голосового вывода; нет случайного feature-flag; нет правок бэкенда; деление поверхностей (FAB=чат, колокольчик=уведомления) соблюдено.

## Идемпотентность / feature-flag / prod-deploy
- **Feature-flag:** не требуется — UI-перекомпоновка, Ship-On (CLAUDE.md принцип 8). Флаг «на всякий случай» запрещён.
- **Prisma/ENV/AdminSetting:** изменений нет.
- **Prod-deploy:** **прод-операций нет** — только пересборка фронта (`docker compose up -d --build`). В `prod-deploy-log.md` новые шаги не добавляются (нет schema/scripts/ENV/очередей/эндпоинтов).

## DoD
- `bun run typecheck` (вкл. `.spec`), `bun run lint`, `bun run build` (frontend) — зелёные; `bun run test:unit` для затронутых файлов — зелёные.
- Все Acceptance фаз выполнены; грепы-маркеры подтверждены; визуальные предикаты сняты (Playwright — по подтверждению доступа).
- `second-brain/` обновлён по таблице производных заметок: `01_projects/frontend-pages.md` или профильная (новый паттерн «FAB-помощник + колокольчик + пикер»), `01_projects/frontend-contexts-hooks.md` (новый хук `useAssistantSignals`); `04_не-сделано/README.md` — строка про отложенную бэкенд-приватность клонов / полный мёрж, если всплывут.
- Рефлексия в `second-brain/05_история/`; коммиты по фазам; push по подтверждению.

## Итог
**Реализовано целиком (Ф1–Ф4).**
- **Ф1 — колокольчик = единый центр уведомлений:** `PendingActionsBell` сводит pending + proactive + срочный feed под единым счётчиком; новый хук `frontend/src/hooks/useAssistantSignals.ts` + чистые мапперы `frontend/src/domain/assistant-signals.ts` (`PROACTIVE_RULE_LABEL`/`PROACTIVE_RULE_ROUTE`/`FEED_TYPE_ROUTE`); каждое уведомление кликабельно через `actionUrl`, без сырых `latin_snake`.
- **Ф2 — яркий FAB + демонтаж:** вернулась видимая кнопка `ConciergeFloatingButton` (чат в 1 клик); `AssistantSidebar` **удалён**; пузырь Поддержки разведён в нижний левый угол; цель тура `welcome.concierge` на FAB.
- **Ф3 — пикер собеседника:** слим-вкладки «Помощник компании | Клоны ролей»; `ConciergeClonesTab` (`clonesApi.askRole`, citations, refused); ≤4 клонов + ссылка «Все клоны».
- **Ф4 — мобайл:** FAB поднят над таб-баром; колокольчик доступен в мобильной шапке.

**Прод-операций нет** — фронт-only, только пересборка фронта (`docker compose up -d --build`).
**Осталось (vNext, не блокирует):** бэкенд-приватность клонов single-incumbent (если протечёт — отдельный ТЗ в модуле clones); полный бэкенд-мёрж источников уведомлений в один провайдер; персональные pin клонов; согласование мобильного таба `/ask` с пикером.
</content>
</invoke>
