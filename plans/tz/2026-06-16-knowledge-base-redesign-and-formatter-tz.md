---
type: tz
status: ready-to-implement
feature: knowledge-base-redesign-and-formatter
date: 2026-06-16
owner: Сергей (владелец продукта)
relates_to:
  - plans/analysis/2026-06-16-knowledge-base-ux-and-formatter.md
  - plans/analysis/2026-06-16-knowledge-base-mockup.html
  - plans/tz/2026-06-14-cabinet-master-fixes-referral-and-hub.md
  - second-brain/01_projects/regulations.md
  - second-brain/03_processes/specialist-3-1-regulations.md
---
> Анализ: `plans/analysis/2026-06-16-knowledge-base-ux-and-formatter.md` · Макет (одобрен): `plans/analysis/2026-06-16-knowledge-base-mockup.html` · Статус согласования: 2026-06-16 (Р1–Р4 + В1 подтверждены владельцем в сессии).

# ТЗ — База знаний: форматтер на создании + редизайн раздела

**Принцип:** раздел «Правила, процессы и политики» сейчас читается как лог экстракции (сырой абзац в тесной раскладке), а не как база знаний. Чиним четыре независимых вектора: тело документа (бэк-форматтер), информационная архитектура + ширина (фронт), нейминг/таксономия, целостность ручной загрузки.

**Вне scope / отложено владельцем:**
- Граф-вид (режим «Граф») — отдельная фаза/ТЗ позже (в макете только тизер).
- Синхронизация `steps[]` компилятора с таблицей `ProcessStep` — остаётся как есть (single-step upsert из `processStepHint`); это «следующая волна» по комментарию [specialist-3-1-regulations.service.ts:682](backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts#L682).
- Перенос промптов в admin-editable registry — они живут в коде, правка = коммит (как сейчас).

---

## Цель + Зачем

**Болезненное состояние (по коду, верифицировано):**
1. Новая карточка сохраняет в тело сырой одноабзацный `statement` от экстрактора — агент-компилятор есть, но зовётся только при слиянии версий. Большинство тем упоминают один раз → второго блока нет → карточка навсегда сырой абзац. Инструкции — компилятор не зовётся вообще.
2. Раздел зажат в `max-w-6xl` + master-detail без левой навигации → «узко, не похоже на базу знаний».
3. Нейминг разнобойный (меню «Оцифровано» / заголовок «Правила, процессы и политики» / маршрут `/regulations`); «Стандарт» торчит отдельным фильтром, хотя это метка внутри регламента; счётчики-чипы (по всем 4 таблицам) рассинхронены со списком (по одному типу) → «9 политик / Всего: 1».
4. Документ, загруженный вручную с пометкой «регламент», НЕ гарантированно становится карточкой нужного типа — `docType` не влияет на классификацию, решает LLM заново.

**Чем решение лучше:** каждая карточка структурна с первой версии; раздел — настоящая база знаний (дерево-папки, широкая оболочка, читаемая колонка, оглавление); внятная таксономия; ручная загрузка детерминирована. Доказательная база и ландшафт аналогов (GitBook/Notion/Document360/Confluence + RU) — в анализе, не дублируем.

---

## REALITY-CHECK (фактический статус по коду на 2026-06-16)

| Что | Факт | Вывод для ТЗ |
|---|---|---|
| Агент-форматтер `compile-org-document` | СУЩЕСТВУЕТ и работает (`StructuredDocumentCompilerService`, [structured-document-compiler.service.ts:67](backend/src/modules/knowledge-core/services/structured-document-compiler.service.ts#L67)), умеет regulation/process/policy/**instruction** (`ORG_DOCUMENT_KINDS`), best-effort, kill-switch `docCompilerEnabled` (ON) | Не строим новый агент — **подключаем существующий на создании**. `tryCompileContent` уже параметризован `kind`. |
| Вызов компилятора | Только в ветке `merge/extension`: regulation [:457](backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts#L457), process [:687](backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts#L687), policy [:949](backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts#L949). Instruction — **нет вызова вообще** | Добавить вызов в ветку `new` для reg/proc/pol + завести его для instruction. |
| Тело новой карточки | `contentMd = draft.statement` (reg [:409](backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts#L409), pol [:895](backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts#L895), instr [:1145](backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts#L1145)); process → `description = draft.statement` ([:645](backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts#L645)) | Заменить на `compiled.contentMd` при успехе, иначе fallback. |
| Версионирование | `CardVersion` ([schema.prisma:3920](backend/prisma/schema.prisma#L3920)) создаётся на merge в транзакции ([:470-509](backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts#L470)) | На create-с-компиляцией зеркалим: CardVersion v1, trustTier `auto`. |
| Рендер фронта | Markdown парсится корректно (`ContentMarkdown`, react-markdown, [RegulationsListClient.tsx:1021](frontend/app/(authenticated)/regulations/RegulationsListClient.tsx#L1021)) | Рендер НЕ трогаем по сути — меняем раскладку вокруг + ширину колонки. |
| Дизайн-язык | Новый принят: токены [modern/tokens.ts](frontend/src/ui/components/dashboard/modern/tokens.ts) (`glass()`/`GRAD`/`MODERN_PAGE_BG`), эталон `/redesign` | Редизайн на этих токенах. |
| Ручная загрузка | `DocumentIngestAdapter` уже кладёт `docType` в payload ([document.adapter.ts:191](backend/src/modules/ingest/adapters/document/document.adapter.ts#L191)), но НЕ `signalTypeHint`; механизм override существует ([block-ingest.worker.ts:976](backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L976), исп. TrackerAdapter) | Почин малый — добавить `signalTypeHint` из `docType` в payload. |

---

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | Компилятор `compile-org-document` зовётся **на создании** карточки (reg/proc/pol) + **подключён для instruction**; каждая карточка структурна с v1. Плюс разовый backfill старых плоских карточек. | Корень «стены текста» — компилятор простаивает на самом частом пути (single-mention → new, без merge). |
| Р2 | Редизайн раскладки по макету: широкая оболочка + левое дерево-папки + колонка чтения ~720px + правый TOC + тумблер ширины, на новом дизайн-языке. | «Узость» — ложное противоречие: расширяем хром, текст держим в читаемой колонке (Wikipedia/Carbon/Notion). |
| Р3 | Раздел = «База знаний компании». 4 типа-папки: **Регламенты · Процессы · Политики · Инструкции** («Политика» сохраняет имя). «Стандарт» — метка внутри регламента, не отдельный фильтр. Свести дубль «Шаблоны процессов»+«Процессы». Счётчики не вводят в заблуждение. | Текущий нейминг разнобоен и неполон; «Стандарт» — `category` внутри Regulation; чипы рассинхронены со списком. |
| Р4 | В промпт `regulation-extract` добавить границу «регламент = порядок по шагам / политика = принцип без процедуры». | regulation↔policy — самая размытая граница, агент путает. |
| В1 | Починить ручную загрузку: `docType → signalTypeHint` в `DocumentIngestAdapter`. | Ментальный сценарий владельца «написал регламент → попал в базу и перепроверился» должен работать буквально. |
| В2 | Светлая тема реализуется **СРАЗУ**: Ф5 строится на theme-aware токенах (`tokens.css` блоки `[data-theme='dark'\|'light']`), раздел отполирован и проверен в обеих темах. | Владелец: визуал светлой темы нужен сразу, не откладывать. Механизм тем уже готов (`ThemeProvider` + `ThemeToggle` + `tokens.css` light/dark) — нужно лишь строить на `var(--*)`, не на жёстких цветах. |

---

## Доказательство выбора (форматтер на создании)

Полная матрица вариантов — в анализе §5.1. Сведение двух проходов по архитектуре ВЫЗОВА:

| Критерий | A. Компилятор синхронно в ветке `new` (переиспользуем `tryCompileContent`) | B. Отдельный async-job `format-card` после создания |
|---|---|---|
| Гарантия «структурно с v1» | ✓ карточка сразу структурна | ✗ карточка временно сырая до отработки job |
| Объём кода / инфра | ✓ минимум — тот же путь, что merge | ✗ новая очередь/воркер/идемпотентность job |
| Согласованность с merge-веткой | ✓ идентичный механизм | ✗ два разных пути сборки |
| Нагрузка воркера | ✗ +1 LLM-вызов синхронно в `core.specialist-routing` | ✓ вынесено из основного пути |
| Защита от сбоя | ✓ best-effort fallback уже встроен (`tryCompileContent` → null → legacy) | ✓ |

**Выбор — A.** Воркер уже делает extract + dedupe LLM-вызовы; один компилятор-вызов маргинален, защищён `docCompilerEnabled` (kill-switch) и best-effort fallback. B добавляет инфраструктуру ради выноса нагрузки, которой при текущем масштабе нет (преждевременная оптимизация; триггер пересмотра — если очередь `core.specialist-routing` начнёт копить лаг >N мин при норме создания карточек). **Challenge-loop:** (1) корень, не симптом — да, чиним весь КЛАСС (все 4 типа на создании), не одну карточку; (2) эффективнее некуда — переиспользуем готовый сервис; (3) нет кода ради кода — новой инфры ноль.

---

## Scope

**Входит:** вызов компилятора на создании (reg/proc/pol/instr) + CardVersion v1; backfill старых карточек; граница в промпте экстрактора; редизайн раскладки + нейминг/таксономия/счётчики; `docType→signalTypeHint`; парные токены светлой темы.

**Не входит** (каждый — с судьбой): граф-вид (vNext); визуал светлой темы (дизайн владельца); steps↔ProcessStep sync (как есть); admin-editable промпты (как есть); импорт Notion/Confluence (вне этой фичи — см. `plans/analysis/2026-06-08-manual-document-upload-and-import.md`).

## Граничные контракты с другими ТЗ
- Эндпоинты `/regulations/*` и `/processes/*` — контракт НЕ меняем (фронт-редизайн потребляет существующие DTO). Если в Ф4 понадобится поле для «всего в базе vs найдено» — оно уже есть (`/regulations/summary` + `list.total`), новых полей не вводим.
- `DocumentAttributionService` (ТЗ-4 Ф10) не трогаем — Ф6 добавляет `signalTypeHint` рядом, не пересекаясь с suggestForDocument.

---

## Требования (R1–R12, EARS)

- **R1** — Когда создаётся новая карточка regulation/process/policy при `docCompilerEnabled=ON` и успешном LLM, система shall сохранить структурный `contentMd`/`description` от компилятора (не сырой `statement`).
- **R2** — Система shall вызывать компилятор для `instruction` (на создании и обновлении); сейчас не вызывает вообще.
- **R3** — При успешной компиляции на создании reg/proc/pol система shall создать `CardVersion` v1 (`trustTier=auto`, `previousVersionId=null`).
- **R4** — Если компилятор вернул `null` (kill-switch OFF или ошибка LLM), система shall сохранить `draft.statement` (legacy-поведение сохранено).
- **R5** — Backfill-скрипт shall переразметить плоские карточки и быть идемпотентным (повторный прогон = 0 обновлений); зарегистрирован в `STEPS` с `skipBootstrap`.
- **R6** — Промпт `regulation-extract` shall содержать явную границу regulation↔policy.
- **R7** — Раздел и пункт меню shall называться «База знаний (компании)»; фильтры — 4 типа (Регламенты/Процессы/Политики/Инструкции); «Стандарт» не отдельный фильтр.
- **R8** — Счётчики-чипы и заголовок списка shall не противоречить (чип = «в базе», список = «найдено»).
- **R9** — Раскладка shall быть: оболочка 100% ширины + левое дерево + колонка чтения ~720px + правый TOC + тумблер ширины, на новом дизайн-языке; за kill-switch `knowledge_base.redesign.enabled` (ON).
- **R10** — «Шаблоны процессов» shall быть в разделе «Процессы» (нет отдельной верхней вкладки).
- **R11** — Когда документ загружен с `docType ∈ {regulation,process,policy,instruction}`, система shall проставить `signalTypeHint` → карточка нужного типа → триаж.
- **R12** — Раздел shall корректно отображаться и быть отполирован в **обеих** темах (тёмная + светлая) на theme-aware токенах (`tokens.css` `[data-theme]`); светлая тема работает сразу, переключается через `ThemeToggle`/настройку внешнего вида.

## Фазы

Граф зависимостей: **Ф1 → Ф2** (backfill переиспользует режим СОЗДАНИЕ). **Ф4 → Ф5** (раскладка потребляет нейминг/таксономию). **Ф3, Ф6** — независимы. Порядок выката (Ship-On, каждая фаза включена и самодостаточна): Ф1 → Ф2 → Ф3 → Ф6 → Ф4 → Ф5.

### Ф1 — Форматтер на создании карточки (backend)
**Цель:** новая карточка regulation/process/policy/instruction получает структурный `contentMd`/`description` через компилятор при создании.
**Файлы:** [specialist-3-1-regulations.service.ts](backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts) — `upsertRegulation` (ветка `new` :390-420), `upsertProcess` (:627-654), `upsertPolicy` (:889-895), `upsertInstruction` (:1125-1157), хелпер `tryCompileContent` (:1844). Якорь: строка `if (verdict.decision === 'new' || !verdict.targetId)`.
**Что входит:**
- В ветке `new` для reg/proc/pol: вызвать `tryCompileContent({ kind, tenantId, name: draft.name, existingContentMd: '', newStatement: draft.statement, block })` (режим СОЗДАНИЕ). Если вернулся не-null `compiled` → писать `compiled.contentMd` в `contentMd` (reg/pol) / `description` (proc) И создать `CardVersion` v1 в транзакции (зеркало merge-ветки :470-509: `resourceType`, `resourceId`, `version: 1`, `payload {contentMd, steps, signals, changeReasonText: compiled.changeReason}`, `changeReason: 'create'`, `trustTier: 'auto'`, `previousVersionId: null`; затем `currentVersionId: cv.id`, `version: 1`). Если `null` → текущее поведение (`contentMd = draft.statement`).
- В `upsertInstruction`: добавить тот же вызов `tryCompileContent({ kind: 'instruction', … })` (на create и на update-ветке); при успехе — `contentMd = compiled.contentMd`, иначе fallback `draft.statement`. Instruction версионируется опц. (CardVersion для instruction — по образцу, если currentVersionId поддержан; если нет — без CardVersion, только `contentMd`).
**Что НЕ входит:** изменение самого промпта компилятора; steps↔ProcessStep sync; merge-ветка (не трогаем).
**Контракт `tryCompileContent`** (существующий, [:1844](backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts#L1844)): принимает `{kind, tenantId, name, existingContentMd, newStatement, block}`, возвращает `CompileResult | null` (null = disabled/ошибка/пустой → caller использует legacy). Передавать `existingContentMd: ''` для режима СОЗДАНИЕ.
**Acceptance:**
- Новая reg/proc/pol/instr при `docCompilerEnabled=true` и успешном LLM → тело содержит markdown-структуру (есть `## ` или таблица `| `), `contentMd !== draft.statement`.
- `grep tryCompileContent` в `upsertInstruction` даёт ≥1 совпадение (раньше 0).
- При `docCompilerEnabled=false` или `tryCompileContent`→null → `contentMd === draft.statement` (legacy сохранён).
- На успешной компиляции reg/proc/pol создан `CardVersion` (version=1, trustTier=auto); `currentVersionId` проставлен.
- Unit-тест: мок компилятора → ветка `new` пишет `compiled.contentMd` + создаёт CardVersion; мок→null → пишет `draft.statement`, CardVersion не создаётся.
- `bun run typecheck && bun run lint && bun run build` зелёные; `bunx vitest run src/modules/knowledge-core/services/specialist-3-1-regulations.service.spec.ts`.
**Closes:** R1, R2, R3, R4.

### Ф2 — Backfill старых плоских карточек (backend, one-off)
**Цель:** уже накопленные карточки с сырым телом переразметить компилятором, идемпотентно.
**Файлы:** новый `backend/scripts/backfill-compile-flat-cards.ts`; регистрация в [apply-prod-deploy.ts](backend/scripts/apply-prod-deploy.ts) массив `STEPS` (структура `{ phase, script, hint?, skipBootstrap? }`, :45).
**Что входит:**
- Скрипт: `createPrismaClient()` из `scripts/_lib/prisma.ts` (НИКОГДА `new PrismaClient()`); импорты из `../src`. Для каждой Regulation/Policy/Instruction где тело «плоское» (предикат: `contentMd` НЕ содержит `'## '` и НЕ содержит `'\n| '` — нет заголовков/таблиц) и для Process по `description` — вызвать `StructuredDocumentCompilerService.compile({ kind, name, newSourceBlocks: [{name, answer: <statement|contentMd>}], existingContentMd: '' }, { tenantId, dataClass })`; при `ok` → обновить тело (+ CardVersion как в Ф1). Constrained — материал только из самого `statement` (компилятор по промпту не добавляет фактов).
- Идемпотентность: карточка с уже структурным телом (`'## '` present) пропускается → повторный прогон = 0 обновлений.
- Регистрация в `STEPS`: `{ phase: 'backfill', script: 'scripts/backfill-compile-flat-cards.ts', hint: 'переразметка плоских карточек базы знаний компилятором', skipBootstrap: true }` (только на update, не на bootstrap чистой БД).
**Что НЕ входит:** изменение схемы; массовый пересчёт embedding; смена модели роутинга компилятора (используем существующий taskType `compile-org-document`).
**Acceptance:**
- Прогон обновляет плоские карточки → тело структурно; второй прогон подряд → 0 обновлений (no-op, лог «нечего делать»).
- Скрипт в `STEPS` с `phase: 'backfill'`, `skipBootstrap: true`.
- `bun run typecheck` зелёный (вкл. скрипт); сухой прогон на dev-данных без ошибок.
**Closes:** R5.

### Ф3 — Граница regulation↔policy в промпте экстрактора (backend)
**Цель:** агент перестаёт путать регламент и политику.
**Файлы:** [regulation-extract.prompt.ts:31-37](backend/src/modules/knowledge-core/prompts/regulation-extract.prompt.ts#L31) (блок «Различай:»). Снапшот-тест (если есть `__snapshots__` для этого промпта — обновить).
**Что входит:** в SYSTEM после буллетов про policy добавить строку-границу, дословно: `'Граница regulation↔policy: регламент описывает ПОРЯДОК действий по шагам (кто, что, в каком порядке, сроки); политика задаёт ПРИНЦИП/правило без пошаговой процедуры (что можно/нельзя и на каких условиях). Есть последовательность шагов и ответственные → regulation; правило-принцип без процедуры → policy.'`
**Что НЕ входит:** перестройка остального промпта; изменение JSON-схемы.
**Совместимость с prompt caching:** добавка идёт в **стабильный SYSTEM** (не в user) → одноразовый busting кэша на выкате, дальше кэш восстанавливается. Это сознательная одноразовая правка SYSTEM (допустимо; см. `feedback_llm_prompts_cache_friendly` — минимизируем ЧАСТОТУ правок, не запрещаем их).
**Acceptance:**
- `grep 'Граница regulation↔policy'` в файле даёт совпадение.
- Снапшот-тест промпта обновлён и зелёный (`bunx vitest run` по затронутому `*.snapshot.spec.ts`).
- `bun run build` зелёный.
**Closes:** R6.

### Ф4 — Нейминг + таксономия + счётчики (frontend + минимум backend)
**Цель:** единое имя «База знаний компании», 4 типа-папки, «Стандарт» не отдельный фильтр, счётчики не вводят в заблуждение.
**Файлы:** [nav-config.ts](frontend/src/ui/components/app-shell/nav-config.ts) (пункт `/regulations`, label «Оцифровано» → переименовать); [RegulationsListClient.tsx](frontend/app/(authenticated)/regulations/RegulationsListClient.tsx) — заголовок/подзаголовок (:339-349), `KIND_FILTERS` (:86), `TOP_TABS` (:102), чипы-счётчики (:380-400), заголовок списка «Всего/Показано»; [src/domain/regulation.ts](frontend/src/domain/regulation.ts) (`REGULATION_KIND_LABEL`).
**Что входит:**
- Меню (nav-config): label пункта `/regulations` → «База знаний». Заголовок страницы → «База знаний компании», подзаголовок → «Кора оцифровала из ваших встреч и обсуждений».
- `KIND_FILTERS`: «Правила и стандарты» → «Регламенты»; оставить «Процессы», «Инструкции» (мн.ч.), «Политики». Значение `regulation` агрегирует regulation+standard (как сейчас) — «Стандарт» не вводим отдельным фильтром; стандарт показываем меткой-чипом внутри карточки регламента (по `category==='standard'`).
- Счётчики: чипы подписать «в базе: N» (источник `/regulations/summary`); заголовок списка — «найдено: {total}» вместо «Всего: 1. Показано: 1» (убрать рассинхрон «9 политик / Всего 1»).
**Что НЕ входит:** раскладка/дерево (это Ф5); изменение backend-эндпоинтов (контракт тот же).
**Acceptance:**
- В UI нет строки «Правила и стандарты» как фильтра; есть «Регламенты». Раздел/меню называются «База знаний (компании)».
- Чип и заголовок списка не противоречат друг другу (чип = «в базе», список = «найдено»).
- Весь видимый текст — на русском (нет английских слов в UI).
- `bun run typecheck && bun run lint && bun run build` (frontend) зелёные.
**Closes:** R7, R8.

### Ф5 — Редизайн раскладки (frontend) — за kill-switch
**Цель:** широкая оболочка + левое дерево-папки + читаемая колонка ~720px + правый TOC + тумблер ширины, на новом дизайн-языке; «Шаблоны процессов» сведены в раздел «Процессы».
**Файлы:** [RegulationsListClient.tsx](frontend/app/(authenticated)/regulations/RegulationsListClient.tsx) (раскладка :337-846, `TOP_TABS` :102, grid :494, `ProcessTemplatesClient`); токены [modern/tokens.ts](frontend/src/ui/components/dashboard/modern/tokens.ts); эталон `/redesign`; новый AdminSetting + seed.
**Эталон вида:** `plans/analysis/2026-06-16-knowledge-base-mockup.html` (одобрен дословно — это **тёмная** эталонная тема; в мокапе цвета заданы oklch-литералами для наглядности, **в реализации использовать `var(--*)`/`glass()`-токены**, чтобы светлая тема флипалась автоматически). Светлая тема — эталон `app/(design-preview)/light-theme/page.tsx`.
**Что входит:**
- Оболочка 100% ширины (убрать `max-w-6xl`); 3 зоны: дерево слева ~280px (Тип → Категория → карточки; хлебные крошки; сворачивание), центр — читаемая колонка `max-width: ~720px` (тумблер «Чтение/Широкий» снимает лимит), правый TOC ~260px + цитата-источник (липкий).
- Аннотированные строки списка: тип · статус · дата обновления · уверенность (полоска) · источник-встреча.
- Свести «Шаблоны процессов» (верхняя вкладка `TOP_TABS`) в раздел дерева «Процессы» (одна навигация, без отдельной верхней вкладки).
- Дизайн-язык: `glass()`/`GRAD`/`MODERN_PAGE_BG`; **парные цветовые токены** `bg-{color}` + `text-{color}-fg` (никогда `text-white` на цветном, без жёстких hex/slate/oklch-литералов). Строить ТОЛЬКО на theme-aware токенах (`var(--*)` из `tokens.css`, флип по `[data-theme]`) → **светлая тема работает сразу**; отполировать обе темы (R12).
- Kill-switch `knowledge_base.redesign.enabled` (ON): новый layout под флагом, старый — аварийный fallback. Новый `seed-admin-setting-knowledge-base-redesign.ts` (idempotent), регистрация в `STEPS` (`phase: 'seed-base'`), строка в `docs/operations/feature-flags.md`.
**Что НЕ входит:** граф-вид (тизер-заглушка ок, функционал — vNext); изменение DTO/эндпоинтов.
**Acceptance:**
- На широком экране: дерево слева, текст в колонке ≤~720px (не на всю ширину), TOC справа; тумблер «Широкий» снимает лимит ширины.
- Нет отдельной верхней вкладки «Шаблоны процессов» — процессы и шаблоны в разделе «Процессы».
- `knowledge_base.redesign.enabled=false` → рендерится прежняя раскладка (fallback работает); `=true` (дефолт) → новая.
- Нет `text-white` на цветных фонах, нет жёстких hex/slate/oklch-литералов (grep); весь текст на русском.
- **Раздел рендерится корректно в `[data-theme='light']` И `[data-theme='dark']`** (переключение через `ThemeToggle`/настройку внешнего вида): читаемый контраст, стекло/фон/текст флипаются, нет цветов, ломающих светлую тему; визуальный паритет с эталоном `/light-theme`.
- `bun run typecheck && bun run lint && bun run build` (frontend) зелёные.
**Closes:** R9, R10, R12.

### Ф6 — Ручная загрузка: docType → signalTypeHint (backend)
**Цель:** загруженный документ с пометкой типа детерминированно становится карточкой нужного типа.
**Файлы:** [document.adapter.ts:180-193](backend/src/modules/ingest/adapters/document/document.adapter.ts#L180) (payload RawEvent); потребитель [block-ingest.worker.ts:976](backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L976) (`tryGetSignalTypeHint`, override уже реализован — НЕ трогаем). Проверить enum `SignalType` (грепнуть `SIGNAL_TYPE_VALUES`) и значения `docType` (модуль documents).
**Что входит:** в payload (`:180`) рядом с `docType: doc.docType` добавить `signalTypeHint`, маппинг из `docType`:
```
docType 'regulation'  → 'regulation'
docType 'policy'      → 'policy'
docType 'process'     → 'process_step'
docType 'instruction' → 'process_step'   // экстрактор затем сам решит kind=instruction по single-role
// прочие docType / null → signalTypeHint не задаём (LLM решает, как сейчас)
```
Маппинг применять только если целевое значение входит в `SIGNAL_TYPE_VALUES` (иначе пропуск — защита).
**Что НЕ входит:** изменение `block-ingest` override-логики (она готова); multi-block документы (override применяется к первому блоку — известное ограничение механизма, для v1 ок: первичная классификация документа уважается).
**Acceptance:**
- Загрузка документа с `docType='regulation'` → созданный блок имеет `signalType='regulation'` → Specialist 3.1 создаёт `Regulation` → карточка видна на `/regulations` и идёт в триаж (trustTier auto→human).
- Маппинг покрывает {regulation, policy, process, instruction}; неизвестный `docType` → hint не задан (поведение как сейчас).
- Unit/e2e: payload содержит корректный `signalTypeHint` для каждого docType; интеграционный — путь upload→block.signalType.
- `bun run typecheck && bun run lint && bun run build` зелёные.
**Closes:** R11.

---

## Границы фичи
- ✅ **Always:** переиспользовать существующий `StructuredDocumentCompilerService` и `tryCompileContent`; держать best-effort fallback (компилятор не должен ломать pipeline создания карточек); русский UI; парные токены.
- ⚠️ **Ask first:** менять контракт эндпоинтов `/regulations`/`/processes`; вводить новый `signalType`; трогать merge/extension-логику; менять модель роутинга компилятора.
- 🚫 **Never:** `new PrismaClient()` в скриптах; `process.env.*` (только `TypedConfigService`); `prisma migrate`-команды кроме `prisma:migrate`/`migrate deploy` по правилам; выкат выключенным (Ship-On); `text-white` на цветном фоне.

## Pre-mortem / Риски (ревью-аспекты для strict-production-review-gate)
- **Throughput воркера:** +1 синхронный LLM-вызов на каждую новую карточку в `core.specialist-routing`. Митигация: best-effort fallback + kill-switch `docCompilerEnabled`. Ревью: не блокирует ли создание карточки при медленном LLM.
- **Faithfulness backfill:** компилятор при переразметке не должен «додумать» факты. Митигация: материал только из `statement`, промпт компилятора запрещает выдумку; перед массовым прогоном — ручная проверка выборки. Ревью: diff тела до/после на образце.
- **CardVersion на create:** не сломать инвариант версий (v1 без previousVersionId). Ревью: транзакционность (CardVersion + update одной транзакцией, как merge-ветка).
- **Kill-switch редизайна:** дуальный путь old/new layout — не оставить мёртвым. Судьба: после стабилизации в проде — отдельный cleanup-PR удаляет старый layout + флаг (триггер: 2 недели без инцидента после выката Ф5).
- **Ф6 multi-block:** override только первого блока — задокументировать ограничение.

## Совместимость с prompt caching
- Ф1/Ф2: компилятор — SYSTEM стабилен, переменные в user (уже так, [structured-document-compiler.prompt.ts:24](backend/src/modules/knowledge-core/prompts/structured-document-compiler.prompt.ts#L24)). Доп. вызовов SYSTEM не меняем → кэш цел.
- Ф3: добавка в стабильный SYSTEM экстрактора — одноразовый busting на выкате, далее кэш восстанавливается. Не в user.

## Feature-flags (реестр docs/operations/feature-flags.md)
- `docCompilerEnabled` — СУЩЕСТВУЕТ (kill-switch, ON), Ф1/Ф2 переиспользуют, новой строки не требует (проверить, что строка есть; если нет — добавить).
- `knowledge_base.redesign.enabled` — НОВЫЙ kill-switch (тип «а», ON), Ф5. Строка в реестр + seed + регистрация в `STEPS`.

## Prod-deploy (шаги для docs/operations/prod-deploy-log.md)
- Ф1: код бэка — `docker compose up -d --build backend` (миграций нет). Шаг 12 smoke: создать тестовую карточку → тело структурно.
- Ф2: Шаг 8 (backfill) — `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update` (прогонит `backfill-compile-flat-cards.ts`); идемпотентно.
- Ф3: код бэка, без миграций.
- Ф4/Ф5: фронт-билд; Ф5 — Шаг 7 (seed) новый AdminSetting `knowledge_base.redesign.enabled`.
- Ф6: код бэка, без миграций. Шаг 12 smoke: upload doc с docType=regulation → карточка на `/regulations`.

## DoD (общий чек качества каждой фазы)
- `bun run typecheck` (вкл. `.spec`) / `lint` / `build` зелёные; затронутые `vitest` зелёные.
- second-brain обновлён по таблице производных заметок: `01_projects/regulations.md`, `02_architecture/knowledge-core.md`, `03_processes/specialist-3-1-regulations.md`; при новом скрипте/флаге — `prod-deploy-log.md` + `feature-flags.md`.
- Идемпотентность backfill — как acceptance (повторный прогон = no-op).
- Рефлексия в `05_история/` после push; prod-инструкция в чат.

## Итог
_(заполняет tz-orchestrator по мере реализации фаз)_
