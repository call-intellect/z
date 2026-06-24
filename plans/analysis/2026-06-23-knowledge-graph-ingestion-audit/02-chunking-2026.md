---
type: analysis
status: research-input
feature: knowledge-graph-ingestion-audit
date: 2026-06-23
snapshot_date: 2026-06-23
---
# 02 — Лучшие практики чанкинга и обогащения чанка (2026)

## 1. Contextual Retrieval (Anthropic) — флагман
Перед эмбеддингом дешёвая LLM пишет 1-2 предложения «где мы и о чём это» и клеит в начало чанка (и в BM25).
- −35% провалов top-20 (5.7%→3.7%) только Contextual Embeddings → anthropic.com/news/contextual-retrieval [2024-09] → verified метод / claimed абсолют
- + Contextual BM25 → −49% (→2.9%); + reranking → −67% (→1.9%) → тот же → claimed(вендор)
- Контекст генерит Claude 3 Haiku, 50-100 токенов; с prompt caching ≈ $1.02/млн токенов документа → verified
**Z:** генерить контекст дешёвой DeepSeek-flash, клеить перед text-embedding-3-small. Prompt caching DeepSeek/proxy 95-99%. Чистый TS.

## 2. Semantic/topic chunking — выигрыш НЕ доказан
- «Нет систематических свидетельств выигрыша vs fixed-size, оправдывающего стоимость» → arxiv 2410.13070 (Qu/Vectara) → verified (независимая статья)
- F1@5 HotpotQA: fixed 90.59% > breakpoint-semantic 87.37% → verified
- Semantic выигрывает ТОЛЬКО на «сшитых» гетерогенных корпусах (Miracl 81.89 vs 69.45) → verified
- Качество эмбеддера важнее стратегии чанкинга → verified
**Конфликт:** вендоры продают semantic как «smarter», независимая статья — паритет/проигрыш. **Z:** не вкладываться; наша turn-based нарезка для диалогов уже рекомендованный подход.

## 3. Late chunking (Jina) — контекст без LLM
- Среднее +3.63% vs naive, без LLM → arxiv 2409.04701 → verified
- Требует длинноконтекстный эмбеддер с токен-уровневыми выходами → triangulated(2)
**Z: НЕ брать** — у text-embedding-3-small (OpenAI) нет режима late chunking; +3% не стоит смены инфры.

## 4. Parent-document / small-to-big
- Точность ответа +15-30% на широких запросах → langcopilot.com [2025-10] → claimed
- Канон: дети ~100 ток / родители ~500 ток (LangChain) → triangulated(2) → verified
- Большие чанки (~14400 симв.) вносят «context confusion» даже у 200k-моделей → snowflake.com → claimed/triangulated
- Прод: recursive 400-800 ток + 20% overlap → triangulated(2)
**Z:** у нас есть иерархия IdeaBlock ↔ чанк ↔ встреча. Parent-document = FK child→parent в Postgres, без новой инфры.

## 5. Метаданные чанка
- Категории: document-level (url/автор/время/версия), content (keywords/summary/entities), structural (заголовки/секции/страницы) → unstructured.io → verified/claimed
- header-path к тексту перед эмбеддингом — «высокий ROI, несколько строк» → claimed
- LLM-метаданные → +5-15% precision → triangulated(2)/claimed
- Транскрипты: метки говорящего + таймстемпы ↑ precision и доверие → cohere docs → triangulated(2)/verified
**Z (минимум на чанк):** `meetingId, meetingType (9 типов!), tenantId, speakerId/role, startTs/endTs (word-timings → клик-в-источник), meetingDate`.

## 6. Чанкинг диалогов (наш профиль)
- Реплики одного говорящего держать вместе (turn-based) — рекомендовано → cohere → verified
- sliding window 20-50% overlap сохраняет контекст через границы → triangulated(2) → verified
- В call-транскриптах темы меняются часто → overlap особенно важен → claimed
**Z:** turn-based направление верное; 2 пробела — НЕТ overlap и лимит 2000 ток великоват (точнее 400-800).

## Приоритет для Коры (по ROI)
1. **Contextual Retrieval** (−35..49%, копейки, TS). 2. **Метаданные + speaker/timestamp** (фильтр + клик-в-источник). 3. **Parent-document** через нашу иерархию (FK). 4. **Чинить нарезку** (overlap 20%, 400-800 ток). 5. **НЕ брать:** late chunking, дорогой semantic chunking.

Источники: anthropic.com/news/contextual-retrieval; arxiv 2410.13070; arxiv 2409.04701; jina.ai late-chunking; langcopilot.com; snowflake.com finance-rag; unstructured.io; cohere docs chunking.
