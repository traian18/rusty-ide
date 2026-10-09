//! Rusty's own GitHub OAuth device flow, independent of other apps and CLIs.
//! The public client ID comes from Rusty's GitHub OAuth app registration.
use std::{path::PathBuf, time::Duration};

use harness_integration_github_copilot::{
    auth::CopilotAuth,
    credentials::{self, TokenGrant},
    InferenceAuth,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Manager;

const POLLING_MARGIN: u64 = 3;

const MISSING_CLIENT_ID: &str = "This Rusty build has no GitHub OAuth client ID configured. Register a GitHub OAuth app named Rusty with Device Flow enabled, then set its public client ID in src-tauri/copilot-oauth.json and rebuild.";

#[derive(Deserialize)]
struct OAuthConfig {
    client_id: String,
}

fn validate_client_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(MISSING_CLIENT_ID.into());
    }
    if !(8..=128).contains(&value.len()) || !value.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return Err("Invalid Rusty GitHub OAuth client ID. Use the public Client ID, not a client secret or access token.".into());
    }
    Ok(value.into())
}

/// A shipped app embeds the registration's public ID. Runtime/build overrides
/// are for maintainers testing their own registration; no foreign-app fallback.
pub fn configured_client_id() -> Result<String, String> {
    let runtime = std::env::var("RUSTY_COPILOT_OAUTH_CLIENT_ID").ok();
    let config: OAuthConfig = serde_json::from_str(include_str!("../../copilot-oauth.json"))
        .map_err(|_| "Invalid Rusty GitHub OAuth build configuration.")?;
    validate_client_id(
        runtime
            .as_deref()
            .or(option_env!("RUSTY_COPILOT_OAUTH_CLIENT_ID"))
            .unwrap_or(&config.client_id),
    )
}

fn signed_in_account(path: &std::path::Path) -> Result<(String, String), String> {
    signed_in_account_for_client(path, &configured_client_id()?)
}

fn signed_in_account_for_client(
    path: &std::path::Path,
    expected_client: &str,
) -> Result<(String, String), String> {
    if credentials::credential_client_id(path)? != expected_client {
        return Err("This Copilot sign-in belongs to a different OAuth app. Sign in again to authorize Rusty.".into());
    }
    credentials::credential_account(path)
}

pub fn credential_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("copilot-inference-auth.json"))
}

pub fn configured_host() -> Result<String, String> {
    let host = std::env::var("COPILOT_GH_HOST").unwrap_or_else(|_| "github.com".into());
    harness_integration_github_copilot::api_root(&host)?;
    Ok(host
        .trim_start_matches("https://")
        .trim_end_matches('/')
        .to_owned())
}

pub fn auth(app: &tauri::AppHandle) -> Result<(CopilotAuth, String), String> {
    let path = credential_path(app)?;
    let (host, _) = signed_in_account(&path)?;
    let root = harness_integration_github_copilot::api_root(&host)?;
    Ok((CopilotAuth::new(Some(path), host), root))
}

/// All recipes use the same native credential as discovery. The token stays
/// in Keychain/the native credential file and never crosses the UI bridge.
pub fn configure_recipe(
    path: PathBuf,
    recipe: &mut super::recipe::SessionRecipe,
) -> Result<(), String> {
    if recipe.integration != "github-copilot" {
        return Ok(());
    }
    configure_recipe_for_client(path, recipe, &configured_client_id()?)
}

fn configure_recipe_for_client(
    path: PathBuf,
    recipe: &mut super::recipe::SessionRecipe,
    client_id: &str,
) -> Result<(), String> {
    let (host, _) = signed_in_account_for_client(&path, client_id)?;
    let config = if recipe.integration_config.is_null() {
        recipe.integration_config = json!({});
        recipe.integration_config.as_object_mut().unwrap()
    } else {
        recipe
            .integration_config
            .as_object_mut()
            .ok_or("Invalid Copilot integration configuration.")?
    };
    config.insert("credentials_path".into(), json!(path));
    config.insert("github_host".into(), json!(host));
    Ok(())
}

pub async fn models(app: &tauri::AppHandle) -> Result<Value, String> {
    let (auth, root) = auth(app)?;
    let headers = auth
        .headers(&json!({}))
        .await
        .map_err(|error| error.to_string())?;
    reqwest::Client::new()
        .get(format!("{root}/models"))
        .headers(headers)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|_| "Cannot reach GitHub Copilot's model catalog.")?
        .error_for_status()
        .map_err(|error| {
            format!(
                "Copilot model discovery failed (HTTP {}). Sign in again in Rusty's settings.",
                error.status().map(|status| status.as_u16()).unwrap_or(0)
            )
        })?
        .json()
        .await
        .map_err(|_| "Invalid Copilot model catalog.".into())
}

#[derive(Deserialize)]
struct DeviceCode {
    device_code: String,
    user_code: String,
    verification_uri: String,
    #[serde(default = "default_interval")]
    interval: u64,
    expires_in: u64,
}
fn default_interval() -> u64 {
    5
}

enum PollResult {
    Pending,
    SlowDown(Option<u64>),
    Token(TokenGrant),
}

fn parse_poll(payload: Value) -> Result<PollResult, String> {
    if payload["access_token"]
        .as_str()
        .is_some_and(|token| !token.is_empty())
    {
        // Keep the refresh token and lifetimes too: an app with expiring
        // tokens gets an 8-hour access token that must be renewed.
        return serde_json::from_value(payload)
            .map(PollResult::Token)
            .map_err(|_| "Invalid GitHub authorization response.".into());
    }
    match payload["error"].as_str() {
        Some("authorization_pending") => Ok(PollResult::Pending),
        Some("slow_down") => Ok(PollResult::SlowDown(payload["interval"].as_u64())),
        Some("access_denied") => Err("GitHub Copilot sign-in was declined.".into()),
        Some("expired_token") => {
            Err("GitHub Copilot device code expired. Start sign-in again.".into())
        }
        _ => Err("GitHub Copilot authorization failed. Start sign-in again.".into()),
    }
}

async fn oauth_post(client: &reqwest::Client, url: &str, body: Value) -> Result<Value, String> {
    client
        .post(url)
        .header("accept", "application/json")
        .header("user-agent", concat!("rusty/", env!("CARGO_PKG_VERSION")))
        .json(&body)
        .send()
        .await
        .map_err(|_| "Cannot reach GitHub authorization.")?
        .error_for_status()
        .map_err(|error| {
            format!(
                "GitHub authorization failed (HTTP {}).",
                error.status().map(|status| status.as_u16()).unwrap_or(0)
            )
        })?
        .json()
        .await
        .map_err(|_| "Invalid GitHub authorization response.".into())
}

async fn start_device(
    client: &reqwest::Client,
    root: &str,
    client_id: &str,
) -> Result<DeviceCode, String> {
    let payload = oauth_post(
        client,
        &format!("{root}/login/device/code"),
        json!({"client_id":client_id,"scope":"read:user"}),
    )
    .await?;
    serde_json::from_value(payload).map_err(|_| "GitHub did not return a valid device code.".into())
}

async fn poll_device(
    client: &reqwest::Client,
    root: &str,
    device_code: &str,
    client_id: &str,
) -> Result<PollResult, String> {
    parse_poll(oauth_post(client, &format!("{root}/login/oauth/access_token"),
        json!({"client_id":client_id,"device_code":device_code,"grant_type":"urn:ietf:params:oauth:grant-type:device_code"})).await?)
}

pub async fn authorize(
    client_id: String,
    host: String,
    path: PathBuf,
    publish_device: impl Fn(&str, &str),
) -> Result<String, String> {
    // Validate before constructing URLs or sending credentials.
    let client_id = validate_client_id(&client_id)?;
    harness_integration_github_copilot::api_root(&host)?;
    let host = host.trim_start_matches("https://").trim_end_matches('/');
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "Cannot initialize GitHub authorization.")?;
    let root = format!("https://{host}");
    let device = start_device(&client, &root, &client_id).await?;
    let verification = reqwest::Url::parse(&device.verification_uri)
        .map_err(|_| "Invalid GitHub authorization URL.")?;
    if verification.scheme() != "https"
        || verification.host_str() != Some(host)
        || device.user_code.is_empty()
        || device.device_code.is_empty()
        || device.expires_in == 0
    {
        return Err("Unexpected GitHub authorization URL or code.".into());
    }
    publish_device(&device.verification_uri, &device.user_code);
    let expires = tokio::time::Instant::now() + Duration::from_secs(device.expires_in.min(600));
    let mut interval = device.interval.clamp(1, 600);
    let grant = loop {
        tokio::time::sleep(Duration::from_secs(interval + POLLING_MARGIN)).await;
        if tokio::time::Instant::now() >= expires {
            return Err("GitHub Copilot device code expired. Start sign-in again.".into());
        }
        match poll_device(&client, &root, &device.device_code, &client_id).await? {
            PollResult::Pending => {}
            PollResult::SlowDown(server_interval) => {
                interval = server_interval
                    .unwrap_or(interval + 5)
                    .max(interval)
                    .min(600)
            }
            PollResult::Token(grant) => break grant,
        }
    };
    let github_api = github_api(host);
    let user: Value = client
        .get(format!("{github_api}/user"))
        .bearer_auth(&grant.access_token)
        .header("user-agent", concat!("rusty/", env!("CARGO_PKG_VERSION")))
        .send()
        .await
        .map_err(|_| "Cannot verify the GitHub account.")?
        .error_for_status()
        .map_err(|_| "GitHub rejected the new sign-in credential.")?
        .json()
        .await
        .map_err(|_| "Invalid GitHub account response.")?;
    let login = user["login"]
        .as_str()
        .filter(|login| !login.is_empty())
        .ok_or("GitHub did not identify the signed-in account.")?;
    credentials::save_credential(&path, host, login, &client_id, &grant)?;
    Ok(login.into())
}

fn github_api(host: &str) -> String {
    if host == "github.com" {
        "https://api.github.com".into()
    } else {
        format!("https://api.{host}")
    }
}

pub async fn quota(app: &tauri::AppHandle) -> Result<super::managed_quota::ManagedQuota, String> {
    let (auth, _) = auth(app)?;
    let (host, login) = credentials::credential_account(&credential_path(app)?)?;
    let headers = auth
        .headers(&json!({}))
        .await
        .map_err(|error| error.to_string())?;
    let response = reqwest::Client::new()
        .get(format!("{}/copilot_internal/user", github_api(&host)))
        .headers(headers)
        .timeout(Duration::from_secs(15))
        .send()
        .await;
    let user: Value = match response {
        Ok(response) if response.status().is_success() => {
            response.json().await.unwrap_or(Value::Null)
        }
        _ => Value::Null,
    };
    let snapshots = user["quota_snapshots"].as_object().map(|entries| {
        entries.iter().map(|(id, entry)| {
            let limit = entry["entitlement"].as_f64();
            let remaining = entry["remaining"].as_f64();
            (id.clone(), json!({
                "entitlementRequests":limit,
                "usedRequests":limit.zip(remaining).map(|(limit, remaining)| (limit - remaining).max(0.0)),
                "remainingPercentage":entry["percent_remaining"],
                "isUnlimitedEntitlement":entry["unlimited"],
                "overage":entry["overage_count"],
                "overageAllowedWithExhaustedQuota":entry["overage_permitted"],
            }))
        }).collect::<serde_json::Map<String, Value>>()
    });
    Ok(super::managed_quota::ManagedQuota {
        authenticated: true,
        account: Some(login),
        plan: user["copilot_plan"].as_str().map(str::to_owned),
        message: if snapshots.is_some() { None } else { Some("GitHub did not return quota information for this direct API sign-in.".into()) },
        data: snapshots.map(|snapshots| json!({"quotaSnapshots":snapshots,"quotaResetDate":user["quota_reset_date_utc"]})),
    })
}

pub async fn status(app: &tauri::AppHandle) -> super::managed_auth::LoginState {
    let account = credential_path(app).and_then(|path| signed_in_account(&path));
    match account {
        Ok((_, login)) => match auth(app) {
            Ok((auth, _)) => match auth.headers(&json!({})).await {
                Ok(_) => super::managed_auth::LoginState {
                    authenticated: Some(true),
                    message: format!("Signed in as {login}"),
                    account: Some(login),
                    ..Default::default()
                },
                Err(error) => super::managed_auth::LoginState {
                    authenticated: Some(false),
                    message: error.to_string(),
                    ..Default::default()
                },
            },
            Err(message) => super::managed_auth::LoginState {
                authenticated: Some(false),
                message,
                ..Default::default()
            },
        },
        Err(message) => super::managed_auth::LoginState {
            authenticated: Some(false),
            message,
            ..Default::default()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires interactive GitHub device authorization"]
    async fn live_authorize_copilot_inference() {
        let path = std::env::var_os("RUSTY_COPILOT_LIVE_AUTH_PATH")
            .map(PathBuf::from)
            .expect("set RUSTY_COPILOT_LIVE_AUTH_PATH to the native credential metadata path");
        let login = authorize(
            configured_client_id().unwrap(),
            configured_host().unwrap(),
            path,
            |uri, code| {
                println!("GitHub device sign-in: {uri} code {code}");
            },
        )
        .await
        .expect("direct Copilot OAuth authorization");
        println!("Direct Copilot OAuth authenticated as {login}");
    }
    #[tokio::test]
    async fn device_flow_uses_the_configured_rusty_client_and_handles_poll_responses() {
        const TEST_CLIENT_ID: &str = "RustyOAuthFixture123";
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let root = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let responses = [
                json!({"device_code":"device-fixture","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","interval":5,"expires_in":900}),
                json!({"error":"authorization_pending"}),
                json!({"error":"slow_down","interval":10}),
                json!({"access_token":"secret-fixture"}),
            ];
            for (index, payload) in responses.into_iter().enumerate() {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                loop {
                    let mut chunk = [0; 4096];
                    let size = socket.read(&mut chunk).await.unwrap();
                    assert!(size > 0);
                    bytes.extend_from_slice(&chunk[..size]);
                    let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n")
                    else {
                        continue;
                    };
                    let headers = String::from_utf8_lossy(&bytes[..end]);
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|value| value.trim().parse::<usize>().ok())
                        })
                        .unwrap();
                    if bytes.len() < end + 4 + length {
                        continue;
                    }
                    let body: Value =
                        serde_json::from_slice(&bytes[end + 4..end + 4 + length]).unwrap();
                    assert!(headers.to_lowercase().contains("accept: application/json"));
                    assert_eq!(body["client_id"], TEST_CLIENT_ID);
                    if index == 0 {
                        assert!(headers.starts_with("POST /login/device/code "));
                        assert_eq!(body["scope"], "read:user");
                    } else {
                        assert!(headers.starts_with("POST /login/oauth/access_token "));
                        assert_eq!(body["device_code"], "device-fixture");
                        assert_eq!(
                            body["grant_type"],
                            "urn:ietf:params:oauth:grant-type:device_code"
                        );
                    }
                    break;
                }
                let body = payload.to_string();
                socket.write_all(format!("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            }
        });
        let client = reqwest::Client::new();
        let device = start_device(&client, &root, TEST_CLIENT_ID).await.unwrap();
        assert_eq!(device.user_code, "ABCD-1234");
        assert!(matches!(
            poll_device(&client, &root, &device.device_code, TEST_CLIENT_ID)
                .await
                .unwrap(),
            PollResult::Pending
        ));
        assert!(matches!(
            poll_device(&client, &root, &device.device_code, TEST_CLIENT_ID)
                .await
                .unwrap(),
            PollResult::SlowDown(Some(10))
        ));
        assert!(
            matches!(poll_device(&client, &root, &device.device_code, TEST_CLIENT_ID).await.unwrap(), PollResult::Token(grant) if grant.access_token == "secret-fixture")
        );
        server.await.unwrap();
    }
    #[test]
    fn polling_handles_pending_slowdown_decline_and_expiration_without_exposing_tokens() {
        assert!(matches!(
            parse_poll(json!({"error":"authorization_pending"})).unwrap(),
            PollResult::Pending
        ));
        assert!(matches!(
            parse_poll(json!({"error":"slow_down","interval":10})).unwrap(),
            PollResult::SlowDown(Some(10))
        ));
        assert!(
            matches!(parse_poll(json!({"access_token":"fixture"})).unwrap(), PollResult::Token(grant) if grant.access_token == "fixture" && grant.refresh_token.is_none() && grant.expires_in.is_none())
        );
        assert!(
            matches!(parse_poll(json!({"access_token":"fixture","token_type":"bearer","refresh_token":"refresh-fixture","expires_in":28800,"refresh_token_expires_in":15897600})).unwrap(), PollResult::Token(grant) if grant.refresh_token.as_deref() == Some("refresh-fixture") && grant.expires_in == Some(28800) && grant.refresh_token_expires_in == Some(15897600))
        );
        assert!(parse_poll(json!({"error":"access_denied"}))
            .err()
            .unwrap()
            .contains("declined"));
        assert!(parse_poll(json!({"error":"expired_token"}))
            .err()
            .unwrap()
            .contains("expired"));
        assert!(!parse_poll(json!({"error_description":"SECRET"}))
            .err()
            .unwrap()
            .contains("SECRET"));
    }

    #[test]
    fn recipes_share_the_discovery_credential_and_host() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("auth.json");
        std::fs::write(&path, json!({"format":credentials::CREDENTIAL_FORMAT,"host":"github.com","login":"octocat","oauth_client_id":"RustyOAuthFixture123","oauth_token":"fixture"}).to_string()).unwrap();
        let mut recipe: super::super::recipe::SessionRecipe = serde_json::from_value(json!({"workspace":{"root":"/tmp"},"integration":"github-copilot","integration_config":{"default_model":"claude-haiku-4.5"}})).unwrap();
        configure_recipe_for_client(path.clone(), &mut recipe, "RustyOAuthFixture123").unwrap();
        assert_eq!(recipe.integration_config["credentials_path"], json!(path));
        assert_eq!(recipe.integration_config["github_host"], "github.com");
        assert_eq!(
            recipe.integration_config["default_model"],
            "claude-haiku-4.5"
        );
        assert!(!recipe.integration_config.to_string().contains("fixture"));
    }

    #[test]
    fn missing_app_registration_has_no_foreign_client_fallback() {
        assert_eq!(validate_client_id(" ").unwrap_err(), MISSING_CLIENT_ID);
        assert!(validate_client_id("secret with spaces").is_err());
        assert_eq!(
            validate_client_id(" RustyOAuthFixture123 ").unwrap(),
            "RustyOAuthFixture123"
        );
    }

    #[test]
    fn credentials_from_another_or_unknown_app_require_a_new_sign_in() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("auth.json");
        let mut metadata = json!({"format":credentials::CREDENTIAL_FORMAT,"host":"github.com","login":"octocat","oauth_client_id":"PreviousAppFixture123","oauth_token":"fixture"});
        std::fs::write(&path, metadata.to_string()).unwrap();
        assert!(signed_in_account_for_client(&path, "RustyOAuthFixture123")
            .unwrap_err()
            .contains("different OAuth app"));
        metadata.as_object_mut().unwrap().remove("oauth_client_id");
        std::fs::write(&path, metadata.to_string()).unwrap();
        assert!(signed_in_account_for_client(&path, "RustyOAuthFixture123")
            .unwrap_err()
            .contains("older app registration"));
        metadata["oauth_client_id"] = json!("RustyOAuthFixture123");
        std::fs::write(&path, metadata.to_string()).unwrap();
        assert_eq!(
            signed_in_account_for_client(&path, "RustyOAuthFixture123").unwrap(),
            ("github.com".into(), "octocat".into())
        );
    }
}
