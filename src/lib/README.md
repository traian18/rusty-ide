# lib

Shared building blocks that any feature or the app may use. Nothing here knows about a feature.

- `ui/`: design-system parts: buttons, modals, form controls, tooltips.
- `platform/`: typed wrappers over Tauri plugins (opener, dialog, events, app info).
- `util/`: small pure helpers.
- `documents/`: document parsing for attachments and agent tools.

`lib/` never imports `features/`, `app/` or `harness/`. See [`../features/README.md`](../features/README.md) for the rules.
