//! Context compaction for a session: which mode the recipe asks for, and
//! the rusty-core provider that implements it once the session's backend
//! is known. Kept apart from the recipe's wiring so compaction can change
//! without touching how a session is assembled.

use std::sync::Arc;

use serde::Deserialize;

/// Which compaction a session uses.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompactionMode {
    /// Local only: trim old tool output, then drop the oldest turns.
    #[default]
    Standard,
    /// Standard, plus a background model summary guided by JEV importance
    /// ratings. Needs `jev`; without it the session falls back to standard.
    Smart,
}

/// JEV (OpenRouter Decisions API) connection for smart compaction.
#[derive(Debug, Clone, Deserialize)]
pub struct JevCompactionRecipe {
    pub api_key: String,
    pub model_id: String,
    #[serde(default)]
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ContextCompactionRecipe {
    #[serde(default)]
    pub mode: CompactionMode,
    /// The model's context window in tokens. Unknown windows use a flat
    /// character cap, and smart mode cannot schedule summaries without one.
    #[serde(default)]
    pub context_window: Option<u64>,
    #[serde(default)]
    pub jev: Option<JevCompactionRecipe>,
}

/// Recent messages never summarized or dropped.
const COMPACTION_KEEP_RECENT: usize = 12;
/// Character cap used when the model's window is unknown.
const COMPACTION_FALLBACK_CHARS: usize = 400_000;

/// What every request goes through before compaction: file reads that a
/// later read made redundant are replaced, at fixed points of the history so
/// the provider's prompt cache keeps matching in between.
fn first_pass() -> Arc<dyn rusty_context::ContextProvider> {
    Arc::new(rusty_context::SupersededReadsProvider)
}

/// Standard compaction: local tiers only, sized by the model's window.
fn standard_compaction(window: Option<u64>) -> Arc<rusty_context::PolicyDrivenCompactionProvider> {
    let passthrough = first_pass();
    Arc::new(
        rusty_context::PolicyDrivenCompactionProvider::new(
            passthrough,
            rusty_context::ContextPolicy::default(),
            window,
            COMPACTION_KEEP_RECENT,
            COMPACTION_FALLBACK_CHARS,
        )
        .with_anchor_first_user_message(true),
    )
}

/// Builds the compaction provider for a session from its resolved backend.
///
/// `summary_model` is the session's own model: a host-routed backend resolves
/// the provider runtime from `params.model`, so a summary request without it
/// cannot be answered.
pub(super) fn compaction_provider(
    config: &ContextCompactionRecipe,
    backend: Arc<dyn rusty_runtime::traits::ExecutionBackend>,
    summary_model: Option<String>,
) -> Arc<dyn rusty_context::ContextProvider> {
    let window = config.context_window;
    let standard = standard_compaction(window);
    let (CompactionMode::Smart, Some(jev)) = (config.mode, config.jev.as_ref()) else {
        return standard;
    };
    let mut judge = rusty_context::JevImportanceJudge::new(
        rusty_context::OpenRouterDecisions::new(jev.api_key.clone()),
        jev.model_id.clone(),
    );
    if let Some(confidence) = jev.confidence {
        judge = judge.with_confidence_threshold(confidence);
    }
    let passthrough = first_pass();
    Arc::new(
        rusty_context::SummarizingCompactionProvider::new(
            passthrough,
            standard,
            Arc::new(match summary_model {
                Some(model) => rusty_context::BackendSummarizer::new(backend).with_model(model),
                None => rusty_context::BackendSummarizer::new(backend),
            }),
            rusty_context::ContextPolicy::default(),
            window,
            COMPACTION_KEEP_RECENT,
        )
        .with_importance_judge(Arc::new(judge))
        .with_anchor_first_user_message(true),
    )
}
