import React from "react";
import { AlertTriangle, Shield, Terminal } from "lucide-react";
import type { CommandPermissionDecision, CommandPermissionRequest } from "../../services/commandPermissionService";
import { Modal } from "../ui/Modal/Modal";
import styles from "./CommandPermissionDialog.module.css";

interface CommandPermissionDialogProps {
  request: CommandPermissionRequest;
  onDecision: (decision: CommandPermissionDecision) => void;
}

function formatCommandToken(token: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(token) ? token : JSON.stringify(token);
}

export const CommandPermissionDialog: React.FC<CommandPermissionDialogProps> = ({ request, onDecision }) => {
  const commandText = [request.command.program, ...(request.command.args || [])].map(formatCommandToken).join(" ");
  const destructive = request.risk === "destructive";
  const executableGrant = request.sessionGrantScope === "executable";
  const sessionGrantProgram = request.sessionGrantProgram || request.command.program;

  return (
    <Modal
      id="command-permission"
      title="Command permission required"
      icon={destructive ? AlertTriangle : Shield}
      onClose={() => {}}
      closeOnEscape={false}
      closeOnBackdrop={false}
      showCloseButton={false}
      size="lg"
      footer={
        <>
          <button id="command-permission-deny" type="button" onClick={() => onDecision("deny")} className={`${styles.denyButton} ${styles.mono}`}>
            Deny
          </button>
          <button id="command-permission-allow-once" type="button" onClick={() => onDecision("allow_once")} className={`${styles.allowOnceButton} ${styles.mono}`}>
            Allow once
          </button>
          <button id="command-permission-allow-session" type="button" onClick={() => onDecision("allow_session")} className={`${styles.allowSessionButton} ${styles.mono}`}>
            {executableGrant ? `Allow ${sessionGrantProgram} this session` : "Allow exact command this session"}
          </button>
        </>
      }
    >
      <div className={styles.headerExtra}>
        <span className={`${styles.riskBadge} ${styles.mono} ${destructive ? styles.riskDestructive : styles.riskWarning}`}>
          {request.risk}
        </span>
      </div>
      <p className={`${styles.description} ${styles.mono}`}>
        The agent wants to execute a command against physical workspace files. It runs with the IDE&apos;s
        own environment and may use configured local or cloud credentials.
      </p>
      <div className={styles.commandBox}>
        <div className={`${styles.commandBoxHeader} ${styles.mono}`}>
          <Terminal size={12} />
          <span>COMMAND</span>
        </div>
        <pre className={`${styles.commandText} ${styles.mono}`}>{commandText}</pre>
      </div>
      <div className={`${styles.metaGrid} ${styles.mono}`}>
        <span className={styles.metaLabel}>Working dir</span>
        <span className={styles.metaValue}>{request.command.cwd}</span>
        <span className={styles.metaLabel}>Timeout</span>
        <span className={styles.metaValue}>{Math.round(request.command.timeoutMs / 1000)} seconds</span>
      </div>
      <p className={`${styles.hint} ${styles.mono}`}>
        {executableGrant
          ? `Session allow is memory-only and covers other normal-risk ${sessionGrantProgram} commands in this agent session. Elevated or destructive variants will ask again.`
          : "Session allow is memory-only and applies only to this exact command in this agent session. Changed arguments will ask again."}
      </p>
      {destructive && (
        <p className={`${styles.hint} ${styles.dangerHint} ${styles.mono}`}>
          This command may modify infrastructure, remote systems, or project state. Review every argument carefully.
        </p>
      )}
    </Modal>
  );
};
