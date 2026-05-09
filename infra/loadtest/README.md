# infra/loadtest — k6 сценарии нагрузочного тестирования

## Установка k6

```bash
# macOS
brew install k6

# Linux (deb)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

## Сценарий `scenario-meeting.js`

Покрывает HTTP-уровень MVP: создание встречи через Crossmark API + публичные
endpoint'ы `/access`, `/health`, `/metrics`. **LiveKit WS-нагрузку он не
эмулирует** — для этого нужен полноценный браузерный harness (Playwright +
LiveKit-client). Для MVP-релиза достаточно HTTP-уровня; полный LiveKit-load
запланирован на V1.1.

### Запуск

```bash
# 1. Создать интеграционный ключ для нагрузочного партнёра.
cd ../../backend
INT_KEY=$(bun run scripts/create-integration-key.ts loadtest)

# 2. Запустить сценарий.
cd ../infra/loadtest
k6 run \
  -e BACKEND=https://z.crossmark.ru \
  -e INTEGRATION_KEY=$INT_KEY \
  scenario-meeting.js
```

### Что измерять

| Метрика                     | Где смотреть                       | Порог       |
|-----------------------------|------------------------------------|-------------|
| http_req_duration p95       | k6 summary                         | < 500 ms    |
| http_req_failed             | k6 summary                         | < 1%        |
| CPU vm-backend              | Grafana (node-exporter)            | < 70%       |
| Memory vm-backend           | Grafana (node-exporter)            | < 70%       |
| BullMQ pending+active jobs  | Grafana (`bullmq_*`)               | стабильно   |
| `livekit_room_total`        | Grafana z-livekit                  | соответствует созданным |
| AI-pipeline duration p95    | Grafana z-ai-pipeline              | < 180 s     |

### DoD сценария

- [ ] 50 параллельных встреч прошли без 5xx.
- [ ] CPU/Memory ниже порогов на всех нодах.
- [ ] AI-pipeline всех тестовых встреч дошёл до `ai_ready` (если в env есть Vox/LLM).
- [ ] Алерт `HighMeetingFailureRate` НЕ сработал во время теста.

## Roadmap

- `scenario-livekit.js` (V1.1) — Playwright-сценарий с реальным WebRTC-подключением.
- `scenario-egress-storm.js` (V1.1) — параллельные старты Egress.
