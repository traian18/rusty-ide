const DEFAULT_MAX_BUFFER_CHARS = 250_000;
const OMITTED_PREFIX = "[Earlier output omitted to protect application memory]\n";

export function appendBoundedText(
  current: string,
  chunk: unknown,
  maxChars = DEFAULT_MAX_BUFFER_CHARS,
): string {
  const text = String(chunk ?? "");
  if (!text) return current;
  if (text.length >= maxChars) return OMITTED_PREFIX + text.slice(-(maxChars - OMITTED_PREFIX.length));
  if (current.length + text.length <= maxChars) return current + text;
  const retainedChars = maxChars - text.length - OMITTED_PREFIX.length;
  return OMITTED_PREFIX + current.slice(-Math.max(0, retainedChars)) + text;
}
