import React, { useState, useEffect, useRef } from "react";
import { GitBranch, GitMerge, GitPullRequest, Trash2, AlertCircle } from "lucide-react";
import { Modal } from "./ui/Modal/Modal";
import { Button } from "./ui/Button/Button";
import { Field } from "./ui/FormControls/Field";
import { Input } from "./ui/FormControls/Input";
import { Checkbox } from "./ui/FormControls/Checkbox";
import { Callout } from "./ui/Callout/Callout";
import styles from "./BranchDialog.module.css";

interface BranchDialogProps {
  mode: "create" | "merge" | "rebase" | "delete";
  currentBranch: string;
  localBranches: string[];
  remoteBranches?: string[];
  onConfirm: (branchName: string, extra?: boolean) => void;
  onCancel: () => void;
}

export const BranchDialog: React.FC<BranchDialogProps> = ({ mode, currentBranch, localBranches, remoteBranches = [], onConfirm, onCancel }) => {
  const [branchName, setBranchName] = useState("");
  const [checkoutAfter, setCheckoutAfter] = useState(true);
  const [forceDelete, setForceDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "create") {
      inputRef.current?.focus();
    }
  }, [mode]);

  const config = {
    create: {
      icon: GitBranch,
      title: "Create Branch",
      placeholder: "e.g. feature/my-new-branch",
      label: "Branch name",
      confirmLabel: "Create",
      danger: false,
    },
    merge: {
      icon: GitMerge,
      title: "Merge Branch",
      placeholder: "",
      label: "Merge into current branch",
      confirmLabel: "Merge",
      danger: false,
    },
    rebase: {
      icon: GitPullRequest,
      title: "Rebase",
      placeholder: "",
      label: "Rebase current branch onto",
      confirmLabel: "Rebase",
      danger: false,
    },
    delete: {
      icon: Trash2,
      title: "Delete Branch",
      placeholder: "",
      label: "Select a branch to delete",
      confirmLabel: "Delete",
      danger: true,
    },
  }[mode];

  const isOriginBranch = branchName.startsWith("origin/");
  const isCurrent = branchName === currentBranch || branchName === `origin/${currentBranch}`;

  const handleConfirm = () => {
    const name = branchName.trim();
    if (mode === "create") {
      if (!name) {
        setError("Branch name is required");
        return;
      }
      if (localBranches.includes(name)) {
        setError("Branch already exists");
        return;
      }
      onConfirm(name, checkoutAfter);
    } else if (mode === "delete") {
      if (!name) {
        setError("Please select a branch");
        return;
      }
      if (isCurrent) {
        setError("Cannot delete the currently checked out branch");
        return;
      }
      onConfirm(name, forceDelete);
    } else {
      if (!name) {
        setError("Please select a branch");
        return;
      }
      if (name === currentBranch) {
        setError(`Cannot ${mode} onto the current branch`);
        return;
      }
      onConfirm(name);
    }
  };

  const renderBranchRow = (b: string) => {
    const rowCurrent = b === currentBranch || b === `origin/${currentBranch}`;
    const selected = branchName === b;
    return (
      <div
        key={b}
        onClick={() => { setBranchName(b); setError(null); }}
        className={`${styles.branchRow} ${styles.mono} ${selected ? styles.branchRowSelected : ""}`}
      >
        <GitBranch size={12} className={styles.branchIcon} />
        <span className={styles.branchName}>{b}</span>
        {rowCurrent && <span className={styles.branchCurrentTag}>current</span>}
      </div>
    );
  };

  const showOriginWarning = mode === "delete" && isOriginBranch;
  const showLocalDeleteOptions = mode === "delete" && branchName && !isOriginBranch;

  return (
    <Modal
      id="branch-dialog"
      title={config.title}
      icon={config.icon}
      onClose={onCancel}
      footer={
        <>
          <Button id="branch-dialog-cancel" type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            id="branch-dialog-confirm"
            type="button"
            variant={config.danger ? "danger" : "primary"}
            onClick={handleConfirm}
            disabled={mode === "create" ? !branchName.trim() : !branchName}
          >
            {showOriginWarning ? "Delete from Origin" : config.confirmLabel}
          </Button>
        </>
      }
    >
      {mode !== "create" && (
        <p className={`${styles.currentBranchInfo} ${styles.mono}`}>
          Current branch: <span className={styles.currentBranchValue}>{currentBranch}</span>
        </p>
      )}

      {mode === "create" ? (
        <Field id="branch-dialog-name" label={config.label}>
          <Input
            ref={inputRef}
            id="branch-dialog-name"
            type="text"
            value={branchName}
            onChange={(e) => { setBranchName(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
            }}
            placeholder={config.placeholder}
          />
        </Field>
      ) : mode === "delete" ? (
        <Field id="branch-dialog-list" label={config.label}>
          <div id="branch-dialog-list" className={`${styles.branchList} ${styles.branchListCompact}`}>
            {localBranches.length > 0 && (
              <div>
                <div className={`${styles.branchListLabel} ${styles.mono}`}>Local</div>
                {localBranches.map(renderBranchRow)}
              </div>
            )}
            {remoteBranches.length > 0 && (
              <div>
                <div className={`${styles.branchListLabel} ${styles.mono}`}>Origin</div>
                {remoteBranches.map(renderBranchRow)}
              </div>
            )}
            {localBranches.length === 0 && remoteBranches.length === 0 && (
              <div className={styles.emptyState}>No branches available</div>
            )}
          </div>
        </Field>
      ) : (
        <Field id="branch-dialog-list" label={config.label}>
          <div id="branch-dialog-list" className={styles.branchList}>
            {localBranches.filter(b => b !== currentBranch).map(renderBranchRow)}
          </div>
        </Field>
      )}

      {mode === "create" && (
        <Checkbox
          id="branch-dialog-checkout-after"
          label="Checkout after creation"
          checked={checkoutAfter}
          onChange={(e) => setCheckoutAfter(e.target.checked)}
        />
      )}

      {showLocalDeleteOptions && (
        <Checkbox
          id="branch-dialog-force-delete"
          label={<>Force delete (<span className={`${styles.mono} ${styles.forceDeleteFlag}`}>-D</span>) — even if not merged</>}
          checked={forceDelete}
          onChange={(e) => setForceDelete(e.target.checked)}
        />
      )}

      {showOriginWarning && (
        <Callout variant="danger">
          This will permanently delete <strong>{branchName}</strong> from the remote origin via{" "}
          <strong>push --delete</strong>. This action cannot be undone.
        </Callout>
      )}

      {error && (
        <div className={styles.errorRow} role="alert">
          <AlertCircle size={12} />
          <span>{error}</span>
        </div>
      )}
    </Modal>
  );
};
