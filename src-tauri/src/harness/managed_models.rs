//! Live model catalogs for managed-auth providers.
//!
//! Each catalog is read from the same authenticated runtime used for model
//! execution, so account policy and rollout state are reflected without a
//! hard-coded list:
//! - GitHub Copilot: direct `/models` with the same OAuth credential as inference.
//! - Codex: `model/list` over `codex app-server`.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::managed_quota::{binary_or_error, Framing, RpcChild, RPC_TIMEOUT};

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
        .get("data")
        .and_then(Value::as_array)
        .ok_or("Copilot /models response did not contain data")?;
    let models = data
        .iter()
        .filter(|entry| entry.pointer("/policy/state").and_then(Value::as_str) != Some("disabled"))
        .filter(|entry| entry.get("model_picker_enabled").and_then(Value::as_bool) != Some(false))
        .filter(|entry| {
            entry
                .pointer("/capabilities/type")
                .and_then(Value::as_str)
                .is_none_or(|kind| kind == "chat")
        })
        .filter_map(|entry| {
            let id = non_empty_string(entry.get("id"))?;
            let efforts = effort_names(entry.pointer("/capabilities/supports/reasoning_effort"));
            let reasoning = !efforts.is_empty()
                || entry
                    .pointer("/capabilities/supports/adaptive_thinking")
                    .and_then(Value::as_bool)
                    == Some(true)
                || entry
                    .pointer("/capabilities/supports/max_thinking_budget")
                    .and_then(Value::as_u64)
                    .is_some();
            let vision = entry
                .pointer("/capabilities/supports/vision")
                .and_then(Value::as_bool)
                == Some(true);
            Some(ManagedModel {
                name: non_empty_string(entry.get("name")).unwrap_or_else(|| id.clone()),
                id,
                reasoning,
                supported_reasoning_efforts: efforts,
                default_reasoning_effort: non_empty_string(entry.get("default_reasoning_effort")),
                input: if vision {
                    vec!["text".into(), "image".into()]
                } else {
                    vec!["text".into()]
                },
                context_window: entry
                    .pointer("/capabilities/limits/max_context_window_tokens")
                    .and_then(Value::as_u64),
                max_tokens: entry
                    .pointer("/capabilities/limits/max_output_tokens")
                    .and_then(Value::as_u64),
                is_default: entry
                    .get("is_chat_default")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect::<Vec<_>>();
    (!models.is_empty())
        .then_some(models)
        .ok_or_else(|| "GitHub Copilot returned an empty model catalog".to_string())
}

async fn copilot_models(app: &AppHandle) -> Result<Vec<ManagedModel>, String> {
    parse_copilot_models(&super::copilot_oauth::models(app).await?)
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

pub async fn fetch_models(app: &AppHandle, provider: &str) -> Result<Vec<ManagedModel>, String> {
    match provider {
        "github-copilot" => copilot_models(app).await,
        "codex" => codex_models(app).await,
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
        let models = parse_copilot_models(&json!({ "data": [
            { "id": "claude-haiku-4.5", "name": "Claude Haiku 4.5", "model_picker_enabled": true,
              "capabilities": {"type":"chat", "supports":{"vision":true}, "limits":{"max_output_tokens":64000,"max_context_window_tokens":200000}} },
            { "id": "gpt-5.6-terra", "name": "GPT-5.6 Terra", "capabilities":{"supports":{"reasoning_effort":["low", "high"]}} },
            { "id": "disabled", "policy":{"state":"disabled"} },
            { "id": "hidden", "model_picker_enabled":false },
            { "id": "embedding", "capabilities":{"type":"embeddings"} }
        ] })).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "claude-haiku-4.5");
        assert_eq!(models[0].input, ["text", "image"]);
        assert_eq!(models[0].max_tokens, Some(64000));
        assert!(models[1].reasoning);
        assert_eq!(models[1].supported_reasoning_efforts, ["low", "high"]);
    }
}
