"use client";

import { Search, X } from "lucide-react";
import type { ReactElement } from "react";

import { Input } from "@/ui/shadcn/input";

export interface CloneSearchInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

export function CloneSearchInput({
  value,
  onChange,
  placeholder = "Поиск по названию должности",
}: CloneSearchInputProps): ReactElement {
  return (
    <div className="relative w-full">
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-9 pr-9"
      />
      {value.length > 0 ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Очистить поиск"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-tertiary hover:bg-bg-hover hover:text-fg-secondary"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
