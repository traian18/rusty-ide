//! The workflows and profiles that ship with the app are valid and register.

use super::*;

/// The built-in profiles, under the ids the built-in workflows name.
fn starter_library() -> Vec<Value> {
    Catalog::load(None)
        .profiles_from(Source::Builtin)
        .cloned()
        .collect()
}

fn builtin_workflows() -> Vec<(String, Value)> {
    Catalog::load(None)
        .workflow_documents()
        .map(|w| (w["id"].as_str().unwrap().to_owned(), w.clone()))
        .collect()
}

#[test]
fn every_builtin_profile_is_valid_and_registered_natively() {
    let library = starter_library();
    assert_eq!(library.len(), 12);
    for profile in &library {
        let issues = harness_engine::validation::validate_profile(profile, &library);
        assert!(issues.is_empty(), "{}: {issues:?}", profile["id"]);
    }
    let registered = starter_library();
    let ids: Vec<_> = registered
        .iter()
        .map(|profile| profile["id"].as_str().unwrap().to_owned())
        .collect();
    assert!(
        ids.iter().all(|id| id.starts_with("rusty-ide.builtin.")),
        "{ids:?}"
    );
    let profiles = harness_engine::ProfilesConfig::default();
    for profile in registered {
        profiles
            .register_json(profile)
            .expect("a built-in profile registers");
    }
}

#[test]
fn every_builtin_workflow_compiles_without_issues() {
    let library = starter_library();
    let known: Vec<_> = library
        .iter()
        .map(|profile| profile["id"].as_str().unwrap().to_owned())
        .collect();
    let workflows = builtin_workflows();
    assert_eq!(workflows.len(), 15);
    for (name, workflow) in &workflows {
        let issues = harness_engine::validation::validate_orchestration(workflow, &library);
        assert!(issues.is_empty(), "{name}: {issues:?}");
        // Each agent step is a profile-backed step on a profile that ships with the app.
        for node in workflow["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|node| node["type"] == "agent")
        {
            let profile = node["config"]["profile"]["id"]
                .as_str()
                .unwrap_or_else(|| panic!("{name}/{}: no profile", node["id"]));
            assert!(
                known.iter().any(|id| id == profile),
                "{name}/{}: unknown profile {profile}",
                node["id"]
            );
        }
    }
}

/// Research named the bare `research` profile, which is registered only
/// as `rusty-ide.builtin.research`, so every question failed with
/// `unknown_profile`.
#[test]
fn builtin_research_policies_name_a_registered_profile() {
    let registered: Vec<_> = starter_library()
        .iter()
        .map(|profile| profile["id"].as_str().unwrap().to_owned())
        .collect();
    for (_, workflow) in builtin_workflows() {
        let Some(profile) = workflow["policies"]["research"]["profile"]["id"].as_str() else {
            continue;
        };
        assert!(
            registered.iter().any(|id| id == profile),
            "{}: research runs under unknown profile {profile}",
            workflow["id"]
        );
    }
}

#[tokio::test]
async fn builtin_workflows_create_sessions_with_their_builtin_profiles() {
    for (name, document) in builtin_workflows() {
        let state = HarnessState::new();
        let recipe: SessionRecipe = serde_json::from_value(json!({
            "workspace": { "root": "/tmp", "binding": "host" },
            "integration": "host",
            "host_tools": [{ "name": "read_file", "description": "Read a file" }],
            "workflow": document,
        }))
        .unwrap();
        let session = state
            .create_session(recipe)
            .await
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        state.close_session(session).await.unwrap();
    }
}

/// `host_validated_fallback` would still send the provider's native schema
/// whenever the integration advertises one (OpenRouter always does), on
/// every request of a tool-using step -- which Gemini rejects. The starter
/// flow must keep the schema out of the request; the executor test
/// `host_validated_steps_never_send_a_native_schema` in rusty-core covers
/// what that mode does.
#[test]
fn the_starter_flow_never_asks_for_a_native_schema() {
    let workflow = starter(STARTER_WORKFLOW);
    let agents: Vec<_> = workflow["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|node| node["type"] == "agent")
        .collect();
    assert_eq!(
        agents.len(),
        5,
        "plan, then build and verify for each slice"
    );
    for node in agents {
        // Verify returns a verdict the gate reads, and it uses tools, so it
        // is host-validated JSON, never the provider's native schema.
        let verifier = node["id"].as_str().unwrap().starts_with("verify");
        let expected = if verifier { "host_validated" } else { "text" };
        assert_eq!(
            node["config"]["structured_output"], expected,
            "{}",
            node["id"]
        );
    }
}

/// Every task-queue workflow has a deterministic gate that requires every
/// planned criterion to be reported; command outcomes alone cannot establish coverage.
#[test]
fn editing_workflows_require_task_coverage() {
    for (name, workflow) in builtin_workflows() {
        let nodes = workflow["nodes"].as_array().unwrap();
        if let Some(build) = nodes.iter().find(|n| n["config"]["task_queue"].is_object()) {
            assert_eq!(
                build["config"]["task_queue"]["plan_pointer"], "/plan",
                "{name}"
            );
            assert!(
                nodes.iter().any(
                    |n| n["config"]["checks"].as_array().is_some_and(|checks| checks
                        .iter()
                        .any(|c| c["type"] == "criteria" && c["plan_pointer"] == "/plan"))
                ),
                "{name}"
            );
        }
    }
}
