---
type: analysis
status: research-input
feature: knowledge-graph-ingestion-audit
date: 2026-06-23
snapshot_date: 2026-06-23
---
# 01 — Текущий конвейер Коры + ревью «сердца» (block-extraction)

## Текущий конвейер (по коду, verified чтением)
`RawEvent` (sourceType: meeting / meeting_report / chatbox / free_note / …) → `segment-builder.service.ts` (нарезка) → `block-extraction.service.ts` (LLM → IdeaBlock) → `entity-resolution.service.ts` (4 ступени + LLM merge) → `block-linker.worker.ts` (рёбра IdeaBlockLink, LLM-судья по cosine-KNN, по гейту) → `theme-clusterer.cron.ts` (embedding-кластеры + LLM-нейминг, ежечасно) → `search.service.ts` (плоский cosine+BM25), chat-v2 добавляет 1-hop по рёбрам + reasoning chains.

**Нарезка (segment-builder):** транскрипт = группировка подряд идущих реплик одного говорящего + лимит `BLOCK_INGEST_MAX_TOKENS_PER_SEGMENT=2000` (≈8000 симв.), длинная реплика рубится посимвольно. Отчёт = по 1 сегменту на факт/главу + 1 на summary. **Без смысловой нарезки, без overlap.**

**Провенанс:** транскрипт-блоки → `sourceMeetingId` + evidence (цитата+таймкод); **отчёт-блоки → `sourceMeetingId=null`** (`block-ingest.worker.ts:494`), confidence ≤ 0.6 (`:931-937`).

## Ревью «сердца умности» — block-ingest.prompt.ts + block-extraction.service.ts

### (1) Сколько/какие блоки извлекать
- «1 факт = 1 блок» — ЕСТЬ, явно (`block-ingest.prompt.ts:340`).
- Дедуп — точечный (только idea↔decision, `:415-416`), общего нет (отдан графу).
- Фильтр шума ЕСТЬ (`:337-341`); 66 типов сигналов (`SIGNAL_TYPE_VALUES`, enum в JSON Schema `:158` + Zod). **Лимита на число блоков нет** → риск over-extraction.

### (2) Поля блока + заголовок-контекст + провенанс
- Required: `name, criticalQuestion, trustedAnswer, signalType, tags, confidence, evidenceQuote, evidenceStartMs/EndMs, mentionedEntities, role_relevant, roleHint, …` (`:137-191`).
- **Контекст-заголовок «о чём это в рамках встречи» — НЕ генерируется и не пристёгивается к блоку.** Это главный недобор vs Contextual Retrieval.
- In-window провенанс (цитата+таймкоды) — сильный. Провенанс «кто/какая встреча» в самом блоке НЕТ — держится снаружи (`sourceRef: raw-event`, `block-extraction.service.ts:483`), не в эмбеддируемом тексте.

### (3) Контекст всей встречи перед извлечением
- Подаётся только `meetingTitle` (опционально), на всё окно (`:442-455`). **НЕТ:** участников/ролей, типа встречи, **даты** (хотя промпт `:356` просит считать сроки «от даты разговора» — разрыв/баг), соседних окон (overlap нет, `:339` «Без overlap»).

### (4) vs Contextual Retrieval — честная оценка
Классификация и анти-галлюцинация — сильная best practice (детальный дисамбигуатор классов + самопроверка `:421-430`, калибровка confidence, запрет латиницы, мягкий парсинг Б38). **Контекстуализация чанка — слабое звено:** нет контекст-заголовка к блоку, дата не передаётся (баг), нет участников, нет overlap. Рекомендации: (1) передать дату; (2) добавить контекст-заголовок и склеить с текстом перед эмбеддингом; (3) подавать участников/тип; (4) overlap окон (TODO в коде `block-extraction.service.ts:339`).

Файлы: `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts`, `backend/src/modules/knowledge-core/services/block-extraction.service.ts`.
