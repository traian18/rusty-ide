import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import styles from "./FormControls.module.css";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = "", ...props },
  ref,
) {
  return <input ref={ref} className={`${styles.control} ${className}`} {...props} />;
});
