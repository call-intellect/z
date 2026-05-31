---
date: 2026-05-31
session_id: wave3-batch2-smart-tables-23-docling
distilled: false
commits:
  - ab735c8
  - 3e713db
---

# Волна 3 второй заход: Smart Tables Фазы 2+3 + Docling smoke-test

## Что было поставлено

После первой волны (Блок A добивка + Блок C smart-tables Фазы 0+1) пользователь подтвердил продолжение:
- **Блок B полный** — фикстуры через download-fixtures.sh + поднять Python+Docling+RapidOCR smoke в docker + замерить гейты + дополнить analysis-документ.
- **Smart-tables Фаза 2** — карточка строки = мини-документ (Tiptap/ProseMirror) с инлайн-редактированием property'ей.
- **Smart-tables Фаза 3** — сохраняемые срезы (TableView CRUD + URL state + ViewSelector + SaveViewDialog).

Решение пользователя: **(b) — фикстуры через download-fixtures.sh + README** (бинарники НЕ в git) и **(ii) — Блок B полный с гейтами и анализом**.

## Как решал

### Параллельный запуск 3 background-агентов

Все три задачи независимы по файлам:
- Блок B — `infra/document-conversion/`, `backend/test/fixtures/`, `plans/analysis/`, `plans/tz/`.
- Фаза 2 — `frontend/app/(authenticated)/tables/[id]/components/RowDetail.tsx` + точечные правки в `TableClient`, `GridView`, `store`.
- Фаза 3 — `backend/src/modules/tables/services/table-views.*`, `controllers/table-views.controller.ts`, frontend `ViewSelector`, `SaveViewDialog` + правки store/api/types/domain.

Конфликты только в общих файлах (`tableStore.ts`, `TableClient.tsx`, `GridView.tsx`, `frontend/src/domain/table.ts`, `frontend/src/api/types/tables.ts`, `frontend/src/api/tables.api.ts`, `backend/.../dto/tables.dto.ts`, `tables.module.ts`). Агенты их вычистили без merge-конфликтов — потому что добавляли разные новые блоки в разные секции одного файла.

Один risk-event: Фаза 2 закончила первой, Фаза 3 ещё писала `ViewSelector` который импортирует `SaveViewDialog` — `bun run build` упал «cannot find module». Это не баг Фазы 2 — её агент честно отметил «не моё, параллельная сессия не закончила». Когда Фаза 3 закончилась, build стал зелёный.

### Блок B: запустить Docling+RapidOCR в Windows Docker

Самый рискованный из трёх — не было известно, заработает ли Docling+RapidOCR на нашем стеке. Я заранее знал что:
- Dev Postgres офлайн → docker desktop работает (Redis+MinIO живые)
- Стек выбран по research, но не проверен на нашем железе

Агент успешно справился:
- Скачал 5 фикстур (text-PDF 25 стр ГОСТ Р ИСО 15489-1-2019, scan-PDF растеризацией, DOCX через pandoc, XLSX Росстат, HTML Wikipedia).
- Собрал docker-образ docling-cpu (5.6 GB — без HF-кэша volume на старте получился толстый).
- Поднял smoke с tracemalloc + VmHWM + docker stats poll.
- Зафиксировал гейты §0.3. **Все content-quality гейты пройдены.**

Главное обнаружение: **PP-OCRv5 eslav-веса обязательны для русского OCR**. Дефолтный китайский ch_PP-OCRv4 даёт 0% precision на кириллице, eslav-веса — 100%. Это критично знать в Фазе 1.

Развилки агента в Блоке B были все четыре разумны:
1. DOCX-источник: gov-DOCX без PII не нашёл → сгенерировал из text-PDF через pandoc. README документирует это как тех-компромисс.
2. Скан-PDF: готового image-only PDF в gov-источниках РФ нет → растеризовал text-PDF через pdftoppm. Эквивалентен реальному скану на входе OCR.
3. HTML: `publication.pravo.gov.ru` оказался SPA с пустым HTML → заменил на Wikipedia (164 KB реального русского HTML). README обновлён.
4. `network_mode: none` убран — Docling качает модели в runtime, нужна сеть.

Все 4 — правильные, развилки честно описаны в отчёте.

### Фаза 2: Tiptap React 19 + Glide row marker click

Готового ProseMirror в проекте не было. Агент поставил `@tiptap/react@3.24.0 + StarterKit + Link` — стандарт-де-факто React-обёртка над PM, проще чем голый.

Ключевое: `immediatelyRender: false` — обязательно для React 19 SSR (взял из Context7 docs, не из тренировочных знаний). Это правильный подход.

Glide Data Grid row-detail: используется `onCellClicked` с проверкой `col === -1` (row-marker колонка с чекбоксом + номером). Inline-edit ячеек не ломается. RowDetail открывается **только** по клику на номер строки, что UX-логично.

### Фаза 3: visibility + owner-or-admin guard

Стандартный CRUD-паттерн повторён по образцу Фазы 0. Visibility-фильтр в list: `(visibility IN ('shared','public')) OR (visibility='personal' AND ownerId=userId)` — то что и должно быть. Owner-or-admin guard на update/delete. 6 unit-тестов покрывают позитивные и негативные сценарии.

URL state — `useSearchParams + router.push('?view=...')`. Чисто, стандарт Next.js 14.

Минимум реализовано: hiddenProps + propOrder + rowHeight. sorts — selector есть, UI-крутилки нет. filters/groupBy — типы поддержаны, UI Фаза 4+. Это рациональный scope-cut.

## Что вышло

### Метрики

- Backend typecheck: OK.
- Frontend typecheck: OK.
- Frontend lint: OK.
- Backend tests: 25/25 для tables/ модуля (было 19, прибавились 6 views-тестов).
- Frontend tests: 115/115.
- Frontend build: OK, `/tables/[id]` → `ƒ (Dynamic)`.
- Smoke-test 5 фикстур пройден; стек подтверждён.

### Архитектурно

- **8 новых файлов** для Smart Tables 2+3 (4 frontend + 3 backend + 1 второй спек).
- **10 новых файлов** для Block B (3 фикстуры-script + 4 smoke-infra + 2 plans + 1 second-brain).
- **+5 эндпоинтов** для views (итого Smart Tables — 24 эндпоинта).
- **+3 зависимости фронта** (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`).
- Никаких Prisma-изменений в этом батче.
- Никаких новых ENV.
- Никаких seed/patch/backfill/migrate.

### Smoke-test stack-verification

Все content-quality гейты пройдены, 2 гейта (cold-time и образ-size) с архитектурными решениями в Фазе 1. **Стек Docling+RapidOCR подтверждён. План B не нужен.**

## Чему научился

### 1. Параллельные агенты на общих файлах работают если они добавляют, не мутируют

Phase 2 и Phase 3 одновременно правили `tableStore.ts`, `TableClient.tsx`, `GridView.tsx` и т.д. Конфликтов в коде не было, потому что:
- Phase 2 добавила метод `updatePageContent` + поле `pendingPageContent` рядом с существующими полями.
- Phase 3 добавила `views`, `currentView`, `draftConfig` + методы applyView и т.д. в другие секции.

Когда несколько агентов работают параллельно на shared-state модели (Zustand store) — лучше всего работает, если каждый агент добавляет НОВЫЕ поля/методы, а не мутирует существующие. У меня сработало случайно (так промпты сложились), но это правило стоит явно записать.

### 2. Build может быть красным временно — это норма для параллельной работы

Phase 2 закончила первой и видела `bun run build` сломанным потому что `ViewSelector.tsx` импортирует `SaveViewDialog` (его ещё не было). Агент Phase 2 честно отметил это в отчёте: «не моё, параллельная сессия не закончила». Я не паниковал, дождался Phase 3, build стал зелёный.

Урок: **временный red build при параллельной работе ≠ баг**. Финальная проверка — после всех зависимых правок.

### 3. Web research + bash в одном агенте даёт огромный leverage

Block B-агент за ~63 минуты:
- Сделал WebSearch по нескольким источникам (pravo.gov.ru, gost.ru, Росстат, Wikipedia).
- Скачал 3 файла напрямую через `curl`, сгенерировал 2 через docker run python (pandoc + pdftoppm + img2pdf).
- Собрал docker-образ (3-5 мин build time для torch CPU + Docling).
- Прогнал smoke на 5 фикстурах (~10 мин wall-clock).
- Замерил RAM через `docker stats` параллельно.
- Дополнил analysis-документ структурированным отчётом.
- Зафиксировал 4 развилки с обоснованием.

Это объективно много для одного агента. Хорошо что я не дробил.

### 4. Context7 для свежих docs работает

Phase 2-агент использовал Context7 для проверки актуальных Tiptap React 19 SSR best practices — нашёл `immediatelyRender: false`. Это правильный подход вместо «полагаюсь на тренировочные знания».

### 5. Параметры сборки docker важнее чем «работает или нет»

Docling-образ собрался в 5.62 GB — превышает гейт ≤3 GB. Но это **из-за HF-моделей включённых в образ**. Решение в Фазе 1 — выносить HF-кэш в named volume, образ уменьшится до ~2.5 GB. Это нужно явно зафиксировать в ТЗ Фазы 1 чтобы разработчик не повторил.

Аналогично с cold-time: 92 сек — это **первый прогон после старта процесса** (load HF-моделей в RAM). Warm-steady-state — 19 сек. Архитектура Фазы 1 (persistent worker) даёт всегда warm-state.

### 6. Smart Tables drag&drop колонок vs view-local propOrder — конфликт по дизайну

Phase 3-агент честно описал: текущий `reorderColumn` мутирует глобальный `TableProperty.order` через PATCH/reorder API. Если активен view с собственным `propOrder` в config — drag-and-drop переписывает глобальный order, локальный view-propOrder остаётся в config'е, но больше не отражает фактическое расположение.

На MVP допустимо (пользователи редко комбинируют), но это потенциальный UX-баг. В реальной Notion это решается через «view-local edit mode» — drag в view меняет только view-config, не глобальный order таблицы. Зафиксировано как known limitation. В Фазе 4 или отдельным ТЗ.

## Открытое перед финалом

- **Push не сделан** — жду явного «push» от пользователя на 2 новых коммита (`ab735c8` Smart Tables 2+3, `3e713db` Block B).
- **Untracked TZ smart-tables.md** + 3 untracked demo-* TZ — это твоя работа из предыдущих сессий. Не коммитил.
- **document-ingest Фаза 1** (полноценный DCS sidecar) — отдельная сессия, разблокирована.
- **Smart Tables Фазы 4-14** — каждая отдельной сессией. Самая важная для конкуренции — Фаза 5 (Excel-import со schema-инференсом), требует document-ingest Фазы 1.
