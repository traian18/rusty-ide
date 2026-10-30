import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./IconButton.module.css";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  /** Accessible name — also used as the visible tooltip via title. */
  label: string;
  size?: "sm" | "md";
  selected?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = "md", selected = false, className = "", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={selected || undefined}
      className={`${styles.iconButton} ${styles[size]} ${selected ? styles.selected : ""} ${className}`}
      {...props}
    >
      {icon}
    </button>
  );
});
