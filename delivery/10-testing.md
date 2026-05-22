# 10 — Стратегия тестирования

## Уровни

| Уровень | Что покрывает | Инструмент | Run где |
|---|---|---|---|
| Unit | Pure functions, классы, утилиты | pytest / Go test / Vitest | Локально + CI на каждый PR |
| Integration | Сервис + БД + Kafka | pytest + Testcontainers | CI |
| Contract | API совпадает с OpenAPI | Schemathesis | CI на каждый PR |
| E2E | Пользовательские сценарии в браузере | Playwright | CI на staging |
| Load | Производительность под нагрузкой | k6 | Раз в неделю на staging |
| AI-quality | Качество ответов LLM | Promptfoo + golden set | CI + nightly |
| Mutation | Покрытие тестов для критичных модулей | mutmut | Раз в неделю |

## Coverage targets

- Backend Python: 80%+ unit + integration.
- Backend Go: 80%+.
- Frontend: 70%+.
- Critical paths (auth, RBAC, ingest, payment-related): 95%+.
- AI-quality golden set: precision/recall не падает > 5% на коммит.

## Quality gates

PR блокируется, если:

- Любой failed test.
- Coverage упал > 2% от main.
- Schemathesis нашёл несоответствие OpenAPI.
- AI-quality eval упал > 5%.
- Bandit / gosec / eslint-security нашли HIGH severity.
- OSV-Scanner нашёл CVE > 7.0.

## Тестовые данные

### Golden set

В `tests/fixtures/golden/`:
- 100 примеров ingest events с правильными extracted signals.
- 50 примеров запросов в чат с эталонными ответами.
- 30 примеров правильных AI-предложений связей.
- 20 примеров правильно извлечённых обещаний из транскрипций.

Поддерживается командой prompt-инженеров.

### Sample tenant

Тестовый тенант с синтетическими данными:
- 50 пользователей.
- 5 отделов.
- 10 000 raw events за 6 месяцев.
- 500 тем.
- 5000 сигналов.
- 20 целей, 50 идей, 30 решений.
- Mood-данные с двойным opt-in.

Сборка через factory-fixtures (`tests/fixtures/factories.py`).

---

## Unit-тесты

### Python (pytest)

```python
# tests/unit/test_signal_extractor.py
def test_signal_extractor_finds_pain():
    text = "Клиент жалуется на медленную поддержку"
    result = extract_signals(text, mock_llm=fixture_llm)
    assert any(s.signal_type == "client_pain" for s in result)
```

- Mock'ируем LLM-вызовы через `pytest-mock`.
- Mock'ируем PostgreSQL через `pytest-postgresql`.
- Время — через `freezegun`.

### Go

```go
// internal/ingest/normalizer_test.go
func TestNormalizeTelegramMessage(t *testing.T) {
    payload := loadFixture("telegram_text_message.json")
    event, err := NormalizeTelegram(payload)
    assert.NoError(t, err)
    assert.Equal(t, "text", event.ContentType)
}
```

### Frontend (Vitest + Testing Library)

```typescript
test('chat shows streaming tokens', async () => {
    render(<Chat />);
    const input = screen.getByPlaceholderText('Спросите...');
    await userEvent.type(input, 'Что я обещал?');
    await userEvent.click(screen.getByRole('button', {name: 'Отправить'}));
    expect(await screen.findByText(/На прошлой/)).toBeInTheDocument();
});
```

---

## Integration-тесты

### Через Testcontainers

```python
@pytest.fixture
def stack():
    with PostgresContainer("postgres:16"), \
         KafkaContainer(), \
         RedisContainer() as r:
        yield {...}

def test_ingest_to_signal_flow(stack):
    response = client.post("/api/v1/ingest/event", json={...})
    assert response.status_code == 201

    # Wait for async processing
    wait_for_event("signals.extracted", timeout=10)

    signals = get_signals_for_event(response.json()["event_id"])
    assert len(signals) > 0
```

Запуск только в CI (тяжелее unit).

### Список ключевых integration-сценариев

1. Ingest → Raw Memory → Signal Store → Theme Match.
2. Theme update → Theme scoring пересчёт.
3. Signal с client_pain → создание/обновление темы → graph link.
4. M-14 ночной reframing → merge тем-дублей.
5. Chat → routing → sub-agent → answer with evidence.
6. Permission denial → 403 + audit log.
7. Forget request → каскадное удаление.

---

## Contract-тесты

Schemathesis запускается на staging:

```bash
schemathesis run https://staging.example.ru/api/v1/openapi.json \
    --checks all --hypothesis-max-examples 100
```

Проверяет:
- Все endpoints отвечают согласно schema.
- Status codes соответствуют документированным.
- Response body matches schema.

---

## E2E-тесты (Playwright)

Запуск на staging после deploy.

```typescript
test('user can do a dump and see signals', async ({page}) => {
    await page.goto('/dump');
    await page.fill('textarea', 'Клиент жалуется что отчёт долго грузится');
    await page.click('button:has-text("Отправить")');

    await expect(page.locator('text=Записал')).toBeVisible();
    await expect(page.locator('text=боль клиента')).toBeVisible();
});

test('chat returns answer with evidence', async ({page}) => {
    await page.goto('/chat');
    await page.fill('textarea', 'Что говорят клиенты про скорость?');
    await page.click('button[aria-label="Отправить"]');

    const answer = page.locator('[data-testid="agent-answer"]');
    await expect(answer).toContainText(/скорост/i);

    const evidence = page.locator('[data-testid="evidence-item"]');
    await expect(evidence.first()).toBeVisible();
});
```

Покрытие E2E:
- Логин (обычный + SSO).
- Дамп через текст.
- Дамп через голос.
- Чат с базовыми вопросами.
- Дашборд (today, week, month).
- Корректировка AI-предложения.
- Mood чек-ин.
- Админка (создание роли, источника).
- Forget-request flow.

---

## Load-тесты (k6)

Цели на ноду middle-class (16 vCPU / 64 GB):

| Сценарий | Цель |
|---|---|
| Ingest events | 1000 req/sec, p99 < 500 ms |
| Chat first-token | 100 RPS, p95 < 4 сек |
| Dashboard load | 50 RPS, p95 < 1 сек |
| Search (hybrid) | 30 RPS, p95 < 2 сек |

```javascript
// tests/load/ingest.js
import http from 'k6/http';
export const options = {
    stages: [
        {duration: '2m', target: 100},
        {duration: '5m', target: 1000},
        {duration: '2m', target: 0},
    ],
};
export default function () {
    http.post('https://staging/api/v1/ingest/event', JSON.stringify({...}), {
        headers: {Authorization: `Bearer ${__ENV.TOKEN}`}
    });
}
```

Запуск раз в неделю на staging. При деградации > 20% от baseline — блокировка релиза.

---

## AI-quality тесты

### Promptfoo

Конфиг в `tests/ai/promptfoo.yaml`:

```yaml
prompts:
  - file://prompts/agent-customer-analyst.md

tests:
  - description: 'Распознаёт client_pain'
    vars:
      input: 'Клиент жалуется что отчёт открывается 30 секунд'
    assert:
      - type: contains
        value: 'client_pain'
      - type: llm-rubric
        value: 'Извлёк ровно один сигнал, указал тип и текст'
```

Запуск каждый PR + nightly.

### LLM-as-judge

Для качества чата:

```python
def test_chat_answer_quality():
    answer = chat("Что говорят клиенты про скорость?")
    rating = llm_judge.rate(
        question="Что говорят клиенты про скорость?",
        answer=answer,
        criteria=["accurate", "concise", "evidence-backed", "russian"]
    )
    assert rating.overall >= 4.0
```

Сильная модель-судья (Claude Opus или GPT-4) оценивает по 5 критериям.

### Drift detection

Раз в неделю — сравнение метрик качества с baseline:
- Если precision/recall сигналов упало > 5% → алерт.
- Если LLM-judge rating упал > 0.5 → алерт.
- Анализ — что изменилось (новые версии моделей, изменения промптов, изменения golden set).

---

## Mutation testing

Раз в неделю на критичных модулях:
- M-20 (RBAC).
- M-02 (ingest идемпотентность).
- M-03 (raw memory целостность).
- M-11 (linker).

```bash
mutmut run --paths-to-mutate=services/m20_privacy/
```

Цель: 90% mutation kill rate.

---

## Тесты безопасности

### SAST

- **Bandit** для Python в pre-commit + CI.
- **gosec** для Go в CI.
- **eslint-plugin-security** для JS/TS в CI.

### SCA

- **OSV-Scanner** ежедневно на main + на каждом PR.
- При нахождении CVE > 7.0 — auto-PR с обновлением.

### DAST

- **OWASP ZAP** на staging раз в неделю.
- Тестирует OWASP Top-10 паттерны.

### Container scan

- **Trivy** на каждый build образа.
- Блокировка push в registry при HIGH/CRITICAL уязвимостях.

### Secret scan

- **Gitleaks** в pre-commit.
- **TruffleHog** в CI.

---

## Тесты на soft-failures (chaos)

Раз в месяц — chaos engineering:
- Убить случайный pod.
- Симулировать недоступность LLM-провайдера.
- Заполнить диск до 95%.
- Симулировать lag Kafka consumer.
- Корраптить чексумму одного raw_event.

Проверка:
- Система восстанавливается без потери данных.
- Алерты срабатывают корректно.
- Пользовательский UX деградирует gracefully.

---

## CI/CD pipeline

```yaml
on: [push, pull_request]

jobs:
  test-unit:
    - bandit
    - gosec
    - eslint-security
    - pytest --cov=80
    - go test -cover
    - vitest run --coverage

  test-integration:
    services: [postgres, kafka, redis, falkordb]
    - pytest tests/integration

  test-contract:
    - schemathesis run

  test-ai-quality:
    - promptfoo eval

  build:
    - docker build -t harbor.local/app:${{ sha }} .
    - trivy scan
    - sign with cosign
    - push to harbor

  deploy-staging:  # only on main
    - helm upgrade --install staging ...
    - playwright test
    - k6 run smoke

  deploy-production:  # only manual
    - approval required
    - helm upgrade ...
    - smoke tests
```

---

## Регрессионная стратегия

При найденном баге:
1. Сначала тест, воспроизводящий баг.
2. Тест проходит → fix не нужен. Тест падает → пишем fix.
3. Fix мерджится только когда тест начинает проходить.
4. Тест остаётся в репо как regression test навсегда.

---

## Что **не** тестируем

- Внешние LLM-провайдеры (предполагаем работают).
- Производительность on-prem железа клиента (тестируем на reference hardware).
- UI на старых браузерах (< Safari 16, < Chrome 110, < Firefox 110).
