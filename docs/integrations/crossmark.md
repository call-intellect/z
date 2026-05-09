# Интеграция Crossmark ↔ Z

Этот документ описывает контракт между Crossmark (партнёр, инициатор) и Z
(модуль AI-видеовстреч). Аудитория — backend-разработчики Crossmark.

## Общая схема

```
Crossmark CRM ──HTTPS+HMAC──► Z Backend ──── LiveKit + AI ────► Z UI (видеокомната)
        ▲                          │
        │                          │  webhook
        └─── status updates ◄──────┘
```

Crossmark создаёт встречу, получает `meeting_id` + ссылки для хоста и гостей.
По завершении и AI-обработки — Crossmark получает webhook со статусом
`ai_ready` и подтягивает результат через GET-эндпоинт.

## Аутентификация

### Issued ключ

Партнёр получает один HMAC-ключ длиной 64 hex-символа (32 байта энтропии).
Ключ выдаётся через `bun run scripts/create-integration-key.ts crossmark`
и **показывается ровно один раз**. На сервере хранится только sha256-хеш.

### HMAC-подпись запросов

Конвенция (stripe-like):

```
signed_payload = `${timestamp}.${rawBody}`
signature      = hex(hmacSha256(integrationKey, signed_payload))
```

Заголовки запроса:

| Заголовок                | Значение                                                        |
|--------------------------|-----------------------------------------------------------------|
| `Authorization`          | `Bearer <integrationKey>` (он же используется как HMAC-secret)  |
| `X-Crossmark-Signature`  | `signature` (hex, 64 символа)                                   |
| `X-Crossmark-Timestamp`  | UNIX time в секундах                                            |
| `X-Idempotency-Key`      | UUID/ulid — для идемпотентного создания встречи                 |
| `Content-Type`           | `application/json; charset=utf-8`                               |

### Валидация на стороне Z

1. **Timestamp window**: `|now - timestamp| <= 300 sec` (защита от replay).
2. **Signature**: `timingSafeEqual(expected, provided)` (защита от timing-атак).
3. **Key revocation**: если `IntegrationKey.revokedAt != null` → 401.
4. **Idempotency**: `(integrationKeyId, idempotencyKey)` уникален; повторный
   запрос с тем же ключом возвращает ту же встречу с `200`, не создаёт новую.

### Пример подписи (bash)

```bash
KEY="0123abcd..."  # 64 hex
BODY='{"host":{"external_id":"u-42","email":"a@x.x","name":"Анна"},"type":"sales","title":"Звонок"}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$KEY" -binary | xxd -p -c 256)

curl -X POST "https://z.crossmark.ru/integrations/crossmark/v1/meetings" \
  -H "Authorization: Bearer $KEY" \
  -H "X-Crossmark-Signature: $SIG" \
  -H "X-Crossmark-Timestamp: $TS" \
  -H "X-Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

## API

### `POST /integrations/crossmark/v1/meetings` — создать встречу

Запрос:

```json
{
  "host": {
    "external_id": "crm-user-42",
    "email": "anna@example.com",
    "name": "Анна Петрова"
  },
  "type": "sales",
  "title": "Звонок с клиентом ООО Ромашка",
  "custom_prompt": null,
  "scheduled_for": "2026-05-10T14:00:00Z"
}
```

Поля:

- `type` — один из 9 типов (`sales`, `support`, `interview`, `1on1`,
  `standup`, `planning`, `retrospective`, `all-hands`, `external`).
- `custom_prompt` — опциональный кастомный промпт для AI-отчёта (≤10 000 символов).
- `scheduled_for` — на UI попадёт в «запланировано на», не блокирует вход.

Ответ `201`:

```json
{
  "meeting_id": "01HXY9...",
  "host_url": "https://z.crossmark.ru/m/01HXY9...?host=true",
  "guest_url": "https://z.crossmark.ru/m/01HXY9...",
  "status": "pending"
}
```

Ошибки:

| Код  | Когда                                       |
|------|---------------------------------------------|
| 400  | Невалидное тело (Zod-ошибка)                |
| 401  | Невалидный HMAC / отозванный ключ           |
| 409  | `X-Idempotency-Key` уже использован с другим body |
| 422  | Несуществующий `type`                       |
| 429  | Rate limit (60 RPM на ключ)                 |

### `GET /integrations/crossmark/v1/meetings/:id/result` — получить результат

Возвращает AI-отчёт когда статус `ai_ready`. До этого — `404`.

Ответ `200`:

```json
{
  "meeting_id": "01HXY9...",
  "status": "ai_ready",
  "type": "sales",
  "started_at": "2026-05-09T10:00:00Z",
  "ended_at": "2026-05-09T10:42:00Z",
  "duration_seconds": 2520,
  "report_md": "# Резюме встречи\n...",
  "transcript_url": "https://...presigned...",
  "recording_url": "https://...presigned...",
  "participants": [
    { "name": "Анна Петрова", "role": "host", "speaking_seconds": 1340 }
  ]
}
```

Presigned URLs действительны 1 час.

## Webhook от Z в Crossmark (опционально, V1.1)

В MVP — Crossmark поллит `GET ../result` каждые 30 секунд после `ended_at`.
В V1.1 — Z будет звать `webhook_url` партнёра при переходе в `ai_ready`.

## FAQ

### Можно ли встроить страницу `/m/:id` в iframe Crossmark?

Нет. CSP `frame-ancestors 'none'` запрещает (anti-clickjacking + бизнес-решение).
Crossmark должен открывать встречу в новой вкладке.

### Что если ключ скомпрометирован?

Запросить отзыв: админ Z вызывает `DELETE /admin/api/v1/integration-keys/:id`.
Все запросы с этим ключом немедленно начинают возвращать `401`.

### Сколько ключей можно завести?

Сколько угодно. Партнёров (`partner_name`) — отдельная сущность, на одного
партнёра — один активный ключ + сколько угодно отозванных.
