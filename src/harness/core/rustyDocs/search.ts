// ============================================================
// rustyDocs/search.ts -- ranks the bundled documentation sections for a question.
//
// BM25 over sections, not pages, so an answer costs a heading's worth of text.
// A question is a sentence rather than keywords, so every word need not match
// and the words that carry no meaning are dropped. Docs and users often name a
// thing differently ("auto" / "Automatic", "compacted" / "compaction"), so word
// endings are stemmed and a query word also matches longer words it starts.
// ============================================================

export interface DocSection {
  /** Empty for the text before a page's first heading. */
  heading: string;
  anchor: string;
  text: string;
}

export interface DocPage {
  id: string;
  title: string;
  summary: string;
  sections: DocSection[];
}

export interface DocHit {
  page: DocPage;
  section: DocSection;
  score: number;
}

export type DocsSearch = (query: string, limit: number) => DocHit[];

const K1 = 1.2;
const B = 0.75;
/** What a word found only as the start of a longer word is worth. */
const PREFIX_WEIGHT = 0.6;
const MIN_PREFIX_LENGTH = 4;
const MIN_STEM_LENGTH = 4;
const STOP_WORDS = new Set("a an and are be been being can did do does for from has have how i in is it me my of on or our so that the this to was we what when where which who why will with you your".split(" "));
const SUFFIXES = ["ation", "ing", "ed", "es", "s"];

function stem(word: string): string {
  const suffix = SUFFIXES.find((ending) => word.endsWith(ending) && word.length - ending.length >= MIN_STEM_LENGTH);
  return suffix ? word.slice(0, -suffix.length) : word;
}

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => !STOP_WORDS.has(word)).map(stem);
}

/** Titles and headings say what a section is about better than its body, so they count more. */
function weightedText(page: DocPage, section: DocSection): string {
  const heading = section.heading ? `${page.title} ${page.title} ${section.heading} ${section.heading}` : `${page.title} ${page.title} ${page.title} ${page.summary}`;
  return `${heading} ${section.text}`;
}

export function buildDocsSearch(pages: DocPage[]): DocsSearch {
  const entries = pages.flatMap((page) =>
    page.sections.map((section) => {
      const words = terms(weightedText(page, section));
      const counts = new Map<string, number>();
      for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
      return { page, section, counts, length: words.length };
    }),
  );
  const averageLength = entries.reduce((sum, entry) => sum + entry.length, 0) / Math.max(entries.length, 1);
  const documentFrequency = new Map<string, number>();
  for (const { counts } of entries) {
    for (const word of counts.keys()) documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
  }
  const vocabulary = [...documentFrequency.keys()];

  const wordScore = (word: string, entry: (typeof entries)[number]): number => {
    const count = entry.counts.get(word) ?? 0;
    if (!count) return 0;
    const frequency = documentFrequency.get(word) ?? 0;
    const rarity = Math.log(1 + (entries.length - frequency + 0.5) / (frequency + 0.5));
    return (rarity * count * (K1 + 1)) / (count + K1 * (1 - B + (B * entry.length) / averageLength));
  };

  return (query, limit) => {
    const asked = [...new Set(terms(query))].map((term) => ({
      term,
      longer: term.length >= MIN_PREFIX_LENGTH ? vocabulary.filter((word) => word !== term && word.startsWith(term)) : [],
    }));
    if (!asked.length) return [];
    return entries
      .map((entry) => ({
        page: entry.page,
        section: entry.section,
        score: asked.reduce((sum, { term, longer }) => sum + Math.max(wordScore(term, entry), PREFIX_WEIGHT * Math.max(0, ...longer.map((word) => wordScore(word, entry)))), 0),
      }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  };
}
