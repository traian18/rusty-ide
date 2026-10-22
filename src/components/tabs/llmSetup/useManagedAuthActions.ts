import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CustomProvider, ProviderStatus } from "../../../store";
import { notify } from "../../../notificationStore";
import { cancelManagedLogin, logoutManaged, startManagedLogin } from "../../shell/providerCoordinator";
import { verificationPage, type ManagedAuthCopy } from "./managedAuth";

function errorMessage(error: unknown, fallback: string): string {
  return (error as { message?: string } | null | undefined)?.message || fallback;
}

async function copyWithNotice(value: string, copied: { title: string; message: string }, failure: string) {
  try {
    await navigator.clipboard.writeText(value);
    notify(copied.title, copied.message, "success");
  } catch (error) {
    notify("Copy failed", errorMessage(error, failure), "error");
  }
}

async function signIn(provider: CustomProvider, { vendor }: ManagedAuthCopy) {
  try {
    await startManagedLogin(provider);
  } catch (error) {
    notify("Sign-in failed", errorMessage(error, `Could not start ${vendor} authorization.`), "error");
  }
}

async function signOut(provider: CustomProvider, { vendor, product }: ManagedAuthCopy) {
  try {
    await logoutManaged(provider);
    notify("Signed out", `Disconnected the ${vendor} account from ${product}.`, "success");
  } catch (error) {
    notify("Sign-out failed", errorMessage(error, `Could not sign out of ${product}.`), "error");
  }
}

async function cancelSignIn(provider: CustomProvider, { vendor }: ManagedAuthCopy) {
  try {
    await cancelManagedLogin(provider);
    notify("Sign-in cancelled", `Cancelled ${vendor} sign-in attempt.`, "info");
  } catch (error) {
    notify("Cancel failed", errorMessage(error, `Could not cancel ${vendor} sign-in.`), "error");
  }
}

async function openVerificationPage(status: ProviderStatus, copy: ManagedAuthCopy) {
  const page = verificationPage(status, copy);
  try {
    await openUrl(page);
  } catch (error) {
    notify(`Could not open ${copy.vendor}`, errorMessage(error, `Open ${page} in your browser.`), "error");
  }
}

/** The sign-in, sign-out and device-code actions of a Copilot or Codex provider. */
export function useManagedAuthActions(provider: CustomProvider, status: ProviderStatus, copy: ManagedAuthCopy) {
  const [cancelling, setCancelling] = useState(false);

  return {
    cancelling,
    signIn: () => signIn(provider, copy),
    signOut: () => signOut(provider, copy),
    cancelSignIn: async () => {
      setCancelling(true);
      try {
        await cancelSignIn(provider, copy);
      } finally {
        setCancelling(false);
      }
    },
    openVerificationPage: () => openVerificationPage(status, copy),
    copyCode: async () => {
      if (!status.userCode) return;
      await copyWithNotice(status.userCode, { title: "Code copied", message: `The ${copy.vendor} device code was copied to your clipboard.` }, "Could not copy the device code.");
    },
    copyDiagnostics: async () => {
      if (!status.diagnostics?.length) return;
      await copyWithNotice(status.diagnostics.join("\n"), { title: "Diagnostics copied", message: `Paste these redacted ${copy.product} authentication logs into the issue or chat.` }, "Could not copy the authentication diagnostics.");
    },
  };
}
