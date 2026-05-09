---
type: analysis
status: draft
feature: ai-meeting-workspace
date: 2026-05-09
---

# Анализ: AI Meeting Workspace — расширенный кабинет и страница результата встречи

## Что хотим сделать

Превратить текущий минимальный кабинет Z (журнал-таблица + статичная страница результата встречи) в полноценное рабочее пространство уровня Otter / Fathom / Fireflies / tl;dv: трёхколоночная страница встречи с навигацией по smart chapters, синхронизацией транскрипта с видео, AI-чатом поверх встречи, action items как первоклассной сущностью, highlight-клипами с шерингом, templates как UX-объектом, публичным шерингом ссылкой на N дней, публичным REST API + outgoing webhook-подписками, массовыми действиями в журнале с тегами и экспортом ZIP. AI-инфраструктура — `LlmRouter` поверх существующего fallback-каскада с маршрутизацией по типу задачи через админку, embeddings — OpenAI через `proxy.agent-lia.ru` с локальным fallback на BGE-M3.

## Зачем (цель и ценность)

**Продуктовая ценность.** На рынке AI-встреч сложился стандарт — то, что юзер ожидает увидеть после встречи. Этот стандарт включает интерактивную навигацию по содержимому, чат поверх транскрипта, структурированные задачи с возможностью отправки в чат-инструменты, шеринг ссылкой на отдельный момент или встречу целиком. Текущая Z-страница результата — статичный стек карточек ([ResultPage.tsx](frontend/src/ui/components/meeting-result/ResultPage.tsx)) — выглядит как «MVP-плейсхолдер» рядом с любым из конкурентов. Чтобы продукт продавался без оговорок «у нас пока проще» — нужно поднять планку до рыночного стандарта. Заявка владельца продукта: **«максимальный функционал, удобный интерфейс, как у конкурентов»**.

**Кому это даёт что:**
- **Sales-менеджер** — мгновенно делится клиентским моментом из звонка через ссылку на клип. Видит структурированные next steps. Получает follow-up email одной кнопкой.
- **Custdev-исследователь** — навешивает теги на серию интервью, фильтрует по гипотезе, спрашивает в AI-чате «какие были возражения по цене за квартал».
- **Тимлид / руководитель** — видит чёткий список задач из планёрки с ответственными, отправляет в Slack или Asana одной кнопкой.
- **B2B-клиент** — спрашивает «у вас есть API?» и получает «да, REST + webhooks + Swagger». Снимает половину возражений на демо.
- **Юзер с большим архивом** — массово удаляет старые встречи, экспортирует пакет за квартал ZIP-файлом, не зависит от поддержки.

## Как работает сейчас

**Страница результата встречи.** Линейный стек карточек в `max-w-4xl`: Header → Video → Summary → ReportByType → FollowUp → Tasks → Transcript. Реализовано в [ResultPage.tsx](frontend/src/ui/components/meeting-result/ResultPage.tsx). Никакой синхронизации между транскриптом и видео, никаких глав, никакого AI-чата, никаких маркеров на timeline. Action items хранятся плоским массивом строк (см. `aiResultFromApi`), без assignee, статуса, due date, источника-цитаты.

**Журнал встреч.** Таблица [MeetingsTable.tsx](frontend/src/ui/components/meetings-list/MeetingsTable.tsx) с фильтрами по типу/статусу/дате/title (`MeetingFiltersBar.tsx`). Без чекбоксов, без массовых действий, без тегов. В рамках уже спланированного [standalone-product ТЗ](plans/tz/2026-05-09-standalone-product.md) журнал переделывается в master-detail layout, но без расширений по фичам.

**AI-pipeline.** Существующие этапы — транскрибация (Vox/GigaAM), склейка по времени, разделение по спикерам, применение шаблона по типу, генерация summary, follow-up email, плоский список задач, custom_output_md для custom_prompt. Описано в [ai-analysis-by-type.md](second-brain/01_projects/ai-analysis-by-type.md) и работает через BullMQ-воркеры. Этапов смыслового разбиения на главы и построения embeddings пока нет.

**LLM-инфраструктура.** Каскад из трёх провайдеров уже в коде — [llm-fallback.service.ts](backend/src/modules/ai/services/llm-fallback.service.ts): Anthropic Claude → MiniMax (на 403 при российских IP) → OpenAI Responses через `proxy.agent-lia.ru`. Это правильная абстракция, поверх которой можно строить маршрутизацию по типу задачи без переписывания.

**Embeddings.** Не используются. Прокси `proxy.agent-lia.ru` поддерживает OpenAI Embeddings API, но в коде Z к ним пока не обращаются.

**Видео-плеер.** Нативный HTML5 в [VideoPlayer.tsx](frontend/src/ui/components/meeting-result/VideoPlayer.tsx), с `forwardRef` для прокидывания ref наружу. Без маркеров на timeline, без скорости воспроизведения, без шорткатов.

**Публичный шеринг.** Не реализован. В [meeting-result-page.md](second-brain/01_projects/meeting-result-page.md) явно отложен в V2: «Открытая публичная версия страницы — V2-фича».

**Public API.** Не реализован. Внутренний API есть, но без personal API keys, без Swagger-описаний под публичное использование, без webhook-подписок. Админская модель API-ключей (`IntegrationKeysTable`) существует и переиспользуется в задачах Crossmark — её можно поднять на user-уровень.

**Интеграции с внешними сервисами.** Нет. Action items не отправляются никуда, follow-up email только генерируется, но не уходит юзеру.

## Обзор рынка

Изучены семь основных игроков и одно академическое исследование. Источники — внизу секции.

### Otter.ai

**Продуктовая модель.** Полноценная meeting-AI-платформа с упором на enterprise-сценарии. Собственная страница `My Action Items` с задачами со всех встреч (агрегатный экран). Кросс-meeting AI-чат — главный value на платных тарифах: «покажи все возражения за квартал», «что говорили про конкурента X в feb 2026».

**Ключевые UX-паттерны:**
- Главный экран — Home с напоминаниями и timely-уведомлениями.
- На странице встречи — summary + automatically extracted action items с чекбоксом и возможностью переназначения.
- AI-чат поверх встречи и поверх архива (cross-meeting).
- Connectors в Slack / Zapier / десятки CRM, OAuth по каждому.
- Чистый минималистичный layout, аккуратная типографика.

**Что берём для Z.** Идею экрана `My Tasks` с задачами по всем встречам. Идею cross-meeting AI-чата. Структуру action items как первоклассных объектов.

**Что не берём.** OAuth-портфель CRM-коннекторов — переносится в vNext (зафиксировано в обсуждении).

### Fathom

**Продуктовая модель.** «Никогда не делайте заметки сами». Бесплатная для индивидуальных юзеров, платная Team Edition с 17 шаблонами под типы встреч. Сильная сторона — действия пишутся прямо в Slack / HubSpot / Asana / Salesforce / Notion после встречи.

**Ключевые UX-паттерны:**
- Auto-generated action items с auto-assignment по голосу спикера.
- AI-сгенерированный follow-up email готов сразу, копируется одной кнопкой.
- `Ask Fathom` — ChatGPT-style чат поверх встречи, на бесплатном тарифе ограничен 5 встречами в месяц.
- Templates как UX-объект — галерея, переключение пост-фактум регенерирует отчёт.
- Интеграции через OAuth с автоматической доставкой задач.

**Что берём для Z.** Templates как объект (галерея, смена пост-фактум, регенерация). Ask Fathom-стиль чата по одной встрече. Auto-assignment задач по спикеру.

### Fireflies.ai

**Продуктовая модель.** Сильная сторона — структурированные **AI Super Summaries** на платных тарифах. Многосекционный отчёт с keywords, overview, time-stamped notes, action items, customizable sections.

**Ключевые UX-паттерны:**
- Keywords как chips наверху отчёта — мгновенный сканер тематик.
- Time-stamped outline с кликабельными таймкодами → перемотка плеера и транскрипта одновременно.
- Customizable sections — юзер галочками выбирает секции (Blockers, Decisions, Customer Needs).
- Quality rating каждой секции — юзер ставит палец вверх / вниз, это улучшает модель.
- Templates под BANT, Sales Call, Team Meeting — со своим набором default-секций.
- Кнопка `Expand` на каждой секции — прогрессивное раскрытие деталей.

**Что берём для Z.** Time-stamped outline с jump-to-time. Customizable sections как UI поверх промпта. Прогрессивное раскрытие секций (accordion).

### tl;dv

**Продуктовая модель.** Async-first позиционирование. Сильная сторона — highlight clips и шеринг моментов. «30-second highlight reels» в Slack — фишка, которую хвалят больше всего в обзорах.

**Ключевые UX-паттерны:**
- Минималистичный layout, упор на timeline replay.
- Видимые highlights на timeline — кликабельные маркеры.
- Тегирование highlights темами (#feature-request, #pricing-pushback) — поиск патернов across calls.
- Manual speaker reassignment в транскрипте — критично для multi-speaker точности.
- Multi-meeting AI-recap — выделил несколько встреч, получил сводный summary.
- Auto-send AI minutes всем участникам после встречи.

**Что берём для Z.** Highlight clips с маркерами на timeline. Идею тегов на клипах (тема клипа). Manual speaker reassignment (отдельная фича — может попасть в vNext, в первом ТЗ необязательна).

### Granola

**Продуктовая модель.** Анти-бот: не присоединяется к встрече, записывает с системного аудио, никто кроме хоста не знает. Apple Notes-эстетика. Главная UX-фишка — юзер пишет короткие заметки во время встречи, AI после встречи дополняет деталями.

**Ключевые UX-паттерны:**
- Чёрный текст — твои заметки, серый — AI-дополнение. Мгновенно видно границу.
- Минималистичный clean notepad-look, нет тяжёлых дашбордов.
- Templates ~40 штук, кастомизируемые.
- AI-чат знает контекст всех твоих встреч.
- Calendar-sync — все встречи появляются автоматически.

**Слабые места по тирдауну:**
- Action items как plain text, без чекбоксов и экспорта.
- Templates применяются вручную после встречи, нет авто-распознавания типа.
- Шеринг неудобный — каждую заметку надо вручную расшаривать.
- Нет PDF / Markdown / DOCX экспорта — только copy-paste.

**Что берём для Z.** Идею «чёрный — мой текст, серый — AI» (в vNext, требует in-meeting note editor). Calendar-sync (vNext, отдельная фича). Templates galleries.

**Что НЕ берём.** Анти-бот-подход — у нас LiveKit, мы участник встречи по дизайну. Это противоречит нашей архитектуре.

### Read.ai

**Продуктовая модель.** Live meeting analytics. Главная фишка — real-time dashboard во время встречи: live summary, метрики (filler words, WPM, sentiment), pivotal moments alerts.

**Ключевые UX-паттерны:**
- Drag-and-drop панелей дашборда.
- Real-time bullet summary, обновляется каждую минуту.
- Метрики как первоклассный объект, видны сразу во время разговора.

**Что берём для Z.** Ничего в первом ТЗ. Live-dashboard — vNext (зафиксировано в обсуждении).

### Avoma

**Продуктовая модель.** Sales-focus с упором на topic detection. Smart Topics — AI категоризирует разговор по типам (Business Need, Pain Points, Next Steps). Smart Trackers — ключевые концепты, отслеживаемые независимо от phrasing.

**Ключевые UX-паттерны:**
- Smart chapters с навигацией по темам — клик → перемотка видео.
- Topic-based playback — глава выбирается из drop-down прямо над плеером.
- Trigger Prompts — настраиваемые фразы, на которые AI обращает особое внимание.
- Keywords tracking с трендами по времени.

**Что берём для Z.** Smart chapters с jump-to-time. Идея Smart Trackers — может стать частью v2 (у нас всё-таки 9 типов встреч уже задают тематику).

### Академическое исследование (Microsoft Research, arXiv 2307.15793)

Исследование 2023 года прямо про дизайн LLM-powered meeting recap. Тестировали два паттерна:

**DR1 — Highlights Recap.** Список ключевых точек + action items как первоклассных объектов. Для каждого item — three-dot menu с «show context» (3 utterance до и после). Action items с editable assignee и due date.

**Findings DR1:**
- Хорошо для quick task review и accountability.
- Не хватает контекста — юзеры не понимают «почему такое решение».
- Шесть из семи участников хотели возможность переупорядочить items по приоритету.

**DR2 — Hierarchical Recap.** Accordion-стиль с главами в хронологическом порядке. Уровень глав → уровень rolling summary с timestamps → уровень raw transcript. Звёзды для key-points, чекбоксы для action-items.

**Findings DR2:**
- Все 7 участников нашли паттерн интуитивным.
- Используется breadth-first exploration: сканируют заголовки → раскрывают релевантные → ныряют в детали.
- Один из участников: «I love the progressive detail. I can understand this really quickly».

**Применимость для Z.** Оба паттерна нужны и **дополняют друг друга**:
- Highlights — это наша «первая страница» (summary + key tasks).
- Hierarchical — это вкладка `Chapters` в трёхколоночной странице.

**Источники:**
- [Otter главная](https://otter.ai/)
- [Otter — Meeting Summary Overview](https://help.otter.ai/hc/en-us/articles/9156381229079-Meeting-Summary-Overview)
- [Otter — My Action Items](https://otter.ai/blog/otter-ai-new-feature-my-action-items)
- [Otter AI Chat](https://otter.ai/chat)
- [Otter vs Fathom comparison](https://otter.ai/blog/otter-vs-fathom-which-ai-meeting-tool-is-better)
- [Fathom главная](https://www.fathom.ai/)
- [Fathom Overview](https://www.fathom.ai/overview)
- [Fathom Team Edition advanced features](https://help.fathom.video/en/articles/640768)
- [Granola главная](https://www.granola.ai/)
- [Granola UI/UX showcase](https://uiuxshowcase.com/resources/granola-ai-powered-notepad/)
- [Granola teardown](https://meetingnotes.com/blog/granola-ai-teardown)
- [How Granola enhances note-taking](https://intelligentinterfaces.substack.com/p/how-granola-enhances-note-taking)
- [Fireflies — AI Super Summaries](https://fireflies.ai/blog/fireflies-launches-ai-super-summaries/)
- [Fireflies — Knowledge Base](https://guide.fireflies.ai/articles/9547055509-Fireflies-AI-Meeting-Summaries:-View,-Customise,-Expand,-Regenerate)
- [tl;dv главная](https://tldv.io/)
- [Avoma — Topic Detection](https://www.avoma.com/product/topic-detection)
- [Avoma — Smart Topics customization](https://help.avoma.com/leveraging-smart-topics)
- [Read.ai — live meeting dashboard](https://support.read.ai/hc/en-us/articles/33462537362579-Using-Read-s-live-meeting-dashboard)
- [Microsoft Research — Summaries, Highlights, and Action Items: LLM-powered Meeting Recap (arXiv 2307.15793)](https://arxiv.org/html/2307.15793v3)

## Карта фич: что есть у кого, что берём для Z

| Фича | Otter | Fathom | Fireflies | tl;dv | Granola | Read | Avoma | **Z в этом ТЗ** |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Smart chapters с jump-to-time | + | + | + | + | + | + | + | **+** |
| Транскрипт ↔ видео sync | + | + | + | + | + | + | + | **+** |
| Customizable summary sections | – | – | + | – | + | – | – | **+** |
| Action items как первоклассный объект | + | + | + | + | – | + | + | **+** |
| Чекбокс / статус / due date / assignee | + | + | + | + | – | – | + | **+** |
| Cross-meeting `My Tasks` | + | – | – | – | – | – | – | **+** |
| AI-чат по одной встрече | + | + | + | + | + | + | + | **+** |
| AI-чат cross-meeting | + | platform | + | + | + | – | + | **+** |
| Highlight clips (timeline маркеры) | – | + | – | + | – | – | – | **+** |
| Скачивание клипа MP4 | – | + | – | + | – | – | – | **+ (по запросу)** |
| Templates как UX-объект | + | + | + | – | + | – | + | **+** |
| Регенерация секции / смена шаблона | + | + | + | – | + | – | + | **+** |
| Публичный шеринг ссылкой | + | + | + | + | partial | + | + | **+ (тумблеры + срок)** |
| Срок жизни ссылки | + | + | + | + | – | + | + | **+ (1 / 7 / 14)** |
| Public REST API | + | + | + | + | – | + | + | **+** |
| Personal API keys | + | + | + | + | – | + | + | **+** |
| Outgoing webhook subscriptions | + | + | + | + | – | + | + | **+** |
| Slack / email / Telegram отправка | + | + | + | + | partial | + | + | **+** |
| Generic webhook (Zapier-friendly) | + | + | + | + | – | + | + | **+** |
| OAuth-коннекторы CRM/PM | + | + | + | + | – | + | + | **vNext** |
| Чекбоксы и массовые действия в журнале | + | + | + | + | – | + | + | **+** |
| Теги встреч | + | + | + | + | partial | + | + | **+** |
| Экспорт ZIP | + | + | + | – | – | + | + | **+** |
| Экспорт MD/PDF/DOCX отдельной встречи | + | + | + | + | – | + | + | **+** |
| Маркеры на timeline видео-плеера | + | + | + | + | – | – | + | **+ (Vidstack)** |
| Скорость воспроизведения, PIP, шорткаты | + | + | + | + | – | – | + | **+** |
| Live-dashboard во время встречи | partial | – | partial | – | – | + | – | **vNext** |
| In-meeting notes (Granola-style) | – | – | – | – | + | – | – | **vNext** |
| Multi-language autodetect | + | + | + | + | + | + | + | **vNext** |

## Продуктовая спецификация Z (что делаем)

### Workspace (расширение кабинета поверх standalone-product ТЗ)

**Новая главная-дашборд** — `/` для залогиненного юзера (если предыдущий ТЗ редиректит на `/meetings`, в новом ТЗ `/` становится дашбордом):
- Виджет «Сегодня» — сегодняшние встречи, в процессе обработки и обработанные.
- Виджет «На этой неделе» — список с миниатюрами.
- Виджет «Открытые задачи» — топ-5 моих незакрытых action items с возможностью отметить выполненными.
- Виджет «Мини-статистика» — минут записано / задач закрыто / встреч проведено за месяц.

**Журнал** — `/meetings` как master-detail (взято из standalone-product) + расширения:
- Чекбокс на каждой строке + select-all + toolbar `Удалить / Теги / Экспорт ZIP`.
- Фильтр по тегам в `MeetingFiltersBar`.
- Поиск по содержимому транскрипта (раньше — только по title).
- Группировка «Сегодня / На неделе / Ранее» (взято из standalone-product).

**My Tasks** — новая страница `/tasks`:
- Список всех action items со всех встреч юзера.
- Фильтры: статус (открытые / выполненные), assignee (я / другие), due date diapason, поиск по тексту.
- Inline-редактирование: чекбокс выполнения, изменение assignee, due date.
- Клик по задаче → переход на встречу, источник раскрывается с таймкодом.

**Settings → Tags** — новая страница:
- Список тегов юзера (имя + цвет).
- Создание / редактирование / удаление тега.
- Удаление с предупреждением «удалится из N встреч».

**Settings → Integrations** — новая страница (расширение integrations из standalone-product):
- Список адресатов (destinations): Email / Slack webhook / Telegram bot / Generic webhook.
- Каждый destination с тестовой кнопкой «Отправить пробное».
- Каждый destination конфигурируется по типу (URL / адрес / токен).

**Settings → API** — новая страница:
- Кнопка `Создать ключ` → диалог: имя, scopes (`read` / `write` / `admin`).
- Список существующих: имя, scopes, дата создания, дата последнего использования, кнопки `Отозвать` / `Удалить`.
- Ключ показывается **один раз** при создании, далее — только хеш.

**Settings → Webhooks** — новая страница:
- Список подписок: URL, события, статус (active / failing / paused), счётчик доставок (success / failed).
- Создание подписки: URL, чекбоксы событий, секрет (генерится автоматически или вводится вручную).
- Журнал доставок: каждая попытка с кодом ответа, телом, таймстемпом, кнопкой `Retry`.

**Settings → Exports** — новая страница:
- Список запрошенных экспортов с прогрессом (queued / processing / ready / failed).
- Готовые — со ссылкой на скачивание (валидной заданное время).
- Истёкшие удаляются автоматически по retention.

### Страница встречи в три колонки

URL остаётся `/meetings/<id>/result`. Полная переделка [ResultPage.tsx](frontend/src/ui/components/meeting-result/ResultPage.tsx).

**Левая колонка** (фиксированная ширина, sticky):
- TOC (Table of Contents) секций отчёта — список, клик скроллит к секции.
- Smart chapters — accordion, клик перематывает видео и подсвечивает соответствующий кусок транскрипта.
- Список участников — аватарки, имена, длительность речи (% от общей).

**Центральная колонка** (растягивается):
- Видео-плеер с маркерами глав и клипов на timeline (Vidstack).
- Tabs `Overview / Chapters / Transcript / Action Items / Notes`:
  - **Overview** — summary, отчёт по типу или custom_output_md, follow-up email с кнопкой `Скопировать` и кнопкой `Отправить в...`.
  - **Chapters** — hierarchical recap по DR2: главы → rolling summary → raw transcript. Звёзды и чекбоксы.
  - **Transcript** — линейный, с timestamps. Клик по строке → перемотка видео. Текущая строка подсвечивается во время воспроизведения.
  - **Action Items** — список с чекбоксами, assignee, due date, source-quote (раскрывается). Кнопка `+ Добавить вручную`. Кнопка `Отправить в...`.
  - **Notes** — заметки хоста, свободный markdown-редактор. (V1 — простой textarea с markdown. V2 — Granola-стиль чёрный/серый.)

**Правая колонка** (тогглом, скрывается на узких экранах):
- AI-чат поверх этой встречи. История сообщений, поле ввода, suggested prompts наверху.

**Шапка страницы:**
- Название встречи (inline-edit).
- Тип • дата • длительность.
- Кнопки: `Поделиться` (открывает диалог шеринга), `Экспорт ▾` (MD / PDF / DOCX), `Действия ▾` (Регенерировать с другим шаблоном / Удалить).

### AI-pipeline расширения

**Новые этапы поверх существующих:**

1. `generate-chapters` — после готовности транскрипта LLM (через `LlmRouter` с `taskType=chapters`) делит встречу на смысловые главы. Output: `[{startMs, endMs, title, summary}]`. Сохраняется в `MeetingChapter`.

2. `extract-tasks-structured` — заменяет текущее извлечение задач плоской строкой. LLM (через `LlmRouter` с `taskType=tasks`) возвращает `[{title, assignee_hint, due_date_hint, source_start_ms, source_end_ms, confidence}]`. Сохраняется в `Task`.

3. `build-embeddings` — после готовности транскрипта режем его на куски (sliding window 500 токенов с overlap 50), отправляем в `EmbeddingService` (OpenAI через прокси или локальный fallback). Складываем в `MeetingTranscriptChunk` с pgvector-полем.

4. `render-clip-mp4` — рендер клипа по запросу (юзер нажал «Скачать MP4»). Воркер с ffmpeg на нашем сервере. Результат — объект в S3, ссылка с retention.

**Новый сервис LLM-маршрутизации:**

`LlmRouter` поверх `LlmFallbackService`:
- Принимает `taskType` (`chat`, `summary`, `chapters`, `tasks`, `regenerate-section`, `custom-prompt`, `follow-up`, `clip-title`).
- По таблице `LlmTaskRoute` (БД) определяет, в каком порядке пробовать провайдеров для этой задачи.
- Каскад внутри роута сохраняет существующую логику.
- Лог `AiUsageLog` расширяется полем `taskType`.
- Админка: страница `Admin → AI Models` с таблицей маршрутов и редактированием через UI.

**Новый сервис embeddings:**

`EmbeddingService` с интерфейсом `embed(texts: string[]): Promise<number[][]>`:
- Default-реализация: `OpenAiProxyEmbeddingService` поверх `proxy.agent-lia.ru/v1/embeddings`, модель `text-embedding-3-small`.
- Fallback-реализация: `LocalEmbeddingService` поверх отдельного микросервиса `embeddings.agent-lia.ru` (по аналогии с Vox), модель BGE-M3 или Multilingual-E5. Включается ENV-флагом `EMBEDDING_FALLBACK_LOCAL_URL`.
- Каскад: `EmbeddingFallbackService` пробует default → fallback → ошибка. Логирование `AiUsageLog` с `taskType=embedding`.

### Action items как первоклассная сущность

**Модель `Task`:**
```prisma
model Task {
  id                String       @id @default(cuid())
  meetingId         String
  meeting           Meeting      @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  userId            String       // владелец задачи (юзер, в чьём кабинете она)
  user              User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  title             String
  description       String?
  status            TaskStatus   @default(open)
  assignee          String?      // строка из транскрипта; в V2 связь с participant
  dueDate           DateTime?
  sourceStartMs     Int?
  sourceEndMs       Int?
  sourceQuote       String?      // дословная цитата из транскрипта
  confidence        Float?       // оценка уверенности AI (0..1)
  createdManually   Boolean      @default(false)
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt
  @@index([userId, status])
  @@index([meetingId])
}

enum TaskStatus { open in_progress done cancelled }
```

**API:**
- `GET /api/v1/tasks` — все задачи юзера, с фильтрами (status, assignee, dueDate range, meetingId).
- `GET /api/v1/meetings/:id/tasks` — задачи одной встречи.
- `POST /api/v1/meetings/:id/tasks` — создать вручную.
- `PATCH /api/v1/tasks/:id` — обновить (status, assignee, dueDate, title, description).
- `DELETE /api/v1/tasks/:id` — удалить.

**UI:**
- На странице встречи Tab `Action Items` — описано выше.
- На главной кабинета виджет «Открытые задачи».
- Отдельная страница `/tasks` — описано выше.

### AI-чат

**Фаза А — чат по одной встрече.**
- Все сообщения чата + полный транскрипт встречи помещаются в context window LLM.
- Реализация: `POST /api/v1/meetings/:id/chat { message: string, history: ChatMessage[] }` → ответ.
- Никаких embeddings, никакого RAG (retrieval-augmented generation, по-русски — «генерация с поиском») — текущие модели держат сотни тысяч токенов, одной встречи хватает.
- Suggested prompts по типу встречи (например, для `sales`: «Какие были возражения?», «Какой был next step?», «Что клиент сказал про цену?»).
- История чата хранится в `MeetingChatMessage`.

**Фаза Б — чат по архиву (cross-meeting).**
- Поверх `pgvector`. На вход — вопрос юзера; embedding вопроса; top-K похожих чанков из всех встреч этого юзера; LLM-ответ с цитированием источников.
- API: `POST /api/v1/chat { message: string, history: ChatMessage[], scope: 'all' | { meetingIds: string[] } }`.
- UI: на главной кабинета и в Settings → отдельный экран чата с историей.

**Модель `MeetingChatMessage`:**
```prisma
model MeetingChatMessage {
  id          String         @id @default(cuid())
  meetingId   String?        // null для cross-meeting
  userId      String
  role        ChatRole       // user | assistant
  content     String         @db.Text
  citations   Json?          // ссылки на куски транскрипта для assistant-сообщений
  createdAt   DateTime       @default(now())
  @@index([userId, createdAt])
  @@index([meetingId, createdAt])
}

enum ChatRole { user assistant }
```

**Модель `MeetingTranscriptChunk` (для Фазы Б):**
```prisma
model MeetingTranscriptChunk {
  id          String                          @id @default(cuid())
  meetingId   String
  meeting     Meeting                         @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  startMs     Int
  endMs       Int
  text        String                          @db.Text
  embedding   Unsupported("vector(1536)")?    // pgvector, размерность под text-embedding-3-small
  createdAt   DateTime                        @default(now())
  @@index([meetingId])
}
```

### Highlight clips и публичный шеринг

**Модель `MeetingHighlight`:**
```prisma
model MeetingHighlight {
  id              String         @id @default(cuid())
  meetingId       String
  meeting         Meeting        @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  createdBy       String
  startMs         Int
  endMs           Int
  title           String
  description     String?
  renderedMp4Key  String?        // S3-ключ, если рендер запрашивали
  renderStatus    RenderStatus   @default(none)
  createdAt       DateTime       @default(now())
  @@index([meetingId])
}

enum RenderStatus { none queued processing ready failed }
```

**Модель `MeetingShare`:**
```prisma
model MeetingShare {
  id                  String         @id @default(cuid())
  token               String         @unique
  meetingId           String
  meeting             Meeting        @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  createdBy           String
  allowVideo          Boolean        @default(true)
  allowTranscript     Boolean        @default(true)
  allowTasks          Boolean        @default(true)
  allowChapters       Boolean        @default(true)
  expiresAt           DateTime?      // null когда expirationDays был задан явно; всегда заполнен (1/7/14 дней)
  revokedAt           DateTime?
  viewCount           Int            @default(0)
  lastViewedAt        DateTime?
  createdAt           DateTime       @default(now())
  @@index([meetingId])
}
```

**Публичные роуты фронта** (без AppShell):
- `/share/<token>` — публичная страница встречи. Если `expiresAt < now` или `revokedAt` — лендинг «Эта ссылка больше недоступна» с CTA на `/signup`.
- `/share/clip/<token>` — публичная страница клипа.

### Templates как UX-объект

**Текущее состояние.** В Z уже есть 9 типов встреч (см. [meeting-types](second-brain/01_projects/meeting-types.md)) и `custom_prompt` для override шаблона. Но смена шаблона после встречи не поддерживается, и галерея шаблонов как UX-объекта тоже отсутствует.

**Что добавляется:**
- Галерея шаблонов на странице создания встречи (взамен текущего dropdown типа).
- Для каждого шаблона — карточка с описанием, примером отчёта, иконкой.
- На странице результата — кнопка `Регенерировать с другим шаблоном` → диалог выбора → задача в очередь, отчёт перегенерируется.
- Customizable sections: на этапе analyze AI генерит расширенный набор секций (Decisions / Blockers / Customer Needs / Action Items / Risks / Open Questions), а UI показывает только включённые юзером галочками.
- Сохранённые промпты юзера: модель `UserTemplate { userId, name, basedOnType, prompt, sectionsConfig }`. Появляется в галерее как «Мои шаблоны».

### Public API

**Authentication.** `Authorization: Bearer <api_key>`. Ключ хранится как hash, scopes `read` / `write` / `admin`.

**Endpoints:**
- `GET /api/v1/meetings` — список встреч юзера, с фильтрами и пагинацией.
- `GET /api/v1/meetings/:id` — мета встречи + AI-результат + участники.
- `GET /api/v1/meetings/:id/transcript` — транскрипт.
- `GET /api/v1/meetings/:id/chapters` — главы.
- `GET /api/v1/meetings/:id/tasks` — задачи встречи.
- `GET /api/v1/meetings/:id/highlights` — клипы.
- `POST /api/v1/meetings` — создать встречу программно.
- `DELETE /api/v1/meetings/:id` — удалить.
- `GET /api/v1/tasks` — все задачи юзера.
- `PATCH /api/v1/tasks/:id` — обновить.
- `POST /api/v1/meetings/:id/chat` — AI-чат.
- `POST /api/v1/chat` — cross-meeting AI-чат (Фаза Б).
- `GET /api/v1/me` — профиль.

**Documentation.** Swagger UI на `/api/v1/docs`. Все DTO с описаниями и примерами.

**Rate limiting.** 100 req/min на ключ default, конфигурируется в админке.

### Outgoing webhooks

**События:**
- `meeting.created` — при создании.
- `meeting.processing.started` — старт AI-pipeline.
- `meeting.completed` — все этапы AI готовы.
- `meeting.failed` — ошибка в pipeline.
- `task.created` / `task.updated` / `task.completed`.
- `share.viewed` — кто-то открыл публичную ссылку.
- `clip.created`.

**Подпись.** HMAC SHA256 секретом подписки в заголовке `X-Z-Signature`. Получатель проверяет совпадение.

**Retry.** Если ответ не 2xx или таймаут (10 секунд):
- Попытка 2 — через 30 секунд.
- Попытка 3 — через 5 минут.
- Попытка 4 — через 1 час.
- После 4-й попытки — статус `failed`, email уведомление хосту.

**Журнал доставок.**
```prisma
model WebhookSubscription {
  id              String              @id @default(cuid())
  userId          String
  url             String
  secret          String              // используется для HMAC-подписи
  events          String[]            // массив enum-имён событий
  status          WebhookStatus       @default(active)
  createdAt       DateTime            @default(now())
  @@index([userId])
}

model WebhookDelivery {
  id              String                 @id @default(cuid())
  subscriptionId  String
  subscription    WebhookSubscription    @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  event           String
  payload         Json
  attempts        Int                    @default(0)
  lastStatus      Int?                   // HTTP-код последней попытки
  lastResponse    String?                @db.Text
  status          DeliveryStatus         @default(pending)
  nextAttemptAt   DateTime?
  deliveredAt     DateTime?
  createdAt       DateTime               @default(now())
  @@index([subscriptionId, createdAt])
  @@index([nextAttemptAt])
}

enum WebhookStatus { active paused }
enum DeliveryStatus { pending retrying delivered failed }
```

### Интеграции (destinations)

**Модель:**
```prisma
model IntegrationDestination {
  id          String                @id @default(cuid())
  userId      String
  type        DestinationType
  name        String                // "Канал #sales"
  config      Json                  // {url, channel?, botToken?, chatId?, email?}
  createdAt   DateTime              @default(now())
}

enum DestinationType { email slack_webhook telegram_bot generic_webhook }
```

**UX:**
- В диалоге `Отправить в...` (на странице встречи, на задаче, на клипе) — выбор одного или нескольких destinations + опционально что отправлять (весь отчёт / только summary / только action items / только клип).
- В каждом destination — кнопка `Отправить тестовое сообщение`.

**Шаблоны сообщений:**
- Email — html-письмо с summary + action items + ссылкой на встречу.
- Slack — markdown-блоки с эмодзи (компактно).
- Telegram — markdown с эмодзи.
- Generic webhook — JSON-payload, тот же что и в outgoing webhooks для соответствующего события.

### Массовые действия и теги

**Модель:**
```prisma
model Tag {
  id        String       @id @default(cuid())
  userId    String
  name      String
  color     String       @default("#888888")
  createdAt DateTime     @default(now())
  meetings  MeetingTag[]
  @@unique([userId, name])
}

model MeetingTag {
  meetingId String
  meeting   Meeting   @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  tagId     String
  tag       Tag       @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@id([meetingId, tagId])
}
```

**API:**
- `GET /api/v1/tags` — теги юзера.
- `POST /api/v1/tags` — создать.
- `PATCH /api/v1/tags/:id` — переименовать или поменять цвет.
- `DELETE /api/v1/tags/:id` — удалить (вместе с связями).
- `POST /api/v1/meetings/bulk/tag` — навесить теги массово.
- `POST /api/v1/meetings/bulk/delete` — удалить массово.
- `POST /api/v1/meetings/bulk/export` — поставить экспорт ZIP в очередь.
- `GET /api/v1/exports` — список экспортов юзера.
- `GET /api/v1/exports/:id/download` — скачать (presigned URL).

**Экспорт ZIP:**
- Воркер `export-zip-worker` в BullMQ.
- Для каждой выбранной встречи — markdown с отчётом + опционально транскрипт + опционально аудиодорожки (по чекбоксам в диалоге).
- ZIP кладётся в S3 с retention 7 дней (после — удаляется).
- Email юзеру по готовности + уведомление в кабинете.

### Видео-плеер

**Стек.** `@vidstack/react` (MIT).

**Компонент `<MeetingVideoPlayer>`:**
- Пропсы: `src`, `chapters`, `clips`, `transcript`, `onTimeUpdate`, `onClipCreate?`, `currentClipBounds?`.
- Маркеры на timeline:
  - Большие — главы, при наведении показывают title.
  - Точечные — клипы, при наведении показывают title и автора.
- Кнопка скорости 1x / 1.25 / 1.5 / 2x.
- PIP (picture-in-picture).
- Шорткаты: пробел (play/pause), стрелки (±5 сек), J/K/L (±10 сек), цифры (0..9 — на 0..90% длины).
- Кнопка `Копировать ссылку с текущего момента` (формирует URL с `?t=750` и пишет в clipboard).
- Subtitles: WebVTT-track, генерируется на лету из транскрипта.

**Использование:** страница встречи, страница публичного шеринга, страница клипа. Один компонент.

## Семь решений (что выбрали и почему)

В ходе обсуждения с владельцем продукта согласованы семь ключевых развилок. Краткое резюме (полная аргументация — в чате обсуждения).

1. **AI-чат и поиск.** Чат по одной встрече без embeddings (Фаза А — весь транскрипт в context window) + cross-meeting search и chat по архиву (Фаза Б — pgvector). Обе фазы в одном ТЗ. Внешние vector-store отвергнуты — pgvector в нашей PostgreSQL.
2. **Публичный шеринг.** Тумблеры (видео / транскрипт / задачи / главы) + срок жизни 1 / 7 / 14 дней (default 7). Без бессрочных ссылок. После истечения — лендинг с CTA на регистрацию. Пароль на ссылку отвергнут — это V2.
3. **Интеграции.** Email + Slack webhook + Telegram bot + Generic webhook. **Плюс** publici REST API + personal API keys + outgoing webhook subscriptions с HMAC и retry. OAuth-портфель CRM/PM — vNext.
4. **Highlight clips.** Гибрид: запись в БД мгновенно (для шеринга по ссылке с авто-перемоткой) + рендер MP4 по запросу через ffmpeg-воркер. Кэширование по `clipId`.
5. **Массовые действия.** Чекбоксы + toolbar `Удалить / Теги / Экспорт ZIP`. Теги — отдельная сущность. Экспорт асинхронно через BullMQ. Массовая отправка в webhook отвергнута — покрывается Public API.
6. **AI-инфраструктура.** `LlmRouter` поверх существующего fallback-каскада с маршрутизацией по типу задачи через админку. Embeddings — OpenAI через `proxy.agent-lia.ru` (default) + локальный микросервис BGE-M3 (опциональный fallback по ENV).
7. **Видео-плеер.** Vidstack (`@vidstack/react`, MIT). Свой плеер с нуля, video.js, Plyr — отвергнуты.

## Что отложено в vNext (с обоснованием)

- **Live-dashboard во время встречи** (метрики WPM/sentiment в реальном времени, как у Read.ai). Это другая задача — не страница результата, а само приложение комнаты. Большая работа поверх LiveKit. Не блокирует core value «качественный recap после встречи».
- **Granola-стиль «юзер пишет — AI дополняет»**. Требует in-meeting note editor — отдельный редактор внутри комнаты со своим состоянием и синхронизацией. Красиво, но дорого. Не закрывает базовый функционал.
- **Реальные OAuth-коннекторы Slack / Salesforce / HubSpot / Asana / Notion**. Каждая интеграция — это регистрация app у вендора, ревью, поддержка. Месяцы разработки на каждую. Generic webhook + Zapier закрывают 95% сценариев косвенно.
- **Multi-language autodetect**. ASR Vox/GigaAM поддерживает русский и английский — конфигурируется на уровне модели. Автодетекция языка во время встречи — отдельная фича Vox, требует валидации на наших звонках.
- **Manual speaker reassignment в транскрипте** (как у tl;dv). Полезно при ошибках speaker-диаризации, но в Z спикеры идут отдельными аудиодорожками — путаницы быть не должно. Если будут жалобы — добавим.
- **Smart trackers** (как у Avoma) — кросс-meeting tracking концептов («любое упоминание скидки»). Похоже на cross-meeting AI-чат, но более автоматизированно. Можно сделать поверх pgvector + savedQueries в V2.
- **Quality rating секций** (палец вверх / вниз для улучшения модели, как у Fireflies). Полезный фидбек-цикл, но требует пайплайна обработки fine-tuning. V2.

## Зависимости и риски

### Жёсткие зависимости

- **standalone-product ТЗ должен быть реализован** (или хотя бы Фаза 1 — дизайн-система shadcn/ui и AppShell). Иначе новая страница встречи окажется визуально несовместимой с остальным кабинетом.
- **pgvector** — должен быть установлен в PostgreSQL. Это extension, ставится одной командой `CREATE EXTENSION vector;`. На Yandex Cloud Managed PostgreSQL поддерживается.
- **ffmpeg на сервере backend** — должен быть доступен в рантайме (или в отдельном Docker-образе для воркера). Уже стоит для других задач AI-pipeline (проверить).
- **Локальный embedding-сервис** (опциональный fallback) — отдельная инфра, аналогично Vox. Если не разворачивать — работаем только через OpenAI proxy. На старте V1 можно без него.

### Технические риски

- **Stoимость embeddings.** На объёме 100 встреч × 30 минут × ~3000 токенов = ~10 миллионов токенов в месяц. OpenAI text-embedding-3-small — $0.02/1M = $0.20/мес, дёшево. На объёме 10 000 встреч — $20/мес. Заметно. На объёме 100 000 — $200/мес. На больших объёмах локальный fallback окупается.
- **Размер context window LLM в Фазе А чата.** Длинная встреча (3 часа) — ~50 тысяч токенов транскрипта. Claude Sonnet держит до 200K, GPT-5 — до 1M. Не блокирует, но если встречи будут по 10+ часов — упрёмся.
- **Scaling pgvector.** На 100K встречах × 100 чанков = 10M векторов в одной таблице. pgvector умеет HNSW-индексы — производительность хорошая, но мониторим. На больших объёмах — потенциальный план миграции на отдельный vector store.
- **ffmpeg latency при рендере клипа.** Вырезка 30-секундного клипа из 1-часовой записи занимает 5–15 секунд на Hetzner-сервере. Юзер ждёт. UX: показываем прогресс, шлём уведомление в кабинете.
- **Webhook retry и DDoS защита.** Если у юзера 1000 встреч и он подписался на `meeting.completed` с битым URL — мы будем долбить его сервер. Retry с exponential backoff и failure-cap решают это.
- **Rate limiting public API.** 100 req/min на ключ — ок для индивидуальных юзеров. B2B-клиент с тяжёлым ETL может упереться. Конфиг через админку.

### Продуктовые риски

- **Перегруз UI.** Трёхколоночный layout с табами и AI-чатом справа — много элементов. Если переусердствовать с информацией — юзер потеряется. Митигация: progressive disclosure (накапливаемое раскрытие), чистая дизайн-система shadcn, каждая колонка может быть свёрнута.
- **AI-чат не достаточно умный.** Если ответы слабые — юзер разочарован после первого использования и не возвращается. Митигация: suggested prompts по типу встречи, citations с jump-to-time, явные пометки «не уверен» при низкой confidence модели.
- **Action items — мусор.** Если AI извлекает неточно — юзер тратит время на ручную правку и решает, что проще писать руками. Митигация: confidence-score, возможность добавить вручную, сохранение source-quote для верификации.
- **Шеринг с тумблерами — путаница в правах.** Юзер случайно оставляет включённым транскрипт, утечка данных. Митигация: default-конфиг — только summary и tasks, видео и транскрипт **выключены** при создании ссылки. Юзер должен явно включить.

## Затраты (грубая оценка)

Бэкенд:
- Action items как сущность + API + миграции: ~3 дня.
- AI-чат фаза А: ~3 дня.
- AI-чат фаза Б + pgvector + embedding service + indexer worker: ~6 дней.
- Smart chapters worker + модель: ~2 дня.
- Public API + Swagger + rate limiting + API keys: ~5 дней.
- Outgoing webhooks subscriptions + HMAC + retry + журнал доставок: ~5 дней.
- Integration destinations (Email/Slack/Telegram/Generic): ~3 дня.
- Highlight clips модель + API + рендер MP4 worker: ~4 дня.
- Public sharing + tokens + публичные роуты: ~3 дня.
- Tags + bulk actions + ZIP export worker: ~3 дня.
- LlmRouter + admin UI: ~3 дня.
- Локальный embedding microservice (опционально): ~3 дня.

Фронтенд:
- Перевод страницы встречи на 3-колоночный layout с табами: ~5 дней.
- Vidstack-плеер с маркерами и связкой с транскриптом: ~3 дня.
- AI-чат панель + suggested prompts + citations: ~3 дня.
- Tab Action Items с inline-edit + Add manually: ~2 дня.
- Tab Chapters с DR2-accordion: ~2 дня.
- Tab Transcript с двусторонней синхронизацией: ~2 дня.
- Smart sharing dialog с тумблерами и сроком: ~2 дня.
- Highlight clip creator (выделение фрагмента): ~2 дня.
- Templates gallery + смена шаблона post-hoc: ~2 дня.
- Customizable sections UI: ~1 день.
- Settings → Tags / Integrations / API / Webhooks / Exports: ~5 дней.
- Главная-дашборд: ~2 дня.
- Страница My Tasks: ~2 дня.
- Чекбоксы и toolbar в журнале: ~2 дня.
- Публичная страница `/share/<token>` + лендинг истёкшей ссылки: ~2 дня.
- Cross-meeting AI-чат UI: ~2 дня.

**Итого:** ~50 дней бэкенда + ~37 дней фронтенда. Учитывая параллелизм (один разработчик не может делать всё одновременно, но интерфейсы можно декларировать заранее) — **реалистичный срок одной командой 1.5–3 человека: 2.5–4 месяца**. ТЗ распишет фазы так, чтобы первые рабочие куски появлялись через 2–3 недели, а полный функционал — постепенно.

## Открытые вопросы

- [ ] Бенчмарк локальной embedding-модели на наших данных (BGE-M3 vs Multilingual-E5) — кого выбираем? Решается на этапе разработки фазы embeddings.
- [ ] Нужна ли отдельная лицензия Vidstack для коммерческого использования? Проверить условия MIT-лицензии. Скорее всего нет, но юриспруденческая верификация обязательна.
- [ ] Конфликт с retention аудиозаписей и embeddings: если запись удалили, нужно ли удалять embeddings? Скорее да, но сценарии compliance / GDPR — обсудить.
- [ ] Кто получает уведомление о webhook-failure: только хост или ещё кто-то (admin)? Сейчас — только хост.
- [ ] Custom-prompt и customizable sections — как сочетаются? Если юзер задал custom_prompt при создании, customizable sections игнорируются (custom output всегда markdown). Подтвердить.

## Решения принятые в ходе обсуждения

См. секцию «Семь решений» выше.

## Следующий шаг

→ ТЗ: [plans/tz/2026-05-09-ai-meeting-workspace.md](plans/tz/2026-05-09-ai-meeting-workspace.md) (будет написан после ревью этого analysis-документа).
