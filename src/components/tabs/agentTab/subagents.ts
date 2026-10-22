import type { SubagentActivity } from "../../ui/Chat";

/** A subagent event as a run reports it: the activity, plus how to merge it. */
export type IncomingSubagent = SubagentActivity & { previousId?: string; appendLog?: string; logs?: string[] };

export function isActiveSubagent(subagent: SubagentActivity): boolean {
  return subagent.status === "queued" || subagent.status === "running" || subagent.status === "background";
}

/** The event's subagent, or undefined when it names none. */
export function readIncomingSubagent(subagent: unknown): IncomingSubagent | undefined {
  const value = subagent as IncomingSubagent | undefined;
  if (!value?.id) return undefined;
  return { ...value, updatedAt: value.updatedAt || new Date().toISOString() };
}

/** Adds `incoming` to the list, or merges it into the card it updates (by id,
 * or by the id it had before), keeping the last 200 distinct log lines. */
export function mergeSubagent(list: SubagentActivity[], incoming: IncomingSubagent): SubagentActivity[] {
  const index = list.findIndex((item) =>
    item.id === incoming.id || (!!incoming.previousId && item.id === incoming.previousId)
  );
  const incomingLogs = [
    ...(Array.isArray(incoming.logs) ? incoming.logs : []),
    ...(incoming.appendLog ? [incoming.appendLog] : []),
  ];
  const { appendLog: _appendLog, previousId: _previousId, ...clean } = incoming;
  if (index === -1) return [...list, { ...clean, logs: incomingLogs }];
  const mergedLogs = [...(list[index].logs || [])];
  for (const log of incomingLogs) {
    if (log && mergedLogs[mergedLogs.length - 1] !== log) mergedLogs.push(log);
  }
  const next = [...list];
  next[index] = { ...next[index], ...clean, id: incoming.id, logs: mergedLogs.slice(-200) };
  return next;
}

/** Every subagent still working, marked stopped by the user. */
export function stopActiveSubagents(list: SubagentActivity[]): SubagentActivity[] {
  return list.map((subagent) => isActiveSubagent(subagent)
    ? {
        ...subagent,
        status: "stopped",
        activity: "Stopped by user.",
        logs: [...(subagent.logs || []), "Stopped by user."].slice(-200),
        updatedAt: new Date().toISOString(),
      }
    : subagent);
}

/** A finished run's subagents: the response can carry each one's full result,
 * so the panel keeps only their status and last few activity lines. */
export function completedSubagents(list: unknown[]): SubagentActivity[] {
  return (list as SubagentActivity[]).map((subagent) => ({ ...subagent, logs: (subagent.logs || []).slice(-4) }));
}
