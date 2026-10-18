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
  setJobs(jobs: Job[]): void;
  ask(question: Question): void;
  answer(id: string): void;
}

export const useBackground = create<BackgroundState>()((set) => ({
  jobs: [],
  questions: [],
  setJobs: (jobs) => set({ jobs }),
  ask: (question) => set((state) => ({ questions: [...state.questions.filter((q) => q.id !== question.id), question] })),
  answer: (id) => set((state) => ({ questions: state.questions.filter((q) => q.id !== id) })),
}));
