# MCP Integration

`McpIntegrationModal` is a self-contained form for adding/editing a single MCP
(Model Context Protocol) server entry. It is rendered inside `McpIntegrationTab`,
which manages the full collection through the store's `mcpServers` map (name to config), saved
with the rest of the app's encrypted secure config by `saveSecureConfig`. The feature follows the
shape in [`../README.md`](../README.md).

## Files

| File or folder | Holds |
|---|---|
| `index.ts` | the public API: `DEFAULT_SERVER_CONFIG` and the config types |
| `model.ts` | `McpServerConfig`, `TransportConfig`, `AuthConfig`, `McpConfigFile` and the form value types |
| `service/constants.ts` | transport, auth and grant options, form defaults |
| `service/form-utils.ts` | pure conversions between form values and a server config (`toFormValues`, `toServerConfig`, `isValidUrl`) |
| `service/githubConfig.ts`, `atlassianConfig.ts` | presets and parsers for the GitHub and Atlassian (Jira and Confluence) servers, with tests |
| `ui/index.ts` | the public API for views: `McpIntegrationTab` |
| `ui/McpIntegrationTab.tsx` | the page, with GitHub, Atlassian and generic server tabs |
| `ui/McpIntegrationModal.tsx` | the add and edit form; composes the sections in `ui/formSections/` |
| `ui/formSections/` | `IdentitySection`, `TransportSection`, `AuthSection`, `EnvironmentSection`, `AdvancedSection`, `TestConnectionSection`; each reads the form with `useFormContext` |
| `ui/connection-test.ts` | input checks, the test orchestrator and the `useConnectionTest` hook |
| `ui/specialized/` | the GitHub and Atlassian tabs (header card, guide callout, integration-method selector for NPX, Docker, UVX and remote HTTP, connection form, one hook each), and `GenericMcpTab` for custom servers |

## Component interface

```ts
interface McpIntegrationModalProps {
  initialConfig?: McpServerConfig; // populated when editing an existing server
  existingNames?: string[];         // for uniqueness validation
  onSave: (config: McpServerConfig) => void;
  onCancel: () => void;
}
```

`onSave` yields a single validated `McpServerConfig`; the host stores it in the `mcpServers` map
under its `name`, and passes `existingNames` from that map for the uniqueness check.

## Validation (react-hook-form)

- `name`: required, lowercase letters, digits, `-` and `_` only, and unique among `existingNames`
  (the server being edited keeps its own name).
- `url`: required when the transport is not stdio, and must be a valid URL.
- `command`: required when the transport is stdio.
- Auth fields are required by the chosen type: `apiKey` needs a header and value, `bearer` a token,
  `oauth2` a client id, client secret, token URL and grant type.

Defaults: timeout 30,000 ms, 3 retries, 1,000 ms between retries.

## Secrets

An `apiKey` value, a bearer `token` and an `oauth2` `clientSecret` are password inputs. They can be
written as `${ENV_VAR}` references, which the backend resolves from the runtime environment, so the
real secret need not be stored in the config. They are saved only inside the encrypted secure
config.

## Test connection

The button runs a real test, only on demand and never at startup. `validateTestInputs` checks that
a command (stdio) or a valid URL (the other transports) was entered. `runConnectionTest` then
converts the full form values into a server config, so the test uses the actual transport,
arguments, environment and auth, and calls the `mcp_test_connection` Tauri command through
`harness/core/mcpTestConnection.ts`. The Rust side connects, performs the `initialize` handshake and
lists the tools; the result is shown inline, as "Connected, N tools available" with their names, or
as the error.
