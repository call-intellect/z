---
title: Реализация CRUD провайдеров эмбеддингов (ТЗ embedding-providers-crud, 6 фаз)
date: 2026-07-02
tags: [embeddings, admin, prisma, crud, crypto, tz-orchestrator, age-trap]
distilled: false
---

## Что было поставлено

Владелец: в админке нет управления провайдерами эмбеддингов (endpoint/ключи/модели/цены) — только 2 захардкоженных ENV-провайдера. Реализовать полноценный CRUD, как у LLM-провайдеров. Прошли цепочку tz-author (ТЗ [`plans/tz/2026-07-02-embedding-providers-crud.md`], 4 HIGH-развилки закрыты владельцем) → tz-orchestrator (эта реализация).

## Как решал (6 фаз, фаза за фазой, суб-агенты + независимая приёмка)

- **Ф1** (`cefd31ff`): модели `EmbeddingProvider`/`EmbeddingModel` + миграция `20260702155742_embedding_providers`.
- **Ф2** (после Ф1): `EmbeddingProviderResolverService.resolveChain()` (читает активных по priority, дешифрует ключ) + `EmbeddingFallbackService.buildChain()` → async (DB-цепочка через новый `openai-compatible-embed.util.ts` или code-fallback на `cfg.ai.embeddings`). Контракт `embed()` не тронут. Тесты 11/11.
- **Ф3** (`fcb…`→): admin CRUD `AdminEmbeddingProvidersController/Service`, 10 маршрутов `/api/v1/admin/embedding-providers` под SuperAdminGuard, smoke, гард `embedding_dimension_mismatch_requires_reindex`. Ключ шифруется **явно** CryptoService.encrypt. Тесты 6/6.
- **Ф4**: фронт-вкладка «Провайдеры» на `/admin/ai/embeddings` (там, где владелец и искал) — CRUD провайдеров/моделей, smoke, баннер needsReindex. Слои api/domain/ui. Ключ вводится type=password, с бэка не приходит (только hasApiKey).
- **Ф5** (`05ea9765`): idempotent seed переноса 2 провайдеров (local active/768, openai-via-proxy inactive/1536), составной ключ `prefix:key` для прокси, регистрация в apply-prod-deploy STEPS.
- **Ф6**: верификация (boot с новым модулем — 0 DI-сбоев, 40/40 тестов) + доки (data-model/module-map/api-layer/admin/prod-deploy-log) + рефлексия.

## Что вышло

Каждая фаза: независимая приёмка (typecheck/build/тесты + re-Read/grep), коммит по фазам. Итог: backend поднимается с новым модулем, `AdminEmbeddingProvidersController` зарегистрирован, 40 тестов зелёные, seed-данные в БД (2 провайдера), фронт-вкладка на месте. Прод-риск нулевой (миграция аддитивная, новых ENV нет, code-fallback при пустой БД).

## Чему научился

- **AGE search_path trap в миграциях (повтор [[project-age-search-path-ddl-trap]]).** Ф1-миграция, применённая на dev-БД через голый `prisma migrate deploy` (без `search_path=public`), создала таблицы в `ag_catalog`, а не `public` (у dev-БД default search_path = `ag_catalog,"$user",public`). Моя Ф1-проверка `information_schema.tables WHERE table_name IN (...)` НЕ фильтровала схему → дала ложный «ок»; вскрылось только в Ф5 (Prisma бьёт в `public.*` → P2021). Фикс: `ALTER TABLE ag_catalog.X SET SCHEMA public`. **Урок: проверять `table_schema`, а не только `table_name`; на dev применять миграции с `search_path=public`.** Прод безопасен — `apply-prod-deploy` применяет через `withPublicSearchPath`.
- **`migrate dev` и `--from-migrations` не работают на dev-БД** (shadow-БД без AGE → P3006). Канон здесь — `prisma migrate diff --from-schema <git HEAD:schema.prisma> --to-schema <schema.prisma> --script` + `migrate deploy`. Флаг `--to-schema-datamodel` в Prisma 7 переименован в `--to-schema`.
- **LlmProvider хранит `apiKeyEncrypted` в ОТКРЫТОМ виде** (misnomer): `provider-info.resolver` читает без decrypt, prisma-middleware шифрования нет. Для эмбеддингов НЕ зеркалил это — шифрую явно CryptoService.encrypt (резолвер дешифрует тем же CRYPTO_MASTER_KEY). Это делает embedding-провайдеров безопаснее LLM-эталона.
- **Составной ключ для прокси-провайдера.** OpenAiProxyEmbeddingService шлёт `Bearer {prefix}:{key}`; чтобы унифицировать под один OpenAI-совместимый helper, seed зашивает `${PROXY_PREFIX}:${OPENAI_PROXY_API_KEY}` как единый apiKey — helper отправляет `Bearer <это>` без спец-логики.
- **CryptoService в скриптах** — `new CryptoService(makeCfgStub() as never)` с `{crypto:{masterKey: process.env.CRYPTO_MASTER_KEY}}` (эталон `patch-encrypt-tochka-oauth.ts`), без Nest DI.
