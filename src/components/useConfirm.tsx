import { useState, useCallback } from "react";
import { ConfirmModal } from "./ConfirmModal";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  kind?: "warning" | "danger" | "info";
}

export function useConfirm() {
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    options: ConfirmOptions | null;
    resolve: ((value: boolean) => void) | null;
  }>({
    open: false,
    options: null,
    resolve: null,
  });

  const showConfirmDialog = useCallback((options: ConfirmOptions): Promise<boolean> => {
    console.log("useConfirm.showConfirmDialog called with:", options);
    return new Promise((resolve) => {
      setConfirmState({
        open: true,
        options,
        resolve,
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (confirmState.resolve) {
      confirmState.resolve(true);
    }
    setConfirmState({ open: false, options: null, resolve: null });
  }, [confirmState.resolve]);

  const handleCancel = useCallback(() => {
    if (confirmState.resolve) {
      confirmState.resolve(false);
    }
    setConfirmState({ open: false, options: null, resolve: null });
  }, [confirmState.resolve]);

  const ConfirmModalComponent = confirmState.options ? (
    <ConfirmModal
      open={confirmState.open}
      title={confirmState.options.title}
      message={confirmState.options.message}
      confirmLabel={confirmState.options.confirmLabel}
      cancelLabel={confirmState.options.cancelLabel}
      kind={confirmState.options.kind || "warning"}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return { confirm: showConfirmDialog, ConfirmModalComponent };
}