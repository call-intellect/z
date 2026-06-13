# ТЗ — Редизайн кабинета Коры: ритмы, очередь решений, новое меню

**Дата:** 2026-06-13
**Статус:** ready-to-implement (фазы Ф0–Ф10)
**Основание:** аудит `plans/analysis/2026-06-12-product-audit-cabinet-ui-dashboards.md` + архитектура `plans/analysis/2026-06-13-cabinet-redesign-architecture.md` + прототипы `plans/analysis/2026-06-13-cabinet-redesign-prototypes/` (10 экранов + мобилка, проверены в браузере).
**Что меняем:** структуру меню (30→8 пунктов владельцу / →5 рядовому), 6 дашбордных поверхностей → 3 ритма (Сегодня/Неделя/Месяц), 4 очереди долгов → 1 очередь решений «Требует вас», 8 пунктов «Память» → 3 входа; добавляем 4 строительных блока. Визуальный язык — утверждённый `modern/` (стекло/градиент/объём).

> **Дано владельцем:** прод-баги (`dashboard/director` 500, `/decisions/<id>` 404, сырой markdown) **уже починены** — это ТЗ про архитектуру/UX, не багфикс.

---

## 0. Инварианты (из §0 архитектуры — не нарушать)

Только русский UI · никаких денег/₽/финансовых KPI · никаких рейтингов людей (фраза-действие вместо score) · никаких inline-кнопок в уточняющих вопросах (текст/голос) · push-recap — носитель пользы, экран — drill-down · 1 сводка/день + немедленно только urgent · парные цветовые токены (без text-white/hex/slate) · Ship-On (ON+kill-switch) · мобилка = быстрый взгляд по роли · дозированность топ-5/топ-5 · кабинет «Я» self-тон без HR-блоков.

**Три класса-болезни, которые архитектура закрывает структурно:**
- **Б-2** один источник правды на показатель + автотест-инвариант «число на Сегодня == число в разделе».
- **Б-3** каждая производная метрика фильтрует только полные сущности (обещание = кто+что+срок).
- **Б-6** три состояния виджета: данные / нет данных (`—`+причина+CTA) / сбой (плашка «чиним», без чисел).

---

## Развилки для владельца (решены, при несогласии — правьте)

| Р | Решение | Обоснование |
|---|---|---|
| Р1 | Операции-пульс (`/dashboard/operations`) → вкладка «Пульс сейчас» внутри **Неделя** | читается на планёрке = недельный ритуал; отдельный пункт дублировал бы Неделю |
| Р2 | «Итоги месяца» — только owner; coo видит Сегодня+Неделя | месяц = board pack собственнику |
| Р3 | Daily-digest встроить в Сегодня, путь `/dashboard/operations/daily` **сохранить** (redirect) | cron пушит всем участникам — удаление = битые пуши |
| Р4 | Карточки → переименовать «Клиенты и сделки», вид внутри Встреч | CRM встреч ближе к встречам |
| Р5 | Планирование встреч (scheduledAt) — через Event kind=meeting, модель Meeting не трогаем | меньше риск |
| Р6 | Светлая тема — НЕ в scope (владелец задизайнит сам) | redesign Р |
| Р7 | Групповые действия в `/actions` по типу — да; в каналах «пачкой» — нет (В7) | в кабинете очередь решений — главный крючок |

---

## Ф0. Фундамент: единый nav-конфиг, redirects, чистка заглушек

**Цель:** одна точка правды о меню для десктопа и мобилки; убрать заглушки из прода; не сломать deep-link-и бэка.

**Файлы:**
- Новый `frontend/src/ui/components/app-shell/nav-config.ts` — декларативный конфиг (секция→роль→пункт→роут→бейдж), потребляется и `Sidebar.tsx`, и `mobile-tabs.ts` (закрывает nav-долг `04_не-сделано:47`).
- `Sidebar.tsx:210-498` — переписать на чтение `nav-config.ts` (сейчас 8 групп захардкожены).
- `mobile-tabs.ts:49-89` — EXEC/MANAGER табы из того же конфига.
- `nav-subset.spec.ts` — обновить под единый конфиг (инвариант mobile⊆desktop сохранить).
- `frontend/proxy.ts:19` — добавить новые префиксы `/week`, `/month` в PROTECTED_PREFIXES.

**Новое меню (точно — §1.1 архитектуры):**
```
owner/admin:  Ритмы(Сегодня/Неделя/Итоги месяца) · Работа(Встречи/Задачи/Память/Команда) · Личное(Я) · Система(Настройки)
coo:          то же без «Итоги месяца»
member:       Моё(Сегодня=/me) · Работа(Встречи/Задачи/Спросить/Мои дела) · Система
```

**Redirects (Next, добавить в `next.config.mjs` или серверные redirect-страницы):**
| Старый | Новый |
|---|---|
| `/dashboard/operations/weekly` | `/week` (cron deep-link `weekly-digest.cron:184`) |
| `/dashboard/value-recap` | `/month` (чинит битый `value-recap.cron:165`) |
| `/dashboard/portfolio` | `/week?tab=vector` |
| `/dashboard/operations/value-recap` | `/month` (битый cron) |
| `/dashboard/operations/onboarding-ramp` | `/team` (битый cron) |
| `/dashboard/operations/knowledge-at-risk` | `/week` (битый cron) |
| `/dashboard/operations/decisions/stalled` | `/decisions?status=stalled` (битый cron) |
| `/dump` | глобальная кнопка «+ Создать → Мысль» (править `CommandPalette:1016`, `nav-help:24`, тур `overview.ts:74-81`) |

**Удалить из меню (страницы остаются доступны):**
- Подгруппа «Будет в следующей фазе» (`Sidebar.tsx:440-449`): `/processes`,`/policies`,`/metrics`. `/processes` оставить в Справочнике (реальная страница).
- «Лента» `/feed` заглушка → заменить «Лентой памяти» (Ф5); править `Sidebar.tsx:260`+`primary-nav.ts:38`+`CommandPalette:1004`+`nav-subset.spec.ts:31`.
- Дубль «Интеграции» (оставить только `/settings/integrations`).

**Статус:** [ ]

---

## Ф1. СЕГОДНЯ — `/dashboard` (новая Главная)

**Цель:** первый экран отвечает за 30 сек на «что случилось / что буксует / куда движемся», ≤7 величин.

**Файлы:** `DashboardRouter.tsx:48-56`, `DirectorDashboardClient.tsx`, `MobileOverviewClient.tsx`. Бэк готов: `GET /dashboard/director` (`director-dashboard.service.ts:105`), `GET /dashboard/operations/daily-digest` (`daily-digest.controller:45`).

**Состав (прототип `part-today.html`):**
1. **Строка-вердикт** (`verdict-bar`): «Компания в норме. N требуют решения» или «Сбор данных не работает с N» (Б-6: дашборд молчит при норме).
2. **Требует вас: N** карточка-якорь ← `requiresAction` (`director-dashboard.service:521`).
3. **Что было вчера** ← `shortSummary` daily-digest (встроить daily в Сегодня).
4. **Польза за неделю** (5 счётчиков, кликабельны до источника) ← `valueStrip` (`director-dashboard.service:842`).
5. **Вектор к цели** (компас) ← `pulse-patterns.goalVector` (`pulse-patterns.service:344`). ⚠️ Починить: атрибутирует recipient, не author (`research-data` §6).
6. **Сводка Коры** (нарратив с цитатами) ← `narrativeSummary` (`director-dashboard.service:460`).
7. **Самое острое** (Радар топ-3 с затуханием) ← `newSignals`+`Insight`. Достроить: затухание по свежести + классификация (решение клиента ≠ риск).
8. **Лента дня** (свёрнуто) ← `eventsToday` (`daily-digest.service:639`). Достроить: подставлять `Decision.statement`+ссылку вместо 16× «Решение approved».
9. **Онбординг** (один экземпляр, автозачёт, исчезает после 6/6) ← `IncompleteSetupBanner`.

**Убрать:** 4 вкладки (Команда/Знания/Цели и встречи) — контент в профильные разделы.

**Верификация:** число «Требует вас» на Сегодня == счётчик `/actions` (Б-2 автотест-инвариант).

**Статус:** [ ]

---

## Ф2. НЕДЕЛЯ — `/week` (слияние operations+weekly+portfolio)

**Цель:** понедельничный ритуал; «Кто держит слово» открывает экран.

**Файлы:** новый `frontend/app/(authenticated)/week/` ← перенос `WeeklyDigestClient.tsx`+`OperationsDashboardClient.tsx`+`PortfolioDashboardClient.tsx`. Бэк готов: `weekly-digest`, `operations/overview`, `weekly-per-person`, `portfolio-health`.

**Состав (прототип `part-week.html`), вкладки Сводка·Пульс сейчас·Кто держит слово:**
1. **Кто держит слово** (наверх!) ← `GET /dashboard/operations/weekly-per-person` (`weekly-per-person.controller:39`). Топ-5/топ-5, «показать всех». Пуст из-за Б-3 → чинится Ф7.
2. 4 KPI с дельтами+sparkline ← `weekly-digest kpiDeltas`.
3. **Пульс сейчас** ← `GET /dashboard/operations/overview` (live, без LLM). KPI-зоны Люди/Исполнение/Сигналы, карта причин топ-5.
4. Температура (Общая/По людям) ← `team-temperature`.
5. Блокеры ← `blockers/chronic`. Достроить: «хронический» = старше N дней / ≥2 упоминаний (`research-data` §8).
6. Вектор+портфель ← `portfolio-health` (перенос сироты `/dashboard/portfolio`).
7. AI-инсайт «Расхождение слов и целей» ← `strategicAlignment` alertGoals (поднять из глубины).
8. Прогноз ← `forecast`. Достроить: глушить при нулевых данных (Б-6).

**Статус:** [ ]

---

## Ф3. ИТОГИ МЕСЯЦА — `/month` (value-recap + PDF)

**Файлы:** новый `frontend/app/(authenticated)/month/` ← `ValueRecapDashboardClient.tsx`. Бэк: `GET /dashboard/operations/value-recap` (`value-recap.service:46`).

**Состав (прототип `part-month.html`):**
1. AI hero «Сводка месяца» ← `value-recap-narrative`.
2. Снятая рутина (7 счётчиков) ← `routine` (`value-recap.scoring.ts:70`).
3. Команда лучше (soft, «оценка») ← `team`.
4. **Решения месяца + % доведено** ← `getDecisionThroughput` (`decision-implementation.service:157`) (вынести в recap — Ф8).
5. Дельта к прошлому месяцу ← `delta`.
6. **Скачать слайды / PDF** — достроить рендер PDF/PPTX поверх slides-JSON (`value-recap-export.ts:15`; сейчас только JSON).
7. Дефолт-период = последний месяц С ДАННЫМИ (Б-6; не пустой май).

**Статус:** [ ]

---

## Ф4. ТРЕБУЕТ ВАС — `/actions` (4 очереди → 1, суть + inline-резолв)

**Цель:** очередь решений вместо очереди долгов; каждый элемент решается из списка ≤10 сек.

**Файлы:** `ActionsClient.tsx`, `PendingActionsBell.tsx`. Бэк: `PendingActionsService` (`pending-actions.service.ts:56`, 4 провайдера `:75`), провайдеры `providers/*.provider.ts`.

**Состав (прототип `part-requires.html`):**
1. Заголовок `hero-num N` + «старейшее N дней».
2. Группы с inline-резолвом, КАЖДЫЙ элемент = реальная СУТЬ:
   - **Вопросы Коры** — текст вопроса + поле «ответить текстом» (БЕЗ inline-кнопок выбора, В6) → `POST /notifications/:id/respond`.
   - **Конфликты карточек** — суть конфликта + кнопки Оставить старую/Принять новую/Объединить → `conflicts/:id/resolve`.
   - **Кандидаты в задачи** — заголовок+уверенность+кнопки В задачи/Отклонить → `intake/:id/triage`.
   - **Карточки на проверке** — Принять/Отклонить → `curation/items/:id/decide`.

**Достроить:**
- Провайдеры кладут реальную суть в `title` (сейчас шаблон) — `providers/*.provider.ts`.
- Сквозной `POST /pending-actions/confirm` для conflict/probe/intake (сейчас только curation light `pending-actions.service.ts:211`).
- `expiresAt` на `ConflictItem` (`schema:3864`) и `IntakeIssue` (`schema:9469`) + sweep-крон авто-закрытия протухших.
- Снять двойной учёт Входящие↔Подтверждения (intake показывать только в «Требует вас», `/intake` = вкладка-зеркало).

> Объём уже снижен автономией W0–W4 (реализована 2026-06-12).

**Статус:** [ ]

---

## Ф5. ВСТРЕЧИ (авто-название + next-step→задача) + ПАМЯТЬ (3 входа + поиск)

### Ф5а. Встречи — `/meetings`
**Файлы:** `MeetingsJournalReal.tsx`, `MeetingResultPageReal`. Прототип `part-meetings.html`.
- **🔴 Авто-название встреч** — taskType `meeting-title` (агент по транскрипту, как `chat-v2-conversation-title` `conversations.service:325`). Сейчас НЕТ (`research-data` §9).
- **🟡 Следующие шаги → задачи** — конвертация секций `next_steps`/`action_items` отчёта (`type-review.ts:39`) в `IntakeIssue` с кнопкой подтверждения из отчёта. Писать `sourceBlockIds`+`DecisionTaskLink` (петля Ф8.1).
- Карточки → вид «Клиенты и сделки» (Р4); deep-link `/cards/:id` сохранить (redirect).

### Ф5б. Память — `/memory`
**Файлы:** новый хаб `frontend/app/(authenticated)/memory/`, существующие разделы. Прототип `part-memory.html`.
- 3 входа: **Спросить** (`/chat`) · **Лента** (реальная, заменяет заглушку `/feed`) · **Реестры** (Решения/Правила/Темы/Сущности/Таблицы/Идеи вкладками).
- **🔴 UI поиска по памяти** — поверх `POST /api/v1/knowledge/search` (`search.controller:37`); UI сейчас НЕТ (`research-data` §10).
- 🟡 Решения: авто-`implemented` по упоминаниям «сделали/внедрили» (сейчас только `implementationStatus`).
- 🟡 ack «✓ записано в память» на дамп/чек-ин/заметку.

**Статус:** [ ]

---

## Ф6. ЗАДАЧИ — `/projects` (вкладки + календарь в меню)

**Файлы:** `ProjectViewShell.tsx:31`, `Board.tsx` (@dnd-kit готов), `CalendarView.tsx`, `EventForm.tsx`. Прототип `part-tasks.html`.
- Вкладки: Доска·Список·Спринты·Входящие·**Календарь**·Архив. Календарь уже есть (`CalendarView`), но **нет ссылки в меню** (`research-tracker` §2.1) → ввести вкладку.
- 🟡 UI повторяемости/напоминаний событий (rrule/reminder) — backend+API есть, в `EventForm` НЕТ (`research-tracker` §2.4).
- 🟡 Планирование встречи через Event kind=meeting (Р5, опц.).

> Гант (`gantt/page.tsx:17`) и массовые операции над Issue — вне scope.

**Статус:** [ ]

---

## Ф7. КОМАНДА (merge отделов) + Я (обещания)

### Ф7а. Команда — `/structure`
**Файлы:** `StructureClient`, `departments.controller.ts`. Прототип `part-team.html`.
- **🔴 Merge отделов** — `POST /departments/:id/merge` (перенос PersonRole/EntityLink/ссылок) + мастер дедупа по похожим именам (паттерн `entity-merge.service`). Сейчас только soft-delete пустого (`research-data` §16).
- 🟡 Здоровье команд: схлопнуть 10 строк «слишком мал» в 1 + CTA (`team-health` `director-dashboard.controller:114`).
- 🟡 Сотрудники под риском: исключать самого зрителя (`people-at-risk`).
- 🟡 Зрелость: прятать при «не определено».

### Ф7б. Я — `/me`
**Файлы:** `MeTabsClient.tsx`, `my-promises.controller.ts`, экстрактор обещаний.
- **🟡 Экстрактор обещаний (кто+что+срок)** — обещание создаётся только при полной связке, иначе «открытый вопрос» (отдельная сущность, не в метрику надёжности). Поля есть: `commitmentAuthorPersonId`/`commitmentRecipientPersonId`/`commitmentDueDate` (`schema:3347-3359`); промпт `block-ingest.prompt.ts:452`. **Это чинит вертикаль «Кто держит слово»/«Надёжность %» на 3 экранах (Б-3).**
- 🟡 Должность согласована со `/structure` (Б-2).

**Статус:** [ ]

---

## Ф8. Новые строительные блоки (4 белых пятна)

### Ф8.1. Петля «решение → исполнение → % доведённых»
- 🟡 next-step отчёта → черновик задачи (Ф5а).
- 🟡 авто-движение `Decision.status` → `implemented` по упоминаниям.
- 🟡 виджет «Доведение решений: N из M» (Месяц+Неделя) ← `getDecisionThroughput` (готов).
- 🟡 алерт «решение N недель без движения» ← `decisions/stalled` (готов).

### Ф8.2. Операционные риск-алерты (в бриф Сегодня)
- **🔴 Silence-детектор «тема молчит N недель»** поверх `Theme.lastSignalAt` (поле есть! `research-data` §8а) — обратный к `topic-recurrence-detector`.
- 🟡 «Два отдела противоречат» ← `IdeaBlockLink.contradicts` (`block-linker.worker:26`) поднять в алерт.
- 🟡 bus-factor в разрезе Theme ← `KnowledgeRiskSnapshot`.

### Ф8.3. Утренний бриф до привычки
- 🟡 фиксированная структура ≤3 мин, deep-link на пункт, без служебных кодов.
- **⚙️ Владелец: VAPID-ключи в проде** (`npx web-push generate-vapid-keys` → прод-`.env`) — без них весь web-push no-op (`web-push-sender.service`, `04_не-сделано:113`).

### Ф8.4. «Кто держит слово» как продукт
- последовательность: экстрактор Ф7б → виджет открывает Неделю → лента обещаний в брифе.

**Статус:** [ ]

---

## Ф9. Мобильный слой (синхронизация)

**Файлы:** `mobile-tabs.ts` (из `nav-config.ts` Ф0), мобильные клиенты `src/ui/mobile/*`. Прототип `mobile.html`.
- EXEC табы: Сегодня `/dashboard` · Неделя `/week` · Требует вас `/actions` · Память `/chat` · Я `/me`.
- MANAGER табы: Сегодня `/me` · Чек-ин `/me/check-ins` · Спросить `/chat` · Дела `/me/inbox`.
- Достроить мобильную раскладку для `/month`, `/week` (после переноса), `/me` (сейчас «ужатый десктоп» — `research-mobile`).
- Инвариант: мобилка = быстрый взгляд по роли, полный интерфейс — десктоп.

**Статус:** [ ]

---

## Ф10. Дизайн-раскатка + QA

- Все новые экраны на `modern/` (стекло/градиент/объём), токены `modern/tokens.ts`; усиление яркость/объём/«плавающие плашки» по прототипам (`design-system.css`).
- Б-6 три состояния у каждого виджета; Б-5 словарь меток на рендере (enum→русская фраза), запрет служебных кодов в LLM-промптах.
- Лингвопрогон всех строк по `delivery/ui/copy-strings.ru.md`.
- Автотест-инварианты Б-2 (число на Сегодня == в разделе).
- Визуальная QA скриншотами после прод-выката (qa-tester, прод korateam.ru).

**Статус:** [ ]

---

## Порядок реализации

Ф0 (фундамент) → Ф1 (Сегодня) → Ф4 (Требует вас) → Ф2 (Неделя) → Ф7б (экстрактор обещаний — разблокирует «Кто держит слово») → Ф3 (Месяц) → Ф5 (Встречи+Память) → Ф6 (Задачи) → Ф7а (Команда) → Ф8 (блоки) → Ф9 (мобилка) → Ф10 (QA). Каждая фаза — Ship-On, выкат включённой.

## Зависимости и пересечения
- Автономия W0–W4 (реализована) — основа Ф4. Помощник-каналы Ф1–Ф6 (реализованы) — основа «Спросить».
- НЕ дублировать: probe-система Ф1 (реализована), редизайн-язык Ф1–Ф2 (`modern/` готов).
- Прод-операции при выкате: новые ENV (VAPID), новый эндпоинт `/departments/:id/merge` + `/knowledge/search` UI → Swagger smoke; новый taskType `meeting-title` → реестр LLM; новые поля `expiresAt` → миграция Prisma. Все — в `prod-deploy-log.md` при реализации.

## Итог
Реализовано: нет (ТЗ-контракт). Осталось: Ф0–Ф10. ~70% — перекомпоновка готовых эндпоинтов, ~20% достройка, ~10% (4 блока: meeting-title, silence-детектор, merge отделов, UI поиска памяти). Прототипы всех экранов — `plans/analysis/2026-06-13-cabinet-redesign-prototypes/index.html` (+`mobile.html`).
