import type {
  NotificationPresenter,
  PassiveNotification,
  UserInteractionRequest,
  UserInteractionResponse,
} from "./notificationTypes";

interface PendingEntry {
  request: UserInteractionRequest;
  resolve: (response: UserInteractionResponse) => void;
  reject: (reason: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface NotificationCoordinatorOptions {
  presenters: NotificationPresenter[];
  /** Called for delivery failures without affecting the guaranteed in-app path. */
  onDiagnostic?: (diagnostic: NotificationDiagnostic) => void;
  now?: () => number;
}

export interface NotificationDiagnostic {
  requestId?: string;
  presenter: string;
  operation: "present" | "passive" | "cancel";
  message: string;
}

export class NotificationCoordinator {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly deduplication = new Map<string, string>();
  private readonly now: () => number;

  constructor(private readonly options: NotificationCoordinatorOptions) {
    this.now = options.now ?? Date.now;
  }

  getPending(): UserInteractionRequest[] {
    return [...this.pending.values()].map(({ request }) => request);
  }

  register(request: UserInteractionRequest): Promise<UserInteractionResponse> {
    if (this.pending.has(request.requestId)) return Promise.reject(new Error("Duplicate request ID"));
    if (request.deduplicationKey) {
      const existing = this.deduplication.get(request.deduplicationKey);
      if (existing && this.pending.has(existing)) return Promise.reject(new Error("Duplicate interaction"));
    }

    return new Promise<UserInteractionResponse>((resolve, reject) => {
      const entry: PendingEntry = { request, resolve, reject };
      this.pending.set(request.requestId, entry);
      if (request.deduplicationKey) this.deduplication.set(request.deduplicationKey, request.requestId);
      if (request.expiresAt !== undefined) {
        const delay = Math.max(0, request.expiresAt - this.now());
        entry.timer = setTimeout(() => this.finish(request.requestId, new Error("Interaction expired")), delay);
      }
      request.signal?.addEventListener("abort", () => this.cancel(request.requestId), { once: true });
      void this.present(entry);
    });
  }

  respond(response: UserInteractionResponse): boolean {
    const entry = this.pending.get(response.requestId);
    if (!entry || !entry.request.actions.some((action) => action.id === response.actionId)) return false;
    this.finish(response.requestId, undefined, response);
    return true;
  }

  cancel(requestId: string): boolean {
    if (!this.pending.has(requestId)) return false;
    this.finish(requestId, new Error("Interaction cancelled"));
    return true;
  }

  dispose(): void {
    for (const requestId of [...this.pending.keys()]) this.cancel(requestId);
    for (const presenter of this.options.presenters) presenter.dispose();
  }

  async notify(notification: PassiveNotification): Promise<void> {
    await Promise.all(this.options.presenters.map(async (presenter) => {
      try {
        const capabilities = await presenter.getCapabilities();
        if (!capabilities.available) return;
        const result = await presenter.presentPassive(notification);
        if (result === "failed") this.diagnostic("passive", presenter, "native notification delivery failed", notification.notificationId);
      } catch (error) {
        this.diagnostic("passive", presenter, errorMessage(error), notification.notificationId);
      }
    }));
  }

  private async present(entry: PendingEntry): Promise<void> {
    const presenters = this.orderedPresenters();
    const available = await Promise.all(presenters.map(async (presenter) => {
      try {
        const capabilities = await presenter.getCapabilities();
        if (!capabilities.available || !capabilities.actionable) return false;
        const result = await presenter.present(entry.request, (response) => this.respond(response));
        if (result === "failed") this.diagnostic("present", presenter, "notification presentation failed", entry.request.requestId);
        return result === "presented";
      } catch (error) {
        this.diagnostic("present", presenter, errorMessage(error), entry.request.requestId);
        return false;
      }
    }));
    if (!available.some(Boolean)) this.diagnostic("present", { constructor: { name: "NotificationCoordinator" } }, "no notification presenter is available", entry.request.requestId);
  }

  private orderedPresenters(): NotificationPresenter[] {
    return [...this.options.presenters].sort((left, right) => {
      const leftIsInApp = left.constructor.name === "InAppNotificationPresenter";
      const rightIsInApp = right.constructor.name === "InAppNotificationPresenter";
      return Number(leftIsInApp) - Number(rightIsInApp);
    });
  }

  private diagnostic(operation: NotificationDiagnostic["operation"], presenter: object, message: string, requestId?: string): void {
    this.options.onDiagnostic?.({ requestId, presenter: presenter.constructor.name, operation, message });
  }

  private finish(requestId: string, error?: Error, response?: UserInteractionResponse): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    if (entry.request.deduplicationKey && this.deduplication.get(entry.request.deduplicationKey) === requestId) {
      this.deduplication.delete(entry.request.deduplicationKey);
    }
    if (entry.timer) clearTimeout(entry.timer);
    for (const presenter of this.options.presenters) void presenter.cancel(requestId).catch(() => undefined);
    if (error) entry.reject(error);
    else if (response) entry.resolve(response);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
