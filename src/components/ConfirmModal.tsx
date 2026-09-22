import React from "react";
import { Modal } from "./ui/Modal/Modal";
import { Button } from "./ui/Button/Button";
import { Callout } from "./ui/Callout/Callout";
import type { CalloutVariant } from "./ui/Callout/Callout";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  kind?: "warning" | "danger" | "info";
  onConfirm: () => void;
  onCancel: () => void;
}

const kindToCalloutVariant: Record<NonNullable<ConfirmModalProps["kind"]>, CalloutVariant> = {
  warning: "warning",
  danger: "danger",
  info: "info",
};

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  kind = "warning",
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <Modal
      id="confirm-modal"
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button id="confirm-modal-cancel" type="button" variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            id="confirm-modal-confirm"
            type="button"
            variant={kind === "info" ? "primary" : "danger"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Callout variant={kindToCalloutVariant[kind]}>{message}</Callout>
    </Modal>
  );
};
