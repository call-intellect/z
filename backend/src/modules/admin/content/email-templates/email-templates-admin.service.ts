import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import Handlebars from 'handlebars';

import { PrismaService } from '../../../../common/prisma/prisma.service';
import { MailService } from '../../../mail/mail.service';
import {
  INVITE_DIRECTOR_TIMEOUT_TEMPLATE,
  INVITE_GITHUB_STYLE_TEMPLATE,
  INVITE_REMINDER_TEMPLATE,
  PASSWORD_RESET_TEMPLATE,
  REGISTER_TEMP_PASSWORD_TEMPLATE,
} from '../../../mail/mail.templates';

import type { EmailTemplateCategory } from './dto/email-templates-admin.dto';

/**
 * Admin-redesign Фаза 5 — `EmailTemplatesAdminService`.
 *
 * CRUD шаблонов писем (`EmailTemplate`). При первом GET (count === 0) —
 * bootstrap-sync констант из `mail.templates.ts` в БД. Дальше все шаблоны
 * редактируются только из админки; код остаётся как fallback на случай,
 * если запись в БД удалили/не нашли.
 *
 * Валидация `body`/`htmlBody`: компиляция через `Handlebars.compile()` —
 * она бросает понятный SyntaxError при несовпадающих скобках. Мы ловим
 * и возвращаем 400 с человекочитаемым сообщением.
 *
 * Test-send: rate-limit 5 запросов / минуту на (super_admin_user_id),
 * хранится в простом in-memory Map. Этого достаточно — endpoint
 * super_admin-only, реалистичной нагрузки тут нет.
 */

export interface EmailTemplateItem {
  key: string;
  subject: string;
  body: string;
  htmlBody: string | null;
  variables: Record<string, string>;
  category: string;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface EmailTemplateDetail extends EmailTemplateItem {
  /** Превью с подставленными placeholder-значениями из `variables`. */
  preview: { subject: string; body: string; htmlBody: string | null };
}

/** Шаблоны из кода — fallback и источник bootstrap-sync. */
interface StaticTemplate {
  key: string;
  subject: string;
  body: string;
  variables: Record<string, string>;
  category: EmailTemplateCategory;
}

const STATIC_TEMPLATES: ReadonlyArray<StaticTemplate> = [
  {
    key: 'register-temp-password',
    subject: 'Доступ в Z',
    body: REGISTER_TEMP_PASSWORD_TEMPLATE,
    variables: {
      name: 'имя получателя',
      to: 'email получателя (используется как логин)',
      tempPassword: 'временный пароль',
      loginUrl: 'ссылка на вход',
    },
    category: 'transactional',
  },
  {
    key: 'password-reset',
    subject: 'Сброс пароля Z',
    body: PASSWORD_RESET_TEMPLATE,
    variables: {
      name: 'имя получателя',
      resetUrl: 'ссылка на форму нового пароля',
      expiresInMinutes: 'срок жизни ссылки в минутах',
    },
    category: 'transactional',
  },
  {
    key: 'invite-github-style',
    subject: '{{inviterName}} приглашает вас в «{{orgName}}»',
    body: INVITE_GITHUB_STYLE_TEMPLATE,
    variables: {
      name: 'имя приглашённого',
      inviterName: 'имя пригласившего',
      orgName: 'название компании',
      magicLinkUrl: 'magic-link для входа в кабинет',
      telegramDeepLink: 'deep-link в Telegram-бот',
      ttlDays: 'срок жизни приглашения в днях',
    },
    category: 'transactional',
  },
  {
    key: 'invite-reminder',
    subject: 'Напоминание: приглашение в «{{orgName}}» ещё действует',
    body: INVITE_REMINDER_TEMPLATE,
    variables: {
      name: 'имя приглашённого',
      inviterName: 'имя пригласившего',
      orgName: 'название компании',
      daysLeft: 'дней до истечения ссылки',
      magicLinkUrl: 'magic-link для входа',
      telegramDeepLink: 'deep-link в Telegram-бот',
    },
    category: 'transactional',
  },
  {
    key: 'invite-director-timeout',
    subject: 'Приглашение для {{employeeName}} истекло',
    body: INVITE_DIRECTOR_TIMEOUT_TEMPLATE,
    variables: {
      directorName: 'имя директора',
      employeeName: 'имя сотрудника',
      employeeEmail: 'email сотрудника (опционально)',
      orgName: 'название компании',
      teamPageUrl: 'ссылка на страницу «Сотрудники»',
    },
    category: 'transactional',
  },
];

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

@Injectable()
export class EmailTemplatesAdminService {
  private readonly logger = new Logger(EmailTemplatesAdminService.name);
  private syncing: Promise<void> | null = null;

  /** Простой in-memory rate-limit для test-send: super_admin_user_id → timestamps. */
  private readonly testSendRateLimit = new Map<string, number[]>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  /**
   * Получить отрисованное тело шаблона по ключу с подстановкой переменных.
   * Если в БД шаблона нет — fallback на static-константу. Используется
   * `MailService` обёртками для backward compat.
   *
   * Не выбрасывает — на ошибке возвращает null, caller обязан перейти
   * на прямой fallback на код.
   */
  async renderOrNull(
    key: string,
    context: Record<string, unknown>,
  ): Promise<{ subject: string; body: string; htmlBody: string | null } | null> {
    try {
      const row = await this.prisma.emailTemplate.findUnique({ where: { key } });
      if (!row) {
        return this.renderStatic(key, context);
      }
      return this.compileAndRender(
        { subject: row.subject, body: row.body, htmlBody: row.htmlBody },
        context,
      );
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), key },
        'EmailTemplatesAdminService.renderOrNull: фоллбэк на static',
      );
      return this.renderStatic(key, context);
    }
  }

  async list(): Promise<{ items: EmailTemplateItem[] }> {
    const count = await this.prisma.emailTemplate.count();
    if (count === 0) {
      await this.ensureBootstrap();
    }
    const rows = await this.prisma.emailTemplate.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
    return { items: rows.map((r) => this.toItem(r)) };
  }

  async getDetail(key: string): Promise<EmailTemplateDetail> {
    const row = await this.prisma.emailTemplate.findUnique({ where: { key } });
    if (!row) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'email_template_not_found',
          message: `EmailTemplate key="${key}" не найден`,
        },
      });
    }
    const item = this.toItem(row);
    const ctx = this.placeholderContext(item.variables);
    const preview = this.compileAndRender(
      { subject: row.subject, body: row.body, htmlBody: row.htmlBody },
      ctx,
    );
    return { ...item, preview };
  }

  async create(
    input: {
      key: string;
      subject: string;
      body: string;
      htmlBody?: string;
      variables: Record<string, string>;
      category: string;
    },
    userId: string | null,
  ): Promise<EmailTemplateItem> {
    this.assertHandlebars('subject', input.subject);
    this.assertHandlebars('body', input.body);
    if (input.htmlBody !== undefined) this.assertHandlebars('htmlBody', input.htmlBody);

    const exists = await this.prisma.emailTemplate.findUnique({
      where: { key: input.key },
    });
    if (exists) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'email_template_key_taken',
          message: `EmailTemplate key="${input.key}" уже существует`,
        },
      });
    }
    const created = await this.prisma.emailTemplate.create({
      data: {
        key: input.key,
        subject: input.subject,
        body: input.body,
        ...(input.htmlBody !== undefined ? { htmlBody: input.htmlBody } : {}),
        variables: input.variables as Prisma.InputJsonValue,
        category: input.category,
        updatedBy: userId,
      },
    });
    return this.toItem(created);
  }

  async update(
    key: string,
    input: {
      subject?: string;
      body?: string;
      htmlBody?: string | null;
      variables?: Record<string, string>;
      category?: string;
    },
    userId: string | null,
  ): Promise<EmailTemplateItem> {
    const exists = await this.prisma.emailTemplate.findUnique({ where: { key } });
    if (!exists) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'email_template_not_found',
          message: `EmailTemplate key="${key}" не найден`,
        },
      });
    }

    if (input.subject !== undefined) this.assertHandlebars('subject', input.subject);
    if (input.body !== undefined) this.assertHandlebars('body', input.body);
    if (input.htmlBody !== undefined && input.htmlBody !== null) {
      this.assertHandlebars('htmlBody', input.htmlBody);
    }

    const data: Prisma.EmailTemplateUpdateInput = { updatedBy: userId };
    if (input.subject !== undefined) data.subject = input.subject;
    if (input.body !== undefined) data.body = input.body;
    if (input.htmlBody !== undefined) data.htmlBody = input.htmlBody;
    if (input.variables !== undefined) {
      data.variables = input.variables as Prisma.InputJsonValue;
    }
    if (input.category !== undefined) data.category = input.category;

    const updated = await this.prisma.emailTemplate.update({ where: { key }, data });
    return this.toItem(updated);
  }

  /**
   * Отправить тестовое письмо. Rate-limit 5/мин на super_admin_user_id.
   * Шаблон рендерим placeholder-значениями из `variables`.
   */
  async testSend(
    key: string,
    to: string,
    userId: string | null,
  ): Promise<{ ok: true }> {
    const limiterKey = userId ?? 'anonymous';
    if (!this.allowTestSend(limiterKey)) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'email_test_send_rate_limited',
          message: 'Слишком много тестовых отправок. Подождите минуту.',
        },
      });
    }

    const row = await this.prisma.emailTemplate.findUnique({ where: { key } });
    if (!row) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'email_template_not_found',
          message: `EmailTemplate key="${key}" не найден`,
        },
      });
    }

    const item = this.toItem(row);
    const ctx = this.placeholderContext(item.variables);
    const rendered = this.compileAndRender(
      { subject: row.subject, body: row.body, htmlBody: row.htmlBody },
      ctx,
    );

    const result = await this.mail.sendPlain({
      to,
      subject: `[ТЕСТ] ${rendered.subject}`,
      text: rendered.body,
      template: `test-${key}`,
    });
    if (!result.ok) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'email_test_send_failed',
          message: result.error ?? 'Не удалось отправить тестовое письмо',
        },
      });
    }
    return { ok: true };
  }

  // ─────────────────────────── private ─────────────────────────────────

  private allowTestSend(key: string): boolean {
    const now = Date.now();
    const arr = this.testSendRateLimit.get(key) ?? [];
    const fresh = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (fresh.length >= RATE_LIMIT_MAX) {
      this.testSendRateLimit.set(key, fresh);
      return false;
    }
    fresh.push(now);
    this.testSendRateLimit.set(key, fresh);
    return true;
  }

  private async ensureBootstrap(): Promise<void> {
    if (this.syncing) {
      await this.syncing;
      return;
    }
    this.syncing = (async () => {
      this.logger.log(
        `EmailTemplatesAdminService: bootstrap-sync из mail.templates.ts (${STATIC_TEMPLATES.length} шаблонов)`,
      );
      for (const t of STATIC_TEMPLATES) {
        await this.prisma.emailTemplate.upsert({
          where: { key: t.key },
          create: {
            key: t.key,
            subject: t.subject,
            body: t.body,
            variables: t.variables as Prisma.InputJsonValue,
            category: t.category,
          },
          update: {},
        });
      }
    })();
    try {
      await this.syncing;
    } finally {
      this.syncing = null;
    }
  }

  /**
   * Проверяем, что строка валидна как Handlebars-шаблон. На ошибке —
   * BadRequest. Под капотом ловим SyntaxError из `Handlebars.parse`.
   */
  private assertHandlebars(field: string, source: string): void {
    try {
      Handlebars.parse(source);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'email_template_invalid_handlebars',
          message: `Поле ${field} содержит невалидный Handlebars: ${msg}`,
          meta: { field },
        },
      });
    }
  }

  private compileAndRender(
    src: { subject: string; body: string; htmlBody: string | null },
    context: Record<string, unknown>,
  ): { subject: string; body: string; htmlBody: string | null } {
    try {
      const subjectFn = Handlebars.compile(src.subject, { noEscape: true });
      const bodyFn = Handlebars.compile(src.body, { noEscape: true });
      const htmlFn = src.htmlBody
        ? Handlebars.compile(src.htmlBody, { noEscape: true })
        : null;
      return {
        subject: subjectFn(context),
        body: bodyFn(context),
        htmlBody: htmlFn ? htmlFn(context) : null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'email_template_render_failed',
          message: `Не удалось отрендерить шаблон: ${msg}`,
        },
      });
    }
  }

  private renderStatic(
    key: string,
    context: Record<string, unknown>,
  ): { subject: string; body: string; htmlBody: string | null } | null {
    const t = STATIC_TEMPLATES.find((x) => x.key === key);
    if (!t) return null;
    return this.compileAndRender(
      { subject: t.subject, body: t.body, htmlBody: null },
      context,
    );
  }

  /**
   * Placeholder-context: `{ varName: '{{varName}}' }` чтобы preview визуально
   * показал, какие переменные доступны.
   */
  private placeholderContext(variables: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of Object.keys(variables)) {
      out[key] = `{${key}}`;
    }
    return out;
  }

  private toItem(row: {
    key: string;
    subject: string;
    body: string;
    htmlBody: string | null;
    variables: unknown;
    category: string;
    updatedBy: string | null;
    updatedAt: Date;
  }): EmailTemplateItem {
    return {
      key: row.key,
      subject: row.subject,
      body: row.body,
      htmlBody: row.htmlBody,
      variables: this.parseVariables(row.variables),
      category: row.category,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
  }

  private parseVariables(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    return out;
  }
}
