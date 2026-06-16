import {
  Inbox,
  FolderKanban,
  MessageCircle,
  CheckCircle2,
  User,
  type LucideIcon,
} from "lucide-react";

export interface PrimaryNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  withInboxBadge?: boolean;
}

export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { href: "/me/inbox", label: "Входящие", icon: Inbox, withInboxBadge: true },
  { href: "/projects", label: "Задачи", icon: FolderKanban },
  { href: "/chat", label: "Спросить", icon: MessageCircle },
  { href: "/me/check-ins", label: "Чек-ины", icon: CheckCircle2 },
  { href: "/me", label: "Я", icon: User },
] as const;
