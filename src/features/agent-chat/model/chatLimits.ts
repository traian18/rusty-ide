/** How much of one chat response the Agent tab renders at once. Longer
 * responses are kept in full but shown as a preview (or, while streaming,
 * as their latest part), and the agent is told to write anything longer
 * than this to a file instead, so the chat never has to hide an answer. */
export const CHAT_RENDER_CHARS = 64_000;
