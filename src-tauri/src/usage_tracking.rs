//! Token usage persistence -- a direct Rust port of
//! `agent-sidecar/src/services/usageTracking.ts`, verbatim in algorithm:
//! append one raw event line, then roll it into `summary.json`'s
//! per-day/per-model/all-time totals. Same on-disk layout (`.rusty/metrics/
//! events/usage-<date>.jsonl` + `.rusty/metrics/summary.json`), same file
//! permissions (0o600), so an already-running workspace's history is read
//! unchanged regardless of which writer (the sidecar's old `/usage/record`
//! route, or this) produced it.
//!
//! The read side (`src/services/usageMetricsService.ts`'s `loadSummary`)
//! already reads `summary.json` straight off disk via the existing
//! `read_file_disk` command -- this module closes the one remaining half
//! (the write side), removing the sidecar from usage tracking entirely
//! regardless of which harness (core or sidecar) actually ran a capability.
//!
//! Serialization: the sidecar's own `UsageTracker` queues writes per
//! workspace root behind one `Promise` chain so a summary.json read-modify-
//! write never races itself. This module uses one process-wide
//! `tokio::sync::Mutex` instead of a per-workspace-root map -- usage writes
//! are infrequent and small (one JSON file, a few KB), so the minor loss of
//! cross-workspace parallelism isn't worth the extra bookkeeping a
//! per-root map would add.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Deserialize)]
pub struct TokenUsageSample {
    pub input: f64,
    pub output: f64,
    #[serde(rename = "cacheRead")]
    pub cache_read: f64,
    #[serde(rename = "cacheWrite")]
    pub cache_write: f64,
    #[serde(default)]
    pub reasoning: Option<f64>,
    #[serde(rename = "totalTokens")]
    pub total_tokens: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UsageRecordInput {
    pub surface: String,
    #[serde(rename = "runId", default)]
    pub run_id: Option<String>,
    #[serde(rename = "tabId", default)]
    pub tab_id: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    pub model: String,
    pub usage: TokenUsageSample,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct UsageTotals {
    input: f64,
    output: f64,
    #[serde(rename = "cacheRead")]
    cache_read: f64,
    #[serde(rename = "cacheWrite")]
    cache_write: f64,
    #[serde(rename = "totalTokens")]
    total_tokens: f64,
    calls: u64,
}

impl UsageTotals {
    fn add(&mut self, sample: &TokenUsageSample) {
        self.input += sample.input;
        self.output += sample.output;
        self.cache_read += sample.cache_read;
        self.cache_write += sample.cache_write;
        // Mirrors usageTracking.ts's own fallback: `sample.totalTokens ||
        // (sample.input || 0) + (sample.output || 0)`.
        self.total_tokens += if sample.total_tokens != 0.0 { sample.total_tokens } else { sample.input + sample.output };
        self.calls += 1;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct UsageDaySummary {
    #[serde(rename = "byModel")]
    by_model: HashMap<String, UsageTotals>,
    total: UsageTotals,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AllTimeSummary {
    #[serde(rename = "byModel")]
    by_model: HashMap<String, UsageTotals>,
    total: UsageTotals,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct UsageSummary {
    #[serde(rename = "byDay")]
    by_day: HashMap<String, UsageDaySummary>,
    #[serde(rename = "allTime")]
    all_time: AllTimeSummary,
}

#[derive(Default)]
pub struct UsageTrackingState {
    write_lock: Mutex<()>,
}

/// The first 10 characters of `crate::chrono_now_iso8601()`'s own
/// `"YYYY-MM-DDTHH:MM:SSZ"` output -- reuses that formatter (no new
/// dependency, e.g. `chrono` the crate, for what's otherwise a one-line
/// date calculation) rather than adding one just for this.
fn day_key(now_iso8601: &str) -> String {
    now_iso8601.chars().take(10).collect()
}

#[cfg(unix)]
fn write_permissions() -> std::fs::Permissions {
    use std::os::unix::fs::PermissionsExt;
    std::fs::Permissions::from_mode(0o600)
}

async fn set_owner_only_permissions(path: &std::path::Path) {
    #[cfg(unix)]
    {
        let _ = fs::set_permissions(path, write_permissions()).await;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

#[tauri::command]
pub async fn record_usage(
    state: tauri::State<'_, UsageTrackingState>,
    workspace_root: String,
    entry: UsageRecordInput,
) -> Result<(), String> {
    record_usage_with_state(&state, workspace_root, entry).await
}

/// The real logic, factored out of the `#[tauri::command]` wrapper so it's
/// callable -- and unit-testable -- with a plain `&UsageTrackingState`,
/// without needing a running Tauri app (mirrors `HarnessState::
/// create_session`'s own plain-method-plus-thin-command-wrapper shape in
/// `harness/session.rs`/`harness/commands.rs`).
pub async fn record_usage_with_state(
    state: &UsageTrackingState,
    workspace_root: String,
    entry: UsageRecordInput,
) -> Result<(), String> {
    let _guard = state.write_lock.lock().await;

    let metrics_root = PathBuf::from(&workspace_root).join(".rusty").join("metrics");
    let events_dir = metrics_root.join("events");
    let summary_path = metrics_root.join("summary.json");

    let now_iso8601 = crate::chrono_now_iso8601();
    let date = day_key(&now_iso8601);

    let line = serde_json::json!({
        "ts": now_iso8601,
        "surface": entry.surface,
        "runId": entry.run_id,
        "tabId": entry.tab_id,
        "provider": entry.provider,
        "model": entry.model,
        "input": entry.usage.input,
        "output": entry.usage.output,
        "cacheRead": entry.usage.cache_read,
        "cacheWrite": entry.usage.cache_write,
        "reasoning": entry.usage.reasoning,
        "totalTokens": entry.usage.total_tokens,
    });

    fs::create_dir_all(&events_dir).await.map_err(|error| format!("failed to create metrics events dir: {error}"))?;
    let events_path = events_dir.join(format!("usage-{date}.jsonl"));
    {
        use tokio::io::AsyncWriteExt;
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&events_path)
            .await
            .map_err(|error| format!("failed to open usage events file: {error}"))?;
        file.write_all(format!("{}\n", line).as_bytes())
            .await
            .map_err(|error| format!("failed to append usage event: {error}"))?;
    }
    set_owner_only_permissions(&events_path).await;

    let mut summary: UsageSummary = match fs::read_to_string(&summary_path).await {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => UsageSummary::default(),
    };

    let day = summary.by_day.entry(date).or_default();
    let day_model = day.by_model.entry(entry.model.clone()).or_default();
    day_model.add(&entry.usage);
    day.total.add(&entry.usage);
    let all_time_model = summary.all_time.by_model.entry(entry.model).or_default();
    all_time_model.add(&entry.usage);
    summary.all_time.total.add(&entry.usage);

    let serialized = serde_json::to_string_pretty(&summary).map_err(|error| format!("failed to serialize usage summary: {error}"))?;
    fs::write(&summary_path, serialized).await.map_err(|error| format!("failed to write usage summary: {error}"))?;
    set_owner_only_permissions(&summary_path).await;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(total: f64) -> TokenUsageSample {
        TokenUsageSample { input: total / 2.0, output: total / 2.0, cache_read: 0.0, cache_write: 0.0, reasoning: None, total_tokens: total }
    }

    fn entry(model: &str, total: f64) -> UsageRecordInput {
        UsageRecordInput {
            surface: "test".to_string(),
            run_id: Some("run-1".to_string()),
            tab_id: None,
            provider: Some("anthropic".to_string()),
            model: model.to_string(),
            usage: sample(total),
        }
    }

async fn record_directly(state: &UsageTrackingState, root: &std::path::Path, input: UsageRecordInput) {
        record_usage_with_state(state, root.to_string_lossy().to_string(), input)
            .await
            .expect("record_usage_with_state should succeed");
    }

    #[tokio::test]
    async fn records_a_single_sample_into_a_fresh_summary() {
        let dir = tempfile::tempdir().unwrap();
        let state = UsageTrackingState::default();
        record_directly(&state, dir.path(), entry("claude-opus", 100.0)).await;

        let summary_path = dir.path().join(".rusty/metrics/summary.json");
        let raw = tokio::fs::read_to_string(&summary_path).await.unwrap();
        let summary: UsageSummary = serde_json::from_str(&raw).unwrap();

        assert_eq!(summary.all_time.total.total_tokens, 100.0);
        assert_eq!(summary.all_time.total.calls, 1);
        assert_eq!(summary.all_time.by_model["claude-opus"].total_tokens, 100.0);
    }

    #[tokio::test]
    async fn accumulates_multiple_samples_across_models_and_a_shared_day() {
        let dir = tempfile::tempdir().unwrap();
        let state = UsageTrackingState::default();
        record_directly(&state, dir.path(), entry("claude-opus", 100.0)).await;
        record_directly(&state, dir.path(), entry("claude-opus", 50.0)).await;
        record_directly(&state, dir.path(), entry("gpt-4.1", 30.0)).await;

        let summary_path = dir.path().join(".rusty/metrics/summary.json");
        let raw = tokio::fs::read_to_string(&summary_path).await.unwrap();
        let summary: UsageSummary = serde_json::from_str(&raw).unwrap();

        assert_eq!(summary.all_time.total.calls, 3);
        assert_eq!(summary.all_time.total.total_tokens, 180.0);
        assert_eq!(summary.all_time.by_model["claude-opus"].total_tokens, 150.0);
        assert_eq!(summary.all_time.by_model["claude-opus"].calls, 2);
        assert_eq!(summary.all_time.by_model["gpt-4.1"].total_tokens, 30.0);

        let today = day_key(&crate::chrono_now_iso8601());
        let day = &summary.by_day[&today];
        assert_eq!(day.total.total_tokens, 180.0);
    }

    #[tokio::test]
    async fn appends_a_raw_jsonl_event_per_call() {
        let dir = tempfile::tempdir().unwrap();
        let state = UsageTrackingState::default();
        record_directly(&state, dir.path(), entry("claude-opus", 100.0)).await;
        record_directly(&state, dir.path(), entry("claude-opus", 50.0)).await;

        let today = day_key(&crate::chrono_now_iso8601());
        let events_path = dir.path().join(".rusty/metrics/events").join(format!("usage-{today}.jsonl"));
        let raw = tokio::fs::read_to_string(&events_path).await.unwrap();
        let lines: Vec<&str> = raw.lines().collect();
        assert_eq!(lines.len(), 2);
        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["model"], "claude-opus");
        assert_eq!(first["totalTokens"], 100.0);
    }

    #[tokio::test]
    async fn falls_back_to_input_plus_output_when_total_tokens_is_zero() {
        let dir = tempfile::tempdir().unwrap();
        let state = UsageTrackingState::default();
        let mut input = entry("claude-opus", 0.0);
        input.usage = TokenUsageSample { input: 40.0, output: 60.0, cache_read: 0.0, cache_write: 0.0, reasoning: None, total_tokens: 0.0 };
        record_directly(&state, dir.path(), input).await;

        let summary_path = dir.path().join(".rusty/metrics/summary.json");
        let raw = tokio::fs::read_to_string(&summary_path).await.unwrap();
        let summary: UsageSummary = serde_json::from_str(&raw).unwrap();
        assert_eq!(summary.all_time.total.total_tokens, 100.0);
    }
}
