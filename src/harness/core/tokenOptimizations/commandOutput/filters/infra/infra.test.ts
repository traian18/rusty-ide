import { describe, expect, it } from "vitest";
import { toInvocation } from "../../invocation";
import { dockerFilter } from "./docker";
import { ghFilter } from "./gh";
import { kubectlFilter } from "./kubectl";
import { terraformFilter } from "./terraform";

describe("docker", () => {
  it("drops the COMMAND and CREATED columns of docker ps and re-aligns the rest", () => {
    const ps = [
      "CONTAINER ID   IMAGE         COMMAND                  CREATED       STATUS       PORTS                    NAMES",
      'f1e2d3c4b5a6   postgres:16   "docker-entrypoint.s…"   2 hours ago   Up 2 hours   0.0.0.0:5432->5432/tcp   db',
      'a6b5c4d3e2f1   redis:7       "redis-server"           3 days ago    Up 3 days    6379/tcp                 cache',
    ].join("\n");
    expect(dockerFilter.apply(ps, toInvocation("docker", ["ps"], 0))!.split("\n")).toEqual([
      "CONTAINER ID   IMAGE         STATUS       PORTS                    NAMES",
      "f1e2d3c4b5a6   postgres:16   Up 2 hours   0.0.0.0:5432->5432/tcp   db",
      "a6b5c4d3e2f1   redis:7       Up 3 days    6379/tcp                 cache",
    ]);
    expect(dockerFilter.apply(ps, toInvocation("docker", ["ps", "--format", "{{.Names}}"], 0))).toBeUndefined();
  });

  it("drops BuildKit transfer and cache lines and keeps steps and errors", () => {
    const build = "#1 [internal] load build definition from Dockerfile\n#1 DONE 0.0s\n#5 [2/4] RUN npm ci\n#5 CACHED\n#6 [3/4] RUN npm run build\n#6 2.10 Error: missing script\n#6 ERROR: process did not complete successfully";
    expect(dockerFilter.apply(build, toInvocation("docker", ["build", "."], 1))).toBe("#5 [2/4] RUN npm ci\n#6 [3/4] RUN npm run build\n#6 2.10 Error: missing script\n#6 ERROR: process did not complete successfully");
  });

  it("drops layer progress from pulls, compose included", () => {
    const pull = "16: Pulling from library/postgres\na2318d6c47ec: Pulling fs layer\na2318d6c47ec: Pull complete\nDigest: sha256:abc\nStatus: Downloaded newer image for postgres:16";
    expect(dockerFilter.apply(pull, toInvocation("docker", ["compose", "-f", "dev.yml", "pull"], 0))).toBe("16: Pulling from library/postgres\nDigest: sha256:abc\nStatus: Downloaded newer image for postgres:16");
  });
});

describe("kubectl", () => {
  it("drops managedFields and the last-applied annotation from YAML", () => {
    const yaml = [
      "apiVersion: v1",
      "kind: Pod",
      "metadata:",
      "  annotations:",
      "    kubectl.kubernetes.io/last-applied-configuration: |",
      '      {"apiVersion":"v1"}',
      "    team: web",
      "  managedFields:",
      "  - apiVersion: v1",
      "    fieldsType: FieldsV1",
      "  name: web",
      "spec: {}",
    ].join("\n");
    expect(kubectlFilter.apply(yaml, toInvocation("kubectl", ["get", "pod", "web", "-o", "yaml"], 0))).toBe("apiVersion: v1\nkind: Pod\nmetadata:\n  annotations:\n    team: web\n  name: web\nspec: {}");
  });

  it("drops the same from JSON and <none> fields from describe", () => {
    const json = JSON.stringify({ metadata: { name: "web", managedFields: [{ manager: "kubectl" }] } });
    expect(JSON.parse(kubectlFilter.apply(json, toInvocation("kubectl", ["get", "pod", "-ojson"], 0))!)).toEqual({ metadata: { name: "web" } });
    expect(kubectlFilter.apply("Name:         web\nLabels:       <none>\nStatus:       Running", toInvocation("kubectl", ["describe", "pod", "web"], 0))).toBe("Name:         web\nStatus:       Running");
  });
});

describe("terraform", () => {
  it("keeps a plan's changes and summary and drops refresh, legend and advice", () => {
    const plan = [
      "aws_vpc.main: Refreshing state... [id=vpc-123]",
      "data.aws_ami.ubuntu: Reading...",
      "data.aws_ami.ubuntu: Read complete after 1s [id=ami-1]",
      "",
      "Terraform used the selected providers to generate the following execution",
      "plan. Resource actions are indicated with the following symbols:",
      "  + create",
      "",
      "Terraform will perform the following actions:",
      "",
      '  # aws_instance.web will be created',
      '  + resource "aws_instance" "web" {',
      "      # (3 unchanged attributes hidden)",
      "    }",
      "",
      "Plan: 1 to add, 0 to change, 0 to destroy.",
      "",
      "Note: You didn't use the -out option to save this plan, so Terraform can't",
      "guarantee to take exactly these actions if you run \"terraform apply\" now.",
    ].join("\n");
    const out = terraformFilter.apply(plan, toInvocation("tofu", ["plan"], 0))!;
    expect(out.split("\n").filter(Boolean)).toEqual([
      "Terraform will perform the following actions:",
      '  # aws_instance.web will be created',
      '  + resource "aws_instance" "web" {',
      "    }",
      "Plan: 1 to add, 0 to change, 0 to destroy.",
    ]);
  });
});

describe("gh", () => {
  it("drops PR template comments and badges from a view and timestamps from run logs", () => {
    const view = "title:\tFix login\n--\n<!-- Describe your change -->\n[![CI](https://x/badge.svg)](https://x)\nFixes the expiry check.";
    expect(ghFilter.apply(view, toInvocation("gh", ["pr", "view", "12"], 0))).toBe("title:\tFix login\n--\n\nFixes the expiry check.");
    const log = "build\tRun tests\t2026-10-30T12:00:01.1234567Z ##[group]Run npm test\nbuild\tRun tests\t2026-10-30T12:00:02.1234567Z FAIL src/a.test.ts\nbuild\tRun tests\t2026-10-30T12:00:03.0000000Z ##[endgroup]";
    expect(ghFilter.apply(log, toInvocation("gh", ["run", "view", "99", "--log-failed"], 0))).toBe("build\tRun tests\t##[group]Run npm test\nbuild\tRun tests\tFAIL src/a.test.ts");
    expect(ghFilter.matches(toInvocation("gh", ["pr", "view", "--json", "title"], 0))).toBe(false);
  });
});
