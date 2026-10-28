# TypeScript best practices for a desktop app like `rusty-ide`

The same broad idea applies in TypeScript as in Rust: make data, ownership, failure, and boundaries clear. But TypeScript adds an important caveat: **its types are mostly checked at compile time; they do not validate data at runtime**. That matters especially in a desktop app, where the frontend talks to a native backend, reads persisted data, and handles user-controlled input.

This guide is tailored to `rusty-ide`, which uses TypeScript, React, Vite, and Tauri. Its [`tsconfig.json`](rusty-ide/tsconfig.json) already enables `strict`, `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch`. Keep those protections enabled and treat them as a baseline, not a reason to add type assertions everywhere.

## 1. Make types describe real states

Prefer explicit types that represent the actual possibilities in your application.

For values that may be absent, use `T | undefined` or `T | null` as appropriate. For operations that can succeed or fail, return a result shape or throw and catch at a deliberately chosen boundary. Do not use an empty string, `0`, or another special value to mean “missing” unless that is genuinely the domain’s meaning.

Use a **discriminated union** when one value can be one of several kinds:

```ts
type LoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; value: T }
  | { status: "failed"; message: string };
```

Then switch on `status` to handle each case. This makes incomplete states harder to accidentally create than a collection of independent flags such as `isLoading`, `hasError`, and `data`.

For event-like data, use a stable tag and keep variant-specific fields on the corresponding variant:

```ts
type AppEvent =
  | { kind: "file_saved"; path: string }
  | { kind: "command_failed"; message: string };
```

Handle variants exhaustively where it matters:

```ts
function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

function describeEvent(event: AppEvent): string {
  switch (event.kind) {
    case "file_saved":
      return `Saved ${event.path}`;
    case "command_failed":
      return event.message;
    default:
      return assertNever(event);
  }
}
```

If a new event kind is added, the compiler can help find code that has not been updated.

**Instructions:**

1. Identify mutually exclusive states or event kinds.
2. Represent them with a union keyed by a field such as `kind` or `status`.
3. Narrow on that field before reading fields that belong to a specific variant.
4. Avoid adding unrelated optional fields to one broad interface when those fields are only valid in certain cases.
5. Use `never` checks in central switches where silently ignoring a new case would be risky.

The TypeScript handbook covers [everyday types](https://www.typescriptlang.org/docs/handbook/2/everyday-types) and [narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing).

## 2. Treat external data as untrusted—even if you have a TypeScript interface

A TypeScript annotation does not inspect or validate a runtime value. This is not validation:

```ts
const settings = JSON.parse(raw) as Settings;
```

The assertion only tells the compiler to trust the programmer. It does not prove the JSON has the shape of `Settings`.

For values from Tauri commands/events, JSON files, local storage, network responses, or user input:

1. Accept the initial value as `unknown`.
2. Validate the shape at the boundary.
3. Return a typed value only after checking the required fields and allowed variants.
4. Handle invalid data through the project’s established error path.

A small manual guard can be suitable for a simple shape:

```ts
type Settings = {
  theme: "light" | "dark" | "system";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSettings(value: unknown): Settings | undefined {
  if (!isRecord(value)) return undefined;

  const theme = value.theme;
  if (theme !== "light" && theme !== "dark" && theme !== "system") {
    return undefined;
  }

  return { theme };
}
```

For larger or frequently reused contracts, a runtime schema-validation library may be worth considering—but only if it fits the project’s dependency policy and established patterns. Don’t introduce one just to validate a single trivial object.

**For the Tauri boundary:** centralize validation near the command/event adapter rather than scattering checks throughout React components. Do not repair invalid identity data by substituting the currently active chat, tab, or run: that can route an event to the wrong place.

## 3. Use `unknown` instead of `any` at uncertain boundaries

`any` disables type checking for the value and often spreads into surrounding code. Prefer `unknown` when the value’s shape is not yet established, then narrow it.

Avoid using `as SomeType` to silence a compiler error unless there is a specific, documented reason and the runtime invariant is already guaranteed. If an assertion is needed because of an external library’s type definitions, keep it close to that boundary and narrow its scope.

Good TypeScript code does not mean “no assertions ever.” It means assertions are uncommon and supported by a reason the code can rely on.

## 4. Design functions and APIs around clear inputs and outputs

A function’s signature should tell a reader what it needs and what it can produce.

- Pass only the values the function actually uses.
- Make optional inputs explicitly optional.
- Prefer a return type that describes failure or absence over a magic value.
- Keep side effects—filesystem access, Tauri calls, event publication, timers—visible.
- Avoid functions that both fetch data, transform it, update unrelated global state, and display a notification.

Separate deterministic decisions from effects where practical:

```ts
function selectCurrentItem(items: Item[], selectedId: string): Item | undefined {
  return items.find((item) => item.id === selectedId);
}
```

Then let a component, service, or store decide how to handle the result or update state. Pure functions like this are easy to test and reuse. Not every helper needs to be pure, and not every two-line function needs its own module; the goal is to make important decisions testable without setting up the whole desktop application.

For asynchronous code, make failure and cancellation behavior explicit. Do not silently turn every failure into an empty list or success-shaped default, because that makes “failed to load” indistinguishable from “there is no data.”

## 5. Keep React state minimal and avoid duplicated sources of truth

React components should render from state and props; state should represent information that cannot be derived more simply from other state.

For example, if a selected item can be computed from `items` and `selectedId`, consider deriving it rather than storing a second `selectedItem` value that can go stale. When the same state is needed by several components, locate it at the appropriate shared boundary—such as an existing store—rather than creating parallel copies.

A useful process for adding UI state:

1. Write down what changes over time.
2. Identify which component or store owns each changing value.
3. Derive values that can be computed reliably from that state.
4. Add state only for information that cannot be derived or must persist across a lifecycle boundary.
5. Decide what should happen when the relevant chat, tab, workflow, or component is closed or replaced.
6. Test transitions, not just the initial render.

Use effects for synchronizing with external systems—for example, subscribing to a Tauri event or managing a timer—not as a general place to calculate derived values or coordinate arbitrary state changes. Ensure subscriptions and timers are cleaned up when their owner is no longer active.

When state updates depend on previous state, use the appropriate functional update or store action so quick successive events do not overwrite one another. For state shared between chats, workflows, or windows, include the correct identity in the state model; do not rely on whichever item happens to be active at the time an asynchronous event arrives.

React’s guidance on [choosing state structure](https://react.dev/learn/choosing-the-state-structure) and [synchronizing with effects](https://react.dev/learn/synchronizing-with-effects) is useful here.

## 6. Separate UI, application logic, and native integration by responsibility

A practical desktop-app design often has three cooperating areas:

- **UI components:** render data, expose actions, and present loading/error/empty states.
- **Application logic and state:** coordinate user operations, select data, and enforce app-level rules.
- **Native adapters:** invoke Tauri commands, subscribe to events, and translate native or persisted representations into application types.

This does not require a formal architecture framework. Apply the separation where it makes changes easier to understand or test. A component that only displays a badge probably does not need a service layer. A reusable workflow that coordinates several commands and updates multiple pieces of state probably should not live entirely inside a large component.

A useful rule is: **keep native APIs at identifiable boundaries**. Components should not each invent their own command names, argument shapes, error handling, or event subscriptions. Follow the project’s existing adapters and services when adding native behavior.

Also avoid circular dependencies between UI, stores, and services. If a shared type is causing import cycles, consider whether it belongs in an existing lower-level contract module rather than in a component module.

## 7. Treat Tauri as a security boundary

A desktop app is not automatically safe just because it runs locally. The frontend can be influenced by files, user input, plugins, remote content, or compromised dependencies; native commands can access capabilities the web page does not have.

For every Tauri command or event:

1. **Validate inputs in the Rust backend.** Frontend validation improves user experience but is not a security control.
2. **Use the narrowest available capability and permission configuration.** Do not grant broad access just because it makes a command easier to call.
3. **Keep sensitive filesystem and process operations behind explicit native APIs.**
4. **Avoid interpolating user-controlled strings into shell commands.** Prefer argument APIs and backend-side validation.
5. **Treat command results and emitted events as runtime data.** Validate them before trusting their shape or identity.
6. **Handle failures at the boundary and preserve useful context.** Do not expose secrets or sensitive local paths unnecessarily in user-facing errors or logs.

Frontend and backend validation serve different purposes: the frontend guards the app’s assumptions; the backend protects privileged operations.

## 8. Use names and modules that help people find behavior

Follow the conventional TypeScript naming already used in the project. Prefer names that explain the domain and action, such as `loadSavedChats` or `selectActiveWorkflowStep`, over vague names such as `processData` or `handleThing`.

Organize code by cohesive responsibility. In a large application, feature-oriented folders can make it easier to find a feature’s components, state, services, and tests. But do not move or duplicate existing code solely to fit an idealized folder structure. In `rusty-ide`, follow the established agent-tab, harness, and service boundaries when extending those areas.

A good module should have a reason to change. If a file contains unrelated UI rendering, persistence logic, protocol conversion, and business rules, it may have accumulated too many responsibilities. Split it when doing so creates a clearer boundary, not just to make the file shorter.

## 9. Prefer explicit async and event lifecycles

Desktop apps frequently have asynchronous work that outlives the view that started it. Decide what the application should do when:

- the user switches tabs or chats;
- the view is disposed;
- a newer request supersedes an older one;
- the native command fails;
- an event arrives late or out of order;
- a subscription is closed.

Use stable IDs to associate asynchronous work with its owner. Do not assume events arrive in the order they were created, and do not route late events based only on the current selection. Cancel work where supported; otherwise ignore results that no longer belong to a live owner. Keep cleanup explicit for Tauri event listeners and other subscriptions.

## 10. Test behavior at boundaries

Use unit tests for deterministic functions: selection, formatting, parsing, validation, and state transitions. Use component tests for user-visible behavior and accessibility. Use integration tests for important combinations of state, event delivery, persistence, and native adapters.

For Tauri-facing TypeScript code, tests can usually use a controlled mock of the adapter or event source. Test the behavior at the application boundary rather than coupling every UI test to native implementation details.

High-value cases include:

- malformed or missing fields from persisted and native data;
- empty, loading, and failure states;
- duplicate, late, or out-of-order events;
- switching the active chat while a request is in progress;
- disposal or cancellation;
- legacy persisted data;
- keyboard interaction and accessible labels for controls.

Test outcomes a user or caller depends on, rather than mirroring every implementation line. When a behavior changes, add or update a test that would fail if the old behavior returned.

## 11. Use the project tools as part of the workflow

`rusty-ide` has dependencies installed and requires Node.js `>=22.12`. The project’s discovered frontend checks are:

```text
npm run typecheck
npm run test
npm run lint
npm run build
```

Its typecheck runs `tsc --noEmit`; its build runs TypeScript compilation followed by Vite. Use the scripts defined by the project rather than substituting guessed commands. For changes to `src-tauri`, run the relevant backend checks from `rusty-ide/src-tauri` as well.

A practical implementation workflow:

1. Find the existing feature and its tests before adding a new abstraction.
2. Check the relevant project conventions and the scope of the files you plan to change.
3. Add or update types and tests at the boundary where data enters.
4. Implement the smallest change that fits the existing architecture.
5. Run the focused test while developing.
6. After the final edit, run the project typecheck, relevant tests, lint, and build.
7. Review the final diff for broad assertions, duplicated state, stale subscriptions, and accidental changes outside the feature.

## Quick review checklist

Before considering TypeScript code complete, ask:

- Do types represent the real states, including missing and failed cases?
- Are values from Tauri, JSON, storage, or user input validated at runtime?
- Is `any` or a type assertion hiding a missing check?
- Is each piece of state owned in one place, with derived data kept derived?
- Are effects and subscriptions cleaned up with their lifecycle?
- Can a late event be attributed to the correct chat or workflow without consulting current UI state?
- Are native operations narrow, validated, and permissioned?
- Are logic and external effects separated enough to test the important decisions?
- Are the user-visible empty, error, keyboard, and accessibility behaviors covered?
- Did the relevant project checks pass after the last edit?

**In short:** use TypeScript to make states explicit, validate data at runtime boundaries, keep React state and async ownership deliberate, and treat the Tauri bridge as a security and correctness boundary. The strongest practices are not “use more types” or “add more layers”; they are to make invalid assumptions visible and keep each responsibility easy to locate and test.

### Sources

- [TypeScript: Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types)
- [TypeScript: Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing)
- [React: Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure)
- [React: Synchronizing with Effects](https://react.dev/learn/synchronizing-with-effects)
- [`rusty-ide/tsconfig.json`](rusty-ide/tsconfig.json)
- Project commands and Node requirement: `project_info` for `rusty-ide` (package scripts and `package.json` engine setting)