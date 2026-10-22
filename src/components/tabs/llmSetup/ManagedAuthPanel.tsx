import { Copy, ExternalLink } from "lucide-react";
import type { CustomProvider, ProviderStatus } from "../../../store";
import { isCodexProvider, isCopilotProvider } from "../../../store/providerHelpers";
import {
  awaitsDeviceSignIn,
  managedHeadline,
  managedStatusDotClass,
  signInButtonLabel,
  verificationPage,
  type ManagedAuthCopy,
} from "./managedAuth";
import { useManagedAuthActions } from "./useManagedAuthActions";

type ManagedAuthActions = ReturnType<typeof useManagedAuthActions>;

interface ManagedAuthPanelProps {
  provider: CustomProvider;
  status: ProviderStatus;
  copy: ManagedAuthCopy;
}

/** Sign-in for providers whose official runtime owns the credentials (Copilot, Codex). */
export function ManagedAuthPanel({ provider, status, copy }: ManagedAuthPanelProps) {
  const actions = useManagedAuthActions(provider, status, copy);
  const diagnostics = status.diagnostics ?? [];

  return (
    <div className="space-y-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-app)]/60 p-4">
      <div className="flex items-start justify-between gap-4">
        <ManagedStatusSummary provider={provider} status={status} copy={copy} />
        <ManagedAuthButtons status={status} copy={copy} actions={actions} />
      </div>
      {awaitsDeviceSignIn(status) && <DeviceSignInCard status={status} copy={copy} actions={actions} />}
      {diagnostics.length > 0 && (
        <details className="rounded-lg border border-[var(--border-color)]/60 bg-[var(--bg-app)]/60 p-3">
          <summary className="cursor-pointer font-mono text-[10px] font-bold text-[var(--text-normal)]">Authentication diagnostics</summary>
          <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-app)] p-2 font-mono text-[9px] leading-relaxed text-[var(--text-muted)]">{diagnostics.join("\n")}</pre>
          <button id="llm-copy-managed-diagnostics-button" type="button" onClick={actions.copyDiagnostics} className="mt-2 flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-2.5 py-1.5 font-mono text-[9px] font-bold text-[var(--text-normal)] hover:border-[var(--accent-color)] hover:text-[var(--text-light)]"><Copy size={11} /><span>Copy Diagnostics</span></button>
        </details>
      )}
      <div className="border-t border-[var(--border-color)]/50 pt-3 text-[10px] leading-relaxed text-[var(--text-muted)]">
        {copy.credentialNote}
      </div>
    </div>
  );
}

function ManagedStatusSummary({ provider, status, copy }: ManagedAuthPanelProps) {
  const host = isCopilotProvider(provider) ? status.host : undefined;
  const planType = isCodexProvider(provider) ? status.planType : undefined;

  return (
    <div className="flex items-start gap-3">
      <div className={`mt-0.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${managedStatusDotClass(status)}`} />
      <div className="space-y-1">
        <div className="font-mono text-xs font-bold text-[var(--text-light)]">
          {managedHeadline(status, copy.vendor)}
        </div>
        <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">{status.message || copy.accountHint}</p>
        <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">The first sign-in downloads this integration’s runtime. Other integrations are downloaded only when you use them.</p>
        {host && <p className="font-mono text-[9px] text-[var(--text-muted)]">{host}</p>}
        {planType && <p className="font-mono text-[9px] text-[var(--text-muted)]">Plan: {planType}</p>}
      </div>
    </div>
  );
}

interface ManagedActionProps {
  status: ProviderStatus;
  copy: ManagedAuthCopy;
  actions: ManagedAuthActions;
}

function ManagedAuthButtons({ status, copy, actions }: ManagedActionProps) {
  const signingIn = status.kind === "loading";

  return (
    <div className="flex flex-shrink-0 items-center gap-2">
      {status.kind === "ready" && (
        <button id="llm-managed-sign-out-button" type="button" onClick={() => void actions.signOut()} className="whitespace-nowrap rounded-lg border border-[var(--border-color)] bg-[var(--bg-app)] px-3 py-2 font-mono text-[10px] font-bold text-[var(--text-normal)] transition-colors hover:border-[var(--color-status-danger)] hover:text-[var(--color-status-danger)] disabled:cursor-not-allowed disabled:opacity-50">Sign Out</button>
      )}
      {signingIn && (
        <button id="llm-cancel-managed-login-button" type="button" onClick={() => void actions.cancelSignIn()} disabled={actions.cancelling} className="whitespace-nowrap rounded-lg border border-[var(--border-color)] bg-[var(--bg-app)] px-3 py-2 font-mono text-[10px] font-bold text-[var(--text-muted)] transition-colors hover:border-[var(--color-status-danger)] hover:text-[var(--color-status-danger)] disabled:cursor-not-allowed disabled:opacity-50">{actions.cancelling ? "Cancelling…" : "Cancel"}</button>
      )}
      <button id="llm-managed-sign-in-button" type="button" onClick={() => void actions.signIn()} disabled={signingIn} className="whitespace-nowrap rounded-lg bg-[var(--accent-color)] px-3 py-2 font-mono text-[10px] font-bold text-[var(--color-primary-foreground)] transition-opacity disabled:cursor-not-allowed disabled:opacity-50">
        {signInButtonLabel(status, copy.vendor)}
      </button>
    </div>
  );
}

function DeviceSignInCard({ status, copy, actions }: ManagedActionProps) {
  const page = verificationPage(status, copy);

  return (
    <div className="rounded-xl border border-[var(--accent-color)]/40 bg-[var(--accent-bg)]/10 p-4 text-center">
      <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">{status.userCode ? `${copy.vendor} device code` : `Waiting for ${copy.vendor} sign-in`}</div>
      {status.userCode ? (
        <button id="llm-copy-managed-code-value-button" type="button" onClick={actions.copyCode} className="mt-2 font-mono text-2xl font-bold tracking-[0.18em] text-[var(--text-light)] hover:text-[var(--accent-color)]" title="Copy device code">{status.userCode}</button>
      ) : (
        <p className="mt-2 font-mono text-[10px] text-[var(--text-normal)]">A browser window should have opened. If it didn&apos;t, open the sign-in page below.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        {status.userCode && <button id="llm-copy-managed-code-button" type="button" onClick={actions.copyCode} className="flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-app)] px-3 py-2 font-mono text-[10px] font-bold text-[var(--text-normal)] hover:border-[var(--accent-color)] hover:text-[var(--text-light)]"><Copy size={12} /><span>Copy Code</span></button>}
        <button id="llm-open-managed-verification-button" type="button" onClick={actions.openVerificationPage} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-3 py-2 font-mono text-[10px] font-bold text-[var(--color-primary-foreground)] hover:opacity-90"><ExternalLink size={12} /><span>Open {copy.vendor}</span></button>
      </div>
      <p className="mt-2 break-all font-mono text-[9px] text-[var(--text-muted)]">{page}</p>
    </div>
  );
}
