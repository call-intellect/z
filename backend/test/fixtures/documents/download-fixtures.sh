#!/usr/bin/env bash
# download-fixtures.sh
# Скачивает 5 публичных русскоязычных документов для smoke-test document-ingest Фазы 0.
# Запускать из текущей директории: backend/test/fixtures/documents/
#
# Источники — публичные документы РФ и открытые данные.
# Использование исключительно для smoke-теста локально (fair use).
#
# Требования:
#   - curl (с поддержкой HTTPS)
#   - docker (для генерации scan-pdf через ghostscript и docx через pandoc)
#
# После прогона должно появиться 5 файлов:
#   - text-pdf-regulation.pdf
#   - scan-pdf-regulation.pdf
#   - contract.docx
#   - rosstat-regions.xlsx
#   - regulation.html
#
# Файлы НЕ коммитятся в git (см. .gitignore в этой же папке).

set -euo pipefail

# Использование --insecure (-k) для curl: ifap.ru, rosstat.gov.ru и pravo.gov.ru
# в России на self-signed/intermediate certs, не имеющих в default CA bundle на
# Windows-host. Это smoke-test локально, не prod-trust-chain.
CURL_OPTS="-k -L --fail --show-error --silent --max-time 120"

echo "==> 1/5: text-pdf-regulation.pdf — ГОСТ Р ИСО 15489-1-2019 (текстовый PDF)"
curl ${CURL_OPTS} -o text-pdf-regulation.pdf \
  "https://www.ifap.ru/library/gost/1548912019.pdf"
ls -lh text-pdf-regulation.pdf

# На Windows + Git Bash $(pwd) даёт MSYS-путь который docker не понимает.
# Используем явный native-Windows путь через cygpath -w если есть, иначе сам pwd -W.
if command -v cygpath > /dev/null; then
  HOST_DIR="$(cygpath -w "$(pwd)")"
elif pwd -W > /dev/null 2>&1; then
  HOST_DIR="$(pwd -W)"
else
  HOST_DIR="$(pwd)"
fi
echo "  (HOST_DIR для docker volume: ${HOST_DIR})"

# Отключаем MSYS-конвертацию путей в команде docker (иначе /work → C:/Program Files/Git/work)
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

echo "==> 2/5: scan-pdf-regulation.pdf — генерируем скан из text-PDF через poppler+img2pdf в Docker"
# Берём первые 8 страниц text-PDF, растеризуем в PNG 150 DPI и собираем обратно в PDF.
# Получается image-only PDF без text-слоя, эквивалентный реальному скану по входу для OCR.
docker run --rm -v "${HOST_DIR}:/work" -w /work python:3.12-slim bash -c "
  apt-get update -qq && apt-get install -y -qq --no-install-recommends poppler-utils > /dev/null
  pip install --quiet img2pdf
  mkdir -p /tmp/pages
  pdftoppm -r 150 -png -f 1 -l 8 /work/text-pdf-regulation.pdf /tmp/pages/p
  img2pdf /tmp/pages/p-*.png -o /work/scan-pdf-regulation.pdf
"
ls -lh scan-pdf-regulation.pdf

echo "==> 3/5: contract.docx — конвертация text-PDF в DOCX через pandoc в Docker"
# pandoc прямо не умеет читать PDF; маршрут: pdftotext → markdown-обёртка → DOCX.
docker run --rm -v "${HOST_DIR}:/work" -w /work python:3.12-slim bash -c "
  apt-get update -qq && apt-get install -y -qq --no-install-recommends poppler-utils pandoc > /dev/null
  pdftotext -layout /work/text-pdf-regulation.pdf /tmp/text.txt
  # Pandoc читает plain text как markdown по умолчанию; для лучшей структуры — пометим как md
  pandoc -f markdown -t docx -o /work/contract.docx /tmp/text.txt
"
ls -lh contract.docx

echo "==> 4/5: rosstat-regions.xlsx — открытые данные по регионам"
curl ${CURL_OPTS} -o rosstat-regions.xlsx \
  "https://54.rosstat.gov.ru/storage/mediabank/region16-29.xlsx"
ls -lh rosstat-regions.xlsx

echo "==> 5/5: regulation.html — статичная Wikipedia статья «Документ» (русский)"
# Изначально пробовали publication.pravo.gov.ru — но это SPA, контент грузится JS,
# скачанный HTML почти пустой. Wikipedia даёт реальный статичный регламентоподобный
# текст на русском, что и нужно для проверки Docling HTML-парсера.
curl ${CURL_OPTS} -o regulation.html \
  "https://ru.wikipedia.org/wiki/%D0%94%D0%BE%D0%BA%D1%83%D0%BC%D0%B5%D0%BD%D1%82"
ls -lh regulation.html

echo ""
echo "==> Готово. Проверка MIME-типов:"
for f in text-pdf-regulation.pdf scan-pdf-regulation.pdf contract.docx rosstat-regions.xlsx regulation.html; do
  if command -v file > /dev/null; then
    file "$f"
  else
    echo "$f: $(stat -c%s "$f" 2>/dev/null || stat -f%z "$f") байт"
  fi
done

echo ""
echo "==> Все 5 фикстур готовы для smoke-test."
