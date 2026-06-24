---
type: analysis
status: research-input
feature: knowledge-graph-ingestion-audit
date: 2026-06-23
snapshot_date: 2026-06-23
---
# 08 — Эмпирический тест Hyper-Extract на русском (verified, реальный прогон)

Запущен реальный `he parse` (hyperextract 0.3.0, склонирован из github.com/yifanfeng97/Hyper-Extract) на двух RU-текстах через LLM (gpt-4o-mini). Цель — проверить, даёт ли его гиперграфовая модель что-то поверх нашего реифицированного факта.

## Установка/запуск (факт)
- Python 3.12, `pip install hyperextract` (deps лёгкие: langchain-openai, pydantic). `he --version` = 0.3.0. → verified
- LLM настраивается `he config llm -p openai -k … -m … -u …` (OpenAI-совместимый); шаблон — по полю `name:` в YAML (`general/hypergraph`, `general/graph`).

## Робастность (наблюдалось вживую) → verified
- **`general/workflow_graph` (temporal) упал**: `TypeError: argument of type 'NoneType' is not iterable` в `utils/template_engine/parsers/identifiers.py:22` — самый релевантный для регламентов/SOP шаблон не работает из коробки.
- **DeepSeek (наш дешёвый primary) отклонил** `response_format: json_schema` → `400 This response_format type is unavailable now`. Гиперграф-путь на нашем основном стеке не работает; пришлось переключиться на OpenAI gpt-4o-mini.
- Windows-консоль: `UnicodeEncodeError charmap '⠇'` — лечится `PYTHONUTF8=1`.
→ Подтверждает «молодой/сырой проект» из `99-synthesis` §3.

## Тест 1 — регламент → `general/graph` (бинарный) → verified
Вход: «Регламент согласования договоров» (5 шагов). Выход: 9 узлов (роли менеджер/юрист/финдир/гендир + Битрикс24/Telegram/Договор/Клиент), 9 типизированных бинарных рёбер (готовит/загружает/проверяет/возвращает/согласует/подписывает/уведомляет). Русский — ок. **Минус:** условия («если риски → возврат», «>1 млн → гендир») ушли в текст `description`, не в структурные поля (поле `condition` есть только в упавшем temporal-шаблоне).

## Тест 2 — созвон → `general/hypergraph` (n-арность) → verified
Вход: «Созвон команды… Настя поручила Сергею до 25 июня…; Айназ взяла скрипты; решили отключить камеру — ответственный Сергей.»
Выход: 8 узлов (3 person + event/location/object/concept/org); 4 гиперребра.
- ✅ **N-арность реально захвачена:** гиперребро «Созвон команды» `participants: [Настя, Айназ, Сергей]` — 3 узла в одном ребре (бинарным не выразить).
- ❌ **Но рич-структура потеряна:** «Настя поручила Сергею **до 25 июня**» → ребро `{type: task, participants: [Сергей]}` — **потерян автор (Настя) и срок (25 июня)**. `participants` — плоский список БЕЗ ролей (кто→кому) и БЕЗ дат.
- ❌ Нет провенанса (источник на узле/ребре отсутствует в `data.json`); нет cross-source склейки личности.

## Вывод (вход для ТЗ → R13)
Гиперребро `participants` беднее нашего реифицированного `IdeaBlock`: мы храним `commitmentAuthorPersonId` / `commitmentRecipientPersonId` / `commitmentDueDate` (КТО→КОМУ→КОГДА), а hyperedge — только «эти N участвовали». **Гиперграф-движок = даунгрейд для обещаний/решений.** Наш реальный прод-вывод на встрече Айназ извлёк задачи с `assignee` + `dueDate` — то есть мы уже правильнее.

**Что забираем:** не пакет (сырой, DeepSeek-несовместим, §7 — он Python), а урок-инвариант → **R13 ТЗ**: многосторонний факт обязан сохранять ВСЕХ участников + роли + срок, не схлопывать до одного исполнителя. Декларативные YAML-схемы (регламент извлёкся из ~40 строк YAML без кода) — полезная идея на будущее для мульти-источника, но реализуем своим движком.

Источник: github.com/yifanfeng97/Hyper-Extract (clone 2026-06-23), реальные `data.json` обоих прогонов.
