import React from "react";
import { Check, Copy, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { Modal } from "./ui/Modal/Modal";
import { Button } from "./ui/Button/Button";
import { Callout } from "./ui/Callout/Callout";
import type { CalloutVariant } from "./ui/Callout/Callout";

export const variantConfig = {
  success: { Icon: CheckCircle2, calloutVariant: "success" as CalloutVariant, titleDefault: "Success" },
  error: { Icon: AlertCircle, calloutVariant: "danger" as CalloutVariant, titleDefault: "Error" },
  info: { Icon: Info, calloutVariant: "info" as CalloutVariant, titleDefault: "Info" },
  danger: { Icon: AlertTriangle, calloutVariant: "danger" as CalloutVariant, titleDefault: "Warning" },
} as const;

export type NotificationVariant = keyof typeof variantConfig;

interface AlertModalViewProps {
  notification: {
    variant: NotificationVariant;
    title?: string;
    message: string;
  } | null;
  clear: () => void;
}

const ERROR_PREVIEW_LENGTH = 240;

export const AlertModalView: React.FC<AlertModalViewProps> = ({ notification, clear }) => {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    setCopied(false);
  }, [notification]);

  if (!notification) return null;

  const cfg = variantConfig[notification.variant];
  const isDanger = notification.variant === "error" || notification.variant === "danger";
  const shouldTruncate = notification.message.length > ERROR_PREVIEW_LENGTH;
  const preview = shouldTruncate
    ? `${notification.message.slice(0, ERROR_PREVIEW_LENGTH).trimEnd()}…`
    : notification.message;

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(notification.message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal
      id="alert-modal"
      title={notification.title || cfg.titleDefault}
      icon={cfg.Icon}
      onClose={clear}
      size="sm"
      footer={
        <>
          {isDanger && (
            <Button
              id="alert-modal-copy-error"
              type="button"
              variant="secondary"
              icon={copied ? <Check size={14} /> : <Copy size={14} />}
              onClick={copyMessage}
            >
              {copied ? "Copied" : "Copy full error"}
            </Button>
          )}
          <Button id="alert-modal-ok" type="button" variant={isDanger ? "danger" : "primary"} onClick={clear}>
            OK
          </Button>
        </>
      }
    >
      <Callout variant={cfg.calloutVariant}>
        <span className="whitespace-pre-wrap break-words">{preview}</span>
        {shouldTruncate && (
          <p className="mt-2 text-xs opacity-75">The full error is available with “Copy full error”.</p>
        )}
      </Callout>
    </Modal>
  );
};
