import type { UserRole } from './enums';

export type UserDomain = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};
