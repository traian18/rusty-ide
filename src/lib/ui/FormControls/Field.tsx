import type { ReactNode } from "react";
import styles from "./FormControls.module.css";

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export function Field({ id, label, hint, error, children }: FieldProps) {
  const descriptionId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p className={styles.error} id={descriptionId}>{error}</p>
      ) : hint ? (
        <p className={styles.hint} id={descriptionId}>{hint}</p>
      ) : null}
    </div>
  );
}
