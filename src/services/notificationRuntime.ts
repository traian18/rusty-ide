import { InAppNotificationPresenter } from "./inAppNotificationPresenter";
import { MacosNotificationPresenter } from "./macosNotificationPresenter";
import { NotificationCoordinator } from "./notificationCoordinator";

export const inAppNotificationPresenter = new InAppNotificationPresenter();
export const macosNotificationPresenter = new MacosNotificationPresenter();
export const notificationCoordinator = new NotificationCoordinator({ presenters: [macosNotificationPresenter, inAppNotificationPresenter] });
