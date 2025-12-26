#!/usr/bin/env node

import { Command } from "commander";
import fetch, { Response } from "node-fetch";
import chalk from "chalk";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import * as packageJson from "../package.json";
import {
  buildCoverageDetailsUrl,
  ComponentTreeResponse,
  extractCoverageFileDetails,
} from "./coverage-utils";
import { parseMeasureNumber } from "./measure-utils";

interface SonarConfig {
  projectKey: string;
  organization: string;
  token: string;
}

interface GitHubConfig {
  owner: string;
  repo: string;
  token?: string;
}

interface GitHubPullRequest {
  number: number;
  title: string;
  head: {
    ref: string;
  };
}

interface QualityGateResponse {
  projectStatus: {
    status: string;
    conditions: Array<{
      status: string;
      metricKey: string;
      actualValue: string;
      comparator: string;
      errorThreshold: string;
    }>;
  };
}

interface IssuesResponse {
  total: number;
  effortTotal: number;
  debtTotal: number;
  issues: Array<{
    key: string;
    rule: string;
    severity: string;
    type?: string;
    component: string;
    line?: number;
    message: string;
    effort?: string;
    debt?: string;
    tags: string[];
    creationDate?: string;
    updateDate?: string;
  }>;
}

interface HotspotsResponse {
  paging: {
    total: number;
  };
  hotspots: Array<{
    key: string;
    ruleKey: string;
    securityCategory: string;
    vulnerabilityProbability: string;
    status: string;
    component: string;
    line?: number;
    message: string;
  }>;
}

interface MeasuresResponse {
  component: {
    measures: Array<{
      metric: string;
      value?: string;
      periods?: Array<{
        value: string;
      }>;
    }>;
  };
}

interface JsonMeta {
  projectKey: string;
  organization: string;
  branch?: string | null;
  pullRequest?: string | null;
  generatedAt: string;
}

interface JsonIssue {
  key: string;
  rule: string;
  severity: string;
  type: string | null;
  component: string;
  filePath: string;
  line: number | null;
  message: string;
  effort: string | null;
  debt: string | null;
  tags: string[];
  creationDate: string | null;
  updateDate: string | null;
}

interface JsonQualityGate {
  status: string;
  conditions: Array<{
    status: string;
    metricKey: string;
    actualValue: string;
    comparator: string;
    errorThreshold: string;
  }>;
}

interface JsonSecurityHotspot {
  key: string;
  ruleKey: string;
  securityCategory: string;
  vulnerabilityProbability: string;
  status: string;
  component: string;
  filePath: string;
  line: number | null;
  message: string;
}

interface JsonIssuesSummary {
  total: number;
  effortTotal: number;
  debtTotal: number;
}

interface JsonPrOutput {
  meta: JsonMeta;
  qualityGate: JsonQualityGate;
  issues: JsonIssue[];
  issuesSummary: JsonIssuesSummary;
  securityHotspots: {
    total: number;
    hotspots: JsonSecurityHotspot[];
  };
  duplication: Record<string, number | null>;
  metrics: Record<string, number | null>;
}

interface JsonMetricsOutput {
  meta: JsonMeta;
  metrics: Record<string, number | null>;
}

interface JsonIssuesOutput {
  meta: JsonMeta;
  issues: JsonIssue[];
  issuesSummary: JsonIssuesSummary;
}

interface JsonError {
  error: {
    message: string;
    statusCode: number | null;
    details: unknown;
  };
}

class ApiError extends Error {
  statusCode?: number;
  details?: unknown;

  constructor(message: string, statusCode?: number, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

type Severity = "BLOCKER" | "CRITICAL" | "MAJOR" | "MINOR" | "INFO";

class SonarCloudFeedback {
  private static readonly MAX_DETAILED_ISSUES = 20;
  private static readonly MAX_COVERAGE_DETAIL_FILES = 10;
  private static readonly COMPONENT_TREE_PAGE_SIZE = 500; // Fetch enough files to sort by uncovered lines even though we display top 10
  private static readonly SEVERITY_ORDER: readonly Severity[] = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"] as const;
  private readonly sonarConfig: SonarConfig;
  private readonly githubConfig: GitHubConfig;
  private readonly jsonMode: boolean;
  private readonly outputPath?: string;
  private currentBranch?: string;

  private log(...args: unknown[]): void {
    if (this.jsonMode) return;
    this.log(...args);
  }

  private warn(...args: unknown[]): void {
    if (this.jsonMode) return;
    this.warn(...args);
  }

  private error(...args: unknown[]): void {
    if (this.jsonMode) return;
    this.error(...args);
  }

  private isDebugMode(): boolean {
    return process.env.DEBUG === 'true' || process.env.NODE_ENV === 'debug';
  }

  private maskSensitiveInfo(value: string): string {
    if (value.length <= 6) {
      return value.substring(0, 1) + '***';
    }
    return value.substring(0, value.length - 3) + '***';
  }

  private debugLog(message: string): void {
    if (!this.isDebugMode()) {
      return;
    }
    this.log(chalk.gray(message));
  }

  private getSonarAuthHeader(): { Authorization: string } {
    const basicToken = Buffer.from(this.sonarConfig.token + ":", "utf8").toString("base64");
    return {
      Authorization: "Basic " + basicToken,
    };
  }

  private maskUrlSensitiveInfo(url: string): string {
    // Mask project key and organization in URLs while keeping the structure visible
    let maskedUrl = url;
    if (this.sonarConfig.projectKey) {
      maskedUrl = maskedUrl.replace(
        this.sonarConfig.projectKey,
        this.maskSensitiveInfo(this.sonarConfig.projectKey)
      );
    }
    if (this.sonarConfig.organization) {
      maskedUrl = maskedUrl.replace(
        this.sonarConfig.organization,
        this.maskSensitiveInfo(this.sonarConfig.organization)
      );
    }
    return maskedUrl;
  }

  private logApiUrl(apiName: string, url: string): void {
    this.debugLog(`\n[DEBUG] ${apiName} API URL: ${this.maskUrlSensitiveInfo(url)}`);
  }

  private static resolveGitPath(): string {
    const candidates = [
      "/usr/bin/git",
      "/usr/local/bin/git",
      "/opt/homebrew/bin/git",
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    return found ?? "git";
  }

  static getBuildId(): string {
    const repoRoot = path.resolve(__dirname, "..");
    try {
      const gitPath = this.resolveGitPath();
      return execFileSync(gitPath, ["-C", repoRoot, "rev-parse", "--short", "HEAD"], {
        encoding: "utf-8",
      }).trim(); // NOSONAR
    } catch {
      return "unknown";
    }
  }

  private logErrorResponse(response: Response, bodyText?: string): void {
    if (!this.isDebugMode()) {
      return;
    }
    this.debugLog(`\n[DEBUG] Response Status: ${response.status} ${response.statusText}`);
    if (bodyText !== undefined) {
      this.debugLog(`[DEBUG] Response Body: ${bodyText}`);
    }
  }

  private async fetchJson<T>(
    url: string,
    headers: Record<string, string>,
    errorLabel: string
  ): Promise<T> {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      let bodyText = "";
      try {
        bodyText = await response.text();
      } catch {
        bodyText = "";
      }
      this.logErrorResponse(response, bodyText || undefined);
      let details: unknown = bodyText || null;
      if (bodyText) {
        try {
          details = JSON.parse(bodyText);
        } catch {
          details = bodyText;
        }
      }
      throw new ApiError(`${errorLabel} API returned ${response.status}`, response.status, details);
    }
    return response.json() as Promise<T>;
  }

  private writeJson(data: unknown): void {
    const json = `${JSON.stringify(data)}\n`;
    if (this.outputPath) {
      fs.writeFileSync(this.outputPath, json, "utf-8");
    }
    process.stdout.write(json);
  }

  private writeJsonSafely(data: unknown): void {
    const json = `${JSON.stringify(data)}\n`;
    if (this.outputPath) {
      try {
        fs.writeFileSync(this.outputPath, json, "utf-8");
      } catch {
        // Ignore write errors when already handling failure.
      }
    }
    process.stdout.write(json);
  }

  private toJsonError(error: unknown): JsonError {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = error instanceof ApiError ? error.statusCode ?? null : null;
    const details = error instanceof ApiError ? error.details ?? null : null;
    return {
      error: {
        message,
        statusCode,
        details,
      },
    };
  }

  private buildMeta(params: { branch?: string | null; pullRequest?: string | null }): JsonMeta {
    return {
      projectKey: this.sonarConfig.projectKey,
      organization: this.sonarConfig.organization,
      branch: params.branch ?? null,
      pullRequest: params.pullRequest ?? null,
      generatedAt: new Date().toISOString(),
    };
  }

  private getFilePath(component: string): string {
    const prefix = `${this.sonarConfig.projectKey}:`;
    return component.startsWith(prefix) ? component.slice(prefix.length) : component;
  }

  private toJsonIssue(issue: IssuesResponse["issues"][number]): JsonIssue {
    return {
      key: issue.key,
      rule: issue.rule,
      severity: issue.severity,
      type: issue.type ?? null,
      component: issue.component,
      filePath: this.getFilePath(issue.component),
      line: issue.line ?? null,
      message: issue.message,
      effort: issue.effort ?? null,
      debt: issue.debt ?? null,
      tags: issue.tags ?? [],
      creationDate: issue.creationDate ?? null,
      updateDate: issue.updateDate ?? null,
    };
  }

  private buildMetricsMap(metrics: string[], measures: MeasuresResponse["component"]["measures"]): Record<string, number | null> {
    const result: Record<string, number | null> = {};
    metrics.forEach((metric) => {
      const value = parseMeasureNumber(measures, metric);
      result[metric] = value ?? null;
    });
    return result;
  }

  private handleError(error: unknown): void {
    if (this.jsonMode) {
      this.writeJsonSafely(this.toJsonError(error));
    } else {
      this.error(
        chalk.red("\nError:"),
        error instanceof Error ? error.message : String(error)
      );
    }
    process.exit(1);
  }

  constructor(options?: { json?: boolean; output?: string }) {
    this.jsonMode = Boolean(options?.json || options?.output);
    this.outputPath = options?.output;
    // Validate required environment variables
    const projectKey = process.env.SONAR_PROJECT_KEY;
    const organization = process.env.SONAR_ORGANIZATION;
    const token = process.env.SONAR_TOKEN;

    const missingVars = [];
    if (!projectKey) missingVars.push("SONAR_PROJECT_KEY");
    if (!organization) missingVars.push("SONAR_ORGANIZATION");
    if (!token) missingVars.push("SONAR_TOKEN");

    if (missingVars.length > 0) {
      const message = `Missing required environment variables: ${missingVars.join(", ")}`;
      if (this.jsonMode) {
        throw new ApiError(message, undefined, { missing: missingVars });
      }
      this.error(chalk.red("Error: Missing required environment variables:"));
      missingVars.forEach((varName) => {
        this.error(chalk.red(`  - ${varName}`));
      });
      this.error(
        chalk.yellow(
          "\nPlease set these environment variables before running the tool:"
        )
      );
      missingVars.forEach((varName) => {
        this.error(chalk.yellow(`  export ${varName}="your-value"`));
      });
      process.exit(1);
    }

    this.sonarConfig = {
      projectKey: projectKey!,
      organization: organization!,
      token: token!,
    };

    this.githubConfig = this.getGitHubConfig();
  }

  private getGitHubConfig(): GitHubConfig {
    try {
      const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
        encoding: "utf-8",
      }).trim(); // NOSONAR
      const host = "github.com";
      const hostIndex = remoteUrl.indexOf(host);
      if (hostIndex === -1) {
        throw new Error(
          "Could not parse GitHub repository information from remote URL"
        );
      }
      let remainder = remoteUrl.slice(hostIndex + host.length);
      if (remainder.startsWith(":")) remainder = remainder.slice(1);
      if (remainder.startsWith("/")) remainder = remainder.slice(1);
      const parts = remainder.split("/");
      if (parts.length < 2) {
        throw new Error(
          "Could not parse GitHub repository information from remote URL"
        );
      }
      const owner = parts[0];
      let repo = parts[1];
      if (repo.endsWith(".git")) repo = repo.slice(0, -4);

      return {
        owner,
        repo,
        token: this.getGitHubToken(),
      };
    } catch (error) {
      this.error(chalk.red("Failed to get GitHub repository information"));
      throw error;
    }
  }

  private getGitHubToken(): string | undefined {
    const isProduction = process.env.NODE_ENV === "production";

    if (process.env.GITHUB_TOKEN) {
      if (!isProduction) {
        this.log(chalk.gray("Using GITHUB_TOKEN from environment variable"));
      }
      return process.env.GITHUB_TOKEN;
    }

    try {
      const token = execFileSync("gh", ["auth", "token"], {
        encoding: "utf-8",
      }).trim(); // NOSONAR
      if (token) {
        if (!isProduction) {
          this.log(chalk.gray("Using token from gh auth"));
        }
        return token;
      }
    } catch (error) {
      this.warn(
        chalk.yellow(
          "Could not get token from gh auth; proceeding without GitHub token"
        ),
        error instanceof Error ? error.message : String(error)
      );
    }

    return undefined;
  }

  private async getPullRequestId(prId?: string): Promise<string> {
    if (prId) {
      return prId;
    }

    this.log(
      chalk.blue(
        "Pull request number not specified. Attempting to auto-detect..."
      )
    );

    try {
      const currentBranch = execFileSync(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { encoding: "utf-8" }
      ).trim(); // NOSONAR
      this.currentBranch = currentBranch;
      this.log(chalk.gray(`Current branch: ${currentBranch}`));

      if (!this.githubConfig.token) {
        throw new Error(
          "GitHub token is required for auto-detection. Set GITHUB_TOKEN or authenticate with gh auth login"
        );
      }

      const apiUrl = `https://api.github.com/repos/${this.githubConfig.owner}/${this.githubConfig.repo}/pulls?state=open&head=${this.githubConfig.owner}:${currentBranch}`;

      let pulls: GitHubPullRequest[];
      if (this.jsonMode) {
        pulls = await this.fetchJson<GitHubPullRequest[]>(
          apiUrl,
          {
            Authorization: `token ${this.githubConfig.token}`,
            Accept: "application/vnd.github.v3+json",
          },
          "GitHub API"
        );
      } else {
        const response = await fetch(apiUrl, {
          headers: {
            Authorization: `token ${this.githubConfig.token}`,
            Accept: "application/vnd.github.v3+json",
          },
        });

        if (!response.ok) {
          const isProduction = process.env.NODE_ENV === "production";
          const errorMessage = isProduction
            ? "GitHub API request failed"
            : `GitHub API returned ${response.status}: ${response.statusText}`;
          throw new Error(errorMessage);
        }

        pulls = (await response.json()) as GitHubPullRequest[];
      }

      if (pulls.length === 0) {
        throw new Error(
          `No open pull request found for branch "${currentBranch}"`
        );
      }

      const prNumber = pulls[0].number;
      this.log(chalk.green(`Found pull request #${prNumber}`));

      return prNumber.toString();
    } catch (error) {
      this.error(chalk.red("Failed to auto-detect pull request"));
      throw error;
    }
  }

  private async fetchQualityGate(prId: string): Promise<JsonQualityGate> {
    this.log(chalk.bold("\n🎯 Quality Gate Status"));
    this.log("-".repeat(50));

    if (this.isDebugMode()) {
      this.debugLog("\n[DEBUG] SonarCloud Configuration:");
      this.debugLog(`  Project Key: ${this.maskSensitiveInfo(this.sonarConfig.projectKey)}`);
      this.debugLog(`  Organization: ${this.maskSensitiveInfo(this.sonarConfig.organization)}`);
      this.debugLog(`  Pull Request: ${prId}`);
    }

    const url = `https://sonarcloud.io/api/qualitygates/project_status?projectKey=${this.sonarConfig.projectKey}&pullRequest=${prId}`;
    this.logApiUrl("Quality Gate", url);

    const data = await this.fetchJson<QualityGateResponse>(
      url,
      this.getSonarAuthHeader(),
      "Quality Gate"
    );
    const status = data.projectStatus.status;

    this.log(
      `Overall Status: ${status === "OK" ? chalk.green(status) : chalk.red(status)}`
    );

    if (status === "ERROR") {
      this.log(chalk.red("\n❌ Failed Conditions:"));
      data.projectStatus.conditions
        .filter((c) => c.status === "ERROR")
        .forEach((condition) => {
          const thresholdInfo = `${condition.comparator} ${condition.errorThreshold}`;
          this.log(
            `  • ${condition.metricKey}: ${condition.actualValue} (threshold: ${thresholdInfo})`
          );
        });
    }

    return {
      status,
      conditions: data.projectStatus.conditions,
    };
  }

  private async fetchIssues(prId: string): Promise<{ summary: JsonIssuesSummary; issues: JsonIssue[] }> {
    this.log(chalk.bold("\n🐛 Issues"));
    this.log("-".repeat(50));

    const url = `https://sonarcloud.io/api/issues/search?componentKeys=${this.sonarConfig.projectKey}&pullRequest=${prId}&organization=${this.sonarConfig.organization}&resolved=false&ps=500`;
    this.logApiUrl("Issues", url);

    const data = await this.fetchJson<IssuesResponse>(
      url,
      this.getSonarAuthHeader(),
      "Issues"
    );

    const summary: JsonIssuesSummary = {
      total: data.total,
      effortTotal: data.effortTotal || 0,
      debtTotal: data.debtTotal || 0,
    };

    this.log(`Total Issues: ${summary.total}`);
    this.log(`Effort Total: ${summary.effortTotal}`);
    this.log(`Debt Total: ${summary.debtTotal}`);

    if (data.total > 0) {
      this.displayGroupedIssues(data);
    } else {
      this.log(chalk.green("✅ No issues found."));
    }

    return {
      summary,
      issues: data.issues.map((issue) => this.toJsonIssue(issue)),
    };
  }

  private groupIssuesBySeverity(issues: IssuesResponse['issues']): Map<Severity, typeof issues> {
    const issuesBySeverity = new Map<Severity, typeof issues>();
    
    issues.forEach(issue => {
      const severity = this.normalizeSeverity(issue.severity);
      if (!issuesBySeverity.has(severity)) {
        issuesBySeverity.set(severity, []);
      }
      issuesBySeverity.get(severity)!.push(issue);
    });
    
    return issuesBySeverity;
  }

  private displayGroupedIssues(data: IssuesResponse): void {
    const issuesBySeverity = this.groupIssuesBySeverity(data.issues);

    for (const severity of SonarCloudFeedback.SEVERITY_ORDER) {
      const issues = issuesBySeverity.get(severity);
      if (!issues || issues.length === 0) continue;

      this.log(chalk.bold(`\n🔸 ${this.getSeverityColored(severity)} Issues:`));
      
      issues.forEach((issue) => {
        this.log(`Issue Key: ${issue.key}`);
        this.log(`Rule: ${issue.rule}`);
        this.log(`Severity: ${this.getSeverityColored(issue.severity)}`);
        const fileName = issue.component.replace(
          `${this.sonarConfig.projectKey}:`,
          ""
        );
        const tagsList = issue.tags.join(", ") || "";
        this.log(`File: ${fileName}`);
        this.log(`Line: ${issue.line || "N/A"}`);
        this.log(`Message: ${issue.message}`);
        this.log(`Effort: ${issue.effort || "0min"}`);
        this.log(`Debt: ${issue.debt || "0min"}`);
        this.log(`Tags: ${tagsList}`);
        this.log("-".repeat(50));
      });
    }
  }

  private async fetchSecurityHotspots(
    prId: string
  ): Promise<{ total: number; hotspots: JsonSecurityHotspot[] }> {
    this.log(chalk.bold("\n🔒 Security Hotspots"));
    this.log("-".repeat(50));

    const url = `https://sonarcloud.io/api/hotspots/search?projectKey=${this.sonarConfig.projectKey}&pullRequest=${prId}`;
    this.logApiUrl("Hotspots", url);

    const data = await this.fetchJson<HotspotsResponse>(
      url,
      this.getSonarAuthHeader(),
      "Hotspots"
    );

    this.log(`Total Security Hotspots: ${data.paging.total}`);

    if (data.paging.total > 0) {
      this.log("");
      data.hotspots.forEach((hotspot) => {
        this.log(`Hotspot Key: ${hotspot.key}`);
        this.log(`Rule: ${hotspot.ruleKey}`);
        this.log(`Security Category: ${hotspot.securityCategory}`);
        this.log(
          `Vulnerability Probability: ${this.getVulnerabilityColored(
            hotspot.vulnerabilityProbability
          )}`
        );
        this.log(`Status: ${hotspot.status}`);
        const fileName = this.getFilePath(hotspot.component);
        this.log(`File: ${fileName}`);
        this.log(`Line: ${hotspot.line || "N/A"}`);
        this.log(`Message: ${hotspot.message}`);
        this.log("-".repeat(50));
      });
    } else {
      this.log(chalk.green("✅ No security hotspots found."));
    }

    return {
      total: data.paging.total,
      hotspots: data.hotspots.map((hotspot) => ({
        key: hotspot.key,
        ruleKey: hotspot.ruleKey,
        securityCategory: hotspot.securityCategory,
        vulnerabilityProbability: hotspot.vulnerabilityProbability,
        status: hotspot.status,
        component: hotspot.component,
        filePath: this.getFilePath(hotspot.component),
        line: hotspot.line ?? null,
        message: hotspot.message,
      })),
    };
  }

  private async fetchDuplicationMetrics(prId: string): Promise<Record<string, number | null>> {
    this.log(chalk.bold("\n🔄 Code Duplication"));
    this.log("-".repeat(50));

    const metrics = [
      "new_duplicated_lines_density",
      "new_duplicated_lines",
      "new_duplicated_blocks",
    ];
    const url = `https://sonarcloud.io/api/measures/component?component=${this.sonarConfig.projectKey}&metricKeys=${metrics.join(",")}&pullRequest=${prId}`;
    this.logApiUrl("Duplication Metrics", url);

    const data = await this.fetchJson<MeasuresResponse>(
      url,
      this.getSonarAuthHeader(),
      "Measures"
    );

    data.component.measures.forEach((measure) => {
      const value = measure.periods?.[0]?.value ?? measure.value ?? "0";
      switch (measure.metric) {
        case "new_duplicated_lines_density":
          this.log(`Duplication Density: ${value}%`);
          break;
        case "new_duplicated_lines":
          this.log(`Duplicated Lines: ${value}`);
          break;
        case "new_duplicated_blocks":
          this.log(`Duplicated Blocks: ${value}`);
          break;
      }
    });

    return this.buildMetricsMap(metrics, data.component.measures);
  }

  private async fetchCoverageMetrics(prId: string): Promise<Record<string, number | null>> {
    this.log(chalk.bold("\n📊 Test Coverage"));
    this.log("-".repeat(50));

    const metrics = ["new_coverage", "new_lines_to_cover", "new_uncovered_lines"];
    const url = `https://sonarcloud.io/api/measures/component?component=${this.sonarConfig.projectKey}&metricKeys=${metrics.join(",")}&pullRequest=${prId}`;
    this.logApiUrl("Coverage Metrics", url);

    const data = await this.fetchJson<MeasuresResponse>(
      url,
      this.getSonarAuthHeader(),
      "Coverage"
    );

    let hasData = false;
    data.component.measures.forEach((measure) => {
      const value = measure.periods?.[0]?.value ?? measure.value;
      if (value !== undefined) {
        hasData = true;
        switch (measure.metric) {
          case "new_coverage":
            this.log(`Coverage: ${value}%`);
            break;
          case "new_lines_to_cover":
            this.log(`Lines to Cover: ${value}`);
            break;
          case "new_uncovered_lines":
            this.log(`Uncovered Lines: ${value}`);
            break;
        }
      }
    });

    if (!hasData) {
      this.log("Coverage data not available.");
    }

    if (!this.jsonMode) {
      await this.fetchCoverageDetails(prId);
    }

    return this.buildMetricsMap(metrics, data.component.measures);
  }

  private async fetchCoverageDetails(prId: string): Promise<void> {
    this.log(chalk.bold("\n🔍 Files Missing Coverage (New Code)"));
    this.log("-".repeat(50));

    const url = buildCoverageDetailsUrl(
      this.sonarConfig.projectKey,
      this.sonarConfig.organization,
      prId,
      SonarCloudFeedback.COMPONENT_TREE_PAGE_SIZE
    );
    this.logApiUrl("Coverage File Details", url);

    try {
      const response = await fetch(url, { headers: this.getSonarAuthHeader() });

      if (!response.ok) {
        const body = await response.text();
        this.logErrorResponse(response, body);
        throw new Error(`Coverage detail API returned ${response.status}: ${body}`);
      }

      const data = (await response.json()) as ComponentTreeResponse;
      const filesWithUncovered = extractCoverageFileDetails(
        data,
        this.sonarConfig.projectKey
      );

      if (filesWithUncovered.length === 0) {
        this.log(chalk.green("No files with uncovered lines were reported for new code."));
        return;
      }

      const limit = SonarCloudFeedback.MAX_COVERAGE_DETAIL_FILES;
      filesWithUncovered.slice(0, limit).forEach((file, index) => {
        const coverageText =
          file.coverage !== undefined && !Number.isNaN(file.coverage)
            ? `${file.coverage.toFixed(1)}%`
            : "N/A";
        const linesToCoverText =
          file.linesToCover !== undefined && !Number.isNaN(file.linesToCover)
            ? file.linesToCover.toString()
            : "N/A";

        this.log(`${index + 1}. ${file.path}`);
        this.log(
          `   Uncovered Lines: ${file.uncovered} / Lines to Cover: ${linesToCoverText} (New Coverage: ${coverageText})`
        );
      });

      if (filesWithUncovered.length > limit) {
        this.log(
          chalk.gray(
            `... and ${filesWithUncovered.length - limit} more files have uncovered lines`
          )
        );
      }
    } catch (error) {
      this.warn(
        chalk.yellow(
          `Failed to fetch coverage details: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
      this.warn(chalk.gray("DEBUG=true を付けて再実行するとレスポンス詳細が表示されます。"));
    }
  }

  private async fetchProjectMetrics(branch: string): Promise<Record<string, number | null>> {
    this.log(chalk.bold("\n📊 Project Metrics"));
    this.log("-".repeat(50));

    const metrics = [
      "bugs",
      "vulnerabilities",
      "code_smells",
      "coverage",
      "line_coverage",
      "duplicated_lines_density",
      "complexity",
      "cognitive_complexity",
      "reliability_rating",
      "security_rating",
      "sqale_rating",
      "ncloc",
      "sqale_index",
    ];

    const url = `https://sonarcloud.io/api/measures/component?component=${this.sonarConfig.projectKey}&metricKeys=${metrics.join(",")}&branch=${branch}`;
    this.logApiUrl("Project Metrics", url);

    const data = await this.fetchJson<MeasuresResponse>(
      url,
      this.getSonarAuthHeader(),
      "Project Metrics"
    );

    data.component.measures.forEach((measure) => {
      const value = measure.periods?.[0]?.value ?? measure.value ?? "0";
      switch (measure.metric) {
        case "bugs":
          this.log(`🐛 Bugs: ${value}`);
          break;
        case "vulnerabilities":
          this.log(`🔓 Vulnerabilities: ${value}`);
          break;
        case "code_smells":
          this.log(`💨 Code Smells: ${value}`);
          break;
        case "coverage":
          this.log(`📊 Coverage: ${value}%`);
          break;
        case "line_coverage":
          this.log(`📈 Line Coverage: ${value}%`);
          break;
        case "duplicated_lines_density":
          this.log(`🔄 Duplicated Lines Density: ${value}%`);
          break;
        case "complexity":
          this.log(`🎯 Cyclomatic Complexity: ${value}`);
          break;
        case "cognitive_complexity":
          this.log(`🧠 Cognitive Complexity: ${value}`);
          break;
        case "reliability_rating":
          this.log(`⚡ Reliability Rating: ${this.getRatingColored(value)}`);
          break;
        case "security_rating":
          this.log(`🔒 Security Rating: ${this.getRatingColored(value)}`);
          break;
        case "sqale_rating":
          this.log(
            `🏗️  Maintainability Rating: ${this.getRatingColored(value)}`
          );
          break;
        case "ncloc":
          this.log(`📄 Lines of Code: ${value}`);
          break;
        case "sqale_index": {
          const hours = Math.round(Number.parseInt(value, 10) / 60);
          const minutes = Number.parseInt(value, 10) % 60;
          this.log(`⏱️  Technical Debt: ${hours}h ${minutes}min`);
          break;
        }
      }
    });

    return this.buildMetricsMap(metrics, data.component.measures);
  }

  private async fetchOverallMetrics(): Promise<Record<string, number | null>> {
    const metrics = [
      "coverage",
      "ncloc",
      "complexity",
      "reliability_rating",
      "security_rating",
      "sqale_rating",
    ];
    const url = `https://sonarcloud.io/api/measures/component?component=${this.sonarConfig.projectKey}&metricKeys=${metrics.join(",")}`;
    this.logApiUrl("Overall Metrics", url);

    const data = await this.fetchJson<MeasuresResponse>(
      url,
      this.getSonarAuthHeader(),
      "Metrics"
    );

    return this.buildMetricsMap(metrics, data.component.measures);
  }

  private async fetchAllIssues(
    branch: string,
    maxToShow?: number
  ): Promise<void> {
    this.log(chalk.bold("\n🐛 All Issues"));
    this.log("-".repeat(50));

    const data = await this.fetchIssuesData(branch);
    this.displayIssuesSummary(data);

    if (data.total > 0) {
      this.displayIssuesBreakdown(data);
      this.displayDetailedIssues(data, maxToShow);
    } else {
      this.log(chalk.green("✅ No issues found."));
    }
  }

  private async fetchIssuesData(branch: string): Promise<IssuesResponse> {
    const url = `https://sonarcloud.io/api/issues/search?componentKeys=${this.sonarConfig.projectKey}&branch=${branch}&organization=${this.sonarConfig.organization}&resolved=false&ps=500`;
    this.logApiUrl("Issues", url);

    return this.fetchJson<IssuesResponse>(
      url,
      this.getSonarAuthHeader(),
      "Issues"
    );
  }

  private displayIssuesSummary(data: IssuesResponse): void {
    this.log(`Total Issues: ${data.total}`);
    this.log(`Effort Total: ${data.effortTotal || 0} minutes`);
    this.log(`Debt Total: ${data.debtTotal || 0} minutes`);
  }

  private displayIssuesBreakdown(data: IssuesResponse): void {
    this.log(chalk.bold("\n📋 Issue Breakdown by Severity:"));
    const severityCount = data.issues.reduce(
      (acc, issue) => {
        acc[issue.severity] = (acc[issue.severity] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    Object.entries(severityCount).forEach(([severity, count]) => {
      this.log(`  ${this.getSeverityColored(severity)}: ${count}`);
    });

    this.log(chalk.bold("\n📋 Issue Breakdown by Type:"));
    const typeCount = data.issues.reduce(
      (acc, issue) => {
        const rule = issue.rule.split(":")[1] || issue.rule;
        acc[rule] = (acc[rule] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    Object.entries(typeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([rule, count]) => {
        this.log(`  ${rule}: ${count}`);
      });
  }

  private displayDetailedIssues(
    data: IssuesResponse,
    maxToShow?: number
  ): void {
    const limit =
      typeof maxToShow === "number"
        ? maxToShow
        : SonarCloudFeedback.MAX_DETAILED_ISSUES;
    if (limit === 0) {
      return;
    }

    const showAll = limit >= data.total;
    const detailsHeader = showAll ? "all" : "first " + String(limit);
    this.log(chalk.bold(`\n📋 Detailed Issues (${detailsHeader}):`));

    const issuesBySeverity = this.groupIssuesBySeverity(data.issues);

    let totalDisplayed = 0;
    const targetLimit = showAll ? data.issues.length : limit;

    for (const severity of SonarCloudFeedback.SEVERITY_ORDER) {
      const issues = issuesBySeverity.get(severity);
      if (!issues || issues.length === 0) continue;
      if (totalDisplayed >= targetLimit) break;

      this.log(chalk.bold(`\n🔸 ${this.getSeverityColored(severity)} Issues:`));
      
      const remainingLimit = targetLimit - totalDisplayed;
      const issuesToShow = issues.slice(0, remainingLimit);
      
      issuesToShow.forEach((issue, index) => {
        const fileName = issue.component.replace(
          `${this.sonarConfig.projectKey}:`,
          ""
        );
        this.log(`\n${totalDisplayed + index + 1}. ${issue.message}`);
        this.log(`   File: ${fileName}`);
        this.log(`   Line: ${issue.line || "N/A"}`);
        this.log(`   Rule: ${issue.rule}`);
        if (issue.effort) {
          this.log(`   Effort: ${issue.effort}`);
        }
      });
      
      totalDisplayed += issuesToShow.length;
      
      if (issues.length > issuesToShow.length) {
        this.log(chalk.gray(`   ... and ${issues.length - issuesToShow.length} more ${severity} issues`));
      }
    }

    if (!showAll && data.total > limit) {
      this.log(chalk.yellow(`\n... and ${data.total - totalDisplayed} more issues (use --all to see all)`));
    }
  }

  private getRatingColored(rating: string): string {
    switch (rating) {
      case "1.0":
      case "1":
        return chalk.green("A");
      case "2.0":
      case "2":
        return chalk.yellow("B");
      case "3.0":
      case "3":
        return chalk.yellow("C");
      case "4.0":
      case "4":
        return chalk.red("D");
      case "5.0":
      case "5":
        return chalk.red("E");
      default:
        return rating;
    }
  }

  private getSeverityColored(severity: string): string {
    switch (severity.toUpperCase()) {
      case "BLOCKER":
        return chalk.red(severity);
      case "CRITICAL":
        return chalk.red(severity);
      case "MAJOR":
        return chalk.yellow(severity);
      case "MINOR":
        return chalk.blue(severity);
      case "INFO":
        return chalk.gray(severity);
      default:
        return severity;
    }
  }

  private normalizeSeverity(severity: string): Severity {
    const normalized = severity.toUpperCase() as Severity;
    if (!SonarCloudFeedback.SEVERITY_ORDER.includes(normalized)) {
      this.warn(chalk.yellow(`Unknown severity level: ${severity}, treating as INFO`));
      return "INFO";
    }
    return normalized;
  }

  private getVulnerabilityColored(probability: string): string {
    switch (probability.toUpperCase()) {
      case "HIGH":
        return chalk.red(probability);
      case "MEDIUM":
        return chalk.yellow(probability);
      case "LOW":
        return chalk.green(probability);
      default:
        return probability;
    }
  }

  public async runPrAnalysis(prId?: string): Promise<void> {
    try {
      if (this.isDebugMode()) {
        this.debugLog("\n[DEBUG] Starting PR Analysis");
        this.debugLog("  Set DEBUG=true or NODE_ENV=debug for debug output");
      }

      const pullRequestId = await this.getPullRequestId(prId);
      const branch = this.currentBranch ?? null;

      this.log(chalk.bold("\n=========================================="));
      this.log(chalk.bold(`SonarCloud Analysis for PR #${pullRequestId}`));
      this.log(chalk.bold("=========================================="));

      const qualityGate = await this.fetchQualityGate(pullRequestId);
      const issuesResult = await this.fetchIssues(pullRequestId);
      const hotspotsResult = await this.fetchSecurityHotspots(pullRequestId);
      const duplicationMetrics = await this.fetchDuplicationMetrics(pullRequestId);
      const coverageMetrics = await this.fetchCoverageMetrics(pullRequestId);
      const overallMetrics: Record<string, number | null> = this.jsonMode
        ? await this.fetchOverallMetrics()
        : {};

      if (this.jsonMode) {
        const output: JsonPrOutput = {
          meta: this.buildMeta({ branch, pullRequest: pullRequestId }),
          qualityGate,
          issues: issuesResult.issues,
          issuesSummary: issuesResult.summary,
          securityHotspots: hotspotsResult,
          duplication: duplicationMetrics,
          metrics: {
            ...overallMetrics,
            ...coverageMetrics,
          },
        };
        this.writeJson(output);
        return;
      }

      this.log(chalk.bold("\n=========================================="));
      this.log(chalk.bold("Analysis Complete"));
      this.log(chalk.bold("=========================================="));
    } catch (error) {
      this.handleError(error);
    }
  }

  public async runProjectMetrics(branch: string = "main"): Promise<void> {
    try {
      if (!this.sonarConfig.token) {
        throw new Error("SONAR_TOKEN environment variable is not set");
      }

      this.log(chalk.bold("\n=========================================="));
      this.log(chalk.bold(`Project Metrics for branch: ${branch}`));
      this.log(chalk.bold("=========================================="));

      const metrics = await this.fetchProjectMetrics(branch);

      if (this.jsonMode) {
        const output: JsonMetricsOutput = {
          meta: this.buildMeta({ branch }),
          metrics,
        };
        this.writeJson(output);
        return;
      }

      this.log(chalk.bold("\n=========================================="));
      this.log(chalk.bold("Metrics Complete"));
      this.log(chalk.bold("=========================================="));
    } catch (error) {
      this.handleError(error);
    }
  }

  public async runAllIssues(
    branch: string = "main",
    maxToShow?: number
  ): Promise<void> {
    try {
      if (!this.sonarConfig.token) {
        throw new Error("SONAR_TOKEN environment variable is not set");
      }

      this.log(chalk.bold("\n=========================================="));
      this.log(chalk.bold(`All Issues for branch: ${branch}`));
      this.log(chalk.bold("=========================================="));

      if (this.jsonMode) {
        const data = await this.fetchIssuesData(branch);
        const summary: JsonIssuesSummary = {
          total: data.total,
          effortTotal: data.effortTotal || 0,
          debtTotal: data.debtTotal || 0,
        };
        const output: JsonIssuesOutput = {
          meta: this.buildMeta({ branch }),
          issues: data.issues.map((issue) => this.toJsonIssue(issue)),
          issuesSummary: summary,
        };
        this.writeJson(output);
        return;
      }

      await this.fetchAllIssues(branch, maxToShow);

      this.log(chalk.bold("\n=========================================="));
      this.log(chalk.bold("Issues Complete"));
      this.log(chalk.bold("=========================================="));
    } catch (error) {
      this.handleError(error);
    }
  }
}

const emitJsonError = (error: unknown, outputPath?: string): void => {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = error instanceof ApiError ? error.statusCode ?? null : null;
  const details = error instanceof ApiError ? error.details ?? null : null;
  const payload: JsonError = {
    error: {
      message,
      statusCode,
      details,
    },
  };
  const json = `${JSON.stringify(payload)}\n`;
  if (outputPath) {
    try {
      fs.writeFileSync(outputPath, json, "utf-8");
    } catch {
      // Ignore write errors when already handling failure.
    }
  }
  process.stdout.write(json);
};

const program = new Command();

program
  .name("get-sonar-feedback")
  .description("Fetch SonarCloud feedback")
  .version(`${packageJson.version} (build ${SonarCloudFeedback.getBuildId()})`);

program
  .command("pr")
  .description("Analyze pull request")
  .argument(
    "[pr-number]",
    "Pull request number (optional, will auto-detect if not provided)"
  )
  .option("--json", "Output results as JSON")
  .option("--output <path>", "Write JSON output to a file (enables --json)")
  .action(async (prNumber: string | undefined, options: { json?: boolean; output?: string }) => {
    const jsonMode = Boolean(options.json || options.output);
    try {
      const feedback = new SonarCloudFeedback({
        json: options.json,
        output: options.output,
      });
      await feedback.runPrAnalysis(prNumber);
    } catch (error) {
      if (jsonMode) {
        emitJsonError(error, options.output);
      } else {
        console.error(chalk.red("\nError:"), error instanceof Error ? error.message : String(error));
      }
      process.exit(1);
    }
  });

program
  .command("metrics")
  .description("Get project metrics")
  .option("-b, --branch <branch>", "Branch name", "main")
  .option("--json", "Output results as JSON")
  .option("--output <path>", "Write JSON output to a file (enables --json)")
  .action(async (options: { branch: string; json?: boolean; output?: string }) => {
    const jsonMode = Boolean(options.json || options.output);
    try {
      const feedback = new SonarCloudFeedback({
        json: options.json,
        output: options.output,
      });
      await feedback.runProjectMetrics(options.branch);
    } catch (error) {
      if (jsonMode) {
        emitJsonError(error, options.output);
      } else {
        console.error(chalk.red("\nError:"), error instanceof Error ? error.message : String(error));
      }
      process.exit(1);
    }
  });

program
  .command("issues")
  .description("Get all issues for a branch")
  .option("-b, --branch <branch>", "Branch name", "main")
  .option(
    "-l, --limit <number>",
    "Number of detailed issues to display (use --all to show all)"
  )
  .option("-a, --all", "Show all detailed issues")
  .option("--json", "Output results as JSON")
  .option("--output <path>", "Write JSON output to a file (enables --json)")
  .action(async (options: { branch: string; limit?: string; all?: boolean; json?: boolean; output?: string }) => {
    const jsonMode = Boolean(options.json || options.output);
    try {
      const feedback = new SonarCloudFeedback({
        json: options.json,
        output: options.output,
      });
      let limit: number | undefined;
      if (!jsonMode) {
        if (options.all) {
          limit = Number.MAX_SAFE_INTEGER;
        } else if (options.limit !== undefined) {
          const parsed = Number.parseInt(options.limit, 10);
          if (Number.isNaN(parsed) || parsed < 0) {
            console.log(chalk.yellow("Invalid --limit value; using default."));
          } else {
            limit = parsed;
          }
        }
      }

      await feedback.runAllIssues(options.branch, limit);
    } catch (error) {
      if (jsonMode) {
        emitJsonError(error, options.output);
      } else {
        console.error(chalk.red("\nError:"), error instanceof Error ? error.message : String(error));
      }
      process.exit(1);
    }
  });

program.parse();
