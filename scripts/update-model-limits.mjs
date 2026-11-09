// Refreshes the model-limits snapshot bundled with the app
// (src/features/providers/modelLimits/litellmSnapshot.json) from LiteLLM's
// model_prices_and_context_window.json, kept to the entries
// litellmSource.json names: chat models of the providers Rusty connects to.
// The app refreshes its own copy at runtime (src-tauri harness/model_limits.rs,
// same rules); this keeps a fresh install useful offline. Release builds run it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../src/features/providers/modelLimits');
const source = JSON.parse(fs.readFileSync(path.join(dir, 'litellmSource.json'), 'utf8'));
const kept = new Set(Object.values(source.providers).flat());

export function trim(raw) {
  const entries = {};
  for (const key of Object.keys(raw).sort()) {
    const entry = raw[key];
    if (!entry || typeof entry !== 'object' || !source.modes.includes(entry.mode)) continue;
    if (!kept.has(entry.litellm_provider)) continue;
    const input = entry.max_input_tokens || entry.max_tokens;
    if (!Number.isInteger(input) || input <= 0) continue;
    const output = Number.isInteger(entry.max_output_tokens) && entry.max_output_tokens > 0 ? entry.max_output_tokens : null;
    entries[key] = [input, output, entry.litellm_provider];
  }
  return entries;
}

const response = await fetch(source.url, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`LiteLLM model list: HTTP ${response.status}`);
const entries = trim(await response.json());
if (Object.keys(entries).length < 50) throw new Error(`LiteLLM model list: only ${Object.keys(entries).length} usable entries; keeping the old snapshot`);
const snapshot = { fetchedAt: new Date().toISOString(), entries };
fs.writeFileSync(path.join(dir, 'litellmSnapshot.json'), `${JSON.stringify(snapshot, null, 0)}\n`);
console.log(`litellmSnapshot.json: ${Object.keys(entries).length} models`);
