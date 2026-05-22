# 04 — API-спецификация

Этот документ описывает все публичные интерфейсы системы. Машиночитаемая OpenAPI-спека — в `schemas/openapi.yaml`. События event bus — в `schemas/events.md`.

## Соглашения

- **Базовый URL:** `https://{tenant}.example.ru/api/v1`. Self-host клиент использует свой домен.
- **Аутентификация:** `Authorization: Bearer <JWT>` (выдаётся Keycloak).
- **Content-Type:** `application/json` для REST, `application/octet-stream` для бинарных загрузок.
- **Коды ответа:**
  - `200/201` — успех.
  - `400` — ошибка валидации.
  - `401` — не аутентифицирован.
  - `403` — недостаточно прав (M-20 отказал).
  - `404` — не найдено (или скрыто M-20 без отдельного признака).
  - `409` — конфликт идемпотентности.
  - `422` — semantic validation error.
  - `429` — rate-limit.
  - `500` — внутренняя ошибка.
  - `503` — сервис недоступен (например, LLM-провайдер недоступен и нет fallback).
- **Идемпотентность:** все мутирующие POST/PATCH принимают заголовок `Idempotency-Key`. Повторный запрос с тем же ключом возвращает первый результат.
- **Версионирование:** `/api/v1`. Major-обновления через `/api/v2` с deprecation-периодом 12 месяцев.
- **Pagination:** cursor-based. `?cursor=<opaque>&limit=50`. Ответ содержит `next_cursor`.
- **Сортировка:** `?sort=field:asc,field2:desc`.
- **Фильтры:** через query string или body для сложных. Документировано в OpenAPI.
- **Locale:** заголовок `Accept-Language: ru` (default).
- **Time:** все timestamp — ISO 8601 UTC. Локальная зона тенанта применяется на фронте.

---

## 1. Аутентификация

| Метод | Путь | Описание |
|---|---|---|
| POST | `/auth/login` | Логин (proxy в Keycloak), возвращает JWT и refresh token |
| POST | `/auth/refresh` | Обновить access token |
| POST | `/auth/logout` | Завершить сессию |
| GET | `/auth/me` | Текущий пользователь + роли |

JWT содержит claims: `sub` (user_id), `roles` (functional + hierarchical), `tenant_id`, `data_class_max` (max доступный data_class).

---

## 2. Ingest (M-02)

| Метод | Путь | Описание |
|---|---|---|
| POST | `/ingest/event` | Создать RawEvent из текста/JSON payload |
| POST | `/ingest/file` | Загрузить файл (multipart/form-data) |
| POST | `/ingest/file/chunked/init` | Инициализировать chunked upload |
| PUT | `/ingest/file/chunked/{upload_id}/{part_no}` | Загрузить часть файла |
| POST | `/ingest/file/chunked/{upload_id}/complete` | Финализировать |
| POST | `/ingest/voice/stream` | WSS-стрим голоса в WhisperX |
| POST | `/ingest/webhooks/{source_class}/{connection_id}` | Внешний webhook (валидируется HMAC) |

### Пример: POST `/ingest/event`

```json
{
  "source_id": "01H....",
  "external_id": "msg_12345",
  "occurred_at": "2026-05-10T12:34:56Z",
  "author": {"type": "person", "external_id": "user@company.ru", "display_name": "Иван Петров"},
  "channel": {"type": "slack_channel", "id": "C01ABC", "name": "marketing"},
  "content_type": "text",
  "content": "Клиент жалуется, что отчёт открывается 30 секунд",
  "metadata": {"slack_ts": "1715337296.001"}
}
```

Ответ:

```json
{
  "event_id": "01H...",
  "idempotency_key": "sha256:...",
  "status": "accepted",
  "deduplicated": false
}
```

---

## 3. Сигналы (M-06)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/signals` | Список с фильтрами (type, theme_id, period, source_id) |
| GET | `/signals/{id}` | Один сигнал |
| GET | `/signals/{id}/evidence` | Первоисточники |
| PATCH | `/signals/{id}/confirmation` | Изменить уровень подтверждения (только M-26 контекст) |
| POST | `/signals/{id}/feedback` | Корректировка от пользователя |

---

## 4. Темы (M-08)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/themes` | Список с фильтрами |
| GET | `/themes/{id}` | Одна тема + сигналы |
| GET | `/themes/{id}/related` | Связанные темы через граф |
| GET | `/themes/{id}/timeline` | Изменения темы во времени |
| POST | `/themes/merge` | Слить две темы (через AI-предложение или вручную) |
| POST | `/themes/{id}/split` | Разделить (через AI-предложение или вручную) |
| PATCH | `/themes/{id}` | Корректировка (через M-26) |
| GET | `/themes/{id}/at?timestamp=...` | Состояние на момент времени |

---

## 5. Граф знаний (M-11, M-12)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/graph/nodes/{id}/neighbors?depth=2&relation_types=...` | Соседи в графе |
| GET | `/graph/paths?from={id}&to={id}&max_depth=4` | Пути между сущностями |
| GET | `/graph/subgraph?seeds=...&depth=2` | Подграф для рендера |
| POST | `/graph/links` | Создать связь (через AI или вручную) |
| PATCH | `/graph/links/{id}/confirmation` | Подтвердить/отклонить связь (M-26) |
| GET | `/graph/at?timestamp=...` | Time-travel запрос |

### Пример: GET `/graph/nodes/{theme_id}/neighbors`

```json
{
  "node": {"type": "theme", "id": "...", "title": "Медленная поддержка"},
  "neighbors": [
    {
      "edge": {"type": "помогает", "confidence": 0.83, "explanation": "...", "status": "предложена_AI"},
      "node": {"type": "decision", "id": "...", "title": "Перенести L1 в Москву"}
    }
  ]
}
```

---

## 6. Цели (M-15)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/goals` | Список целей |
| POST | `/goals` | Создать цель |
| GET | `/goals/{id}` | Одна цель + связанные темы |
| PATCH | `/goals/{id}` | Изменить |
| GET | `/goals/{id}/alignment` | Расчёт согласованности (через M-16) |

---

## 7. Стратегический согласователь (M-16)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/alignment/current` | Текущий топ-индикатор + субметрики |
| GET | `/alignment/history?period=90d` | История по дням |
| GET | `/alignment/breakdown?goal_id=...` | Детализация по цели |
| GET | `/alignment/anomalies?since=2026-04-01` | Резкие падения/изменения |

### Пример: GET `/alignment/current`

```json
{
  "score": 72,
  "computed_at": "2026-05-10T03:00:00Z",
  "submetrics": {
    "voices_alignment": 78,
    "actions_to_goals": 65,
    "drift_velocity": 5
  },
  "active_goals_count": 4,
  "drift_alerts": [
    {"goal_id": "...", "title": "Стать №1 в SMB", "score_drop_30d": -12}
  ]
}
```

---

## 8. Идеи (M-17)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/ideas` | Список с фильтрами |
| POST | `/ideas` | Создать идею |
| GET | `/ideas/{id}` | Одна идея |
| PATCH | `/ideas/{id}/status` | Перевести в другой статус |

## 9. Риски (M-18)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/risks` | Список рисков |
| GET | `/risks/{id}` | Один риск + сигналы |
| PATCH | `/risks/{id}` | Корректировка |

## 10. Решения (M-21)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/decisions` | Список решений |
| POST | `/decisions` | Создать |
| GET | `/decisions/{id}` | Одно решение |
| PATCH | `/decisions/{id}` | Дополнить (rationale, alternatives, consequences) |
| POST | `/decisions/{id}/evaluate-consequences` | Оценить consequences_actual через 90 дней |

## 11. Обещания (M-37)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/commitments?person_id=me&status=active` | Свои обещания |
| GET | `/commitments/{id}` | Одно обещание |
| PATCH | `/commitments/{id}/status` | Пометить выполненным или забытым |

## 12. Открытые вопросы (M-32)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/open-questions` | Список |
| POST | `/open-questions` | Открыть вопрос |
| GET | `/open-questions/{id}` | Один вопрос |
| POST | `/open-questions/{id}/answer` | Закрыть с ответом (через M-21) |

---

## 13. Чат с агентом (M-23)

### REST (для коротких запросов)

| Метод | Путь | Описание |
|---|---|---|
| POST | `/chat/messages` | Отправить сообщение, получить ответ |
| GET | `/chat/sessions/{id}` | Получить историю сессии |
| POST | `/chat/sessions` | Начать новую сессию |
| DELETE | `/chat/sessions/{id}` | Завершить сессию |

### WebSocket (для streaming)

`wss://{tenant}.example.ru/api/v1/chat/ws`

После WSS-handshake клиент шлёт JSON:

```json
{"type": "user_message", "session_id": "...", "content": "Что я обещал на прошлой неделе?", "voice": false}
```

Сервер стримит:

```json
{"type": "agent_thinking", "agent": "supervisor"}
{"type": "agent_token", "content": "На прошлой неделе"}
{"type": "agent_token", "content": " вы упомянули..."}
{"type": "agent_evidence", "items": [{"type": "raw_event", "id": "...", "snippet": "...", "occurred_at": "..."}]}
{"type": "agent_complete", "message_id": "..."}
```

Поддерживается голос: клиент пишет PCM 16-bit chunks → сервер транскрибирует на лету и стримит ответ.

### Запрос с голосом

`wss://{tenant}.example.ru/api/v1/chat/voice`

Двунаправленный поток:
- Клиент → сервер: PCM 16kHz mono chunks (250 ms окнами).
- Сервер → клиент: streaming распознавание + streaming TTS-аудио (опционально) + текст.

---

## 14. Дашборд (M-24)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/dashboard/today` | Состояние «сегодня» |
| GET | `/dashboard/week` | Сводка за неделю |
| GET | `/dashboard/month` | Сводка за месяц |
| GET | `/dashboard/branch/{branch_id}` | Срез по ветке |
| GET | `/dashboard/role-view?role=cmo` | Срез по роли |
| POST | `/dashboard/query` | Свободный запрос на изменение дашборда (передаёт в M-23) |

## 15. База знаний (M-25)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/knowledge/articles` | Список статей |
| GET | `/knowledge/articles/{id}` | Одна статья |
| GET | `/knowledge/articles/{id}/history` | История изменений |
| POST | `/knowledge/articles` | Создать (только из админки) |
| PATCH | `/knowledge/articles/{id}` | Обновить (только из админки) |

## 16. Корректировка (M-26)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/corrections/queue` | Очередь candidates от AI |
| POST | `/corrections/{candidate_id}/accept` | Принять предложение |
| POST | `/corrections/{candidate_id}/reject` | Отклонить с обоснованием |

## 17. Настроение команды (M-19)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/mood/me` | Свои данные |
| POST | `/mood/checkin` | Ответы на ежедневный чек-ин |
| GET | `/mood/aggregate?team_id=...` | Агрегат по команде (k-anonymity) |
| POST | `/mood/opt-in` | Включить участие |
| POST | `/mood/opt-out` | Отказаться |

## 18. Контекст роли (M-36)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/context/me` | Текущий контекст роли |
| GET | `/context/me/expanded?topic=...` | Расширенный контекст по теме |

---

## 19. Администрирование (только админ)

### Источники (M-01, M-40)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/admin/sources` | Все источники |
| POST | `/admin/sources` | Подключить источник |
| PATCH | `/admin/sources/{id}` | Обновить настройки |
| DELETE | `/admin/sources/{id}` | Отключить |
| POST | `/admin/sources/{id}/test` | Проверить подключение |
| POST | `/admin/sources/{id}/sync` | Триггерить ручной sync |

### Роли и права (M-20)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/admin/roles` | Все роли |
| POST | `/admin/roles` | Создать кастомную роль |
| PATCH | `/admin/roles/{id}` | Изменить |
| GET | `/admin/users` | Сотрудники |
| POST | `/admin/users/{id}/roles` | Назначить роль |
| GET | `/admin/access/audit?user_id=...&period=...` | Аудит доступов |

### Карта компании (M-07)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/admin/branches` | Все ветки |
| POST | `/admin/branches` | Добавить кастомную ветку |
| PATCH | `/admin/branches/{id}` | Изменить |
| DELETE | `/admin/branches/{id}` | Архивировать |

### Бюджет LLM (M-39)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/admin/llm/budget` | Текущее использование |
| GET | `/admin/llm/usage?period=...` | История по моделям |
| PATCH | `/admin/llm/budget` | Изменить лимит |
| GET | `/admin/llm/policies` | Текущие политики маршрутизации |
| PATCH | `/admin/llm/policies` | Изменить политики |

### Retention и удаление (M-20, [08-security-privacy.md](08-security-privacy.md))

| Метод | Путь | Описание |
|---|---|---|
| GET | `/admin/retention/policy` | Текущая retention-матрица |
| PATCH | `/admin/retention/policy` | Изменить TTL |
| POST | `/admin/persons/{person_id}/forget` | Запустить compliance-удаление |
| GET | `/admin/persons/{person_id}/export` | Экспорт всех данных о субъекте |

### Системное

| Метод | Путь | Описание |
|---|---|---|
| GET | `/admin/health` | Состояние всех компонентов |
| GET | `/admin/version` | Версии всех сервисов |
| POST | `/admin/maintenance/reindex-vectors` | Переиндексировать pgvector |
| POST | `/admin/maintenance/reframe-now` | Триггерить M-14 вне расписания |

---

## 20. Webhook'и для внешних систем

Клиент может настроить outgoing webhooks (только полезные для внешней автоматизации):

| Событие | Описание |
|---|---|
| `theme.weight_spike` | Резкий рост важности темы |
| `risk.realized` | Риск перешёл в `realized` |
| `alignment.drop` | Согласованность упала на 10+ |
| `commitment.due_today` | Сегодня заявленный дедлайн (только если включён) |

Webhook'и подписываются HMAC-256 (header `X-SecondBrain-Signature`).

---

## 21. События event bus (Kafka)

См. `schemas/events.md` для полной спецификации каждого события.

| Топик | Назначение |
|---|---|
| `ingest.raw.events` | Новый RawEvent |
| `signals.extracted` | Новые сигналы из M-05 |
| `themes.changed` | Создание / merge / split темы |
| `links.proposed` | AI предложил связь |
| `links.confirmed` | Человек подтвердил связь |
| `goals.changed` | Изменение цели |
| `decisions.recorded` | Новое решение |
| `mood.checkin_completed` | Сотрудник прошёл чек-ин |
| `alignment.computed` | Новая итерация M-16 |
| `metrics.anomaly` | Аномалия в метрике |
| `commitments.detected` | Извлечено обещание |
| `agent.actions` | Audit-лог AI |

Каждое сообщение содержит:

```json
{
  "event_id": "01H...",
  "tenant_id": "...",
  "occurred_at": "...",
  "schema_version": "1.0",
  "data_class": "internal",
  "payload": {...}
}
```

---

## 22. MCP-инструменты (для AI-агентов)

См. `schemas/mcp-tools.md` для полного реестра.

Группы инструментов:

| Группа | Префикс | Кому доступно |
|---|---|---|
| Поиск | `search.*` | Всем агентам |
| Чтение | `read.*` | По доступу |
| Запись (proposals) | `propose.*` | По агенту-роли |
| Анализ | `analyze.*` | Любому агенту |
| Бизнес-данные | `business.*` | Только агентам с разрешением tenant'а |

Каждый инструмент возвращает `{result, evidence, confidence}`.

---

## 23. Граничные правила API

- **Rate-limit:** 100 req/min на пользователя в дефолте, 1000 req/min для админ-токенов.
- **Размер body:** 10 МБ для JSON, 5 ГБ для multipart upload.
- **Длина текстового сообщения в чате:** 32k символов.
- **Длина голосового стрима:** до 1 часа за один WSS-connect.
- **Pagination max limit:** 200 записей на страницу.
- **Timeout:** REST — 30 сек по умолчанию, WSS — keepalive 60 сек.
- **CORS:** только для доменов тенанта (через Caddy конфиг).

---

## 24. Что **запрещено** в API

- Bulk-mutation endpoint'ы (создание 1000 идей одним запросом) — нарушает audit. Только индивидуальные.
- Передача API-ключей в URL (только через заголовки).
- Cookies для аутентификации (только Authorization header). Cookie допустимо только для CSRF-token frontend-сессии.
- Возврат `data_class: sensitive` без явной проверки — добавляйте middleware-assert.
- Endpoint'ы без OpenAPI описания. Любой новый endpoint — сначала в `schemas/openapi.yaml`, потом реализация.
