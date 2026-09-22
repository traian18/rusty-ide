import React from "react";

export interface CanvasTabContextType {
  tabId: string;
}

export const CanvasTabContext = React.createContext<CanvasTabContextType>({ tabId: "" });
