import React, { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, ShieldAlert } from "lucide-react";
import { Modal } from "./ui/Modal/Modal";
import { Button } from "./ui/Button/Button";
import { Callout } from "./ui/Callout/Callout";
import {
  loadHasAcceptedDisclaimer,
  saveHasAcceptedDisclaimer,
} from "../preferences/disclaimer";
import styles from "./DisclaimerModal.module.css";

export const DisclaimerModal: React.FC = () => {
  const [open, setOpen] = useState<boolean>(() => !loadHasAcceptedDisclaimer());
  const [showDetails, setShowDetails] = useState<boolean>(false);

  if (!open) return null;

  const handleAccept = () => {
    saveHasAcceptedDisclaimer(true);
    setOpen(false);
  };

  return (
    <Modal
      id="disclaimer-modal"
      title="AI ADVISORY & LIABILITY DISCLAIMER"
      icon={ShieldAlert}
      onClose={() => {}}
      size={showDetails ? "lg" : "md"}
      closeOnEscape={false}
      closeOnBackdrop={false}
      showCloseButton={false}
      scrollableBody={true}
      footer={
        <>
          <Button
            id="disclaimer-toggle-details"
            type="button"
            variant="secondary"
            icon={showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            onClick={() => setShowDetails((prev) => !prev)}
          >
            {showDetails ? "Hide Legal Details" : "View Legal Details"}
          </Button>
          <Button
            id="disclaimer-accept-button"
            type="button"
            variant="primary"
            onClick={handleAccept}
          >
            I Understand & Agree
          </Button>
        </>
      }
    >
      <div className={styles.container}>
        <Callout variant="warning" icon={<AlertTriangle size={16} />}>
          <div className={styles.calloutInner}>
            <div className={styles.calloutTitle}>IMPORTANT NOTICE ON AI GENERATION</div>
            <p className={styles.calloutText}>
              Artificial intelligence models and autonomous agents generate outputs probabilistically
              and <strong>can make mistakes, hallucinate, or produce broken or insecure code and commands</strong>.
            </p>
            <ul className={styles.calloutList}>
              <li>
                <strong>Verify all results:</strong> You are solely responsible for inspecting, testing,
                and validating all generated code, edits, terminal commands, and git operations prior to execution.
              </li>
              <li>
                <strong>No liability:</strong> The software, its developers, and contributors assume no liability
                for any errors, data loss, repository corruption, or unintended consequences resulting from model actions.
              </li>
            </ul>
          </div>
        </Callout>

        <p className={styles.summaryText}>
          By clicking &ldquo;I Understand &amp; Agree&rdquo;, you confirm your acknowledgment of these model limitations,
          agree to verify all generated outputs, and accept that this software is provided &ldquo;AS IS&rdquo; without liability.
        </p>

        {showDetails && (
          <div
            id="disclaimer-legal-box"
            className={styles.legalBox}
            tabIndex={0}
            role="region"
            aria-label="Full Legal Terms & Disclaimer"
          >
            <div className={styles.legalSection}>
              <h4 className={styles.legalHeading}>1. Nature of Generative AI &amp; Probabilistic Output</h4>
              <p className={styles.legalParagraph}>
                The application interfaces with large language models (&ldquo;LLMs&rdquo;) and autonomous agent runtimes.
                The user acknowledges and agrees that generative AI models operate on statistical probabilities rather than
                deterministic fact. Outputs may contain inaccuracies, syntax failures, subtle logical bugs, or security
                vulnerabilities (&ldquo;Hallucinations&rdquo;). The software does not guarantee the fitness, safety, or
                correctness of any model-generated recommendation.
              </p>
            </div>

            <div className={styles.legalSection}>
              <h4 className={styles.legalHeading}>2. Mandatory User Verification &amp; Duty of Care</h4>
              <p className={styles.legalParagraph}>
                The user maintains exclusive operational authority and duty of care over all workspace environments.
                The user agrees to independently audit, review, and validate all source code suggestions, patch diffs,
                terminal commands, system calls, and file system mutations before executing, compiling, committing, or deploying
                them in development, staging, or production environments.
              </p>
            </div>

            <div className={styles.legalSection}>
              <h4 className={styles.legalHeading}>3. Absolute Disclaimer of Warranties (&ldquo;AS IS&rdquo;)</h4>
              <p className={styles.legalParagraph}>
                TO THE MAXIMUM EXTENT PERMITTED UNDER APPLICABLE JURISDICTIONAL LAW, THE SOFTWARE, ACCOMPANYING DOCUMENTATION,
                AND AI INTEGRATIONS ARE PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTY OF ANY KIND,
                WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE. THE AUTHORS AND CONTRIBUTORS DISCLAIM ALL IMPLIED WARRANTIES,
                INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.
              </p>
            </div>

            <div className={styles.legalSection}>
              <h4 className={styles.legalHeading}>4. Comprehensive Limitation of Liability</h4>
              <p className={styles.legalParagraph}>
                IN NO EVENT SHALL THE AUTHORS, COPYRIGHT HOLDERS, CONTRIBUTORS, OR AFFILIATED ENTITIES BE LIABLE FOR ANY DIRECT,
                INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, PUNITIVE, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
                LOSS OF USE, WORKSPACE CORRUPTION, LOSS OF DATA, REPOSITORY CORRUPTION, HARDWARE DAMAGE, SYSTEM OUTAGES,
                OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND UNDER ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
                OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING FROM THE USE OF THIS SOFTWARE OR RELIANCE UPON AI MODEL RESPONSES,
                EVEN IF ADVISED OF THE POSSIBILITY OF SUCH INJURY.
              </p>
            </div>

            <div className={styles.legalSection}>
              <h4 className={styles.legalHeading}>5. Third-Party Model Providers &amp; Credentials</h4>
              <p className={styles.legalParagraph}>
                API integrations, local agent runtimes, and model providers (such as Anthropic, OpenAI, local Ollama endpoints,
                or others) are third-party services subject to their own separate terms of service, acceptable use policies,
                and pricing structures. This application does not warrant the continuous uptime, data confidentiality,
                or model behavior of any external third-party infrastructure.
              </p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
