---
type: analysis
status: research-input
feature: knowledge-graph-ingestion-audit
date: 2026-06-23
snapshot_date: 2026-06-23
---
# 07 — Red-team: независимая атака на рекомендацию

Независимый retrieval. Итог: пункт (а) контекстный чанкинг — ВЫЖИЛ с оговоркой; (б) эпизод-граф и (в) cross-source resolution графом — **ОСЛАБИТЬ** (граф преждевременен для нашего профиля запросов).

## Контр-доказательства
**Против «contextual chunking универсально окупается»:**
- Выигрыш сильно доменно-зависим: fiction +77%, arXiv «no benefit at top-20» → medium/almond-ai → claimed
- Бóльшую часть даёт **rerank+BM25 БЕЗ contextual** (5.7%→3.5%) → triangulated(2)
- Headline 67% вводит в заблуждение для бизнес-данных (усреднение по доменам) → inferred

**Против «строить эпизод/community-summary»:**
- LLM-extraction ~58% индексных токенов; 610k токенов/извлечение vs ~100 lightweight (6000×), latency 2.3×, ответ 20-24с → tao-hpu medium → claimed
- GraphRAG «no incremental updates» — rebuild на каждое обновление (наш поток встреч/Битрикс/чатбокс — худший кейс) → claimed
- Graphiti: каждый эпизод = неск. LLM+embedding вызовов, «at scale very expensive»; ingest ~0.5-2с/эпизод → github issue #1193 + neuralmaze → claimed/triangulated(2)

**СИЛЬНЕЙШИЙ (независимый, арбитражный):**
- После устранения дефектов оценки win-rate LightRAG vs NaiveRAG **66.70%→39.06%** (−40% преимущества); на Agriculture **NaiveRAG ОБОГНАЛ** → arxiv 2506.06331 «Unbiased Evaluation Framework for GraphRAG» (2025-06) → **verified**
- «RAG и GraphRAG комплементарны, нет стабильного победителя»; single-hop факты — **vanilla RAG обгоняет** (NQ F1 64.78 vs 63.01; NovelQA 55.28% vs 30.89%); KG покрыл 65.8% answer-entities → arxiv 2502.11371 → **verified**. Граф выигрывает только multi-hop/aggregation.

**Семантическая нарезка:** fixed 90.59% > semantic 87.37% (HotpotQA) → arxiv 2410.13070 → verified.

## Конфликт (не усредняю)
Вендоры (FalkorDB и др.): «GraphRAG 3.4× точнее на entity-запросах». Независимые arxiv: преимущество завышено дефектами оценки, исчезает/реверсируется на простых запросах. **Вес: вендор→claimed, arxiv→verified.** Истина не посередине — граф помогает узко (multi-hop, aggregation, ≥5 сущностей), вредит на single-hop фактах (большинство запросов Коры).

## Вердикт по частям
- **ВЫЖИЛО (а):** контекстный чанкинг + провенанс-метаданные — НО главный выигрыш от **hybrid(BM25+вектор)+rerank**, не от LLM-контекста. Сначала hybrid+rerank на плоском pgvector, потом мерить, нужен ли LLM-контекст. Выкатывать с замером.
- **ОСЛАБИТЬ до «плоский RAG» (б):** «суть встречи» нужна, но через **summary-чанк на встречу** (parent-document) в плоском pgvector, НЕ через community-граф. Убирает 58% токенов на extraction, отсутствие incremental, 6000× токен-взрыв. Граф-эпизод оправдан только если доля multi-hop ≥ порога.
- **ОСЛАБИТЬ сильнее всего (в):** cross-source entity resolution **графом** — дорого/рискованно (wrong-merge, error propagation, AGE без индексов). Начать с **детерминир. matching по ID/email + alias-cache**, LLM-граф-резолюцию только если детерминир. потолок доказанно мал.

## Сильнейший единственный контр-аргумент
arxiv 2506.06331 (verified): после фикса дефектов оценки преимущество graph-RAG сжимается ~40%, на одном датасете naive обгоняет → превосходство частично артефакт измерения. + arxiv 2502.11371 (verified): vanilla RAG обгоняет на single-hop, которых у Коры большинство. **Вывод: граф-эпизоды и cross-source resolution — преждевременная дорогая инфраструктура; сначала выжать плоский pgvector с hybrid+rerank+parent-document+провенанс и ИЗМЕРИТЬ долю multi-hop, прежде чем строить граф-слой.**

Источники: arxiv 2506.06331; arxiv 2502.11371; arxiv 2410.13070; medium/almond-ai contextual-retrieval; tao-hpu medium; github getzep/graphiti issue #1193; neuralmaze graphiti.
