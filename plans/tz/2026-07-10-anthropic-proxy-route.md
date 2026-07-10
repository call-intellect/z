# ТЗ: поддержка Anthropic во внутреннем прокси (вариант A — отдельный маршрут `/anthropic/*`)

Дата: 2026-07-10 · Статус: **реализовано (обе части), ждёт redeploy прокси**

## Проблема (доказано живыми пробами 2026-07-10)

Anthropic через `proxy.agent-lia.ru` не работает по двум независимым причинам:

1. **Авторизация.** Прокси принимает ключ только как `Authorization: Bearer <префикс>:<ключ>`. Anthropic SDK шлёт ключ в `x-api-key` → прокси отвечает собственным 401 `invalid_proxy_auth` до маршрутизации.
2. **Маршрутизация.** Upstream'ы прокси: `/v1/*` → api.openai.com, `/grsai/*`, `/kie/*`. Upstream api.anthropic.com отсутствует — `POST /v1/messages` уходит на OpenAI → 404.

Плюс дефект формулы в Z: `resolveEffectiveConnection` всегда добавляет `/v1` (`{root}/{proxyPath}/v1`), а Anthropic SDK сам дописывает `/v1/messages` → задвоенный `/v1`. Аналогично ломается `kie-native` (KieService сам строит `/{model}/v1/…`).

## Решение

### Часть 1 — репо `Tozix/openai-proxy` (отдельный сервис)

- [x] `src/proxy/anthropic.controller.ts` — `@Controller('anthropic')`, wildcard-роуты как у grsai/kie.
- [x] `proxy.service.ts`:
  - `UpstreamOptions.authScheme?: 'bearer' | 'x-api-key'`;
  - `anthropicBaseUrl` из ENV `ANTHROPIC_BASE_URL` (дефолт `https://api.anthropic.com`);
  - извлечение ключа `<префикс>:<ключ>` из `x-api-key` (fallback — `Authorization: Bearer`);
  - upstream-заголовок: при `x-api-key`-схеме наружу уходит `x-api-key: <чистый ключ>` (не `Authorization`); `x-api-key` добавлен в skip-список копируемых заголовков;
  - `anthropic-version` и SSE-стриминг проходят прозрачно (существующий pipe).
- [x] `.env.example`, `README.md`, `scripts/test-proxy.ts` — секция Anthropic.
- [x] Проверка: `npm run build` зелёный.
- [ ] **Redeploy прокси на сервере** (руками владельца): `git pull && docker compose up -d --build`, затем smoke-curl (команда в README).

### Часть 2 — Z

- [x] `effective-connection.util.ts`: формула протокол-зависимая — для `anthropic-messages` и `kie-native` (протоколы, добавляющие свой путь c `/v1` сами) `/v1` НЕ дописывается: `{root}/{proxyPath}`, при пустом proxyPath — `{root}`.
- [x] `ProviderInfoResolver` и `discoverModelsPreview` передают `protocolKind` в формулу.
- [x] Тесты: util (anthropic/kie с путём и без), резолвер (anthropic-строка через прокси).
- [x] Фронт `LlmProvidersClient.tsx`: предпросмотр «Куда пойдёт запрос» зеркалит протокол-зависимую формулу; при включении прокси на anthropic-протоколе proxyPath префиллится `anthropic`; warning остаётся только для случая anthropic+прокси+пустой proxyPath (корневой `/v1` ведёт на OpenAI); подсказка proxyPath упоминает слаг `anthropic`.

## Конфигурация anthropic-провайдера в админке (после redeploy прокси)

`useProxy=ON`, `proxyPath=anthropic`, ключ — чистый `sk-ant-…` (префикс добавится сам). Итоговый URL: `https://proxy.agent-lia.ru/anthropic/v1/messages`. Проверка — кнопка «Сохранить и проверить».

## Итог

Реализовано целиком в обоих репо; production-активация требует только redeploy прокси и установки `proxyPath=anthropic` у провайдера.
