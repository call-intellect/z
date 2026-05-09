---
name: strict-production-review-gate
description: Production-oriented code review для Z: поиск критических багов, auth-дыр, рисков потери данных, некорректных переходов FSM встречи, billing-проблем, идемпотентности, missing validation, observability gaps. Используй этот скилл при ЛЮБОМ code review, перед мержем любой фичи, при проверке PR, при аудите модуля. Запускай также самостоятельно перед отправкой изменений — не жди, пока попросят.
---

# Z: production review gate

## Порядок проверки (строго сверху вниз)

Проверки идут от критического к минорному. Не переходи к следующему пункту, пока не завершил предыдущий.

### 1. Production-breaking logic bugs
- Логика, которая приведёт к неверному поведению в production прямо сейчас
- Race conditions, неверные условия, инвертированная логика
- Ошибки в FSM встречи (например, можно вернуть встречу из ENDED → LIVE, или начать запись в SCHEDULED без подключения)

### 2. Auth и access control
- Отсутствие проверки роли/ownership перед мутацией данных
- Эндпоинты без guard'ов
- **Гость не должен получать секреты LiveKit** (API key/secret) — только короткоживущий access token
- Гостевой токен не даёт доступа к чужим встречам
- Возможность одного юзера видеть встречи/записи другого
- Отсутствие проверки `userId`/`hostId`/`meetingId` в запросах

### 3. Data corruption / data loss risks
- Операции без транзакций, где нужна атомарность
- Cascading deletes без явного намерения (особенно: meeting → recording → ai_result)
- Overwrite данных без проверки существующего значения
- Отсутствие soft delete там, где нужен аудит
- Запись/аудиодорожки удаляются без учёта retention по тарифу

### 4. Incorrect state transitions
- Переходы FSM встречи (SCHEDULED → LIVE → ENDED) не через явный state machine
- Возможность перейти в недопустимое состояние напрямую через API
- Отсутствие валидации current state перед transition
- Egress статусы (started / ended / failed) обрабатываются непоследовательно

### 5. Payment, billing, retention risks
- Двойное списание / двойное начисление
- Отсутствие idempotency key при платёжных операциях
- TTL записи не соответствует тарифу (см. recording.md)
- ASR-биллинг считается дважды при retry

### 6. Integration retry и idempotency
- Внешние вызовы (LiveKit, S3, ASR, LLM, email) без retry-логики
- Webhook от LiveKit обрабатывается без проверки «уже обработали»
- Операции, которые при повторном вызове создадут дублирование
- BullMQ jobs без проверки "уже выполнено"

### 7. Missing validation
- Отсутствие валидации на уровне DTO (class-validator)
- Поля, которые могут прийти undefined/null и сломать логику
- Отсутствие проверки business rules (например, нельзя начать запись пустой встречи; нельзя пригласить >10 участников при MVP-лимите)

### 8. Observability и logging gaps
- Критические операции без логирования через `SystemLoggerService`
- LiveKit webhooks обрабатываются без trace
- AI-вызовы без трейсинга (input/output/cost)
- Ошибки, которые будут проглочены без trace

### 9. UX states, которые trap users
- Пользователь попадает в состояние, из которого нет выхода (комната зависла connecting навсегда)
- Отсутствие empty state, error state, loading state
- Action button (mute, поднять руку, начать запись), который ничего не делает при определённых условиях без объяснения
- Гость по битой ссылке получает голый 500 вместо понятной страницы

### 10. Style и cleanup
- Только после всего выше
- Неиспользуемые imports, console.log, закомментированный код
- Нарушения code style

---

## Формат вывода

### Структура ответа

```
## Critical issues
- [CRITICAL] <описание> — <file:line>
  Fix: <что именно исправить>

## Medium risks
- [MEDIUM] <описание> — <file:line>
  Fix: <что именно исправить>

## Minor issues
- [MINOR] <описание>

## Edge cases to verify
- <сценарий, который стоит проверить вручную>

## Merge verdict
BLOCK / APPROVE WITH FIXES / APPROVE
Reason: <одна строка>

## Residual risks (если APPROVE)
- <что осталось непроверенным или требует мониторинга после мержа>
```

### Если findings нет

Явно написать: "No critical findings." — и перечислить, что было проверено, и указать residual risks / testing gaps.

---

## Специфика Z

При review в Z дополнительно проверять:

- **LiveKit boundary:** никакой бизнес-логики на LiveKit Server; токены — только бэк; гость не получает API key/secret.
- **Аудио — отдельными дорожками:** не полагаемся на общий микс для AI — иначе ломается разделение по спикерам.
- **9 типов встреч:** AI-отчёт зависит от `meeting.type` — не делать «один шаблон на всё».
- **Гость без регистрации:** проверка только через guest_token, нельзя падать в auth-исключение.
- **Plan limits:** retention записей, лимит участников (MVP=10) — через конфиг, не хардкод.
- **AI jobs:** AI-вызовы асинхронные (через очередь), не синхронные из HTTP-хендлера.
- **Prisma:** изменения схемы через `db push`, не через migrate.
- **Seed safety:** seed-скрипты не перезапишут admin-edited промпты/шаблоны.
- **Multi-node prod:** SFU / Egress / TURN / Backend / DB / Storage — на разных нодах. Любой код, который намекает на «всё на одном» — флаг.
