# Анализ и план: обновление пользовательской Wiki (docs/user-guide)

**Дата:** 2026-05-28
**Статус:** реализован (2026-05-28)

---

## 1. Текущее состояние

### Что есть
Директория `docs/user-guide/` — 13 файлов пользовательской документации:

| # | Файл | Содержание | Статус |
|---|---|---|---|
| — | `index.md` | Главная + карта из 12 разделов | ⚠️ устарела карта |
| 00 | `00-navigation.md` | Карта кабинета — 6 слоёв Sidebar | ⚠️ частично устарел |
| 01 | `01-quick-start.md` | Быстрый старт, 6 шагов | ⚠️ не учитывает новый онбординг |
| 02 | `02-meetings.md` | Встречи, 9 типов | ✅ в целом актуален, мелкие дополнения |
| 03 | `03-knowledge-and-cards.md` | Знания и карточки | ✅ актуален |
| 04 | `04-channels.md` | Каналы общения | ✅ актуален |
| 05 | `05-concierge.md` | Концьерж-помощник | ⚠️ не упоминает Chat v2 |
| 06 | `06-roles-and-cabinet.md` | Роли и кабинет | ⚠️ устарела карта разделов |
| 07 | `07-knowledge-clone-and-skill.md` | Клон сотрудника и Skill-профиль | ⚠️ не отражает маркетплейс клонов |
| 08 | `08-dashboards.md` | Дашборды | ⚠️ не хватает daily/weekly/feed |
| 09 | `09-admin-and-economics.md` | Админка и экономика | ⚠️ не хватает новых настроек |
| 10 | `10-faq-and-troubleshooting.md` | FAQ | ⚠️ не хватает новых вопросов |
| 11 | `11-glossary.md` | Глоссарий | ⚠️ не хватает терминов новых фич |
| 12 | `12-super-admin-panel.md` | Z-Admin панель оператора | ⚠️ частично актуален |

### Стиль написания (сохраняем)
- Язык — русский, живой, без канцелярита.
- Структура каждого файла: «Что Кора делает за вас» / «Что вы делаете сами» / разделы / «Что попробовать» / «Что нельзя» / «Что дальше».
- Frontmatter: `title`, `audience`, `reading_time`.
- Таблицы для сравнений и сводок.
- Финальная строка: «Не нашли что искали? Нажмите на значок Коры справа внизу…»
- Перекрёстные ссылки `./XX-name.md`.

---

## 2. Что изменилось в продукте (gap-анализ)

### 2.1. Новые разделы Sidebar (добавлены после написания wiki)

| Пункт Sidebar | URL | Появился | В wiki отражён? |
|---|---|---|---|
| **Спринты** | `/sprints` | 2026-05-27 | ❌ нет |
| **Лента (Feed)** | `/feed`, `/feed/spotlights`, `/feed/insights`, `/feed/probe-questions` | 2026-05-25 | ❌ нет |
| **Люди (Persons)** | `/persons/[id]` | ранее | ❌ нет отдельного раздела |
| **Chat v2** | `/chat-v2` | 2026-05-25 | ❌ нет |
| **Куратор** | `/curation` | ранее | ❌ нет отдельного раздела |
| **Мой вклад (Recognition)** | `/me/contributions` | 2026-05-25 | ⚠️ кратко в 00-nav |
| **Мой вклад в команду (Helpfulness)** | `/me/social-contribution` | 2026-05-25 | ⚠️ кратко в 00-nav |
| **Мои обещания (Promise Keeper)** | `/me/promises` | 2026-05-25 | ⚠️ кратко в 00-nav |
| **Ваши предложения (Feedback)** | `/feedback` | 2026-05-25 | ⚠️ кратко в 00-nav |
| **Ежедневный отчёт** | `/dashboard/operations/daily` | 2026-05-25 | ⚠️ кратко в 00-nav |
| **Недельная сводка** | `/dashboard/operations/weekly` | 2026-05-25 | ⚠️ кратко в 00-nav |
| **Голос бренда** | `/brand-voice` | ранее | ⚠️ кратко в 00-nav |
| **Эксперименты** | `/experiments` | ранее | ⚠️ кратко в 00-nav |

### 2.2. Новые фичи, не описанные в wiki

| Фича | Код-имя / ТЗ | Что делает |
|---|---|---|
| **Onboarding wizard** | 6 шагов welcome + 5 шагов company + change-password | Пошаговый мастер для новых пользователей |
| **Проекты/Трекер** | `/projects`, `/issues`, полный tracker | Канбан, список, календарь, Гант, циклы, workload, intake, настройки проекта, email-inbox |
| **Спринты** | `/sprints`, `/sprints/[id]`, `/sprints/[id]/review` | Sprint CRUD, scope (6 вариантов), AI-подсказки, финальный отчёт, SprintCreateWizard |
| **Лента активности** | `/feed`, `/feed/spotlights`, `/feed/insights`, `/feed/probe-questions` | Activity feed, spotlights с T1/T2 виджетами, инсайты, probe-вопросы |
| **Маркетплейс клонов** | `/clones` | Список ролевых клонов, чат с клоном, запрос доступа, CloneAccessGrant |
| **Admin — доступы к клонам** | `/admin/clones` | CRUD грантов CloneAccessGrant |
| **Feedback с AI-кластеризацией** | `/feedback`, `/admin/feedback` | Форма предложений + AI-группировка по темам |
| **Recognition (T1)** | `/me/contributions`, `/persons/[id]/contributions` | 5 типов вкладов, виджеты |
| **Helpfulness (T2)** | `/me/social-contribution`, `/admin/helpfulness-overview` | Социальный профиль, team-map |
| **Promise Keeper (β-8.2)** | `/me/promises` | Личные обещания, действия «Сделано / Не сделано / Отменить» |
| **COO-панель расширения** | β-8.1/β-8.3 | TeamTemperature, CauseCategoryMap, Maturity, DailyDigest, WeeklyDigest |
| **Email-to-task (T5)** | настройки проекта | Email-inbox alias для создания задач по email |
| **Chat v2** | `/chat-v2` | Master-detail AI-чат с deep-link |
| **Quality Score** | встречи | Оценка качества встречи + behavior metrics |
| **Design tokens / темы** | OKLCH, light/dark | Новая дизайн-система |
| **Onboarding tour** | data-tour-target | Welcome tour по sidebar-пунктам |
| **Settings (расширенные)** | 14 subsections | organization, sources, webhooks, notifications, billing, api, exports, retention, tags, curation |
| **Settings/Admin (расширенные)** | 7 subsections | members, meetings, sources, usage, memory-access, knowledge-core |

### 2.3. Новые страницы суперадминки (не в wiki)

~90+ admin-страниц, сгруппированных по разделам:
- AI и модели (routing, catalog, prompts, experiments, knowledge-core, embeddings, signal-type-monitor, preference-dataset, skill-trait-concepts)
- Аналитика (concierge, economics, functions, knowledge, meetings, orgs)
- Тенанты (orgs, plans, entitlements, economics/orgs)
- Контент (copy, emails, global-channels, meeting-types, system-messages)
- Каналы и интеграции (bots, keys, livekit, webhooks)
- Записи и медиа (meetings, expiring, retention, storage)
- Платформа (crons, flags, limits, maintenance, security, workers)
- Обратная связь (feedback с AI-кластеризацией)
- Здоровье и инциденты (health, incidents)

### 2.4. Устаревшие описания

| В wiki | Что в коде сейчас |
|---|---|
| `06-roles-and-cabinet.md` — «Группа Компания / Оперативка / Настройки» (3 группы) | Sidebar имеет **6 смысловых слоёв** (ТЗ 2026-05-27) |
| `06-roles-and-cabinet.md` — `/operations` как URL | URL — `/dashboard/operations` |
| `07-knowledge-clone-and-skill.md` — `/me/clone` как страница | `/me/clone` — legacy redirect. Клоны — через маркетплейс `/clones` |
| `00-navigation.md` — нет Спринтов, Людей, Ленты, Куратора | Все эти разделы есть |
| `09-admin-and-economics.md` — URL `/admin/llm/prices` | URL — `/admin/llm-prices` |
| `09-admin-and-economics.md` — URL `/admin/llm/task-routes` | URL — `/admin/llm-routes` |

---

## 3. План работ

### Принципы
- Сохраняем стиль написания (живой русский, «Что Кора делает / Что вы делаете», таблицы, перекрёстные ссылки).
- Каждый файл — самодостаточный, с frontmatter.
- Имена файлов: `NN-slug.md` с двумя цифрами для порядка.
- Все URL — актуальные из Sidebar.tsx и page.tsx.

### 3.1. Обновить существующие 13 файлов

| # | Файл | Что менять |
|---|---|---|
| 1 | `index.md` | Новая карта из **20 разделов** (добавить 13-19). Обновлённые описания. |
| 2 | `00-navigation.md` | Добавить: Спринты (в «Каждый день»), Лента (между «Моё» и «Памятью» или в «Каждый день»), Люди/Коллеги (в «Справочник»), Chat v2. Обновить Настройки (14 subsections). Добавить Admin-подгруппу подробнее. |
| 3 | `01-quick-start.md` | Новый онбординг wizard (6 шагов welcome + 5 шагов company). Новые разделы для «что попробовать»: Спринты, Лента, Трекер. |
| 4 | `02-meetings.md` | Добавить: Quality Score (оценка качества встречи), Behavior Metrics (поведение на встрече), Meeting Result v2 (новая страница результата). |
| 5 | `03-knowledge-and-cards.md` | Мелкие правки: добавить упоминание о Curation (курация). Ссылка на новый 19-curation.md. |
| 6 | `04-channels.md` | Мелкие правки: актуализация. |
| 7 | `05-concierge.md` | Добавить: Chat v2 как отдельная точка входа, Command Palette (Cmd+K). |
| 8 | `06-roles-and-cabinet.md` | **Полная переработка карты разделов** — 6 слоёв вместо 3 групп. Новые разделы: Спринты, Лента, Куратор, Chat v2. Обновлённая таблица прав. |
| 9 | `07-knowledge-clone-and-skill.md` | **Значительное обновление**: маркетплейс клонов `/clones`, чат с клоном, CloneAccessGrant, запрос доступа. Убрать `/me/clone` (legacy). |
| 10 | `08-dashboards.md` | Добавить: ежедневный отчёт (`/dashboard/operations/daily`), недельная сводка (`/dashboard/operations/weekly`), новые виджеты (TeamTemperature, CauseCategoryMap, Maturity, обещания). Лента активности как дашборд-элемент. |
| 11 | `09-admin-and-economics.md` | Актуализировать URL. Добавить новые admin-страницы: AI routing, prompts, experiments, feedback, helpfulness-overview, clones admin. Расширенные Settings (14 subsections + 7 admin subsections). |
| 12 | `10-faq-and-troubleshooting.md` | Добавить FAQ по: Спринтам, Трекеру, Клонам (маркетплейс), Ленте, Онбордингу, Email-to-task, Recognition/Helpfulness. |
| 13 | `11-glossary.md` | Добавить ~30 новых терминов: Sprint, Cycle, Board, Issue, Intake, Clone Access Grant, Recognition, Helpfulness, Promise Keeper, TeamTemperature, CauseCategory, Spotlight, Probe Question, Feed, Onboarding Tour, Feature Flag, Quality Score, Behavior Metrics, etc. |
| 14 | `12-super-admin-panel.md` | Обновить структуру admin-панели по фактическим ~90+ страницам. Добавить разделы: аналитика (7 подразделов), AI/модели (10 подразделов), тенанты, контент, интеграции, медиа, платформа. |

### 3.2. Создать 7 новых файлов

| # | Файл | Тема | Кому |
|---|---|---|---|
| 15 | `13-sprints.md` | **Спринты** — создание, дашборд, scope (6 вариантов), AI-подсказки, финальный отчёт, SprintCreateWizard. | всем |
| 16 | `14-projects-tracker.md` | **Проекты и трекер** — проекты, доски, задачи, циклы, бэклог, календарь, Гант, workload, intake, email-to-task, документы проекта. | всем |
| 17 | `15-feed.md` | **Лента активности** — Feed, Spotlights (T1/T2 виджеты), Insights в ленте, Probe-вопросы. | всем |
| 18 | `16-people.md` | **Люди и коллеги** — карточка человека, вклад (Recognition), соц. профиль (Helpfulness), профиль знаний, назначения. | всем |
| 19 | `17-onboarding.md` | **Онбординг** — welcome wizard (6 шагов), company wizard (5 шагов), смена пароля, tour по sidebar. | всем (новым) |
| 20 | `18-chat-v2.md` | **AI-чат v2** — master-detail чат с памятью компании, deep-link, история, источники. Отличие от консьержа. | всем |
| 21 | `19-curation.md` | **Куратор** — кураторская очередь, проверка карточек, подтверждение/отклонение, объединение дублей. | curator/owner/admin |

### 3.3. Порядок работ

Работы выполняются последовательно, начиная с index (карта документов задаёт структуру для остальных).

**Фаза 1 — Каркас:**
1. `index.md` — новая карта из 20 разделов
2. `00-navigation.md` — полная актуализация Sidebar

**Фаза 2 — Ключевые обновления:**
3. `06-roles-and-cabinet.md` — 6 слоёв, новые разделы
4. `07-knowledge-clone-and-skill.md` — маркетплейс клонов
5. `08-dashboards.md` — daily/weekly/новые виджеты

**Фаза 3 — Новые разделы:**
6. `13-sprints.md`
7. `14-projects-tracker.md`
8. `15-feed.md`
9. `16-people.md`
10. `17-onboarding.md`
11. `18-chat-v2.md`
12. `19-curation.md`

**Фаза 4 — Остальные обновления:**
13. `01-quick-start.md`
14. `02-meetings.md`
15. `03-knowledge-and-cards.md`
16. `04-channels.md`
17. `05-concierge.md`
18. `09-admin-and-economics.md`
19. `10-faq-and-troubleshooting.md`
20. `11-glossary.md`
21. `12-super-admin-panel.md`

---

## 4. Источники данных (откуда брать факты)

| Что | Источник |
|---|---|
| Sidebar (6 слоёв, все пункты) | `frontend/src/ui/components/app-shell/Sidebar.tsx` (972 строки) |
| Все page.tsx (маршруты) | `frontend/app/(authenticated)/**/page.tsx` (~218 файлов) |
| Реестр страниц | `second-brain/01_projects/frontend-pages.md` |
| Admin-страницы | `frontend/app/(authenticated)/admin/**` + `12-super-admin-panel.md` |
| Settings subsections | `frontend/app/(authenticated)/settings/SettingsSidebar.tsx` |
| Nav-help словарь | `frontend/src/lib/nav-help.ts` |
| Типы встреч | `second-brain/01_projects/ai-analysis-by-type.md` |
| Архитектура | `second-brain/02_architecture/` |
| Планы/ТЗ | `plans/tz/` |

---

## 5. Оценка

- **Обновить:** 13 файлов (от мелких правок до полной переработки карты разделов).
- **Создать:** 7 новых файлов.
- **Итого:** 20 файлов в `docs/user-guide/`.
