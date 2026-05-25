import { Module } from '@nestjs/common';

import { AdminSkillTraitConceptsService } from './services/skill-trait-concepts.service';
import { AdminSkillTraitConceptsController } from './skill-trait-concepts.controller';

/**
 * ТЗ 2026-05-25 clone-reliability-hardening, Фаза 2 — `AdminSkillTraitConceptsModule`.
 *
 * Регистрирует контроллер + сервис управления «Смысловыми блоками навыка»
 * для админ-панели организации (RBAC owner/admin). Подключается в `AdminModule`.
 *
 * Зависит от глобального `KnowledgeCoreModule` (SkillTraitConceptService),
 * `PrismaModule`, `AuthModule` (CookieAuthGuard / OrgAdminGuard), `RbacModule`
 * (TenantGuard).
 */
@Module({
  controllers: [AdminSkillTraitConceptsController],
  providers: [AdminSkillTraitConceptsService],
  exports: [AdminSkillTraitConceptsService],
})
export class AdminSkillTraitConceptsModule {}
