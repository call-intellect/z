---
type: tz
status: draft
feature: Таск-трекер Z/Кора — Фаза 2 — Frontend mobile-first + концьерж (плавающий значок + опц. Cmd+K) + чат-в-задаче + PWA
date: 2026-05-23
phase: 2 / 6
parent: plans/tz/2026-05-23-tracker-phase-1-models-api.md
---

# Фаза 2 трекера: Frontend mobile-first + концьерж + чат-в-задаче + PWA

## TL;DR

Все страницы трекера в нашем дизайне (dark-first + mint + Geist), **mobile-first** с первого пикселя. Universal `Cmd+K` (по-русски «Поиск / Создать / Перейти»). **Inline-создание задачи по Enter** — одно поле title. **Чат-в-задаче** встроен в каждый Issue через расширение `chat-v2`. **PWA** (Progressive Web App — прогрессивное веб-приложение) с push-уведомлениями. ~20 страниц. Срок: 7 человеко-недель.

## Зависимости

- **Фаза 1 трекера** — модели и API готовы.
- **chat-v2** — расширяется для чат-в-задаче.
- **LiveKit React Components** — для видеовстречи из задачи.
- **Tailwind + Radix UI + Geist + наша design-system** — уже есть.

## Структура страниц

### Основные страницы

```
/projects                              # список проектов (моих + публичных org)
/projects/new                          # создание (с выбором шаблона команды)
/projects/[slug]                       # дашборд проекта (выбор default view)
/projects/[slug]/board                 # канбан-доска
/projects/[slug]/list                  # список с сортировкой/фильтрами
/projects/[slug]/calendar              # календарь по dueDate
/projects/[slug]/gantt                 # Ганта (для timeTrackingEnabled проектов, opt-in)
/projects/[slug]/cycles                # циклы (недели)
/projects/[slug]/cycles/[cycleId]      # один цикл
/projects/[slug]/intake                # входящие задачи (для admin/manager)
/projects/[slug]/settings              # настройки проекта, члены, права

/issues/[id]                           # страница задачи (со встроенным чатом)
/me/inbox                              # мой инбокс — все мои задачи через все проекты
/me/dashboard                          # личный дашборд (мои задачи, чек-ины, вклад)

/feed                                  # единая лента активности (Activity Feeds)
/feed/spotlights                       # публичные «спасибо» (от Helpfulness Agent)
/feed/insights                         # публичная лента инсайтов
/feed/probe-questions                  # вопросы агентов

/team-templates                        # каталог шаблонов команд (для создания проекта)
/team-templates/[slug]                 # детали шаблона
```

### Admin-страницы (Фаза 2 only базовое)

```
/admin/projects                        # все проекты организации
/admin/webhooks                        # управление webhook'ами
/admin/team-templates                  # кастомные шаблоны команд (если нужны)
```

## Дизайн-принципы (12 правил из roadmap'а)

1. **One-field-when-possible.** Если форма ≥3 полей — сначала NL-поле + concierge fill-in.
2. **Dropdown >20 опций → typeahead** + AI top-3 suggestion.
3. **Никаких confirmation-модалок** для reversible (toast «Готово. [Отменить]» через Sonner).
4. **Никаких `window.confirm()` / `alert()`.**
5. **Каждая страница имеет `<ConciergeSlot context={...}>`** для Concierge Agent.
6. **Каждая мутация имеет agent-equivalent** через tool-use.
7. **Wizards запрещены** кроме onboarding.
8. **Auto-suggestion вместо required field** (owner/assignee/due-date pre-fill).
9. **Статус-машины имеют cron-агент**, предлагающий переходы.
10. **`/dashboard` показывает «что важно сейчас»**, а не «что произошло».
11. **Filters → NL-input first**, structured filters под «Расширенные».
12. **Каждая новая страница декларирует «что здесь автоматизировано»** в JSDoc.

## Mobile-first архитектура

### Точки кода

- **Tailwind responsive prefix**: `sm:` `md:` `lg:` `xl:` `2xl:` — каждая страница рассчитана сначала на 320px ширину.
- **Bottom navigation** на мобильном (≤md):
  - Иконки: Инбокс / Проекты / Лента / Чек-ин / Профиль
  - Высота 60px, активный с акцентом mint.
- **Pull-to-refresh** на главных списках.
- **Swipe-actions** на карточках задач: свайп влево — пометить выполненной, свайп вправо — отложить.
- **FAB (Floating Action Button)** на мобильном — «+ Задача» внизу справа, открывает inline-форму.

### Адаптация компонентов

- **Каждый компонент в `frontend/src/ui/`** имеет `mobile` и `desktop` вариант (через Tailwind).
- **Не используем тяжёлые модалки** — drawer (выезжающая снизу панель) для мобилки.
- **Карточка задачи на мобиле** — одна строка с приоритетом, заголовком, исполнителем (avatar), сроком. Тап — открывает страницу задачи.

## PWA (Progressive Web App)

### Manifest (`/manifest.json`)

```json
{
  "name": "Z/Кора",
  "short_name": "Кора",
  "theme_color": "#5EEAD4",
  "background_color": "#0F1115",
  "display": "standalone",
  "start_url": "/me/dashboard",
  "icons": [...]
}
```

### Service Worker (`/sw.js`)

- **Cache-first** для статики (CSS/JS/иконок).
- **Network-first с fallback на cache** для API GET-запросов.
- **Offline-режим**: кэш последних 50 задач (`/me/inbox`).

### Web Push (push-уведомления через браузер)

- При логине — запрос на подписку (мягкий, после первого взаимодействия).
- Сервер: новый сервис `modules/push/web-push.service.ts` через web-push SDK + VAPID-ключи (новые ENV).
- События: новая задача / упоминание / ответ агента / спотлайт.

## Концьерж: «Поиск / Создать / Перейти»

### Главный вход — плавающий значок «Кора-помощник»

ЦА трекера — не разработчики (прорабы, менеджеры объектов, владельцы стройки/розницы), keyboard shortcuts они не запоминают. Mobile-first продукт → главный способ управления должен быть **виден физически** на каждой странице, а не за сочетанием клавиш.

Открывается:
- **На мобиле** — иконка «Кора-помощник» в bottom navigation (рядом с «Главная», «Доска», «Я»). Это **основной канал**.
- **На десктопе** — плавающий значок в правом нижнем углу. Альтернативно — иконка «лупа+плюс» в шапке.
- **Опционально, для desktop power-users** — `Cmd+K` (Mac) / `Ctrl+K` (Win/Linux). Не обязательная часть UX, не блокирует MVP. Существующая глобальная палитра из Cards остаётся как был — глобальный поиск.

### Что внутри

- **Поле ввода** на естественном языке: «Создай задачу для Иванова на завтра по объекту Тверская»
- **AI-парсинг** через `concierge-parse` LlmTaskType:
  - Извлекает: тип действия (create/find/navigate/assign), сущности (люди, проекты, даты)
  - Возвращает structured-команду для исполнения
- **Live-результаты при вводе**: поиск по проектам / задачам / людям / документам через `/api/v1/search`
- **Quick actions** (без AI): «+ Проект», «+ Задача», «+ Встреча», «Чек-ин», «Мой инбокс», «Дашборд»
- **Голосовой ввод** — кнопка «зажми, чтобы говорить» в панели; на мобиле — отдельная кнопка микрофона. Это основной канал для тех, кто на объекте.

### LlmTaskType `concierge-parse`

- Primary: DeepSeek (capable)
- Secondary: OpenAI gpt-4o-mini
- Tertiary: Ollama qwen3.5:9b

### UI

- На мобиле — fullscreen sheet, открывается тапом по значку в bottom nav.
- На десктопе — боковая панель справа, **остаётся открытой** при переходах по страницам (продолжение разговора без потери контекста).
- Модальное окно по Cmd+K (опц., desktop) — то же поле ввода, ≤600px ширина, backdrop blur, focus-trap, ESC закрывает.

### Также: кнопки «Создать» — на местах

Концьерж не заменяет кнопки. На каждой странице остаются обычные явные CTA: FAB «+ Задача» на мобиле, кнопки «+ Проект», «+ Задача», «+ Встреча» в шапках разделов на десктопе. Концьерж — параллельный канал для тех, кому удобнее сказать словами.

## Чат-в-задаче

### Архитектура: поверх chat-v2, не отдельный модуль

**Решение принято в Фазе 1:** расширяем `ChatV2Conversation` полем `attachedToIssueId String?`, создаём для каждой Issue по conversation при первом сообщении.

### Frontend компонент `<IssueChat issueId={id} />`

- Лежит в `/issues/[id]` ниже описания.
- Сообщения в обратном хронологическом порядке (новые внизу, как в Telegram).
- **Поддержка голосовых сообщений:**
  - Кнопка «микрофон» — запись.
  - При отпускании — отправка voice blob на `/api/v1/issues/:id/comments` с `voiceUrl` + `voiceDuration`.
  - Async transcription через ASR (Vox/GigaAM) — заполняет `voiceTranscript`.
  - В чате видна аудиоволна с play/pause + автоматически развёрнутый транскрипт.
- **Упоминания через `@`:** typeahead, выбираешь — отправляется уведомление.
- **Прикреплённые файлы:** drag-n-drop + кнопка скрепки.
- **Реакции:** click-and-hold на сообщение → `thanks`, `like`, `pin`.
- **Realtime через WebSocket:** канал `tracker:issue:${id}`, события `comment.created/updated/deleted`.

### Голосовые и AI

- Голосовое → ASR (`asr-transcribe` LlmTaskType — уже есть) → текст в `voiceTranscript`.
- AI-помощник может **извлечь action items** из обсуждения (`issue-actions-extract` — детально в Фазе 3).

## Inline-создание задачи

### Где появляется

- В каждом столбце канбан-доски — внизу — поле «+ Задача» с placeholder «Введите название задачи».
- Enter — создаёт с smart defaults (статус = первый в колонке, assignee = я, dueDate = null).
- Tab — переходит к следующему полю (опц. description).
- Shift+Enter — открывает расширенную форму (drawer справа).

### AI-парсинг при вводе

После Enter, если в тексте есть структурные подсказки (имя, дата, проект — определяется регуляркой или быстрой LLM), показывается toast «Распарсил: исполнитель Иванов, срок завтра. Подтвердить?»

## Smart defaults

При создании задачи:
- `stateId` = первый state в колонке (или default state проекта)
- `assignees` = текущий пользователь
- `priority` = `none`
- `dueDate` = null
- `projectId` = текущий проект (из контекста страницы)
- `goalId` = AI-suggest из `issue-goal-suggest` (если confidence ≥ 0.7)

## Auto-rollover незакрытого

При закрытии цикла (`POST /cycles/:id/complete`):
- Все Issue с `cycleId = currentCycle` и `state.category != 'completed'` → переносятся в следующий цикл (`Cycle.next`)
- Toast: «N задач перенесено в следующий цикл»
- В activity ставится отметка «moved_from_cycle:X»

## Видеовстреча из задачи

### UX

- Кнопка «🎥 Видеовстреча» на странице задачи (top bar).
- Tap → backend `POST /issues/:id/start-meeting`:
  - Создаёт Meeting с `linkedIssueId = id`, `type = 'task_discussion'` (новый тип в `MeetingType` enum)
  - Генерирует LiveKit JWT, возвращает room URL
- Открывается наш существующий компонент `<LivekitMeetingRoom>` в новой странице `/m/[meetingId]`
- После завершения встречи — AI-отчёт привязывается к задаче через event `meeting.completed` → `Issue.linkedMeetingIds.push(meetingId)` + комментарий в чат задачи: «🎥 Состоялась видеовстреча. AI-отчёт: [ссылка]»

## Лента в дашбордах

### `/me/dashboard` (для рядового сотрудника)

Виджеты сверху вниз:
1. **Что важно сегодня** — приоритетные задачи + неответенные probe-вопросы
2. **Мой вклад** (`<MyContributionsWidget>`) — компактный
3. **Утренний/вечерний чек-ин кнопка** (если не сделан)
4. **Лента публичных спотлайтов** (последние 5)
5. **Мои упоминания и комментарии**

### `/projects/[slug]` (дашборд проекта)

1. Прогресс активного цикла (snapshot)
2. Doska с переключателем view
3. Лента активности проекта (issues + comments + cycle events)
4. Связанные с проектом цели + alignment

## Локализация

- **Все строки на русском.** Никаких английских терминов (по правилу `admin_ui_russian_only`).
- Словарь терминов:
  - Issue → «Задача»
  - Project → «Проект»
  - Cycle → «Неделя» (или «Цикл» по выбору проекта)
  - Cycle.complete → «Закрыть неделю»
  - Status / State → «Статус»
  - Backlog → «Бэклог» (термин устоялся, оставляем) или «Очередь» для не-IT шаблонов
  - In Progress → «В работе»
  - Done → «Готово»
  - Cancelled → «Отменено»
  - Assignee → «Исполнитель»
  - Priority → «Приоритет»
  - Due Date → «Срок»
  - Description → «Описание»
  - Comment → «Комментарий»
  - Attachment → «Файл»
  - Label → «Метка»
  - Relation → «Связь»
  - Intake → «Входящие»
  - Webhook → «Авто-уведомление другой системе»

- **Даты:** `DD.MM.YYYY`
- **Валюта:** `₽` первый, пробел-разделитель тысяч
- **Телефоны:** `+7 (XXX) XXX-XX-XX`

## Frontend модули

```
frontend/src/
  api/
    projects.api.ts             # ApiDto → DomainModel
    issues.api.ts
    cycles.api.ts
    intake.api.ts
    team-templates.api.ts
  domain/
    project.ts                  # DomainModel + мапперы
    issue.ts
    cycle.ts
    intake.ts
  ui/
    Board/                      # канбан-компонент
    IssueCard/
    IssueDetail/
    IssueChat/                  # чат-в-задаче
    ConciergeFloatingButton/    # плавающий значок «Кора-помощник» — главный вход
    ConciergeSheet/             # mobile fullscreen sheet + desktop боковая панель
    CommandPalette/             # опц. Cmd+K модал для desktop power-users
    QuickAdd/                   # inline-создание
    ActivityFeedWidget/         # из Activity Feeds sub-ТЗ
    SpotlightsFeedWidget/       # из Helpfulness
  hooks/
    useIssues.ts                # SWR
    useCycles.ts
    useCommandPalette.ts        # global state
    usePwaInstall.ts
    usePushNotifications.ts
  contexts/
    CommandPaletteProvider.tsx
app/
  (authenticated)/
    projects/                   # все страницы
    issues/
    me/
    feed/
    team-templates/
```

## RBAC на frontend

- На каждой странице — проверка через `useEntitlement(resource, action)`.
- Если нет прав — fallback на `<NoAccess message="..." />` с понятной формулировкой.
- Скрытие кнопок (например, «Создать проект») если нет права `project.create`.

## DoD

- [ ] Все ~20 страниц созданы, открываются, проходят typecheck/lint/build (`bun run typecheck` + `bun run lint` + `bun run build`)
- [ ] Mobile-first: все страницы корректно отображаются на ширине 320px-2560px
- [ ] Bottom navigation работает на ≤md
- [ ] FAB «+ Задача» работает на мобиле
- [ ] Swipe-actions на карточках задач (mark_done / snooze)
- [ ] Плавающий значок «Кора-помощник» виден на каждой странице (desktop) + вкладка в bottom nav (mobile), AI-парсинг через `concierge-parse` LLM
- [ ] _(опц.)_ Cmd+K (Ctrl+K) на десктопе открывает то же окно — не блокирует MVP
- [ ] Inline-создание задачи по Enter в столбце доски + AI-парсинг даты/исполнителя
- [ ] Чат-в-задаче работает: текст + голос (с ASR) + упоминания + файлы + WebSocket realtime
- [ ] Видеовстреча из задачи: кнопка → LiveKit-комната → после AI-отчёт в чате задачи
- [ ] PWA manifest + service worker + offline-кэш + web push установлены
- [ ] Все строки на русском, без английских терминов
- [ ] Виджеты лент встроены на ключевых дашбордах
- [ ] Все мутации — без модалок, через inline / drawer / toast с отменой
- [ ] E2E-тесты (Playwright): создание проекта, создание задачи, чат, видеовстреча, концьерж через плавающий значок

## Срок

**7 человеко-недель** (frontend разработчик + дизайнер 0.3 для адаптаций).

## Следующая фаза

[Фаза 3: AI-фичи](2026-05-23-tracker-phase-3-ai-features.md)

---

_2026-05-23: фронтенд трекера mobile-first, чат-в-задаче, концьерж (плавающий значок + опц. Cmd+K), PWA._
