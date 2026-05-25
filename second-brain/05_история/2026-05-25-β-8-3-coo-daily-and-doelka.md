---
date: 2026-05-25
feature: β-8.3 — Доделка панели операционного директора (ежедневный отчёт + causeCategory-фронт + виджет зрелости)
type: reflection
distilled: false
related:
  - plans/tz/2026-05-25-sba-beta-8-3-coo-daily-and-doelka.md
  - plans/analysis/2026-05-25-coo-tech-debt-backlog.md
  - plans/analysis/2026-05-23-ai-coo-readiness-analysis.md
commits:
  - babca26 docs(plans): ТЗ β-8.3 + tech-debt backlog AI-COO
  - a9c0a96 feat(operations): β-8.3 Wave 1 — ежедневный отчёт COO (backend)
  - 471cfbb feat(operations): β-8.3 Wave 2 — overview расширен causeCategory + maturity
  - c087b2f feat(operations,insights): β-8.3 Wave 3 — frontend всех 3 фаз COO
  - e768680 docs(second-brain): обновление под β-8.3
---

# β-8.3 — оркестрация 3-волн + reality-check вместо слепого ТЗ

## Что было поставлено

Пользователь сказал «давай сделаем новое ТЗ на доработку AI-COO. И, кстати, мы говорили про недельный отчёт — а ежедневный отчёт есть? Если нет — нужно сделать». Я предложил три варианта (A — узкий, B — средний, C — большой). Пользователь выбрал C: α-8 Role Map + α-9 CompanyProfile + β-4 causeCategory + ежедневный отчёт. Время отчёта — 01:00 МСК (= 22:00 UTC), глобально для всех Org РФ. Уровни доступа — единое право (раздельные потом).

## Reality-check вместо ТЗ-вслепую — главный win сессии

Перед написанием ТЗ я начал проверять, что из «не сделано» по gap-анализу 2026-05-23 уже в коде. Запустил **3 параллельных Explore-агента** на α-8 / α-9 / β-4. Результат удивительный — почти всё уже сделано в Wave 1-3 (24 мая):

- **α-8 Role Map** — работает end-to-end (5 моделей + воркер + REST CRUD + UI `/roles/[id]/map` + cron completeness). 0% доделок.
- **α-9 CompanyProfile** — работает на 90% (MaturityScorerCron, domain-expander, REST `/company`, UI `/company/domains/maturity/departments`). Нет только LLM-extraction миссии/видения из встреч (отложено на δ-1).
- **β-4 causeCategory** — backend готов (LLM-промпт extract'ит 8 категорий, поле в БД, API filter работает), но **фронтенд не использует**: фильтр не передаётся в API клиенте, виджет «Топ-5» не группирует, COO Dashboard не агрегирует.

Если бы я слепо написал ТЗ на «доработку α-8 + α-9 + β-4», программисты бы попытались переделать то, что работает — и грабли от схемы до UI. Вместо этого ТЗ сжалось до:
1. **Фаза 1** — ежедневный отчёт COO (реально нет).
2. **Фаза 2** — фронтенд causeCategory (реально не интегрирован).
3. **Фаза 3** — виджет зрелости компании на COO-дашборде (`maturityScore` считается, но не показывается).

С 4-5 недель «варианта C» до 1-1.5 недели реальной работы. **Лучший урок сессии — не доверять устаревшим gap-анализам, проверять код.**

## Как решал — 3 волны

### Wave 1 — Backend Phase 1 (новый ежедневный отчёт)

Один general-purpose агент с детальным брифом + эталоном β-8.1 weekly-digest (5 файлов как референс для копирования паттернов). Сделано:
- Модель `DailyOperationsDigest` (зеркало weekly, окно 1 день в МСК).
- Cron `@Cron('0 22 * * *')` — глобальный, не per-Org.
- LLM taskType `operations-daily-digest` (deepseek-chat → openai gpt-5.4-nano → ollama qwen3.5).
- REST: `GET .../daily-digest`, `GET .../latest`, `POST .../generate`.
- Telegram-рассылка через `ConversationalService.sendNotification` — **только coo+owner** (admin исключён, потому что в Z это IT-роль).
- Тумблеры через `AdminSetting` + ENV fallback.
- Метрики Prometheus: `coo_daily_digest_*` (4 шт).
- Seed-скрипты: `seed-llm-task-routes-beta-8-3.ts`, `seed-admin-setting-daily-digest.ts`.
- 12/12 unit-тестов, regression operations 82/82.

Граблы агента:
1. **БД недоступна** (`P1001` от Docker), `prisma:push` не запустился — но `prisma:generate` прошёл и типы сгенерированы. Команда на прод вынесена в инструкцию.
2. **`getDynamic.envFallbackKey: keyof Env`** ломал call-site'ы — на длинной `.merge`-цепочке `EnvSchema` `keyof Env` сужалось до `never|undefined`. Ослабил до `string` с комментарием.

Коммит: 15 файлов, 2210 insertions.

### Wave 2 — Backend Phase 2+3 (расширение overview)

Один агент. Расширил `OperationsDashboardService.getOverview` двумя блоками:
- `insightsByCauseCategory: Record<CauseCategory, number>` — `groupBy` по `Insight.causeCategory` за 7 дней (`severity ≥ medium`, NULL → bucket `unknown`).
- `maturity: { score, stage, lastCalcAt, weakestDomains[3], topDomains[3] }` — снапшот зрелости.

Метрики: `coo_insights_by_cause_total{cause}` + `coo_company_maturity_score` (не публикуется при `score=null` — чтобы не зашумлять).

7/7 unit-тестов, regression 85/85. Коммит: 4 файла, 464 insertions.

### Wave 3 — Frontend всех 3 фаз

Большой агент (10 новых файлов + 6 изменённых). Сделано:
- Страница `/dashboard/operations/daily` (date-picker, markdown через `react-markdown` + `rehype-sanitize`, кнопки навигации, регенерация для admin).
- Блок «Вчерашний отчёт» на `/dashboard/operations` через отдельный SWR на `latest`.
- Виджет `CauseCategoryMapWidget` — 8 горизонтальных столбиков, кликабельные → `/insights?cause_category=...`.
- Виджет `MaturityWidget` — SVG-кольцо score (mint #5EEAD4), две колонки weakest/top.
- Sidebar: пункт «Ежедневный отчёт» с lucide `Newspaper`.
- Расширение `insights.api.ts` (фильтр `cause_category` в list и top), `InsightsTopWidget` (легенда + цветные бэйджи).
- `frontend/src/lib/cause-category-presentation.ts` — 8 русских лейблов + Tailwind палитра (rose/sky/violet/amber/pink/stone/zinc/neutral) + `COMPANY_STAGE_LABELS_RU`.

Все слои `ApiDto → Domain → Ui` соблюдены. typecheck + lint зелёные.

## Что вышло

- **3 моих коммита кода + 1 коммит ТЗ + 1 коммит second-brain = 5 коммитов.** Все валидированы typecheck/lint/tests.
- **Параллельная сессия активна** в репо — наделала 5 коммитов после моего Wave 3 (skill-trait-detect, ТЗ KC-Temporal, рефлексии prompt-cache/kie/grsai). Стейджил только свои файлы по явным путям, не наступил.
- **Reality-check сэкономил ~3-4 недели** программистской работы (была бы попытка переделать α-8 / α-9 / β-4 заново).
- **Tech-debt документ** ([plans/analysis/2026-05-25-coo-tech-debt-backlog.md](../../plans/analysis/2026-05-25-coo-tech-debt-backlog.md)) фиксирует 10 отложенных направлений (TD-1..TD-10) с триггерами активации — чтобы не забыть и не делать преждевременно.

## Чему научился

1. **Перед каждым новым ТЗ — reality-check кода, а не доверие к gap-анализу.** Gap-анализ от 23 мая был не «неправильный», он был «устарел через сутки» — Wave 1-3 закрыли почти всё, а память про это была только в `index.md` строкой «α-2/α-3/α-4/α-5/α-7/α-8/α-9/α-10 | done/partial». Без 3 параллельных Explore-агентов с конкретными вопросами я бы написал ТЗ на сделанную работу.

2. **`getDynamic.envFallbackKey: keyof Env` на длинной zod-цепочке падает в `never`.** TS2589 (instantiation depth) уже был у нас в приватном `get`. При длинном `.merge` цепочке — `keyof` сужается до `never|undefined`. Решение: `string` + раннер-валидация по факту.

3. **Параллельная сессия Claude Code — реальный риск.** Я делал `git fetch` только в начале сессии. Параллельная сессия наделала 5 коммитов после моего Wave 3 — увидел только в `git log` перед последним коммитом. Поскольку не пушил — пушить теперь нужно после явного подтверждения, с учётом её работы. **Памятка-feedback `parallel_sessions_git_check` подтвердилась — проверяй log не только перед волной, но и периодически между.**

4. **AdminSetting + ENV fallback — правильная схема для тумблеров.** ENV для defaults, AdminSetting для live-override (без рестарта). Точно тот же паттерн уже был в `daily-checkin-prompt.cron` — не пришлось изобретать.

5. **«Не вошло» — это документ, не молчание.** Tech-debt backlog с триггерами активации — лучше, чем «потом разберёмся». 10 пунктов TD-1..TD-10 теперь нельзя забыть и нельзя сделать преждевременно.
