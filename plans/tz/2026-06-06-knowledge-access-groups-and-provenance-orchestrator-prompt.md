# Orchestrator-prompt: Доступ к знаниям через группы + провенанс

Запуск скилла `tz-orchestrator` по ТЗ [`plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md`](2026-06-06-knowledge-access-groups-and-provenance.md). Этот промпт — стартовая навигация; **тело контракта не дублируется, всё в ТЗ** (риск рассинхрона).

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (стек, Prisma-миграции, крутилки в AdminSetting, vexp/Context7).
2. `second-brain/index.md` → `01_projects/rbac-access-control.md`, `02_architecture/{security-and-152fz,knowledge-core,company-memory-overview}.md`.
3. Анализ-вход (доказательная база, не переисследовать): `plans/analysis/2026-06-06-knowledge-access-levels-and-provenance.md` (особенно §14 решения, §7 матрица, §8 ADR, §10 развилки, §11 риски).
4. ТЗ целиком: REALITY-CHECK, «Принятые решения владельца» (В1–В9 — НЕ пересматривать), «Контракт-first» (Prisma-снимки, правило `visible()`, SQL-предикат, флаги), фазы Ф1–Ф8 + граф зависимостей.

## Инструменты
- Картография кода — vexp `run_pipeline` если демон жив; иначе (как в этой сессии) Grep/Read. Перед правкой каждого якоря `path:line` из ТЗ — **перечитать**, номера строк дрейфуют (в ТЗ даны якоря-символы).
- Внешние либы (pgvector iterative_scan, Prisma migrate, nestjs-zod) — Context7 перед использованием незнакомого API.

## Граф фаз (строго)
`Ф1 ∥ Ф2 → Ф3 → Ф4 → Ф5 ∥ Ф6 → Ф7 → Ф8`. Одна волна = одна фаза (Ф1 и Ф2 можно параллелить как две независимые волны; Ф5/Ф6 — после Ф4).
Каждая фаза самодостаточна: своя мини-картография, «Что НЕ входит», точные файлы, Acceptance, `Закрывает: Rn`.

## Критичные инварианты этого ТЗ (факт-чек на приёмке — «не верь отчёту суб-агента»)
- **enforcement=off ⇒ поведение байт-в-байт текущее.** После КАЖДОЙ фазы прогнать golden-тест: при `KNOWLEDGE_ACCESS_ENFORCEMENT=off` выдача retrieval/клонов идентична baseline. Если изменилась — фаза не принята.
- **Покрытие гейта (Ф4).** Грепнуть ВСЕ `findMany`/raw-SQL в `knowledge-core` с `status: 'canonical'` — каждый интерактивный путь выдачи должен звать `buildAccessWhere`; обязательный шлюз `loadContextBlocks` (chat-v2.service.ts:423) — присутствует. Машинные пути (BlockFetchService) — НЕ группы (только dataClass) — проверить, что туда фильтр НЕ добавлен ошибочно.
- **dataClass не переопределён по смыслу** (В4): греп — новый доступ не пишет/не читает `IdeaBlock.dataClass` как уровень доступа пользователя.
- **Идемпотентность** seed/backfill: повторный прогон = no-op (запустить дважды в тесте).
- **e2e-предикат «логист ≠ совет»** (метрика «решено»): тест — член dept «Логистика» при enforce не получает блок `IdeaBlockAccess{closed=Совет}` ни в chat/search/snapshot/graph/clone; owner получает.
- **Prisma:** версионируемые миграции (`prisma:migrate -- --name ...`), `prisma:generate` после; скрипты — `createPrismaClient()`, импорт из `../src`; крутилки (`defaultClosedGroupKind`, пороги) — AdminSetting, не ENV/хардкод.
- **Параллельная ветка:** перед коммитом Ф1 (правка chatbox-адаптера) — `git fetch` + проверить chatBox-сессию (Tozix/Nikita), согласовать.

## Определение «фаза закрыта»
Все `Закрывает: Rn` фазы выполнены; Acceptance-предикаты зелёные грепом/тестом/командой без человека; `typecheck(+.spec)/lint/build` зелёные; «Что НЕ входит» не нарушено; при off — baseline. Коммит по фазе (`feat(knowledge-access): Фаза N — ...`), push — по подтверждению владельца.

## Failure-modes (на что смотреть)
- Recall-просадка `/search` поверх HNSW при жёстком WHERE → iterative_scan/overfetch (анализ §4.3); не «починить» переходом на post-filter в коде (ломает LIMIT).
- Кэш RetrievalCache отдаёт чужой доступ → ключ с отпечатком групп ИЛИ отказ от кэша при enforce + фильтр в loadContextBlocks.
- Over-restriction: closed только из явного флага/interview; дефолт открыто; пустой набор групп блока = виден всем.
- Расширение subject-атрибуции «уронило» persist основного блока → attributeSubject best-effort, ошибка не валит ingest (как сейчас).

## Развилки — НЕ открывать заново
Все HIGH закрыты владельцем (ТЗ «Принятые решения» В1–В9 + 4 развилки 2026-06-06). Если всплывает новая HIGH-развилка по ходу — остановиться и спросить владельца батчем, не угадывать.
