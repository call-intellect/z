export interface WorkloadRowDto {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  openCount: number;
  inProgressCount: number;
  overdueCount: number;
  completedLast7dCount: number;
}

export interface WorkloadResponseDto {
  items: WorkloadRowDto[];
  avgOpenPerMember: number;
}
