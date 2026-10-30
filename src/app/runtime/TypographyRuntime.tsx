import { useEffect } from "react";
import { useWorkspaceStore } from "../../store";
import { applyTypographyProperties } from "../../features/settings";

export function TypographyRuntime() {
  const typographyPreferences = useWorkspaceStore((state) => state.typographyPreferences);

  useEffect(() => {
    applyTypographyProperties(typographyPreferences);
  }, [typographyPreferences]);

  return null;
}
