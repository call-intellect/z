---
date: 2026-07-06
type: reflection
title: ChatV2 — починка 9 устаревших тестов после base-recall-floor и каста branch::text
distilled: false
---

# ChatV2 — 9 устаревших тестов: атрибуция + починка

## Что было поставлено
Владелец: посмотреть коммиты по chat-v2 за 2 дня, которые могли дать «репадения» тестов; сначала только проанализировать (не чинить), подготовить заход. Затем — починить именно эти тесты, если не заденут параллельную сессию; убедить, что вывод верен. Затем — коммит и push.

## Как решал
Отправная точка — триаж `plans/analysis/2026-07-06-preexisting-test-failures-triage.md` (24 чужих падения). Из них 9 — ChatV2: rerank (7), iterative (1), retrieval-overview (1).

Атрибуция по `git show` двух прод-коммитов от 4 июля (оба верны, с A/B):
- `743bb890 base-recall-floor` — в `runRetrieval` добавлен **второй** `fetchCandidates` (крутилка `knowledge.chatV2BaseRecallFloor`, default true, Ship-On kill-switch), результаты фьюзятся RRF. Симптомы: «called 1×, got 2×» и «Cannot read properties of undefined (reading 'map'/'slice')» — лишний вызов мока возвращал undefined.
- `96e994e9 каст ThemeBranch::text` — SQL стал `"branch"::text = ANY(...)` (фикс 42883); ассерт overview.spec буквально ждал старую подстроку.

Починка (только spec, прод-код не тронут):
- rerank.spec + iterative.spec — в cfg-мок `getDynamic` добавлена строка `if (key === 'knowledge.chatV2BaseRecallFloor') return false;` → поведение = «до коммита», покрытие floor не теряется (свой `chat-v2-base-recall-floor.spec`).
- rerank.spec — тот же ключ добавлен в **локальный** `mockImplementation` override теста `router_v2_enabled=false` (он переопределял весь `getDynamic`, минуя общий мок — иначе floor снова ON).
- overview.spec — обе подстроки на `"branch"::text = ANY(`.

## Что вышло
- Целевые 4 файла (вкл. base-floor): 34/34. Весь chat-v2 набор: 217/217, регрессий нет.
- Коммит `ec927f52` — ровно 3 spec-файла. Push прошёл.
- Прод-операций нет.

## Чему научился
1. **Общий cfg-мок ≠ все тесты.** Отдельные тесты делают `getDynamic.mockImplementation(...)` — полностью заменяют реализацию. Правку дефолтной крутилки надо дублировать в каждый локальный override, иначе тест выпадает поодиночке (всплыл 9-й после починки 8).
2. **Параллельная сессия в общем индексе.** Между `git add` и `git diff --cached` в индексе внезапно оказались 28 чужих файлов (параллельная сессия сделала `git add`). Нельзя коммитить общий индекс. Решение: `git commit -m <msg> -- <явные пути>` — коммитит working-tree версию перечисленных путей, игнорируя staged-состояние остальных, не разрушая чужой индекс. Важно: `-m` **до** `--`, иначе `-m` уедет в pathspec.
3. **Устаревшие тесты ≠ баги.** Оба корня — верный прод-код, отставшие моки/ассерты. Диагноз «код опередил тест» подтверждается тем, что чинится в spec, а не в сервисе.
