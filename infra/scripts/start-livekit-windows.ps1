# Запуск LiveKit Server для локального теста на Windows.
#
# Использование:
#   PS> .\infra\scripts\start-livekit-windows.ps1
#
# Что делает:
#   - запускает infra/livekit/bin/livekit-server.exe с infra/livekit/livekit-local.yaml
#   - LiveKit становится доступен на ws://localhost:7880
#   - webhooks идут на http://localhost:3000/webhooks/livekit
#
# Перед запуском — должны быть подняты z-redis (docker-compose) и backend.

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Binary = Join-Path $ProjectRoot 'infra/livekit/bin/livekit-server.exe'
$Config = Join-Path $ProjectRoot 'infra/livekit/livekit-local.yaml'

if (-not (Test-Path $Binary)) {
    Write-Error "LiveKit бинарник не найден: $Binary. Скачай с https://github.com/livekit/livekit/releases"
    exit 1
}

if (-not (Test-Path $Config)) {
    Write-Error "Конфиг не найден: $Config"
    exit 1
}

Write-Host "Запускаю LiveKit Server..." -ForegroundColor Green
Write-Host "  binary: $Binary"
Write-Host "  config: $Config"
Write-Host "  url:    ws://localhost:7880"
Write-Host ""

& $Binary --config $Config
