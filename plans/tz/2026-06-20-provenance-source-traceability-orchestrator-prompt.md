# Orchestrator-prompt — Провенанс / трассировка первоисточника (v1)

Запусти реализацию ТЗ как главный оркестратор-разработчик (скилл `tz-orchestrator`), фаза за фазой силами суб-агентов в отдельном git worktree.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (инварианты, vexp-правило).
2. ТЗ: `plans/tz/2026-06-20-provenance-source-traceability-tz.md` — контракт. Решения владельца Р-1…Р-4 закрыты, НЕ переоткрывать.
3. Анализ (для «почему»): `plans/analysis/2026-06-20-provenance-source-traceability/99-synthesis.md` (§6 матрица, §8 инварианты).
4. Код-якоря из REALITY-CHECK ТЗ — перечитать по символу-якорю перед правкой (номера строк дрейфуют).

## Инструменты
- vexp `run_pipeline` первым, если демон жив; **в этой сессии vexp был недоступен** — fallback Grep/Read (хук не блокирует при мёртвом демоне). Context7 — для Radix Popover/Sheet, Prisma, nestjs-zod, SWR при сомнении в API.
- Перед каждым Edit: re-Read файла-якоря; после каждого суб-агента: `git status` + греп ключевых маркеров (агенты иногда отмечают `[x]` без реальных правок — факт-чек обязателен).

## Граф фаз
- **Ф0** (быстрая проводка) — независима, может идти первой/параллельно.
- **Ф1** (ProvenanceService + безопасность) — load-bearing, БЛОКИРУЕТ Ф2-Ф5.
- **Ф2** (API + наполнение снимка) → после Ф1.
- **Ф3** (frontend domain) → после Ф2 (нужен DTO).
- **Ф4** (компонент + рендер) → после Ф3.
- **Ф5** (attribution + уверенность + degradation) → после Ф4.

Многоволновая оркестрация без остановок между волнами: зелёная верификация фазы → коммит → следующая фаза в том же ответе; push — только с подтверждением владельца.

## Определение «фаза закрыта»
Все Acceptance-предикаты фазы выполнены машинно: `bun run typecheck && bun run lint && bun run build` зелёные (backend и/или frontend); `bunx vitest run <файлы фазы>` зелёные; грепаемые маркеры на месте; для Ф4/Ф5 — визуальная qa через skill `qa-tester` (прод korateam.ru) по чек-листу Acceptance. Каждая фаза закрывает свои `R*` (трассировка в ТЗ).

## Критические инварианты (факт-чек на каждом коммите)
1. **Деагрегация:** ни один путь `quote` наружу не идёт мимо `partitionProjectionsByAccess`; тест «агрегат виден, источник закрыт» зелёный. Эндпоинт берёт viewer из guard, не из тела.
2. **Единица времени (RC-6):** `buildDeepLink` получает мс; tables-путь (`fact.timeSec`) умножает на 1000; формат `?t=<sec>` сохранён.
3. **Денорм для списков:** карточки-списки рендерятся из `previewQuote`, без join вглубь; полный `resolve` — только on-demand по клику.
4. **Graceful-degradation:** `deepLink=null` → кнопки перехода НЕТ (не в пустоту); `primarySource='report'` → `attribution='inferred'`, не «дословная цитата».
5. **Крутилки:** порог уверенности — `AdminSetting` `getDynamic`, не ENV/хардкод. Никаких `process.env.*` мимо `env.schema.ts`, `prisma migrate`-прямой, `new PrismaClient()` в скриптах (`createPrismaClient()` из `_lib/prisma`).

## Failure-modes (на что смотреть)
- RC-5: задачи из встреч (`evidenceBlockIds:[]`, `meeting-report-fast.worker.ts:480`) — НЕ пытаться «подставить blockId», его нет; v1 = graceful (показать `sourceQuote`). Block-линк — vNext.
- Замена 3 дублей резолва: tables-формат `sourceLink` (`/meetings/:id?t=<sec>`) НЕ менять — только генератор.
- probe `.strict()`-схема (`event-payload.registry.ts`): новые поля payload отбросятся, пока не добавлены в схему.
- Миграция: `prisma:migrate -- --name ...` (файл + локальное применение), затем `prisma:generate`; на прод — авто через `migrate deploy`.

## После завершения (триггер «git push»)
Обновить second-brain по таблице производных заметок (data-model, module-map, api-layer, raw-event-to-graph), `04_не-сделано/README.md` (закрыть строки v1, оставить вторую волну), prod-deploy-log (Шаги 4/8/12), рефлексию в `05_история/`. Блок prod-инструкции в чат. Это ТЗ supersedes `plans/tz/2026-06-11-probe-question-context-leak-fix.md` — отметить его закрытым (Ф0.2 поглотила).
