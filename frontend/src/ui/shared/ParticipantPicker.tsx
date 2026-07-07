"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from "react";
import useSWR from "swr";

import {
  orgMembersApi,
  type OrgMemberSearchItemApi,
  type OrgMembersSearchResponseApi,
} from "@/api/org-members.api";
import { personsApi } from "@/api/persons.api";
import { Popover, PopoverAnchor, PopoverContent } from "@/ui/shadcn/popover";

export type ParticipantSendChannel = "email" | "telegram";

export type ParticipantPickerValue =
  | {
      type: "user";
      userId: string;
      name: string;
      email?: string;
      sendVia?: ParticipantSendChannel[];
    }
  | {
      type: "person";
      personId: string;
      name: string;
      email?: string;
      sendVia?: ParticipantSendChannel[];
    };

export interface ParticipantPickerProps {
  value: ParticipantPickerValue[];
  onChange: (next: ParticipantPickerValue[]) => void;
  placeholder?: string;
  disabled?: boolean;
  showChannels?: boolean;
  onlyUsers?: boolean;
  excludeUserIds?: string[];
}

function isSameParticipant(
  a: ParticipantPickerValue,
  b: ParticipantPickerValue,
): boolean {
  if (a.type === "user" && b.type === "user") return a.userId === b.userId;
  if (a.type === "person" && b.type === "person")
    return a.personId === b.personId;
  return false;
}

function toValueFromSearch(
  item: OrgMemberSearchItemApi,
): ParticipantPickerValue {
  if (item.type === "user") {
    return {
      type: "user",
      userId: item.userId,
      name: item.name,
      email: item.email,
    };
  }
  return {
    type: "person",
    personId: item.personId,
    name: item.name,
    email: item.email ?? undefined,
  };
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function ParticipantPicker({
  value,
  onChange,
  placeholder = "Найти коллегу или внешний контакт",
  disabled = false,
  showChannels = false,
  onlyUsers = false,
  excludeUserIds,
}: ParticipantPickerProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [quickCreating, setQuickCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebouncedValue(query.trim(), 250);

  const swrKey = useMemo(
    () =>
      debouncedQuery.length >= 1
        ? (["org-members-search", debouncedQuery] as const)
        : null,
    [debouncedQuery],
  );

  const { data, isLoading } = useSWR<OrgMembersSearchResponseApi>(
    swrKey,
    () => orgMembersApi.search(debouncedQuery, 10),
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  const excludeKey = (excludeUserIds ?? []).join(",");
  const results = useMemo(() => {
    let items = data?.items ?? [];
    if (onlyUsers) items = items.filter((r) => r.type === "user");
    const exclude = excludeKey ? excludeKey.split(",") : [];
    if (exclude.length > 0) {
      items = items.filter(
        (r) => r.type !== "user" || !exclude.includes(r.userId),
      );
    }
    return items;
  }, [data, onlyUsers, excludeKey]);

  const filteredResults = useMemo(
    () =>
      results.filter(
        (r) => !value.some((v) => isSameParticipant(v, toValueFromSearch(r))),
      ),
    [results, value],
  );

  const canQuickCreate = useMemo(() => {
    if (onlyUsers) return false;
    if (debouncedQuery.length < 2) return false;
    if (quickCreating) return false;
    const qLower = debouncedQuery.toLowerCase();
    const exactInResults = results.some((r) => r.name.toLowerCase() === qLower);
    const exactInValue = value.some((v) => v.name.toLowerCase() === qLower);
    return !exactInResults && !exactInValue;
  }, [debouncedQuery, quickCreating, results, value, onlyUsers]);

  const addParticipant = useCallback(
    (next: ParticipantPickerValue) => {
      if (value.some((v) => isSameParticipant(v, next))) return;
      onChange([...value, next]);
      setQuery("");
      setError(null);
      inputRef.current?.focus();
    },
    [value, onChange],
  );

  const removeParticipant = useCallback(
    (target: ParticipantPickerValue) => {
      onChange(value.filter((v) => !isSameParticipant(v, target)));
    },
    [value, onChange],
  );

  const toggleChannel = useCallback(
    (target: ParticipantPickerValue, channel: ParticipantSendChannel) => {
      onChange(
        value.map((v) => {
          if (!isSameParticipant(v, target)) return v;
          const current = v.sendVia ?? [];
          const next = current.includes(channel)
            ? current.filter((c) => c !== channel)
            : [...current, channel];
          return { ...v, sendVia: next };
        }),
      );
    },
    [value, onChange],
  );

  const handleQuickCreate = useCallback(async () => {
    if (!debouncedQuery) return;
    setQuickCreating(true);
    setError(null);
    try {
      const created = await personsApi.quickCreate({ name: debouncedQuery });
      addParticipant({
        type: "person",
        personId: created.personId,
        name: created.name,
      });
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Не удалось создать контакт";
      setError(message);
    } finally {
      setQuickCreating(false);
    }
  }, [debouncedQuery, addParticipant]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const first = filteredResults[0];
        if (first) {
          addParticipant(toValueFromSearch(first));
          return;
        }
        if (canQuickCreate) {
          void handleQuickCreate();
        }
        return;
      }
      if (e.key === "Backspace" && query === "" && value.length > 0) {
        const last = value[value.length - 1];
        if (last) removeParticipant(last);
      }
    },
    [
      filteredResults,
      addParticipant,
      canQuickCreate,
      handleQuickCreate,
      query,
      value,
      removeParticipant,
    ],
  );

  const showDropdown =
    open &&
    !disabled &&
    debouncedQuery.length >= 1 &&
    (filteredResults.length > 0 || canQuickCreate || isLoading);

  return (
    <div className="w-full">
      <Popover open={showDropdown} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div
            className="flex min-h-[40px] w-full flex-wrap items-center gap-1.5 rounded-md border border-border-subtle bg-bg-overlay px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-accent"
            onClick={() => {
              if (!disabled) inputRef.current?.focus();
            }}
          >
            {value.map((v) => (
              <ParticipantChip
                key={v.type === "user" ? `u:${v.userId}` : `p:${v.personId}`}
                value={v}
                onRemove={() => removeParticipant(v)}
                onToggleChannel={(channel) => toggleChannel(v, channel)}
                showChannels={showChannels}
                disabled={disabled}
              />
            ))}
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder={value.length === 0 ? placeholder : ""}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              className="min-w-[140px] flex-1 bg-transparent text-sm text-fg-primary placeholder:text-fg-tertiary focus:outline-none disabled:cursor-not-allowed"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-[var(--radix-popover-trigger-width)] max-w-none p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="max-h-72 overflow-y-auto py-1">
            {isLoading && (
              <div className="px-3 py-2 text-xs text-fg-tertiary">Поиск…</div>
            )}
            {!isLoading && filteredResults.length === 0 && !canQuickCreate && (
              <div className="px-3 py-2 text-xs text-fg-tertiary">
                Ничего не найдено
              </div>
            )}
            {filteredResults.map((item) => (
              <ParticipantOption
                key={
                  item.type === "user"
                    ? `u:${item.userId}`
                    : `p:${item.personId}`
                }
                item={item}
                onSelect={() => addParticipant(toValueFromSearch(item))}
              />
            ))}
            {canQuickCreate && (
              <button
                type="button"
                onClick={() => void handleQuickCreate()}
                disabled={quickCreating}
                className="flex w-full items-center gap-2 border-t border-border-subtle px-3 py-2 text-left text-sm text-fg-primary hover:bg-bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span aria-hidden className="text-base leading-none">
                  +
                </span>
                <span>Добавить «{debouncedQuery}» как внешний контакт</span>
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {error && (
        <p className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ParticipantChip({
  value,
  onRemove,
  onToggleChannel,
  showChannels,
  disabled,
}: {
  value: ParticipantPickerValue;
  onRemove: () => void;
  onToggleChannel: (channel: ParticipantSendChannel) => void;
  showChannels: boolean;
  disabled: boolean;
}): JSX.Element {
  const isUser = value.type === "user";
  const sendVia = value.sendVia ?? [];
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-bg-elevated px-2 py-0.5 text-xs text-fg-primary">
      <span aria-hidden className="text-[10px]">
        {isUser ? "◉" : "○"}
      </span>
      <span className="max-w-[180px] truncate">{value.name}</span>
      {showChannels && !disabled && (
        <span className="ml-0.5 inline-flex items-center gap-0.5">
          <ChannelToggle
            label="Почта"
            active={sendVia.includes("email")}
            onToggle={() => onToggleChannel("email")}
          />
          <ChannelToggle
            label="Телеграм"
            active={sendVia.includes("telegram")}
            onToggle={() => onToggleChannel("telegram")}
          />
        </span>
      )}
      {!disabled && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Удалить ${value.name}`}
          className="ml-0.5 rounded text-fg-tertiary hover:text-fg-primary"
        >
          ×
        </button>
      )}
    </span>
  );
}

function ChannelToggle({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={active}
      title={`Отправить приглашение: ${label}`}
      className={
        active
          ? "rounded px-1.5 py-0.5 text-[10px] font-medium bg-accent text-accent-fg"
          : "rounded px-1.5 py-0.5 text-[10px] font-medium bg-bg-overlay text-fg-tertiary hover:text-fg-secondary"
      }
    >
      {label}
    </button>
  );
}

function ParticipantOption({
  item,
  onSelect,
}: {
  item: OrgMemberSearchItemApi;
  onSelect: () => void;
}): JSX.Element {
  const isUser = item.type === "user";
  const subtitle = isUser
    ? item.email
    : item.email
      ? `${item.email} · ${relationshipLabel(item.relationship)}`
      : relationshipLabel(item.relationship);
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-bg-elevated"
    >
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-subtle text-[10px] text-fg-secondary"
      >
        {isUser ? "◉" : "○"}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-fg-primary">{item.name}</span>
        {subtitle && (
          <span className="truncate text-xs text-fg-tertiary">{subtitle}</span>
        )}
      </span>
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-fg-tertiary">
        {isUser ? "Коллега" : "Контакт"}
      </span>
    </button>
  );
}

function relationshipLabel(relationship: string): string {
  if (relationship === "employee") return "Сотрудник";
  if (relationship === "external") return "Внешний контакт";
  return relationship;
}
