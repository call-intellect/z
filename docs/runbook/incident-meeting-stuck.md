# Runbook: встреча зависла в `active` >1 часа

## Симптомы

- Хост или гость жалуется, что страница `/m/:id` показывает «Встреча идёт», но никого нет.
- В админке (`/admin/api/v1/meetings`) встреча в статусе `active` без `endedAt`.
- В Grafana панель «Active rooms» (`livekit_room_total`) показывает >0, хотя по бизнес-факту встречи нет.
- Алерт **HighMeetingFailureRate** не сработал — сама встреча не «упала», она «не закрылась».

## Диагностика

1. Найти встречу:

   ```bash
   psql z_main -c "SELECT id, status, started_at, ended_at FROM \"Meeting\" WHERE id='<MEETING_ID>';"
   ```

2. Проверить, есть ли участники в LiveKit:

   ```bash
   curl -H "Authorization: Bearer $LIVEKIT_API_KEY" \
        "https://media.crossmark.ru/twirp/livekit.RoomService/ListParticipants" \
        -d '{"room":"<MEETING_ID>"}'
   ```

   Если участников **нет** — комната «висит» без хостов, надо завершать.

3. Логи backend по `meetingId`:

   ```bash
   journalctl -u z-backend --since '2h ago' | grep -i '<MEETING_ID>'
   ```

   Часто причина — webhook `participant_left` потерян / не пришёл.

## Recovery

### Вариант 1: force-finish через админку

1. Залогиниться в `/admin` под admin-пользователем.
2. Открыть страницу встречи `/admin/meetings/<MEETING_ID>`.
3. Нажать **Force finish** (вызывает `POST /admin/api/v1/meetings/:id/finish`).

Эффект: статус → `finishing`, останавливается Egress, запускается AI-pipeline.

### Вариант 2: SQL (если админка недоступна)

```sql
UPDATE "Meeting"
SET status = 'finishing', ended_at = now()
WHERE id = '<MEETING_ID>' AND status = 'active';
```

После этого вручную поставить job в очередь:

```bash
bun run scripts/enqueue-merge.ts <MEETING_ID>
```

(Скрипт нужно дописать или вручную через `redis-cli LPUSH bull:merge:wait ...`.)

## Escalation

- Если `livekit_room_total` >0 более суток на нескольких комнатах сразу — есть подозрение на потерю webhook'ов. Эскалация: @backend-on-call.
- Если recovery не отрабатывает (статус не меняется) — @lead-engineer.
