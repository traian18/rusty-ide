export type UserInteractionKind = "permission" | "model_question" | "run_attention";

export type UserInteractionActionStyle = "default" | "destructive";

export interface UserInteractionInput {
  kind: "text";
  placeholder?: string;
  value?: string;
  maxLength: number;
  multiline?: boolean;
}

export interface UserInteractionAction {
  id: string;
  label: string;
  style?: UserInteractionActionStyle;
  isDefault?: boolean;
  input?: UserInteractionInput;
}

export interface NotificationRouting {
  sessionId?: string;
  runId?: string;
  workspaceId?: string;
  tabId?: string;
  conversationId?: string;
  deepLink?: string;
  metadata?: Record<string, string>;
}

export interface UserInteractionRequest {
  requestId: string;
  kind: UserInteractionKind;
  title: string;
  body: string;
  actions: UserInteractionAction[];
  routing?: NotificationRouting;
  createdAt: number;
  expiresAt?: number;
  deduplicationKey?: string;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export type UserInteractionResponseSource = "in_app" | "macos_notification";

export interface UserInteractionResponse {
  requestId: string;
  actionId: string;
  inputValue?: string;
  source: UserInteractionResponseSource;
  respondedAt: number;
}

export interface PassiveNotification {
  notificationId?: string;
  category: "rusty.permission" | "rusty.model_question" | "rusty.run_status" | string;
  title: string;
  body: string;
  routing?: NotificationRouting;
  createdAt?: number;
  metadata?: Record<string, unknown>;
}

export interface NotificationCapabilities {
  available: boolean;
  actionable: boolean;
  textInput: boolean;
}

export type NotificationPresentationResult = "presented" | "unavailable" | "failed";

export interface NotificationPresenter {
  getCapabilities(): NotificationCapabilities | Promise<NotificationCapabilities>;
  present(request: UserInteractionRequest, onResponse: (response: UserInteractionResponse) => void): Promise<NotificationPresentationResult>;
  presentPassive(notification: PassiveNotification): Promise<NotificationPresentationResult>;
  cancel(requestId: string): Promise<void>;
  dispose(): void;
}
