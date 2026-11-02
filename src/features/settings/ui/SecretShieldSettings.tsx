import React from "react";
import { useWorkspaceStore } from "../../../store";
import { SECRET_SHIELD_DEFAULT_POLICY, SECRET_SHIELD_POLICIES, type SecretShieldPolicy } from "../service/secretShield";
import { CustomSelect } from "../../../lib/ui/CustomSelect";
import styles from "./SecretShieldSettings.module.css";

const POLICY_LABELS: Record<SecretShieldPolicy, string> = {
  off: "Off — send requests unchanged",
  warn: "Warn — log a warning, then send unchanged",
  mask: "Mask — replace matches with [REDACTED]",
  block: "Block — do not send requests with matches",
};

export const SecretShieldSettings: React.FC = () => {
  const policy = useWorkspaceStore((state) => state.secretShieldPolicy);
  const setPolicy = useWorkspaceStore((state) => state.setSecretShieldPolicy);

  return (
    <section aria-labelledby="secret-shield-heading" className={styles.settings}>
      <div className={styles.header}>
        <div>
          <p className={styles.kicker}>LOCAL REQUEST PROTECTION</p>
          <h3 id="secret-shield-heading">Secret Shield</h3>
        </div>
      </div>
      <p className={styles.description}>
        Scans outbound text and structured tool data for credential patterns before a model receives the request.
        Detection is local and pattern-based; it can miss secrets or match ordinary text. Image contents are not scanned.
      </p>
      <label className={styles.label} htmlFor="secret-shield-policy">Handling policy</label>
      <CustomSelect
        id="secret-shield-policy"
        value={policy}
        onChange={(value) => setPolicy(value as SecretShieldPolicy)}
        options={SECRET_SHIELD_POLICIES.map((option) => ({
          id: option,
          name: POLICY_LABELS[option],
        }))}
      />
      <p className={styles.note}>
        Default: {POLICY_LABELS[SECRET_SHIELD_DEFAULT_POLICY]}. This setting only controls outbound model requests;
        it does not redact local history or diagnostics.
      </p>
    </section>
  );
};
