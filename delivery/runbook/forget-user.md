# Runbook: compliance-удаление субъекта (forget request)

## Триггер

- Запрос самого субъекта через `/me/forget`.
- Запрос третьей стороны через админ-flow (например, бывшего сотрудника, упоминаемого в данных).
- Compliance-обязательство (152-ФЗ, GDPR-аналоги для международных клиентов).

## Шаги

### 1. Регистрация запроса

В админке `/admin/forget-requests` или через API:

```bash
curl -X POST https://${TENANT}/api/v1/admin/persons/${USER_ID}/forget \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -d '{"reason": "subject request", "deadline_days": 30}'
```

Запись в `forget_requests` создаётся со статусом `pending`.

### 2. Экспорт данных (если запрашивал)

```bash
curl -X GET https://${TENANT}/api/v1/admin/persons/${USER_ID}/export?include_audit=true \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -o /tmp/export-${USER_ID}.zip
```

Архив содержит:
- Все RawEvents с этим автором.
- Все signals со ссылкой на эти RawEvents.
- Все chat_messages.
- Все mood_active_responses (если opt-in был).
- Все commitments.
- Audit-лог действий пользователя.
- Метаданные: роли, attached departments, manage history.

Передать пользователю безопасным каналом (зашифрованный link с TTL).

### 3. Подтверждение от пользователя

Пользователь подтверждает экспорт через email-link. После подтверждения — переходим к удалению.

Если пользователь не отвечает 7 дней — отправляется reminder. Если 14 дней — переход к удалению автоматически (после deadline).

### 4. Каскадное удаление

```bash
./scripts/forget-user.sh --user-id=${USER_ID} --confirm
```

Скрипт:

```python
async def forget_user(user_id: UUID):
    # 1. Mark deleted_at on raw_events (author)
    await pg.execute("""
        UPDATE raw_events SET deleted_at = NOW()
        WHERE author_ref->>'user_id' = $1
    """, user_id)

    # 2. Mark deleted_at on signals (via raw_events)
    await pg.execute("""
        UPDATE signals SET deleted_at = NOW()
        WHERE raw_event_id IN (
            SELECT id FROM raw_events WHERE author_ref->>'user_id' = $1
        )
    """, user_id)

    # 3. Drop mentions from signal_mentions
    await pg.execute("""
        DELETE FROM signal_mentions
        WHERE entity_type = 'person' AND entity_id = $1
    """, user_id)

    # 4. Drop chat sessions and messages
    await pg.execute("DELETE FROM chat_sessions WHERE user_id = $1", user_id)

    # 5. Drop mood data
    await pg.execute("DELETE FROM mood_active_responses WHERE user_id = $1", user_id)
    await pg.execute("DELETE FROM mood_consents WHERE user_id = $1", user_id)

    # 6. Drop commitments
    await pg.execute("DELETE FROM commitments WHERE person_id = $1", user_id)

    # 7. Anonymize в графе FalkorDB
    await falkor.execute("""
        MATCH (p:Person {id: $user_id})
        SET p.title = '[redacted_person]', p.id = $redacted_id
    """, user_id=user_id, redacted_id=f"redacted_{user_id}")

    # 8. Drop user record itself (soft + hard через 30 дней)
    await pg.execute("UPDATE users SET deleted_at = NOW() WHERE id = $1", user_id)

    # 9. Schedule hard delete через 30 дней (для cleanup MinIO)
    await temporal.schedule(
        "hard_delete_user_data",
        user_id=user_id,
        run_at=datetime.now() + timedelta(days=30)
    )

    # 10. Update forget_requests
    await pg.execute("""
        UPDATE forget_requests
        SET delete_completed_at = NOW(), status = 'deleted'
        WHERE target_id = $1
    """, user_id)

    # 11. Audit log
    await audit.log("forget_user_completed", user_id=user_id)
```

### 5. Hard delete через 30 дней

Cron-job `hard_delete_user_data` выполняет:

```python
async def hard_delete_user_data(user_id: UUID):
    # Удаляет все soft-deleted данные
    raw_event_ids = await pg.fetch("""
        SELECT id, minio_key FROM raw_events
        WHERE author_ref->>'user_id' = $1 AND deleted_at IS NOT NULL
    """, user_id)

    for event in raw_event_ids:
        if event.minio_key:
            await minio.delete_object("raw", event.minio_key)

    await pg.execute("""
        DELETE FROM raw_events
        WHERE author_ref->>'user_id' = $1 AND deleted_at IS NOT NULL
    """, user_id)

    await pg.execute("DELETE FROM signals WHERE deleted_at IS NOT NULL")
    await pg.execute("DELETE FROM users WHERE id = $1 AND deleted_at IS NOT NULL", user_id)

    await pg.execute("""
        UPDATE forget_requests SET completed_at = NOW(), status = 'completed'
        WHERE target_id = $1
    """, user_id)

    await audit.log("forget_user_hard_deleted", user_id=user_id)
```

### 6. Что не удаляется

Некоторые данные удалить нельзя без полной потери истории:
- **Темы и решения** — содержат суммированные интерпретации, не личные данные.
- **Знания, выведенные на основе сигналов человека** — остаются, но обезличены.
- **Audit-логи** — обязательны по законодательству. Помечаются tombstone-маркером.
- **Backups** — попадают в общий ретеншн (12 месяцев), не выборочно.

Это документируется в политике конфиденциальности компании-клиента.

### 7. Проверка

После завершения:

```bash
./scripts/verify-forget.sh --user-id=${USER_ID}
```

Скрипт проверяет:
- Нет записей в raw_events с author = user_id.
- Нет записей в chat_sessions.
- Нет записей в commitments.
- В графе нет узла Person с id = user_id (только [redacted]).
- В audit-логе есть запись о завершении.

Если что-то не удалилось → SEV-1 (compliance breach).

## Re-create user (reactivation)

Если бывший сотрудник возвращается — создаётся **новый** user record. Не «восстанавливаем» удалённого.

## Drill

Раз в месяц на тестовом тенанте:

```bash
./scripts/forget-drill.sh
```

Создаёт тестового пользователя, заливает 100 событий, прогоняет forget-flow, верифицирует.

Падение drill → SEV-2.
