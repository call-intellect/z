---
date: 2026-07-09
title: "Дефолт провайдера не заполнял роутинги + bulk-диалог на legacy-enum — два дизайн-разрыва LLM-роутинга"
tags: [llm-routing, admin, defaultChain, bulk, ux, design-gap]
---

# Дефолт провайдера не заполнял роутинги + bulk на хардкод-провайдерах

## Что было поставлено

Владелец: две проблемы в админке массового назначения LLM-моделей (`/admin/ai/routing`):

1. **«Назначил модель по умолчанию, а роутинги не заполнились».** В момент назначения ни провайдеры, ни модели в роутингах не были заданы. После назначения дефолта ожидалось, что пустые строки заполнятся.
2. **«При массовом назначении в селекте несуществующие провайдеры».** Нужно список провайдеров подгружать с поиском прямо в селект-поле, и подгружать модели выбранного провайдера с поиском.

## Как диагностировал (systematic-debugging)

Применял скилл `superpowers:systematic-debugging` — без root cause не предлагал фиксы. Два параллельных Explore-агента: один по фронту bulk-диалога, второй по бэку роутинга.

**Проблема 1 — root cause (дизайн-разрыв):** `setDefaultProvider` (`admin-llm-providers.service.ts`) писал **только** флаг `isDefaultProvider` + `defaultModelKey` на строке каталога. Он не трогал ни `llm.router.defaultChain` (глобальную runtime-цепочку), ни таблицу `LlmTaskRoute`. Получалось: «дефолт провайдера» — это просто флажок, а таблица роутинга и defaultChain — отдельные сущности. В runtime `resolveDefaultChain()` отдал бы дефолт, но в таблице роутинга было «— не задана —».

**Проблема 2 — root cause:** `BulkReassignDialog` (`RoutingClient.tsx`) брал провайдеров из хардкод-enum `AI_MODELS_PROVIDERS` (legacy-7 имён), а модель — из свободного текстового `Input` без валидации против каталога. Эталонный паттерн (грузить с бэка) уже был на детальной странице роутинга — просто не применялся в bulk.

**Важный нюанс до фикса:** `BulkReassignSchema.toProviderName` тоже был `z.enum(PROVIDER_NAMES)` — провайдеры из каталога вне legacy-7 были бы отбиты валидацией, даже если бы UI их показал.

## Уточнение у владельца (что чинить в проблеме 1)

«Назначить по умолчанию» = 3 разных действия с разной семантикой. Уточнил — выбрали **«дефолт провайдера в каталоге»**. Дальше — как именно заполнять: выбрали **«авто-fill defaultChain + показ в UI»** (не агрессивное создание ~150 строк `LlmTaskRoute`, а обновление глобальной цепочки + effective-маршрут в таблице). Для модели в bulk — **«только каталог, без ручного ввода»**.

## Что сделал

**Проблема 1:**
- `setDefaultProvider(id, model, userId)` + новый `ensureDefaultChainPrimary()`: ставит провайдера в начало `llm.router.defaultChain` через `AdminSettingsService.set`, если он ещё не primary там. + `router.refreshCache()`.
- `ai-models.service.list()/detail()` отдают `effectivePrimary` (= `defaultChain[0]`) для taskType без явного primary.
- Фронт `TierBadge`: для пустого primary показывает «primary · по умолчанию» + провайдер/модель из defaultChain.

**Проблема 2:**
- DTO: `toProviderName` string+regex вместо enum.
- Новый `SearchSelect` (single-select combobox на `Command`+`Popover`, клон `MultiSelectCombobox` без массива).
- `BulkReassignDialog`: провайдеры/модели из каталога через `SearchSelect` с поиском, автоподстановка `defaultModelKey` при смене провайдера, без ручного ввода.

## Проверки

- backend typecheck/build/lint — чисто (мои файлы); unit: ai-models 19✓, llm-providers 32✓, bulk-reassign 7✓.
- frontend typecheck — чисто; lint — 0 ошибок.
- 3 провала `provider-smoke-test.cron.spec.ts` — предсуществующие, подтверждено `git stash` на чистом дереве (не моя регрессия).
- +3 новых unit-теста (ensureDefaultChainPrimary ставит/не-перезаписывает, effectivePrimary заполняется только без primary).

## Рефлексия / уроки

1. **Дизайн-разрыв ≠ баг в смысле «упало».** Симптом «не заполнилось» выглядел как баг, но корень — две сущности (`isDefaultProvider` vs `LlmTaskRoute`/`defaultChain`) не были связаны. systematic-debugging помог не кидаться чинить «заполнение таблицы», а сначала понять, что именно должен делать setDefault. Без уточнения у владельца можно было сделать bulk-create ~150 строк — агрессивно и труднооткатимо.

2. **Хардкод-enum рядом с каталогом — частый долг.** `AI_MODELS_PROVIDERS` (legacy-7) жил во фронте, а параллельно `RoutingDetailClient` уже грузил с бэка. Когда есть эталонный паттерн в соседнем файле — переносим его, не пишем свой. И **всегда** проверять DTO на бэке: UI может быть прав, а zod-enum отобьёт.

3. **`SearchSelect` как переиспользуемый актив.** В проекте был только `MultiSelectCombobox`. Single-select с поиском — дефицит; теперь есть отдельный компонент, будущие админ-селекты с поиском берут его.

4. **Скилл verification-before-completion оправдал себя:** перед коммитом прогнал именно изменённые спеки + typecheck/build обоих стеков, и stash-сравнением доказал, что 3 провала — не мои.

## Коммиты

- `e6710fa7` chore(env): единый шаблон .env.example + ребренд Z→Кора + .zcode в gitignore (чужие правки конфигурации, закоммичены по запросу владельца).
- `3c0d4e3f` fix(llm-routing): дефолт провайдера заполняет defaultChain + bulk-диалог на каталоге.

## Что NOT сделано (осознанный пропуск)

- `AdminLlmModelsService.setDefaultModel` (дефолт-модель уровня модели, не провайдера) тоже не трогает defaultChain. По плану чинили только провайдера (так уточнили). Если позже понадобится симметрия — отдельная задача.
- `SwitchPrimarySchema`/`AddProviderSchema`/`CreateExperimentSchema` всё ещё на `z.enum(PROVIDER_NAMES)` — они идут через детальную страницу, где провайдер уже из каталога, но при появлении не-legacy провайдера их тоже надо будет ослабить. Не трогал — вне скоупа.
