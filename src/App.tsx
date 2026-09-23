import { AlertModal } from "./components/AlertModal";
import { DisclaimerModal } from "./components/DisclaimerModal";
import { UpdateAvailableModal } from "./components/UpdateAvailableModal";
import { AppBootstrapBoundary } from "./components/shell/AppBootstrapBoundary";
import { AppShell } from "./components/shell/AppShell";
import { DevLogBridge } from "./components/shell/DevLogBridge";
import { GlobalShortcuts } from "./components/shell/GlobalShortcuts";
import { StartupDegradedBanner } from "./components/shell/StartupDegradedBanner";
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
