import { create } from "zustand";

export type NotificationVariant = "success" | "error" | "info" | "danger";

export interface NotificationState {
  id: number;
  title: string;
  message: string;
  variant: NotificationVariant;
}

interface NotificationStore {
  notification: NotificationState | null;
  notify: (title: string, message: string, variant?: NotificationVariant) => void;
  clear: () => void;
}

let counter = 0;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notification: null,
  notify: (title, message, variant = "info") => {
    counter += 1;
    set({ notification: { id: counter, title, message, variant } });
  },
  clear: () => set({ notification: null }),
}));

/** Imperative helper — call from anywhere without hooks. */
export const notify = (title: string, message: string, variant: NotificationVariant = "info") => {
  useNotificationStore.getState().notify(title, message, variant);
};
