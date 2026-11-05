// The documentation the `rusty_docs` tool answers from, split into sections so
// the agent reads one heading's worth instead of a page. The website's Markdown
// is the source. The result is committed because release CI checks out only
// rusty-ide and rusty-core, and it ships with the app so the agent describes the
// version the user actually has. Run `npm run docs:index` before a release.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const docsDir = process.env.RUSTY_DOCS_DIR ?? path.resolve(here, '../../rusty-website/src/pages/docs');
const output = path.resolve(here, '../src/harness/core/rustyDocs/docsIndex.json');
const SITE = 'https://rusty-edit.dev';

export function frontmatter(raw) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!match) throw new Error('page has no frontmatter');
  const field = (name) => new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(match[1])?.[1].trim().replace(/^(["'])(.*)\1$/, '$2') ?? '';
  return { title: field('title'), summary: field('description'), body: raw.slice(match[0].length) };
}

/** Inline Markdown removed, as the heading reads on the page. */
function plainHeading(text) {
  return text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '').trim();
}

/** github-slugger's ids, repeats included, so a link lands on the rendered heading. */
function slugger() {
  const seen = new Map();
  return (text) => {
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
}

/** Links must work outside the site, and a screenshot says nothing to the agent. */
function portableMarkdown(text) {
  return text
    .replace(/<figure[\s\S]*?<\/figure>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\]\(\//g, `](${SITE}/`)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The text before the first `##`, then one section per `##`. A `#` inside a code fence is not a heading. */
export function sections(body) {
  const slug = slugger();
  const found = [{ heading: '', anchor: '', lines: [] }];
  let fenced = false;
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^##\s+(.+)$/.exec(line);
    if (heading) {
      const text = plainHeading(heading[1]);
      found.push({ heading: text, anchor: slug(text), lines: [] });
    } else {
      found.at(-1).lines.push(line);
    }
  }
  return found
    .map(({ heading, anchor, lines }) => ({ heading, anchor, text: portableMarkdown(lines.join('\n')) }))
    .filter((section) => section.heading || section.text);
}

export function docsIndex(dir) {
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.md') && !file.startsWith('_'))
    .sort()
    .map((file) => {
      const { title, summary, body } = frontmatter(fs.readFileSync(path.join(dir, file), 'utf8'));
      return { id: file.slice(0, -'.md'.length), title, summary, sections: sections(body) };
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pages = docsIndex(docsDir);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(pages, null, 1)}\n`);
  console.log(`${path.relative(process.cwd(), output)}: ${pages.length} pages, ${pages.reduce((sum, page) => sum + page.sections.length, 0)} sections`);
}
