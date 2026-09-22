import type { ReactNode } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info } from "lucide-react";
import styles from "./Callout.module.css";

export type CalloutVariant = "info" | "success" | "warning" | "danger";

export interface CalloutProps {
  variant?: CalloutVariant;
  children: ReactNode;
  icon?: ReactNode;
}

const defaultIcons: Record<CalloutVariant, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
};

export function Callout({ variant = "info", children, icon }: CalloutProps) {
  const Icon = defaultIcons[variant];
  return (
    <div className={`${styles.callout} ${styles[variant]}`} role={variant === "danger" ? "alert" : undefined}>
      <span className={styles.icon}>{icon || <Icon size={16} />}</span>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
