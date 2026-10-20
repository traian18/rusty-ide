use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use harness_code_analysis::metrics::FileMetrics;
use harness_code_health::trend::TrendSeries;

use super::analyse::Analysis;

/// Most measurements kept; past this the cache starts over (a refresh re-measures only what it
/// needs).
const MAX_METRICS: usize = 50_000;

#[derive(Default)]
pub struct HealthCache {
    /// By `language:content hash`.
    metrics: Mutex<HashMap<String, Arc<FileMetrics>>>,
    /// The last analysis and the snapshots it was computed from.
    analysis: Mutex<Option<(String, Arc<Analysis>)>>,
    /// The score trend, loaded from disk and added to after each analysis.
    trend: Mutex<TrendSeries>,
    /// Key of the analysis last recorded in the trend.
    recorded: Mutex<String>,
}

impl HealthCache {
    /// Measurements an earlier run saved, so unchanged files are never parsed again.
    pub fn load(&self, path: &std::path::Path) {
        if let Some(saved) =
            crate::repository::storage::read_json::<HashMap<String, FileMetrics>>(path)
        {
            let mut cache = self.metrics.lock().unwrap_or_else(|e| e.into_inner());
            cache.extend(saved.into_iter().map(|(k, v)| (k, Arc::new(v))));
        }
    }

    /// Saves the measurements still in use by the last analysis.
    pub fn save(&self, path: &std::path::Path) {
        let used: Option<std::collections::HashSet<String>> = self
            .analysis
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|(_, analysis)| analysis.metric_keys.iter().cloned().collect());
        let cache = self.metrics.lock().unwrap_or_else(|e| e.into_inner());
        let kept: HashMap<&String, &FileMetrics> = cache
            .iter()
            .filter(|(k, _)| used.as_ref().is_none_or(|u| u.contains(*k)))
            .map(|(k, v)| (k, v.as_ref()))
            .collect();
        if let Err(error) = crate::repository::storage::write_json(path, &kept) {
            eprintln!("Rust [repository storage] could not save code health: {error}");
        }
    }

    pub fn load_trend(&self, path: &std::path::Path) {
        if let Some(saved) = crate::repository::storage::read_json::<TrendSeries>(path) {
            *self.trend.lock().unwrap_or_else(|e| e.into_inner()) = saved;
        }
    }

    pub fn save_trend(&self, path: &std::path::Path) {
        let series = self.trend();
        if let Err(error) = crate::repository::storage::write_json(path, &series) {
            eprintln!("Rust [repository storage] could not save the health trend: {error}");
        }
    }

    pub fn trend(&self) -> TrendSeries {
        self.trend.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub(super) fn update_trend(&self, change: impl FnOnce(&mut TrendSeries)) {
        change(&mut self.trend.lock().unwrap_or_else(|e| e.into_inner()));
    }

    /// True once per analysis key, so opening the page twice records one point.
    pub(super) fn should_record(&self, key: &str) -> bool {
        let mut recorded = self.recorded.lock().unwrap_or_else(|e| e.into_inner());
        if *recorded == key {
            return false;
        }
        *recorded = key.to_owned();
        true
    }

    /// Forgets the last analysis so the next request rebuilds it.
    pub fn invalidate(&self) {
        *self.analysis.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    pub(super) fn metrics(
        &self,
        key: &str,
        measure: impl FnOnce() -> Option<FileMetrics>,
    ) -> Option<Arc<FileMetrics>> {
        if let Some(found) = self
            .metrics
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(key)
        {
            return Some(found.clone());
        }
        let measured = Arc::new(measure()?);
        let mut cache = self.metrics.lock().unwrap_or_else(|e| e.into_inner());
        if cache.len() >= MAX_METRICS {
            cache.clear();
        }
        cache.insert(key.to_owned(), measured.clone());
        Some(measured)
    }

    pub(super) fn analysis(&self, key: &str, build: impl FnOnce() -> Analysis) -> Arc<Analysis> {
        let mut slot = self.analysis.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((cached, analysis)) = slot.as_ref() {
            if cached == key {
                return analysis.clone();
            }
        }
        let analysis = Arc::new(build());
        *slot = Some((key.to_owned(), analysis.clone()));
        analysis
    }
}
