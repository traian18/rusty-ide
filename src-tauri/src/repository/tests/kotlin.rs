//! A Gradle Kotlin project with one Java class, end to end through the host: the import graph,
//! the files table, code health and the agent's symbol tool.
use std::sync::Arc;

use harness_workspace::import_graph::Resolution;
use serde_json::json;

use super::{write, Entry};
use crate::repository::{agent_tools::run, dashboard::model::FilesQuery};

const SERVICE: &str = "package com.acme.app

import com.acme.model.User
import com.acme.util.format
import com.acme.legacy.LegacyClient

class Service(private val user: User) {
    fun greet(loud: Boolean): String {
        if (loud && user.name.isNotEmpty()) {
            return format(user.name).uppercase()
        }
        return format(user.name)
    }

    fun legacy(): LegacyClient {
        return LegacyClient()
    }
}
";

async fn entry() -> (tempfile::TempDir, Arc<Entry>) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "settings.gradle.kts", "rootProject.name = \"shop\"\n");
    write(
        root,
        "build.gradle.kts",
        "dependencies {\n    implementation(\"io.ktor:ktor-server-core:2.3.0\")\n}\n",
    );
    write(root, "src/main/kotlin/com/acme/app/Service.kt", SERVICE);
    write(
        root,
        "src/main/kotlin/com/acme/model/User.kt",
        "package com.acme.model\n\ndata class User(val name: String)\n",
    );
    write(
        root,
        "src/main/kotlin/com/acme/util/Format.kt",
        "package com.acme.util\n\nfun format(value: String): String = value.trim()\n",
    );
    write(
        root,
        "src/main/java/com/acme/legacy/LegacyClient.java",
        "package com.acme.legacy;\n\npublic class LegacyClient {\n    public void load() {}\n}\n",
    );
    let entry = Entry::new(root).unwrap();
    entry.refresh(true).await.unwrap();
    (dir, Arc::new(entry))
}

#[tokio::test]
async fn a_kotlin_project_indexes_with_resolved_imports_and_its_language() {
    let (_dir, entry) = entry().await;
    let snapshot = entry.snapshot().unwrap();
    let service = "src/main/kotlin/com/acme/app/Service.kt";
    let target = |spelling: &str| {
        snapshot
            .imports
            .edges
            .iter()
            .find(|e| {
                e.fact.importing_file.as_path().to_str() == Some(service)
                    && e.fact.spelling == spelling
            })
            .map(|e| match &e.resolution {
                Resolution::ResolvedInternal { target_file, .. } => {
                    target_file.as_path().display().to_string()
                }
                other => format!("{other:?}"),
            })
    };
    assert_eq!(
        target("com.acme.model.User").as_deref(),
        Some("src/main/kotlin/com/acme/model/User.kt")
    );
    assert_eq!(
        target("com.acme.util.format").as_deref(),
        Some("src/main/kotlin/com/acme/util/Format.kt")
    );
    assert_eq!(
        target("com.acme.legacy.LegacyClient").as_deref(),
        Some("src/main/java/com/acme/legacy/LegacyClient.java")
    );
    let rows = entry
        .dashboard_files(&FilesQuery {
            language: Some("kotlin".into()),
            sort: Some("path".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(
        rows.rows.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(),
        [
            "src/main/kotlin/com/acme/app/Service.kt",
            "src/main/kotlin/com/acme/model/User.kt",
            "src/main/kotlin/com/acme/util/Format.kt"
        ]
    );
    let user = entry
        .dashboard_file("src/main/kotlin/com/acme/model/User.kt")
        .unwrap();
    assert!(user.importers.iter().any(|n| n.path == service));
}

#[tokio::test]
async fn kotlin_and_java_files_get_health_scores_and_symbols() {
    let (_dir, entry) = entry().await;
    let report = entry.code_health().unwrap();
    assert!(
        report.languages_measured.contains(&"kotlin".to_owned())
            && report.languages_measured.contains(&"java".to_owned()),
        "{:?}",
        report.languages_measured
    );
    let service = report
        .files
        .iter()
        .find(|f| f.path.ends_with("Service.kt"))
        .unwrap();
    assert_eq!(service.language, "kotlin");
    assert!(service.defect.is_some() && service.nloc > 0, "{service:?}");

    let answer = run(
        entry.clone(),
        "repo_symbol",
        json!({"target": "src/main/kotlin/com/acme/app/Service.kt::greet"}),
    )
    .await
    .unwrap()["result"]
        .clone();
    assert_eq!(answer["status"], "ok", "{answer}");
    let source = answer["sections"]["source"].as_str().unwrap();
    assert!(
        source.starts_with("    8|     fun greet(loud: Boolean)"),
        "{source}"
    );
    assert!(source.contains("   13|     }"), "{source}");
}
