# A/B моделей извлечения и детерминированный replay задач (диагностика)

Два диагностических harness'а из разбора «задачи со встречи не доходят до трекера» (2026-06-22).
Оба — read-only/локальные, в STEPS не входят, на проде ничего не пишут.

## 1. `backend/scripts/replay-task-chain.ts` — детерминированный replay гейта/триажа

Прогоняет 7 реальных задач эталонной встречи `01KVQDR2Y…` через **настоящий** `shouldMaterializeTask`
и сравнивает текущую логику с фиксом A2 (промоут встречи в Issue всегда).

```bash
docker compose exec backend bun run scripts/replay-task-chain.ts
# Ожидаемо: текущая=0 Issue, фикс=7 Issue → PASS ✅
```

Это регрессионный инвариант фикса A2: пока `текущая=0 И фикс=7`, корень (фильтр 4 авто-триажа) закрыт.
`exit 1` если инвариант сломан.

## 2. `backend/scripts/ab-extract-model.ts` — A/B моделей на захваченном промпте

Сравнивает модели (по умолчанию `deepseek-v4-flash` ↔ `deepseek-v4-pro`) на РЕАЛЬНОМ промпте
`meeting-extract-actions`, захваченном из прод-журнала: validJSON-rate, число задач, задачи с исполнителем,
токены, латентность. Доказательная база для фазы E (перевод извлечения на Pro).

### Шаг 1 — захватить промпт встречи (полнее с G4)
`requestPreview` хранится усечённым; лимит — крутилка `ai.usageLog.previewMaxBytes` (дефолт после G4 = 32 КиБ).
Для воспроизводимого прогона на полном промпте подними её перед целевой встречей:

```bash
# поднять лимит хранения превью (super_admin) — иначе захваченный промпт обрезан
docker compose exec backend bun run scripts/diag.ts call <usageLogId> --json > ab-extract-call.json
# файл должен содержать requestPreview с маркерами [SYSTEM] … [USER] …
```

### Шаг 2 — направить harness на БОЕВОЙ deepseek-эндпоинт
Локально `deepseek-v4-flash/pro` недоступны: прокси `proxy.agent-lia.ru/v1` отдаёт только OpenAI-модели,
а `DEEPSEEK_BASE_URL` в локальном `.env` не задан. Поэтому для A/B именно flash↔pro harness направляют
на прод-эндпоинт deepseek (креды — из прод-`.env`, по подтверждению владельца):

```bash
AB_BASE_URL="$DEEPSEEK_BASE_URL" \
AB_API_KEY="$DEEPSEEK_API_KEY" \
AB_MODELS="deepseek-v4-flash,deepseek-v4-pro" \
AB_PROMPT_FILE=ab-extract-call.json \
AB_REPEATS=3 \
docker compose exec backend bun run scripts/ab-extract-model.ts
```

Если боевой deepseek недоступен — A/B можно гонять на достижимых OpenAI-моделях (они же реальные
fallback'и этих taskType): `AB_BASE_URL=https://proxy.agent-lia.ru/v1`, `PROXY_PREFIX`+`OPENAI_API_KEY`,
`AB_MODELS="gpt-4o-mini,gpt-4.1"`. Это сравнение cheap↔capable, не flash↔pro.

### Переменные окружения
| Переменная | Дефолт | Назначение |
|---|---|---|
| `AB_BASE_URL` | `https://proxy.agent-lia.ru/v1` | endpoint OpenAI-совместимого API; для flash↔pro = `DEEPSEEK_BASE_URL` |
| `AB_API_KEY` | `PROXY_PREFIX:OPENAI_API_KEY` → `DEEPSEEK_API_KEY` | ключ |
| `AB_MODELS` | `deepseek-v4-flash,deepseek-v4-pro` | список моделей через запятую |
| `AB_PROMPT_FILE` | `ab-extract-call.json` | JSON с `requestPreview` |
| `AB_REPEATS` | `3` | прогонов на модель (разброс) |

**Вывод по E (доказано):** разница не в количестве задач, а в надёжности structured-вывода — Flash сыпет
invalid-JSON и валит fallback; Pro проходит чисто. Симптом «задач нет» лечит A2 (авто-триаж), не модель.
