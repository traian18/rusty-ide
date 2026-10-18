//! Code health for one repository: function and class metrics, detectors, scores, roll-ups and
//! the self-check from rusty-core, run over the repository snapshot and its Git signals.
//!
//! Parsing is the expensive part, so measurements are cached by content hash and survive
//! refreshes; the whole report is cached per (repository snapshot, Git snapshot) pair.
pub(in crate::repository) mod analyse;
mod cache;
mod detail;
pub mod model;
pub(super) mod prompt;
mod remedy;
pub(in crate::repository) mod report;

pub use cache::HealthCache;
