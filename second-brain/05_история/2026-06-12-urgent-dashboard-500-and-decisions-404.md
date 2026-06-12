---
distilled: false
---

# 2026-06-12 — Срочный фикс прод-багов: 500 на дашборде директора + 404 на решениях

## Что было поставлено

Реализовать ТЗ `plans/tz/2026-06-12-urgent-dashboard-500-and-decisions-404-fix.md` (из живого аудита кабинета korateam.ru, болезни Б-1 и Б-7) скиллом tz-orchestrator, в отдельной ветке. Два независимых прод-бага под аккаунтом владельца:

1. 🔴 `GET /api/v1/dashboard/director` → **500 `db_error`** (и week, и month). Главная владельца мертва (красная плашка, нули, «сводка появится после первой встречи» при 13 встречах).
2. 🔴 `/decisions/<id>` → **404** (3+ в консоли на `/dashboard` и `/dashboard/operations/daily`).

Три фазы: Ф1 backend-устойчивость (чинит 500 + даёт диагностику), Ф2 frontend-роут (чинит 404), Ф3 прицельный добив корня (после деплоя по логам).

## Как решал

Ветка `fix/dashboard-500-and-decisions-404` от текущей. Оркестрация: картография сам → промпт кодеру → независимая приёмка (греп маркеров + re-Read + свой typecheck/lint/build/тесты) → ревью → коммит по фазе.

**Картография (сам, до кодеров):** сверил все 14 fallback'ов с реальными возвратами сервисов — `SentimentIndexDto` / `CommitmentReliabilityDto` / `HangingDecisionsDto` + `fetch*`-методы. Все типобезопасны. Подтвердил версии стека: **TS ^6.0.3** (есть `NoInfer`), **Next ^16.2.6** (`params: Promise<{id}>` + await). Эталон роута — существующий `decisions/page.tsx` (уже `MobileShell`+`MobileMemoryClient`+`DecisionsListClient`) → новый роут просто зеркалит его с `initialSelectedId={id}`.

**Ф1 (коммит `7ae5ce14`):** `getDirectorView` — 14 веток `Promise.all` обёрнуты в `safe(label, fn, fallback)`: ошибка деградирует виджет до нейтрального fallback'а + `logger.error` с именем виджета, дашборд отдаёт 200 с новым опц. `degraded=true`. `isEmpty`-guard (`failures.length===0 && …`) не даёт подменить частичные данные sample-story при сбое. Улучшение против ТЗ: `fallback: NoInfer<T>` — тип `T` выводится строго из `fn`, object-literal fallback (`trend:'flat'`) не расширяется до `string`. Resilience-spec (2 теста). Файлы: `director-dashboard.dto.ts` (+`degraded?`), `director-dashboard.service.ts`, `director-dashboard.resilience.spec.ts`.

**Ф2 (коммит `d68cff43`):** новый `frontend/app/(authenticated)/decisions/[id]/page.tsx` (deep-link, master-detail с предвыбором) + `DecisionsListClient` принял опц. проп `initialSelectedId` (4 точечные правки, backward-compat). Чинит все 3 источника ссылок разом.

**Документация:** обновил `director-dashboard.md` (устаревшее «7 запросов» → 14 + safe-устойчивость) и `frontend-pages.md` (роут + история).

## Что вышло (верификация — всё сам, не по отчётам агентов)

- Backend: `tsc --noEmit`=0; `vitest` 5 спеков / **14 тестов passed** (resilience + requires-action + goals + value-strip + controller); `eslint`=0 errors (1 warning `import-x/order` на стр.28 — **предсуществующий**, импорты не трогал); `bun run build`=0 (реальная DI-проверка). В логе теста виден штатный `ERROR director widget «sentiment» fail … sentiment db down` со стеком — это `safe()` ловит и деградирует, доказательство поведения.
- Frontend: `typecheck`=0; `bun run build`=0; новый роут реально в манифесте (`.next/server/app/(authenticated)/decisions/[id]/page.js` + `/(authenticated)/decisions/[id]/page` в `app-path-routes-manifest.json`), а не «просто не сломал сборку».
- git: каждый коммит — только свои файлы явными путями; чужие untracked (`second-brain/04_не-сделано/README.md` с +1 чужой строкой, `plans/analysis/2026-06-12-product-audit*`) не зацепил.

## Чему научился

- **`NoInfer<T>` — правильный инструмент для helper'ов вида `safe(fn, fallback)`**, где object-literal fallback мог бы расширить литеральные типы (`'flat'`→`string`) и сломать вывод `T`. Доступен с TS 5.4, импорт не нужен (проект на TS 6). Лучше plain-сигнатуры из ТЗ — `T` берётся строго из `fn`, fallback контекстно типизируется под него.
- **Архитектурная непоследовательность — это баг.** Корень Б-1 не «плохие данные», а то, что 2 ветки сервиса уже были best-effort (`requiresAction`/`narrativeSummary`), а 14 в `Promise.all` — нет. Чинить надо класс (устойчивость агрегатора), а не один упавший запрос: иначе завтра упадёт другой виджет и снова обнулит экран владельца.
- **`git add` и пути со скобками `[id]`** — нужен литеральный pathspec `:(literal)…`, иначе git примет `[id]` за glob-класс символов и не застейджит новый роут (тихо). Проверять `git diff --cached --name-only` до коммита.
- **Эталон конвенции в репо > сниппет в ТЗ.** Новый роут зеркалит существующий рабочий `decisions/page.tsx`, а не «угаданную» структуру — поэтому 0 правок после первой компиляции.

## Открыто (Фаза 3 — добив корня)

Фазы 1-2 выкатываются первыми и от Ф3 не зависят. **Ф3 — designed-после-деплоя:** после выката Ф1 прод-лог назовёт `director widget «<label>» fail …` с реальным Prisma-сообщением. Дальше: если дрейф схемы (колонка из непрокатанной миграции) → прокатать миграцию штатным `migrate deploy`; если баг запроса → точечно починить тот `fetch*`. Ускоренный путь (до деплоя) — прочитать прод-лог по `requestId` через `diag.ts` — **требует явного «можно в прод» владельца в сессии** ([[feedback_prod_diagnostic_access_requires_confirmation]]). Кандидаты на упавший запрос (уникальные для `getDirectorView`): `fetchValueStrip` (raw-SQL + relation `aiResult.summaryFast`), `fetchGoalsTree/Pulse` (колонки `promotionState`/`validUntil`/`progressStatus`), `fetchStrategicAlignment` (`cachedAlignment*`).
