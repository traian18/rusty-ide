import React, { useState, useRef, useEffect } from "react";
import { useConfirm } from "../../../lib/ui/useConfirm";
import { UnmergedBranchError } from "../gitErrors";

export interface GitBranchManagerProps {
  currentBranch: string;
  /** True when HEAD isn't on a branch (detached, or no commits yet) --
      "merge/rebase into current" has no current branch to act on then
      (REFACTOR_PLAN.md PR 5b commit 22). Checking out, creating, and
      deleting OTHER branches all remain valid and stay enabled. */
  disableBranchOnlyActions?: boolean;
  branchOnlyActionsReason?: string;
  localBranches: string[];
  remoteBranches: string[];
  onCheckout: (branch: string) => Promise<void>;
  onCreateBranch: (branch: string) => Promise<void>;
  onDeleteBranch: (branch: string, force: boolean) => Promise<void>;
  onMergeBranch: (branch: string) => Promise<void>;
  onRebaseBranch: (branch: string) => Promise<void>;
  onClose: () => void;
}

export function useGitBranchManager({ currentBranch, onCreateBranch, onDeleteBranch, onMergeBranch, onRebaseBranch, onClose }: GitBranchManagerProps) {
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [deletingBranch, setDeletingBranch] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { confirm, ConfirmModalComponent, isOpen: confirmOpen } = useConfirm();
  const confirmOpenRef = useRef(false);
  confirmOpenRef.current = confirmOpen;

  // Close popover when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      // The confirm dialog is portaled into document.body, so every click on
      // it lands "outside" this popover. Closing here would unmount the
      // dialog and abandon the pending delete/merge/rebase.
      if (confirmOpenRef.current) {
        return;
      }
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        const portalMenu = document.querySelector(".branch-actions-portal");
        if (portalMenu && portalMenu.contains(e.target as Node)) {
          return;
        }
        onClose();
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [onClose]);

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newBranchName.trim()) {
      onCreateBranch(newBranchName.trim());
      setNewBranchName("");
      setShowCreateInput(false);
    }
  };

  const handleMouseEnter = (e: React.MouseEvent, branch: string) => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setSelectedBranch(branch);
    
    // Position menu: to the right of parent items
    let left = rect.left + rect.width + 4;
    // Check if it fits horizontally, otherwise open on the left
    if (left + 208 > window.innerWidth) {
      left = rect.left - 208 - 4;
    }
    setMenuPosition({
      top: rect.top,
      left,
    });
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setSelectedBranch(null);
    }, 150);
  };

  const handleSubMenuMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const handleSubMenuMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setSelectedBranch(null);
    }, 150);
  };

  const handleMerge = async (branch: string) => {
    const isRemote = branch.startsWith("origin/");
    const displayName = isRemote ? branch.replace("origin/", "") : branch;
    const confirmed = await confirm({
      title: "Confirm Merge Branch",
      message: `Are you sure you want to merge commits from branch "${displayName}" into your active branch "${currentBranch}"? This will integrate modifications from "${displayName}" directly.`,
      confirmLabel: "Merge",
      cancelLabel: "Cancel",
      kind: "warning",
    });
    if (confirmed) {
      onMergeBranch(branch);
    }
  };

  const handleRebase = async (branch: string) => {
    const isRemote = branch.startsWith("origin/");
    const displayName = isRemote ? branch.replace("origin/", "") : branch;
    const confirmed = await confirm({
      title: "Confirm Rebase Branch",
      message: `Are you sure you want to rebase your current active branch "${currentBranch}" onto branch "${displayName}"? This will temporarily shelve your local changes and replay them on top of commits from "${displayName}".`,
      confirmLabel: "Rebase",
      cancelLabel: "Cancel",
      kind: "warning",
    });
    if (confirmed) {
      onRebaseBranch(branch);
    }
  };

  const handleDelete = async (branch: string) => {
    const isRemote = branch.startsWith("origin/");
    const displayName = isRemote ? branch.replace("origin/", "") : branch;
    const confirmed = await confirm({
      title: "Confirm Delete Branch",
      message: `Are you sure you want to permanently delete the branch "${displayName}"? This action cannot be undone.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      kind: "danger",
    });
    if (!confirmed) return;

    setDeletingBranch(branch);
    try {
      try {
        await onDeleteBranch(branch, false);
      } catch (err) {
        if (!(err instanceof UnmergedBranchError)) throw err;
        const force = await confirm({
          title: "Branch Not Fully Merged",
          message: `"${displayName}" has commits that aren't merged into "${currentBranch}" or its upstream. Deleting it will lose those commits unless they exist elsewhere. Delete anyway?`,
          confirmLabel: "Force Delete",
          cancelLabel: "Keep Branch",
          kind: "danger",
        });
        if (!force) return;
        await onDeleteBranch(branch, true);
      }
      setSelectedBranch(null);
    } catch {
      // GitService already reports the command error. Keep the branch
      // selected so the user can retry or choose another action.
    } finally {
      setDeletingBranch(null);
    }
  };



  return {
    selectedBranch,
    setSelectedBranch,
    menuPosition,
    setMenuPosition,
    showCreateInput,
    setShowCreateInput,
    newBranchName,
    setNewBranchName,
    deletingBranch,
    setDeletingBranch,
    popoverRef,
    closeTimeoutRef,
    confirm,
    ConfirmModalComponent,
    isOpen: confirmOpen,
    confirmOpenRef,
    handleCreateSubmit,
    handleMouseEnter,
    handleMouseLeave,
    handleSubMenuMouseEnter,
    handleSubMenuMouseLeave,
    handleMerge,
    handleRebase,
    handleDelete,
  };
}
