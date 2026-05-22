# 08 — Безопасность и приватность

Этот документ — обязательный для всех команд. Безопасность не «добавляется потом», она встроена в архитектуру с первого дня.

## Содержание

1. Threat model
2. Аутентификация
3. RBAC (M-20)
4. Visibility Matrix
5. Retention Policy
6. Защита данных
7. Этические рамки (Mood, M-19)
8. Audit и compliance
9. Удаление данных (право на забвение)
10. Secrets management
11. Network security
12. 152-ФЗ соответствие
13. Запрещённые практики

---

## 1. Threat model

### Активы, которые защищаем

1. **Сырые данные** в M-03 — переписки, голос, файлы, метрики.
2. **Извлечённые сигналы и темы** — выводы AI о компании.
3. **Граф знаний** — связи между сущностями.
4. **Личные данные сотрудников** — имена, должности, mood-данные.
5. **Бизнес-данные** из CRM/ERP/метрик.
6. **API-ключи к LLM-провайдерам** — финансовый риск.
7. **Учётные данные коннекторов** к внешним системам.

### Кого боимся

| Угроза | Вероятность | Влияние | Защита |
|---|---|---|---|
| Внешний злоумышленник через интернет | Средняя | Критическое | Caddy + WAF, аутентификация, RBAC, шифрование, изоляция |
| Внутренний злоумышленник (сотрудник тенанта) | Средняя | Среднее | RBAC + audit trail + 4-eyes для критичных операций |
| Утечка API-ключей | Высокая | Среднее | OpenBao, ключи короткоживущие, не в коде |
| Атака через цепочку поставок (зависимости) | Средняя | Высокое | SCA сканер, lockfiles, проверка подписей |
| Prompt injection | Высокая | Среднее | Sandbox-промпты, audit, лимиты привилегий |
| Утечка между тенантами | Низкая (single-tenant!) | Критическое | Архитектурное single-tenant deployment |
| Кража HW в офисе клиента | Низкая | Высокое | Encryption-at-rest, MFA, удалённое блокирование |
| Социальная инженерия (phishing админа) | Средняя | Высокое | MFA обязателен, обучение, лимит привилегий |
| Compliance-нарушение (152-ФЗ) | Средняя | Критическое (штрафы, бан) | Audit, локализация, правила ниже |

---

## 2. Аутентификация

### Обязательно

- **Identity Provider:** Keycloak self-host. SAML / OIDC.
- **MFA:** обязательно для всех ролей с уровнем L0 (владелец) и L1 (C-level). Опционально для остальных.
- **SSO:** интеграция с Active Directory / LDAP / Google Workspace через OIDC.
- **Срок жизни access-token:** 15 минут.
- **Срок жизни refresh-token:** 8 часов (с rolling renewal).
- **Lockout:** 5 неудачных попыток → блокировка на 15 минут + email-уведомление.
- **Минимальная длина пароля:** 12 символов + обязательная сложность ИЛИ passkeys (FIDO2).
- **Без паролей по умолчанию:** для новых клиентов рекомендуем magic-link или passkeys.

### Сессии

- JWT в `Authorization: Bearer` заголовке.
- Никаких cookies для основной аутентификации (только CSRF-token для frontend-сессий).
- HttpOnly + Secure + SameSite=Strict для всех cookies.
- Logout инвалидирует refresh-token (через blacklist в Valkey, TTL = ~refresh expiry).

### API-ключи (для интеграций)

- Long-lived API-keys для серверных интеграций — генерируются через админку.
- Хранятся как hash (bcrypt). Plaintext показывается ровно один раз при создании.
- Каждый ключ имеет scope (какие endpoints) и origin (какой IP).
- Rotation — раз в 90 дней (рекомендация, не обязательно).

---

## 3. RBAC — три измерения

### Измерение 1: функциональная роль

Преднастроенный список (изменяется только админом):

| Код | Название | Скоуп данных по умолчанию |
|---|---|---|
| `owner` | Владелец | Полный доступ ко всему |
| `cmo` | Директор по маркетингу | Маркетинг + голос клиента + бренд |
| `cso` | Директор по продажам | Pipeline + голос клиента + продажи |
| `coo` | Операционный директор | Операции + процессы + риски |
| `cto` | Технический директор | Продукт + технические сигналы + идеи |
| `cfo` | Финансовый директор | Финансы + метрики + влияние |
| `chro` | HR-директор | Команда + employee voice + mood (агрегатно) |
| `dept_head` | Руководитель отдела | Всё в своём отделе |
| `team_lead` | Тимлид | Всё в своей команде |
| `member` | Сотрудник | Свой персональный поток |
| `product_owner` | Владелец продукта | Один product-scope |
| `external_advisor` | Внешний советник | Только то, что явно расшарили |

### Измерение 2: иерархический уровень

| Уровень | Глубина |
|---|---|
| `L0` | Владелец — видит всё |
| `L1` | C-level — функциональный срез на уровне компании |
| `L2` | Руководитель отдела — всё в своём отделе |
| `L3` | Тимлид — всё в своей команде |
| `L4` | Рядовой сотрудник — свой поток |

### Измерение 3: кастомизация

Через OpenFGA — любые правила:
- «Иван видит данные только проекта X».
- «Мария видит mood-агрегаты только команды разработки».
- «Внешний консультант N видит только тему M».

### Реализация

**OpenFGA** (primary) — Zanzibar-модель.

Пример schema:

```fga
type user

type department
  relations
    define member: [user]
    define lead: [user]
    define parent: [department]

type signal
  relations
    define data_class: data_class_value
    define source_dept: [department]
    define mentions_person: [user]
    define readable: (data_class is public)
                  or (data_class is internal and is_member_of_company)
                  or (source_dept->member and data_class is sensitive)
                  or owner

type theme
  relations
    define readable: ...

type goal
  relations
    define readable: ...
```

Проверка: `Check(user="alice", relation="readable", object="signal:01H...") → bool`.

**Casbin fallback** — если OpenFGA не пройдёт PoC по latency. Готовая схема — в `schemas/casbin-policy.csv`.

### Row-Level Security

Дополнительный слой защиты в PostgreSQL — даже если OpenFGA-проверка пропущена, RLS отсечёт.

```sql
SET app.user_id = '01H...';
SET app.user_clearance = 2;  -- enum: 0=public, 1=internal, 2=sensitive, 3=private

-- автоматически применяется
SELECT * FROM signals;  -- вернёт только то, что доступно
```

### Where check happens

- API Gateway middleware → OpenFGA проверка → `403` если нет доступа.
- Сервисный слой → дополнительно RLS на чтение.
- В графе (FalkorDB) → фильтрация рёбер по `data_class` каждого конца.
- В выдаче — никаких намёков на скрытое («объект существует, но вам недоступен»).

### Назначение ролей при онбординге

Через диалоговый wizard в админке:

```
AI: «Какая структура управления у вас в компании?»
   → AI предлагает: «Похоже, у вас классическая C-level структура. Назначить владельца, CMO, CSO, COO, CTO, CFO, HR?»
   → Владелец: «У нас нет HR, есть только Директор по операциям»
   → AI: «Понял, тогда отключу chro, оставлю coo. Нужны ли отделы?»
   → ...
```

После онбординга — конкретное назначение через `/admin/users/{id}/roles`.

---

## 4. Visibility Matrix — четыре измерения

Дополняет RBAC. Каждый объект несёт:

1. **`source_class`** — откуда пришла запись:
   - `public` — публичный канал, любой сотрудник может видеть.
   - `team` — командный канал, видят участники.
   - `private` — личное / DM, видит только автор и получатель.
   - `sensitive` — финансы, юридика, mood — особый доступ.

2. **`knowledge_type`** (для derived сущностей):
   - `strategy` / `customer_voice` / `internal_ops` / `mood` / `financial` / `legal` / `hr` / `technical`.

3. **`P-attributes`** — флаги защиты:
   - `pii` — личные данные.
   - `salary` — данные о зарплатах.
   - `legal_privileged` — юридическая привилегия.
   - `medical` — медицинские данные.
   - `client_nda` — данные под NDA с клиентом.

4. **Роль читающего** — из RBAC.

### Матрица соответствия (упрощённая)

| Knowledge type | owner | cmo | cso | cfo | chro | dept_head | team_lead | member |
|---|---|---|---|---|---|---|---|---|
| strategy | ✓ | ✓ | ✓ | ✓ | (–) | (–) | (–) | (–) |
| customer_voice | ✓ | ✓ | ✓ | (–) | (–) | по отделу | по команде | свои |
| internal_ops | ✓ | (–) | (–) | (–) | (–) | по отделу | по команде | свои |
| mood (агрегат) | ✓ | (–) | (–) | (–) | ✓ | по отделу | по команде | свои |
| mood (личный) | свой | свой | свой | свой | свой | свой | свой | свой |
| financial | ✓ | (–) | (–) | ✓ | (–) | (–) | (–) | (–) |
| legal | ✓ (с pii: ✗) | (–) | (–) | (–) | (–) | (–) | (–) | (–) |
| hr | ✓ | (–) | (–) | (–) | ✓ | по отделу (агрегат) | (–) | свой |

`(–)` — нет доступа. `по отделу/команде` — только в своём scope. `свой` — только свои данные.

Для P-атрибутов — дополнительные ограничения:
- `salary` → только `cfo` + `owner` + сам субъект.
- `legal_privileged` → только `owner` + явно назначенный юрист.
- `medical` → только сам субъект.

### Реализация

Visibility-логика инкапсулирована в OpenFGA. При каждом запросе:

1. API Gateway получает `user_id`, `target_object_id`.
2. Делает `Check(user, "readable", target)` в OpenFGA.
3. Если `false` → 403.
4. Если `true` → пропускает, RLS дополнительно проверяет.

---

## 5. Retention Policy

| Тип знания | Срок хранения | Механизм удаления | Пример |
|---|---|---|---|
| Эфемерное | 7 дней | Cron hard-delete | Черновик в дампе, не отправленный, тулз-вызовы агентов |
| Сессия | 90 дней | Cron hard-delete | История одного разговора с AI, контекст одной встречи |
| Проект | До закрытия + 1 год | Soft-delete + архив | Контекст активного проекта/инициативы |
| Долгосрочное | Бессрочно | Только compliance-удаление | Стратегия, ценности, ключевые решения, ADR |
| Сырьё первоисточников | 7 лет (152-ФЗ) | По запросу субъекта | RawEvent с PII |
| Mood-личные | 1 год | Hard-delete | Ответы чек-ина |
| Mood-агрегаты | Бессрочно | Безличны, остаются | Среднее по командам |
| Audit-логи | 3 года | Архив в холодное хранилище | access_audit_log, agent_actions |
| Backups | 12 месяцев + 5 лет годовых | Restic lifecycle | Полный backup системы |

### Decay-функция

Веса тем (M-09) уменьшаются с возрастом:

```python
weight(t) = base_weight * exp(-lambda * (now - last_signal_at).days)

lambda по data_class:
- public: 0.01    # медленный декей (~70 дней до половины)
- internal: 0.02
- sensitive: 0.03
- private: 0.05   # быстрый декей
```

После `weight < 0.1` тема переходит в `archived`.

### Конфигурация retention

Админ может изменить в `/admin/retention/policy`. Изменения применяются с момента изменения, не задним числом.

---

## 6. Защита данных

### Encryption-at-rest

- **PostgreSQL:** TDE через CYBERTEC или LUKS на уровне диска ОС. Для self-host инсталляций — рекомендуем LUKS как простое решение.
- **MinIO:** SSE-S3 с ключами в OpenBao.
- **FalkorDB:** Redis AOF + LUKS на диске.
- **Backups:** Restic шифрует своим ключом, ключи в OpenBao.

### Encryption-in-transit

- **Между frontend и API:** TLS 1.3, обязательный HSTS.
- **Между сервисами:** mTLS (опционально через Linkerd service mesh) для k8s-инсталляций. Для docker-compose — внутренняя сеть достаточна.
- **К внешним LLM:** обязательно HTTPS.
- **Внутренние event bus:** Kafka SASL/SSL.

### Защита от утечек

- **DLP в UI:** при копировании данных с `data_class >= sensitive` показывается toast «Эти данные конфиденциальны». Без блокировки.
- **Watermarking:** экспорты содержат `tenant_id` + `user_id` + `timestamp` в metadata, для трассировки утечки.
- **No copy in clipboard auto:** UI не копирует автоматически в clipboard.

### Шифрование персональных данных

Поля с PII (имена, телефоны, почты) хранятся в открытом виде, но:
- Доступ к таблицам с PII — через RLS + OpenFGA.
- При экспорте — обязательная трассировка.
- При удалении субъекта — каскадное стирание.

---

## 7. Этические рамки (Mood, M-19)

См. [03-modules-catalog.md](03-modules-catalog.md), M-19. Здесь — формальные правила.

### Двойной opt-in

```sql
-- Уровень 1: компания
CREATE TABLE company_settings (
    id INT PRIMARY KEY DEFAULT 1,
    mood_module_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mood_enabled_by UUID,
    mood_enabled_at TIMESTAMPTZ
);

-- Уровень 2: сотрудник
CREATE TABLE mood_consents (
    user_id UUID PRIMARY KEY,
    user_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    user_opt_in_at TIMESTAMPTZ,
    user_revoked_at TIMESTAMPTZ
);
```

Без обоих `enabled = true` модуль для сотрудника не работает.

### Whitelist сигналов M-19

В коде — закрытый список. Изменение требует security-review.

```python
MOOD_PASSIVE_SIGNAL_WHITELIST = {
    "slack_public_tone",
    "slack_public_burnout_mentions",
    "calendar_meeting_load_pct",
    "calendar_outside_hours_pct",
    "github_velocity_zscore",
    "task_tracker_throughput_zscore",
}
```

Любой не-whitelist сигнал отвергается на уровне `mood_passive_signals`.

**Никогда:**
- не анализируем личные DM (Slack DM, личные мессенджеры);
- не читаем письма;
- не анализируем голос в личных созвонах;
- не используем medical / health данные.

### k-anonymity

Агрегаты по командам < 5 человек — не показываются. Срабатывает в API:

```python
def get_team_mood(department_id):
    sample = mood_responses.filter(department_id=department_id, period=last_7d)
    if len(sample) < 5:
        return {"insufficient_sample": True, "minimum_required": 5}
    return aggregate(sample)
```

### Скрытое индивидуальное уведомление

Если у сотрудника `mood_self < 3` 5 дней подряд:

```python
notify_user(
    user_id=user.id,
    text=f"Если хочется поговорить — напиши {user.trust_contact}."
)
```

**Только сам сотрудник** видит это уведомление. Менеджеру / HR ничего не идёт.

### Если сотрудник отозвал opt-in

- Все его данные в `mood_active_responses` помечаются `deleted_at`.
- Через 30 дней — hard-delete.
- В агрегатах за прошлые периоды — пересчёт без него.

---

## 8. Audit и compliance

### Что логируется

Каждое действие:

```sql
INSERT INTO access_audit_log (user_id, action, target_type, target_id, allowed, denial_reason)
VALUES ('01H...', 'read', 'signal', '01H...', true, null);
```

Поля логируются для:
- Чтения объектов с `data_class >= sensitive`.
- Любых mutate-операций.
- Каждого вызова admin API.
- Каждого compliance-удаления.
- Каждого экспорта.
- Каждого изменения ролей.

### Поиск по audit

Админская страница `/admin/access/audit`:

```
- Фильтр: user, period, target_type, action.
- Просмотр кто что читал и когда.
- Экспорт CSV.
```

### AI-actions

Отдельный лог `agent_actions` (см. [05-data-schema.md](05-data-schema.md)).

### Соответствие 152-ФЗ

См. отдельный раздел ниже.

---

## 9. Удаление данных (право на забвение)

### Триггеры

1. **Запрос самого субъекта** — через UI «Удалить мой след».
2. **Запрос третьей стороны** — через админ-flow (например, бывший клиент просит удалить упоминания).
3. **Compliance-обязательство** — например, обязательное удаление данных уволившегося сотрудника.

### Flow

```
1. Запрос регистрируется в forget_requests с deadline = now + 30 дней.
2. До deadline — экспорт всех данных пользователю (если запрашивал).
3. После экспорта (или отмены клиента) — каскадное удаление:

   - raw_events с author_ref = user → marked deleted_at, через 24h hard-delete + удаление MinIO blob.
   - signals со ссылкой на эти raw_events → удаляются.
   - signal_mentions с user_id → удаляются.
   - chat_messages user_id → удаляются.
   - mood_active_responses → удаляются.
   - В графе (FalkorDB) — упоминания заменяются на узел `[redacted_person]`.
   - В темах: статистика пересчитывается.

4. После каскада — запись в forget_requests.completed_at.
```

### API

```
POST /admin/persons/{user_id}/export   → возвращает архив
POST /admin/persons/{user_id}/forget   → запускает forget
GET  /admin/persons/{user_id}/forget/status  → текущий статус
```

### Тест

Раз в месяц на стейдже — реальный прогон удаления тестового пользователя + verification.

---

## 10. Secrets management

### Где хранятся

**OpenBao** (Apache 2.0 fork от Vault). Все секреты — в OpenBao, ничего в `.env` файлах в production.

Ротации:
- API-ключи к LLM-провайдерам — раз в 90 дней.
- DB-пароли — раз в 90 дней.
- Encryption-keys для MinIO/Restic — раз в 365 дней (с переисландром данных).
- TLS-сертификаты — Caddy auto-renew (Let's Encrypt) каждые 60 дней.

### Доступ

- Сервисы получают секреты через service account токены OpenBao.
- Локально dev — `.env.local` (в `.gitignore`).
- CI/CD — секреты из CI vault, не в репозитории.

### Сканирование утечек

- **Gitleaks** в pre-commit + CI.
- **TruffleHog** на GitHub Actions для всех PR.
- При обнаружении — блокировка merge + ротация утёкшего секрета.

---

## 11. Network security

### Внешний периметр

- **Caddy** как reverse proxy с auto-TLS.
- **WAF** через Coraza + OWASP CRS.
- **Rate-limit:** 100 req/min на IP анонимно, 1000 req/min на JWT.
- **DDoS protection:** на уровне инфраструктуры клиента (CloudFlare, Yandex DDoS Protection или аналог).

### Внутренний периметр

- **Сервисы не выставлены наружу.** Только Caddy наружу слушает.
- **PostgreSQL/FalkorDB/MinIO** — только private network.
- **Доступ админа:** через bastion VPN.

### Egress контроль

- Список разрешённых исходящих доменов в каждом сервисе (whitelist):
  - `api.anthropic.com`
  - `api.openai.com`
  - `generativelanguage.googleapis.com`
  - адреса коннекторов M-40 (Bitrix24, amoCRM и т.п.)
  - адреса наших инфра-сервисов.
- Любой исходящий запрос на не-whitelist домен — блокируется + алерт.

---

## 12. 152-ФЗ соответствие

### Ключевые требования

1. **Хранение ПД на территории РФ.** Серверы — только в РФ. Backups — только в РФ.
2. **Уведомление Роскомнадзора** — клиент сам подаёт уведомление об обработке ПД, мы предоставляем шаблон.
3. **Согласие субъекта на обработку** — через onboarding + явный consent чек-бокс при регистрации (исключение из правила «никаких форм» — это compliance, не пользовательский UX).
4. **Право на доступ к своим данным** — через `/me/export`.
5. **Право на удаление** — через `/me/forget`.
6. **Журнал обработки ПД** — `pii_processing_log` (часть audit).
7. **Отдельный ответственный за ПД** — указывается в админке тенанта.
8. **Шифрование ПД** — при хранении и передаче.

### Маркировка ПД

Каждое поле, содержащее ПД, помечено в схеме комментарием `-- PII`:

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    display_name TEXT NOT NULL, -- PII
    email TEXT,                   -- PII
    -- ...
);
```

CI-проверка: для каждого `-- PII` поля должна быть RLS-политика.

### Документация для клиента

В пакете `runbook/152-fz-checklist.md` — что клиент должен сделать для соответствия:
- Уведомление в РКН.
- Внутренние политики обработки ПД.
- Назначение ответственного.
- Шаблоны согласий с сотрудниками.

---

## 13. Что **запрещено**

1. **API-ключи в коде или env-файлах в репозитории.** Только OpenBao / managed secrets.
2. **PII в логах.** Имена, email, телефоны — никогда. Только UUID.
3. **PII в URL/query params.** Только в body POST-запросов.
4. **Анонимная telemetry с пользовательскими данными.** Если посылаем metrics наружу (наш мониторинг ошибок) — только UUID без content.
5. **Hardcoded credentials в Docker images.** Из vault через runtime.
6. **Незашифрованные backups.**
7. **Доступ к production через личные ключи разработчиков.** Только через bastion + audit.
8. **`SELECT *` без RLS контекста.** Каждый запрос к таблице с `data_class` — должен быть в контексте RLS.
9. **Отключение audit-логов даже временно.** Если упало — алерт + блокировка mutating операций.
10. **Прямой доступ frontend к LLM API.** API-ключи никогда не достигают браузера.
11. **Передача sensitive данных во внешнее облако без явного opt-in клиента.**
12. **Сжатие/обработка PII через сторонние SaaS** (Sentry SaaS, Datadog SaaS) — только self-host.
13. **Любые tracking-cookies сторонних провайдеров** в frontend.

---

## 14. Регулярные проверки

| Что | Кто | Частота |
|---|---|---|
| Penetration test | Внешняя команда | Раз в год |
| SCA-сканирование | CI + cron | Каждый деплой + ежедневно |
| Backup-restore drill | DevOps | Раз в квартал |
| Forget-flow drill | Admin | Раз в месяц |
| Secret-rotation | Админ + CI | Раз в 90 дней |
| Аудит ролей и доступов | Админ | Раз в квартал |
| Permission-creep audit | Админ | Раз в полгода |
| AI-output safety audit | Promt-инженер + Security | Раз в квартал |

---

## 15. Инцидент-менеджмент

См. `runbook/incidents.md`.

Severity-классификация:
- **SEV-1:** утечка данных, недоступность > 1 часа, потеря данных.
- **SEV-2:** недоступность критичной функции, downtime LLM 1+ час.
- **SEV-3:** деградация одного модуля.
- **SEV-4:** мелкие баги.

SLA реакции:
- SEV-1: 15 минут (24/7).
- SEV-2: 1 час (рабочее время).
- SEV-3: 1 рабочий день.
- SEV-4: 1 неделя.
