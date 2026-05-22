---
title: Merge Wave 4 с origin/dev (livekitRecord)
date: 2026-05-22
distilled: false
---

# Контекст

Накопил локально 4-ю волну SBA (Alpha/Beta/Gamma — conversational channels, chat-v2, curation, specialists 3-1..3-7, новые CRUD-модули: decisions/events/ideas/insights/regulations/vendors/clones/knowledge-clone/probe + delivery-пакет + ТЗ). Ничего не было закоммичено. Параллельно на `origin/dev` влилась ветка `livekitRecord` (audio/video pipeline, egress, transcription) + 3 fix(deploy) коммита. Локальный dev отстал на 6 коммитов.

Задача: забрать origin/dev → закоммитить волну → запушить.

# Как решал

**1. Анализ перед действиями.** Сделал `git fetch`, посмотрел `git log HEAD..origin/dev` и `git diff --name-only`. Нашёл пересечение «изменено локально ↔ изменено в incoming»: `bun.lock`, `prisma/schema.prisma`, `app.module.ts`. Это три файла-конфликта.

**2. Безопасный порядок: коммит → merge → push.** Пользователь хотел «забрать → закоммитить → запушить», но это технически невозможно: `git pull` откажется, если в локальных staged-файлах есть конфликт с входящими. Объяснил это и согласовали: сначала фиксируем локальное, потом мержим.

**3. Страховочный тег.** `git tag backup/pre-pull-2026-05-22` на `4887a15` — гарантия отката.

**4. Разбивка локальной работы на 2 коммита:**
   - `0fa5c17 feat(competitor-parity): Wave 4 — backend+frontend` (258 файлов, +46957/-639)
   - `503f243 docs: Wave 4 — ТЗ SBA, delivery, second-brain` (79 файлов, +23373/-6)

   Хуки `.claude/hooks/*` и unrelated `plans/analysis/2026-05-22-unified-product-architecture.md` оставил untracked (правило «не коммитить чужое»).

**5. Merge.** `git merge origin/dev` → 3 конфликта:
   - `.gitignore` — объединил вручную (`backend/tmp/` + `.playwright-mcp`)
   - `app.module.ts` — оставил HEAD-версию (origin/dev в `96e1c45` убрал упоминания модулей именно потому, что они тогда не были закоммичены)
   - `bun.lock` — удалил и пересоздал через `bun install` (правильный путь для лок-файлов)
   - `schema.prisma` — `Auto-merging` без CONFLICT, удача от непересекающихся блоков

**6. Post-merge typecheck вскрыл 4 ошибки:**
   - **Backend (наследие):** `analyze-worker-with-resolver.integration.spec.ts` передавал 11 аргументов в `AnalyzeWorker`, но `22c1a7d feat(recordings)` отрефакторил конструктор и убрал `S3Service`. На origin/dev этот тест **тоже сломан**, fix-коммиты до него не дошли. Убрал лишний аргумент.
   - **Frontend (моя регрессия):** `CardsClient.tsx:44` — `Record<CardKind, …>` без `vendor`, но в Wave 4 я расширил `CardKind` доменом vendor. Добавил `vendor: Store` иконку и option в селектор.
   - **Frontend (моя регрессия):** `IdeasListClient.tsx` — `JSX.Element` без импорта. React 19 убрал глобальный `JSX`. Применил тот же паттерн, что `bc33f00`: `import { …, type JSX } from 'react'`.

   Post-merge fix-коммит `69a585b fix(post-merge)`.

**7. Push.** `git push origin dev` → `bc33f00..69a585b`, прошёл с первой попытки.

# Что вышло

- 4 локальных коммита (`0fa5c17` → `503f243` → `5c5146c merge` → `69a585b post-fix`) на сервере.
- Backend `bun run typecheck` ✅
- Frontend `bun run typecheck` ✅ (после `bun install --registry https://registry.npmjs.org`)
- Prisma client пересобран.
- 3 unstaged файла (хуки + unrelated план) не тронуты, как и должно.

# Чему научился

1. **«Забрать сначала, потом закоммитить» — миф.** Если есть локальные правки в файлах, которые тоже изменились в incoming, `git pull` всегда упадёт. Правильный порядок — коммит → merge → push. Стоит сразу объяснять пользователю эту механику, а не делать в его желаемом порядке.

2. **Тег `backup/<дата>` перед merge — дёшево и спасает.** Стоимость одна команда, профит — гарантированный откат к любой точке до конфликтов.

3. **`bun.lock` при конфликте — удалять и пересоздавать.** Ручной merge лок-файла бессмыслен и опасен (нарушит хэши). `rm bun.lock && bun install` решает за 15 секунд.

4. **При мердже отдельной фичеветки (например, livekitRecord) рефакторинги конструкторов в общих сервисах ломают integration-тесты другой стороны — об этом fix(deploy) часто не знает.** Полный pre-push прогон `typecheck` обязателен после любого merge, даже если git сказал «успешно». В нашем случае origin/dev тоже был сломан, но никто не заметил.

5. **Глобальный `~/.npmrc` с `registry=https://registry.npmmirror.com` ломает install отдельных пакетов** (например `@livekit/components-react@2.9.21` отдаёт 404). Обход: явно `bun install --registry https://registry.npmjs.org` или локальный `bunfig.toml`. Это среда, не код — стоит зафиксировать в `code-pitfalls.md` если повторится.

6. **`tsc --noEmit` на CRLF-warnings внимания не обращает** — это нормально на Windows, gitattributes делает своё. Не стоит даже комментировать пользователю.

7. **Правило проекта «спрашивать про push отдельно» — оправдано на 100%.** Раньше казалось избыточным; здесь оно дало контрольную точку, когда мы могли остановиться и подумать, всё ли проверили. Стоит держать его буквально.

# Что осталось / Что не сделано

- **Prod-операции** не выполнены — это задача программиста на удалённой машине. Список инструкций отдан пользователю в чате (см. ниже).
- **Хуки `.claude/hooks/*`** — не закоммичены, статус неясен (личные пользователя? для команды?). Ждём решения.
- **Untracked план `2026-05-22-unified-product-architecture.md`** — появился во время сессии, не моя работа, оставлен.
