import { Module } from '@nestjs/common';

import { OrgsModule } from '../orgs/orgs.module';

import { AccountDeletionController } from './account-deletion.controller';
import { AccountsController } from './accounts.controller';
import { AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';
import { PasswordModule } from './password.module';
import { SessionService } from './session.service';
import { UnifiedLoginController } from './unified-login.controller';

@Module({
  imports: [OrgsModule, PasswordModule],
  controllers: [AccountsController, UnifiedLoginController, AccountDeletionController],
  providers: [AccountsService, AccountsRepository, SessionService],
  exports: [AccountsService, SessionService],
})
export class AccountsModule {}
