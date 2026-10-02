import type {
  NotificationCapabilities,
  NotificationPresenter,
  PassiveNotification,
  UserInteractionRequest,
  UserInteractionResponse,
} from "./notificationTypes";

/** Adapter used by React presenters; the UI owns rendering and calls respond. */
export class InAppNotificationPresenter implements NotificationPresenter {
  private readonly requests = new Map<string, { request: UserInteractionRequest; respond: (response: UserInteractionResponse) => void }>();
  private readonly listeners = new Set<() => void>();
  private snapshot: UserInteractionRequest[] = [];

  private publish(): void {
    this.snapshot = [...this.requests.values()].map(({ request }) => request);
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getPending(): UserInteractionRequest[] {
    return this.snapshot;
  }

  getCapabilities(): NotificationCapabilities {
    return { available: true, actionable: true, textInput: true };
  }

  async present(request: UserInteractionRequest, onResponse: (response: UserInteractionResponse) => void): Promise<"presented"> {
    this.requests.set(request.requestId, { request, respond: onResponse });
    this.publish();
    return "presented";
  }

  async presentPassive(_notification: PassiveNotification): Promise<"presented"> {
    return "presented";
  }

  respond(response: UserInteractionResponse): void {
    this.requests.get(response.requestId)?.respond(response);
  }

  async cancel(requestId: string): Promise<void> {
    if (!this.requests.delete(requestId)) return;
    this.publish();
  }

  dispose(): void {
    this.requests.clear();
    this.publish();
  }
}
