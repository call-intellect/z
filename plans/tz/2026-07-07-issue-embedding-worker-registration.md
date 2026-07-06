---
type: tz
feature: issue-embedding-worker-registration
title: "ТЗ — Регистрация IssueEmbedWorker: embedding AI-созданных задач (дедуп/закрытие против них)"
status: ready-to-implement
date: 2026-07-07
owner: владелец (sergrv80@gmail.com)
trigger: "Стенд task-stand (batch b1, 2026-07-06): setup-задачам пришлось считать embedding напрямую — IssueEmbedWorker не зарегистрирован"
cartography: plans/analysis/2026-07-03-task-tracking-stand-code-cartography.md §6 (Т5/инфраструктура)
verify_stand: docs/testing/task-stand.md (категория D дедуп · H закрытие)
depends_on: null
---

# ТЗ — Регистрация IssueEmbedWorker (embedding задач)

> **Контракт для реализации** (скилл `tz-orchestrator`). Находка стенда task-stand: `IssueEmbedWorker` и
> `IssueEmbedQueueService` существуют как файлы, но **не зарегистрированы ни в одном `@Module`** →
> `IssuesService.enqueueEmbed` при `!this.embedQueue` тихо возвращается (no-op) → очередь `core.issue-embed`
> пуста → **`Issue.embedding` у AI-созданных (и любых) задач никогда не считается**.

## 0. Цель, границы, инвариант

**Цель:** любая создаваемая/значимо изменяемая `Issue` получает pgvector-`embedding` (как задумано), чтобы
KNN-дедуп (`SimilarIssuesService`/`TaskDedupService`) и петля автозакрытия (`TaskCompletionHandler`) находили
совпадения ПРОТИВ уже созданных задач (сейчас находят только против задач, у которых embedding случайно есть —
т.е. почти никогда для AI-потока).

**Почему это важно (доказано стендом):** дедуп задача↔задача (`TaskDedupService.evaluate`) и закрытие
(`TaskCompletionHandler`) делают KNN среди ОТКРЫТЫХ задач по `Issue.embedding`. Без embedding кандидат-совпадение
= NIL/no_match → дубли не подсказываются, «сделал X» не матчит открытую задачу X. Стенд обошёл это, посчитав
embedding setup-задачам напрямую через `EmbeddingFallbackService`; в проде обхода нет.

**Границы:**
- Регистрация уже написанных `IssueEmbedWorker` + `IssueEmbedQueueService` (не переписывать логику — она есть).
- Backfill существующих задач без embedding — отдельная фаза (idempotent-скрипт), опц.
- Ship-On: воркер включён по умолчанию (это восстановление задуманного поведения, не флаг).

**Инвариант:** после фикса `SELECT count(*) FROM "Issue" WHERE embedding IS NULL AND <открыта>` стремится к 0
для новых задач; дедуп/закрытие на стенде (D/H) перестают давать ложные no_match из-за отсутствия embedding.

## 1. Изменения (по файлам — досверять по символу)

### Ф1 — регистрация воркера и очереди
`backend/src/modules/ai/workers.module.ts` (около `:200-201`, рядом с зарегистрированным зеркалом
`GoalEmbedWorker`):
- добавить в `providers` (и, если модуль экспортирует consumers, симметрично) `IssueEmbedWorker`;
- убедиться, что `IssueEmbedQueueService` доступен как провайдер там, где инжектится в `IssuesService`
  (проверить `TrackerModule`/`AiModule` — где живёт `IssuesService` и откуда должен прийти `embedQueue`).
- Импорты `IssueEmbedWorker` из `../tracker/workers/issue-embed.worker`, `IssueEmbedQueueService` из
  `../tracker/services/issue-embed-queue.service` (досверь пути).
- **Убрать narrative-комментарий** `:197-200` при правке (правило CLAUDE.md — код самодокументируем).

### Ф2 — DI `embedQueue` в IssuesService
`backend/src/modules/tracker/services/issues.service.ts:84` — `private readonly embedQueue?: IssueEmbedQueueService`.
Сейчас optional и приходит undefined. После регистрации провайдера — станет реальным. Проверить, что модуль,
объявляющий `IssuesService`, видит провайдер `IssueEmbedQueueService` (иначе optional так и останется undefined).
Если `IssuesService` в `TrackerModule`, а очередь регистрируется в `AiModule/WorkersModule` — обеспечить экспорт/
импорт так, чтобы DI разрешил. **Не** делать `embedQueue` обязательным (fail-soft на старте до доступности Redis).

### Ф3 — (опц.) backfill существующих открытых задач
`backend/scripts/backfill-issue-embeddings.ts` (idempotent): для задач с `embedding IS NULL` (открытых, за
разумный период) посчитать embedding через тот же путь, что воркер (`buildText` → `EmbeddingFallbackService.embed`
→ `UPDATE ... embedding=$1::vector(1536), embeddingHash`). Зарегистрировать в `apply-prod-deploy.ts STEPS`
(phase backfill, skipBootstrap). Прогон дважды = no-op.

## 2. Прод-операции
- **Миграции БД нет** (колонка `Issue.embedding vector(1536)` уже есть; HNSW-индекс `core.issue-embed`/postgres-init
  — проверить, что индекс существует; если нет — Шаг 5).
- Новый воркер/очередь → `prod-deploy-log.md` Шаг 12 (smoke: очередь `core.issue-embed` получает джобы,
  `Issue.embedding` заполняется после создания задачи).
- Backfill (если делаем) → Шаг 8.

## 3. Acceptance
- [ ] `IssueEmbedWorker` + `IssueEmbedQueueService` зарегистрированы; `IssuesService.embedQueue` резолвится (не undefined);
- [ ] создание задачи (ручное и AI-авто-accept) → джоба в `core.issue-embed` → `Issue.embedding` заполнен;
- [ ] narrative-комментарий на месте регистрации удалён;
- [ ] `typecheck/lint/build` зелёные; юнит на enqueue-путь (queue задан → enqueue вызывается);
- [ ] **стенд task-stand:** категория D (дедуп задача↔задача) и H (закрытие) — на СВЕЖЕМ прогоне AI-созданные
      задачи участвуют в KNN (не только setup); ложные no_match из-за отсутствия embedding исчезают;
- [ ] (опц.) backfill idempotent, зарегистрирован в STEPS; `prod-deploy-log.md` обновлён (Шаг 12 + опц. 8).

## 4. Проверка стендом
До фикса: стенд считает embedding setup-задачам вручную (обход). После фикса: обход можно снять и проверить, что
задачи, СОЗДАННЫЕ в ходе inject, тоже получают embedding и участвуют в дедупе/закрытии (сейчас — нет).

## Итог
Реализовано: —/—. Регистрация осиротевшего воркера восстанавливает задуманный embedding-путь задач; чинит
дедуп/закрытие против AI-созданных задач. Логика воркера уже написана — правка минимальная (DI-регистрация +
опц. backfill).
