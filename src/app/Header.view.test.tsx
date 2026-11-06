import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DropdownPanel } from "../features/providers/ui/ProviderQuotaControl/QuotaDropdown";
import { HeaderView } from "./Header.view";

const noop = () => {};

describe("window drag region", () => {
  it("covers the header's children, which fill the bar", () => {
    const html = renderToStaticMarkup(
      <HeaderView onSearchOpen={noop} searchShortcut="⌘K" repositoryControl={null} toolExecutionControl={null} quotaControl={null} />,
    );
    expect(html).toContain('data-tauri-drag-region="deep"');
  });

  it("leaves the quota dropdown, rendered inside the header, clickable", () => {
    const html = renderToStaticMarkup(
      <DropdownPanel
        selectedProvider={{ id: "provider", name: "Provider" } as never}
        selectedQuota={undefined}
        selectedError={undefined}
        loading={false}
        providerOptions={[]}
        onProviderChange={noop}
        onRefresh={noop}
        onOpenManageUrl={noop}
      />,
    );
    expect(html).toContain('data-tauri-drag-region="false"');
  });
});
