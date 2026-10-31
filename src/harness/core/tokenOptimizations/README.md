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

### Don't resend what the agent already has (`repeat-results`)

Measured on a real Implement run, command output was under 3% of what tools returned; `read_file`
was 40% and `spec_context` 22%, much of it the same content sent again (one file was read 13 times;
the spec and design were fetched four times). When a tool would give an agent session exactly what
it already received (the same file with the same arguments, the same spec document) it gets a
one-line pointer instead:

```text
[unchanged since this session last received it: it is still in your context above, or read it again with job_output id="out-…"]
```

Only identical content counts: a file edited since, or other lines of it, come back in full. For
`spec_context` only the documents are replaced; the change's status and open tasks are always
current. A workflow step or sub-agent has its own conversation and receives everything once.

A file read again **after it changed** (usually by the agent's own edit) comes back as only the
changed lines, numbered as the file is now, with the whole file one job_output call away. And
`edit_file` / `write_file` return the lines they changed, so there is nothing to read back.

### Carry the working set across turns (`working-set`)

Each chat message starts a fresh agent session that sees the earlier messages' text but none of
their tool results, so it explores again. The next turn's prompt gets a short section after the
earlier turns:

```text
## Working set from earlier turns
- rusty-core/crates/harness-context/src/policy.rs: edited; read lines 120-160
- rusty-ide/src/features/agent-chat/runEvents.ts: read for: how observations are routed
Searches already run: "context pressure" (search_codebase)
```

It says where things are, not what they say (at most 30 files, 2,500 characters), so the agent reads
exactly what it needs. It is kept per chat, across restarts.

### Limit very large tool reports (`tool-output-limits`)

`repo_context`, `project_info`, `code_guidelines`, `search_codebase`, `list_files` and the `repo_`
tools can return tens of thousands of characters. Above 12,000 characters a result keeps its first
9,000 and last 2,000, with a stamp naming the full text's job_output id. Files and spec documents
are never cut.

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

### Measuring the prompt cache (no switch: it changes nothing)

Every request of an agent resends the previous prompt plus a little more, so a follow-up request
should read about the whole previous prompt from the cache. `promptCache/watch.ts` judges each
finished request: a follow-up that read less than half the previous prompt **missed**, for one of
three causes, checked in this order:

| Cause | Meaning |
|---|---|
| Prompt or tools changed | rusty-core's `PromptPrefixChanged`: the system prompt or tool list differed from the run's previous request |
| Cache expired | more than five minutes since the previous request (the default cache lifetime) |
| History rewritten | anything else: compaction, trimming or replaced reads changed earlier turns, or the provider dropped the cache |

Prompts under 1,024 tokens are not judged (nothing is cached), nor are requests from providers that
report no cache reads. Anthropic counts input without cached tokens and reports cache writes; OpenAI
and Gemini include cached tokens in input; the prompt size uses whichever applies. The Settings page
shows the hit rate and the misses by cause.

## In workflows and sub-agents (no switch)

Part of how the task queue and `agent_spawn` hand work over, in rusty-core, so each new session
starts with what the one before it learned:

- **The step plan carries the material.** A task's planner ends its plan with a `## Material`
  section quoting the design passages and code the task needs (`path:start-end`, under about 6,000
  characters). The builder and reviewer use it instead of reading those again.
- **Locations carry forward.** Builders and reviewers report `locations` (one `path:lines` each);
  later tasks' planners and builders get them as `known_locations`.
- **The active-spec brief** tells a workflow step that its spec and design are already in its input,
  instead of asking every session to fetch them with `spec_context`.
- **Sub-agents** are asked to end their reply with `Locations:`, and the parent is told to put what
  it already knows into the child's task.

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
| `toolOutput/` | repeat pointers and size limits for the agent's own tools | `REPEAT_TOOLS`, `LIMITED_TOOLS`; a tool with its own layout gets a sectioner in `sections.ts` |
| `fileState/` | changed regions: what an edit left, what changed since a read | `REGION_LIMITS` |
| `workingSet/` | what a chat already explored, for its next turns | `WORKING_SET_LIMITS`; a new tool's arguments in `SEARCH_TOOLS` |
| `history/` | stepped turn selection | `CUT_STEP_SHARE` |
| `modelSwitch/` | the warm-cache rule | `judgeModelSwitch` |
| `safeguards/` | never worse, fail open, the stamp grammar | the stamp grammar is shared with rusty-core's `harness-context`: change both |
| `catalog.ts` | names and descriptions shown in Settings | a new entry and id for a new optimisation |

Limits live in one place each: `commandOutput/generic.ts` (`LIMITS`), `commandOutput/condenser.ts`
(`OUTPUT_LIMITS`), `recall/store.ts` (`STORE_LIMITS`), `recall/read.ts` (`READ_LIMITS`).

A filter only ever removes or summarises what the tool printed. It keeps the tool's format, keeps
everything a failure needs, and is tested against real output of the tool (`__fixtures__/commands`).
