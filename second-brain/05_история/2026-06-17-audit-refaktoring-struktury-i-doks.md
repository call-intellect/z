---
type: reflection
date: 2026-06-17
distilled: false
---

# Аудит и рефакторинг структуры проекта, документации и кодовой базы

## Что было поставлено

Полный аудит проекта и приведение к консистентному состоянию: устаревшая/дублирующая/противоречивая документация, неиспользуемые файлы/директории, легаси-код, **полное удаление комментариев из кодовой базы**, унификация систем знаний (`second-brain` vs `delivery`), реструктуризация доков по доменам, рефакторинг `CLAUDE.md`. Финал — отчёт по 7 разделам.

Развилки зафиксированы с владельцем (AskUserQuestion): режим — **гибрид** (низкорисковое сразу, высокорисковое после отдельного «да»); комментарии — **вся база, AST**; `delivery/` — **перенести живое и удалить**; dead-code — **консервативно**.

## Как решал

Сначала read-only аудит: **2 Workflow-прогона по 14 кластеров** (доменная нарезка second-brain/docs/plans/delivery/root+CLAUDE), каждый агент сверялся с кодом через vexp. Плюс `knip` (dead-code) и mechanical link-scan. Итог — 246 находок с вердиктами. Затем 6 фаз, коммит на фазу:

1. **Фаза 1** (`97603e6f`): удаление явных дублей (`roles-and-permissions.md` устар. host/guest, `00-navigation.txt` verbatim-дубль, `.agent-prompts/phase2-paywall`), репойнт RBAC-ссылок, `kora-landing.html` → marketing/landings.
2. **Фаза 2** (`41885ef7`): **ретайр `delivery/`** (42 файла) — аспирационный «пакет поставки» с фиктивным стеком (Python/FastAPI/LangGraph/Kafka/FalkorDB/Keycloak), противоречащим реальному (NestJS/Bun/pgvector/DeepSeek). 2 живых файла (`13-glossary.md`, `copy-strings.ru.md`) → `second-brain/13_glossary/`, 40 удалено, репойнт всех живых ссылок (фронтенд hint, conversational-channels, schema.prisma doc-comment, 25 файлов plans/sb).
3. **Фаза 3** (`fd8cad3e`): Workflow из 28 агентов — каждый code-verified факт-фикс (9→13 типов встреч; ollama/Claude/bge-m3 убраны → реальный DeepSeek+LlmRouter; `(authenticated)/admin`→`(admin)/admin`; in-process воркеры; triage 3→4; meet.crossmark.ru→korateam.ru…) + merge `orgs-and-rbac`→`rbac-access-control` и `concierge-voice`→`concierge-agent` + `ai-value-director` (0 кода) → `plans/analysis/`.
4. **Фаза 4** (`8f4fa753`): `CLAUDE.md` Вариант A (MCP-блок → указатель на `.claude/CLAUDE.md`) + факт-фиксы (in-process воркеры, ~100 модулей, prisma:migrate) + README.
5. **Фаза 5** (`c5bffaf2`): **вычистка всех комментариев** (~3746 файлов) AST-парсером + prettier; сохранены функциональные директивы. Backend нарративных комментариев: ~73k строк → 0.
6. **Фаза 6** (`d7a11ce4`): удаление 228 безусловно-мёртвых exports/types + чистка осиротевших импортов/каскадов + `eslint no-empty allowEmptyCatch`.

## Что вышло

Все верификационные гейты зелёные после Ф5 и Ф6: **backend** typecheck/lint(0 err)/build + unit **5188 pass** (1 fail — sandbox не резолвит DNS `::1`, не связано с правками); **frontend** typecheck/lint/build + unit **528 pass**. 6 коммитов локально, **не запушено** (ждёт подтверждения). delivery/ удалён, одна система знаний — second-brain.

## Чему научился

- **AST comment-strip: только парсер, не сырой scanner.** Первый подход через `ts.createScanner` (raw token loop) терял синхронизацию на template/regex-литералах → удалял `//` ВНУТРИ строк/шаблонов → 14 файлов с syntax-error. Правильно: `createSourceFile` + `getLeadingCommentRanges`/`getTrailingCommentRanges` по **`getChildren()`** (все токены, включая закрывающие `}` — иначе пропускаются комментарии в пустых блоках вроде `catch { /* */ }`). CSS-комментарии в backtick-строках парсер корректно НЕ трогает.
- **Вычистка комментариев из пустых `catch` ломает lint** (`no-empty`). Идиоматичный no-comment фикс — `allowEmptyCatch: true`, а не комментарий-заглушка. Делать `bun run lint` ПОСЛЕ каждого прохода стрипа (я закоммитил Ф5 после mop-up без re-lint → 94 no-empty всплыли только в Ф6).
- **knip шумит.** Dep-флаги — частые false-positive: `swagger-ui-express`/`multer` нужны NestJS внутренне (Swagger/FileInterceptor), `react-force-graph-2d` импортируется динамически. Надёжный сигнал «мёртвости» — имя встречается **ровно 1 раз во всём коде, включая тесты**. Первый прогон count-фильтра БЕЗ `backend/test`/`tests` ложно пометил test-only типы (`EvalColumn`, `GoldenMeetingPayload`) мёртвыми → typecheck поймал.
- **Прод tsc падал ложно** из-за устаревшего сгенерённого Prisma-клиента (`PersonaStatus "frozen"`): `bun run prisma:generate` чинит. Локальный артефакт, не код.
- **delivery/ был не дублем, а параллельной фикцией** — описывал стек, который никогда не строился, и противоречил реальности; опаснее простого дубля (вводил в заблуждение про архитектуру). Часть (`copy-strings`/`glossary`) при этом живая — нельзя сносить вслепую.
- **Аудиторы могут противоречить** (DESIGN.md vs design-system.md): при конфликте сигналов — не действовать вслепую, вынести в `04_не-сделано` на ручную сверку.

## Догон в той же сессии: #3 (plans-гигиена) + #4 (ре-индекс + update-доки)

По запросу владельца после основного пуша добил два пункта (остаёмся в `docsNstrucRefactor`, без PR):
- **#3** (`e8475ecb`): перенёс 39 code-verified реализованных ТЗ/exec-логов `plans/tz|architecture|root → plans/archive/` (plans/tz 158→131); общий репойнт 714 ссылок в 171 живом доке (чинит и перенос, и ранее-битые `plans/tz/X` → `plans/archive/X`). Битые ссылки в живых SoT-доках 202→71. Урок: **эвристика «shipped» по маркерам в шапке ненадёжна** (ловит «Не реализовано» из секции «что НЕ делаем», путает frontmatter `done` с реальным «ждёт владельца» как в me-role-map) — двигал только аудит-code-verified набор, не эвристику.
- **#4** (`ff9a2d81` + `c25a2228`): ре-индекс `index.md` (0 несвязанных 01_projects/02_architecture; удалены мёртвые секции `03_bugs/`/`04_archive/`; факт-фиксы описаний; footer-дата) + 9 «update»-доков (runbooks systemd→docker-compose с реальными очередями/эндпоинтами/health-схемой; economics→super_admin; dashboards-статусы; openapi-scope; livekit-final баннер). `adr/README` не тронут — проверено, `.github/workflows`/`.husky` действительно нет (док уже верен).
- **DESIGN.md-merge**: нарратив дизайн-системы слит в `02_architecture/design-system.md` (канон, +инженерные графты: AppShell, `frontend/src/ui/*`, motion `^12.39`, shadcn-инвентарь). **Урок: `DESIGN.md`+`PRODUCT.md` в корне — НЕ просто доки, а машинно-читаемый контекст скилла `impeccable`** (`load-context.mjs`/`design-parser.mjs` читают их из корня в Stitch-формате, скилл их регенерит). Удаление сломало бы скилл (и он бы их пересоздал) — как `.claude/CLAUDE.md` у vexp. Решение владельца — вариант A: корневые оставлены как tool-артефакты + кросслинки на канон; `design-system.md` = человеческий SoT. Sync-риск зафиксирован в `04_не-сделано`. **Граббля: проверять, не является ли «дубль-док» входом тулинга, ДО удаления.**

## Что осталось

См. `04_не-сделано` (строки 2026-06-17): **DESIGN.md-merge** (конфликт аудита — нужно решение владельца), **~1100 спорных knip-кандидатов** (внутреннее/ре-экспорт/динамика — поштучно), **остаток plans-гигиены** (возможные ещё shipped-ТЗ без code-verify + фрозен-ссылки), косметический re-stamp user-guide 01/06/08.

## Прод-команды

**Prod-операций нет.** Изменения — только документация + удаление комментариев + dead-code; ни миграций, ни seed/patch/backfill, ни новых ENV/очередей/эндпоинтов. `schema.prisma` затронут только в 2 `///` doc-комментариях (без изменения моделей/enum). Деплой — обычным `docker compose up -d --build`.
