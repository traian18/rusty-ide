import { AlertModal } from "./app/AlertModal";
import { DisclaimerModal } from "./features/onboarding/ui";
import { UpdateAvailableModal } from "./features/updates/ui/UpdateAvailableModal";
import { AppBootstrapBoundary } from "./app/shell/AppBootstrapBoundary";
import { AppShell } from "./app/shell/AppShell";
import { DevLogBridge } from "./app/shell/DevLogBridge";
import { GlobalShortcuts } from "./app/shell/GlobalShortcuts";
import { StartupDegradedBanner } from "./app/shell/StartupDegradedBanner";
import styles from "./App.module.css";

function App() {
  return (
    <div className={`ide-typography-scope ${styles.app}`}>
      <DevLogBridge />
      <GlobalShortcuts />

      <AppBootstrapBoundary>
        <AppShell />
        <StartupDegradedBanner />
      </AppBootstrapBoundary>

      {/* Stays outside the boundary so a notify() during bootstrap still
          renders. */}
      <AlertModal />
      <DisclaimerModal />
      <UpdateAvailableModal />
    </div>
  );
}

export default App;
