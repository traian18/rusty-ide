//! Model context limits from LiteLLM's `model_prices_and_context_window.json`, for models whose
//! provider catalog reports none.
//!
//! The file changes several times a day upstream, so the app keeps its own copy in the app data
//! folder and checks for a new one at most once a day, sending the last ETag so an unchanged file
//! costs no download. Only the entries `litellmSource.json` names are kept (chat models of the
//! providers Rusty connects to), as `[input tokens, output tokens or null, LiteLLM provider]`,
//! the same shape as the snapshot bundled with the app (`scripts/update-model-limits.mjs`).
//! Any failure keeps the copy there is; with none, the IDE uses its bundled snapshot.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

const SOURCE: &str = include_str!("../../../src/features/providers/modelLimits/litellmSource.json");
/// How long a copy is used before the next check.
const MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);
/// Fewer usable entries than this is a broken download, not a catalog.
const MIN_ENTRIES: usize = 50;
const CACHE_FILE: &str = "model-limits.json";

/// `[input tokens, output tokens, LiteLLM provider]`.
pub type Limits = (u64, Option<u64>, String);

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelLimits {
    /// When the copy was last confirmed current, in seconds since the epoch.
    pub fetched_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    etag: Option<String>,
    pub entries: BTreeMap<String, Limits>,
}

#[derive(Deserialize)]
struct Source {
    url: String,
    modes: Vec<String>,
    providers: BTreeMap<String, Vec<String>>,
}

fn source() -> Source {
    serde_json::from_str(SOURCE).expect("litellmSource.json is valid")
}

/// The entries of the raw file that the source keeps.
fn trim(raw: &Value, source: &Source) -> BTreeMap<String, Limits> {
    let kept: HashSet<&str> = source
        .providers
        .values()
        .flatten()
        .map(String::as_str)
        .collect();
    let Some(raw) = raw.as_object() else {
        return BTreeMap::new();
    };
    raw.iter()
        .filter_map(|(key, entry)| {
            let mode = entry.get("mode")?.as_str()?;
            let provider = entry.get("litellm_provider")?.as_str()?;
            if !source.modes.iter().any(|kept| kept == mode) || !kept.contains(provider) {
                return None;
            }
            let positive =
                |field: &str| entry.get(field).and_then(Value::as_u64).filter(|n| *n > 0);
            let input = positive("max_input_tokens").or_else(|| positive("max_tokens"))?;
            Some((
                key.clone(),
                (input, positive("max_output_tokens"), provider.to_owned()),
            ))
        })
        .collect()
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

fn is_fresh(limits: &ModelLimits, now: u64) -> bool {
    now.saturating_sub(limits.fetched_at) < MAX_AGE.as_secs()
}

fn read_cache(path: &Path) -> Option<ModelLimits> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn write_cache(path: &Path, limits: &ModelLimits) {
    let written = serde_json::to_vec(limits)
        .map_err(|error| error.to_string())
        .and_then(|bytes| {
            let partial = path.with_extension("json.partial");
            std::fs::write(&partial, bytes)
                .and_then(|()| std::fs::rename(&partial, path))
                .map_err(|error| error.to_string())
        });
    if let Err(error) = written {
        eprintln!("[model-limits] could not save {}: {error}", path.display());
    }
}

/// What a check against the source found.
enum Checked {
    Unchanged,
    New {
        etag: Option<String>,
        entries: BTreeMap<String, Limits>,
    },
}

async fn check(source: &Source, etag: Option<&str>) -> Result<Checked, String> {
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client.get(&source.url);
    if let Some(etag) = etag {
        request = request.header(reqwest::header::IF_NONE_MATCH, etag);
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(Checked::Unchanged);
    }
    let response = response
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let raw: Value = response.json().await.map_err(|error| error.to_string())?;
    let entries = trim(&raw, source);
    if entries.len() < MIN_ENTRIES {
        return Err(format!("only {} usable entries", entries.len()));
    }
    Ok(Checked::New { etag, entries })
}

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_data_dir().ok()?.join(CACHE_FILE))
}

/// The app's copy, checked against the source first when it is a day old or missing. `None`
/// when there is no copy and none could be fetched.
pub async fn model_limits(app: &AppHandle) -> Option<ModelLimits> {
    let path = cache_path(app)?;
    let cached = read_cache(&path);
    let now = now();
    if cached.as_ref().is_some_and(|limits| is_fresh(limits, now)) {
        return cached;
    }
    let source = source();
    let etag = cached.as_ref().and_then(|limits| limits.etag.as_deref());
    let refreshed = match check(&source, etag).await {
        Ok(Checked::Unchanged) => cached.map(|limits| ModelLimits {
            fetched_at: now,
            ..limits
        }),
        Ok(Checked::New { etag, entries }) => Some(ModelLimits {
            fetched_at: now,
            etag,
            entries,
        }),
        Err(error) => {
            eprintln!("[model-limits] check failed, keeping the current copy: {error}");
            return cached;
        }
    };
    if let Some(limits) = &refreshed {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        write_cache(&path, limits);
    }
    refreshed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_chat_models_of_known_providers_only() {
        let raw = json!({
            "sample_spec": { "max_input_tokens": 1, "mode": "chat" },
            "gpt-6-luna": { "max_input_tokens": 922000, "max_output_tokens": 128000, "litellm_provider": "openai", "mode": "chat" },
            "chatgpt/gpt-6-luna": { "max_tokens": 272000, "litellm_provider": "chatgpt", "mode": "responses" },
            "azure/gpt-6-luna": { "max_input_tokens": 922000, "litellm_provider": "azure", "mode": "chat" },
            "text-embedding-4": { "max_input_tokens": 8191, "litellm_provider": "openai", "mode": "embedding" },
            "broken": { "max_input_tokens": 0, "litellm_provider": "openai", "mode": "chat" }
        });
        let entries = trim(&raw, &source());
        assert_eq!(entries.len(), 2);
        assert_eq!(
            entries["gpt-6-luna"],
            (922_000, Some(128_000), "openai".to_string())
        );
        assert_eq!(
            entries["chatgpt/gpt-6-luna"],
            (272_000, None, "chatgpt".to_string())
        );
    }

    #[test]
    fn a_copy_is_checked_again_after_a_day() {
        let limits = |fetched_at| ModelLimits {
            fetched_at,
            etag: None,
            entries: BTreeMap::new(),
        };
        let day = MAX_AGE.as_secs();
        assert!(is_fresh(&limits(1_000), 1_000 + day - 1));
        assert!(!is_fresh(&limits(1_000), 1_000 + day));
    }

    #[test]
    fn the_cache_round_trips_in_the_snapshot_shape() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(CACHE_FILE);
        let mut entries = BTreeMap::new();
        entries.insert(
            "gpt-6-luna".to_string(),
            (922_000, Some(128_000), "openai".to_string()),
        );
        write_cache(
            &path,
            &ModelLimits {
                fetched_at: 7,
                etag: Some("\"e\"".into()),
                entries,
            },
        );
        let read = read_cache(&path).unwrap();
        assert_eq!((read.fetched_at, read.etag.as_deref()), (7, Some("\"e\"")));
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(
            text.contains(r#""gpt-6-luna":[922000,128000,"openai"]"#),
            "{text}"
        );
    }
}
