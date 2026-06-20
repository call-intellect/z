# Orchestrator-prompt — Доводка провенанса и probe (остатки v1 + вторая волна)

Запусти реализацию ТЗ как главный оркестратор-разработчик (скилл `tz-orchestrator`), фаза за фазой силами суб-агентов, с независимой приёмкой. **Не доверяй отчётам агентов — верифицируй грепом / re-Read / своим typecheck-lint-build-тестами.**

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (инварианты: русский, Ship-On, без комментариев в коде, крутилки в AdminSetting, vexp `run_pipeline` первым если демон жив).
2. **ТЗ:** `plans/tz/2026-06-20-provenance-probe-followups.md` — контракт. Решения владельца Р-1…Р-4 — в разделе «Решения владельца»: для Блока A не нужны; для Блока B спроси владельца ДО старта B4/B5 (и retention B3), если он сам не задал.
3. **Контекст «откуда»:** v1 уже реализован — `plans/tz/2026-06-20-provenance-source-traceability-tz.md` (раздел «Итог» + REALITY-CHECK), `plans/tz/2026-06-20-probe-smart-questions-module.md`, рефлексия `second-brain/05_история/2026-06-20-provenance-and-probe-smart-questions.md`. Код сервиса — `backend/src/modules/knowledge-core/services/provenance.service.ts` (прочитать ПОЛНОСТЬЮ: `classify`/`buildDeepLink`/`resolveByRawEventIds`/`resolve`/`computePreviewSnapshot`).
4. REALITY-CHECK ТЗ (RC-1…RC-10) — перечитать каждый якорь по символу перед правкой (номера строк дрейфуют).

## Граф фаз и порядок
- **Блок A — без решений владельца, делать первым:**
  - **A1** (preview в списках) — самый ценный долг (иначе backfill-колонки лежат мёртвым грузом). Decision/Regulation/Issue: backend select+DTO+маппер → фронт api+domain+маппер+карточка. Внимание: безопасность — списки уже под access-gating, preview показываем только в гейтнутом списке.
  - **A2** (chat-v2 → ProvenanceService) — отдельным кодером; риск 8 spec'ов, поведение чата НЕ менять.
  - **A3** (specialist-3-4 objectName) — 30 минут.
  - **A4** (email `text`→`fullText`) — баг, добавить unit на segment-builder.
  - A1/A3/A4 независимы (можно параллельно разными кодерами), A2 — отдельно. Коммитить пофазно.
- **Блок B — по приоритету/решениям владельца:** B1 (chatbox deep-link, миграция поля в evidence), B2 (block-линк fast-задач, Р-4(б) матчинг), B3 (аудио S3, Р-2 retention), B4 (документ-якорь, Р-1(б) минимум / (а) большой vNext), B5 (phone_call адаптер, Р-3). Каждая — аддитивно поверх v1-инфры.

Многоволновая оркестрация без остановок: зелёная приёмка фазы → коммит → следующая фаза в том же ответе; push — только с подтверждением владельца.

## Определение «фаза закрыта»
Acceptance фазы машинно подтверждён ТОБОЙ: `bun run typecheck && lint && build` зелёные (backend и/или frontend); `bunx vitest run <затронутое>` зелёные; грепаемые маркеры на месте; для UI-фаз — визуальная qa (skill `qa-tester`, прод korateam.ru). Каждая фаза закрывает свою строку в `second-brain/04_не-сделано/README.md`.

## Критические инварианты (факт-чек на каждом коммите)
1. **Безопасность провенанса:** любой новый путь quote/аудио/файла наружу проходит фильтр прав зрителя (`partitionProjectionsByAccess` / доступ к блоку-владельцу); закрытый блок → маскировка (как `ProvenanceService.resolve`). Особенно A1 (preview в списках — только под access-gating), B3 (presigned аудио — проверка доступа к блоку).
2. **Крутилки в AdminSetting** (`getDynamic`, не ENV/хардкод) + строка в `feature-flags.md` + seed (B3 retention). Никаких `process.env.*` мимо `env.schema.ts`.
3. **Prisma:** `prisma:migrate -- --name ...` (аддитивно), `createPrismaClient()` в скриптах, импорты из `../src`.
4. **Без комментариев в коде; русский UI; парные цветовые токены (`bg-{c}`+`text-{c}-fg`).**
5. **chat-v2 (A2):** поведение ответа чата НЕ менять; 8 spec'ов зелёные без смены ожиданий.

## Failure-modes / на что смотреть
- A1: список без access-gating + previewQuote = утечка цитаты. Проверь, что decisions/issues-списки гейтятся (regulations — да, `gateProjections`); если нет — догейтить или не отдавать preview.
- A2: `ContextBlock.primaryMeetingEvidence` нужен bare title — добавь `title?` в `ProvenanceSourceRef` (рекомендация ТЗ) либо оставь chat-v2 свой title-lookup.
- A4: не ломай других потребителей `payload.text` — добавляй `fullText`, не переименовывай.
- B1/B4(а): новые поля в `IdeaBlockEvidence`/`Document` — аддитивная миграция, backfill старых evidence опц.
- B2: матчинг задача↔блок идемпотентен; нет матча → graceful (sourceQuote без прыжка), не падать.
- B4: НЕ тащить page-aware (а) если владелец выбрал (б); `pdf-parse` заброшен (память) — для (а) `unpdf`, сверить через Context7.

## После завершения (триггер «git push»)
Обнови second-brain (data-model/module-map/api-layer/raw-event-to-graph по затронутому), `04_не-сделано` (закрыть строки), `prod-deploy-log` (миграции B1/B4, seed B3/B5, smoke), рефлексию в `05_история`. Блок prod-инструкции в чат. Push — по явному подтверждению владельца.
