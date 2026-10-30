import styles from "./ChatQueryRail.module.css";

export interface ChatQueryRailProps {
  queries: Array<{ id: string; label: string; index: number }>;
  activeQueryId?: string;
  onSelect: (messageId: string) => void;
  disabled?: boolean;
}

export function ChatQueryRail({ queries, activeQueryId, onSelect, disabled = false }: ChatQueryRailProps) {
  return (
    <nav className={styles.rail} aria-label="Conversation queries">
      {queries.map((query) => {
        const label = query.label || `Query ${query.index}`;
        return (
          <button
            key={`${query.id}-${query.index}`}
            type="button"
            id={`chat-query-${query.id}`}
            data-testid="chat-query-point"
            aria-label={`${label} (query ${query.index})`}
            aria-current={activeQueryId === query.id ? "true" : undefined}
            title={label}
            className={`${styles.point} ${activeQueryId === query.id ? styles.active : ""}`}
            disabled={disabled}
            onClick={() => onSelect(query.id)}
          >
            <span aria-hidden="true">{query.index}</span>
          </button>
        );
      })}
    </nav>
  );
}
