import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import styles from "./FormControls.module.css";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, className = "", ...props },
  ref,
) {
  return (
    <select ref={ref} className={`${styles.control} ${className}`} {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
});
