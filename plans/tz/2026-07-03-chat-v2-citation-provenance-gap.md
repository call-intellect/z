---
title: chat-v2 — пустые citations на заземлённом ответе (провенанс-дыра)
date: 2026-07-03
type: tz
status: ready-to-implement
area: chat-v2 / provenance
relates_to:
  - plans/analysis/2026-07-03-recall-ceiling-hypotheses.md
  - plans/tz/2026-07-03-recall-eval-ruler.md
---

# ТЗ: провенанс-дыра chat-v2 — `[BLOCK:id]` вне набора валидации citations

## Зачем

Диагностика recall вскрыла: ответ содержит инлайн `[BLOCK:cmr…]` (q088), но `usedBlockIds`/`citations`
пусты. Статически (chat-v2.service.ts): `parseUsedBlockIds`/`parseCitationsFromAnswer` (стр. 2681/2632)
валидируют цитату по `contextBlocks` (`valid.has(id)`); 24-символьный cuid модель не выдумывает — копирует
из показанного контекста. Значит **показанный модели контекст ШИРЕ набора валидации citations**. Последствие:
**пользователь видит заземлённый ответ без кликабельных источников** — падает доверие и провенанс, ради
которого весь маркер-механизм и строился.

## Гипотеза причины (подтвердить в Ф0)

Набор блоков в промпте включает каналы, которых нет в `contextBlocks`:
- contradiction-блоки — `chat-v2.service.ts:2345` эмитит `[BLOCK:${c.id}]` для `c` (counter-evidence);
- кандидаты: граф-соседи (expandViaEntityLinks/Cypher) и строки таблиц (`ChatV2TableContextService`),
  если они попадают в текст промпта, но не в массив `contextBlocks`.

## Границы
- **В scope:** свести набор валидации citations с набором ПОКАЗАННЫХ модели блоков; не потерять citations
  на легитимных источниках; не сломать анти-выдумку (id вне ЛЮБОГО показанного набора по-прежнему отбрасываем).
- **НЕ в scope:** менять сам синтез-промпт/ретрив; расширять типы citation-ссылок сверх meeting/document.

## Фаза 0 — Подтвердить канал (read-only, статически; repro под стендом) `[ ]`
- Трассировать сборку `finalUser`-контекста vs заполнение `contextBlocks`: какие блоки уходят в текст
  промпта (contradiction / граф-соседи / table-context), но отсутствуют в массиве валидации.
- Под стендом (когда освободится) — repro на q088: залогировать показанные id ∖ `contextBlocks`.
- Выход Ф0: точный список «показано, но не валидируется».

## Фаза 1 — Единый набор «показанных блоков» `[ ]`
- Ввести `shownBlocks` = все блоки, реально попавшие в промпт (основные + contradiction + граф-соседи +
  table-rows, если они несут `[BLOCK:id]`), с их `primaryMeetingEvidence`/`primaryDocumentSource`.
- `parseUsedBlockIds`/`parseCitationsFromAnswer` валидируют по `shownBlocks`, а не по узкому `contextBlocks`.
- Инвариант анти-выдумки сохраняется: id вне `shownBlocks` — отбрасываем (не citation).
- Метрика: инкремент `chat_v2_citation_orphan_total` когда `[BLOCK:id]` в тексте не резолвится ни в один
  показанный блок (наблюдаемость дыры на будущее).

## Фаза 2 — Тесты `[ ]`
- Unit: ответ с `[BLOCK:id]` из contradiction-блока → citation строится (было пусто); id вне показанного →
  отброшен; дедуп citations; meeting и document оба резолвятся.
- Golden-фикстура: текст q088-типа (несколько `[BLOCK:cmr…]`, часть из contradiction) → непустой
  `usedBlockIds` + citations.
- Приёмка: typecheck(вкл .spec)/lint/build; `bunx vitest run` по chat-v2 модулю зелёный; на замороженной
  фикстуре q088 `usedBlockIds` перестаёт быть пустым.

## Прод-деплой
Правки внутри `backend/` без миграций/ENV/seed → **prod-операций нет** (обычный редеплой backend). Если
добавляется метрика — Шаг 12 smoke (`/metrics` содержит `chat_v2_citation_orphan_total`).

## Итог
Реализовано: —. Осталось: Ф0–Ф2. Ф0 частично статически подтверждён (parse-функции валидируют по узкому
`contextBlocks`); финальный repro q088 — под стендом.
