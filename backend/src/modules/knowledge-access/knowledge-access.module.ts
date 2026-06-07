import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { KnowledgeAccessAdminController } from './knowledge-access-admin.controller';
import { KnowledgeAccessAdminService } from './knowledge-access-admin.service';

/**
 * KnowledgeAccessModule — admin REST для управления доступом к знаниям через
 * группы (ТЗ 2026-06-06 knowledge-access-groups, Фаза 7 часть A).
 *
 * Зависимости: PrismaService (PrismaModule @Global), KnowledgeAccessResolver и
 * RbacService (RbacModule @Global) — отдельный import не нужен. AuthModule —
 * для CookieAuthGuard.
 */
@Module({
  imports: [AuthModule],
  controllers: [KnowledgeAccessAdminController],
  providers: [KnowledgeAccessAdminService],
})
export class KnowledgeAccessModule {}
