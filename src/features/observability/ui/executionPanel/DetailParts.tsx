import type { ReactNode } from "react";
import { Copy, Info } from "lucide-react";
import styles from "../ToolExecutionPanel.module.css";
import { formatJsonValue } from "./format";

export function JsonValue({ value }: { value: unknown }) {
  return <pre className={styles.code}>{formatJsonValue(value) ?? "—"}</pre>;
}

/** Copies `text()` (read on click, so large payloads are only serialized when copied). */
export function CopyButton({ title, label, text }: { title: string; label: string; text: () => string }) {
  return (
    <button type="button" className={styles.copySmallButton} onClick={() => navigator.clipboard?.writeText(text())} title={title}>
      <Copy size={11} /> {label}
    </button>
  );
}

export function CopyableSection({ heading, copy, children }: { heading: ReactNode; copy: { title: string; label: string; text: () => string }; children: ReactNode }) {
  return (
    <section className={styles.detailSection}>
      <div className={styles.sectionHeaderWithAction}>
        <h4>{heading}</h4>
        <CopyButton {...copy} />
      </div>
      {children}
    </section>
  );
}

export function Pill({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <span className={styles.callParamPill} title={title}>
      <strong>{label}</strong>
      <span>{children}</span>
    </span>
  );
}

export function MetaField({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd title={title}>{children}</dd></div>;
}

/** A metadata row shown only when the value is set. */
export function OptionalMetaField({ label, value, format = (text) => text }: { label: string; value?: string; format?: (value: string) => string }) {
  return value ? <MetaField label={label}>{format(value)}</MetaField> : null;
}

/** The user request that started the run, which every item in it shares. */
export function RunContextSection({ prompt, notice, children }: { prompt?: string; notice: string; children?: ReactNode }) {
  return (
    <section className={styles.detailSection}>
      <div className={styles.sectionHeaderWithAction}>
        <div>
          <h4>Run Context (Initiating Prompt)</h4>
          <small className="text-[var(--color-fg-muted)] text-[10px]">User request initiating this run</small>
        </div>
        {prompt && <CopyButton title="Copy request prompt" label="Copy prompt" text={() => prompt} />}
      </div>
      <div className={styles.contextNotice}>
        <Info size={13} className="text-[var(--color-primary)] shrink-0" />
        <span>{notice}</span>
      </div>
      {prompt && <div className={styles.promptCard}>{prompt}</div>}
      {children}
    </section>
  );
}
