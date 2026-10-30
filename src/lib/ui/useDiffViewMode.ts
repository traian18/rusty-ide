import { useState, useEffect, useCallback } from "react";

export type DiffViewMode = "side-by-side" | "inline";

const AUTO_SWITCH_THRESHOLD = 700;

export function useDiffViewMode(containerRef?: React.RefObject<HTMLElement | null>) {
  const [viewMode, setViewMode] = useState<DiffViewMode>("side-by-side");
  const [isAutoMode, setIsAutoMode] = useState(true);

  const checkWidthAndAutoSwitch = useCallback(() => {
    if (!isAutoMode) return;
    
    const width = containerRef?.current?.clientWidth ?? window.innerWidth;
    if (width < AUTO_SWITCH_THRESHOLD && viewMode !== "inline") {
      setViewMode("inline");
    } else if (width >= AUTO_SWITCH_THRESHOLD && viewMode === "inline") {
      setViewMode("side-by-side");
    }
  }, [isAutoMode, viewMode, containerRef]);

  useEffect(() => {
    checkWidthAndAutoSwitch();
    window.addEventListener("resize", checkWidthAndAutoSwitch);
    return () => window.removeEventListener("resize", checkWidthAndAutoSwitch);
  }, [checkWidthAndAutoSwitch]);

  const toggleViewMode = useCallback(() => {
    setIsAutoMode(false);
    setViewMode((prev) => (prev === "side-by-side" ? "inline" : "side-by-side"));
  }, []);

  const enableAutoMode = useCallback(() => {
    setIsAutoMode(true);
    checkWidthAndAutoSwitch();
  }, [checkWidthAndAutoSwitch]);

  return {
    viewMode,
    isAutoMode,
    toggleViewMode,
    enableAutoMode,
    renderSideBySide: viewMode === "side-by-side",
  };
}