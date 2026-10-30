# Token optimisations

Everything Rusty does to send a model fewer tokens without making its answers worse. Each
optimisation can be switched off in **Settings → Token optimisations**, which also shows what each
one saved.

Tokens cost twice: once in the bill, and once in the model's attention. A model that reads 40,000
characters of `npm install` progress has less room for the code it is working on. The cheapest
place to save is before text ever enters the conversation, because the conversation is sent again
on every turn: a byte left out once is left out of every later request too.

## The optimisations

### Condense command output (`command-output`)

When `run_command`, `run_check` or `install_dependencies` finishes, its output is condensed before
the model reads it:

| Commands | What goes | What stays |
|---|---|---|
| git | `status` advice lines, `log` bodies (one line per commit), diff `index` lines, lockfile diffs, push/pull progress | branch, every file, refs, every change with its line numbers |
| tests (cargo, vitest, jest, pytest, go, dotnet, also via `npm test`) | passing tests, empty test binaries, compile progress | every failure, panic, assertion and the tally |
| builds and installs (cargo, Maven, Gradle, go, bundlers, npm/pnpm/yarn, pip, bundler) | "Compiling x", downloads, deprecation lists, funding nags, progress bars (counted) | errors, the first warnings in full (the rest counted by message), what was installed |
| docker, kubectl, terraform/tofu, gh | decorative columns, layer progress, server bookkeeping, refresh lines, PR template comments, log timestamps | containers, resources, plan changes and summary, errors |
| ls, find, grep/rg, git ls-files | owner/group/date columns, repeated directory prefixes | every entry and match (grouped), up to generous caps |

Every command also gets the generic layer: colour codes and progress redraws are removed, identical
lines in a row become one line and `[xN]`, very long lines are clipped, and output longer than 300
lines keeps its first 50 and last 200 lines, because errors are at the end.

The model can ask for the exact output with `raw: true` on `run_command`.

### Keep full output recallable (`recall`)

A condensed result ends with a stamp:

```text
[rusty:condensed git-log · 18,294->4,960 chars · full output: job_output id="out-3f9c2a81d4e70b5a" (add pattern, or start_line and end_line, to read part)]
```

`job_output` with that id returns the full output, a line range, or the lines matching a pattern, so
the model never has to run a command a second time to see what was left out (which may not even be
safe: a second `git push`, a second migration). The id is a hash of the output: the same output
always has the same id. Rusty keeps the last 30 outputs until it quits.

The Settings page shows how often each filter's output was read back. A high **recall rate** means
the filter leaves out something models keep needing; that filter should keep more.

### Cache-friendly chat history (`stable-history`)

Providers bill a cached prompt prefix at about a tenth of the normal price, but only while the
prefix is byte-identical. When a long chat no longer fits, its oldest turns are left out. Choosing
the cut afresh on every turn moves it every turn, so no two requests start the same. With this on,
the cut moves in steps of a quarter of the history budget; between steps every request starts the
same way and the cache keeps matching. It may leave out a few more old turns than strictly needed.
Pinned turns and the opening request always stay.

### Keep the model on a warm cache (`warm-cache-guard`)

A cache belongs to one model. Moving a cached conversation to a cheaper model pays the whole
conversation again at full price, and no cheaper model is cheap enough to win that back, so it is
refused. Moving to a more capable model (AUTO's step-up) is allowed, because it is done for a better
answer; the log says what it costs. Choosing a model when a workflow step starts is unaffected:
nothing is cached yet.

## Safeguards (always on)

- **Never worse.** An optimisation that would not make the text smaller is not applied.
- **Fail open.** An optimisation that fails is skipped, and the original goes on unchanged. Saving
  tokens never stops a command, a prompt or a model turn.
- **Stamps.** Condensed text carries its stamp, so no later pass condenses it again (two lossy passes
  would compound their losses), and rusty-core's in-run compaction keeps the stamp when it shortens
  an old tool result, so the way back to the full output survives.

## For people changing it

`index.ts` is the only entry point; code outside this folder imports nothing else (a test enforces
it). Inside:

| Folder | Holds | Replace or extend by |
|---|---|---|
| `commandOutput/` | the condenser, the generic layer, one filter per command family | a new `filters/<family>/<tool>.ts` exporting a `CommandFilter`, added to `registry.ts` |
| `recall/` | content ids, the `RecallStore` interface, reading back | another `RecallStore` (on disk, say) passed to `createCommandOutputCondenser` |
| `history/` | stepped turn selection | `CUT_STEP_SHARE` |
| `modelSwitch/` | the warm-cache rule | `judgeModelSwitch` |
| `safeguards/` | never worse, fail open, the stamp grammar | the stamp grammar is shared with rusty-core's `harness-context`: change both |
| `catalog.ts` | names and descriptions shown in Settings | a new entry and id for a new optimisation |

Limits live in one place each: `commandOutput/generic.ts` (`LIMITS`), `commandOutput/condenser.ts`
(`OUTPUT_LIMITS`), `recall/store.ts` (`STORE_LIMITS`), `recall/read.ts` (`READ_LIMITS`).

A filter only ever removes or summarises what the tool printed. It keeps the tool's format, keeps
everything a failure needs, and is tested against real output of the tool (`__fixtures__/commands`).
