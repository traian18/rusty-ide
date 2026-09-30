import React, { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { ArrowRight, BookOpen, ShieldCheck } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { CURRENT_ONBOARDING_RELEASE } from "../../config/onboarding";
import { saveHasSeenOnboarding } from "../../preferences/onboarding";
import { RustyIcon } from "../RustyIcon";
import { BetaBadge } from "./onboarding/BetaBadge";
import { CanvasGuide } from "./onboarding/CanvasGuide";
import { InlineChatGuide } from "./onboarding/InlineChatGuide";
import {
  AutoModelSection,
  HeroIntelligence,
  MoreIntelligenceSection,
  SmartToolsSection,
  WorkflowsSection,
} from "./onboarding/IntelligenceGuide";

const navItems: { id: string; label: string; beta?: boolean }[] = [
  { id: "auto-model", label: "Auto model" },
  { id: "smart-tools", label: "Smart tools" },
  { id: "workflows", label: "Workflows" },
  { id: "inline-chat", label: "Inline chat" },
  { id: "canvas", label: "Canvas", beta: true },
];

const principles = [
  ["01", "Right-sized models", "Easy requests do not need frontier prices. Rusty rates how demanding a request is and runs it on the model you chose for that level."],
  ["02", "Focused context", "Smart tools return the slice of a file, search, or web page that answers the question, so the model reasons about what matters."],
  ["03", "Deliberate workflows", "Define the steps, the verification, and the failure paths once. Every run follows them, and you can watch each step."],
];

export const OnboardingTab: React.FC = () => {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const openTab = useWorkspaceStore((state) => state.openTab);

  // package.json's version drifts from the app's real version (tauri.conf.json,
  // bumped per release) — read the actual running app version from Tauri instead.
  const [appVersion, setAppVersion] = useState(CURRENT_ONBOARDING_RELEASE.appVersion);
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => { });
  }, []);

  // Agent Mode is where AUTO, smart tools, and workflows come together, so it is
  // the primary starting point; the canvas (beta) has its own entry further down.
  const handleStart = () => {
    saveHasSeenOnboarding(true);
    if (rootPath) {
      openTab({ type: "agent" });
      return;
    }
    openTab({ type: "workspace" });
  };

  const handleOpenCanvas = () => {
    saveHasSeenOnboarding(true);
    if (rootPath) {
      openTab({ type: "canvas" });
      return;
    }
    openTab({ type: "workspace" });
  };

  const handleOpenSettings = () => openTab({ type: "settings" });
  const handleOpenBehaviors = () => openTab({ type: "behaviors" });

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-[var(--bg-editor)] text-[var(--text-normal)]">
      <div className="sticky top-0 z-30 border-b border-[var(--border-color)] bg-[var(--bg-editor)]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RustyIcon size={36} className="shadow-lg" />
            <div><div className="text-[12px] font-mono font-bold tracking-[0.22em] text-[var(--text-light)]">RUSTY</div><div className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)]">{CURRENT_ONBOARDING_RELEASE.id} · v{appVersion}</div></div>
          </div>
          <nav className="hidden md:flex items-center gap-1 text-[10px] font-mono">
            {navItems.map(({ id, label, beta }) => (
              <button key={id} onClick={() => scrollTo(id)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)] transition-colors cursor-pointer">
                {label}{beta && <BetaBadge size="sm" />}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main>
        <section className="relative max-w-7xl mx-auto px-6 lg:px-10 pt-16 lg:pt-24 pb-20 lg:pb-28">
          <div className="absolute top-10 left-1/4 w-80 h-80 rounded-full bg-[var(--accent-bg)] blur-3xl opacity-60 pointer-events-none" />
          <div className="relative grid lg:grid-cols-[1.02fr_0.98fr] gap-12 lg:gap-16 items-center">
            <div>
              <div className="flex items-center gap-4 mb-7">
                <div className="w-[72px] h-[72px] rounded-2xl border border-[var(--border-color)] bg-[var(--color-surface-elevated)] flex items-center justify-center shadow-2xl">
                  <RustyIcon size={56} />
                </div>
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--color-surface-elevated)] px-3 py-1.5 text-[9px] font-mono uppercase tracking-[0.16em] text-[var(--accent-color)]">
                    <ShieldCheck size={12} /> {CURRENT_ONBOARDING_RELEASE.id}
                  </div>
                  <div className="mt-2 pl-1 text-[8px] font-mono uppercase tracking-[0.16em] text-[var(--text-muted)]">Rusty version {appVersion}</div>
                </div>
              </div>
              <h1 className="max-w-3xl text-4xl sm:text-5xl xl:text-6xl font-semibold tracking-[-0.045em] leading-[1.04] text-[var(--text-light)]">
                The right model.<br />The right context.<br />The right <span className="text-[var(--accent-color)]">workflow.</span>
              </h1>
              <p className="mt-7 max-w-xl text-sm sm:text-base leading-7 text-[var(--text-normal)]">
                Rusty rates each request and runs it on the model you chose for that difficulty, hands the agent only the code that matters, and carries multi-step work through workflows you design. Use AI without surrendering control—or paying a frontier model for every line.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <button onClick={handleStart} className="group inline-flex items-center gap-2 rounded-xl bg-[var(--accent-color)] px-5 py-3 text-xs font-mono font-bold text-[var(--color-primary-foreground)] shadow-lg hover:brightness-110 transition-all cursor-pointer">
                  {rootPath ? "Open Agent Mode" : "Choose a workspace"}<ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
                </button>
                <button onClick={() => scrollTo("auto-model")} className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface-elevated)] px-5 py-3 text-xs font-mono font-semibold text-[var(--text-light)] hover:border-[var(--border-active)] transition-colors cursor-pointer">
                  See the intelligence<BookOpen size={14} />
                </button>
              </div>
              <div className="mt-10 grid grid-cols-3 gap-5 max-w-lg border-t border-[var(--border-color)] pt-6">
                <div><div className="text-lg font-semibold text-[var(--text-light)]">Adaptive</div><div className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-muted)] mt-1">model choice</div></div>
                <div><div className="text-lg font-semibold text-[var(--text-light)]">Targeted</div><div className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-muted)] mt-1">retrieval</div></div>
                <div><div className="text-lg font-semibold text-[var(--text-light)]">Orchestrated</div><div className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-muted)] mt-1">execution</div></div>
              </div>
              <p className="mt-5 max-w-lg text-[9px] font-mono leading-4 text-[var(--text-muted)]">
                You are viewing the <span className="text-[var(--accent-color)]">{CURRENT_ONBOARDING_RELEASE.id}</span> guide. Onboarding content is versioned with Rusty and will evolve as the application does.
              </p>
            </div>
            <HeroIntelligence />
          </div>
        </section>

        <section className="border-y border-[var(--border-color)] bg-[var(--color-surface-sunken)]">
          <div className="max-w-7xl mx-auto px-6 lg:px-10 py-16 lg:py-20">
            <div className="grid lg:grid-cols-[0.75fr_1.25fr] gap-10 lg:gap-20">
              <div>
                <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-[var(--accent-color)] mb-4">The philosophy</div>
                <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-light)]">Intelligence you steer.<br />Ownership stays human.</h2>
              </div>
              <div className="grid sm:grid-cols-3 gap-5">
                {principles.map(([number, title, text]) => (
                  <div key={number} className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-editor)] p-5">
                    <div className="text-[9px] font-mono text-[var(--accent-color)]">{number}</div>
                    <h3 className="mt-5 text-sm font-semibold text-[var(--text-light)]">{title}</h3>
                    <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <AutoModelSection onOpenSettings={handleOpenSettings} />
        <SmartToolsSection onOpenSettings={handleOpenSettings} />
        <WorkflowsSection onOpenBehaviors={handleOpenBehaviors} />
        <InlineChatGuide />
        <MoreIntelligenceSection />
        <CanvasGuide hasWorkspace={Boolean(rootPath)} onOpenCanvas={handleOpenCanvas} />

        <section className="border-t border-[var(--border-color)]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-20 text-center">
            <RustyIcon size={68} className="mx-auto shadow-2xl" />
            <h2 className="mt-7 text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-light)]">Build with AI. Keep the architecture yours.</h2>
            <p className="mt-5 mx-auto max-w-xl text-sm leading-6 text-[var(--text-normal)]">Let Rusty pick the model, fetch the right context, and follow your workflow—then merge only the code you understand.</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button onClick={handleStart} className="group inline-flex items-center gap-2 rounded-xl bg-[var(--accent-color)] px-5 py-3 text-xs font-mono font-bold text-[var(--color-primary-foreground)] shadow-lg hover:brightness-110 transition-all cursor-pointer">
                {rootPath ? "Open Agent Mode" : "Open your first workspace"}<ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
              {rootPath && (
                <button onClick={handleOpenCanvas} className="inline-flex items-center gap-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface-elevated)] px-5 py-3 text-xs font-mono font-semibold text-[var(--text-light)] hover:border-[var(--border-active)] transition-colors cursor-pointer">
                  Try the Canvas<BetaBadge size="sm" />
                </button>
              )}
            </div>
            <div className="mt-8 text-[8px] font-mono uppercase tracking-[0.18em] text-[var(--text-muted)]">Guide: {CURRENT_ONBOARDING_RELEASE.id} · Rusty v{appVersion}</div>
          </div>
        </section>
      </main>
    </div>
  );
};
