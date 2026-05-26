---
type: history
date: 2026-05-26
phase: KC-Temporal доделки — Prometheus alerts + 2 admin-страницы (W2.3/G.2)
distilled: false
---

# Рефлексия — закрытие 2 из 5 доделок KC-Temporal v3 (alerts + admin UI)

## Что было поставлено

Пользователь принёс список из 5 «доделок» по итогам KC-Temporal v3 + Clones=Roles
(см. `2026-05-25-kc-temporal-and-clones-roles-implementation.md` §«Не реализовано»):

1. Две admin-страницы (`/admin/llm/preference-dataset`, `/admin/llm/signal-type-monitor`)
2. Prometheus alerts (3 правила)
3. Golden-set: разметка 50 встреч
4. Кнопка «Обновить клона роли»
5. Профильные second-brain файлы

Запрос: оценить, что из этого безопасно делать СЕЙЧАС, не задевая параллельные сессии,
и сделать «безопасное окно». После моего анализа пользователь подтвердил — делаем
пункты 1 и 2.

## Как решал

### Параллельная сессия — постоянный фон

На старте сессии в `origin/dev` было ~30 коммитов за 6 часов от другой Claude-сессии
(feedback module, admin-settings миграция, conversational/MaxApiClient, tracker
similar-issues). За время работы (≈2 часа) параллельная сессия запушила ещё **5 коммитов**:
`d50f0e3`, `b2d0611`, `12afde8`, `5cf6198`, `46af33d`, `f897d99`, `cad4aef`, `dc7550c`.
Среди них — `cad4aef refactor(knowledge-core)` (вынос embedded-промптов), но
`preference-dataset.service.ts` она не задела — повезло.

Ключевой момент: **обе сессии работают в одной рабочей копии git**. Это видно по
`git reflog` — HEAD моноклонно двигается, между моими собственными commit'ами
вклинены чужие. Это объясняет, почему `git fetch && git log origin/dev` показывает
коммиты, которых я не делал — они уже в моём локальном HEAD через auto-pull.

Защита: перед каждым ключевым действием (Edit `admin.module.ts`, `git add`,
`git commit`) делал `git fetch` + `git status --short` + `git diff --cached --name-only`.
Index был пуст всё время — параллельная сессия делает атомарные add+commit.

### Анализ scope каждого пункта по матрице «риск конфликта»

| # | Что | Конфликт | Решение |
|---|---|---|---|
| 1 | 2 admin-страницы | Низкий (новые файлы) | Делаем |
| 2 | Prometheus alerts | Нулевой | Делаем |
| 3 | Golden-set 50 встреч | — | Не моя задача, нужны транскрипты + человек |
| 4 | Кнопка rebuild клона | Низкий | Не делаем по решению пользователя — без явной потребности |
| 5 | second-brain sync | **Высокий** | Откладываем — параллельная сессия правит те же файлы |

### Реализация

**Alerts** (полностью изолированы):
- Создан `infra/grafana/alerts/kc-temporal-alerts.yml` с 3 группами правил.
- Стиль скопирован с `ai-pipeline-alerts.yml` (labels component+team, summary+description с шаблонами `{{ $value | humanizePercentage }}`).
- Нюанс с `FactSupersedeCostSpike`: ENV `FACT_SUPERSEDE_COST_ALERT_PCT=5%` не читается Prometheus runtime'ом NestJS — порог захардкожен в `expr` с комментарием «синхронизируй при правке env.schema.ts:659».
- Нюанс с `SignalTypeDistributionDrift`: subquery `[30d:1h]` (gauge обновляется раз в сутки cron'ом), `clamp_min(_, 50)` защищает от шума на редких типах (дрейф «5 vs 2 блоков» — не сигнал).

**Backend preference-dataset** — расширение существующего модуля:
- `PreferenceDatasetService.listItems(args)` — массив (вместо строки JSONL), дефолтный лимит 200 для UI.
- `PreferenceDatasetService.stats({from, to})` — один `groupBy(taskType, label)`, мапит в `{total, byLabel, byTaskType[]}`.
- `LlmPreferenceDatasetController` — добавлены `GET /items` и `GET /stats`. JSONL-download `GET /` оставлен — для curl/offline-retraining.
- Контроллер уже зарегистрирован в `admin.module.ts` — правка не нужна.

**Backend signal-type-monitor** — новый модуль:
- `signal-type-monitor.service.ts` — `prisma.adminSetting.findMany({ where: { key: { startsWith: 'signal_type_transition_matrix:' } } })`, потом dedup-`org.findMany` для имён.
- `signal-type-monitor.controller.ts` — `GET /` (все Org) и `GET /:tenantId`. Guards/interceptors как у `LlmPreferenceDatasetController`.
- `admin.module.ts` — 3 правки: import (2 строки), controllers (+SignalTypeMonitorController), providers (+SignalTypeMonitorService).

**Frontend** — слоистая модель ApiDto → DomainModel → UiModel:
- 2 api-клиента в `src/api/`, 2 domain-mappers в `src/domain/`.
- Страницы в `frontend/app/(authenticated)/admin/ai/` (новая структура admin, не legacy `/admin/llm/*` — там redirect на `/admin/ai/catalog`).
- `preference-dataset/PreferenceDatasetClient.tsx`: сводка (счётчики по label + матрица taskType×label) + фильтры (taskType/label/диапазон/лимит) + таблица (200 последних) + кнопка JSONL-download. `useAdminQuery` (не SWR — стиль админки).
- `signal-type-monitor/SignalTypeMonitorClient.tsx`: селектор Org → распределение за 7 дней (horizontal bar chart на чистом CSS) + heatmap матрицы переходов (rgba цвет по интенсивности относительно max). Без сторонних chart-библиотек.
- `navigation.ts` — 2 пункта в категорию «AI и модели» (иконки `Inbox`, `LineChart` — уже импортированы).

## Что вышло

### Коммит

`2e8b04c feat(admin): UI и Prometheus alerts для KC-Temporal W2.3/G.2`
- 15 файлов, +1249 / −17.

### Verification

- Backend `bun run typecheck`: PASS (exit 0).
- Frontend `bun run typecheck`: PASS (после фикса Badge variant `destructive` → `danger` — в Z свой набор вариантов, не shadcn-дефолт).
- UI в браузере не запускал — это требует поднятого dev-стека (backend + frontend + Postgres + Redis), что не было предметом задачи.

### Метрики реализации

- 1 backend-модуль (`signal-type-monitor`): 2 файла.
- 1 backend-сервис расширен (`PreferenceDatasetService`): +2 метода (`listItems`, `stats`).
- 1 контроллер расширен (`LlmPreferenceDatasetController`): +2 endpoint'а (`GET /items`, `GET /stats`).
- 1 правка `admin.module.ts`: +2 import + 1 controller + 1 provider.
- 4 frontend файла слоя api/domain.
- 2 frontend admin-страницы (page + Client).
- 1 правка `navigation.ts`.
- 1 Prometheus rules yaml (3 alert rules).

### Не реализовано (умышленно)

- Golden-set 50 встреч — нужны реальные транскрипты + человек, не код.
- Кнопка rebuild клона роли — без явной потребности.
- Sync профильных second-brain файлов — параллельная сессия их сейчас правит, риск конфликта.
- UI не тестировал в браузере — оператор должен сделать smoke вручную.

## Чему научился

1. **Reflog — лучший способ понять, что происходит при параллельных сессиях.**
   `git reflog --date=iso` показал, что обе сессии пишут в один git, и мой HEAD
   двигается «за чужими» commit'ами автоматически. Знал бы заранее — меньше
   паниковал, когда `merge-base HEAD origin/dev` показал свежий хеш.
2. **Badge variants в Z ≠ shadcn-дефолт.** В Z набор `default | secondary | outline |
   success | warning | danger`. Поймал TS-ошибку на `'destructive'` — стандартное
   значение shadcn, которое тут отсутствует. Стоит зафиксировать в code-pitfalls.
3. **`/admin/llm/*` устарел — новая структура `/admin/ai/*`.** `models` и `providers`
   стоят как redirect → `/admin/ai/catalog`. При планировании новых admin-страниц
   с старыми URL из ТЗ — проверять текущую `navigation.ts`, иначе пользователь
   получит ссылку на «ничего».
4. **Параллельные сессии в shared dev — норма продуктивной разработки.**
   За 2 часа моей работы — 5 чужих коммитов. Защита: `git fetch` перед каждым
   важным действием, `git diff --cached --name-only` перед commit, явный список
   путей в `git add`.
5. **Безопасное окно vs всё-или-ничего.** Изначальная стратегия «не делать ничего
   из 5 пунктов» (свой совет в анализе) была слишком осторожной. Точечно 2 из 5
   оказались безопасными — сделал. 3 оставшихся объективно требуют либо ручной
   работы (golden-set), либо новой сессии (second-brain sync).

## Прод-инструкция (для запуска на проде)

```bash
# 1. Перезапуск backend (новые endpoints + регистрация SignalTypeMonitor модуля).
docker compose up -d --build backend

# 2. Перезапуск frontend (новые admin-страницы и navigation).
docker compose up -d --build frontend

# 3. Prometheus — подхватить новые alert rules. Файл уже монтируется через
#    rule_files: /etc/prometheus/alerts/*.yml. Если /etc/prometheus/alerts/
#    — это volume, мапленный на infra/grafana/alerts/, то достаточно reload:
docker compose -f infra/livekit/docker-compose.yml exec prometheus kill -HUP 1
# или (если другая схема): полный restart prometheus.

# 4. Smoke-тесты:
# - GET /api/v1/admin/llm/preference-dataset/stats              → { total, byLabel, byTaskType }
# - GET /api/v1/admin/llm/preference-dataset/items?limit=5      → { items: [...] }
# - GET /api/v1/admin/llm/signal-type-monitor                   → { items: [...] }
# - открыть /admin/ai/preference-dataset (super_admin)
# - открыть /admin/ai/signal-type-monitor (super_admin)
# - открыть http://prometheus:9090/alerts — должны появиться 3 новых правила
#   (KcDataClassViolationBlocked, FactSupersedeCostSpike, SignalTypeDistributionDrift)
#   в state Inactive (если триггеров нет).
```

Никаких миграций БД и нечего в `.env` — все изменения только в коде.

## TODO на следующую сессию

1. **Sync профильных second-brain** (когда параллельная сессия успокоится):
   - `02_architecture/module-map.md` — добавить `SignalTypeMonitorService/Controller`.
   - `01_projects/api-layer.md` — 4 новых endpoint'а
     (`GET /api/v1/admin/llm/preference-dataset/items` и `/stats`,
     `GET /api/v1/admin/llm/signal-type-monitor` и `/:tenantId`).
   - `01_projects/admin.md` — 2 новые admin-страницы.
   - Чек-лист производных заметок из рефлексии `2026-05-25-kc-temporal-and-clones-roles-implementation.md` всё ещё актуален — также нужно пройти.
2. **Кнопка rebuild клона роли** (пункт 4) — когда возникнет реальная потребность
   «срочно пересобрать клон для отладки».

## Связанные файлы

- `2e8b04c` — feat-commit (15 файлов).
- `2026-05-25-kc-temporal-and-clones-roles-implementation.md` — источник списка доделок.
- `plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md` (W2.3 §, G.2 §, W4.3 §).
- `docs/policies/outbound-gating-runbook.md` — runbook для `KcDataClassViolationBlocked`.
