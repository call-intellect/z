"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, getDefaultClassNames } from "react-day-picker";

import { cn } from "./lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  const defaultClassNames = getDefaultClassNames();
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        root: cn(defaultClassNames.root, "text-fg-primary"),
        months: cn(defaultClassNames.months, "flex flex-col gap-4 sm:flex-row"),
        month: cn(defaultClassNames.month, "space-y-3"),
        month_caption: cn(
          defaultClassNames.month_caption,
          "relative flex h-9 items-center justify-center",
        ),
        caption_label: cn(defaultClassNames.caption_label, "text-sm font-medium"),
        nav: cn(
          defaultClassNames.nav,
          "absolute inset-x-0 top-0 flex items-center justify-between px-1",
        ),
        button_previous: cn(
          defaultClassNames.button_previous,
          "flex h-7 w-7 items-center justify-center rounded-md hover:bg-bg-overlay",
        ),
        button_next: cn(
          defaultClassNames.button_next,
          "flex h-7 w-7 items-center justify-center rounded-md hover:bg-bg-overlay",
        ),
        month_grid: cn(defaultClassNames.month_grid, "w-full border-collapse"),
        weekdays: cn(defaultClassNames.weekdays, "flex"),
        weekday: cn(
          defaultClassNames.weekday,
          "w-9 text-[0.8rem] font-normal text-fg-tertiary",
        ),
        week: cn(defaultClassNames.week, "mt-1 flex w-full"),
        day: cn(defaultClassNames.day, "relative h-9 w-9 p-0 text-center text-sm"),
        day_button: cn(
          defaultClassNames.day_button,
          "h-9 w-9 rounded-md font-normal transition-colors hover:bg-bg-overlay",
        ),
        range_start: cn(
          defaultClassNames.range_start,
          "rounded-l-md bg-accent text-accent-fg",
        ),
        range_end: cn(
          defaultClassNames.range_end,
          "rounded-r-md bg-accent text-accent-fg",
        ),
        range_middle: cn(defaultClassNames.range_middle, "bg-accent/20 text-fg-primary"),
        selected: cn(defaultClassNames.selected, "bg-accent text-accent-fg"),
        today: cn(defaultClassNames.today, "border border-accent-border"),
        outside: cn(defaultClassNames.outside, "text-fg-tertiary opacity-50"),
        disabled: cn(defaultClassNames.disabled, "text-fg-tertiary opacity-30"),
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName, ...chevronProps }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("h-4 w-4", chevronClassName)} {...chevronProps} />
          ) : (
            <ChevronRight className={cn("h-4 w-4", chevronClassName)} {...chevronProps} />
          ),
      }}
      {...props}
    />
  );
}
