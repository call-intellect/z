---
date: 2026-05-27
topic: исправление контраста в светлой теме
tags: [ui, frontend, a11y, theme]
distilled: false
---

# Рефлексия — fix light theme contrast

## Что было поставлено

Пользователь прислал скриншот с проблемой: на странице "Идеи" Concierge-панель с белым текстом на белом фоне. Попросил "проверить все страницы интерфейса. Вот когда мы с белым на белом текстом светлое: также пройтись, в общем, просмотреть интерфейс и сочетание текста и фона. Запусти несколько агентов, поищите, найдите такие баги."

## Как решал

**Шаг 1 — Сбор данных через параллельных Explore-агентов:**
Запустил 3 агента одновременно:
1. Поиск по light-theme контрасту в общих компонентах (Tailwind text-white, slate-классы, CSS-переменные)
2. Поиск на auth-страницах (login/signup/forgot/reset/share)
3. Поиск в навигации (Header/Sidebar/OrgSwitcher)

Каждый агент вернул конкретные file:line + описание проблемы.

**Шаг 2 — Три волны исправлений:**

*Волна 1 (15 файлов)* — навигация + meeting-room (dark-only компоненты):
- Sidebar активный пункт: `text-accent` → `text-accent-fg`
- Sidebar badge: `text-bg-base` → `text-accent-fg`
- OrgSwitcher dropdown: `text-accent` → `text-accent-fg`
- Input placeholder: `text-fg-tertiary` → `text-fg-secondary dark:text-fg-tertiary`
- ParticipantsPanel: `bg-slate-900 text-slate-100` → `bg-bg-elevated text-fg-primary`
- ControlsBar: hex `#1a1a2e` → `bg-bg-elevated`; `text-white` → `text-fg-primary/text-danger-fg`
- MeetingRoom: hex `#0d0d1a` → `bg-bg-base`
- RecordingIndicator/RaiseHandButton/Button danger: `text-white` → `text-danger-fg`/`text-warning-fg`
- ShareMeetingClient chapter numbers: `text-accent` (на bg-accent-muted) → `text-accent-fg`

*Волна 2 (7 файлов)* — оставшиеся `text-white`:
- ChatV2Client, InsightsListClient, MyCheckInsClient, MyPromisesClient, PersonDetailClient, MeetingsAdminSettingsClient, RevokeGrantDialog (variant="danger"→"destructive")

*Волна 3 (sed массовая замена, ~30 файлов)* — все `text-accent` на `bg-accent-muted`:
- admin/* (AdminShell, analytics, projects, webhooks)
- integrations/* (Bitrix24, YandexTracker)
- settings/* (SettingsSidebar, billing, sources)
- home, public privacy/terms, leak-shared

**Шаг 3 — Конфиг:**
В `frontend/tailwind.config.ts` добавил маппинги:
- `success-fg`, `warning-fg`, `danger-fg`, `info-fg` → `var(--chip-*-fg)`

(без них `text-danger-fg` и т.п. не работают в Tailwind, только `text-chip-danger-fg`)

## Что вышло

- 3 коммита, ~50 файлов изменено
- `bun run typecheck` — OK
- `bun run lint` — OK
- Visual проверка не выполнена (не было браузера в окружении, MCP playwright отключился)
- Коммиты в origin/dev (видимо запушились через post-push-reflection хук параллельной сессии)

## Чему научился

### Главное правило цветовых токенов в Z

Дизайн-система имеет двойную пару для статус-цветов: фон + контрастный текст. Использовать их **в паре**:

| Фон | Текст |
|---|---|
| `bg-accent` | `text-accent-fg` |
| `bg-accent-muted` | `text-accent-fg` (НЕ text-accent!) |
| `bg-danger` | `text-danger-fg` |
| `bg-warning` | `text-warning-fg` |
| `bg-success` | `text-success-fg` |
| `bg-info` | `text-info-fg` |

`text-white` на цветном фоне — **антипаттерн**, потому что в светлой теме `bg-accent` это светлый sage `oklch(0.62 0.07 155)`, на котором белый текст невидим.

### Антипаттерны которые встретились

1. **Жёсткие hex** `bg-[#1a1a2e]` — работают только в dark-теме. Заменять на `bg-bg-elevated`/`bg-bg-card`/`bg-bg-base`.
2. **Tailwind slate-палитра** (`bg-slate-900`, `text-slate-100`, `border-slate-700`) — не адаптируется к теме. Заменять на CSS-переменные.
3. **`text-white` на цветных фонах** — всегда заменять на `text-{color}-fg`.
4. **Tailwind конфиг без `-fg` маппинга** для status-цветов — даже если CSS-переменная `--chip-danger-fg` есть, Tailwind не сгенерит класс `text-danger-fg` без явного объявления.

### Процессный урок

3 параллельных Explore-агента собрали полный список багов за один проход быстрее, чем последовательная грепка. Каждый агент специализировался на своём слое (общие компоненты / auth / навигация) — пересечений почти не было. Это эффективный паттерн для аудита больших кодовых баз.

### Опасность массовой замены через sed

В волне 3 использовал sed для замены `text-accent'` → `text-accent-fg'` во всех файлах с `bg-accent-muted`. Это сработало корректно, но:
- Замена была без контекста (можно было поломать места где `text-accent` нужен на других фонах)
- typecheck + lint спасли (нет ошибок)
- Лучше было бы добавить ESLint-правило, запрещающее `text-accent` на `bg-accent-muted` — тогда такие баги ловились бы автоматически на CI

## Prod-операции

**Нет** — это чисто фронтенд-стилизация (Tailwind классы), без миграций, ENV, seed/patch скриптов.

`docs/operations/prod-deploy-log.md` обновлять не нужно — push требует только пересборки фронтенда (стандартный `bun run build` в CI).
