/** How far apart the words of one streamed batch start fading in. */
const WORD_STAGGER_MS = 24;
export const MAX_STAGGER_MS = 320;

export interface FadeWordsOptions {
  /** Where each batch still fading in starts, as offsets into the rendered Markdown, ascending. */
  arrivals: number[];
  className: string;
}

/** Wraps every word in a span so newly arrived ones can fade in. Words that
 * arrived earlier are wrapped too: the element structure then only grows at
 * the end, so React keeps the spans already on screen instead of reusing them
 * for other words (which would skip their fade). */
export const rehypeFadeWords = (options: FadeWordsOptions) => (tree: any) => {
  const counts = new Map<number, number>();
  const batchOf = (offset: number) => {
    for (let index = options.arrivals.length - 1; index >= 0; index -= 1) {
      if (options.arrivals[index] <= offset) return index;
    }
    return -1;
  };
  const visit = (node: any): any[] | undefined => {
    if (node.type === "text" && node.position && typeof node.value === "string") {
      const start: number = node.position.start.offset ?? 0;
      const out: any[] = [];
      let local = 0;
      for (const part of node.value.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          out.push({ type: "text", value: part });
        } else {
          const batch = batchOf(start + local);
          const properties: Record<string, unknown> = { className: [options.className] };
          if (batch >= 0) {
            const order = counts.get(batch) ?? 0;
            counts.set(batch, order + 1);
            properties.style = `animation-delay: ${Math.min(order * WORD_STAGGER_MS, MAX_STAGGER_MS)}ms`;
          }
          out.push({ type: "element", tagName: "span", properties, children: [{ type: "text", value: part }] });
        }
        local += part.length;
      }
      return out;
    }
    if (node.children) {
      const replacement: any[] = [];
      for (const child of node.children) {
        const result = visit(child);
        if (result) replacement.push(...result);
        else replacement.push(child);
      }
      node.children = replacement;
    }
    return undefined;
  };
  visit(tree);
};
