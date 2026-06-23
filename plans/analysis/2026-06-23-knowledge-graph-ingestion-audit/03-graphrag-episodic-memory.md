---
type: analysis
status: research-input
feature: knowledge-graph-ingestion-audit
date: 2026-06-23
snapshot_date: 2026-06-23
---
# 03 — GraphRAG / эпизодическая граф-память (узел «суть»)

## 1. Microsoft GraphRAG — community summaries
- Иерархический Leiden → сообщества узлов; на каждое — резюме (= «суть кластера встреч») → arxiv 2404.16130 + mintlify → triangulated(2)
- Резюме bottom-up: element-summaries по убыванию степени узлов до лимита контекста; на верхних уровнях под-резюме вместо элементов → arxiv 2404.16130 → verified
- Глобальный ответ = map-reduce (partials 0-100 → reduce) → verified
- Контекст 8k токенов; стек Python → verified / claimed (**порт в TS**)
- C0-резюме на 97% меньше токенов (9x-43x) против суммаризации сырья → verified

## 2. Graphiti/Zep — temporal/episodic KG (РОВНО наш кейс)
- **Episode node**: сырьё (message/text/json) + timestamp `t_ref`, не-лоссово → arxiv 2501.13956 → verified
- 3 подграфа: Episode (сырьё) → Semantic Entity → Community (кластеры+резюме) → verified
- **Bi-temporal — 4 метки**: valid/invalid (в мире) + created/expired (в системе); факт инвалидируется, не удаляется → verified
- Community: label propagation + **инкрементальное** присвоение новой сущности (НЕ полный пересчёт) + map-reduce резюме → verified
- Retrieval: cosine + BM25 + BFS + reranking (RRF/MMR/cross-encoder) → verified
- Backends Neo4j/FalkorDB/Neptune; стек Python → verified / inferred (**порт в TS**)

## 3. LightRAG / Cognee / nano-graphrag (проще/дешевле)
- LightRAG: dual-level retrieval + **инкрементальные апдейты без rebuild**; граф документа ≈$0.15 vs $4 GraphRAG → claimed
- Cognee: ECL pipeline, гибрид vector+graph; Python → claimed (**порт в TS**)
- nano-graphrag: ~1100 строк, но каждый insert пересчитывает сообщества+reports → verified

## 4. Доказанные минусы GraphRAG (цифры)
- Индексация $51.37–389.12; учебник = 35 мин + 4000 LLM-вызовов → triangulated(2)
- Стоимость падает: $33k (2024) → ~$33 (mid-2025, LazyGraphRAG) → claimed
- Global latency 9.95–70.12с; query 2–8с → triangulated(2)
- Global промпт до 40k токенов (vs 879 vanilla); до 610k токенов/запрос → triangulated(2)
- Win-rates 72–83% — но independent нашёл 3 смещения в LLM-as-judge → verified(числа)/triangulated(критика)

## 5. Маппинг на Z + что взять под «узел встречи»
- **Episode-node** = завести `MeetingEpisode`/`Episode` — родитель над IdeaBlock/Entity + собственное резюме + обратные индексы «факт←эпизод». Это и есть недостающий «узел встречи/её суть».
- **Bi-temporal** = 4 колонки на EntityLink, чистый Postgres (AGE не нужен).
- **Community/Theme** = достроить `Theme.summary` через label-propagation + map-reduce, инкрементально (минус GraphRAG-rebuild).
- **Retrieval** = pgvector HNSW + tsvector BM25 + RRF.
- **НЕ брать GraphRAG-global буквально** (10–70с, $51–389) — для «пульса за 30с» антипаттерн; брать инкрементальную Zep-модель.
- Все 4 системы — Python → методы портировать в TS (§7 CLAUDE.md).

Источники: arxiv 2404.16130; arxiv 2501.13956; help.getzep.com/graphiti; github nano-graphrag; lightrag.github.io; cognee.ai; arxiv 2503.02922; arxiv 2503.04338; medium graph-praxis (cost cliff).
