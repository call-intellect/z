---
type: tz
status: ready-to-implement
feature: manual-document-upload-and-import
date: 2026-06-08
owner: Сергей (владелец продукта Z/Кора)
relates_to:
  - plans/analysis/2026-06-08-manual-document-upload-and-import.md
  - second-brain/06_marketing/competitor-teamly.md
  - second-brain/01_projects/knowledge-core.md
---
> Анализ: `plans/analysis/2026-06-08-manual-document-upload-and-import.md` (status: research-complete) · Статус согласования развилок Р1–Р5: 2026-06-08 (владелец согласился со всеми рекомендациями).

# ТЗ — Ручная загрузка и импорт готовых документов в Кору

## Принцип

Кора уже принимает документы и **разбирает их в граф знаний** (это наш обгон RU-конкурентов). Задача — сделать приём **привычным и осмысленным**: больше форматов, несколько файлов сразу, богатая привязка «к чему относится», импорт из Notion/Confluence. Это **ingest-канал в граф** («внесите готовые знания»), а **НЕ wiki-редактор** (решение владельца Р1). Место «писать руками» у нас уже есть в трекере (project_document) — туда и направляем.

Расширяем СУЩЕСТВУЮЩИЕ модули `backend/src/modules/documents` + `backend/src/modules/ingest`, не строим параллельный. Весь парсинг — на Node/TS (без Python в `backend/`, CLAUDE.md §7).

---

## Цель + Зачем

**Болезненное состояние** (из анализа §1):
- Канал `/documents` читает только **4 формата** (PDF/DOCX/MD/TXT) — нет Excel/PowerPoint/HTML/сканов; грузит **по 1 файлу**; привязка — **только к должности**; **нет импорта из Notion/Confluence**.
- Возражение на демо «а как в Teamly мигрировать базу?» — сейчас ответ «никак».
- «Холодный старт»: граф пустой неделями, пока не накопятся встречи; готовые регламенты могли бы наполнить его в день внедрения.
- 2 бага: колонка «Тип» всегда «другое»; UI принимает `.doc/.rtf`, которые парсер не читает → «ошибка».

**Метрика «решено»:** принимаемых форматов ≥9 (+OCR); за один заход ≥N файлов или ZIP; ≥3 вида привязки (тема/тип/проект/должность); есть импорт Notion/Confluence; привязка реально влияет на граф; баги закрыты.

---

## REALITY-CHECK (фактическое состояние по коду, 2026-06-08)

| Что | Факт | Вывод для ТЗ |
|---|---|---|
| Канал загрузки `/documents` | ✅ работает: `POST /api/v1/documents` ([documents.controller.ts:97](../../backend/src/modules/documents/documents.controller.ts#L97)), drag&drop 1 файла ([DocumentsListClient.tsx:239](../../frontend/app/(authenticated)/documents/DocumentsListClient.tsx#L239)) | расширяем, не пишем заново |
| Документ → граф | ✅ работает: parse → `RawEvent` → knowledge-core ([document.adapter.ts:170](../../backend/src/modules/ingest/adapters/document/document.adapter.ts#L170)) | сохранить; усилить привязкой |
| Парсер | ⚠️ только pdf/docx/markdown/text ([document-parser.service.ts:81](../../backend/src/modules/ingest/parsers/document-parser.service.ts#L81)) | расширить |
| Зависимости | ✅ `pdf-parse@^2.4.5` (это форк-v2 с `PDFParse`-классом), `exceljs@^4.4.0`, `mammoth@^1.11.0`, `marked@^16.4.0` **уже стоят** ([package.json](../../backend/package.json)) | **НЕ переустанавливать**; добавить только `officeparser`; xlsx — через уже стоящий `exceljs`, НЕ `xlsx`/SheetJS (CVE) |
| Привязка `attachedRoleId` | ⚠️ **в граф НЕ доходит** — `attachedRoleId` есть только в модуле documents + adapter; `block-ingest.worker` его НЕ читает (grep: 4 файла, все в documents/ingest) | привязка сегодня = ярлык на Document; Ф4 делает её реальной |
| `DocumentKind` enum | формат (pdf/docx/markdown/text/other) [schema.prisma:855](../../backend/prisma/schema.prisma#L855); фронт `DocumentKindApi` ждёт СМЫСЛ (job_description/regulation/…) → колонка «Тип» всегда «другое» | развести: `kind`=формат, новый `docType`=смысл; починить label |
| `Document` модель | [schema.prisma:4770](../../backend/prisma/schema.prisma#L4770): kind/name/mimeType/s3Key/inlineContent/parsedText/status/attachedRoleId/entityId | добавить docType/attachedThemeId/attachedProjectId/contentHash |
| `SourceType` enum | НЕ содержит `document`; документы шлются как `external` name="Документы" ([document.adapter.ts:59](../../backend/src/modules/ingest/adapters/document/document.adapter.ts#L59)) | **НЕ трогаем** (избегаем рискованного backfill); импорты Notion/Confluence — тоже `external` с именами «Импорт Notion»/«Импорт Confluence». Вынесено vNext |
| AdminSetting | ✅ инфра готова: registry [admin-setting-schema-registry.ts:40](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts#L40) + `seed-admin-settings.ts` + `getDynamic` [typed-config.service.ts:2418](../../backend/src/common/config/typed-config.service.ts#L2418) | Р5: лимит/форматы — крутилки |
| Лимиты | `DOCUMENT_MAX_SIZE_MB=50`, `DOCUMENT_INLINE_THRESHOLD_MB=10`, `DOCUMENT_PARSE_TIMEOUT_MS=30000` ([env.schema.ts:450](../../backend/src/common/config/env.schema.ts#L450)) | maxSizeMb → перевести на `getDynamic` поверх ENV-fallback |
| Prisma-режим | **версионируемые миграции** с 2026-06-05 (CLAUDE.md): `bun run prisma:migrate -- --name <…>`, НЕ `db push`. Skill `prisma-db-push-rules` | enum/поля → файл миграции |

**Параллельных сессий/веток на эту фичу нет** (`git log --since` — knowledge-core/clones/tables, не documents).

---

## Принятые решения владельца (2026-06-08, не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | Это **ingest-канал в граф**, НЕ wiki-редактор. Формулировка UI: «Внести документы» / «Импорт знаний», не «База знаний» | Сохраняет позиционирование «память компании»; не воюем с Teamly на их поле ([[positioning]] антинарратив) |
| Р2 | **Волна 1** (форматы + мультифайл + богатая привязка + почин багов) — первой и сразу (Ship-On). **Волна 2** (ZIP + импорт Notion/Confluence + AI-привязка) — следом | Быстрый Ship-On закрывает 80% боли; импорт-коннекторы рискованнее, не блокируют базу |
| Р3 | Привязку к теме/типу при загрузке делает человек; **AI предлагает, человек подтверждает/правит** (human-in-the-loop) | Ручная привязка — table-stakes (red-team Т3); AI-предложение — обгон (RU не покрывают, Т1); согласуется с «без human-gate как регулярного одобрения, но с правкой» ([[feedback_no_human_in_loop_for_clone_learning]]) |
| Р4 | OCR/сканы и сложный layout — **Волна 3** (позже), OCR за kill-switch | Нет подтверждённого спроса; ops-нагрузка высокая |
| Р5 | Лимит размера и список принимаемых форматов — **крутилки в AdminSetting** (super_admin) | [[feedback_admin_settings_not_env_or_code]]; ENV — code-fallback |

---

## Доказательство выбора (два прохода + challenge-loop)

### Решение Б1 — парсер: расширить существующий per-format switch (реюз), а не заменять на один officeParser

| Критерий | A. Унифицировать всё в officeParser | B. Per-format switch, реюз существующих либ + officeParser только для новых форматов |
|---|---|---|
| Новые зависимости | officeparser (заменяет mammoth/pdf-parse/exceljs) | **только officeparser** (mammoth/pdf-parse/exceljs/marked уже стоят) |
| Соответствие текущей архитектуре | переписать `DocumentParserService.parse` switch | ✅ расширить существующий switch ([parser:81](../../backend/src/modules/ingest/parsers/document-parser.service.ts#L81)) |
| Качество DOCX (структура) | officeParser plain text | ✅ mammoth `convertToHtml` (уже используется) |
| Риск | смена 3 рабочих парсеров (регресс PDF/DOCX) | ✅ не трогаем рабочее |
| Код ради кода | да (выкинуть рабочее) | нет |

**Выбран B.** Источник: package.json (либы стоят), parser-код (switch есть). PDF → `pdf-parse` (стоит, v2-форк), DOCX → `mammoth` (стоит), XLSX → `exceljs` (стоит), MD → `marked` (стоит), TXT → как есть; **NEW**: PPTX/RTF/ODT/HTML/CSV → **`officeparser`** (одна новая либа). Challenge-loop: (1) корень — да (узость форматов); (2) эффективнее — да (1 новая либа вместо 3); (3) код ради кода — нет (реюз).

### Решение Б2 — привязка хранится на Document + пробрасывается в граф (Ф4), а не только ярлык

Сегодня `attachedRoleId` — мёртвый ярлык (REALITY-CHECK). Чтобы «пометить к чему относится» имело смысл, привязка (role/theme) **пробрасывается в payload RawEvent → block-ingest применяет к IdeaBlock'ам** (roleId + ThemeIdeaBlock). Challenge-loop: чиним КЛАСС («привязка не влияет на граф»), а не один кейс role. `docType`/`projectId` — пока ярлык-фильтр (в граф не пробрасываем, нет потребителя — не код ради кода).

### Решение Б3 — `kind`=формат, новый `docType`=смысл (не переиспользуем `kind`)

`Document.kind` управляет switch'ем парсера ([adapter:151](../../backend/src/modules/ingest/adapters/document/document.adapter.ts#L151)) — нельзя репёрпоузить под смысл. Новый enum `DocumentType` (regulation/policy/instruction/process/job_description/other). Фронт показывает **оба**: формат (kind) и тип (docType).

### Решение Б4 — AI-привязка (Ф10): дешёвый классификатор deepseek-v4-flash, human-in-the-loop

LLM предлагает `docType` + `attachedThemeId` (из списка существующих Theme Org); сохраняется как **предложение** (suggested*), человек подтверждает/правит в UI. Provider primary `deepseek-v4-flash` ([[feedback_ollama_tertiary_only_deepseek_flash_cheap]]). Раздел «Совместимость с prompt caching» — ниже.

### Решение Б5 — ZIP/импорт (Волна 2): пакет = `DocumentImport` + N `Document`, не «папка → авто-статьи»

Red-team Т1: «массовая загрузка папок» у конкурентов = миграторы/архивы, не «папка→статьи». Делаем приём **ZIP** (распаковка → N Document под один `DocumentImport` batch с пер-файловыми статусами и логом ошибок — как «История миграций» Teamly). Импорт Notion = тот же ZIP-путь (Markdown&CSV). Confluence = API-токен → fetch → те же Document.

---

## Scope

### Входит
- **Волна 1:** новые форматы (officeParser+реюз); мультифайл-загрузка; привязка docType/тема/проект; реальная проброска привязки в граф (role+theme); дедуп по хэшу; почин 2 багов; крутилки AdminSetting (лимит+форматы).
- **Волна 2:** приём ZIP (batch `DocumentImport`); импорт Notion (ZIP); импорт Confluence (API-токен); AI-предложение привязки (human-in-the-loop); ссылка на документ-источник в ответах AI-чата.
- **Волна 3 (позже):** OCR-воркер `tesseract.js` (kill-switch); свежесть+владелец регламента (TrustTier); опц. `infra/docling` микросервис (решение владельца — нужен URL).

### Не входит (vNext, с судьбой)
- `SourceType=document` + backfill существующих "Документы" external-source → **vNext** (риск backfill; используем `external` с именами). Строка остаётся в `04_не-сделано`.
- Импорт Google Drive / Яндекс Диск → **Волна 3+** (отдельное ТЗ).
- Wiki-редактор / authoring (Р1 — НЕ делаем; есть project_document в трекере).
- Двусторонняя синхронизация с Notion/Confluence (только разовый импорт-затравка).
- Версионирование загруженного документа (повторная загрузка = новый Document + дедуп по хэшу).

### Граничные контракты с другими модулями
- **knowledge-core pipeline** — реальный, не мокаем: Ф4 пишет в существующие `IdeaBlock.roleId`/`roleRelevant` и `ThemeIdeaBlock`. НЕ меняем алгоритмы кластеризации/специалистов.
- **Theme** — берём существующие Theme Org (FK `attachedThemeId`); НЕ создаём Theme из документа (только связываем с существующими; если тем нет — привязка к теме недоступна, показываем подсказку).
- **Tracker Project** — FK `attachedProjectId` на существующий `Project` (id, [schema.prisma:7949](../../backend/prisma/schema.prisma#L7949)); НЕ создаём проекты.
- **AdminSetting** — используем готовую инфру; добавляем 2 ключа.

---

## Границы фичи

- ✅ **Always:** tenantId-scope на каждый запрос (TenantGuard); RBAC `document` (owner/admin write, manager read — [policy.csv:196](../../backend/src/modules/rbac/policies/policy.csv#L196)); русский UI; парные цвет-токены; идемпотентность job по contentHash/jobId.
- ⚠️ **Ask first:** менять алгоритмы knowledge-core (кластеризация/специалисты); добавлять `SourceType`/делать backfill; новый LLM-провайдер; поднимать лимиты железа.
- 🚫 **Never:** `process.env.*` (только TypedConfigService); `new PrismaClient()` в скриптах (только `createPrismaClient()`); `prisma db push` для коммита (только миграция); `xlsx`/SheetJS (CVE — только `exceljs`); оригинальный `pdf-parse@1` (только стоящий `@2`); Python в `backend/` (Docling — только `infra/*`); `text-white` на цветном фоне; флаг «дефолт OFF, включим потом».

---

# ВОЛНА 1 — «Принять привычно» (Ship-On)

## Фаза 1 — Схема БД: форматы, тип документа, привязки, хэш

**Цель:** расширить `DocumentKind`, добавить `DocumentType`, поля привязки и `contentHash` к `Document`.

**Файлы:** `backend/prisma/schema.prisma` (enum `DocumentKind` ~855, `Document` ~4770); миграция в `backend/prisma/migrations/`.

**Что входит** — дословные сниппеты:

```prisma
enum DocumentKind {
  pdf
  docx
  markdown
  text
  xlsx   /// Excel — парсится через exceljs (уже в зависимостях)
  pptx   /// PowerPoint — officeparser
  html   /// officeparser / html-to-text
  rtf    /// officeparser
  odt    /// OpenDocument Text — officeparser
  csv    /// officeparser / нативный разбор
  other
}

/// Смысловой тип загруженного документа (НЕ формат файла). Указывается
/// человеком при загрузке или предлагается AI (Ф10), правится человеком.
enum DocumentType {
  regulation     /// регламент
  policy         /// политика
  instruction    /// инструкция
  process        /// описание процесса
  job_description /// должностная инструкция
  other
}
```

В `model Document` добавить:
```prisma
  /// Смысловой тип (регламент/политика/…). Ярлык-фильтр + основа для группы Б.
  docType          DocumentType?
  /// Привязка к теме графа (существующей Theme Org). Пробрасывается в граф (Ф4).
  attachedThemeId  String?
  attachedTheme    Theme?       @relation("DocumentTheme", fields: [attachedThemeId], references: [id], onDelete: SetNull)
  /// Привязка к проекту трекера (существующему Project). Ярлык-фильтр.
  attachedProjectId String?
  attachedProject  Project?     @relation("DocumentProject", fields: [attachedProjectId], references: [id], onDelete: SetNull)
  /// sha256 распарсенного содержимого — дедуп повторной загрузки (Ф3).
  contentHash      String?
  /// AI-предложения привязки (Ф10, Волна 2). null до внедрения.
  suggestedDocType DocumentType?
  suggestedThemeId String?
  /// Пакет импорта (Волна 2). null для одиночной загрузки.
  importBatchId    String?
```
Добавить индексы: `@@index([tenantId, docType])`, `@@index([tenantId, contentHash])`, `@@index([tenantId, attachedThemeId])`, `@@index([importBatchId])`.
Добавить обратные связи в `model Theme` (`documents Document[] @relation("DocumentTheme")`) и `model Project` (`documents Document[] @relation("DocumentProject")`).

**Что НЕ входит:** `DocumentImport`-модель (Ф7); `SourceType` не трогаем; данные не backfill'им (новые поля nullable).

**Acceptance (машинные):**
- `bun run prisma:migrate -- --name documents_formats_type_attribution` создаёт файл миграции; `bun run prisma:generate` без ошибок.
- `bun run typecheck` зелёный.
- Grep: в `schema.prisma` присутствуют `enum DocumentType`, `docType DocumentType?`, `contentHash String?`, `attachedThemeId String?`.
- Миграция повторно (`migrate deploy`) — no-op (идемпотентность миграций Prisma).

**Закрывает:** R1 (форматы), R2 (тип), R3 (привязки), R8 (дедуп-поле).

---

## Фаза 2 — Парсер: новые форматы (officeparser + реюз)

**Цель:** `DocumentParserService` парсит PDF/DOCX/MD/TXT/XLSX/PPTX/HTML/RTF/ODT/CSV.

**Файлы:** `backend/src/modules/ingest/parsers/document-parser.service.ts` (switch ~81), `document.adapter.ts` (detectKind вызывается через `documents.service.ts:detectKind` ~443 — переиспользовать), `backend/package.json` (+`officeparser`).

**Картография:** существующий switch уже имеет `parsePdf`/`parseDocx`/`parseMarkdown`; добавляем ветки. `detectKind` живёт в `documents.service.ts:443` — расширить распознавание новых форматов по MIME+расширению.

**Что входит:**
- `bun add officeparser` (проверить актуальный API через Context7/README перед использованием; на 2026-06-08 — v7.2.0, MIT, `parseOfficeAsync(buffer|path)`).
- Ветки switch:
  - `xlsx` → `exceljs` (уже стоит): `workbook.xlsx.load(buffer)` → обойти `worksheet.eachRow` → собрать текст (лист + строки), листы разделять заголовком.
  - `pptx` / `rtf` / `odt` / `html` / `csv` → `officeparser`.
  - `html` альтернативно — если officeParser шумит, fallback на снятие тегов (как `stripHtmlTags` уже есть в parser).
- Лимит/таймаут — из существующего `cfg.document` (Ф6 переведёт maxSize на getDynamic).
- Типизированные ошибки парсера (`DocumentParseFailedError`/`ParseSizeError`/`ParseTimeoutError`) — переиспользовать.

**Что НЕ входит:** OCR (Волна 3); officeParser AST/chunks (knowledge-core сам чанкит).

**Acceptance:**
- `bunx vitest run backend/src/modules/ingest/parsers/document-parser.service.spec.ts` зелёный; добавлены кейсы: валидный XLSX→непустой text, PPTX→непустой text, CSV→текст, неподдерживаемый `other`→`unsupported_document_kind`.
- Мини-проверка поведения officeParser на реальном .pptx/.xlsx (эмпирически, [[feedback_verify_framework_behavior_empirically]]) — описать в отчёте фазы.
- `officeparser` в `backend/package.json` dependencies; `xlsx` НЕ добавлен.
- `bun run typecheck && bun run build` зелёные.

**Закрывает:** R1.

---

## Фаза 3 — Backend documents: мультифайл, привязки, дедуп

**Цель:** `POST /api/v1/documents` принимает несколько файлов; query/body несёт `docType/attachedThemeId/attachedProjectId`; дедуп по `contentHash`; валидация принадлежности Theme/Project к Org.

**Файлы:** `documents.controller.ts` (~97), `documents.service.ts` (`upload` ~70), `dto/documents.dto.ts` (`UploadDocumentQuerySchema` ~25), `documents.module.ts`.

**Что входит:**
- Мультифайл: заменить `FileInterceptor('file')` на `FilesInterceptor('files', N)` (N = из AdminSetting `documents.maxFilesPerUpload`, дефолт 20). Сохранить обратную совместимость поля `file` (принимать оба). Возврат: `{ items: [{id,status,name,deduped}] }`.
- DTO привязки (Zod):
```ts
export const UploadDocumentBodySchema = z.object({
  attachedRoleId: z.string().cuid().optional(),
  attachedThemeId: z.string().cuid().optional(),
  attachedProjectId: z.string().cuid().optional(),
  docType: z.enum(['regulation','policy','instruction','process','job_description','other']).optional(),
});
```
- Валидация: Theme/Project/Role принадлежат tenantId (как существующая проверка role [documents.service.ts:105](../../backend/src/modules/documents/documents.service.ts#L105)); иначе `theme_not_found`/`project_not_found`/`role_not_found` (404, machine-code).
- Дедуп: считать `contentHash = sha256(parsedText)` ПОСЛЕ парсинга (в adapter, Ф4) ИЛИ `sha256(buffer)` при upload. **Решение:** хэш сырого буфера при upload (быстро, до парсинга); если в Org уже есть Document с тем же `contentHash` и `deletedAt=null` → не создавать дубль, вернуть `{id: existingId, status, deduped:true}`.
- Лимит размера/форматов — из AdminSetting (Ф6); до Ф6 — из `cfg.document` (ENV-fallback).

**Что НЕ входит:** ZIP (Ф7); AI-привязка (Ф10); presigned-download.

**Acceptance:**
- Swagger smoke: `POST /api/v1/documents` принимает `multipart` с несколькими `files` + поля привязки; `GET /api/docs` поднимается.
- Негативный: загрузка с `attachedThemeId` чужой Org → 404 `theme_not_found`.
- Дедуп: повторная загрузка идентичного файла в той же Org → ответ `deduped:true`, второй Document НЕ создан (проверка `prisma.document.count`).
- `bunx vitest run` для documents.service spec (добавить кейсы мультифайл + дедуп) зелёный.
- `bun run typecheck && lint && build` зелёные.

**Закрывает:** R2, R3, R4 (мультифайл), R8 (дедуп).

---

## Фаза 4 — Проброс привязки в граф (сделать привязку реальной)

**Цель:** `attachedRoleId` и `attachedThemeId` влияют на граф: IdeaBlock'и документа получают `roleId`+`roleRelevant=true` и связь `ThemeIdeaBlock` с выбранной темой.

**Файлы:** `document.adapter.ts` (payload ~175), `block-ingest.worker.ts` (обработка document-RawEvent; добавить применение привязки после создания IdeaBlock'ов).

**Картография:** adapter уже кладёт `attachedRoleId` в payload ([adapter:181](../../backend/src/modules/ingest/adapters/document/document.adapter.ts#L181)) — block-ingest его игнорирует (REALITY-CHECK). Block-ingest создаёт IdeaBlock'и из payload документа; после их создания нужно применить привязку.

**Что входит:**
- В payload adapter добавить `attachedThemeId`, `docType` (рядом с существующим `attachedRoleId`).
- В `block-ingest.worker`: для RawEvent с `sourceExternalId` вида `doc:*` (или payload.documentId) — после создания IdeaBlock'ов:
  - если `attachedRoleId` → проставить `IdeaBlock.roleId = attachedRoleId`, `roleRelevant = true`;
  - если `attachedThemeId` → создать `ThemeIdeaBlock { themeId: attachedThemeId, blockId, weight: 0.8 }` (upsert, не дублировать).
- Идемпотентность: ThemeIdeaBlock @@id([themeId,blockId]) — повторный прогон no-op.

**Что НЕ входит:** менять кластеризацию/специалистов; `docType`→группа Б (в граф docType не пробрасываем — нет потребителя, Б2).

**Acceptance:**
- Unit/integration: документ загружен с `attachedRoleId`+`attachedThemeId` → после block-ingest у созданных IdeaBlock есть `roleId` и `roleRelevant=true`; есть строки `ThemeIdeaBlock` с этим themeId (проверка через prisma в тесте).
- Повторный прогон job (тот же jobId `doc_<id>`) не плодит ThemeIdeaBlock.
- `bunx vitest run backend/src/modules/knowledge-core/workers/block-ingest.worker.spec.ts` зелёный.

**Закрывает:** R3 (привязка реальна), R5.

---

## Фаза 5 — Frontend: мультизагрузка, форма привязки, почин багов

**Цель:** UI грузит несколько файлов; форма привязки (тип/тема/проект/должность); починены 2 бага.

**Файлы:** `DocumentsListClient.tsx` (диалог ~239, label ~348, accept ~294), `documents.api.ts` (~280), деталка `documents/[id]/DocumentDetailClient.tsx`, `src/domain/document.ts` (если есть — иначе создать маппер ApiDto→DomainModel).

**Что входит:**
- **Мультизагрузка:** `input multiple` + drag нескольких; очередь со статусами по каждому файлу; общий прогресс.
- **Форма привязки:** селекты «Тип документа» (DocumentType, RU-лейблы), «Тема» (SWR список Theme Org), «Проект» (SWR список Project Org), «Должность» (есть). Все опциональны.
- **Баг-1 (label):** `documentKindLabel` маппит ФОРМАТ (pdf→«PDF», docx→«Word», xlsx→«Excel», pptx→«PowerPoint», markdown→«Markdown», text→«текст», html→«HTML», rtf→«RTF», odt→«ODT», csv→«CSV», other→«другое»). Колонка «Тип» = docType (RU), отдельно от формата.
- **Баг-2 (accept):** **единый источник правды** списка форматов фронт↔бэк — константа `ACCEPTED_DOCUMENT_EXTENSIONS` (экспорт из общего места/domain), `accept` строится из неё; убрать `.doc` (бинарный, не парсится) или явно не включать; `.rtf` оставить только если Ф2 покрыл.
- `documents.api.ts`: `DocumentKindApi` = формат-union (pdf/docx/markdown/text/xlsx/pptx/html/rtf/odt/csv/other); новый `DocumentTypeApi`; upload шлёт поля привязки.
- Русский UI, парные токены.

**Что НЕ входит:** AI-предложение привязки (Ф10); ZIP-зона (Ф7).

**Acceptance:**
- `bun run typecheck && lint && build` (frontend) зелёные.
- `bunx vitest run frontend/src/api/documents.api.spec.ts` зелёный (обновить под новые поля).
- Ручная проверка (qa-tester, прод/стенд): загрузка 3 файлов разом; колонка «Тип» показывает формат корректно (не всегда «другое»); выбор темы/типа сохраняется и виден в деталке.
- Grep: в `DocumentsListClient.tsx` `accept` собирается из общей константы, нет хардкода `.doc` без поддержки.

**Закрывает:** R4, R6 (баг label), R7 (баг accept), R3 (UI привязки).

---

## Фаза 6 — AdminSetting: лимит и форматы как крутилки (Р5)

**Цель:** `documents.maxSizeMb`, `documents.maxFilesPerUpload`, `documents.acceptedFormats` редактируются super_admin.

**Файлы:** `admin-setting-schema-registry.ts` (~40), `backend/scripts/seed-admin-settings.ts`, `typed-config.service.ts` (`cfg.document` → `getDynamic` поверх ENV-fallback ~1096).

**Что входит:**
- Registry: `['documents.maxSizeMb', POSITIVE_INT]`, `['documents.maxFilesPerUpload', POSITIVE_INT]`, `['documents.acceptedFormats', z.array(z.string())]` (JSON-поле; фронт даст JSON-инпут — допустимо).
- Seed (idempotent upsert): дефолты `maxSizeMb=50`, `maxFilesPerUpload=20`, `acceptedFormats=['pdf','docx','xlsx','pptx','md','txt','html','rtf','odt','csv']`. Зарегистрировать в `apply-prod-deploy.ts` STEPS (phase, idempotent).
- `cfg.document.maxSizeBytes` и проверки в documents.service читают `getDynamic('documents.maxSizeMb', ENVfallback)`.
- Строка в `docs/operations/feature-flags.md` — это «решение владельца»-крутилки (не флаг-рубильник), но реестр требует строки.

**Что НЕ входит:** OCR-флаг (Ф12).

**Acceptance:**
- `bun run scripts/seed-admin-settings.ts` повторно — no-op (идемпотентность как acceptance).
- `GET /api/v1/admin/settings/schema/documents.maxSizeMb` отдаёт number-схему.
- Изменение `documents.maxSizeMb` в админке меняет лимит без рестарта (getDynamic).
- `bun run typecheck && build` зелёные.

**Закрывает:** R9 (крутилки).

---

# ВОЛНА 2 — «Внести знания и обогнать»

## Фаза 7 — Приём ZIP-архива (batch DocumentImport)

**Цель:** загрузка ZIP → распаковка → N Document под один `DocumentImport` с пер-файловыми статусами и логом ошибок.

**Файлы:** новая модель `DocumentImport` (schema.prisma + миграция), `documents.controller.ts` (новый `POST /api/v1/documents/import-zip`), новый `document-import.service.ts`, zip-либа.

**Что входит:**
- `bun add` zip-либы (Context7/проверка: `node-stream-zip` или `adm-zip` — выбрать по безопасности на 2026-06-08; **проверить актуальность перед добавлением**).
- Модель:
```prisma
enum DocumentImportSource { upload_zip notion confluence }
enum DocumentImportStatus { pending processing completed failed }
model DocumentImport {
  id          String   @id @default(cuid())
  tenantId    String
  source      DocumentImportSource
  status      DocumentImportStatus @default(pending)
  totalFiles  Int      @default(0)
  doneFiles   Int      @default(0)
  failedFiles Int      @default(0)
  errorLog    Json?    /// [{file, error}]
  createdById String   /// Person.id
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([tenantId, status])
}
```
- BullMQ-очередь `core.document-import` + воркер: распаковать ZIP, на каждый поддерживаемый файл создать Document (привязка batch-level: docType/theme/project применяются ко всем) + enqueue document-uploaded; неподдерживаемые/битые → в `errorLog`, инкремент `failedFiles`. jobId = `docimport_<importId>`.
- Лимит суммарного размера ZIP — AdminSetting.

**Что НЕ входит:** Notion/Confluence (Ф8/Ф9 переиспользуют этот путь).

**Acceptance:**
- `POST /api/v1/documents/import-zip` с ZIP из 3 файлов → `DocumentImport.totalFiles=3`, по завершении `doneFiles+failedFiles=3`.
- Битый файл в ZIP → попадает в `errorLog`, не валит весь импорт.
- Повторный enqueue `docimport_<id>` — no-op.
- Регистрация модели в `prod-deploy-log` Шаг 4 + очереди в Шаг 12.

**Закрывает:** R10 (ZIP/batch).

---

## Фаза 8 — Импорт из Notion (ZIP «Markdown & CSV»)

**Цель:** принять выгрузку Notion (ZIP Markdown&CSV) → документы в граф, сохранив дерево как `docType`/имена.

**Файлы:** `document-import.service.ts` (ветка `notion`), UI «Импорт из Notion».

**Что входит:** парсинг Notion-ZIP (md-файлы → Document kind=markdown; вложенность → имя/путь в `name`; CSV → пропустить или как text). Source `external` name="Импорт Notion". Переиспользует Ф7 batch.

**Acceptance:** Notion-экспорт ZIP (тестовый) → N Document со статусом parsed; дерево отражено в именах; `DocumentImport.source=notion`. Тест на реальном маленьком экспорте.

**Закрывает:** R11 (импорт Notion).

---

## Фаза 9 — Импорт из Confluence (API-токен)

**Цель:** по домену+email+токену вытянуть страницы пространства → документы.

**Файлы:** `document-import.service.ts` (ветка `confluence`), новый `confluence-client.ts`, UI-форма (домен/email/токен/spaceKey), крипто-хранение токена (AES-256-GCM как у Source-секретов).

**Что входит:** Confluence Cloud REST (`/wiki/rest/api/content?spaceKey=...`), пагинация, тело страницы (storage format → текст через html-to-text/cheerio), вложения опц. Токен в зашифрованном виде (как `sources` секреты). batch DocumentImport source=confluence. Проверить актуальный Confluence REST через Context7/web перед реализацией.

**Acceptance:** валидный токен+spaceKey → страницы как Document; невалидный токен → `confluence_auth_failed` (machine-code), не падает молча. Токен в БД зашифрован (grep — не хранится plaintext).

**Закрывает:** R11 (импорт Confluence).

---

## Фаза 10 — AI-предложение привязки (human-in-the-loop, Р3)

**Цель:** при загрузке без явной привязки — LLM предлагает `docType` + `attachedThemeId` (из тем Org); человек подтверждает/правит.

**Файлы:** новый LLM-task `document-attribution-suggest` (prompt registry + seed + ALL_LLM_TASK_TYPES — учесть «127 taskType, 3 потеряны» [[project_llm_tasktypes_missing_from_registry]]), воркер/сервис, поля `suggestedDocType`/`suggestedThemeId` (Ф1), UI-подсказка «AI предлагает: …, [принять]/[изменить]».

**Что входит:**
- LLM-вызов: вход — первые ~2000 знаков parsedText + список Theme Org (id+name); выход — `{docType, themeId|null, confidence}`. Provider `deepseek-v4-flash` (primary), fallback по реестру.
- Сохранить в `suggested*`; НЕ применять автоматически — человек жмёт «принять» (тогда копируется в `docType`/`attachedThemeId` и идёт проброс Ф4) или правит.
- **Совместимость с prompt caching** (обязательный раздел): SYSTEM стабильный (инструкция классификатора + формат ответа) → кэшируется; переменные данные (текст документа + список тем) — в КОНЦЕ user-сообщения. Не править SYSTEM между вызовами ([[feedback_llm_prompts_cache_friendly]]).
- Self-improving без human-gate как регулярного одобрения: «принять/править» — это правка результата, не блокирующее одобрение ([[feedback_no_human_in_loop_for_clone_learning]]).

**Что НЕ входит:** авто-применение без человека (Р3); обучение классификатора.

**Acceptance:**
- taskType `document-attribution-suggest` в `ALL_LLM_TASK_TYPES` И в сиде промптов (grep оба места).
- Документ без привязки → `suggestedDocType`/`suggestedThemeId` заполнены; `docType`/`attachedThemeId` пусты до подтверждения человеком.
- Раздел «Совместимость с prompt caching» présent в промпте (стабильный SYSTEM).
- Строка в `feature-flags.md` (kill-switch ON).

**Закрывает:** R12 (AI-привязка).

---

## Фаза 11 — Ссылка на документ-источник в ответах AI-чата

**Цель:** в ответе AI-чата, опирающемся на загруженный документ, есть ссылка на этот Document.

**Файлы:** chat-v2 retrieval/citation (`knowledge-core` chat-v2 сервисы — найти по `chatV2`), маппинг IdeaBlock→Document (через RawEvent `sourceExternalId='doc:<id>'`).

**Что входит:** при формировании цитат/источников ответа — если IdeaBlock происходит из Document (sourceExternalId `doc:*`), добавить в citations ссылку `/documents/<id>`. Переиспользовать существующий провенанс (deталка documents уже умеет обратный путь [documents.service.ts:278](../../backend/src/modules/documents/documents.service.ts#L278)).

**Что НЕ входит:** менять механику retrieval; citations для не-документных источников (уже есть).

**Acceptance:** вопрос в чат, ответ на основе загруженного регламента → в источниках ответа есть ссылка на `/documents/<id>`. Тест на сценарии «загрузил регламент → спросил → получил ссылку».

**Закрывает:** R13 (провенанс в ответе).

---

# ВОЛНА 3 — «Свежесть и сложные форматы» (позже)

## Фаза 12 — OCR-воркер для сканов (kill-switch)

**Цель:** PDF/изображения без текстового слоя → распознавание `tesseract.js`.

**Файлы:** `bun add tesseract.js`, новый BullMQ-воркер `core.document-ocr` (отдельный, тяжёлый CPU), интеграция в parser (если `unpdf`/pdf-parse вернул пусто → отрендерить страницы в картинки → OCR). Kill-switch `documents.ocrEnabled` (ON при выкате; рубильник на инцидент).

**Acceptance:** скан-PDF без текстового слоя → после OCR непустой parsedText (тест на тестовом скане, русский). Воркер отдельный (не блокирует основной парсинг). Строка в `feature-flags.md` (kill-switch ON).

**Закрывает:** R14 (OCR).

## Фаза 13 — Свежесть и владелец регламента (паттерн Guru)

**Цель:** у загруженного регламента — владелец + срок пересмотра; устаревший гаснет в `TrustTier`/ответах.

**Файлы:** поля на Document (`ownerPersonId`, `reviewDueAt`), cron-напоминание владельцу, завязка на существующий `TrustTier`.

**Acceptance:** регламент с `reviewDueAt` в прошлом → помечается устаревшим; владельцу уходит напоминание (через существующий канал). (Детализация — отдельной итерацией при входе в Волну 3.)

**Закрывает:** R15 (свежесть).

## Фаза 14 — (опц.) infra/docling микросервис

**Цель:** сложные сканы/таблицы через self-hosted Docling. **Решение владельца** — деплоится только если задан `DOCLING_SERVICE_URL` (нет URL → не выкатывается). Python — только в `infra/docling/` (CLAUDE.md §7).

**Acceptance:** при заданном URL — тяжёлый PDF парсится через docling-serve; при отсутствии URL — фича не активна, основной путь не затронут. Строка в `feature-flags.md` (решение владельца).

**Закрывает:** R16 (сложный layout).

---

## Граф зависимостей фаз

```
Волна 1:  Ф1 → Ф2 → Ф3 → Ф4 → Ф5
                         ↘ Ф6 (после Ф3, параллельно Ф5)
Волна 2:  (после Ф1-Ф6) Ф7 → Ф8, Ф9 (параллельно после Ф7)
                         Ф10 (после Ф4+Ф5)
                         Ф11 (после Ф4)
Волна 3:  Ф12, Ф13, Ф14 (после Волны 2, независимы, опц.)
```
- Строго последовательно: Ф1→Ф2→Ф3→Ф4 (схема → парсер → API → проброс).
- Параллельно: Ф5 и Ф6 (после Ф3); Ф8/Ф9 (после Ф7); Ф10/Ф11 (после Ф4).

---

## Требования (трассировка)

- **R1** Когда загружен файл формата PDF/DOCX/XLSX/PPTX/MD/TXT/HTML/RTF/ODT/CSV, система shall распарсить его в текст без ошибки. *(Ф1,Ф2)*
- **R2** Система shall хранить смысловой `docType` отдельно от формата `kind`. *(Ф1,Ф3)*
- **R3** Когда пользователь указал тему/тип/проект/должность при загрузке, система shall сохранить привязку; role+theme shall повлиять на граф. *(Ф1,Ф3,Ф4,Ф5)*
- **R4** Когда выбрано несколько файлов, система shall загрузить все за один заход с пер-файловым статусом. *(Ф3,Ф5)*
- **R5** Если задан `attachedThemeId`, then IdeaBlock'и документа shall получить `ThemeIdeaBlock`-связь с этой темой. *(Ф4)*
- **R6** Колонка «Тип» shall отображать формат корректно (не всегда «другое»). *(Ф5)*
- **R7** `accept` фронта shall совпадать с реально парсимыми форматами (единый источник). *(Ф5)*
- **R8** Если в Org уже есть документ с тем же `contentHash`, then повторная загрузка shall вернуть `deduped:true` без дубля. *(Ф1,Ф3)*
- **R9** Лимит размера и список форматов shall редактироваться в AdminSetting. *(Ф6)*
- **R10** Когда загружен ZIP, система shall распаковать и создать batch `DocumentImport` с логом ошибок. *(Ф7)*
- **R11** Система shall импортировать документы из Notion (ZIP) и Confluence (API-токен). *(Ф8,Ф9)*
- **R12** Когда привязка не указана, система shall предложить `docType`/`themeId` через LLM; применяется только после подтверждения человеком. *(Ф10)*
- **R13** Когда ответ AI-чата опирается на загруженный документ, then источники shall содержать ссылку на `/documents/<id>`. *(Ф11)*
- **R14** Если PDF/изображение без текстового слоя, then OCR shall извлечь текст. *(Ф12)*
- **R15** Регламент shall иметь владельца и срок пересмотра; устаревший shall гаснуть. *(Ф13)*
- **R16** При заданном `DOCLING_SERVICE_URL` сложные документы shall парситься через docling. *(Ф14)*

---

## Pre-mortem / Риски и ревью-аспекты

- **officeParser шумит на сложной вёрстке** (`[verified]` ограничение) → для DOCX-структуры mammoth `convertToHtml`; тяжёлое — Волна 3 docling. *Ревью:* проверить непустой text на реальных файлах.
- **Дубли в графе при повторной загрузке** → дедуп по `contentHash` (Ф3). *Ревью:* дедуп до создания Document.
- **Supply-chain:** не добавить `xlsx`/SheetJS (CVE) и не откатить `pdf-parse` на v1 → использовать стоящие `exceljs`/`pdf-parse@2`. *Ревью:* package.json diff.
- **Проброс привязки ломает кластеризацию** → Ф4 только ДОБАВЛЯЕТ ThemeIdeaBlock/roleId, не меняет алгоритмы. *Ревью:* strict-production-review-gate на block-ingest.
- **Confluence токен plaintext** → шифровать как Source-секреты (AES-256-GCM). *Ревью:* grep на plaintext.
- **LLM-привязка ломает кэш** → стабильный SYSTEM (Ф10). *Ревью:* раздел prompt-caching.
- **Большие файлы/ZIP в память** → S3 для >inlineThreshold; стриминг ZIP. *Ревью:* лимиты из AdminSetting.
- **Идемпотентность миграций/seed** → повторный прогон no-op (acceptance каждой фазы).

---

## Feature-flags (Ship-On)

| Флаг/крутилка | Тип | Состояние | Где |
|---|---|---|---|
| `documents.maxSizeMb`, `documents.maxFilesPerUpload`, `documents.acceptedFormats` | крутилка (решение владельца) | значение задано (дефолты) | AdminSetting (Ф6) |
| `documents.ocrEnabled` | kill-switch | ON при выкате Ф12 | AdminSetting (Ф12) |
| `DOCLING_SERVICE_URL` | решение владельца | не выкатывать без URL | ENV (Ф14) |

Любой — строка в `docs/operations/feature-flags.md`. «Дефолт OFF, включим потом» запрещён (CLAUDE.md §8).

---

## Prod-deploy (что обновить при реализации)

- **Шаг 4** (`prod-deploy-log.md`): новые enum (`DocumentType`, форматы `DocumentKind`, `DocumentImportSource/Status`), модель `DocumentImport`, поля `Document` → миграции применяются авто на `docker compose up` (`migrate deploy`).
- **Шаг 7** (seed): `seed-admin-settings.ts` (новые ключи) — зарегистрировать в `apply-prod-deploy.ts` STEPS.
- **Шаг 12** (smoke): новые очереди `core.document-import`, `core.document-ocr`; новый эндпоинт `POST /api/v1/documents/import-zip`, `/import-notion`, `/import-confluence` (Swagger smoke).
- **Шаг 1** (ENV): `DOCLING_SERVICE_URL` (опц., Волна 3).
- Производные заметки second-brain: `01_projects/knowledge-core.md` (новый канал привязки), `01_projects/api-layer.md` (новые эндпоинты), `02_architecture/data-model.md` (Document поля + DocumentImport), `01_projects/workers-queues.md` (новые очереди), `docs/operations/feature-flags.md`.

---

## Definition of Done

- `bun run typecheck` (вкл. `.spec`), `lint`, `build` зелёные (backend+frontend) на каждой фазе.
- vitest по затронутым spec зелёные; добавлены кейсы из Acceptance.
- Миграции применяются и повторно — no-op; seed идемпотентен.
- Нет `process.env.*`, `new PrismaClient()`, `prisma db push`, `xlsx`/SheetJS в diff.
- second-brain обновлён по таблице производных заметок; `prod-deploy-log` обновлён при затронутых schema/scripts/ENV/очередях/эндпоинтах; строка в `feature-flags.md`.
- Русский UI; парные цвет-токены; tenantId-scope + RBAC на всех новых эндпоинтах.
- Рефлексия в `second-brain/05_история/`; строка в `04_не-сделано` обновлена (закрыта/перенесена по мере выполнения волн).

---

## Итог
_(заполнит tz-orchestrator по мере реализации: что сделано целиком/частично, что осталось.)_
