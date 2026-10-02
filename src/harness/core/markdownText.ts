/**
 * Structured data as readable Markdown, never JSON: one section per field,
 * text as written, lists as bullets, `{id, text}` pairs as `- ID: text`, and
 * other records as `### ID` blocks. Mirrors `render_input` in rusty-core, so
 * what a person reads in a result is what the next step was given.
 */

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);
const isScalar = (value: unknown) => !isRecord(value) && !Array.isArray(value);
const idOf = (record: Rec) => record.id ?? record.task_id;

function inline(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(inline).join(", ");
  return typeof value === "string" ? value : String(value);
}

const heading = (level: number, title: string) => `${"#".repeat(Math.min(level, 6))} ${title}`;

function isPair(record: Rec): boolean {
  const keys = Object.keys(record);
  return keys.length === 2 && "id" in record && keys.every((key) => isScalar(record[key]))
    && typeof record[keys.find((key) => key !== "id") as string] === "string";
}

function body(value: unknown, level: number): string {
  if (Array.isArray(value)) {
    if (value.every(isScalar)) return value.map((item) => `- ${inline(item)}`).join("\n");
    if (value.every((item) => isRecord(item) && isPair(item))) {
      return (value as Rec[]).map((item) => {
        const text = String(item[Object.keys(item).find((key) => key !== "id") as string]);
        return `- ${inline(item.id)}: ${text}`;
      }).join("\n");
    }
    return value.map((item, index) => {
      if (!isRecord(item)) return `- ${inline(item)}`;
      return `${heading(level + 1, inline(idOf(item)) || String(index + 1))}\n${record(item, level + 1)}`;
    }).join("\n\n");
  }
  if (isRecord(value)) return fields(value, level + 1);
  return inline(value);
}

/** Short fields as `key: value` lines, then text and nested data under headings. */
function record(item: Rec, level: number): string {
  const short = (value: unknown) => typeof value === "string"
    ? !value.includes("\n") && value.length <= 80
    : value !== null && value !== undefined && (!Array.isArray(value) || value.every(isScalar));
  const entries = Object.entries(item).filter(([key, value]) => key !== "id" && key !== "task_id" && value !== null && value !== undefined);
  const lines = entries.filter(([, value]) => short(value)).map(([key, value]) => `${key}: ${inline(value)}`);
  const sections = entries.filter(([, value]) => !short(value))
    .map(([key, value]) => `${heading(level + 1, key)}\n${body(value, level + 1)}`);
  return [...lines, ...(sections.length ? ["", ...sections] : [])].join("\n");
}

function fields(value: Rec, level: number): string {
  return Object.entries(value)
    .filter(([, field]) => field !== null && field !== undefined)
    .map(([key, field]) => `${heading(level, key)}\n${body(field, level)}`)
    .join("\n\n");
}

export function markdownText(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value)) return fields(value, 2);
  return inline(value);
}
