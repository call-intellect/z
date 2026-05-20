---
type: architecture
---

# Code Pitfalls — копилка тех. фактов «не как кажется»

Пополняется через дистилляцию рефлексий из `05_история/`.

## LiveKit / Egress

### 1. Egress — потрескивание в записи (Feb 2026)

При записи отдельных дорожек участников через Participant Egress в свежих версиях (~Feb 2026) репортились потрескивания. Перед фиксацией версии — проверить open issues в `livekit/egress` (issue #1133 на момент 2026-05).

**Почему:** артефакты в записи ломают качество ASR, особенно для русского языка (низкие WER зависят от чистоты сигнала).

**Как обойти:** перед прод-выкладкой прогнать тестовую запись сквозь ASR и сравнить WER со старой стабильной версией. Версию закрепить тегом, не следить за `latest`.

### 2. host networking → 1 LiveKit-под на ноду

Стандартный Helm-чарт LiveKit разворачивает SFU с `hostNetwork: true` (rtc.udp/tcp напрямую на интерфейсе ноды). Это означает: **один LiveKit-под на одну k8s-ноду**, нельзя запустить два рядом.

**Почему:** UDP-порты заняты на хосте; коллизия портов.

**Как обойти:** для масштабирования — больше нод (ОК для продукта) ИЛИ STUNner (TURN-прокси для k8s, снимает host networking как требование).

### 3. Egress нельзя селить на одной ноде с SFU

Запись — CPU-голодный процесс. Если запустить рядом с SFU, у звонков начинают сыпаться качества (jitter, drop frame).

**Почему:** transcoding жрёт CPU, мешает media routing.

**Как обойти:** в Helm — отдельный node pool для egress; в docker-compose тестово — отдельная машина.

## Webhooks

### 4. LiveKit-вебхуки: HMAC-SHA256 в JWT, плюс body checksum

Двухуровневая аутентификация: JWT в `Authorization` header (подписан API-ключом+секретом) + SHA-256 хеш тела вшит в JWT. Если проверять только JWT — атакующий может подменить тело.

**Как обойти:** проверять и подпись JWT, и совпадение sha256 тела с тем, что в claims JWT.

### 5. LiveKit-вебхуки могут приходить дважды

Doc прямо говорит: handler должен быть идемпотентным. Дубликаты случаются, не баг.

**Как обойти:** таблица `webhook_seen_events(event_id PK)`, на повтор — `2xx` no-op.

## ASR / Биллинг

### 6. Yandex SpeechKit тарифицирует 15-секундными блоками

Не за минуту, а за 15-секундный сегмент моноаудио. **Короткие фрагменты округляются вверх** до 15 сек. Если шлёшь 200 файлов по 1–2 секунды (например, по фразам), переплатишь в 7–15 раз.

**Как обойти:** склеивать аудио в файлы по нескольку минут перед отправкой. Не дробить фразами.

## Апгрейд пакетов / рантайм (2026-05-20)

### 7. NestJS 11: строгий DI ломает «плоскую» проводку worker-процесса

`WorkersModule` (root `createApplicationContext`) перечислял сервисы (`LlmRouterService`, `MeetingsService` и т.д.) **локальными провайдерами** вместо импорта их модулей. На HTTP это работало, потому что `@Global AiModule` реэкспортит нужное. В воркере `AiModule` нет, и `@Global KnowledgeCoreModule` (импортируемый воркером) **не видит** локальные провайдеры root-модуля — под NestJS 11 это жёсткая `UnknownDependenciesException` (каскадом: LlmRouter → Embedding → CoreQueue → Entitlement/Quota → auth-guard контроллеров).

**Как обойти:**
- Узкие `@Global`-обёртки для воркера: `LlmRouterGlobalModule`, `EntitlementGlobalModule` (provide+export один сервис + его зависимости, без HTTP-багажа вроде `RetryService→MeetingsService`).
- Импортировать готовые `@Global`-модули (`CoreQueueModule`, `QuotasModule`), а не дублировать их провайдеры локально.
- Сделать `@Global` модули, чьи exports нужны @Global-консьюмерам (`EmbeddingsModule`).
- Контроллеры выносить из сервис-модуля: `KnowledgeCoreApiModule` (controllers) ↔ `KnowledgeCoreModule` (@Global services) — иначе воркер инстанцирует контроллеры и их `CookieAuthGuard/TenantGuard`.

### 8. Prisma 7 — driver adapter, а не просто bump

Rust-движок убран. `url` в `datasource` запрещён → выносится в `prisma.config.ts` (`datasource.url`), рантайм-клиент создаётся с `adapter: new PrismaPg({ connectionString })`. `$use` (middleware) удалён → slow-query логирование через `$on('query')`. **Любой** standalone `new PrismaClient()` (seed, скрипты) тоже требует adapter.

**Как обойти:** `PrismaService` и `prisma/seed.ts` — через `@prisma/adapter-pg`. `prisma.config.ts`: `import 'dotenv/config'` (Prisma CLI не видит bun-автозагрузку `.env`) + `url: process.env['DATABASE_URL'] ?? ''` (фолбэк, чтобы `prisma generate` не падал без БД в Docker-сборке).

### 9. tsc не копирует non-TS ассеты в dist

`RbacService` читает `policies/policy.csv` через `readFileSync(join(__dirname, ...))`. `bun run dev` (из `src/`) работает, а собранный `bun dist/main.js` падает с ENOENT — `tsc` копирует только `.ts`.

**Как обойти:** шаг `bun scripts/copy-assets.ts` в `build` (копирует ассеты в `dist/`). Альтернатива — инлайнить (как mail-шаблоны).

### 10. «Latest» иногда — ломающий rewrite или вообще ниже текущего

`archiver` 8 — ESM-rewrite на классы (`new ZipArchive()` вместо `archiver('zip')`), ломает `import archiver` под bun и сам API → пин на `^7`. `@vidstack/react`/`media-icons`: npm `latest` (0.6.x/0.10.x) **ниже** установленных (1.x) → не трогать. ESLint 10 убрал eslintrc (flat config обязателен) + `eslint-plugin-import` несовместим → `eslint-plugin-import-x`; `eslint-config-next` под ESLint 10 падает на циклической ссылке → `@next/eslint-plugin-next` напрямую.

**Как обойти:** перед бампом мажора проверять changelog и что `latest` действительно новее; держать список оправданных исключений.

[[../index|← index]]
