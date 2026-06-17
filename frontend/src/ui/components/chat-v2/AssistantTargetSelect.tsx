"use client";

import { Bot, UserCog } from "lucide-react";
import { useMemo, type ReactElement } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";
import { useClones, useMyCloneAccess } from "@/hooks/useClones";
import type { AssistantTarget } from "@/domain/chat-v2";

const ASSISTANT_VALUE = "__assistant__";
const CLONE_VALUE_PREFIX = "clone:";

export function AssistantTargetSelect({
  orgId,
  value,
  onChange,
  disabled,
}: {
  orgId: string;
  value: AssistantTarget;
  onChange: (target: AssistantTarget) => void;
  disabled?: boolean;
}): ReactElement | null {
  const { items, isLoading } = useClones(orgId);
  const { access } = useMyCloneAccess(orgId);

  const clones = useMemo(
    () =>
      items.map((c) => ({
        roleId: c.roleId,
        label: c.publicName || c.roleName,
        department: c.departmentName,
        hasAccess: access?.has("role", c.roleId) ?? false,
      })),
    [items, access],
  );

  if (isLoading) return null;
  if (clones.length === 0) return null;

  const selectValue =
    value.kind === "assistant"
      ? ASSISTANT_VALUE
      : `${CLONE_VALUE_PREFIX}${value.roleId}`;

  function handleValueChange(next: string): void {
    if (next === ASSISTANT_VALUE) {
      onChange({ kind: "assistant" });
      return;
    }
    const roleId = next.slice(CLONE_VALUE_PREFIX.length);
    const clone = clones.find((c) => c.roleId === roleId);
    if (!clone) {
      onChange({ kind: "assistant" });
      return;
    }
    onChange({ kind: "clone", roleId: clone.roleId, roleName: clone.label });
  }

  return (
    <Select
      value={selectValue}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectTrigger
        className="h-8 w-auto min-w-[14rem] gap-2 text-xs"
        aria-label="Кому задать вопрос"
      >
        <span className="flex items-center gap-1.5">
          {value.kind === "assistant" ? (
            <Bot size={14} className="shrink-0 text-accent" aria-hidden />
          ) : (
            <UserCog size={14} className="shrink-0 text-accent" aria-hidden />
          )}
          <SelectValue placeholder="Кому задать вопрос" />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ASSISTANT_VALUE} className="text-sm">
          Кора · помощник компании
        </SelectItem>
        <SelectGroup>
          <SelectLabel>Клоны должностей</SelectLabel>
          {clones.map((c) => (
            <SelectItem
              key={c.roleId}
              value={`${CLONE_VALUE_PREFIX}${c.roleId}`}
              disabled={!c.hasAccess}
              className="text-sm"
            >
              <span className="flex flex-col">
                <span className="font-medium text-fg-primary">
                  {c.label}
                  {!c.hasAccess ? (
                    <span className="ml-1.5 text-xs font-normal text-fg-tertiary">
                      · нет доступа
                    </span>
                  ) : null}
                </span>
                {c.department ? (
                  <span className="text-xs text-fg-tertiary">
                    {c.department}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
