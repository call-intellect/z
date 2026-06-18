---
title: Слияние 3 фича-веток + dev в feature/merge-all-2026-06-18
date: 2026-06-18
distilled: false
---

# Слияние 3 фича-веток + dev в feature/merge-all-2026-06-18

## Что было поставлено

Владелец создал 3 ветки от `dev`, они отстали; нужно слить их вместе, убрать
отставание, разрешить конфликты, чтобы можно было кинуть один PR в `dev`:
- `feature/knowledge-base-redesign-formatter`
- `feature/meeting-fixes-and-result-redesign`
- `feature/assistant-calendar-fixes`

## Как решал

**Разведка структуры (ключевой момент):** ветки оказались НЕ параллельными, а
**стопкой** (общий merge-base `94fbe7d3`):
`knowledge-base-redesign-formatter` ⊂ `meeting-fixes-and-result-redesign` ⊂
`assistant-calendar-fixes`. То есть `assistant-calendar-fixes` — строгое
надмножество, содержит все коммиты двух других. «Объединение трёх» свелось к:
интеграционная ветка от `assistant-calendar-fixes` + влить `dev` (89 коммитов).

Создал `feature/merge-all-2026-06-18` от `origin/feature/assistant-calendar-fixes`,
`git merge origin/dev` → **85 конфликтов**.

**Стратегия резолюции** (по природе конфликта, выявленной через `git log MB..dev -- <file>`):
- В `dev` был коммит `c5bffaf2 style: вычистка всех комментариев` — поэтому
  масса конфликтов = «dev убрал комментарии/сменил кавычки» × «ветка добавила
  фичу в том же месте». Лечилось по паттернам:
  - **dev-heavy + мелкий впрыск фичи** (breadcrumbs, meeting-room фиксы, ENV,
    seed-настройки, deploy-step, tracker meetingId) → база dev (`--theirs`) +
    точечная вставка дельты ветки без комментариев.
  - **фича-ветка как владелец, dev = только косметика** (probe/events/calendar/
    EventForm/meeting-result-v2/CoraFeedWidget/Header/IncompleteSetupBanner) →
    база ветка (`--ours`).
  - **semantic union** (schema.prisma, concierge service-map, knowledge-core
    промпты, conversational дедуп+ранний-ACK × assistant-routing dev, docs).
- Параллелил независимые непересекающиеся кластеры через фоновых суб-агентов
  (Edit-only, БЕЗ git — индексом управлял только сам, чтобы не словить
  `index.lock`): breadcrumbs ×14, docs ×9, knowledge-core промпты ×4,
  conversational ×7, и финальную вычистку комментариев ×25.
- `/feed` страница удалена (стала виджетом) — DU-конфликт разрешён как удаление;
  каскадом подчищены ссылки (memory-хаб, CommandPalette, TeamActivityWidget).

**Коммиты:** merge `7a42f798` + чистка комментариев `22bf532d` (отдельным,
т.к. `--ours`-файлы вернули комментарии, вычищенные dev).

## Что вышло

- Все 85 конфликтов разрешены, маркеров в репозитории нет.
- Верификация зелёная: backend `typecheck` 0 · `lint` 0 errors · `build` 0 ·
  probe/events/intake unit 157/157, после чистки 139/139; frontend `next build`
  exit 0 · `lint` 0 errors; `prisma generate` ок.
- Ветка `0 позади / 41 впереди` dev; dry-run `git merge-tree origin/dev HEAD`
  показал, что PR в dev пройдёт без конфликтов. Запушено в новую ветку.
- Исходные 3 ветки не тронуты (по решению владельца).

## Чему научился

- **Сначала проверять ancestry веток** (`git merge-base --is-ancestor`,
  `rev-list --left-right`). «Слить 3 ветки» при стопке = одна ветка-надмножество
  + один merge dev. Сэкономило тройную работу по конфликтам.
- **`git log merge-base..dev -- <file>`** мгновенно отличает «dev менял
  функционально» от «dev только чистил/реформатил» — это и есть выбор стороны
  базы для резолюции.
- **`git checkout --ours/--theirs` ТЕРЯЕТ auto-merged изменения другой стороны
  вне конфликта.** Где у dev были функциональные auto-merged правки в том же
  файле (block-ingest, me.controller) — резолвить НАДО правкой маркеров in-place
  (или `git checkout -m` для восстановления), а не `--ours`.
- **Суб-агенты для merge безопасны только Edit-only**: `git add/checkout`
  параллельно лочат индекс. Чтение обеих сторон им давал через
  `git show :1:/:2:/:3:` (индекс не лочат).
- **`tsc --noEmit` на фронте даёт ложные ошибки** про удалённый роут из
  стейлового `.next/dev/types/validator.ts` — авторитетен `next build`
  (регенерит типы). См. [[project-tsc-oom-false-clean]] (бэкенд — свой OOM-кейс).
- Паттерн «dev сделал глобальную вычистку комментариев» → при merge фича-ветки
  комментарии возвращаются; нужен отдельный проход чистки (сохраняя директивы
  eslint/@ts-expect-error/'use client', не трогая строки/промпты/JSX-текст).
