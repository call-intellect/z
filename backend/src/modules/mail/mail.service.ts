import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import Handlebars from 'handlebars';
import nodemailer, { type Transporter } from 'nodemailer';

import { TypedConfigService } from '../../common/config/index';

import {
  INVITE_DIRECTOR_TIMEOUT_TEMPLATE,
  INVITE_GITHUB_STYLE_TEMPLATE,
  INVITE_REMINDER_TEMPLATE,
  PASSWORD_RESET_TEMPLATE,
  REGISTER_TEMP_PASSWORD_TEMPLATE,
} from './mail.templates';

/**
 * MailService — единая точка отправки писем для standalone-онбординга
 * и восстановления пароля.
 *
 * Дизайн:
 *   - Транспорт строим один раз в `onModuleInit` из `cfg.mail`.
 *   - Шаблоны (Handlebars, .hbs) грузим единожды при старте — не читаем
 *     файл на каждый запрос.
 *   - В `MAIL_DRY_RUN=true` или `NODE_ENV=test` реальный SMTP не дёргаем,
 *     рендеренное письмо пишем в лог Pino. Это нужно для unit-/e2e-тестов
 *     и для прогона ENV без SMTP-секретов.
 *   - Логируем только адрес получателя и имя шаблона. Никогда не светим
 *     temp-пароль или reset-токен в логи (даже в DEBUG).
 *
 * Используемые письма:
 *   - `register-temp-password.hbs` — выдача temp-пароля при lead-регистрации.
 *   - `password-reset.hbs` — ссылка на сброс пароля.
 */

interface SendResult {
  ok: boolean;
  error?: string;
}

interface CompiledTemplates {
  registerTempPassword: HandlebarsTemplateDelegate<{
    name: string;
    to: string;
    tempPassword: string;
    loginUrl: string;
  }>;
  passwordReset: HandlebarsTemplateDelegate<{
    name: string;
    resetUrl: string;
    expiresInMinutes: number;
  }>;
  // β-9 (2026-05-25)
  inviteGithubStyle: HandlebarsTemplateDelegate<{
    name: string;
    inviterName: string;
    orgName: string;
    magicLinkUrl: string;
    telegramDeepLink: string;
    ttlDays: number;
  }>;
  inviteReminder: HandlebarsTemplateDelegate<{
    name: string;
    inviterName: string;
    orgName: string;
    daysLeft: number;
    magicLinkUrl: string;
    telegramDeepLink: string;
  }>;
  inviteDirectorTimeout: HandlebarsTemplateDelegate<{
    directorName: string;
    employeeName: string;
    employeeEmail?: string;
    orgName: string;
    teamPageUrl: string;
  }>;
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private templates!: CompiledTemplates;
  private dryRun = false;

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  onModuleInit(): void {
    const mail = this.cfg.mail;
    const isTest = this.cfg.runtime.isTest;
    this.dryRun = mail.dryRun || isTest;

    this.templates = this.loadTemplates();

    if (this.dryRun) {
      this.logger.log(
        `MailService запущен в DRY-RUN режиме (NODE_ENV=${this.cfg.runtime.nodeEnv}, MAIL_DRY_RUN=${String(mail.dryRun)})`,
      );
      return;
    }

    const auth =
      mail.username && mail.password
        ? { user: mail.username, pass: mail.password }
        : undefined;

    this.transporter = nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.ssl,
      auth,
    });

    this.logger.log(
      `MailService готов: host=${mail.host}, port=${mail.port}, ssl=${String(mail.ssl)}, auth=${auth ? 'on' : 'off'}, from=${mail.from}`,
    );
  }

  /**
   * Письмо с временным паролем при lead-style регистрации.
   * Тема: «Доступ в Z».
   */
  async sendTempPassword(input: {
    to: string;
    name: string;
    tempPassword: string;
    loginUrl: string;
  }): Promise<SendResult> {
    const text = this.templates.registerTempPassword({
      to: input.to,
      name: input.name,
      tempPassword: input.tempPassword,
      loginUrl: input.loginUrl,
    });
    return this.send({
      to: input.to,
      subject: 'Доступ в Z',
      text,
      template: 'register-temp-password',
    });
  }

  /**
   * Универсальная отправка plain-text письма.
   * Используется в `EmailSender` (destinations) и `ExportNotifier`.
   */
  async sendPlain(input: {
    to: string;
    subject: string;
    text: string;
    template?: string;
  }): Promise<SendResult> {
    return this.send({
      to: input.to,
      subject: input.subject,
      text: input.text,
      template: input.template ?? 'plain',
    });
  }

  /**
   * Письмо со ссылкой на сброс пароля.
   * Тема: «Сброс пароля Z».
   */
  async sendPasswordReset(input: {
    to: string;
    name: string;
    resetUrl: string;
    expiresInMinutes: number;
  }): Promise<SendResult> {
    const text = this.templates.passwordReset({
      name: input.name,
      resetUrl: input.resetUrl,
      expiresInMinutes: input.expiresInMinutes,
    });
    return this.send({
      to: input.to,
      subject: 'Сброс пароля Z',
      text,
      template: 'password-reset',
    });
  }

  /**
   * β-9 (2026-05-25) — GitHub-style приглашение сотрудника.
   * Тема: «{{inviterName}} приглашает вас в {{orgName}}».
   */
  async sendInviteGithubStyle(input: {
    to: string;
    name: string;
    inviterName: string;
    orgName: string;
    magicLinkUrl: string;
    telegramDeepLink: string;
    ttlDays: number;
  }): Promise<SendResult> {
    const text = this.templates.inviteGithubStyle({
      name: input.name,
      inviterName: input.inviterName,
      orgName: input.orgName,
      magicLinkUrl: input.magicLinkUrl,
      telegramDeepLink: input.telegramDeepLink,
      ttlDays: input.ttlDays,
    });
    return this.send({
      to: input.to,
      subject: `${input.inviterName} приглашает вас в «${input.orgName}»`,
      text,
      template: 'invite-github-style',
    });
  }

  /**
   * β-9 (2026-05-25) — напоминание сотруднику об ожидающем приглашении.
   * Отправляется кроном `org-invitation-reminders` на 7-й день.
   */
  async sendInviteReminder(input: {
    to: string;
    name: string;
    inviterName: string;
    orgName: string;
    daysLeft: number;
    magicLinkUrl: string;
    telegramDeepLink: string;
  }): Promise<SendResult> {
    const text = this.templates.inviteReminder({
      name: input.name,
      inviterName: input.inviterName,
      orgName: input.orgName,
      daysLeft: input.daysLeft,
      magicLinkUrl: input.magicLinkUrl,
      telegramDeepLink: input.telegramDeepLink,
    });
    return this.send({
      to: input.to,
      subject: `Напоминание: приглашение в «${input.orgName}» ещё действует`,
      text,
      template: 'invite-reminder',
    });
  }

  /**
   * β-9 (2026-05-25) — уведомление директора, что приглашение истекло.
   * Отправляется кроном `org-invitation-reminders` на 14-й день.
   */
  async sendInviteDirectorTimeout(input: {
    to: string;
    directorName: string;
    employeeName: string;
    employeeEmail?: string | null;
    orgName: string;
    teamPageUrl: string;
  }): Promise<SendResult> {
    const text = this.templates.inviteDirectorTimeout({
      directorName: input.directorName,
      employeeName: input.employeeName,
      ...(input.employeeEmail ? { employeeEmail: input.employeeEmail } : {}),
      orgName: input.orgName,
      teamPageUrl: input.teamPageUrl,
    });
    return this.send({
      to: input.to,
      subject: `Приглашение для ${input.employeeName} истекло`,
      text,
      template: 'invite-director-timeout',
    });
  }

  // ─────────────────────────── internals ──────────────────────────

  private async send(opts: {
    to: string;
    subject: string;
    text: string;
    template: string;
  }): Promise<SendResult> {
    const { to, subject, text, template } = opts;
    const from = `"${this.cfg.mail.fromName}" <${this.cfg.mail.from}>`;

    if (this.dryRun) {
      // В dry-run пишем рендеренное письмо в лог. Это нужно для проверки
      // содержимого в e2e и при первичной настройке. На проде включаем
      // только при отладке, потому что здесь light-secret (temp-пароль)
      // попадает в лог. Это компромисс ради тестируемости.
      this.logger.log(
        { to, template, subject },
        `[DRY-RUN] письмо не отправлено, шаблон отрендерен:\n${text}`,
      );
      return { ok: true };
    }

    if (!this.transporter) {
      // Не должно случиться — onModuleInit гарантирует наличие транспорта,
      // но защищаем явно.
      const err = 'mail_transport_not_initialized';
      this.logger.error({ to, template }, err);
      return { ok: false, error: err };
    }

    try {
      const result = await this.transporter.sendMail({
        from,
        to,
        subject,
        text,
      });
      this.logger.log(
        { to, template, messageId: result.messageId },
        'mail: отправлено',
      );
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error({ to, template, err: msg }, 'mail: ошибка отправки');
      return { ok: false, error: msg };
    }
  }

  private loadTemplates(): CompiledTemplates {
    return {
      registerTempPassword: Handlebars.compile<{
        name: string;
        to: string;
        tempPassword: string;
        loginUrl: string;
      }>(REGISTER_TEMP_PASSWORD_TEMPLATE, { noEscape: true }),
      passwordReset: Handlebars.compile<{
        name: string;
        resetUrl: string;
        expiresInMinutes: number;
      }>(PASSWORD_RESET_TEMPLATE, { noEscape: true }),
      // β-9 (2026-05-25)
      inviteGithubStyle: Handlebars.compile<{
        name: string;
        inviterName: string;
        orgName: string;
        magicLinkUrl: string;
        telegramDeepLink: string;
        ttlDays: number;
      }>(INVITE_GITHUB_STYLE_TEMPLATE, { noEscape: true }),
      inviteReminder: Handlebars.compile<{
        name: string;
        inviterName: string;
        orgName: string;
        daysLeft: number;
        magicLinkUrl: string;
        telegramDeepLink: string;
      }>(INVITE_REMINDER_TEMPLATE, { noEscape: true }),
      inviteDirectorTimeout: Handlebars.compile<{
        directorName: string;
        employeeName: string;
        employeeEmail?: string;
        orgName: string;
        teamPageUrl: string;
      }>(INVITE_DIRECTOR_TIMEOUT_TEMPLATE, { noEscape: true }),
    };
  }
}
