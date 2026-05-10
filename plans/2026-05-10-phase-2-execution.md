---
type: execution-plan
phase: 2
feature: knowledge-core — IdeaBlock + Entity + ingest→distill→retrieve
status: in_progress
date: 2026-05-10
references:
  - plans/tz/2026-05-10-knowledge-core-tz.md
---

# Фаза 2 — план исполнения

Источник истины: [plans/tz/2026-05-10-knowledge-core-tz.md](plans/tz/2026-05-10-knowledge-core-tz.md), раздел «Фаза 2».

Цель — построить ядро. После этой фазы любой `RawEvent` автоматически превращается в дедуплицированные `IdeaBlock` с связанными `Entity`, поиск работает по cosine + BM25.

## Шаги

- [x] **Шаг 0. LLM-инфраструктура.** Коммит `95d0313`. DeepSeekService + OllamaService адаптеры, JSON Schema в LlmCallParams, новые `LlmTaskRoute` под политику 2026-05, smoke. Закрывает оставшийся долг Фазы 0 шага 1 (DeepSeek/Ollama, A/B, LlmModelPrice).
- [x] **Шаг 1. Prisma schema.** Коммит `758eb2f`. Модели `IdeaBlock`, `IdeaBlockEvidence`, `Entity`, `IdeaBlockEntity` + enum'ы `SignalType`, `IdeaBlockStatus`, `EntityType`, `IdeaBlockEntityRole`. Индексы pgvector HNSW + ts_vector GIN.
- [x] **Шаг 2. block-ingest.worker.** Коммит `d64c1a1`. Consumer для `core.raw-events`. SegmentBuilder → BlockExtraction (LLM JSON Schema strict) → Embedding → upsert IdeaBlock + Evidence + Entity + IdeaBlockEntity → enqueue `core.block-distill`.
- [x] **Шаг 3. block-distill.worker.** Коммит `c89c5cf`. Consumer для `core.block-distill` с дебаунсом 30s. KNN среди canonical → LLM `block-distill` → merge / distinct.
- [x] **Шаг 4. entity-resolver.worker.** Коммит `bc88d49`. Cron каждые 5 мин + on-event. Поиск дубликатов сущностей через cosine + LLM-арбитр.
- [x] **Шаг 5. Search API.** Коммит `073fcde`. Префикс `/api/v1/knowledge/*` (не `/api/v1/search` — занят). Гибридный cosine + BM25.
- [x] **Шаг 6. Бенчмарк + smoke + second-brain.** Коммит `66eaea9`. Смок degraded-mode (без LLM), benchmark скелет, second-brain документы.

## Статус Фазы 2: ✅ закрыта (7 коммитов).

## Архитектурные решения (фиксируются для всех субагентов)

1. **Embedding 1536 dim** через `text-embedding-3-small` (proxy) с fallback на local. BGE-M3 на 1024 — это Фаза 11.
2. **JSON Schema strict** через DeepSeek + OpenAI Responses API. Anthropic/MiniMax — через tool-call (Фаза 2 опционально).
3. **Сегментация:** group turns одного speaker'а ≤2000 токенов; окно 5-7 сегментов на один LLM-вызов `block-ingest`. Не делаем отдельный «найди границы тем» вызов.
4. **Casbin in-house engine** (не `@nestjs/casbin`) — закреплено в Фазе 0, путь миграции отмечен.
5. **`MeetingTranscriptChunk` не дропается** — продолжает работать для chat-v1 до Фазы 6.

## Точки контроля

После каждого шага:
- `bun run typecheck` зелёный.
- После Шага 1 — `bun run prisma:push --accept-data-loss` + `bun run prisma:generate`.
- После Шагов 2/3/4 — соответствующий smoke-script.
- Атомарный коммит на шаг.
