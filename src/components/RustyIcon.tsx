import React from "react";
import { useWorkspaceStore } from "../store";
import { resolveTheme } from "../theme";

interface RustyIconProps {
  size?: number;
  className?: string;
}

export const RustyIcon: React.FC<RustyIconProps> = ({ size = 20, className = "" }) => {
  const activeThemeId = useWorkspaceStore((state) => state.activeThemeId);
  const isLight = resolveTheme(activeThemeId).appearance === "light";

  return (
    <img
      src={isLight ? "/rusty-light.png" : "/rusty-dark.png"}
      alt="Rusty"
      className={`select-none object-contain rounded-sm ${className}`}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
};
