//! The repository services for one workspace root.
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use harness_findings::{
    DefaultFindingsAnalyzer, FindingsAnalysis, FindingsConfig, FindingsService, FsSourceTextReader,
};
use harness_git_analysis::{GitAnalysis, GitAnalysisBuilder};
use harness_repository_frameworks::default_adapters;
use harness_repository_imports::{
    RustImportAdapter, RustImportResolver, TypeScriptImportAdapter, TypeScriptImportResolver,
};
use harness_workspace::{
    dependency_groups::DefaultGroupAnalyzer,
    import_graph::ImportSupport,
    repository_intelligence::{RepositoryGraph, RepositoryGraphBuilder, RepositorySnapshot},
};
use tokio_util::sync::CancellationToken;

use super::error::RepositoryError;

/// Manifest readers, source extensions and import support for every language beyond Rust and
/// TypeScript/JavaScript, which are registered separately. One place to add the next language.
fn language_support() -> (
    Vec<Arc<dyn harness_workspace::repository_intelligence::ManifestAdapter>>,
    Vec<String>,
    Vec<ImportSupport>,
) {
    let mut manifests = harness_workspace::repository_intelligence::default_manifest_adapters();
    manifests.extend(harness_repository_imports_python::manifest_adapters());
    manifests.extend(harness_repository_imports_go::manifest_adapters());
    manifests.extend(harness_repository_imports_java::manifest_adapters());
    manifests.extend(harness_repository_imports_csharp::manifest_adapters());
    manifests.extend(harness_repository_imports_php::manifest_adapters());
    manifests.extend(harness_repository_imports_native::manifest_adapters());
    let mut extensions: Vec<String> = ["rs", "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]
        .iter()
        .map(|e| (*e).to_owned())
        .collect();
    for group in [
        harness_repository_imports_python::SOURCE_EXTENSIONS,
        harness_repository_imports_go::SOURCE_EXTENSIONS,
        harness_repository_imports_java::SOURCE_EXTENSIONS,
        harness_repository_imports_csharp::SOURCE_EXTENSIONS,
        harness_repository_imports_php::SOURCE_EXTENSIONS,
    ] {
        extensions.extend(group.iter().map(|e| (*e).to_owned()));
    }
    extensions.extend(
        harness_repository_imports_native::source_extensions()
            .into_iter()
            .map(str::to_owned),
    );
    let supports = vec![
        harness_repository_imports_python::import_support(),
        harness_repository_imports_go::import_support(),
        harness_repository_imports_java::import_support(),
        harness_repository_imports_csharp::import_support(),
        harness_repository_imports_php::import_support(),
        harness_repository_imports_native::import_support(),
    ];
    (manifests, extensions, supports)
}

/// Graph, Git analysis, and findings for one authorized workspace root, plus the bookkeeping the
/// UI needs (when the snapshot was built, how to cancel a running refresh).
pub struct Entry {
    pub(super) root: PathBuf,
    pub(super) graph: Arc<dyn RepositoryGraph>,
    pub(super) git: Arc<dyn GitAnalysis>,
    pub(super) findings: Arc<dyn FindingsAnalysis>,
    built_at_ms: Mutex<Option<u64>>,
    cancel: Mutex<CancellationToken>,
    /// Limits how many repositories are indexed at once, across the whole registry.
    pub(super) indexing: Arc<tokio::sync::Semaphore>,
    /// Line counts for the dashboard, by content hash.
    pub(super) line_counts: super::dashboard::LineCounts,
    /// Code health measurements and the last report.
    pub(super) health: super::health::HealthCache,
    /// Where this repository's work is kept between runs; `None` keeps everything in memory.
    pub(super) storage: Option<super::storage::Storage>,
    /// Bumped by each scheduled analysis, so only the last of a burst of changes runs.
    pub(super) schedule: std::sync::atomic::AtomicU64,
}

impl Entry {
    /// Builds the services for `root` (an existing directory), in memory only. Nothing is scanned
    /// until refresh.
    pub fn new(root: &Path) -> Result<Self, RepositoryError> {
        Self::open(root, None)
    }

    /// Builds the services for `root`, keeping what they build under `storage` (the repository's
    /// folder in the app data directory) and loading what an earlier run kept there, so a
    /// repository analysed before opens without being scanned again.
    pub fn open(root: &Path, storage: Option<&Path>) -> Result<Self, RepositoryError> {
        let root = std::fs::canonicalize(root).map_err(|error| {
            RepositoryError::invalid(format!("workspace root is not usable: {error}"))
        })?;
        let storage = storage.map(|dir| super::storage::Storage::new(dir.to_path_buf()));
        let (manifests, extensions, languages) = language_support();
        let mut builder = RepositoryGraphBuilder::new(&root)?
            .manifest_adapters(manifests)
            .source_extensions(extensions)
            .import_support(ImportSupport {
                adapter: Arc::new(RustImportAdapter),
                resolver: Arc::new(RustImportResolver),
            })?
            .import_support(ImportSupport {
                adapter: Arc::new(TypeScriptImportAdapter),
                resolver: Arc::new(TypeScriptImportResolver),
            })?
            .dependency_groups(Arc::new(DefaultGroupAnalyzer::standard()));
        if let Some(storage) = &storage {
            builder = builder.snapshot_repository(Arc::new(super::storage::DiskSnapshots::open(
                storage.snapshot_path(),
            )?));
        }
        for support in languages {
            builder = builder.import_support(support)?;
        }
        for adapter in default_adapters() {
            builder = builder.framework_adapter(adapter);
        }
        let graph: Arc<dyn RepositoryGraph> = Arc::new(builder.build());
        let mut git_builder = GitAnalysisBuilder::for_repository(&root);
        if let Some(storage) = &storage {
            git_builder = git_builder.snapshot_repository(Arc::new(
                super::storage::DiskGitSnapshots::open(storage.git_path())?,
            ));
        }
        let git: Arc<dyn GitAnalysis> = Arc::new(git_builder.build()?);
        let built_at_ms = storage
            .as_ref()
            .and_then(|s| super::storage::written_at_ms(&s.snapshot_path()));
        let health = super::health::HealthCache::default();
        if let Some(storage) = &storage {
            health.load(&storage.health_path());
        }
        let findings: Arc<dyn FindingsAnalysis> = Arc::new(FindingsService::new(
            graph.clone(),
            Some(git.clone()),
            Arc::new(DefaultFindingsAnalyzer::standard(FindingsConfig::default())?),
            Arc::new(FsSourceTextReader::new(&root)),
        ));
        Ok(Self {
            root,
            graph,
            git,
            findings,
            built_at_ms: Mutex::new(built_at_ms),
            cancel: Mutex::new(CancellationToken::new()),
            indexing: Arc::new(tokio::sync::Semaphore::new(super::registry::MAX_INDEXING)),
            line_counts: Default::default(),
            health,
            storage,
            schedule: Default::default(),
        })
    }

    /// Shares one indexing limit between repositories.
    pub fn with_indexing_limit(mut self, limit: Arc<tokio::sync::Semaphore>) -> Self {
        self.indexing = limit;
        self
    }

    /// The repository graph, Git analysis and findings of this repository.
    pub fn services(
        &self,
    ) -> (
        Arc<dyn RepositoryGraph>,
        Arc<dyn GitAnalysis>,
        Arc<dyn FindingsAnalysis>,
    ) {
        (self.graph.clone(), self.git.clone(), self.findings.clone())
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The current snapshot, or a `snapshot_not_found` error telling the user to refresh.
    pub fn snapshot(&self) -> Result<Arc<RepositorySnapshot>, RepositoryError> {
        self.graph
            .current()
            .ok_or_else(RepositoryError::no_snapshot)
    }

    pub fn built_at_ms(&self) -> Option<u64> {
        *self.built_at_ms.lock().expect("built_at lock")
    }

    pub(super) fn record_built_now(&self) -> u64 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as u64);
        *self.built_at_ms.lock().expect("built_at lock") = Some(now);
        now
    }

    /// A fresh token for a new refresh, replacing (and not cancelling) the previous one.
    pub(super) fn begin_refresh(&self) -> CancellationToken {
        let token = CancellationToken::new();
        *self.cancel.lock().expect("cancel lock") = token.clone();
        token
    }

    /// Asks a running refresh to stop; a later refresh starts with a new token.
    pub fn cancel_refresh(&self) {
        self.cancel.lock().expect("cancel lock").cancel();
    }
}
