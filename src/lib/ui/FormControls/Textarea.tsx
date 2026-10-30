import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import styles from "./FormControls.module.css";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = "", ...props }, ref) {
    return <textarea ref={ref} className={`${styles.control} ${styles.textarea} ${className}`} {...props} />;
  },
);
