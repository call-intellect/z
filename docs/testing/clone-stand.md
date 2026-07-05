# Клон-стенд — измерительный стенд качества клонов сотрудников

Инструмент + петля: наполнить клонов с известным ground truth → снять **Слой 0** (фиделити построения)
и **baseline** (распределение вердиктов на 110 вопросов) → диагноз «что работает / что нет» → ТЗ на
доработку → фикс → перепрогон, до планки. Проект и линейка: [plans/architecture/2026-07-03-clone-quality-stand.md](../../plans/architecture/2026-07-03-clone-quality-stand.md).
Тенант — «Стрела» (`STRELA_ORG` в `backend/.env`), прод не трогается (`assertNotProd` первым в каждом скрипте).

## Предусловия

- Живые dev-зависимости: `docker compose -f docker-compose.dev.yml up -d` (Postgres :55435, Redis :56381, MinIO).
- **Живой backend с воркерами** для наполнения (Каналы А/Б, ингест): `cd backend && bun run dev`.
- Реальные LLM-ключи в `.env` (deepseek — судьи и конвейер работают на живых моделях).
- Baseline снимается в прод-конфиге: `CLONE_V2_ENABLED=false` (askPerson/askRole → V1 factual; askAllFormers всегда V2).

## Файлы

```
backend/scripts/clone-stand/
  clone-seed-data.ts    данные (CLONES: методы 4 носителей + statusFacts/absentFacts) — ground truth
  seed-clone-feed.ts    наполнение: configure | prepare | channelA | channelB | build | status | manifest
  layer0-annotate.ts    Слой 0: слепая разметка прозы сида → манифест ожидаемых черт (правило №1)
  layer0-match.ts       Слой 0: сверялка read-only манифест ↔ база клона
  stand.ts              линейка: run | judge | report | all
  types.ts · judge.ts · report.ts   контракт + панель 3 линз + вердикт/scorecard
docs/testing/
  clone-stand-questions.json   банк 110 вопросов (13 категорий) — ground truth
  clone-feed-manifest.json     методы по клонам + statusFacts + absentFacts (генерит manifest)
  clone-layer0-manifest.json   ожидаемые черты (генерит layer0-annotate)
  clone-layer0-report.md       Слой 0 фиделити (генерит layer0-match)
  clone-stand-results.json     трасса прогона (генерит run)
  clone-stand-judged.json      вердикты линз (генерит judge)
  clone-stand-report.md        baseline-отчёт (генерит report)
```

## Рецепт (из `backend/`, при поднятом `bun run dev`)

```bash
# --- наполнение (Фаза 0) ---
bun run scripts/clone-stand/seed-clone-feed.ts configure   # knobs Канала Б (methodCapture/probe) в dev-БД
bun run scripts/clone-stand/seed-clone-feed.ts prepare      # users/роли/назначения/регламенты/гранты
bun run scripts/clone-stand/seed-clone-feed.ts channelA     # reasoning-корм (async, воркеры)
bun run scripts/clone-stand/seed-clone-feed.ts channelB     # задача→probe→ответ (штатный путь; воронка)
# ждать дренаж ингеста: SELECT count(*) FROM "RawEvent" WHERE "processingStatus"='received' → ~0
bun run scripts/clone-stand/seed-clone-feed.ts build        # rebuild→verify→персоны→смена носителя (синхронно)
bun run scripts/clone-stand/seed-clone-feed.ts status       # готовность клонов
bun run scripts/clone-stand/seed-clone-feed.ts manifest     # clone-feed-manifest.json (ground truth)

# --- Слой 0 фиделити (Фаза 0в) ---
bun run scripts/clone-stand/layer0-annotate.ts             # слепая разметка → clone-layer0-manifest.json
bun run scripts/clone-stand/layer0-match.ts                # сверялка → clone-layer0-report.md

# --- baseline (Фазы 1-3) ---
export CLONE_STAND_STAMP=2026-07-05-baseline
AI_CHAT_DAILY_LIMIT_ADMIN=100000 bun run scripts/clone-stand/stand.ts all   # run→judge→report
```

`stand.ts all` = `run` (110 вопросов через ClonesService, трасса llmMeta) → `judge`
(панель 3 линз E+P/M/G через deepseek-v4-pro, boundary — отдельная линза) → `report`
(вердикт детерминированно сверху вниз, scorecard + оси + диагнозы с атрибуцией по слою).

## Линейка (вердикт на вопрос, сверху вниз)

`BOUNDARY_OK/FAIL` (boundary+off_domain, 14) → `FABRICATED` (G-провал) → `REFUSED` (отказ там, где
ждали ответ) → `EXPERT_PASS` (E≥0.7 ∧ M≥0.5 ∧ (L совпал ∨ слой advisory) ∧ P-чисто) → `WEAK` (остаток).
5 осей: E экспертность · M верность методу · G заземлённость · L опора на слой · P персона.

## Планка (приёмка петли)

`EXPERT_PASS ≥95%` на отвечаемых (96/110) · `FABRICATED=0` · `BOUNDARY_OK=14/14` · `REFUSED=0` на
отвечаемых · ср. `M≥0.7`. Прогноз baseline: массовые `REFUSED` (refusal-first политика). Резкое
расхождение с прогнозом → сначала диагноз `ruler-defect` (чинить стенд), не паниковать.

## Грабли

- Наполнение LLM-тяжёлое и медленное локально; ингест ~3-4 блока/мин, конвейер может насыщать LLM.
- `build` — синхронный (в обход BullMQ-очереди, флейкует при двух app-контекстах).
- Квота: `.env` `AI_CHAT_DAILY_LIMIT_ADMIN=50` мала для 110 вопросов — раннер запускать с override
  `AI_CHAT_DAILY_LIMIT_ADMIN=100000` (command-line env перебивает .env в bun; live-backend не трогается).
- Порог склейки черт `knowledge.skillClusterSimilarityThreshold=0.60` в dev-БД (header-less пространство).
  На прод НЕ переносить без re-embed блоков (сопряжённая миграция).
- Стендовые скрипты — НЕ прод: в `apply-prod-deploy.ts STEPS` и `prod-deploy-log` НЕ вносить.
