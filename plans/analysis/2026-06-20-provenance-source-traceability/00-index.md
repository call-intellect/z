---
type: analysis
status: research-complete
feature: provenance-source-traceability
date: 2026-06-20
snapshot_date: 2026-06-20
owner: Сергей (владелец)
related:
  - plans/analysis/2026-06-20-probe-smart-questions-module.md
  - plans/tz/2026-06-11-probe-question-context-leak-fix.md
  - second-brain/03_processes/raw-event-to-graph.md
  - second-brain/02_architecture/knowledge-core.md
  - second-brain/06_marketing/competitors.md
---

> **Цель разбора.** У каждой автосоздаваемой сущности кабинета (инструкция, регламент, задача, решение, уведомление, проактивный вопрос, ячейка таблицы, ответ ассистента) должна быть единая кнопка «провалиться к первоисточнику» — к фрагменту встречи с таймкодом / сообщению чата с каналом и датой / голосовой заметке сотрудника / куску документа — с показом самой цитаты, чтобы пользователь мог проверить, правильно ли извлечено.
> **Следующий шаг → ТЗ:** `plans/tz/2026-06-20-provenance-source-traceability-tz.md` (после закрытия развилок раздела 9 синтеза).

# Провенанс / трассировка первоисточника — оглавление исследования

Исследование собрано массовым параллельным fan-out: 5 суб-агентов по нашему коду (полнота модели · верность ingest · UI · API · проактивные сущности) + 4 web-агента (citation-UX зарубеж · meeting-intelligence · OSS-цепочки доказательств · РФ-аналоги) + состязательный red-team с независимым retrieval. Снимок данных — 2026-06-20.

| Файл | Что внутри | Статус |
|---|---|---|
| [10-internal-baseline.md](10-internal-baseline.md) | Что **уже есть в коде Z**: таблица полноты провенанса по 26 типам сущностей, верность ingest по каждому источнику, инвентарь UI-аффордансов, API и deep-link-примитивы, провенанс проактивных сущностей. Все факты с `file:line`. | research-input |
| [20-external-landscape.md](20-external-landscape.md) | Как делают лучшие: citation-UX (Perplexity/Glean/Copilot/Notion), meeting-intelligence (Gong/Otter/Avoma/Fireflies/Fathom), OSS-цепочки (RAGFlow/Onyx/Verba/Quivr), РФ (istok.ai/Яндекс Нейро/МТС Линк/НаВстрече/mymeet/Таймлист). | research-input |
| [99-synthesis.md](99-synthesis.md) | **Главный документ-контракт:** рамка проблемы, дерево вопросов, gap-таблица «конкурент × Z», матрица вариантов с ADR-доказательством, рекомендация (уточнённая red-team), инварианты для ТЗ, открытые развилки владельцу, допущения/ограничения, источники. | research-complete |

## Краткий вывод (на одну страницу)

**Провенанс-хребет в Z уже построен и работает в проде** (`Source → RawEvent → IdeaBlockEvidence{quote, startMs, endMs} → IdeaBlock`, plus `sourceBlockIds[]`/`contextBlockId` почти на всех вершинах). Разрыв — **не в данных, а в трёх местах**:
1. **Последняя миля deep-link** — нет перехода к таймкоду встречи (`MeetingResultPageReal` не читает `?t=`), к сообщению чата, к странице документа; голосовой оригинал не сохраняется вовсе.
2. **Единый аффорданс** — нет ни одного backend-резолвера провенанса (`ProvenanceResolver` = 0 совпадений) и ни одного переиспользуемого UI-компонента «Откуда это»; реализовано 6 несовместимыми паттернами, «мост недостроен с обоих концов» (фронт-каркас `cite` есть — бэкенд не наполняет; бэкенд-указатель `contextBlockId` есть — фронт не рендерит).
3. **Точечные потери в коде** — задачи из встреч теряют block-линк (`evidenceBlockIds:[]` хардкодом), probe-вопрос не несёт первоисточник в payload, snippet ответа Concierge берётся из вывода LLM, а не из дословной evidence.

Рекомендация — **Вариант A (уточнённый)**: единый контракт `ProvenanceService.resolve(entityType, entityId, viewerContext)` + один компонент «Откуда это» с двумя точками входа (inline-маркер + дровер), но обязательно с (1) денормализованным preview-quote на вершине для списков, (2) фильтрацией каждого звена по правам зрителя `IdeaBlockAccess`/`dataClass`, (3) graceful-degradation для legacy. Детали и доказательство — в [99-synthesis.md](99-synthesis.md).
