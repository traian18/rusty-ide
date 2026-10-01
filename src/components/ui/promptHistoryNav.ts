// ============================================================
// promptHistoryNav.ts -- what each key does to the "recent prompts" menu of
// the chat box. Pure, so the keyboard rules are tested without a DOM.
//
// The menu lists the prompts oldest at the top and newest at the bottom,
// next to the box, so pressing up walks back in time. It is only opened by
// the up arrow when that cannot be mistaken for moving the caret: the box is
// empty or the caret is at its very start. Opening and closing never touch
// the text, so a draft survives Escape.
// ============================================================

export interface PromptMenuState {
  open: boolean;
  /** Index into the list as shown (oldest first). */
  index: number;
}

export const CLOSED: PromptMenuState = { open: false, index: 0 };

export interface PromptKey {
  key: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}

export interface PromptKeyContext {
  /** The prompts as shown, oldest first. */
  prompts: readonly string[];
  /** The box's current text. */
  value: string;
  /** The caret is at the very start with nothing selected. */
  caretAtStart: boolean;
  /** The box is not available to the user (sending, or answering a question). */
  disabled?: boolean;
}

export interface PromptKeyResult {
  /** The key was used by the menu, so the box must not act on it. */
  handled: boolean;
  state: PromptMenuState;
  /** The prompt the person chose; the box takes it as its text. */
  pick?: string;
}

const unhandled = (state: PromptMenuState): PromptKeyResult => ({ handled: false, state });

export function stepPromptMenu(state: PromptMenuState, event: PromptKey, context: PromptKeyContext): PromptKeyResult {
  const { prompts } = context;
  const modified = Boolean(event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing);

  if (!state.open) {
    const emptyOrAtStart = context.value === "" || context.caretAtStart;
    if (event.key === "ArrowUp" && !modified && !context.disabled && prompts.length > 0 && emptyOrAtStart) {
      return { handled: true, state: { open: true, index: prompts.length - 1 } };
    }
    return unhandled(state);
  }

  // Anything that is not navigation is the person carrying on typing: leave the menu and let the key through.
  if (modified || prompts.length === 0) return unhandled(CLOSED);
  switch (event.key) {
    case "ArrowUp":
      return { handled: true, state: { open: true, index: Math.max(0, state.index - 1) } };
    case "ArrowDown":
      // Past the newest prompt is back to the box.
      return state.index >= prompts.length - 1 ? { handled: true, state: CLOSED } : { handled: true, state: { open: true, index: state.index + 1 } };
    case "Enter":
    case "Tab":
      return { handled: true, state: CLOSED, pick: prompts[Math.min(state.index, prompts.length - 1)] };
    case "Escape":
      return { handled: true, state: CLOSED };
    default:
      return unhandled(CLOSED);
  }
}
