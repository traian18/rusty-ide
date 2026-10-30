import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./FormControls.module.css";

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  id: string;
  label: ReactNode;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { id, label, className = "", ...props },
  ref,
) {
  return (
    <label htmlFor={id} className={`${styles.switchLabel} ${className}`}>
      <input ref={ref} id={id} type="checkbox" role="switch" className={styles.switchInput} {...props} />
      <span className={styles.switchTrack} aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
});
