export interface ParsedDecoration {
  name: string;
  type: "head" | "remote" | "tag" | "branch";
}

export const parseDecorations = (decorationsStr: string): ParsedDecoration[] => {
  if (!decorationsStr) return [];
  // Strip parentheses and trim whitespace
  const clean = decorationsStr.replace(/[()]/g, "").trim();
  if (!clean) return [];

  return clean.split(",").map((part) => {
    const text = part.trim();
    let type: "head" | "remote" | "tag" | "branch" = "branch";
    let name = text;

    if (text.startsWith("HEAD ->")) {
      type = "head";
      name = text.replace("HEAD ->", "").trim();
    } else if (text.startsWith("tag:")) {
      type = "tag";
      name = text.replace("tag:", "").trim();
    } else if (text.includes("/")) {
      type = "remote";
    }

    return { name, type };
  });
};
