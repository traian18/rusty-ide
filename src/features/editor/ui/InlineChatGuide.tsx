import React from "react";
import { CornerDownLeft, FileText, MessageSquareCode } from "lucide-react";

export const InlineChatGuide: React.FC = () => (
  <section id="inline-chat" className="scroll-mt-16 border-y border-[var(--border-color)] bg-[var(--color-surface-sunken)]">
    <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-28">
      <div className="grid lg:grid-cols-[0.78fr_1.22fr] gap-12 lg:gap-16 items-center">
        <div>
          <div className="inline-flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.2em] text-[var(--accent-color)] mb-4"><MessageSquareCode size={13} /> Explore in place</div>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-light)]">Ask the code while you read it.</h2>
          <p className="mt-5 text-sm leading-6 text-[var(--text-normal)]">Inline Chat keeps exploration attached to the editor. Select a block—or simply place the cursor on a line—and ask a model to explain behavior, trace a contract, identify risk, or suggest a direction without leaving the file.</p>

          <div className="mt-8 space-y-3">
            {[
              ["01", "Select the relevant code", "Rusty sends the open file and marks the exact lines you selected."],
              ["02", "Press Ctrl/Cmd + Enter", "The conversation opens beneath the current line and remains anchored to that editor context."],
              ["03", "Choose a model and ask", "Use a local model for ordinary explanation or a stronger one when the code requires deeper reasoning."],
            ].map(([number, title, text]) => (
              <div key={number} className="grid grid-cols-[32px_1fr] gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-editor)] p-4">
                <span className="text-[9px] font-mono text-[var(--accent-color)] pt-0.5">{number}</span>
                <div><h3 className="text-xs font-semibold text-[var(--text-light)]">{title}</h3><p className="mt-1.5 text-[10px] leading-4 text-[var(--text-muted)]">{text}</p></div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-xl border border-[var(--border-active)] bg-[var(--accent-bg)] px-4 py-3 text-[10px] leading-5 text-[var(--text-normal)]">
            Use Inline Chat to understand local code. When the exploration becomes implementation work, capture the decision in the brief or turn it into a Rusty task.
          </div>
        </div>

        <div
          className="relative min-h-[520px] rounded-3xl border border-[var(--border-color)] overflow-hidden shadow-2xl"
          style={{ backgroundColor: "var(--bg-app)", backgroundImage: "radial-gradient(circle, var(--border-color) 1px, transparent 1px)", backgroundSize: "22px 22px" }}
        >
          <div className="absolute inset-5 sm:inset-8 rounded-xl border border-[var(--border-color)] bg-[var(--bg-editor)] overflow-hidden shadow-xl">
            <div className="h-10 px-4 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-header)]">
              <div className="flex items-center gap-2"><FileText size={12} className="text-[var(--accent-color)]" /><span className="text-[9px] font-mono text-[var(--text-light)]">token.service.ts</span></div>
              <span className="text-[8px] font-mono text-[var(--text-muted)]">TYPESCRIPT</span>
            </div>

            <div className="relative font-mono text-[9px] leading-6 pt-4">
              {[
                ["10", "async verifyRefreshToken(token: string) {"],
                ["11", "  const payload = await this.jwt.verify(token);"],
                ["12", "  const session = await this.sessions.find(payload.sid);"],
                ["13", "  if (!session || session.revokedAt) {"],
                ["14", "    throw new InvalidTokenError();"],
                ["15", "  }"],
                ["16", "  return { payload, session };"],
                ["17", "}"],
              ].map(([line, code]) => {
                const selected = Number(line) >= 12 && Number(line) <= 16;
                return (
                  <div key={line} className={`grid grid-cols-[42px_1fr] px-3 ${selected ? "bg-[var(--accent-bg)]" : ""}`}>
                    <span className="text-right pr-4 text-[var(--text-muted)] select-none">{line}</span>
                    <span className={selected ? "text-[var(--text-light)]" : "text-[var(--text-normal)]"}>{code}</span>
                  </div>
                );
              })}
            </div>

            <div className="absolute left-4 right-4 top-[218px] rounded-lg border border-[var(--border-active)] bg-[var(--bg-sidebar)] shadow-2xl overflow-hidden font-mono">
              <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--color-surface-sunken)]">
                <div className="flex items-center gap-2 min-w-0"><MessageSquareCode size={13} className="text-[var(--accent-color)] flex-shrink-0" /><span className="text-[8px] font-bold uppercase text-[var(--text-muted)]">Inline Chat</span><span className="text-[8px] text-[var(--text-normal)]">Lines 12–16</span></div>
                <span className="rounded border border-[var(--border-color)] bg-[var(--bg-app)] px-2 py-1 text-[8px] text-[var(--text-muted)] whitespace-nowrap">Local / Qwen</span>
              </div>
              <div className="p-3 space-y-3">
                <div className="ml-10 rounded-md bg-[var(--accent-bg)] px-3 py-2 text-[9px] leading-4 text-[var(--text-light)]">Why is the session checked after JWT verification?</div>
                <div className="text-[9px] leading-4 text-[var(--text-normal)]">
                  <span className="text-[var(--accent-color)] font-semibold">The checks protect different contracts.</span> JWT verification proves the token was signed and unexpired. The session lookup verifies that the refresh session still exists and has not been revoked server-side.
                </div>
              </div>
              <div className="border-t border-[var(--border-color)] p-2">
                <div className="flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-app)] p-2">
                  <span className="flex-1 text-[8px] text-[var(--text-muted)]">Ask a follow-up about this code…</span>
                  <span className="rounded bg-[var(--accent-color)] p-1 text-[var(--color-primary-foreground)]"><CornerDownLeft size={10} /></span>
                </div>
                <div className="mt-1.5 text-[7px] text-[var(--text-muted)]">Enter to send · Shift+Enter for a new line · Esc to close</div>
              </div>
            </div>
          </div>

          <div className="absolute right-5 bottom-5 rounded-full border border-[var(--border-color)] bg-[var(--bg-sidebar)] px-3 py-1.5 text-[8px] font-mono text-[var(--text-muted)] shadow-lg">CTRL/CMD + ENTER</div>
        </div>
      </div>
    </div>
  </section>
);
