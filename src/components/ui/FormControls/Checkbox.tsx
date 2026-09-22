import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./FormControls.module.css";

export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { id, label, className = "", ...props },
  ref,
) {
  return (
    <label htmlFor={id} className={`${styles.checkboxLabel} ${className}`}>
      <input ref={ref} id={id} type="checkbox" className={styles.checkbox} {...props} />
      <span>{label}</span>
    </label>
  );
});
