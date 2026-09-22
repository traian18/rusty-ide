import packageMetadata from "../../package.json";

export interface OnboardingRelease {
  id: string;
  label: string;
  appVersion: string;
  description: string;
}

/**
 * Onboarding content is release-aware. Add future guide editions here, then
 * update CURRENT_ONBOARDING_RELEASE_ID when the matching app version ships.
 */
export const ONBOARDING_RELEASES = {
  developer_preview: {
    id: "developer_preview",
    label: "Developer Preview",
    appVersion: packageMetadata.version,
    description: "An early guide to Rusty's context-driven development workflow.",
  },
} as const satisfies Record<string, OnboardingRelease>;

export type OnboardingReleaseId = keyof typeof ONBOARDING_RELEASES;

export const CURRENT_ONBOARDING_RELEASE_ID: OnboardingReleaseId = "developer_preview";
export const CURRENT_ONBOARDING_RELEASE = ONBOARDING_RELEASES[CURRENT_ONBOARDING_RELEASE_ID];
