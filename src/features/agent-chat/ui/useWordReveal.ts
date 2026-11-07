import { useEffect, useState } from "react";
import type { Message } from "../chatTypes";

interface Reveal {
  source: string;
  end: number;
}

function sameReveals(a: Record<string, Reveal>, b: Record<string, Reveal>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((id) => a[id].source === b[id]?.source && a[id].end === b[id]?.end);
}

/** Display state only: the original messages remain available for saving and copying. */
export function useWordReveal(messages: Message[], isStreaming: boolean, enabled: boolean, chatKey?: string) {
  const [reveals, setReveals] = useState<Record<string, Reveal>>({});
  const last = messages[messages.length - 1];
  const current = enabled && isStreaming && last?.role === "assistant" ? last : undefined;

  useEffect(() => { setReveals({}); }, [chatKey]);

  useEffect(() => {
    setReveals((previous) => {
      const next: Record<string, Reveal> = {};
      for (const message of messages) {
        const old = previous[message.id];
        if (!old && message.id !== current?.id) continue;
        const end = old && message.content.startsWith(old.source) ? old.end : 0;
        if (message.id === current?.id || end < message.content.length) {
          next[message.id] = { source: message.content, end };
        }
      }
      return sameReveals(next, previous) ? previous : next;
    });
  }, [messages, current?.id, enabled]);

  const hasPending = Object.entries(reveals).some(([id, reveal]) => {
    const remaining = reveal.source.slice(reveal.end);
    const word = /^\s*\S+/.exec(remaining);
    return id === current?.id ? Boolean(word && word[0].length < remaining.length) : remaining.length > 0;
  });

  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => {
      setReveals((previous) => {
        const next = { ...previous };
        for (const [id, reveal] of Object.entries(previous)) {
          const remaining = reveal.source.slice(reveal.end);
          const word = /^\s*\S+/.exec(remaining);
          if (!word) {
            if (id !== current?.id) delete next[id];
            continue;
          }
          const end = reveal.end + word[0].length;
          // Wait for a word boundary while the model may still extend this word.
          if (end === reveal.source.length && id === current?.id) continue;
          if (end === reveal.source.length && id !== current?.id) delete next[id];
          else next[id] = { ...reveal, end };
        }
        return next;
      });
    }, 65);
    return () => clearInterval(timer);
  }, [hasPending, current?.id]);

  const displayed = (message: Message) => {
    const reveal = reveals[message.id];
    if (reveal) return message.content.startsWith(reveal.source) ? message.content.slice(0, reveal.end) : "";
    if (message.id === current?.id && !reveal) return "";
    return message.content;
  };
  const revealing = (message: Message) => message.id === current?.id || Boolean(reveals[message.id]);
  return { displayed, revealing };
}
