import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CustomSelect } from "../../CustomSelect";

const INPUT_CLASS = "bg-[var(--bg-app)] border border-[var(--border-color)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--text-light)] font-mono focus:outline-none focus:border-[var(--border-active)] placeholder-[var(--text-muted)]/70 shadow-inner";
export const FULL_INPUT_CLASS = `w-full ${INPUT_CLASS}`;
export const HALF_INPUT_CLASS = `w-1/2 ${INPUT_CLASS}`;
export const NOTE_CLASS = "text-[10px] text-[var(--text-muted)] leading-relaxed italic block mt-1 font-mono";
export const CHECKBOX_CLASS = "h-4 w-4 rounded border-gray-300 text-[var(--accent-color)] focus:ring-[var(--accent-color)]";

export function FieldLabel({ htmlFor, icon: Icon, children }: { htmlFor?: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-bold text-[var(--text-normal)] uppercase font-mono tracking-wide flex items-center space-x-1.5">
      <Icon size={13} className="text-[var(--color-secondary)]" />
      <span>{children}</span>
    </label>
  );
}

interface TextSettingProps {
  id: string;
  label: string;
  icon: LucideIcon;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** Notes shown under the input. */
  children?: ReactNode;
}

export function TextSetting({ id, label, icon, placeholder, value, onChange, children }: TextSettingProps) {
  return (
    <div className="space-y-2">
      <FieldLabel htmlFor={id} icon={icon}>{label}</FieldLabel>
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FULL_INPUT_CLASS}
      />
      {children}
    </div>
  );
}

interface SelectSettingProps {
  label: string;
  value: string;
  options: Array<{ id: string; name: string }>;
  onChange: (value: string) => void;
}

export function SelectSetting({ label, value, options, onChange }: SelectSettingProps) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-bold text-[var(--text-normal)] uppercase font-mono tracking-wide">
        {label}
      </label>
      <CustomSelect value={value} onChange={onChange} options={options} />
    </div>
  );
}
