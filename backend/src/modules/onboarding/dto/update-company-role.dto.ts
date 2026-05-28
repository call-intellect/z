import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const USER_COMPANY_ROLES = [
  'founder',
  'general_director',
  'operations_director',
  'department_head',
  'team_lead',
  'specialist',
] as const;

export const UpdateCompanyRoleSchema = z.object({
  companyRole: z.enum(USER_COMPANY_ROLES),
});

export class UpdateCompanyRoleDto extends createZodDto(UpdateCompanyRoleSchema) {}
export type UpdateCompanyRoleBody = z.infer<typeof UpdateCompanyRoleSchema>;
