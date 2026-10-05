//! Validated, transactional persistence boundary for Workflow Author.
//!
//! This module intentionally does not execute workflows. It validates the complete
//! native graph and profile documents, then commits only files under `.rusty`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::sync::atomic::{AtomicIsize, Ordering};

#[cfg(test)]
static MUTATE_BEFORE_RECHECK: AtomicIsize = AtomicIsize::new(0);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SaveIntent {
    Create,
    Update,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveWorkflowRequest {
    pub workspace_root: String,
    pub intent: SaveIntent,
    pub workflow_id: String,
    pub workflow: Value,
    #[serde(default)]
    pub expected_content_token: Option<String>,
    #[serde(default)]
    pub profiles: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthoringIssue {
    pub path: String,
    pub code: String,
    pub message: String,
    pub blocking: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SaveWorkflowResult {
    pub outcome: String,
    pub ready: bool,
    pub saved_paths: Vec<String>,
    pub issues: Vec<AuthoringIssue>,
    pub content_token: Option<String>,
}

#[derive(Debug, Clone)]
struct Target {
    path: PathBuf,
    content: Vec<u8>,
    existed: bool,
    before: Option<Vec<u8>>,
}

fn issue(path: impl Into<String>, code: &str, message: impl Into<String>) -> AuthoringIssue {
    AuthoringIssue {
        path: path.into(),
        code: code.to_string(),
        message: message.into(),
        blocking: true,
    }
}

fn token(bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(bytes);
    format!("sha256:{:x}", hash.finalize())
}

fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 120
        && id != "config"
        && id != "default"
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn document_id(document: &Value) -> Option<&str> {
    document.get("id").and_then(Value::as_str)
}

fn json_bytes(value: &Value) -> Result<Vec<u8>, AuthoringIssue> {
    serde_json::to_vec_pretty(value).map_err(|e| issue("", "invalid_document", e.to_string()))
}

fn effective_profiles(root: &Path, proposed: &[Value]) -> Result<Vec<Value>, Vec<AuthoringIssue>> {
    let mut result = super::workflow::authoring_builtin_profiles()
        .map_err(|message| vec![issue(".rusty/profiles", "invalid_document", message)])?;
    let dir = root.join(".rusty/profiles");
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.path().extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            match fs::read_to_string(entry.path())
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            {
                Some(value) => result.push(value),
                None => {
                    return Err(vec![issue(
                        ".rusty/profiles",
                        "invalid_document",
                        "an existing profile is not valid JSON",
                    )])
                }
            }
        }
    }
    result.extend(proposed.iter().cloned());
    Ok(result)
}

fn native_issues(document: &Value, profiles: &[Value], profile: bool) -> Vec<AuthoringIssue> {
    let issues = if profile {
        harness_engine::validation::validate_profile(document, profiles)
    } else {
        harness_engine::validation::validate_orchestration(document, profiles)
    };
    issues
        .into_iter()
        .map(|i| {
            let code = i.code;
            let blocking = i.blocking || code == "unknown_profile";
            AuthoringIssue {
                path: i.path,
                code,
                message: i.message,
                blocking,
            }
        })
        .collect()
}

fn validate_request(
    request: &SaveWorkflowRequest,
    root: &Path,
) -> Result<(Vec<Target>, String), Vec<AuthoringIssue>> {
    if !root.is_absolute() {
        return Err(vec![issue(
            "workspace_root",
            "unsafe_path",
            "workspace root must be absolute",
        )]);
    }
    if !safe_id(&request.workflow_id) {
        return Err(vec![issue(
            "workflow_id",
            "unsafe_path",
            "workflow ID contains unsafe characters or is reserved",
        )]);
    }
    if document_id(&request.workflow) != Some(request.workflow_id.as_str()) {
        return Err(vec![issue(
            "id",
            "invalid_document",
            "workflow candidate id must match workflow_id",
        )]);
    }
    let workflow_path = root
        .join(".rusty/workflows")
        .join(format!("{}.json", request.workflow_id));
    let workflow_before = fs::read(&workflow_path).ok();
    match request.intent {
        SaveIntent::Create if workflow_before.is_some() => {
            return Err(vec![issue(
                "workflow_id",
                "collision",
                "workflow already exists",
            )])
        }
        SaveIntent::Update if workflow_before.is_none() => {
            return Err(vec![issue(
                "workflow_id",
                "not_found",
                "workflow does not exist",
            )])
        }
        SaveIntent::Update => {
            let expected = request.expected_content_token.as_deref().ok_or_else(|| {
                vec![issue(
                    "expected_content_token",
                    "stale_update",
                    "updates require an expected content token",
                )]
            })?;
            if Some(expected) != workflow_before.as_deref().map(token).as_deref() {
                return Err(vec![issue(
                    "expected_content_token",
                    "stale_update",
                    "workflow changed since it was read",
                )]);
            }
        }
        _ => {}
    }

    let proposed_ids: Vec<&str> = request.profiles.iter().filter_map(document_id).collect();
    if proposed_ids.iter().any(|id| !safe_id(id)) || proposed_ids.len() != request.profiles.len() {
        return Err(vec![issue(
            "profiles",
            "unsafe_path",
            "profile IDs must be safe and every profile needs an id",
        )]);
    }
    let mut seen = HashSet::new();
    if proposed_ids.iter().any(|id| !seen.insert(*id)) {
        return Err(vec![issue(
            "profiles",
            "collision",
            "duplicate profile IDs",
        )]);
    }
    let mut targets = Vec::new();
    for profile in &request.profiles {
        let id = document_id(profile).expect("checked above");
        let path = root.join(".rusty/profiles").join(format!("{id}.json"));
        let before = fs::read(&path).ok();
        if before.is_some() {
            return Err(vec![issue(
                format!("profiles.{id}"),
                "collision",
                "profile already exists",
            )]);
        }
        let content = json_bytes(profile).map_err(|e| vec![e])?;
        targets.push(Target {
            path,
            content,
            existed: false,
            before,
        });
    }
    let workflow_content = json_bytes(&request.workflow).map_err(|e| vec![e])?;
    targets.push(Target {
        path: workflow_path,
        content: workflow_content,
        existed: workflow_before.is_some(),
        before: workflow_before,
    });
    let workflow_token = token(&targets.last().expect("workflow target").content);
    Ok((targets, workflow_token))
}

fn restore(targets: &[Target]) {
    for target in targets.iter().rev() {
        if let Some(before) = &target.before {
            let _ = fs::write(&target.path, before);
        } else {
            let _ = fs::remove_file(&target.path);
        }
    }
}

pub fn save_workflow_request(request: SaveWorkflowRequest) -> SaveWorkflowResult {
    let root = PathBuf::from(&request.workspace_root);
    let (targets, workflow_token) = match validate_request(&request, &root) {
        Ok(value) => value,
        Err(issues) => {
            return SaveWorkflowResult {
                outcome: issues
                    .first()
                    .map(|i| i.code.clone())
                    .unwrap_or_else(|| "invalid_document".into()),
                ready: false,
                saved_paths: vec![],
                issues,
                content_token: None,
            }
        }
    };
    let profile_values = match effective_profiles(&root, &request.profiles) {
        Ok(values) => values,
        Err(issues) => {
            return SaveWorkflowResult {
                outcome: "invalid_document".into(),
                ready: false,
                saved_paths: vec![],
                issues,
                content_token: None,
            }
        }
    };
    let mut issues = native_issues(&request.workflow, &profile_values, false);
    for profile in &request.profiles {
        issues.extend(native_issues(profile, &profile_values, true));
    }
    if !issues.is_empty() {
        return SaveWorkflowResult {
            outcome: if issues.iter().any(|i| i.code == "unknown_profile") {
                "unresolved_profile"
            } else {
                "validation_failed"
            }
            .into(),
            ready: false,
            saved_paths: vec![],
            issues,
            content_token: None,
        };
    }
    // Test-only hooks model a target changing between validation and the commit recheck,
    // and a failure after an earlier target was written.
    #[cfg(test)]
    if request.workflow_id == "__mutate__" || MUTATE_BEFORE_RECHECK.swap(0, Ordering::SeqCst) != 0 {
        if let Some(target) = targets.first() {
            if let Some(parent) = target.path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(&target.path, b"changed during validation");
        }
    }
    for target in &targets {
        if fs::read(&target.path).ok() != target.before {
            return SaveWorkflowResult {
                outcome: "stale_update".into(),
                ready: false,
                saved_paths: vec![],
                issues: vec![issue(
                    target.path.to_string_lossy(),
                    "stale_update",
                    "target changed during validation",
                )],
                content_token: None,
            };
        }
    }
    let mut written = Vec::new();
    for target in &targets {
        if let Err(error) = (|| {
            if let Some(parent) = target.path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&target.path, &target.content)
        })() {
            restore(&targets[..written.len() + 1]);
            return SaveWorkflowResult {
                outcome: "commit_failed".into(),
                ready: false,
                saved_paths: vec![],
                issues: vec![issue(
                    target.path.to_string_lossy(),
                    "commit_failed",
                    error.to_string(),
                )],
                content_token: None,
            };
        }
        written.push(target);
    }
    SaveWorkflowResult {
        outcome: "saved".into(),
        ready: true,
        saved_paths: targets
            .iter()
            .map(|t| t.path.to_string_lossy().to_string())
            .collect(),
        issues: vec![],
        content_token: Some(workflow_token),
    }
}

#[tauri::command]
pub fn save_workflow(request: SaveWorkflowRequest) -> SaveWorkflowResult {
    save_workflow_request(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    fn request(root: &Path, intent: SaveIntent, id: &str) -> SaveWorkflowRequest {
        SaveWorkflowRequest {
            workspace_root: root.to_string_lossy().into(),
            intent,
            workflow_id: id.into(),
            workflow: serde_json::json!({"id": id}),
            expected_content_token: None,
            profiles: vec![],
        }
    }
    #[test]
    fn rejects_unsafe_ids() {
        let d = tempdir().unwrap();
        let result = save_workflow(request(d.path(), SaveIntent::Create, "../escape"));
        assert_eq!(result.outcome, "unsafe_path");
    }
    fn valid_workflow(id: &str) -> Value {
        let mut workflow = harness_engine::validation::templates().default_workflow;
        workflow["id"] = serde_json::json!(id);
        workflow
    }

    #[test]
    fn accepts_a_runtime_builtin_profile_reference() {
        let d = tempdir().unwrap();
        let profiles = super::super::workflow::authoring_builtin_profiles().unwrap();
        let builtin = profiles
            .iter()
            .find(|profile| {
                profile["id"]
                    .as_str()
                    .unwrap()
                    .starts_with("rusty-ide.builtin.")
            })
            .unwrap()["id"]
            .clone();
        let mut workflow = valid_workflow("builtin-profile");
        let agent = workflow["nodes"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|node| node["type"] == "agent")
            .unwrap();
        agent["config"]["profile"] = serde_json::json!({ "id": builtin });
        let mut request = request(d.path(), SaveIntent::Create, "builtin-profile");
        request.workflow = workflow;
        let result = save_workflow(request);
        assert!(result.ready, "{result:?}");
    }
    #[test]
    fn creates_and_updates_a_valid_workflow() {
        let d = tempdir().unwrap();
        let mut create = request(d.path(), SaveIntent::Create, "valid");
        create.workflow = valid_workflow("valid");
        let saved = save_workflow(create);
        assert!(saved.ready, "{saved:?}");
        assert_eq!(saved.outcome, "saved");
        let mut update = request(d.path(), SaveIntent::Update, "valid");
        update.workflow = valid_workflow("valid");
        update.workflow["name"] = serde_json::json!("updated");
        update.expected_content_token = saved.content_token;
        let updated = save_workflow(update);
        assert!(updated.ready, "{updated:?}");
    }

    #[test]
    fn rejects_stale_update_and_invalid_documents() {
        let d = tempdir().unwrap();
        let mut create = request(d.path(), SaveIntent::Create, "stale");
        create.workflow = valid_workflow("stale");
        let saved = save_workflow(create);
        let mut update = request(d.path(), SaveIntent::Update, "stale");
        update.workflow = valid_workflow("stale");
        update.expected_content_token = Some("sha256:not-current".into());
        assert_eq!(save_workflow(update).outcome, "stale_update");
        let mut malformed = request(d.path(), SaveIntent::Create, "malformed");
        malformed.workflow = serde_json::json!({"id":"malformed"});
        assert_eq!(save_workflow(malformed).outcome, "validation_failed");
        assert!(saved.ready);
    }

    #[test]
    fn rejects_unresolved_profiles_and_rechecks_changed_targets() {
        let d = tempdir().unwrap();
        let mut unresolved = request(d.path(), SaveIntent::Create, "unknown");
        unresolved.workflow = valid_workflow("unknown");
        let agent = unresolved.workflow["nodes"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|node| node["type"] == "agent")
            .unwrap();
        agent["config"]["profile"] = serde_json::json!({"id":"missing"});
        assert_eq!(save_workflow(unresolved).outcome, "unresolved_profile");

        let mut changed = request(d.path(), SaveIntent::Create, "__mutate__");
        changed.workflow = valid_workflow("__mutate__");
        assert_eq!(save_workflow(changed).outcome, "stale_update");
    }

    #[test]
    fn rolls_back_profile_when_workflow_commit_fails() {
        let d = tempdir().unwrap();
        let workflow_path = d.path().join(".rusty/workflows/rollback.json");
        fs::create_dir_all(&workflow_path).unwrap();
        let mut request = request(d.path(), SaveIntent::Create, "rollback");
        request.workflow = valid_workflow("rollback");
        request.profiles =
            vec![harness_engine::validation::templates().builtin_profiles[0].clone()];
        request.profiles[0]["id"] = serde_json::json!("new-profile");
        let result = save_workflow(request);
        assert_eq!(result.outcome, "commit_failed");
        assert!(!d.path().join(".rusty/profiles/new-profile.json").exists());
        assert!(workflow_path.is_dir());
    }

    #[test]
    fn rejects_create_collision() {
        let d = tempdir().unwrap();
        let p = d.path().join(".rusty/workflows");
        fs::create_dir_all(&p).unwrap();
        fs::write(p.join("one.json"), "{}").unwrap();
        let result = save_workflow(request(d.path(), SaveIntent::Create, "one"));
        assert_eq!(result.outcome, "collision");
    }
}
