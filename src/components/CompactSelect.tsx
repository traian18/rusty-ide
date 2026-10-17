import type { ReactNode } from "react";
import { CustomSelect, type Option } from "./CustomSelect";

export interface CompactSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  icon?: ReactNode;
}

/**
 * The small accent-coloured dropdown used in toolbars, as in the Source Control repository picker.
 * One definition of that look, so every toolbar select matches it.
 */
export function CompactSelect({ id, value, onChange, options, placeholder, icon }: CompactSelectProps) {
  return (
    <CustomSelect
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="min-w-0"
      buttonClassName="flex items-center space-x-1 bg-[var(--accent-bg)]/35 text-[var(--accent-color)] px-2 py-1 rounded font-mono text-[10px] border border-[var(--accent-color)]/25 hover:border-[var(--accent-color)]/50 transition-all cursor-pointer font-bold max-w-[160px]"
      dropdownClassName="font-mono text-[10px] min-w-[160px]"
      icon={icon}
      chevronClassName="!w-2.5 !h-2.5 !ml-0.5 opacity-60"
      options={options}
    />
  );
}
