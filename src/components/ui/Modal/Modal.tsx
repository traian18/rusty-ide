import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useModalFocus } from "./useModalFocus";
import styles from "./Modal.module.css";

type ModalIcon = React.ComponentType<{ size?: number; className?: string }>;

export interface ModalProps {
  /** Stable id used to derive title/description/close-button ids. */
  id: string;
  title: string;
  description?: string;
  icon?: ModalIcon;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  /** Whether Escape closes the modal. Set false for required/irreversible decisions. */
  closeOnEscape?: boolean;
  /** Whether clicking the backdrop closes the modal. Set false for required/irreversible decisions. */
  closeOnBackdrop?: boolean;
  /** Hide the header close button for decisions that must be made through an explicit footer action. */
  showCloseButton?: boolean;
  /** Makes the body independently scrollable for tall content. */
  scrollableBody?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  id,
  title,
  description,
  icon: Icon,
  onClose,
  children,
  footer,
  size = "md",
  closeOnEscape = true,
  closeOnBackdrop = true,
  showCloseButton = true,
  scrollableBody = false,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `${id}-title`;
  const descriptionId = description ? `${id}-description` : undefined;

  useModalFocus(panelRef, true);

  useEffect(() => {
    if (!closeOnEscape) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [closeOnEscape, onClose]);

  return createPortal(
    <div className={styles.overlay}>
      <div className={styles.backdrop} onClick={closeOnBackdrop ? onClose : undefined} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={`${styles.panel} ${styles[size]}`}
      >
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            {Icon && <Icon size={16} className={styles.headerIcon} />}
            <span id={titleId} className={styles.title}>{title}</span>
          </div>
          {showCloseButton && (
            <button
              id={`${id}-close`}
              type="button"
              onClick={onClose}
              className={styles.closeButton}
              aria-label={`Close ${title}`}
            >
              <X size={16} />
            </button>
          )}
        </div>
        {description && (
          <p id={descriptionId} className={styles.description}>{description}</p>
        )}
        <div className={scrollableBody ? styles.bodyScrollable : styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};
