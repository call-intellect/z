"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/ui/shadcn/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/shadcn/command";
import { cn } from "@/ui/shadcn/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/shadcn/popover";

export type SearchSelectOption = { value: string; label: string };

export function SearchSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder = "Поиск…",
  emptyText = "Ничего не найдено",
  disabled = false,
  className,
  triggerClassName,
}: {
  label?: string;
  options: SearchSelectOption[];
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const labelByValue = useMemo(
    () => new Map(options.map((o) => [o.value, o.label])),
    [options],
  );

  const triggerText = value ? (labelByValue.get(value) ?? value) : placeholder;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label ? (
        <span className="text-[11px] text-fg-tertiary">{label}</span>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "h-9 w-full justify-between font-normal",
              !value && "text-fg-tertiary",
              triggerClassName,
            )}
          >
            <span className="truncate">{triggerText}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={o.label}
                    onSelect={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        value === o.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{o.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
