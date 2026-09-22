import { Zap } from "lucide-react";
import { formatCompactTokenCount } from "../../../services/tokenFormat";
import styles from "./TokenBadge.module.css";

export interface TokenUsageLike {
  input?: number;
  output?: number;
  totalTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface TokenBadgeProps {
  /** Either a raw token count or a usage breakdown (total is derived from input+output when not provided). */
  usage: number | TokenUsageLike;
  /** Highlights the badge to indicate the run is still streaming. */
  live?: boolean;
  className?: string;
}

function totalFromUsage(usage: number | TokenUsageLike): number {
  if (typeof usage === "number") return usage;
  return usage.totalTokens ?? ((usage.input ?? 0) + (usage.output ?? 0));
}

function titleFromUsage(usage: number | TokenUsageLike): string | undefined {
  if (typeof usage === "number") return undefined;
  const parts: string[] = [];
  if (usage.input !== undefined) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output !== undefined) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache read`);
  if (usage.cacheWrite) parts.push(`${usage.cacheWrite.toLocaleString()} cache write`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function TokenBadge({ usage, live = false, className = "" }: TokenBadgeProps) {
  const total = totalFromUsage(usage);
  if (total <= 0) return null;
  return (
    <span
      className={`${styles.badge} ${live ? styles.live : ""} ${className}`}
      title={titleFromUsage(usage)}
    >
      <Zap size={10} />
      {formatCompactTokenCount(total)} tok
    </span>
  );
}
