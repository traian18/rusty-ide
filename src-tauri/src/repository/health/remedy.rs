//! What to do about each kind of code health issue, in the words a fix prompt hands to an agent.
//! Keyed by detector id; an unknown detector gets general advice rather than nothing.

/// Concrete refactoring steps for issues of `detector`.
pub(super) fn how_to_fix(detector: &str) -> &'static str {
    match detector {
        "complex_method" => "Reduce the number of independent paths: move each branch body into a well-named helper, replace long if/else or match chains on a value with a lookup table or polymorphism, and return early for edge cases so the main path reads straight down.",
        "large_method" => "Split the function into steps, each a function named after what it does (parse, validate, compute, write); keep the original as a short coordinator that calls them in order. Move setup and error handling out of the main logic.",
        "brain_method" => "This function is long, complex and sits in a file many others import, so changes ripple. Split it into smaller functions behind the same signature first (callers stay untouched), then move parts that belong elsewhere into their own module.",
        "nested_complexity" => "Flatten the nesting: invert conditions and return or continue early, extract the innermost blocks into helpers, and replace nested loops with iterator chains or a separate function per level.",
        "bumpy_road" => "Each separate block of nested logic is its own task: extract every bump into a named helper so the function becomes a flat sequence of calls.",
        "complex_conditional" => "Name the condition: move the boolean expression into a well-named variable or predicate function, split it into smaller named parts, and remove double negations.",
        "primitive_obsession" => "Group parameters that travel together into a struct or type with a meaningful name, and replace raw strings or numbers that carry meaning (ids, units, modes) with dedicated types or enums.",
        "god_class" => "Split the class by responsibility: group its methods by the fields they use, move each group into its own type, and keep the original as a thin facade only if callers need it. Break up its largest method first.",
        "low_cohesion" => "The methods form unrelated groups that share no fields: move each group into its own type or module so each piece has one reason to change.",
        "churn_risk" => "The file is rewritten more than its own size recently. Find what keeps changing (configuration, a growing match, mixed concerns), separate the stable part from the volatile part, and move the volatile part behind data or a smaller module.",
        "change_entropy" => "The file mostly changes inside wide, scattered commits. Find the concern it shares with the other files in those commits and bring that concern together in one place, so a change touches fewer files.",
        "co_change_scatter" => "The file changes together with many others. Identify the shared knowledge (a format, a protocol, duplicated rules) and move it into one module the others depend on.",
        "prior_defect" => "The file has been bug-fixed repeatedly. Look at the code the fixes touched, find the fragile pattern (unchecked inputs, duplicated state, implicit ordering), make it explicit, and add tests for the cases that broke.",
        "ownership_risk" | "developer_congestion" => "Many people change this file with no clear lead. Split it so separate concerns live in separate files, and make its contract explicit with types, documentation and tests so occasional contributors change it safely.",
        "knowledge_loss" => "Its only real owner has gone quiet. Document what the file does and why (module comment, invariants), add tests that pin current behaviour, and simplify the parts that only the owner understood.",
        "tf_unpinned_provider" => "Add a `version` constraint to the provider in `required_providers` (for example `version = \"~> 5.0\"`), commit the dependency lock file, and upgrade deliberately.",
        "gha_unpinned_action" => "Replace the tag or branch after `@` with the full 40-character commit SHA of the release you reviewed, and keep the version in a trailing comment; let Dependabot or Renovate bump it.",
        "df_latest_tag" => "Give the `FROM` image an explicit version tag, or better a digest (`image:1.2.3@sha256:...`), and update it on purpose with a dependency bot.",
        "tf_unpinned_module" => "Pin the module: add `version = \"~> x.y\"` for registry modules, or `?ref=<tag or commit>` for git sources, and bump it deliberately.",
        "tf_variable_hygiene" => "Give every variable a `type` and a one-line `description`; add `validation` blocks where only some values make sense.",
        "tf_output_hygiene" => "Add a `description` to the output saying what the value is and who consumes it.",
        "tf_provisioner_use" => "Replace the provisioner with something Terraform can plan: instance user data, a configuration-management tool, or a provider resource for what the command does.",
        "sec_open_ingress" => "Narrow `0.0.0.0/0` to the CIDR ranges or security groups that actually need access, and put public services behind a load balancer.",
        "gha_broad_permissions" => "Set `permissions: contents: read` at the top of the workflow and grant extra scopes (such as `pull-requests: write`) only on the jobs that need them.",
        "gha_script_injection" => "Do not expand event data inside `run`. Put it in `env:` (for example `TITLE: ${{ github.event.pull_request.title }}`) and use the quoted shell variable `\"$TITLE\"`.",
        "gha_pull_request_target_checkout" => "Do not check out the pull request's code in a `pull_request_target` workflow. Use `pull_request` for builds of untrusted code, or run untrusted steps in a separate workflow without secrets.",
        "gha_missing_timeout" => "Add `timeout-minutes` to the job, a little above its normal run time.",
        "gha_deprecated_runner" => "Change `runs-on` to a current image such as `ubuntu-latest` or `ubuntu-24.04`, and check the job still passes.",
        "gha_long_run_script" => "Move the script into a file under `.github/scripts/` or `scripts/`, call it from the step, and test it locally and with shellcheck.",
        "df_missing_user" => "Create an unprivileged user in the final stage (`RUN adduser ...`) and switch to it with `USER` before `CMD`; make writable paths owned by that user.",
        "df_add_instead_of_copy" => "Replace `ADD` with `COPY` for local files; use `ADD` only to unpack a local archive, and fetch remote files with `curl` plus a checksum.",
        "df_apt_no_cleanup" => "Chain `apt-get update`, `apt-get install -y --no-install-recommends ...` and `rm -rf /var/lib/apt/lists/*` in one `RUN` so the lists never reach a layer.",
        "df_secret_in_env" => "Do not bake secrets into the image. Pass them at run time (environment or mounted secret) or use BuildKit `--mount=type=secret` during the build, and rotate any value already published.",
        "df_cache_order" => "Copy only the dependency manifest and lockfile, run the install, then `COPY . .`, so source edits do not invalidate the dependency layer.",
        "k8s_latest_tag" => "Set the container image to a fixed version tag or digest and update it through your deployment pipeline.",
        "k8s_privileged" => "Remove `privileged: true`, set `allowPrivilegeEscalation: false`, drop all capabilities and add back only what is needed, and run as a non-root user.",
        "k8s_no_limits" => "Add `resources.requests` and `resources.limits` for CPU and memory, based on observed usage.",
        "k8s_no_probes" => "Add a `readinessProbe` (and a `livenessProbe` if the process can hang) pointing at a cheap health endpoint.",
        "tg_unpinned_source" => "Pin the unit's `terraform { source }` to a tag or commit (`?ref=v1.2.3`) or a registry `?version=`, and bump it through a reviewed change.",
        "iac_hardcoded_account" => "Replace the account id with a variable, `data.aws_caller_identity.current.account_id`, or a value read in Terragrunt `locals`, so the same code can run in every account.",
        "tg_missing_remote_state" => "Add a `remote_state` block (or a `generate \"backend\"` block) to the root file so every unit stores state remotely with locking.",
        "ci_latest_image" => "Give the job image a fixed tag or digest and update it deliberately, so a registry change cannot break or alter the pipeline.",
        "gl_unpinned_include" => "Pin the include to a tag or commit with `ref:`, or copy the file into the repository; avoid `remote:` URLs that change under you.",
        "ci_long_script" => "Move the script into a file in the repository, call it from the job, and test it locally and with shellcheck.",
        "cci_unpinned_orb" => "Pin the orb to a released version (`circleci/node@5.2.0`); `volatile` follows the latest publish.",
        "compose_latest_image" => "Set an explicit image tag or digest for the service so `docker compose pull` is reproducible.",
        "compose_privileged" => "Remove `privileged: true` and host networking; grant only the capabilities or published ports the service needs.",
        "ans_unnamed_task" => "Add a `name:` that says what the task achieves, in the imperative, so run output reads like a checklist.",
        "ans_non_idempotent" => "Use a module that is idempotent, or add `creates:`/`removes:`, a `when:` guard, or `changed_when:` so the task reports changed only when it changed something.",
        "sh_missing_strict_mode" => "Add `set -euo pipefail` near the top (after the shebang) and handle expected failures explicitly with `|| true` or `if`.",
        "sh_curl_pipe_sh" => "Download to a file, verify a checksum or signature, then execute it; pin the version you download.",
        "sh_unquoted_expansion" => "Quote expansions (`\"$var\"`, `\"${arr[@]}\"`) so values with spaces or glob characters stay one argument; run shellcheck to find the rest.",
        "mk_missing_phony" => "List command-style targets in `.PHONY` so they run even when a file of the same name exists.",
        "mk_duplicate_target" => "Merge the two recipes into one target or rename one; make silently uses only the last recipe.",
        "sec_secret_literal" => "Remove the literal, rotate the secret because it is already in history, and read it from the CI/CD secret store or an environment injected at deploy time.",
        "sec_committed_secret_file" => "Delete the file from the repository and its history (git filter-repo), rotate every credential it held, and add the pattern to `.gitignore`.",
        "repo_gitignore_gaps" => "Add the missing patterns to the root `.gitignore`, and remove already tracked files with `git rm --cached`.",
        "repo_codeowners_stale" => "Delete the CODEOWNERS rule or point it at the path that exists now, so reviews are still requested from the right owners.",
        "tf_unused_variable" => "Delete the variable, or use it; if callers still pass it, remove those arguments in the same change so nothing is silently ignored.",
        "tf_unused_local" => "Delete the local value, or reference it where it was meant to be used.",
        "tf_unused_data_source" => "Delete the data source, or reference it; an unused one still makes an API call on every plan.",
        "tg_dependency_cycle" => "Break the loop: move the outputs both units need into a third unit they both depend on, or remove the dependency that is only there for ordering.",
        "tg_missing_dependency" => "Fix the `config_path` so it points at a directory that contains a `terragrunt.hcl`, or add the missing unit.",
        "tg_include_depth" => "Flatten the include chain: have units include one shared root and read common values from `locals` there, so a setting is found in one hop.",
        "iac_missing_local_source" => "Fix the relative path so it points at an existing module directory, or add the module; check the path from the file that uses it.",
        "gha_unknown_needs" => "Correct the job name in `needs`, or add the missing job; GitHub rejects the workflow while a needed job does not exist.",
        "gha_needs_cycle" => "Remove one `needs` edge so jobs form a chain or a tree; a loop means no job in it can start.",
        "gha_missing_local_reference" => "Point `uses` at a workflow file or an action directory (with an `action.yml`) that exists, relative to the repository root.",
        "compose_depends_cycle" => "Break the `depends_on` loop; make one service tolerate the other starting later, using retries or health checks instead of ordering.",
        "swallowed_error" => "Decide what the failure means here: handle it (retry, fall back), log it with context and return an error, or let it propagate. Replace an empty or catch-all handler with the specific error type, and never discard a result with `_ =` unless the failure truly does not matter (then say why in a comment).",
        "panic_prone" => "Return an error instead of aborting: replace `unwrap`/`expect`/`!!`/`panic!` with `?`, a match on the failure, or a default with a logged warning, so the caller decides. Keep a panic only for states that can never happen, and say why.",
        "duplicated_code" => "Extract the shared logic into one function or module that every copy calls, parameterising what differs. Fix the behaviour once there; check that the other copies had the same bug before deleting them.",
        "untested_code" => "Add tests for the file's main paths and its failure cases, in a test file next to it or in the test folder, named after it so the link is clear. Start with the functions that branch the most.",
        "test_without_assertions" => "Assert what the code under test should produce or change: compare a returned value, check a state change, or assert that the expected error occurs. A test that only runs the code passes whatever the code does.",
        "skipped_tests" => "Fix each skipped test or delete it. If one cannot run yet, link the reason in the skip message and a date or issue to revisit; a suite with many skips reports health it does not have.",
        _ => "Refactor the code at the lines given so the measured values fall below their limits, keeping behaviour the same.",
    }
}

#[cfg(test)]
mod tests {
    use harness_code_health::registry;

    use super::how_to_fix;

    #[test]
    fn every_infrastructure_rule_has_specific_advice() {
        let general = how_to_fix("unknown");
        for rule in harness_infra_analysis::registry() {
            assert_ne!(how_to_fix(rule.id()), general, "{}", rule.id());
        }
    }

    #[test]
    fn every_detector_has_specific_advice() {
        let general = how_to_fix("unknown");
        for detector in registry() {
            assert_ne!(how_to_fix(detector.id()), general, "{}", detector.id());
        }
    }
}
