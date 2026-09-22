//! Live model catalogs for managed-auth providers.
//!
//! Each catalog is read from the same authenticated runtime used for model
//! execution, so account policy and rollout state are reflected without a
//! hard-coded list:
//! - GitHub Copilot: `models.list` over the CLI's SDK JSON-RPC server.
//! - Codex: `model/list` over `codex app-server`.
//! - Claude Code: Anthropic's `/v1/models` endpoint with the CLI's OAuth
//!   credential and OAuth beta header.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::managed_quota::{
    binary_or_error, claude_credentials_path, read_claude_oauth_token, Framing, RpcChild,
    RPC_TIMEOUT,
};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedModel {
    pub id: String,
    pub name: String,
    pub reasoning: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub supported_reasoning_efforts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_reasoning_effort: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub input: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,
    pub is_default: bool,
}

fn non_empty_string(value: Option<&Value>) -> Option<String> {
    value?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn effort_names(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            entry
                .as_str()
                .map(str::to_owned)
                .or_else(|| non_empty_string(entry.get("reasoningEffort")))
                .or_else(|| non_empty_string(entry.get("id")))
        })
        .collect()
}

fn input_modalities(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.as_str().map(str::to_owned))
        .filter(|entry| entry == "text" || entry == "image")
        .collect()
}

fn parse_codex_models(payload: &Value) -> Result<Vec<ManagedModel>, String> {
    let data = payload
        .get("data")
        .and_then(Value::as_array)
        .ok_or("Codex model/list response did not contain data")?;
    let models = data
        .iter()
        .filter(|entry| entry.get("hidden").and_then(Value::as_bool) != Some(true))
        .filter_map(|entry| {
            let id = non_empty_string(entry.get("model"))
                .or_else(|| non_empty_string(entry.get("id")))?;
            let efforts = effort_names(entry.get("supportedReasoningEfforts"));
            Some(ManagedModel {
                name: non_empty_string(entry.get("displayName")).unwrap_or_else(|| id.clone()),
                id,
                reasoning: !efforts.is_empty(),
                supported_reasoning_efforts: efforts,
                default_reasoning_effort: non_empty_string(entry.get("defaultReasoningEffort")),
                input: input_modalities(entry.get("inputModalities")),
                context_window: None,
                max_tokens: None,
                is_default: entry
                    .get("isDefault")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect::<Vec<_>>();
    (!models.is_empty())
        .then_some(models)
        .ok_or_else(|| "Codex returned an empty model catalog".to_string())
}

fn parse_copilot_models(payload: &Value) -> Result<Vec<ManagedModel>, String> {
    let data = payload
        .get("models")
        .and_then(Value::as_array)
        .or_else(|| payload.as_array())
        .ok_or("Copilot models.list response did not contain models")?;
    let models = data
        .iter()
        .filter_map(|entry| {
            let id = non_empty_string(entry.get("id"))?;
            let efforts = effort_names(entry.get("supportedReasoningEfforts"))
                .into_iter()
                .chain(effort_names(
                    entry.pointer("/capabilities/reasoningEfforts"),
                ))
                .collect::<Vec<_>>();
            let reasoning_flag = entry
                .pointer("/capabilities/reasoning/supported")
                .or_else(|| entry.pointer("/capabilities/supportsReasoning"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            Some(ManagedModel {
                name: non_empty_string(entry.get("name")).unwrap_or_else(|| id.clone()),
                is_default: id == "auto"
                    || entry
                        .get("isDefault")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                id,
                reasoning: reasoning_flag || !efforts.is_empty(),
                supported_reasoning_efforts: efforts,
                default_reasoning_effort: non_empty_string(entry.get("defaultReasoningEffort")),
                input: input_modalities(entry.get("inputModalities")),
                context_window: entry.get("contextWindow").and_then(Value::as_u64),
                max_tokens: entry.get("maxTokens").and_then(Value::as_u64),
            })
        })
        .collect::<Vec<_>>();
    (!models.is_empty())
        .then_some(models)
        .ok_or_else(|| "GitHub Copilot returned an empty model catalog".to_string())
}

fn supported_claude_efforts(entry: &Value) -> Vec<String> {
    let Some(effort) = entry.pointer("/capabilities/effort") else {
        return Vec::new();
    };
    if effort.get("supported").and_then(Value::as_bool) != Some(true) {
        return Vec::new();
    }
    ["low", "medium", "high", "xhigh", "max"]
        .into_iter()
        .filter(|name| {
            effort
                .get(*name)
                .and_then(|value| value.get("supported"))
                .and_then(Value::as_bool)
                == Some(true)
        })
        .map(str::to_owned)
        .collect()
}

fn parse_claude_models(payload: &Value) -> Result<Vec<ManagedModel>, String> {
    let data = payload
        .get("data")
        .and_then(Value::as_array)
        .ok_or("Anthropic models response did not contain data")?;
    let models = data
        .iter()
        .filter_map(|entry| {
            let id = non_empty_string(entry.get("id"))?;
            let efforts = supported_claude_efforts(entry);
            let reasoning = entry
                .pointer("/capabilities/thinking/supported")
                .and_then(Value::as_bool)
                .unwrap_or(!efforts.is_empty());
            let mut input = vec!["text".to_string()];
            if entry
                .pointer("/capabilities/image_input/supported")
                .and_then(Value::as_bool)
                == Some(true)
            {
                input.push("image".to_string());
            }
            Some(ManagedModel {
                name: non_empty_string(entry.get("display_name")).unwrap_or_else(|| id.clone()),
                id,
                reasoning,
                supported_reasoning_efforts: efforts,
                default_reasoning_effort: None,
                input,
                context_window: entry.get("max_input_tokens").and_then(Value::as_u64),
                max_tokens: entry.get("max_tokens").and_then(Value::as_u64),
                is_default: false,
            })
        })
        .collect::<Vec<_>>();
    (!models.is_empty())
        .then_some(models)
        .ok_or_else(|| "Anthropic returned an empty model catalog".to_string())
}

async fn copilot_models(app: &AppHandle) -> Result<Vec<ManagedModel>, String> {
    let binary = binary_or_error(app, "github-copilot")?;
    let mut rpc = RpcChild::spawn(
        &binary,
        &["--headless", "--no-auto-update", "--stdio"],
        Framing::ContentLength,
    )
    .await?;
    let result = async {
        if let Err(connect_error) = rpc.request("connect", json!({})).await {
            rpc.request("ping", json!({}))
                .await
                .map_err(|_| connect_error)?;
        }
        let payload = rpc.request("models.list", json!({})).await?;
        parse_copilot_models(&payload)
    }
    .await;
    rpc.shutdown().await;
    result
}

async fn codex_models(app: &AppHandle) -> Result<Vec<ManagedModel>, String> {
    let binary = binary_or_error(app, "codex")?;
    let mut rpc = RpcChild::spawn(&binary, &["app-server"], Framing::NewlineDelimited).await?;
    let result = async {
        rpc.request(
            "initialize",
            json!({
                "clientInfo": { "name": "rusty", "title": "Rusty", "version": env!("CARGO_PKG_VERSION") },
                "capabilities": { "experimentalApi": true },
            }),
        )
        .await?;
        rpc.notify("initialized", json!({})).await?;
        let payload = rpc.request("model/list", json!({ "limit": 100, "includeHidden": false })).await?;
        parse_codex_models(&payload)
    }
    .await;
    rpc.shutdown().await;
    result
}

async fn claude_models(app: &AppHandle) -> Result<Vec<ManagedModel>, String> {
    binary_or_error(app, "claude-code")?;
    let token = read_claude_oauth_token(claude_credentials_path(app))
        .await
        .ok_or("Claude Code is not signed in with an OAuth credential")?;
    let response = reqwest::Client::builder()
        .timeout(RPC_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?
        .get("https://api.anthropic.com/v1/models?limit=1000")
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("anthropic-version", "2023-06-01")
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|error| format!("Anthropic model catalog request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Anthropic model catalog request failed ({}).",
            response.status().as_u16()
        ));
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("Anthropic model catalog response was not JSON: {error}"))?;
    parse_claude_models(&payload)
}

pub async fn fetch_models(app: &AppHandle, provider: &str) -> Result<Vec<ManagedModel>, String> {
    match provider {
        "github-copilot" => copilot_models(app).await,
        "codex" => codex_models(app).await,
        "claude-code" => claude_models(app).await,
        _ => Err(format!("unknown managed-auth provider: {provider}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_codex_catalog_metadata() {
        let models = parse_codex_models(&json!({ "data": [{
            "id": "gpt-5.6-sol", "model": "gpt-5.6-sol", "displayName": "GPT-5.6-Sol",
            "supportedReasoningEfforts": [{ "reasoningEffort": "low" }, { "reasoningEffort": "high" }],
            "defaultReasoningEffort": "low", "inputModalities": ["text", "image"], "isDefault": true
        }, { "id": "hidden", "hidden": true }] })).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-5.6-sol");
        assert_eq!(models[0].supported_reasoning_efforts, ["low", "high"]);
        assert!(models[0].is_default);
    }

    #[test]
    fn parses_copilot_account_filtered_catalog() {
        let models = parse_copilot_models(&json!({ "models": [
            { "id": "auto", "name": "Auto", "capabilities": {} },
            { "id": "gpt-5.4", "name": "GPT-5.4", "supportedReasoningEfforts": ["low", "high"] }
        ] }))
        .unwrap();
        assert_eq!(models.len(), 2);
        assert!(models[0].is_default);
        assert!(models[1].reasoning);
    }

    #[test]
    fn parses_claude_capabilities_and_limits() {
        let models = parse_claude_models(&json!({ "data": [{
            "id": "claude-sonnet-5", "display_name": "Claude Sonnet 5",
            "max_input_tokens": 1000000, "max_tokens": 128000,
            "capabilities": {
                "image_input": { "supported": true },
                "thinking": { "supported": true },
                "effort": { "supported": true, "low": { "supported": true }, "high": { "supported": true } }
            }
        }] })).unwrap();
        assert_eq!(models[0].input, ["text", "image"]);
        assert_eq!(models[0].context_window, Some(1_000_000));
        assert_eq!(models[0].supported_reasoning_efforts, ["low", "high"]);
    }
}
