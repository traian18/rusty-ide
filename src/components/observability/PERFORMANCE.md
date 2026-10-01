# Tool Execution Observability performance fixture

`createObservabilityPerformanceFixture` in `performanceFixture.ts` creates deterministic data for profiling:

- 100 runs by default
- 500 tool records with large arguments and result previews
- A 300-item active timeline
- 100 alternating text/reasoning stream entries spaced 80 ms apart

## Profiling procedure

1. Feed the fixture snapshots into the observability stores in a development harness.
2. Open React DevTools Profiler and record panel opening, 20 stream appends, a search query, and scrolling.
3. Record the same interaction in browser Performance tools with DOM counters enabled.
4. Capture panel-open latency, longest task, median/p95 commit duration, mounted run-card/timeline-node counts, DOM nodes, and search-input latency.
5. Repeat the exact sequence after changes.

## Baseline status

A browser/React Profiler is not available in the current coding environment, so numeric before/after measurements were not collected here. The fixture is deterministic and intended to make that follow-up repeatable; do not claim the performance acceptance target from automated tests alone.
