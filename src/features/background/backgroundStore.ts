/** What the process bubble shows: the host's jobs, and questions waiting for the user. */
import { create } from "zustand";

import type { Job } from "./client";

export interface Question {
  id: string;
  title: string;
  message: string;
  accept: string;
  onAccept(): void;
}

export interface BackgroundState {
  jobs: Job[];
  questions: Question[];
  /** Whether the bubbles are shown; the rail indicator toggles them. A new question opens them. */
  open: boolean;
  toggle(): void;
  setJobs(jobs: Job[]): void;
  ask(question: Question): void;
  answer(id: string): void;
}

export const useBackground = create<BackgroundState>()((set) => ({
  jobs: [],
  questions: [],
  open: false,
  toggle: () => set((state) => ({ open: !state.open })),
  setJobs: (jobs) => set({ jobs }),
  ask: (question) => set((state) => ({ open: true, questions: [...state.questions.filter((q) => q.id !== question.id), question] })),
  answer: (id) => set((state) => ({ questions: state.questions.filter((q) => q.id !== id) })),
}));
