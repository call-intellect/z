---
type: tz
status: ready
feature: β-8.1 — Добивка панели операционного директора (настроение чек-инов + недельная сводка)
phase: beta-8.1
date: 2026-05-24
parent: plans/tz/2026-05-23-sba-beta-8-personal-relation-coo-checkin.md
related:
  - plans/analysis/2026-05-22-coo-dashboard-and-checkins.md §2.4 виджеты дашборда
  - plans/analysis/2026-05-23-ai-coo-readiness-analysis.md §M1 sentiment + weekly digest
  - backend/src/modules/operations/services/daily-checkin.service.ts
  - backend/src/modules/operations/services/operations-dashboard.service.ts
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 100%.**
> Реализовано полностью и подтверждено кодом: схема (4 поля DailyCheckIn + модель WeeklyOperationsDigest + индексы), воркер настроения, недельный cron с идемпотентностью и доставкой, сервис дайджеста, оба контроллера и три
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# SBA β-8.1 — Добивка панели операционного директора

## 1. Цель и контекст

В исследовании от 22 мая (§2.4 виджеты панели) и в анализе готовности от 23 мая (§M1) были зафиксированы две идеи, не попавшие в основное ТЗ β-8, но критичные для полноты функции контроля:

1. **Автоматическое определение настроения чек-ина** — языковая модель смотрит текст вечернего ответа сотрудника и помечает запись цветом (зелёный / жёлтый / красный). Сотрудник кнопкой не выбирает — определяется по тексту.
2. **Недельная сводка для операционного директора** — раз в неделю по понедельникам утром собирается дайджест: что системно болит за прошлую неделю, какие повторяющиеся блокеры, температура команды, незакрытые цели.

Обе фичи — над уже работающим модулем `operations/` (β-8 done), без новых архитектурных слоёв.

## 2. Scope

**Входит:**
- Новое поле `sentiment` в модели `DailyCheckIn` (`green | yellow | red | null`).
- Поле `sentimentRationale` — короткое обоснование от языковой модели (для прозрачности).
- Доработка `CheckinParserService` — добавляет анализ настроения параллельно с разбором на плановые/сделанные/блокеры.
- Новый тип задачи языковой модели: `checkin-sentiment`.
- RBAC-разделение: поле `sentiment` отдаётся только ролям `coo`, `owner`, `admin`. Сотруднику в своём ответе через `/me/check-ins` поле скрыто.
- Новый виджет на панели `/dashboard/operations` — «Температура команды»: агрегат по последним 7 дням, столбики по людям/командам, динамика.
- Новый расписанный сборщик: `operations-weekly-digest.cron` — запускается по понедельникам в 08:00 локального времени каждого `Org`.
- Новая модель `WeeklyOperationsDigest` — хранит готовый дайджест с провенансом (откуда что взяли).
- Новый эндпоинт `GET /api/v1/dashboard/operations/weekly-digest?weekStart=YYYY-MM-DD` — отдаёт последний дайджест или строит на лету.
- Новая страница `/dashboard/operations/weekly` — рендерит дайджест с виджетами.
- Доставка дайджеста через `ConversationalService.sendNotification(eventType='operations.weekly_digest')` — операционному директору и владельцу в их предпочитаемый канал.

**Не входит:**
- Хранитель обещаний → отдельное ТЗ β-8.2.
- Виджет «карта общения в команде» (отклонён в обзоре 2026-05-24).
- Точечные периодические опросы (отклонены).
- Дашборды для линейных сотрудников.

## 3. Принятые решения

1. **Настроение определяет языковая модель, без кнопок сотруднику.** Кнопки выбора цвета сотрудник не видит вообще.
2. **Видимость настроения — только три роли:** `coo`, `owner`, `admin`. На `/me/check-ins` поле скрыто из ответа.
3. **Время недельной сводки** — понедельник 08:00 локального времени `Org`. Часовой пояс — из настройки `Org.timezone` (если нет — `Europe/Moscow`). Если уже была сгенерирована за эту неделю — повторно не пересчитываем (идемпотентность по `weekStart + tenantId`).
4. **Источники для дайджеста** — за последние 7 дней:
   - чек-ины: средний по дням процент «зелёных», топ-3 «красных» сотрудников/команд (только инициалы и роль, не персональные подробности в письме);
   - блокеры: топ-5 повторяющихся по `signalType='blocker'`;
   - инсайты: топ-3 по динамике из `β-4 Insights Radar`;
   - цели: количество завершённых / проваленных / в работе с динамикой против прошлой недели;
   - решения: незакрытые `Decision.status='active'` старше 7 дней без `actualOutcomes`.
5. **Дайджест строится в две стадии:** сначала агрегация сырых данных (быстро, на стороне базы), потом одно обращение к языковой модели — собрать связный текст комментария.
6. **Кеш дайджеста** — записанная модель `WeeklyOperationsDigest` хранится навсегда (история), `Redis` не используется.
7. **Анализ настроения чек-ина** — асинхронный, в фоновом обработчике, не блокирует разбор плановых/сделанных/блокеров. Если языковая модель упала — `sentiment=null`, чек-ин сохраняется как обычно.

## 4. Зависимости

- β-8 (`done`) — модель `DailyCheckIn`, `OperationsDashboardService`, RBAC роль `coo`.
- α-1 (`done`) — `ConversationalService.sendNotification` для доставки дайджеста.
- β-4 (`done`) — `Insights Radar` как один из источников.
- α-3 (`done`) — `EntityLinkType` для агрегата по команде.

## 5. Изменение схемы базы

```prisma
model DailyCheckIn {
  // existing
  sentiment           String?    // 'green' | 'yellow' | 'red'
  sentimentRationale  String?    @db.Text
  sentimentVersion    String?    // версия промпта/модели, которой определили
  sentimentDeterminedAt DateTime?

  @@index([tenantId, sentiment, dateLocal])
}

model WeeklyOperationsDigest {
  id              String   @id @default(cuid())
  tenantId        String
  weekStart       String   // YYYY-MM-DD, понедельник недели
  weekEnd         String   // YYYY-MM-DD, воскресенье
  bodyMarkdown    String   @db.Text
  metricsJson     Json     // структурированные показатели для виджетов
  sourcesJson     Json     // провенанс: id блокеров, инсайтов, целей
  llmTaskRouteId  String?  // какой маршрут модели использовался
  createdAt       DateTime @default(now())

  tenant          Org      @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, weekStart])
  @@index([tenantId, weekStart])
  @@map("weekly_operations_digests")
}

model Org {
  // existing — поле timezone должно быть; если нет:
  timezone        String?  @default("Europe/Moscow")
}
```

## 6. Скрипты миграции

- `backend/scripts/patch-org-timezone-default.ts` — для всех `Org` с `timezone IS NULL` → `'Europe/Moscow'` (если поля ещё нет — добавить).
- `backend/scripts/seed-llm-task-routes-beta-8-1.ts` — регистрирует два новых типа задач модели (см. §9).

Никакого backfill для `sentiment` существующих чек-инов не делаем — старые остаются с `null`.

## 7. REST API

`/api/v1/dashboard/operations` (расширение):
- `GET /team-temperature?days=7` — агрегат по настроению: процент зелёных/жёлтых/красных за период, разрез по людям и командам. Доступ — `coo | owner | admin`.

`/api/v1/dashboard/operations/weekly-digest` (новый):
- `GET /?weekStart=YYYY-MM-DD` — отдаёт сохранённый дайджест или 404. Доступ — `coo | owner | admin`.
- `POST /generate?weekStart=YYYY-MM-DD` — принудительно перегенерировать (для отладки и админа). Доступ — `admin | super_admin`.

`/api/v1/me/check-ins` (изменение):
- `GET /` — поле `sentiment*` НЕ возвращается в ответе (фильтр на уровне маппера).

## 8. Фоновые обработчики и расписания

**Новый обработчик `checkin-sentiment-analyzer.worker`:**
- Очередь — общая очередь языковой модели.
- Триггер — после успешной сборки записи чек-ина: эмитим событие `checkin.created`, на него подписан этот обработчик.
- Делает один вызов модели с типом задачи `checkin-sentiment`, получает `{sentiment, rationale}`, обновляет запись.
- Время выполнения — до 30 секунд, иначе таймаут, `sentiment` остаётся `null`.

**Новое расписание `operations-weekly-digest.cron`:**
- Cron-выражение `0 8 * * 1` (понедельник 08:00) в часовом поясе каждого `Org`.
- Реализация — как уже сделано в `daily-checkin-prompt.cron`: запускается каждый час, фильтрует `Org` по их `timezone`, находит те, у кого сейчас понедельник 08:00 локального времени.
- Идемпотентность — проверка `WeeklyOperationsDigest` по `(tenantId, weekStart)` перед генерацией.
- Если дайджест сгенерирован — отправка через `ConversationalService.sendNotification(eventType='operations.weekly_digest')` всем у кого роль `coo` или `owner`.

## 9. Новые типы задач языковой модели

```ts
// checkin-sentiment — определить green/yellow/red по тексту вечернего чек-ина
{ taskType: 'checkin-sentiment', priority: 'primary',   provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'checkin-sentiment', priority: 'secondary', provider: 'openai',   model: 'gpt-4o-mini' }
{ taskType: 'checkin-sentiment', priority: 'tertiary',  provider: 'ollama',   model: 'qwen3.5:9b' }

// operations-weekly-digest — собрать связный текст комментария по агрегатам недели
{ taskType: 'operations-weekly-digest', priority: 'primary',   provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'operations-weekly-digest', priority: 'secondary', provider: 'openai',   model: 'gpt-4o-mini' }
{ taskType: 'operations-weekly-digest', priority: 'tertiary',  provider: 'ollama',   model: 'qwen3.5:9b' }
```

Промпт `checkin-sentiment` редактируется из админки (как все промпты — через PromptRegistry с code-fallback). Стартовая версия — `backend/src/modules/operations/prompts/checkin-sentiment.prompt.ts`.

Промпт `operations-weekly-digest` — `backend/src/modules/operations/prompts/weekly-digest.prompt.ts`. Получает на вход агрегаты, возвращает 5-7 коротких разделов в `Markdown`.

## 10. Права доступа

- Новый ресурс прав `dashboard_operations_temperature` — read для `coo`, `owner`, `admin`, `super_admin`. Сотруднику доступа нет.
- Новый ресурс прав `dashboard_operations_weekly` — read для `coo`, `owner`, `admin`, `super_admin`.
- В `policy.csv` добавить три строки в блоке роли `coo` (после `dashboard_operations.read`) — для трёх новых ресурсов.
- В `daily_checkin.read` НЕ меняем, но в ответе на `/me/check-ins` маппер скрывает поля `sentiment*` для не-admin-ролей.

## 11. Показатели Prometheus

- `coo_sentiment_analyzed_total{tenant_top, sentiment}` — счётчик по итогам анализа.
- `coo_sentiment_failed_total{tenant_top}` — счётчик отказов языковой модели.
- `coo_weekly_digest_generated_total{tenant_top}` — счётчик удачных генераций.
- `coo_weekly_digest_failed_total{tenant_top, reason}` — счётчик неудач.
- `coo_team_temperature_red_share{tenant_top}` — гейдж: доля красных чек-инов за 7 дней. Тревога на дашборде Grafana при > 0.3.

## 12. Интерфейс

- Виджет «Температура команды» в `frontend/app/(authenticated)/dashboard/operations/OperationsDashboardClient.tsx` — горизонтальные столбики по людям/командам, легенда зелёный-жёлтый-красный, последние 7 дней.
- Новая страница `frontend/app/(authenticated)/dashboard/operations/weekly/page.tsx` + `WeeklyDigestClient.tsx` — рендерит `WeeklyOperationsDigest` с навигацией по неделям.
- В навигации (NAV) — в группе «Операции» новая ссылка «Недельная сводка».
- В личном кабинете `/me/check-ins` поля настроения **не показываем** (даже если случайно вернутся из API — `DomainMapper` отфильтрует).

## 13. Переменные окружения

- `COO_SENTIMENT_ENABLED: boolean (default true)` — общий выключатель.
- `COO_WEEKLY_DIGEST_ENABLED: boolean (default true)`.
- `COO_WEEKLY_DIGEST_LOCAL_HOUR: number (default 8)` — час понедельника.
- `COO_WEEKLY_DIGEST_LOCAL_DAY: number (default 1)` — день недели (`0 = воскресенье`, `1 = понедельник`).

## 14. Связь с существующим кодом

- `backend/src/modules/operations/services/checkin-parser.service.ts` — добавить эмит события `checkin.created` после успешной сборки.
- Новый файл `backend/src/modules/operations/workers/checkin-sentiment-analyzer.worker.ts`.
- Новый файл `backend/src/modules/operations/workers/operations-weekly-digest.cron.ts`.
- Новый файл `backend/src/modules/operations/services/weekly-digest.service.ts`.
- Расширить `backend/src/modules/operations/dto/operations-dashboard.dto.ts` — новый блок `teamTemperature` в `OverviewDto`.
- Расширить `backend/src/modules/operations/dto/daily-check-in.dto.ts` — `sentiment` и связанные поля (видны только при наличии нужной роли).
- `backend/src/modules/rbac/policies/policy.csv` — три новые строки для роли `coo`.
- Новые промпты в `backend/src/modules/operations/prompts/`.

## 15. Критерии готовности (DoD)

- [ ] Изменение схемы (4 поля у `DailyCheckIn`, новая модель `WeeklyOperationsDigest`, поле `Org.timezone`).
- [ ] Скрипты миграции и регистрации типов задач.
- [ ] Обработчик настроения работает: чек-ин с вечерним текстом → через 30 сек поле `sentiment` заполнено.
- [ ] Расписание недельной сводки идемпотентно — повторный запуск не создаёт второй дайджест за ту же неделю.
- [ ] Дайджест уходит в канал доставки операционному директору / владельцу.
- [ ] Виджет «Температура команды» на панели работает.
- [ ] Страница `/dashboard/operations/weekly` работает.
- [ ] Сотрудник в `/me/check-ins` НЕ видит поля настроения (проверено тестом).
- [ ] Права: `coo` видит и температуру, и дайджест; рядовой сотрудник не видит ни одного из них.
- [ ] `typecheck` / `lint` / тесты зелёные.

## 16. Тесты

- **Модульный:** `checkin-sentiment-analyzer.worker.spec.ts` — три кейса (зелёный, жёлтый, красный) + случай отказа модели.
- **Модульный:** `weekly-digest.service.spec.ts` — корректная сборка агрегатов из фикстур.
- **Модульный:** `operations-weekly-digest.cron.spec.ts` — идемпотентность + правильная фильтрация по часовому поясу.
- **Модульный:** `operations-dashboard.dto.spec.ts` — поле `sentiment` НЕ присутствует в ответе для роли `member` (и присутствует для `coo`).
- **Интеграционный:** полный цикл — чек-ин → событие → анализ → сохранение → отдача через эндпоинт с разными ролями.

## 17. Риски и страховки

- **Языковая модель ошибается с настроением.** Защита: поле `sentimentRationale` всегда заполняется; администратор может перепроверить и руками поменять через будущий эндпоинт (вне scope этого ТЗ).
- **Слишком много красных от усталости команды.** Защита: тревога на гейдже `coo_team_temperature_red_share` > 0.3 предупреждает раньше, чем красное накопится.
- **Дайджест задерживается из-за модели.** Защита: при неудаче языковой модели — отправляем «сухой» вариант со структурированными показателями без связного текста.
- **Сотрудник случайно видит своё настроение.** Защита: явный тест на отсутствие поля + фильтр в мапере, не в гварде, чтобы не зависело от RBAC-конфига.
- **Двойная отправка дайджеста.** Защита: `@@unique([tenantId, weekStart])` на уровне базы.

---

_2026-05-24: готово к старту. Зависит только от β-8 (done). Можно делать параллельно с β-8.2 — пересечений нет._
