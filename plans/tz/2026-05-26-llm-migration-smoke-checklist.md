---
status: draft
created: 2026-05-26
type: operational-checklist
priority: medium
effort: 0.5-1 день
depends_on: []
---

# Smoke 28 агентов после миграции LLM на DeepSeek-V4-Pro — операционный чек-лист

> Связанный контекст: [plans/archive/2026-05-25-llm-architecture-changes-from-experiments.md](2026-05-25-llm-architecture-changes-from-experiments.md) (главная ТЗ-копилка миграции), [second-brain/05_история/2026-05-26-llm-migration-deepseek-pro-wave.md](../../second-brain/05_история/2026-05-26-llm-migration-deepseek-pro-wave.md) (рефлексия 8 фаз), задача 5 из [plans/analysis/2026-05-26-llm-migration-followup-prompt.md](../analysis/2026-05-26-llm-migration-followup-prompt.md). Предыдущий отчёт: [backend/test/eval/smoke-all-agents/SUMMARY-SMOKE.md](../../backend/test/eval/smoke-all-agents/SUMMARY-SMOKE.md).

## §0. Контекст

В сессии 2026-05-25/26 применена 8-фазная миграция всех LLM-агентов проекта Z на `deepseek-v4-pro` (см. рефлексию). Серия коммитов `5921a20`..`cad4aef` уже в `origin/dev`. До применения миграции был прогон smoke 28 агентов 2026-05-25 (28/28 OK, ~$0.036), который **подтвердил техническую совместимость** промптов с Pro как таковую, но был сделан **в обход routing-инфраструктуры** (прямые OpenAI-клиенты к DeepSeek API, без LlmRouter, без БД-конфига маршрутов).

Текущий smoke нужен чтобы **верифицировать применение** миграции на dev-БД:

1. Все seed/patch-скрипты Фаз 4-7 успешно отработали, БД фактически содержит `model='deepseek-v4-pro'` для всех ожидаемых taskType (см. § «Прод-инструкция» рефлексии).
2. Ни один из 28 агентов не падает 400/500 при прохождении через реальный `LlmRouterService` (а не прямой OpenAI-вызов в smoke-скриптах). Это особенно важно для 5 промптов, **вынесенных в Фазе 8** из embedded-сервисов в `prompts/*.prompt.ts` — snapshot-тесты гарантируют побайтовую идентичность, но семантику теперь надо подтвердить.
3. Метрика `z_llm_thinking_model_guard_total{kind, model}` (введённая в Фазе 1 коммитом `92aec84`) **начала капать** инкрементами `kind="schema-to-tool"` и/или `kind="strict-stripped"` — это сигнал, что автоконвертация `json_schema → tools` для Pro-моделей реально срабатывает на проде/dev (а не «висит мёртвой»).
4. Цена/время не выросли. Pro со скидкой 75% должен быть **дешевле или равен** старым моделям (`deepseek-v4-flash`, `gpt-5.4-nano`, `qwen3.5:9b`); thinking-overhead в latency должен укладываться в SLA (cron-агенты — без UX, формулировщики — < 10 секунд).

**Риски, которые снимаем:**

- Прод (или dev после применения) внезапно начинает плевать 400 «Thinking mode does not support...» на каком-то taskType, который мы переключили слепо (по списку в `patch-mass-migrate-to-deepseek-pro.ts`) без явной верификации в новом окружении.
- Один из 5 вынесенных embedded-промптов (`block-distill`, `block-linker`, `theme-classify`, `reframing`, `entity-merge-arbiter`) при выносе потерял переменную интерполяции (snapshot не ловит, если все snapshot'ы одновременно сгенерированы из той же ошибочной версии) — smoke-фикстура с реальным телом фикстуры это поймает.
- `executable-persona-compile` / `role-profile-build` после поднятия `maxTokens` до 8000/16000 (Фаза 3) — действительно перестали обрезаться.

## §1. Pre-flight (что подготовить ДО прогона)

### 1.1 Переменные окружения

В `backend/.env` (или системном окружении сессии прогона):

- `DEEPSEEK_API_KEY=<рабочий ключ>` — обязательно (есть у пользователя).
- `DEEPSEEK_BASE_URL` — по умолчанию `https://api.deepseek.com/v1`, переопределять только если используется внутренний proxy.
- `DATABASE_URL=postgresql://...` — указывает на **dev-БД** (Postgres+pgvector :55435 из `docker-compose.dev.yml`). **Не prod.**
- `REDIS_URL` — для BullMQ (если smoke-скрипты дёргают воркеры через очередь — на 2026-05-25 они идут в обход и зовут LLM напрямую, но локальный backend всё равно ждёт Redis на старте).

Проверить, что окружение указывает на dev:
```bash
echo $DATABASE_URL
# должно быть localhost:55435 / dev-host, НЕ prod-хост.
```

### 1.2 Применить схему БД

В Фазе 7 появилась модель `CloneAccessGrant` (см. рефлексию, коммит `f897d99`). Если ранее на dev-БД миграцию не применяли:

```bash
cd backend
bun run prisma:push
bun run prisma:generate
```

### 1.3 Применить seed-скрипты на dev-БД (полный список из рефлексии)

Запускать **из `backend/`**, по порядку. Все идемпотентны и уважают `editedByAdmin=true`.

```bash
cd backend

# Маршруты, добавленные в Фазах 6-7-8:
bun run scripts/seed-llm-task-routes-clone-v2.ts --update-existing
bun run scripts/seed-llm-task-routes-specialists-combined.ts
bun run scripts/seed-llm-task-routes-beta-8-1.ts --update-existing
bun run scripts/seed-llm-task-routes-beta-8-3.ts --update-existing
bun run scripts/seed-llm-task-routes-dialog-layer.ts --update-existing

# Точечный patch chat-v2:
bun run scripts/patch-chat-v2-to-pro.ts

# Массовая миграция 19 одиночек на DeepSeek-Pro (сначала dry-run, потом apply):
bun run scripts/patch-mass-migrate-to-deepseek-pro.ts --dry-run
bun run scripts/patch-mass-migrate-to-deepseek-pro.ts --update-existing
```

После каждого скрипта **прочитать вывод**: должны быть `updated:*` / `alreadyPro` / `ok` — без `skipped:invalid` / `skipped:not-found` для целевых taskType. `skipped:edited` для отдельных записей нормально (это сделал админ).

После прогона всех seed/patch — спот-проверка в БД (опционально, но рекомендуется):
```bash
cd backend
bun -e "import {PrismaClient} from '@prisma/client'; import {PrismaPg} from '@prisma/adapter-pg'; const p = new PrismaClient({adapter: new PrismaPg({connectionString: process.env.DATABASE_URL})}); const r = await p.llmTaskRoute.findMany({where: {tier: 'primary', model: 'deepseek-v4-pro'}, select: {taskType: true}}); console.log('primary deepseek-v4-pro:', r.length, r.map(x=>x.taskType).sort()); await p.\$disconnect();"
```
Ожидаем минимум 25-30 строк (28 списочных + 5 dialog-layer + 1 chat-v2 + clone-respond + specialists-combined; точное число зависит от смешанного legacy/new-формата записей).

### 1.4 Поднять локальный backend + worker

В двух терминалах:

```bash
cd backend
bun run dev          # HTTP-приложение, порт :3000
```

```bash
cd backend
bun run worker:dev   # BullMQ-воркеры
```

### 1.5 Health-check backend

```bash
curl http://localhost:3000/health
# ожидаем 200 { "status": "ok", ... }
curl -s http://localhost:3000/metrics | head -20
# ожидаем prom-формат, не пусто
```

Если backend не поднимается — проверить, что `docker compose -f docker-compose.dev.yml up -d` запущен (Postgres+pgvector :55435, Redis :56381, MinIO :59000/:59001).

### 1.6 Базовый smoke ключа DeepSeek

```bash
cd backend
bun run scripts/eval/smoke-deepseek.ts
# ожидаем «✓ OK», один токен в ответе, не ошибку.
```

Если 401/403 — ключ невалиден; миграцию **не запускать** до выяснения.

## §2. Прогон smoke 28 агентов

### 2.1 Список 28 taskType (взят из `backend/test/eval/smoke-all-agents/SUMMARY-SMOKE.md`)

Батч 1 (knowledge-core, базовый граф):
1. `axis-classify`
2. `block-distill` (промпт вынесен в Фазе 8 в `prompts/block-distill.prompt.ts`)
3. `block-linker` (промпт вынесен в Фазе 8 в `prompts/block-linker.prompt.ts`)
4. `card-rollup-v2`
5. `decision-supersede-detect`
6. `insight-link-to-decisions`
7. `idea-cluster-merge`

Батч 2 (process / clone / skill):
8. `idea-status-summarize`
9. `regulation-dedupe`
10. `process-steps-extract`
11. `process-template-extract`
12. `knowledge-clone-merge`
13. `skill-trait-concept-name`
14. `skill-trait-merge`

Батч 3 (chat-v2 / clone-respond / dashboard):
15. `chat-v2-conversation-title`
16. `chat-v2-synthesize`
17. `clone-respond`
18. `concierge-respond` (частичный smoke без tool-execution loop)
19. `probe-formulate`
20. `goal-alignment`
21. `executable-persona-compile`

Батч 4 (cron / digest / арбитры):
22. `reframing` (промпт вынесен в Фазе 8 в `prompts/reframing.prompt.ts`)
23. `theme-classify` (промпт вынесен в Фазе 8 в `prompts/theme-classify.prompt.ts`)
24. `role-profile-build` (`maxTokens=16000` после Фазы 3)
25. `recognition-formulate`
26. `dashboard-summary`
27. `daily-digest`
28. `entity-merge-arbiter` (промпт вынесен в Фазе 8 в `prompts/entity-merge-arbiter.prompt.ts`)

Все 28 файлов уже существуют в `backend/scripts/eval/smoke-<taskType>.ts`.

### 2.2 Скрипт-обёртка `backend/scripts/eval/run-all-smoke.sh`

**Создаётся реализующим (псевдокод):**

- shebang `#!/usr/bin/env bash`, `set -euo pipefail`.
- Массив TASKS из 28 имён выше.
- Цикл `for t in "${TASKS[@]}"; do bun run scripts/eval/smoke-$t.ts || echo "FAIL: $t"; done` — **не падать** на первой ошибке, чтобы пройти все 28 и собрать полный отчёт. Падение фиксируется как «FAIL: <name>» в stdout + поле `error` в `reports/<taskType>.json`.
- В начале — `printf` заголовок «=== Run-all-smoke %s ===\n» `date -Iseconds` и проверка `DEEPSEEK_API_KEY`.
- В конце — сводный счётчик `OK / FAIL` через grep по `reports/*.json` (`ranSuccessfully: true`).
- Альтернативно — `.ts`-обёртка (если bash-зависимости проблема на Windows / WSL). Один из двух вариантов на выбор реализующего.

Запуск:
```bash
cd backend
bash scripts/eval/run-all-smoke.sh
# или (если .ts-обёртка):
bun run scripts/eval/run-all-smoke.ts
```

### 2.3 Параллельность

**Последовательно.** Параллельный прогон 28 запросов через единый DeepSeek-ключ — риск hit rate-limit (DeepSeek proxy у нас один). Время = сумма latency, ~8-15 минут на полный прогон (см. §2.4).

### 2.5 Integration-smoke через `LlmRouterService` (`smoke-chat-v2-via-router.ts`)

**Решение принято 2026-05-26**: дополнительно к 28 lightweight smoke'ам — адаптировать **один** smoke под полный routing-стек, чтобы реально проверить применение миграции на уровне backend и убедиться что метрика `z_llm_thinking_model_guard_total` действительно капает в проде/dev.

**Выбор taskType**: `chat-v2-synthesize` — у него Pro + tools + thinking, идеально покрывает автоконвертацию `json_schema → tools` из Фазы 1 (коммит `92aec84`).

**Что делает** (псевдокод):

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { LlmRouterService } from '../../src/modules/ai/services/llm-router.service';
import { ChatV2SynthesizePromptService } from '../../src/modules/chat-v2/prompts/chat-v2-synthesize.prompt';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const router = app.get(LlmRouterService);
    const promptSvc = app.get(ChatV2SynthesizePromptService);

    const { systemPrompt, userMessage, tools } = promptSvc.buildPrompt({ /* mock context */ });
    const start = Date.now();
    const result = await router.call({
      taskType: 'chat-v2-synthesize',
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      tools,
      maxTokens: 4000,
    });
    const ms = Date.now() - start;

    // Сохранить отчёт в backend/test/eval/smoke-all-agents/reports/chat-v2-synthesize-via-router.json:
    // { taskType, modelUsed, ms, costUsd, tokensIn, tokensOut, ranSuccessfully, toolCallsCount }

    console.log(`OK chat-v2-synthesize via router: ${result.modelUsed} ${ms}ms`);
  } finally {
    await app.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

**Запуск**: `cd backend && bun run scripts/eval/smoke-chat-v2-via-router.ts`.

**Что проверить ПОСЛЕ запуска** (в дополнение к §4 ниже):
- `curl http://localhost:3000/metrics | grep 'z_llm_thinking_model_guard_total{kind="schema-to-tool"'` — должен быть `>= 1` (Фаза 1 автоконверт сработал).
- В логах backend'а — запись `[LlmRouterService] resolved chat-v2-synthesize → deepseek-v4-pro` (проверка что routing-конфиг из БД подтянулся).

**Не блокирует основной прогон 28** — запускается отдельно после, как контрольный.

### 2.4 Ожидаемая стоимость и время

Из `SUMMARY-SMOKE.md` 2026-05-25:
- **Цена**: ~$0.036 на полный прогон 28 фикстур (DeepSeek-Pro со скидкой 75% — $0.435/M input, $0.87/M output). После миграции должно остаться **примерно столько же** или ниже.
- **Время**: сумма по `ms` из 28 reports — ~9-12 минут (медианный вызов 10-20 секунд из-за thinking-overhead; `role-profile-build` и `executable-persona-compile` доходят до 60 секунд).

## §3. Сверка с предыдущим SUMMARY

### 3.1 Чек-лист по каждому из 28 агентов

После прогона составить таблицу (формат — копия таблицы из `SUMMARY-SMOKE.md`, добавить колонку «Δ от 2026-05-25»):

| # | taskType | Статус | Цена сейчас | Цена 25.05 | Δ цена | Время сейчас | Время 25.05 | Δ время | Заметка |
|---|---|---|---|---|---|---|---|---|---|

Статусы:
- **OK** — `ranSuccessfully: true`, валидный tool_call или содержательный текст.
- **WARN** — `ranSuccessfully: true`, но цена выросла ≥ 2× или время выросло ≥ 2× — отдельно подсветить.
- **FAIL** — `ranSuccessfully: false` или 400/500 в `error`.

### 3.2 Ожидания

- **Цена** — должна остаться **примерно той же** (±20%) или ниже. Если ↑ ≥ 50% по какому-то агенту — расследовать (фикстура изменилась? промпт в Фазе 8 случайно стал длиннее при выносе? кэш не работает).
- **Время** — может уменьшиться (Pro быстрее Flash в thinking-задачах) или вырасти (если был на ollama qwen3.5:9b локальный → теперь thinking-overhead). Не критично, если в SLA.
- **5 промптов, вынесенных в Фазе 8** (`block-distill`, `block-linker`, `theme-classify`, `reframing`, `entity-merge-arbiter`) — побайтово равны прежним (гарантировано 14 snapshot-тестами в `prompts/*.snapshot.spec.ts`). В smoke важна **семантика** — не упало ли с 400/500, выдало ли валидный tool_call.

### 3.3 Критерий «миграция подтверждена»

- **≥ 26/28 OK** (допуск на 1-2 транзитивных falke).
- **Цена ≤ $0.05 на полный прогон** (запас 40% от 0.036).
- **0 FAIL** с кодом 400 (Thinking mode does not support...) — если есть, значит автоконвертация в `DeepSeekService.buildParams` пропустила какой-то путь (см. §4).

## §4. Метрики после прогона

После полного прогона (НЕ перезагружая backend — счётчики prom-client живут в памяти процесса):

```bash
# 4.1 Главная метрика верификации Фазы 1:
curl -s http://localhost:3000/metrics | grep z_llm_thinking_model_guard_total
# Ожидаем минимум:
#   z_llm_thinking_model_guard_total{kind="schema-to-tool",model="deepseek-v4-pro"} N
# где N > 0 — каждый caller, который передавал json_schema, должен был сконвертироваться в tool.
# Опционально: kind="strict-stripped" (если кто-то передавал strict вместе с tools)
# и kind="tool-choice-relaxed" (если кто-то передавал forced tool_choice).
```

```bash
# 4.2 Раскладка токенов по taskType:
curl -s http://localhost:3000/metrics | grep core_llm_tokens_total
# Ожидаем ~28 строк (по одной на taskType), tenant="" для smoke-прогона без orgId.
# Цифры должны бить отчёты в reports/*.json (tokensIn+tokensOut суммарно).
```

```bash
# 4.3 Связанные метрики автоконвертации (старая, более узкая, оставлена для совместимости):
curl -s http://localhost:3000/metrics | grep z_deepseek_schema_to_tool_conversion_total
# Должна совпадать с z_llm_thinking_model_guard_total{kind="schema-to-tool"}
# для модели deepseek-v4-pro.
```

```bash
# 4.4 Общая раскладка LLM-вызовов:
curl -s http://localhost:3000/metrics | grep -E 'z_llm_(calls|errors|latency)_total'
# z_llm_errors_total для модели deepseek-v4-pro должно быть 0 (или близко к 0).
```

```bash
# 4.5 Снимок всех релевантных метрик одним заходом (если хочется приложить к отчёту):
curl -s http://localhost:3000/metrics | grep -E '^(z_llm_|z_deepseek_|core_llm_)' | sort > /tmp/metrics-after-smoke.txt
```

**Важно — smoke-скрипты `backend/scripts/eval/smoke-*.ts` ходят НЕ через `LlmRouterService`, а напрямую через `openai`-клиент.** Поэтому метрики `z_llm_*` от этих скриптов **не вырастут**. Они вырастут только если smoke пойдёт через **HTTP-эндпоинт backend'а** или если воркер обработает реальную фоновую задачу.

**Действие реализующего:** если хочется реально проверить метрику `z_llm_thinking_model_guard_total`, нужно либо:
1. Дёрнуть руками HTTP-эндпоинт, который вызывает соответствующий taskType через `LlmRouterService` (например, POST /api/v1/chat-v2/messages для проверки chat-v2-* подсистемы).
2. Или временно адаптировать один smoke-скрипт (напр. `smoke-axis-classify.ts`) — вместо прямого `client.chat.completions.create` вызвать `LlmRouterService.call({ taskType: 'axis-classify', ... })` через инициализированный `NestApplicationContext`. **Это дополнительная работа за рамками базового smoke-чек-листа** — см. §7 открытые вопросы.

**Для базового критерия успеха `z_llm_thinking_model_guard_total > 0`** достаточно одного факта вызова, проходящего через DeepSeekService с json_schema → реальный путь продакшна. Один любой HTTP-вызов чата компании из браузера (`/chat` или /api/v1/chat-v2/...) на dev-backend'е после применения seed'ов даст инкремент.

## §5. Откатной скрипт `backend/scripts/patch-rollback-to-deepseek-flash.ts`

### 5.1 Зачем

Если **3 или более** агентов из 28 падают 400/500 в smoke после миграции — массовый откат на `deepseek-v4-flash` (старая модель) для пострадавших taskType, **без ручного редактирования** seed'ов и без `git revert`. Скрипт готовится **заранее**, на случай аварии.

### 5.2 Алгоритм (псевдокод, реализующий пишет код)

```
const NEW_MODEL  = 'deepseek-v4-flash';  // куда откатываем
const OLD_MODEL  = 'deepseek-v4-pro';    // от чего откатываем
const PROVIDER   = 'deepseek';

// Список taskType, которые миграция Фазы 4 / patch-mass-migrate переключила.
// Скопировать ОДИН-В-ОДИН из patch-mass-migrate-to-deepseek-pro.ts TARGETS[].
// Это:
const ROLLBACK_TARGETS = [
  // Merge / arbiter:
  'regulation-dedupe', 'decision-supersede-detect', 'entity-merge-arbiter',
  'knowledge-clone-merge', 'idea-cluster-merge', 'skill-trait-merge',
  'helpfulness-trait-merge', 'insight-link-to-decisions',
  'experiment-summarize-lessons',
  // Cron:
  'reframing', 'theme-classify', 'idea-status-summarize',
  'skill-trait-concept-name', 'role-profile-build',
  // Formulate:
  'probe-formulate', 'recognition-formulate', 'proactive-message-craft',
  // Chat helpers:
  'chat-v2-conversation-title',
  // Rollup:
  'card-rollup-v2',
  // Classifier:
  'axis-classify',
];

// Дополнительно (Фаза 4 chat-v2 / dialog-layer / clone-v2 / specialists-combined):
const EXTRA_TARGETS = [
  'chat-v2',
  'dialog-contextualize', 'dialog-confidence', 'dialog-classify',
  'dialog-multi-query', 'dialog-summarize',
  // clone-v2 (под флагом CLONE_V2_ENABLED — если v2 не использовался в smoke, можно не откатывать):
  // 'clone-respond-v2',
  // specialists-combined (под флагом SPECIALISTS_COMBINED_ENABLED):
  // 'knowledge-specialists-combined',
];

for (const taskType of [...ROLLBACK_TARGETS, ...EXTRA_TARGETS]) {
  // Логика — зеркальная patch-mass-migrate, но в обратную сторону:
  const routes = await prisma.llmTaskRoute.findMany({ where: { taskType, tenantId: null } });
  for (const r of routes) {
    if (r.editedByAdmin) { skip; continue; }  // не трогать админ-правки
    if (r.tier === 'primary' && r.providerName === PROVIDER && r.model === OLD_MODEL) {
      // update model → NEW_MODEL
    }
    // Legacy: r.tier === null && r.providers != null
    //   найти первый deepseek-провайдер в массиве, заменить model: pro → flash
  }
}
```

### 5.3 Параметры запуска (тот же стиль, что и `patch-mass-migrate-*`)

```bash
bun run scripts/patch-rollback-to-deepseek-flash.ts --dry-run
bun run scripts/patch-rollback-to-deepseek-flash.ts --update-existing
```

### 5.4 Идемпотентность

- Можно запускать повторно. Если все целевые записи уже `model=deepseek-v4-flash` — выводит `[ok] уже на flash` для каждой и завершается с `updated=0`.
- `editedByAdmin=true` — пропускается всегда (если админ вернул кому-то Pro вручную после rollback — оставить).
- Не создаёт новые записи, только обновляет существующие.

### 5.5 Когда запускать

- **Хирургически (1-2 пострадавших агента)**: НЕ нужен скрипт — точечный SQL `UPDATE` или `prisma studio` хватит.
- **Массово (3+ пострадавших, тот же тип ошибки)**: rollback всем сразу.
- **Полный откат (10+ пострадавших или системная ошибка типа «весь Pro-endpoint лёг»)**: запустить с `--update-existing` без обсуждений.

### 5.6 Что делать после rollback

1. Зафиксировать инцидент в `second-brain/05_история/<дата>-llm-rollback-from-pro.md`.
2. Прогнать `run-all-smoke.sh` повторно — убедиться что 28/28 OK (так как до миграции было).
3. Расследовать корневую причину (новый таргет в `patch-mass-migrate` оказался не safe? cron `executable-persona-build` поедает >16000 токенов? API изменилось?) — обновить ТЗ-копилку §10.

## §6. Обновление SUMMARY-SMOKE

### 6.1 Файл

Создать **новый файл** `backend/test/eval/smoke-all-agents/SUMMARY-SMOKE-2.md` (не перезаписывать прежний — он остаётся как baseline для сравнения). После следующей миграции — будет `SUMMARY-SMOKE-3.md` и т.д.

### 6.2 Структура нового отчёта (на основе SUMMARY-SMOKE.md)

```
# Smoke-тесты всех LLM-агентов проекта Z — v2

Дата: <дата прогона>
Модель: deepseek-v4-pro
Версия миграции: Фазы 0-8 (коммиты 5921a20..cad4aef)
Цель: верификация применения миграции на dev-БД (см. plans/tz/2026-05-26-llm-migration-smoke-checklist.md).
Предыдущий: SUMMARY-SMOKE.md (2026-05-25, до миграции).

## TL;DR
N/28 OK | M FAIL | $X.XX суммарно | Y минут.

## Что изменилось vs 2026-05-25
- ...

## Сводная таблица (с Δ-колонками)
| # | taskType | OK сейчас | Цена сейчас | Цена 25.05 | Δ цена | Время сейчас | Время 25.05 | Δ время | Заметка |
| ... |

## Метрики после прогона
- z_llm_thinking_model_guard_total{kind="schema-to-tool"} = N (см. §4)
- core_llm_tokens_total суммарно = N токенов
- z_llm_errors_total{model="deepseek-v4-pro"} = N

## Системные находки (если есть)
- ...

## Финальный вывод
- ...
```

### 6.3 Что обязательно должно быть

- Дата + версия миграции + ссылка на этот ТЗ.
- Таблица сравнений (до / после: модель, цена, время, статус) — по каждому из 28.
- Снимок метрик `z_llm_thinking_model_guard_total`, `core_llm_tokens_total`, `z_llm_errors_total` — приложить как блок кода (cat /tmp/metrics-after-smoke.txt).
- Список аномалий (если есть `WARN` или `FAIL`).
- Финальный вывод: «миграция подтверждена» / «откат запущен» / «требуется ручное расследование <такого-то агента>».

## §7. Открытые вопросы

1. ~~Метрика `z_llm_thinking_model_guard_total` через прямой smoke ↔ через LlmRouter.~~ **ЗАКРЫТО 2026-05-26**: выбран вариант (b) — `smoke-chat-v2-via-router.ts` через `NestApplicationContext + LlmRouterService` (детали в §2.5). Один integration-smoke + 28 lightweight = достаточное покрытие.

2. **CLONE_V2_ENABLED / SPECIALISTS_COMBINED_ENABLED.** Эти флаги дефолтно `false`. В smoke 28 они **не задействованы** (smoke вызывает старые taskType `clone-respond` и индивидуальных специалистов 3-1..3-9). Соответственно `clone-respond-v2` и `knowledge-specialists-combined` в rollback-скрипте закомментированы — но если в момент прогона флаги включают для пилота, нужно их тоже верифицировать отдельно (это **не** часть базового чек-листа).

3. **`meeting-report-fast`** — закрыт параллельной сессией ранее (Фаза 5), но в smoke 28 его нет (не было и в первом прогоне 25.05 — он покрыт эксперимент.1 sales-merge). Если хочется добавить — реализующий может проактивно завести `smoke-meeting-report-fast.ts` по образцу `smoke-axis-classify.ts`. Не блокирует критерий «миграция подтверждена».

4. **Сценарий «прогон против prod-БД».** Решение пользователя — **НЕТ**, только dev. Если кто-то всё же захочет верифицировать прод — отдельный ТЗ с теми же шагами, но с read-only БД-подключением и **без** seed-команд (на проде они уже применяются по своей прод-инструкции, см. рефлексию).
