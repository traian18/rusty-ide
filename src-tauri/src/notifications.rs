use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter, Manager};

const MAX_REQUEST_ID_LENGTH: usize = 256;
const MAX_TITLE_LENGTH: usize = 256;
const MAX_BODY_LENGTH: usize = 4096;
const MAX_INPUT_LENGTH: usize = 4000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationCapabilities {
    pub available: bool,
    pub actionable: bool,
    pub text_input: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationActionInput {
    pub kind: String,
    pub placeholder: Option<String>,
    pub max_length: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationAction {
    pub id: String,
    pub label: String,
    pub input: Option<NotificationActionInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRequest {
    pub request_id: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub actions: Vec<NotificationAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationResponse {
    request_id: String,
    action_id: String,
    input_value: Option<String>,
    source: &'static str,
    responded_at: u64,
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_REQUEST_ID_LENGTH
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':'))
}

fn validate_request(request: &NotificationRequest) -> Result<(), String> {
    if !valid_id(&request.request_id) {
        return Err("invalid notification request id".into());
    }
    if request.title.is_empty()
        || request.title.len() > MAX_TITLE_LENGTH
        || request.body.len() > MAX_BODY_LENGTH
    {
        return Err("invalid notification content".into());
    }
    if request.actions.len() > 4 {
        return Err("too many notification actions".into());
    }
    for action in &request.actions {
        if !valid_id(&action.id) || action.label.is_empty() || action.label.len() > 80 {
            return Err("invalid notification action".into());
        }
        if let Some(input) = &action.input {
            if input.kind != "text" || input.max_length == 0 || input.max_length > MAX_INPUT_LENGTH
            {
                return Err("invalid notification text input".into());
            }
            if input
                .placeholder
                .as_ref()
                .is_some_and(|value| value.len() > 160)
            {
                return Err("notification input placeholder is too long".into());
            }
        }
    }
    Ok(())
}

#[command]
pub fn notification_capabilities() -> NotificationCapabilities {
    NotificationCapabilities {
        available: cfg!(target_os = "macos"),
        actionable: cfg!(target_os = "macos"),
        text_input: cfg!(target_os = "macos"),
    }
}

#[command]
pub async fn notification_request_authorization() -> Result<bool, String> {
    native::request_authorization().await
}

#[command]
pub async fn notification_present(
    app: AppHandle,
    request: NotificationRequest,
) -> Result<(), String> {
    validate_request(&request)?;
    native::present(app, request).await
}

#[command]
pub async fn notification_present_passive(
    app: AppHandle,
    notification: NotificationRequest,
) -> Result<(), String> {
    validate_request(&notification)?;
    native::present_passive(app, notification).await
}

#[command]
pub async fn notification_cancel(request_id: String) -> Result<(), String> {
    if !valid_id(&request_id) {
        return Err("invalid notification request id".into());
    }
    native::cancel(request_id).await
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use mac_usernotifications::{
        cancel_pending, close_delivered, get_notification_settings, request_auth, Action,
        AuthorizationStatus, Notification,
    };
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    pub async fn request_authorization() -> Result<bool, String> {
        let settings = get_notification_settings()
            .await
            .map_err(|error| error.to_string())?;
        match settings.authorization_status {
            AuthorizationStatus::Authorized
            | AuthorizationStatus::Provisional
            | AuthorizationStatus::Ephemeral => Ok(true),
            AuthorizationStatus::Denied => Ok(false),
            AuthorizationStatus::NotDetermined | AuthorizationStatus::Unknown => {
                request_auth().await.map_err(|error| error.to_string())?;
                let settings = get_notification_settings()
                    .await
                    .map_err(|error| error.to_string())?;
                Ok(matches!(
                    settings.authorization_status,
                    AuthorizationStatus::Authorized
                        | AuthorizationStatus::Provisional
                        | AuthorizationStatus::Ephemeral
                ))
            }
        }
    }

    pub async fn present(app: AppHandle, request: NotificationRequest) -> Result<(), String> {
        if !request_authorization().await? {
            return Err("notification permission denied".into());
        }
        let mut notification = Notification::new()
            .id(&request.request_id)
            .title(request.title)
            .message(request.body)
            .timeout(Duration::from_secs(15 * 60));
        for action in &request.actions {
            notification = match &action.input {
                Some(input) => notification.action(Action::reply(
                    &action.id,
                    &action.label,
                    &action.label,
                    input.placeholder.as_deref().unwrap_or("Type a response"),
                )),
                None => notification.action(Action::button(&action.id, &action.label)),
            };
        }
        let handle = notification
            .send()
            .await
            .map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn(async move {
            let Ok(response) = handle.response().await else {
                return;
            };
            if response.is_timed_out() || response.is_dismiss_action() {
                return;
            }
            if response.is_default_action() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                return;
            }
            let input_value = response.reply_text.and_then(|value| {
                let trimmed = value.trim().to_owned();
                (!trimmed.is_empty() && trimmed.len() <= MAX_INPUT_LENGTH).then_some(trimmed)
            });
            let _ = app.emit(
                "rusty://notification-response",
                NotificationResponse {
                    request_id: request.request_id,
                    action_id: response.action_identifier,
                    input_value,
                    source: "macos_notification",
                    responded_at: SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64,
                },
            );
        });
        Ok(())
    }

    pub async fn present_passive(
        _app: AppHandle,
        notification: NotificationRequest,
    ) -> Result<(), String> {
        if !request_authorization().await? {
            return Err("notification permission denied".into());
        }
        Notification::new()
            .id(&notification.request_id)
            .title(notification.title)
            .message(notification.body)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub async fn cancel(request_id: String) -> Result<(), String> {
        cancel_pending(&request_id).await;
        close_delivered(&request_id).await;
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod native {
    use super::*;

    pub async fn request_authorization() -> Result<bool, String> {
        Ok(false)
    }

    pub async fn present(_app: AppHandle, _request: NotificationRequest) -> Result<(), String> {
        Err("native notifications unavailable".into())
    }

    pub async fn present_passive(
        _app: AppHandle,
        _notification: NotificationRequest,
    ) -> Result<(), String> {
        Err("native notifications unavailable".into())
    }

    pub async fn cancel(_request_id: String) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_bad_ids() {
        assert!(!valid_id("bad id"));
    }

    #[test]
    fn rejects_unsafe_action_payloads() {
        let request = NotificationRequest {
            request_id: "request-1".into(),
            title: "Title".into(),
            body: "Body".into(),
            actions: vec![NotificationAction {
                id: "answer".into(),
                label: "Answer".into(),
                input: Some(NotificationActionInput {
                    kind: "text".into(),
                    placeholder: None,
                    max_length: MAX_INPUT_LENGTH + 1,
                }),
            }],
        };
        assert!(validate_request(&request).is_err());
    }
}
