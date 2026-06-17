import {
  All,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { TypedConfigService } from '../../common/config/index';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AccountsService } from '../accounts/accounts.service';
import { LoginInvalidError } from '../accounts/exceptions/accounts-errors';
import { AdminSettingsService } from '../admin/settings/admin-settings.service';
import { JwtService } from '../auth/services/jwt.service';

import { BitrixIntegrationService } from './bitrix-integration.service';
import { BitrixBindSchema, type BitrixBindDto, type BitrixBindResult } from './dto/bitrix-install.dto';
import { BitrixSyncQueueService } from './queue/bitrix-sync.queue.service';

const SESSION_COOKIE = 'z_session';

@ApiExcludeController()
@Controller('api/v1/bitrix/install')
export class BitrixInstallController {
  private readonly logger = new Logger(BitrixInstallController.name);

  constructor(
    @Inject(BitrixIntegrationService)
    private readonly service: BitrixIntegrationService,
    @Inject(AdminSettingsService)
    private readonly adminSettings: AdminSettingsService,
    @Inject(AccountsService)
    private readonly accounts: AccountsService,
    @Inject(JwtService)
    private readonly jwt: JwtService,
    @Inject(BitrixSyncQueueService)
    private readonly syncQueue: BitrixSyncQueueService,
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService,
  ) {}

  @Post('event')
  @HttpCode(HttpStatus.OK)
  async event(@Req() req: Request, @Body() body: unknown): Promise<{ ok: true }> {
    this.logIncoming('event', req, body);
    try {
      const enabled = (await this.adminSettings.get<boolean>('bitrix.enabled', true)) ?? true;
      if (!enabled) {
        this.logger.debug('bitrix install event: bitrix.enabled=false — no-op');
        return { ok: true };
      }

      const root = asRecord(body);
      const event = String(root['event'] ?? '').toUpperCase();
      const auth = asRecord(root['auth']);
      const applicationToken = str(root['application_token']) ?? str(auth['application_token']);

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

  @All('handler')
  async handler(@Req() req: Request, @Body() body: unknown, @Res() res: Response): Promise<void> {
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', BITRIX_FRAME_CSP);

    if (req.method === 'HEAD') {
      res.status(HttpStatus.OK).end();
      return;
    }

    this.logIncoming('handler', req, body);

    const root = asRecord(body);
    const auth = asRecord(root['auth']);
    const query = asRecord(req.query);
    const memberId = str(root['member_id']) ?? str(auth['member_id']);
    const domain =
      str(root['DOMAIN']) ??
      str(root['domain']) ??
      str(auth['domain']) ??
      str(query['DOMAIN']) ??
      str(query['domain']) ??
      hostFromHeaders(req);
    const authId = str(root['AUTH_ID']) ?? str(auth['access_token']) ?? '';

    try {
      const enabled = (await this.adminSettings.get<boolean>('bitrix.enabled', true)) ?? true;
      if (enabled) {
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
            server_endpoint: str(root['SERVER_ENDPOINT']) ?? str(auth['server_endpoint']),
            scope: str(root['APPLICATION_SCOPE']) ?? str(root['SCOPE']) ?? str(auth['scope']),
            application_token: str(root['APPLICATION_TOKEN']) ?? str(auth['application_token']),
          });
        } else {
          this.logger.debug(
            'bitrix install handler: нет member_id/токенов в POST — рендерю форму без сохранения',
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

    const frontendUrl = this.cfg.auth.publicFrontendUrl;
    const view = memberId ? await this.service.getInstallView(memberId) : null;
    const portalDomain = view?.portalDomain ?? domain ?? '';

    if (!view || view.status !== 'connected' || !view.tenantId) {
      res.type('html').send(renderFormPage({ memberId, domain: portalDomain, frontendUrl }));
      return;
    }

    const actor = memberId ? await this.resolveHandlerActor(memberId, authId, req) : null;
    if (actor) {
      const sessionToken = await this.accounts.issueSession(actor.koraUserId);
      this.setIframeSession(res, sessionToken);
      const { url } = await this.accounts.issueLoginUrl(actor.koraUserId);
      void this.syncQueue.enqueue(view.tenantId, 'users').catch((err) =>
        this.logger.warn(
          `handler: не удалось поставить sync users (tenant=${view.tenantId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
      res.type('html').send(
        renderWizardPage({
          name: actor.name,
          orgName: view.orgName,
          orgId: view.tenantId,
          koraUrl: url,
        }),
      );
      return;
    }

    res.type('html').send(
      renderFormPage({
        memberId,
        domain: portalDomain,
        frontendUrl,
        notice:
          'Портал уже подключён к Коре, но ваш профиль ещё не сопоставлен с менеджером — ' +
          'обратитесь к администратору. Если вы администратор компании — войдите ниже.',
      }),
    );
  }

  private async resolveHandlerActor(
    memberId: string,
    authId: string,
    req: Request,
  ): Promise<{ koraUserId: string; name: string } | null> {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies ?? {};
    const cookieToken = cookies[SESSION_COOKIE];
    if (cookieToken) {
      try {
        const payload = this.jwt.verifySession(cookieToken);
        return { koraUserId: payload.sub, name: '' };
      } catch {
        // протухшая/чужая cookie — идём дальше
      }
    }
    const acting = await this.service.resolveActingUser(memberId, authId);
    return acting ? { koraUserId: acting.koraUserId, name: acting.name } : null;
  }

  @Post('bind')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  async bind(
    @Body(new ZodValidationPipe(BitrixBindSchema)) body: BitrixBindDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BitrixBindResult> {
    let userId: string;
    let sessionToken: string;
    try {
      const r = await this.accounts.login({ email: body.email, password: body.password });
      userId = r.user.id;
      sessionToken = r.token;
    } catch (err) {
      if (err instanceof LoginInvalidError) {
        throw new UnauthorizedException({
          ok: false,
          error: { code: 'invalid_login', message: 'Неверный логин или пароль' },
        });
      }
      throw err;
    }

    const result = await this.service.bindInstall({
      memberId: body.memberId,
      userId,
      orgId: body.orgId,
    });

    if (result.status === 'bound') {
      this.setIframeSession(res, sessionToken);
      const { url } = await this.accounts.issueLoginUrl(userId);
      return { ...result, koraUrl: url };
    }
    return result;
  }

  private setIframeSession(res: Response, token: string): void {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: this.cfg.auth.sessionTtlSeconds * 1000,
    });
  }

  private logIncoming(kind: 'event' | 'handler', req: Request, body: unknown): void {
    const root = asRecord(body);
    const auth = asRecord(root['auth']);
    const query = asRecord(req.query);
    const event = str(root['event']);
    const memberId = str(root['member_id']) ?? str(auth['member_id']);
    const domain =
      str(root['DOMAIN']) ??
      str(root['domain']) ??
      str(auth['domain']) ??
      str(query['DOMAIN']) ??
      str(query['domain']);
    this.logger.log(
      `bitrix ${kind} ← method=${req.method} ct=${req.headers['content-type'] ?? '-'} ` +
        `event=${event ?? '-'} member=${memberId ?? '-'} domain=${domain ?? '-'} ` +
        `bodyKeys=[${Object.keys(root).join(',')}] authKeys=[${Object.keys(auth).join(',')}] ` +
        `queryKeys=[${Object.keys(query).join(',')}]`,
    );
  }
}

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

function renderFormPage(args: {
  memberId: string | undefined;
  domain: string | undefined;
  frontendUrl: string;
  notice?: string;
}): string {
  const { memberId, domain, frontendUrl, notice } = args;
  const initial = JSON.stringify({
    memberId: memberId ?? '',
    domain: domain ?? '',
    frontendUrl,
    notice: notice ?? '',
  });
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Установка «Кора»</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#f6f7f9; margin:0;
         display:flex; min-height:100vh; align-items:center; justify-content:center; padding:16px; }
  .card { background:#fff; border:1px solid #e6e8eb; border-radius:12px; padding:28px 32px;
          width:100%; max-width:380px; box-shadow:0 1px 3px rgba(0,0,0,.06); }
  h1 { font-size:18px; margin:0 0 4px; color:#1a1a1a; text-align:center; }
  .sub { font-size:13px; color:#5a6472; margin:0 0 20px; text-align:center; }
  label { display:block; font-size:13px; color:#3a4452; margin:12px 0 6px; }
  input, select { width:100%; box-sizing:border-box; padding:10px 12px; font-size:14px;
          border:1px solid #d6dae0; border-radius:8px; background:#fff; color:#1a1a1a; }
  button { width:100%; margin-top:18px; padding:11px; font-size:14px; font-weight:600;
          color:#fff; background:#2563eb; border:none; border-radius:8px; cursor:pointer; }
  button:disabled { opacity:.6; cursor:default; }
  .msg { font-size:13px; margin-top:14px; text-align:center; min-height:18px; }
  .msg.err { color:#c0392b; }
  .msg.ok { color:#1e874b; }
  .ok-badge { width:48px; height:48px; margin:0 auto 12px; border-radius:50%; background:#e6f6ec;
          color:#1e874b; font-size:26px; line-height:48px; text-align:center; }
  .btn-link { display:block; margin-top:18px; padding:11px; font-size:14px; font-weight:600;
          color:#fff; background:#2563eb; border-radius:8px; text-align:center; text-decoration:none; }
  .notice { font-size:13px; color:#8a5a00; background:#fff6e5; border:1px solid #f0d999;
          border-radius:8px; padding:10px 12px; margin-bottom:16px; line-height:1.4; }
</style>
</head>
<body>
  <div class="card">
    <h1>Кора → Bitrix24</h1>
    <p class="sub">Войдите, чтобы привязать портал к вашей компании.</p>
    <div id="notice" class="notice" style="display:none"></div>
    <div id="form">
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="username" />
      <label for="password">Пароль</label>
      <input id="password" type="password" autocomplete="current-password" />
      <div id="orgWrap" style="display:none">
        <label for="org">Компания</label>
        <select id="org"></select>
      </div>
      <button id="submit" type="button">Привязать портал</button>
    </div>
    <div id="msg" class="msg"></div>
  </div>
  <script src="https://api.bitrix24.com/api/v1/"></script>
  <script>
    (function () {
      var initial = ${initial};
      var memberId = initial.memberId;
      var msg = document.getElementById('msg');
      var btn = document.getElementById('submit');
      var orgWrap = document.getElementById('orgWrap');
      var orgSel = document.getElementById('org');

      if (initial.notice) {
        var n = document.getElementById('notice');
        n.textContent = initial.notice;
        n.style.display = 'block';
      }

      function say(t, cls) { msg.textContent = t; msg.className = 'msg' + (cls ? ' ' + cls : ''); }

      function finish() {
        try { if (typeof BX24 !== 'undefined') BX24.installFinish(); } catch (e) {}
      }

      if (typeof BX24 !== 'undefined') {
        try {
          BX24.init(function () {
            if (!memberId) {
              try { var a = BX24.getAuth(); if (a && a.member_id) memberId = a.member_id; } catch (e) {}
            }
          });
        } catch (e) {}
      }

      async function bind(orgId) {
        btn.disabled = true;
        say('Привязываем…');
        try {
          var res = await fetch('/api/v1/bitrix/install/bind', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: document.getElementById('email').value.trim(),
              password: document.getElementById('password').value,
              memberId: memberId,
              orgId: orgId,
            }),
          });
          var data = {};
          try { data = await res.json(); } catch (e) {}
          if (res.ok && data.status === 'bound') {
            finish();
            var card = document.querySelector('.card');
            var url = data.koraUrl || (initial.frontendUrl + '/company-admin/sources/bitrix');
            card.innerHTML =
              '<div class="ok-badge">✓</div>' +
              '<h1>Готово!</h1>' +
              '<p class="sub">Портал ' + (data.portalDomain || '') + ' привязан к вашей компании.</p>' +
              '<a class="btn-link" target="_blank" rel="noopener" href="' + url + '">Открыть Кору в новом окне</a>' +
              '<p class="sub" style="margin-top:14px">Откроется уже авторизованной — вводить логин повторно не нужно.</p>';
            return;
          }
          if (res.ok && data.status === 'select_org') {
            orgSel.innerHTML = '';
            (data.orgs || []).forEach(function (o) {
              var opt = document.createElement('option');
              opt.value = o.id; opt.textContent = o.name;
              orgSel.appendChild(opt);
            });
            orgWrap.style.display = 'block';
            say('Выберите компанию и нажмите «Привязать портал».');
            btn.disabled = false;
            return;
          }
          var code = data && data.error ? data.error.code : null;
          if (res.status === 401) say('Неверный логин или пароль', 'err');
          else if (res.status === 403) say('У вас нет компании с правами администратора', 'err');
          else if (res.status === 409) say('Этот портал уже привязан к другой компании', 'err');
          else if (!memberId) say('Не удалось определить портал (member_id)', 'err');
          else say((data && data.error && data.error.message) || 'Не удалось завершить установку', 'err');
          btn.disabled = false;
        } catch (e) {
          say('Сетевая ошибка, попробуйте ещё раз', 'err');
          btn.disabled = false;
        }
      }

      btn.addEventListener('click', function () {
        var orgId = orgWrap.style.display === 'block' ? orgSel.value : undefined;
        if (!document.getElementById('email').value.trim() || !document.getElementById('password').value) {
          say('Введите email и пароль', 'err');
          return;
        }
        void bind(orgId);
      });
    })();
  </script>
</body>
</html>`;
}

function renderWizardPage(args: {
  name: string;
  orgName: string | null;
  orgId: string;
  koraUrl: string;
}): string {
  const initial = JSON.stringify({
    name: args.name ?? '',
    orgName: args.orgName ?? '',
    orgId: args.orgId,
    url: args.koraUrl,
  });
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Кора подключена</title>
<style>
  body { font-family:-apple-system,Segoe UI,Roboto,sans-serif; background:#f6f7f9; margin:0;
         display:flex; min-height:100vh; align-items:center; justify-content:center; padding:16px; }
  .card { background:#fff; border:1px solid #e6e8eb; border-radius:12px; padding:28px 32px;
          width:100%; max-width:420px; box-shadow:0 1px 3px rgba(0,0,0,.06); }
  .ok-badge { width:48px; height:48px; margin:0 auto 12px; border-radius:50%; background:#e6f6ec;
          color:#1e874b; font-size:26px; line-height:48px; text-align:center; }
  h1 { font-size:18px; margin:0 0 6px; color:#1a1a1a; text-align:center; }
  .sub { font-size:13px; color:#5a6472; margin:0 0 4px; text-align:center; }
  .step { border-top:1px solid #eef0f3; padding:16px 0; }
  .step:last-of-type { border-bottom:1px solid #eef0f3; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .row .t { font-size:14px; font-weight:600; color:#1a1a1a; }
  .row .d { font-size:12px; color:#8a93a0; margin-top:2px; }
  button { padding:9px 14px; font-size:13px; font-weight:600; color:#fff; background:#2563eb;
          border:none; border-radius:8px; cursor:pointer; }
  button:disabled { opacity:.55; cursor:default; }
  .switch { position:relative; width:42px; height:24px; flex:0 0 auto; }
  .switch input { display:none; }
  .slider { position:absolute; inset:0; background:#cfd6df; border-radius:24px; transition:.2s; cursor:pointer; }
  .slider::before { content:''; position:absolute; width:18px; height:18px; left:3px; top:3px;
          background:#fff; border-radius:50%; transition:.2s; }
  .switch input:checked + .slider { background:#1e874b; }
  .switch input:checked + .slider::before { transform:translateX(18px); }
  .status { font-size:12px; color:#5a6472; margin-top:8px; min-height:16px; }
  .status.spin::before { content:''; display:inline-block; width:12px; height:12px; margin-right:6px;
          vertical-align:-1px; border:2px solid #c7d0db; border-top-color:#2563eb; border-radius:50%;
          animation:sp .7s linear infinite; }
  @keyframes sp { to { transform:rotate(360deg); } }
  .btn-link { display:block; margin-top:18px; padding:11px; font-size:14px; font-weight:600;
          color:#fff; background:#2563eb; border-radius:8px; text-align:center; text-decoration:none; }
  .hint { font-size:12px; color:#8a93a0; text-align:center; margin-top:12px; }
  #config { display:none; }
  .mtbl { width:100%; border-collapse:collapse; font-size:13px; margin-top:10px; }
  .mtbl th { text-align:left; font-size:11px; font-weight:500; color:#8a93a0; padding:6px 6px; }
  .mtbl td { padding:7px 6px; border-top:1px solid #eef0f3; vertical-align:top; }
  .mn { font-weight:600; color:#1a1a1a; }
  .me { font-size:11px; color:#8a93a0; }
  .bg { display:inline-block; font-size:10px; padding:2px 7px; border-radius:10px; }
  .bg.ok { background:#e6f6ec; color:#1e874b; }
  .bg.no { background:#eef0f3; color:#5a6472; }
  .mtbl select { width:100%; padding:5px 6px; font-size:12px; border:1px solid #d6dae0; border-radius:6px; }
  .apply { width:100%; margin-top:12px; }
</style>
</head>
<body>
  <div class="card">
    <div class="ok-badge">✓</div>
    <h1 id="title">Кора подключена</h1>
    <p class="sub" id="sub"></p>

    <div id="config">
      <div class="step">
        <div class="row">
          <div>
            <div class="t">AI-анализ переписок</div>
            <div class="d">Кора строит summary диалогов и пополняет граф знаний.</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="analysis" />
            <span class="slider"></span>
          </label>
        </div>
      </div>
      <div class="step">
        <div class="t">Сопоставление менеджеров</div>
        <div class="d">Забираем менеджеров портала и сопоставляем с людьми компании по email. Совпавших свяжем, остальных предложим создать.</div>
        <div class="status spin" id="mgrStatus">Синхронизируем менеджеров…</div>
        <div id="mgrBox"></div>
        <button class="apply" id="apply" type="button" style="display:none">Применить сопоставление</button>
      </div>
    </div>

    <a class="btn-link" id="link" target="_blank" rel="noopener">Открыть Кору в новом окне</a>
    <p class="hint">Откроется уже авторизованной. Диалоги и CRM подтянутся автоматически.</p>
  </div>
  <script src="https://api.bitrix24.com/api/v1/"></script>
  <script>
    (function () {
      var d = ${initial};
      if (d.name) document.getElementById('title').textContent = 'С возвращением, ' + d.name + '!';
      document.getElementById('sub').textContent =
        'Портал привязан к компании ' + (d.orgName || 'вашей компании') + '.';
      document.getElementById('link').href = d.url;

      var H = { 'Content-Type': 'application/json', 'X-Org-Id': d.orgId };
      var GH = { 'X-Org-Id': d.orgId };
      var analysis = document.getElementById('analysis');
      var mgrStatus = document.getElementById('mgrStatus');
      var mgrBox = document.getElementById('mgrBox');
      var applyBtn = document.getElementById('apply');
      var configShown = false;
      function showConfig() { if (!configShown) { configShown = true; document.getElementById('config').style.display = 'block'; } }
      function setStatus(text, spinning) {
        mgrStatus.textContent = text;
        mgrStatus.className = 'status' + (spinning ? ' spin' : '');
      }
      function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

      async function loadStatus() {
        try {
          var res = await fetch('/api/v1/bitrix/integration/status', { credentials: 'include', headers: GH });
          if (!res.ok) return;
          var data = await res.json();
          analysis.checked = !!(data && data.analysisEnabled);
          showConfig();
        } catch (e) {}
      }

      analysis.addEventListener('change', async function () {
        analysis.disabled = true;
        try {
          await fetch('/api/v1/bitrix/integration/analysis', {
            method: 'PATCH', credentials: 'include', headers: H,
            body: JSON.stringify({ enabled: analysis.checked }),
          });
        } catch (e) { analysis.checked = !analysis.checked; }
        finally { analysis.disabled = false; }
      });

      function renderManagers(users) {
        mgrBox.innerHTML = '';
        if (!users.length) {
          setStatus('Менеджеры пока не найдены — подтянутся при следующей синхронизации.', false);
          return;
        }
        setStatus(users.length + ' менеджеров найдено. Проверьте сопоставление:', false);
        var table = document.createElement('table');
        table.className = 'mtbl';
        var thead = document.createElement('thead');
        thead.innerHTML = '<tr><th>Менеджер портала</th><th>Статус</th><th>Действие</th></tr>';
        table.appendChild(thead);
        var tbody = document.createElement('tbody');
        users.forEach(function (u) {
          var tr = document.createElement('tr');
          var td1 = document.createElement('td');
          var nm = document.createElement('div'); nm.className = 'mn';
          nm.textContent = u.name || u.email || 'Без имени'; td1.appendChild(nm);
          if (u.email) { var em = document.createElement('div'); em.className = 'me'; em.textContent = u.email; td1.appendChild(em); }
          var td2 = document.createElement('td');
          var badge = document.createElement('span');
          if (u.linkedPersonId) { badge.className = 'bg ok'; badge.textContent = 'Найден: ' + (u.linkedPersonName || 'сотрудник'); }
          else { badge.className = 'bg no'; badge.textContent = 'Нет в Коре'; }
          td2.appendChild(badge);
          var td3 = document.createElement('td');
          var sel = document.createElement('select');
          sel.setAttribute('data-ext', u.externalId);
          var opts = u.linkedPersonId
            ? [['keep', 'Связать'], ['unlink', 'Не связывать']]
            : [['create', 'Создать в Коре'], ['skip', 'Не создавать']];
          opts.forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op); });
          td3.appendChild(sel);
          tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        mgrBox.appendChild(table);
        applyBtn.style.display = 'block';
      }

      async function syncAndLoadManagers() {
        showConfig();
        var users = [];
        for (var i = 0; i < 20; i += 1) {
          await sleep(2000);
          try {
            var res = await fetch('/api/v1/bitrix/integration/users', { credentials: 'include', headers: GH });
            if (res.status === 401 || res.status === 403) { setStatus('Сопоставление доступно администратору компании.', false); return; }
            if (res.ok) { var data = await res.json(); users = (data && data.users) || []; if (users.length) break; }
          } catch (e) {}
        }
        renderManagers(users);
      }

      applyBtn.addEventListener('click', async function () {
        applyBtn.disabled = true;
        setStatus('Применяем…', true);
        var sels = mgrBox.querySelectorAll('select[data-ext]');
        try {
          for (var i = 0; i < sels.length; i += 1) {
            var ext = sels[i].getAttribute('data-ext');
            var a = sels[i].value;
            if (a !== 'unlink' && a !== 'create') continue;
            await fetch('/api/v1/bitrix/integration/users/' + encodeURIComponent(ext) + '/link', {
              method: 'PATCH', credentials: 'include', headers: H,
              body: JSON.stringify({ mode: a }),
            });
          }
          setStatus('Готово — менеджеры сопоставлены.', false);
          applyBtn.style.display = 'none';
        } catch (e) {
          setStatus('Не удалось сохранить сопоставление, попробуйте ещё раз.', false);
          applyBtn.disabled = false;
        }
      });

      void loadStatus();
      void syncAndLoadManagers();
      try {
        if (typeof BX24 !== 'undefined') BX24.init(function () { try { BX24.installFinish(); } catch (e) {} });
      } catch (e) {}
    })();
  </script>
</body>
</html>`;
}

function hostFromHeaders(req: Request): string | undefined {
  const raw =
    (typeof req.headers['referer'] === 'string' ? req.headers['referer'] : undefined) ??
    (typeof req.headers['origin'] === 'string' ? req.headers['origin'] : undefined);
  if (!raw) return undefined;
  try {
    const host = new URL(raw).host.toLowerCase();
    return /\.bitrix24\.[a-z]+$/.test(host) ? host : undefined;
  } catch {
    return undefined;
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
