import { Bot, Brain, type LucideIcon } from "lucide-react";
import { estimateTokens } from "../RunExecutionTimeline";
import styles from "../ToolExecutionPanel.module.css";
import { CopyableSection, MetaField, OptionalMetaField, Pill, RunContextSection } from "./DetailParts";
import { formatDateTime, formatTime } from "./format";
import type { GroupedRun, TimelineTextItem } from "./groupedRun";
import { RunTokenUsage } from "./TokenUsage";

interface TextKindView {
  icon: LucideIcon;
  label: string;
  headline: string;
  /** The size measure shown first: words for a response, estimated tokens for reasoning. */
  measure: (text: string) => { label: string; value: string };
  contentHeading: string;
  copyTitle: string;
}

/** How each kind of streamed text is shown; a new kind is one entry. */
export const TEXT_KIND_VIEWS: Record<TimelineTextItem["kind"], TextKindView> = {
  assistant_text: {
    icon: Bot,
    label: "Assistant Response",
    headline: "Model Output Message",
    measure: (text) => ({ label: "Words:", value: String(text.trim().split(/\s+/).filter(Boolean).length) }),
    contentHeading: "Response Content",
    copyTitle: "Copy assistant response text",
  },
  reasoning: {
    icon: Brain,
    label: "Reasoning",
    headline: "Model Reasoning (Internal)",
    measure: (text) => ({ label: "Est. tokens:", value: `~${estimateTokens(text)}` }),
    contentHeading: "Reasoning Content",
    copyTitle: "Copy reasoning text",
  },
};

function TextItemBanner({ item, view }: { item: TimelineTextItem; view: TextKindView }) {
  const measure = view.measure(item.text);
  return (
    <div className={styles.callBanner}>
      <div className={styles.callBannerTop}>
        <span className={styles.callBannerBadge}>
          <view.icon size={15} className="text-[var(--color-primary)]" />
          {view.label}
        </span>
        <span className="text-[var(--color-fg-muted)] font-mono text-xs">
          {formatTime(item.timestamp)}
        </span>
      </div>
      <div className={styles.callHeadline}>{view.headline}</div>
      <div className={styles.callKeyParams}>
        <Pill label={measure.label}>{measure.value}</Pill>
        <Pill label="Chars:">{item.text.length}</Pill>
        {item.messageId && <Pill label="Message ID:">{item.messageId}</Pill>}
        {item.agentId && <Pill label="Agent:">{item.agentId}</Pill>}
      </div>
    </div>
  );
}

/** An assistant response or a reasoning block, with the run it belongs to. */
export function TextItemDetail({ item, run }: { item: TimelineTextItem; run: GroupedRun }) {
  const view = TEXT_KIND_VIEWS[item.kind];
  return (
    <div className={styles.detail}>
      <TextItemBanner item={item} view={view} />

      <CopyableSection heading={view.contentHeading} copy={{ title: view.copyTitle, label: "Copy text", text: () => item.text }}>
        <div className={styles.promptCard}>{item.text}</div>
      </CopyableSection>

      {run.requestPrompt && (
        <RunContextSection prompt={run.requestPrompt} notice="All responses and tool calls in this run stem from the user prompt below." />
      )}

      <RunTokenUsage usage={run.usage} tokens={run.runTokens} />

      <section className={styles.detailSection}>
        <h4>Execution Metadata</h4>
        <dl className={styles.metadata}>
          <MetaField label="Source">{run.originLabel}</MetaField>
          <MetaField label="Surface">{run.surface}</MetaField>
          <OptionalMetaField label="Model" value={run.model} />
          <MetaField label="Timestamp">{formatDateTime(item.timestamp)}</MetaField>
        </dl>
      </section>
    </div>
  );
}
