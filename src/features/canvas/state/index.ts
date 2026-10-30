import type { WorkspaceSliceCreator } from "../../../store/sliceTypes";
import { baseSlice } from "./base";
import { graphSlice } from "./graph";
import { nodesSlice } from "./nodes";
import { logsSlice } from "./logs";
import { chatSlice } from "./chat";

/** The canvas state and actions, composed from the parts that own each concern. */
export const createCanvasSlice: WorkspaceSliceCreator = (...args) => ({
  ...baseSlice(...args),
  ...graphSlice(...args),
  ...nodesSlice(...args),
  ...logsSlice(...args),
  ...chatSlice(...args),
});
