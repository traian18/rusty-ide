import { useEffect, useState } from "react";
import type { Message } from "../chatTypes";

interface Reveal {
  source: string;
  end: number;
}

/** One tick of the reveal: about 50 words a second at one word per tick. */
export const WORD_REVEAL_TICK_MS = 20;
/** Each tick reveals at least this share (1/n) of the words waiting, so a large backlog drains
 * in under a second instead of trailing the text that arrived. */
const CATCH_UP_SHARE = 12;

/** How many words to reveal this tick: one while streaming keeps pace, more while a backlog waits. */
function wordsThisTick(remaining: string): number {
  const backlog = remaining.match(/\S+/g)?.length ?? 0;
  return Math.max(1, Math.ceil(backlog / CATCH_UP_SHARE));
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
          const live = id === current?.id;
          let end = reveal.end;
          for (let count = wordsThisTick(reveal.source.slice(end)); count > 0; count -= 1) {
            const word = /^\s*\S+/.exec(reveal.source.slice(end));
            if (!word) break;
            // Wait for a word boundary while the model may still extend this word.
            if (live && end + word[0].length === reveal.source.length) break;
            end += word[0].length;
          }
          const done = !/\S/.test(reveal.source.slice(end));
          if (done && !live) delete next[id];
          else if (end !== reveal.end) next[id] = { ...reveal, end };
        }
        return next;
      });
    }, WORD_REVEAL_TICK_MS);
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
