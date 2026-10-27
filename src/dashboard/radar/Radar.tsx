import type { DashboardPage } from "../dashboardState";
import styles from "./Radar.module.css";

/** Each page's blip colour, as a radar marks places. */
const PAGE_BLIPS: Record<DashboardPage, string> = {
  docs: styles.blipYellow,
  specs: styles.blipBlue,
  health: styles.blipRed,
  files: styles.blipPink,
};

/** The page's blip beside its entry in the list. */
export function LegendBlip({ page }: { page: DashboardPage }) {
  return <span className={`${styles.legend} ${PAGE_BLIPS[page]}`} aria-hidden />;
}

export const radarSkin = styles.skin;
