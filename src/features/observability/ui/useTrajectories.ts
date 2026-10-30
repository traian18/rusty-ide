import { useSyncExternalStore } from "react";
import { trajectories } from "../service/trajectoryStore";

export const useTrajectories = () => useSyncExternalStore(trajectories.subscribe, trajectories.getSnapshot, trajectories.getSnapshot);
