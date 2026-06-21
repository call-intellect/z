---
type: tz
status: ready-to-implement
feature: three-tz-tails-finalization
date: 2026-06-21
owner: Сергей (владелец)
relates_to:
  - plans/tz/2026-06-20-assistant-fab-notifications-and-clone-picker.md
  - plans/tz/2026-06-20-provenance-probe-followups.md
  - plans/tz/2026-06-20-config-knobs-to-admin-settings.md
  - second-brain/05_история/2026-06-21-three-tz-fab-provenance-config.md
---

# ТЗ — Доводка хвостов трёх ТЗ (FAB / провенанс / крутилки)

> **Зачем.** Три ТЗ (`assistant-fab`, `provenance-probe-followups`, `config-knobs-to-admin-settings`) РЕАЛИЗОВАНЫ и в `dev` (сессия 2026-06-21, коммиты `092f7851`..`40d0a6ff`). Остались хвосты — частью мелкая доводка, частью объёмные «по востребованию» куски. Этот файл собирает ВСЁ доделываемое в один контракт-first план для другого агента (скилл `tz-orchestrator`).
>
> **REALITY-CHECK ниже — из первых рук** (написан тем же агентом, что реализовал основную часть; номера строк актуальны на 2026-06-21, но всё равно перечитывай перед правкой — параллельные сессии двигают код).

## Карта фаз (по убыванию готовности; независимы — можно брать в любом порядке)

| Фаза | Что | Тип | Оценка | Зависимости |
|---|---|---|---|---|
| **Ф1** | B1 фронт-якорь `?m=` — скролл+подсветка сообщения чата | долг (фронт) | ~2-4 ч | нет (backend готов) |
| **Ф2** | UI-страницы AdminSetting для ~100 перенесённых крутилок | долг (фронт) | ~1-2 дня | нет (реестр+сиды готовы) |
| **Ф3** | TZ1 Шаги 9-10 — остаток ~240 ENV-крутилок + 60-90 хардкодов → `getDynamic` | перенос (backend) | ~3-5 дней (доменными волнами) | гейт держит инвариант |
| **Ф4** | B4(а) — page-aware документ-якорь (прыжок к странице) | фича (back+front) | ~1-2 дня | смена библиотеки парсера |

Каждая фаза самостоятельна и коммитится отдельно. Порядок рекомендуемый Ф1→Ф2→Ф3→Ф4 (от мелкого к крупному), но не обязателен.

---

## REALITY-CHECK (факты по коду 2026-06-21)

| # | Файл · якорь | Факт |
|---|---|---|
| RC-1 | `backend/.../provenance.service.ts` `buildProvenanceDeepLink` | для `chatbox`/`chat` строит `/chats/<chatId>?m=<messageExternalId>` (резолв `sessionId→chatId` через `ChatboxChatSession.chatId`); `IdeaBlockEvidence.sourceMessageExternalId` заполняется (B1 backend готов). |
| RC-2 | `frontend/app/(authenticated)/chats/[id]/ChatDetailClient.tsx` | страница переписки рендерит сообщения, НО у бабблов нет DOM-id, `?m=` не читается, скролла к сообщению нет. `ChatboxMessageView` (API DTO сообщения) — проверить, отдаётся ли `externalId` на фронт (если нет — добавить в маппер). |
| RC-3 | `backend/.../admin-setting-schema-registry.ts` | ~150+25+53+24 admin-ключей в реестре (concierge/orchestrator/router/воркеры/retention/logging/limits/share/aiChatQuota/smartTables/probe/curation/модели/часы) — все читаются через `resolveSync`/`getDynamic`, отдаются `set()`-валидацией. UI-страниц для большинства нет. |
| RC-4 | `frontend/app/(admin)/admin/ai/embeddings/EmbeddingsSettingsClient.tsx` | ОБРАЗЕЦ: `SettingSpec<T> {key,label,description?,schema:ZodTypeAny,defaultValue}` → `SettingsGrid` → `AdminSettingField` (`frontend/src/ui/components/admin/AdminSettingField.tsx`) + `useAdminSettingEditor` (`frontend/src/hooks/useAdminSettingEditor.ts`, reason-gate на high/destructive). Фронт ДУБЛИРУЕТ Zod вручную. |
| RC-5 | `backend/.../config/env-classification.ts` | `KEEP_ENV_KEYS`(110)/`ADMIN_FALLBACK_ENV_KEYS`(251) покрывают все 361 top-level ключ `EnvSchema`; гард `env-classification.guard.spec.ts` падает на любом новом неклассифицированном ключе. Большинство `ADMIN_FALLBACK` ключей ещё НЕ в реестре admin (читаются `this.get`, не `resolveSync`). |
| RC-6 | `backend/.../config/typed-config.service.ts` | геттеры доменов (knowledge-core/skill/persona/betaOps-остаток/tracker/budget/recording/conversational/dialog-layer/insights/ideas) частью на `resolveSync`, частью `get-only`. §9 ТЗ config-knobs перечисляет домены остатка. |
| RC-7 | `backend/.../document-parser.service.ts` (PDF через `pdf-parse`), `document.adapter.ts` (`sourceExternalId='doc:'+id`) | PDF уплощается в один blob; `pageCount` в metadata, позиции внутри — нет. `Document` (`schema.prisma`) без page/anchor-полей. B4(б) уже даёт `/documents/<id>?q=<цитата>` + подсветку текста (реализовано). B4(а) — это прыжок к СТРАНИЦЕ. Память: `pdf-parse` заброшен, рекомендация `unpdf` (page-aware) / `officeParser` (DOCX). |
| RC-8 | `backend/.../config/no-direct-process-env.guard.spec.ts` | запрещает прямой `process.env` вне whitelist (env.schema/config.module/main + 3 bootstrap). Любая новая ENV-крутилка обязана идти через схему+классификацию+resolveSync. |

---

## Сквозные правила (для всех фаз)
- **Ship-On:** дефолты = текущее поведение; ничего не выключать. Новые крутилки → `AdminSetting` (`getDynamic`/`resolveSync`) + реестр + сид + строка в `docs/operations/feature-flags.md` если флаг.
- **Крутилки в AdminSetting, не в ENV/код** (CLAUDE.md принцип 9); прямой `process.env.*` запрещён (гард RC-8); хардкод-константа того же рода = нарушение.
- **Без комментариев в коде; UI русский; парные токены `bg-{c}`+`text-{c}-fg`.**
- **Prisma:** изменения БД (Ф4) — файл-миграция `prisma:migrate -- --name`, аддитивно; скрипты — `createPrismaClient()` из `_lib/prisma`, импорты из `../src`.
- **Безопасность провенанса** (Ф1/Ф4): новый путь quote/файла наружу — через фильтр прав зрителя.
- **Тесты:** каждая фаза — поведенческий тест + негатив + (где применимо) идемпотентность. Гарды `env-classification` + `no-direct-process-env` остаются зелёными.

---

## Ф1 — B1 фронт-якорь `?m=` (скролл+подсветка сообщения чата)

**Цель.** Клик «к первоисточнику» из переписки открывает чат и прокручивает/подсвечивает конкретное сообщение (backend deep-link `/chats/<chatId>?m=<msg>` уже готов).

**Файлы (verified):**
- `frontend/app/(authenticated)/chats/[id]/ChatDetailClient.tsx` — рендер сообщений.
- API DTO сообщения (`ChatboxMessageView`/аналог в `frontend/src/api/*chat*` или domain) — проверить наличие `externalId`.
- backend-маппер сообщения переписки (если `externalId` не отдаётся — добавить в select+DTO; это МИНИМАЛЬНАЯ backend-правка, допустима в рамках Ф1).

**Что входит:**
1. Если `externalId` сообщения не доходит до фронта — прокинуть его (backend select+DTO+маппер; фронт DTO+domain).
2. В `ChatDetailClient`: каждому бабблу `id={`msg-${externalId}`}` (или data-атрибут).
3. Читать `m` из `useSearchParams`; после рендера найти `#msg-<m>` → `scrollIntoView({block:'center'})` + временная подсветка (`bg-accent/15`, 1-2 c, затем снять) или `<mark>`-обводка. Нет сообщения/нет `m` → graceful (открыт чат сверху/снизу как сейчас).

**Acceptance:**
- `bun run typecheck`/`lint`/`build` (frontend, при backend-правке — и backend) зелёные.
- Грер чтения `searchParams` `m` + `id={...externalId...}` в `ChatDetailClient`.
- Рендер-тест (если testing-library): при `?m=<id>` элемент с этим id получает подсветку.
- qa: переход из дровера «Откуда это» по chatbox-источнику открывает чат на нужном сообщении.

---

## Ф2 — UI-страницы AdminSetting для перенесённых крутилок

**Цель.** ~100 крутилок, ставших редактируемыми в TZ1 (реестр+сид), получают сгруппированные UI-страницы по образцу `EmbeddingsSettingsClient` — суперадмин крутит их из админки с reason-gate, а не через сырой API.

**Файлы (verified, образец RC-4):** `EmbeddingsSettingsClient.tsx` (паттерн `SettingSpec[]`→`SettingsGrid`→`AdminSettingField`+`useAdminSettingEditor`).

**Что входит (доменными вкладками/страницами под `/admin/...` или `/company-admin/...`):**
1. **Помощник (Concierge):** `concierge.*` (12 ключей — флаги/лимиты/PRM).
2. **Оркестратор/Маршрутизатор:** `orchestrator.*` (3), `router.*` (3).
3. **Воркеры-рубильники:** `knowledge.axisClassifyEnabled`, `roleProfiles.minBlocks`, `curation.consistencyChecker*`, `curation.completenessScannerEnabled`, `tracker.goalAlignmentLowEnabled`, `conversational.telegramDigestHourLocal`.
4. **Хранение/Логи:** `retention.*` (10), `logging.*` (11, REQUEST/RESPONSE_BODY — пометить «ПДн»).
5. **Лимиты/Квоты:** `limits.*` (24), `share.*` (3), `aiChatQuota.*` (3), `smartTables.*` (6).
6. **Probe/Curation:** `probe.*` (10/11), `knowledge.curation{ItemExpiryDays,StaleMonthsThreshold,StaleDynamicScoreThreshold}`.
7. **Модели LLM / Рубильники / Часы дайджестов (GRAY):** `ai.{anthropic,vox,deepseek}.model`, `gepa.{reflectionLm,taskLm}`, `ai.mainReport.primary`, `mail.dryRun`, `operations.daily_digest.deliver_to_webpush`, `betaOps.*LocalHour`/`dailyDigestHourUtc`/`weeklyDigest*`/`commitmentFollowupLocalHour`.

**Контракт `SettingSpec`** (каждый ключ): `key` (= admin.key из реестра), `label` (русский), `description` (что крутит + дефолт), `schema` (Zod — ПРОДУБЛИРОВАТЬ ограничения реестра один-в-один), `defaultValue`. Группы — `SettingsGrid` с заголовками; reason-gate приходит из `useAdminSettingEditor` (high/destructive требуют причину — синхронно с серверной валидацией `set()`).

**Граница:** не плодить новую навигацию без нужды — свести под существующие admin-разделы (`/admin/ai/*`, `/company-admin/*`, `/admin/settings/*`); модели LLM — под существующую поверхность управления моделями.

**Acceptance:**
- typecheck/lint/build зелёные.
- Для каждой группы — страница рендерит поля; правка валидного значения сохраняется (qa или рендер-тест с моком `useAdminSettingEditor`); невалидное → серверная ошибка показана; high/destructive без причины → reason-gate.
- Грер `SettingSpec` с новыми admin-ключами в созданных клиентах.
- `second-brain/01_projects/admin.md` — список новых страниц.

---

## Ф3 — TZ1 Шаги 9-10: остаток ~240 ENV-крутилок + 60-90 хардкодов → `getDynamic`

**Цель.** Довести инвариант «крутилка → AdminSetting» до конца: оставшиеся редкие ENV-крутилки и магические константы становятся редактируемыми (или хотя бы `getDynamic` с code-fallback). Гейт (TZ1 Шаги 2-4) уже не пускает НОВЫЕ — здесь добиваем существующий долг.

**Рунбук на крутилку (как в TZ1):** (1) запись в реестре `['<admin.key>', <Zod>]`; (2) геттер `typed-config`/сервис: `this.get('X')`→`resolveSync`/`getDynamic('<admin.key>','X',def)`; (3) сид `seed-admin-setting-*.ts` + STEPS в `apply-prod-deploy.ts`; (4) (по желанию) UI-поле в Ф2-странице; (5) док-триггеры.

**Доменные волны (по убыванию пользы; каждая = отдельный коммит/сид/страница):**
- **W1 KnowledgeCore (~41):** `DISTILL_*`, `ENTITY_*`, `THEME_*`, `BLOCK_INGEST_*`, `CHAT_V2_*`, `BITEMPORAL_*`, `FACT_SUPERSEDE_*` (часть уже resolveSync — только реестр+сид).
- **W2 Skill/clone/persona (~34):** `SKILL_*`, `CLONE_*`, `PERSONA_REBUILD_*`, `EXECUTABLE_PERSONA_*`, `DOMAIN_EXPANDER_*`, `BRAND_VOICE_*` (перепроверить ложноположительные `not-read`).
- **W3 BetaOps остаток (~20):** `PROACTIVE_RULE_*`, `INVITE_*`, `MAGIC_LINK_*`, `COMMITMENT_*` (кроме часов из TZ1 Шага 8).
- **W4 Tracker/governance (~31):** `AUTORULE_*`, `PRACTICE_SKILLS_*`, `GEPA_*` (кроме моделей), `TEMPORAL_PROBE_*`, `SIGNAL_TYPE_*`.
- **W5 DialogLayer/Insights/Ideas/Budget/Recording/Conversational/MaxBot остаток.**
- **W6 Хардкод-крутилки (60-90+, TZ1 Шаг 10):** пороги knowledge-core (`similarity>=0.78`/`cosine>=0.92` в SQL `entity-resolution.service.ts`; `dynamicScore>0.1`), dashboard-пороги настроения/выгорания/окна, ai (`MONOLOGUE_THRESHOLD_MS`/`TURN_GAP_MS`/scrub-дни), billing/tracker — по эталону `probe.service.ts` (`getDynamic(key, undefined, codeFallback)`).
- `*_CRON` периодичности и concurrency — ОСТАВИТЬ в ENV (Р1/Р6), внести в `ADMIN_FALLBACK_ENV_KEYS`/`KEEP_ENV_KEYS`.

**Acceptance (на волну):**
- typecheck/lint/build зелёные; гарды `env-classification` + `no-direct-process-env` зелёные.
- ключи волны: реестр + сид (+ STEPS); геттер через resolveSync/getDynamic; дефолт = текущее значение (поведение не меняется).
- к концу Ф3: в `env.schema.ts` остаются только `KEEP_ENV_KEYS` + cron/concurrency-fallback'и; магия из hot-path/SQL вынесена в `getDynamic`.

---

## Ф4 — B4(а): page-aware документ-якорь (прыжок к странице)

**Цель.** Клик по doc-источнику ведёт не просто к подсветке цитаты (B4б уже есть), а к КОНКРЕТНОЙ СТРАНИЦЕ документа. Требует page-aware парсинга.

**Решение (рекомендация, доказано в анализе manual-document-upload):**
1. Заменить `pdf-parse` → **`unpdf`** (page-aware; `pdf-parse` заброшен) для PDF; DOCX — `officeParser`/`mammoth` с разбивкой по разделам. **СВЕРИТЬ актуальный API через Context7 + web перед интеграцией.**
2. Миграция: новые поля в evidence/Document под page+offset (`pageNumber Int?`, `pageOffset Int?` или `sourcePage Int?` в `IdeaBlockEvidence`) — аддитивно.
3. При парсинге хранить map позиция→страница; в evidence писать `pageNumber` цитаты.
4. `provenance.service.ts` buildDeepLink для документа: `?page=N` (в дополнение к `?q=`).
5. Фронт-страница документа: при `?page=N` — прыжок к странице (если есть постраничный вьюер; иначе превью страницы в S3 / якорь по offset).

**Решение владельца ПЕРЕД стартом Ф4:** подтвердить смену библиотеки парсера (`unpdf`) — это влияет на качество ВСЕХ загруженных документов, не только провенанс. Если владелец не готов менять парсер сейчас — Ф4 откладывается, B4(б) (подсветка) остаётся как есть.

**Acceptance:**
- typecheck/lint/build зелёные; миграция аддитивна; парсер-свап покрыт характеризующим тестом (старые документы парсятся не хуже).
- клик по doc-источнику с известной страницей открывает документ на странице; нет page — graceful на `?q=` подсветку.
- second-brain `data-model`/`raw-event-to-graph` обновлены; `prod-deploy-log` (миграция + смена зависимости).

---

## Prod-deploy (по факту реализации)
- **Ф1:** без миграций (опц. backend-правка маппера сообщения — пересборка).
- **Ф2:** без backend — пересборка фронта.
- **Ф3:** новые сиды `seed-admin-setting-*` по волнам → `apply-prod-deploy.ts` STEPS + `prod-deploy-log.md` Шаг 7; новые ENV-fallback → Шаг 1.
- **Ф4:** миграция page-полей (Шаг 4) + смена зависимости (`package.json`) + возможный backfill парсинга старых документов (Шаг 8).

## DoD (на каждую фазу)
- `typecheck`(вкл. `.spec`)/`lint`/`build` зелёные (back и/или front), vitest по затронутому; гарды конфигурации зелёные.
- `second-brain/` обновлён по таблице производных заметок; `04_не-сделано/README.md` — строка закрыта; `prod-deploy-log.md`; рефлексия.
- Ревью `strict-production-review-gate` (особенно Ф1/Ф4 — безопасность провенанса; Ф3 — нет регрессий поведения).

## Итог (сессия 2026-06-21, ветка `feature/three-tz-tails-finalization`)

**Реализовано и verified-green (typecheck/lint/build/тесты + кросс-сверки):**
- **Ф1 [x]** — B1 фронт-якорь `?m=` (коммит `237b48b5`): `externalId` сообщения проброшен DTO→API→domain, баббл `id=msg-<externalId>`, скролл+подсветка по `?m=` с авто-догрузкой старых страниц, graceful.
- **Ф2 [x]** — UI-страницы AdminSetting (коммиты `40ef424d` scaffold + `19c091f5` страницы): общий `DomainSettings`-scaffold (reason-gate, которого не было в эталоне) + **7 разделов / 126 крутилок** (Помощник·Оркестратор+маршрутизатор·Рубильники воркеров·Хранение+логи·Квоты пользователей·Probe+курация·Модели+часы) + 7 пунктов навигации; reason-gate проставлен 9 high-ключам по сидовой severity; **0 ключей-сирот** (машинная сверка с реестром).
- **Ф4 [x]** — page-aware документ-якорь (коммиты `af7d4cb6` парсер+миграция, `8010c92d` якорь). **Развилка решена:** парсер `pdf-parse`→**`unpdf`** (постраничный текст, активная поддержка, serverless-сборка pdf.js, без native-зависимостей — доказано матрицей + Context7). Аддитивная миграция `Document.pageCount/pageOffsets`; провенанс-deeplink `?page=N` (страница цитаты из `pageOffsets`, tenant-scoped, без N+1, graceful); фронт — разделители «Страница N» + скролл `?page=N` (приоритет у `?q=`). Открытие: документ рендерится плоским текстом (PDF-вьюера нет) → «страница» = текстовый якорь, не визуальный скролл по PDF.

**НЕ реализовано (обоснованно отложено):**
- **Ф3 [ ]** — TZ1 Шаги 9-10 (остаток ~240 ENV-крутилок + хардкоды). **Заблокировано двумя системными рассинхронами** (см. `plans/analysis/2026-06-21-tz1-step9-10-config-knobs-blocker.md`): (1) сид-дефолты ≠ env.schema-дефолты (distill 0.85 vs 0.92) → наивная конверсия `this.get→resolveSync` даёт **тихую регрессию hot-path** (нарушение Ship-On); (2) существующая knowledge-core admin-страница правит «мёртвые» dotted-ключи (код/реестр/сид — camelCase). Требует пер-ключевой сверки + решения владельца по каноническим дефолтам (15b), а не механического sweep. Объём 3-5 дней подтверждён.
