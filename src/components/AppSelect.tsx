"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const SELECT_EMPTY = "__empty__";

export type SelectOption = {
  value: string;
  label: string;
};

type AppSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  "aria-label"?: string;
};

export function toSelectValue(value: string) {
  return value || SELECT_EMPTY;
}

export function fromSelectValue(value: string) {
  return value === SELECT_EMPTY ? "" : value;
}

export default function AppSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  className,
  triggerClassName,
  disabled,
  "aria-label": ariaLabel,
}: AppSelectProps) {
  return (
    <Select
      value={toSelectValue(value)}
      onValueChange={(v) => onValueChange(fromSelectValue(v))}
      disabled={disabled}
    >
      <SelectTrigger className={cn(triggerClassName, className)} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value || SELECT_EMPTY} value={toSelectValue(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
