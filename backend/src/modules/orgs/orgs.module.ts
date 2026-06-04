import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';
import { ConversationalLinkCodeService } from '../conversational/link-code.service';
import { MailModule } from '../mail/mail.module';
import { PersonsModule } from '../persons/persons.module';
import { TablesModule } from '../tables/tables.module';

import { CapabilitiesService } from './capabilities.service';
import { OrgInvitationRemindersCron } from './cron/org-invitation-reminders.cron';
import { OrgInvitationsService } from './org-invitations.service';
import {
  OrgInvitationsAcceptController,
  OrgsController,
} from './orgs.controller';
import { OrgsService } from './orgs.service';

/**
 * Org / Membership / Invitation module (Фаза 0 knowledge-core).
 *
 * RbacModule (глобальный) предоставляет RbacService, который тут используется
 * во всех сервисах для проверки прав.
 *
 * AccountsService (хук в register) импортирует OrgsService напрямую через
 * forwardRef если нужно (см. accounts.module.ts).
 *
 * β-9 (2026-05-25):
 *   - ConversationalLinkCodeService регистрируется здесь локальным
 *     провайдером, потому что @Global ConversationalModule его не
 *     экспортирует (см. conversational.module.ts §exports). Сервис
 *     stateless и работает через RedisService/TypedConfigService —
 *     несколько инстансов не ломают консистентность.
 *   - OrgInvitationRemindersCron — раз в час, обрабатывает 7-дневные
 *     напоминания и 14-дневные таймауты директора. См.
 *     plans/tz/2026-05-25-telegram-bot-global-and-invites.md §8.
 */
@Module({
  imports: [PrismaModule, MailModule, BillingModule, TablesModule, PersonsModule],
  controllers: [OrgsController, OrgInvitationsAcceptController],
  providers: [
    OrgsService,
    OrgInvitationsService,
    ConversationalLinkCodeService,
    OrgInvitationRemindersCron,
    CapabilitiesService,
  ],
  exports: [OrgsService, OrgInvitationsService, CapabilitiesService],
})
export class OrgsModule {}
