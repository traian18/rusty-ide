// ============================================================
// McpIntegrationModal.tsx — MCP server configuration form
//
// Orchestrator component: sets up react-hook-form, wires the
// connection-test hook, and composes extracted sub-sections.
// All complex logic lives in dedicated helper files.
// ============================================================

import React from "react";
import { useForm, FormProvider } from "react-hook-form";
import type { McpFormValues, McpIntegrationModalProps } from "./types";
import { Plug } from "lucide-react";
import { Modal } from "../ui/Modal/Modal";
import { Button } from "../ui/Button/Button";
import { toFormValues, handleFormSubmit } from "./form-utils";
import { useConnectionTest } from "./connection-test";
import {
  IdentitySection,
  TransportSection,
  AuthSection,
  EnvironmentSection,
  AdvancedSection,
  TestConnectionSection,
} from "./form-sections";
import styles from "./McpIntegrationModal.module.css";

/**
 * Modal form for adding or editing an MCP server configuration.
 *
 * Uses react-hook-form with FormProvider to share form state with
 * extracted section sub-components. All complex handler logic is
 * defined in dedicated helper files — the component itself simply
 * wires hooks and composes UI sections.
 */
export const McpIntegrationModal: React.FC<McpIntegrationModalProps> = ({
  initialConfig,
  existingNames,
  onSave,
  onCancel,
}) => {
  const form = useForm<McpFormValues>({
    defaultValues: toFormValues(initialConfig),
    mode: "onBlur",
  });

  const { handleSubmit, watch } = form;
  const { test, handleTest } = useConnectionTest(watch);

  const title = initialConfig ? "Edit MCP Server" : "Add MCP Server";
  const description = initialConfig
    ? `Editing: ${initialConfig.displayName || initialConfig.name}`
    : "Configure a Model Context Protocol server";

  const handleSave = handleSubmit((values) => handleFormSubmit(values, onSave));

  return (
    <FormProvider {...form}>
      <Modal
        id="mcp-integration"
        title={title}
        description={description}
        icon={Plug}
        onClose={onCancel}
        size="lg"
        scrollableBody
        footer={
          <>
            <Button
              id="mcp-cancel"
              type="button"
              variant="secondary"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              id="mcp-save"
              type="button"
              variant="primary"
              onClick={handleSave}
            >
              Save
            </Button>
          </>
        }
      >
        <form id="mcp-integration-form" onSubmit={handleSave}>
          <div className={styles.body}>
            <IdentitySection
              existingNames={existingNames}
              currentName={initialConfig?.name}
            />
            <TransportSection />
            <AuthSection />
            <EnvironmentSection />
            <AdvancedSection />
            <TestConnectionSection test={test} onTest={handleTest} />
          </div>
        </form>
      </Modal>
    </FormProvider>
  );
};
