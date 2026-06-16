import {
  All,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

import { AdminSettingsService } from '../admin/settings/admin-settings.service';

import { BitrixIntegrationService } from './bitrix-integration.service';

/**
 * Public-приёмник событий установки Bitrix24 (способ B).
 * ТЗ: plans/tz/2026-06-09-bitrix24-integration-install.md.
 *
 * Маршрут: `POST /api/v1/bitrix/install/event` (без авторизации — зовёт Bitrix).
 * Bitrix присылает `application/x-www-form-urlencoded` с вложенными `auth[...]`
 * (парсится express.urlencoded extended:true в объект `auth`).
 *
 *   - `ONAPPINSTALL`   → сохранить токены портала в `pending` (привязка к org —
 *     позже через claim из iframe-handler).
 *   - `ONAPPUNINSTALL` → пометить `disconnected` (подлинность по application_token).
 *
 * Best-effort: на любую внутреннюю ошибку отвечаем 200, чтобы Bitrix не
 * зацикливал ретраи. Kill-switch — `bitrix.enabled`.
 */
@ApiExcludeController()
@Controller('api/v1/bitrix/install')
export class BitrixInstallController {
  private readonly logger = new Logger(BitrixInstallController.name);

  constructor(
    @Inject(BitrixIntegrationService)
    private readonly service: BitrixIntegrationService,
    @Inject(AdminSettingsService)
    private readonly adminSettings: AdminSettingsService,
  ) {}

  @Post('event')
  @HttpCode(HttpStatus.OK)
  async event(@Body() body: unknown): Promise<{ ok: true }> {
    try {
      const enabled =
        (await this.adminSettings.get<boolean>('bitrix.enabled', true)) ?? true;
      if (!enabled) {
        this.logger.debug('bitrix install event: bitrix.enabled=false — no-op');
        return { ok: true };
      }

      const root = asRecord(body);
      const event = String(root['event'] ?? '').toUpperCase();
      const auth = asRecord(root['auth']);
      const applicationToken =
        str(root['application_token']) ?? str(auth['application_token']);

      if (event === 'ONAPPINSTALL') {
        await this.service.onAppInstall({
          member_id: str(auth['member_id']),
          access_token: str(auth['access_token']),
          refresh_token: str(auth['refresh_token']),
          expires_in: str(auth['expires_in']),
          domain: str(auth['domain']),
          client_endpoint: str(auth['client_endpoint']),
          server_endpoint: str(auth['server_endpoint']),
          scope: str(auth['scope']),
          application_token: applicationToken,
        });
      } else if (event === 'ONAPPUNINSTALL') {
        await this.service.onAppUninstall({
          member_id: str(auth['member_id']),
          application_token: applicationToken,
        });
      } else {
        this.logger.debug(`bitrix install event: неизвестное событие "${event}"`);
      }
    } catch (err) {
      this.logger.error(
        `bitrix install event: обработка не удалась — отвечаю 200: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return { ok: true };
  }

  /**
   * iframe-handler установки (способ B), отдаётся самим backend — чтобы весь
   * поток был под одним origin туннеля `:3000` (фронтовая `/bitrix/install`
   * остаётся как альтернатива при размещении фронта).
   *
   * Маршрут: `(GET|POST) /api/v1/bitrix/install/handler`. Bitrix открывает его в
   * iframe внутри портала и POST-ит `member_id`, `AUTH_ID`/`REFRESH_ID`,
   * `AUTH_EXPIRES`, `DOMAIN`, `PLACEMENT`, … Мы:
   *   1. (best-effort) сохраняем токены портала в `pending` прямо из этого POST —
   *      не завязываясь на доставку `ONAPPINSTALL`;
   *   2. отдаём HTML, который грузит BX24 SDK и зовёт `BX24.installFinish()`,
   *      чтобы Bitrix считал установку завершённой.
   *
   * Привязка к org Коры (claim) делается позже из кабинета (нужна сессия Коры).
   * Frame-заголовки точечно ослабляем (глобальный `X-Frame-Options: DENY` иначе
   * блокирует встраивание в портал).
   */
  @All('handler')
  async handler(@Body() body: unknown, @Res() res: Response): Promise<void> {
    try {
      const enabled =
        (await this.adminSettings.get<boolean>('bitrix.enabled', true)) ?? true;
      if (enabled) {
        const root = asRecord(body);
        const auth = asRecord(root['auth']);
        const memberId = str(root['member_id']) ?? str(auth['member_id']);
        const domain =
          str(root['DOMAIN']) ?? str(root['domain']) ?? str(auth['domain']);
        const accessToken = str(root['AUTH_ID']) ?? str(auth['access_token']);
        const refreshToken = str(root['REFRESH_ID']) ?? str(auth['refresh_token']);
        const expiresIn = str(root['AUTH_EXPIRES']) ?? str(auth['expires_in']);

        if (memberId && accessToken && refreshToken) {
          await this.service.onAppInstall({
            member_id: memberId,
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: expiresIn,
            domain,
            client_endpoint: domain ? `https://${domain}/rest/` : undefined,
          });
        } else {
          this.logger.debug(
            'bitrix install handler: нет member_id/токенов в POST — рендерю страницу без сохранения',
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `bitrix install handler: сохранение токенов не удалось (продолжаю рендер): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Глобальный helmet ставит X-Frame-Options: DENY (+ в prod CSP frame-ancestors
    // 'none') — снимаем для этого роута и разрешаем встраивание доменам Bitrix24.
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', BITRIX_FRAME_CSP);
    res.type('html').send(renderInstallHtml());
  }
}

/** CSP `frame-ancestors` — кто может встраивать handler в iframe (домены Bitrix24). */
const BITRIX_FRAME_CSP = `frame-ancestors 'self' ${[
  'ru',
  'com',
  'kz',
  'by',
  'ua',
  'de',
  'eu',
  'fr',
  'it',
  'es',
  'pl',
  'in',
  'team',
]
  .map((tld) => `https://*.bitrix24.${tld}`)
  .join(' ')}`;

/** Самодостаточная HTML-страница установки: BX24.init → installFinish(). */
function renderInstallHtml(): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Установка «Кора»</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#f6f7f9; margin:0;
         display:flex; min-height:100vh; align-items:center; justify-content:center; }
  .card { background:#fff; border:1px solid #e6e8eb; border-radius:12px; padding:28px 32px;
          max-width:420px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,.06); }
  h1 { font-size:18px; margin:0 0 8px; color:#1a1a1a; }
  p { font-size:14px; color:#5a6472; margin:0; }
</style>
</head>
<body>
  <div class="card">
    <h1>Кора → Bitrix24</h1>
    <p id="msg">Завершаем установку…</p>
  </div>
  <script src="https://api.bitrix24.com/api/v1/"></script>
  <script>
    (function () {
      function say(t) { var m = document.getElementById('msg'); if (m) m.textContent = t; }
      if (typeof BX24 === 'undefined') { say('Не удалось загрузить BX24 SDK.'); return; }
      BX24.init(function () {
        try { BX24.installFinish(); } catch (e) {}
        say('Готово! Приложение «Кора» установлено. Можно закрыть это окно.');
      });
    })();
  </script>
</body>
</html>`;
}

/** Безопасно привести к объекту-записи. */
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Достать строку (Bitrix form-encoded шлёт всё строками). */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
