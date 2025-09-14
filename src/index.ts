#!/usr/bin/env node

import { Command } from "commander";
import fetch from "node-fetch";
import chalk from "chalk";
import { execFileSync } from "child_process";

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
    component: string;
    line?: number;
    message: string;
    effort?: string;
    debt?: string;
    tags: string[];
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
      periods?: Array<{
        value: string;
      }>;
    }>;
  };
}

class SonarCloudFeedback {
  private static readonly MAX_DETAILED_ISSUES = 20;
  private readonly sonarConfig: SonarConfig;
  private readonly githubConfig: GitHubConfig;

  constructor() {
    // Validate required environment variables
    const projectKey = process.env.SONAR_PROJECT_KEY;
    const organization = process.env.SONAR_ORGANIZATION;
    const token = process.env.SONAR_TOKEN;

    const missingVars = [];
    if (!projectKey) missingVars.push("SONAR_PROJECT_KEY");
    if (!organization) missingVars.push("SONAR_ORGANIZATION");
    if (!token) missingVars.push("SONAR_TOKEN");

    if (missingVars.length > 0) {
      console.error(
        chalk.red("Error: Missing required environment variables:")
      );
      missingVars.forEach((varName) => {
        console.error(chalk.red(`  - ${varName}`));
      });
      console.error(
        chalk.yellow(
          "\nPlease set these environment variables before running the tool:"
        )
      );
      missingVars.forEach((varName) => {
        console.error(chalk.yellow(`  export ${varName}="your-value"`));
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
      }).trim();
      const match = remoteUrl.match(
        /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/
      );

      if (!match) {
        throw new Error(
          "Could not parse GitHub repository information from remote URL"
        );
      }

      return {
        owner: match[1],
        repo: match[2],
        token: this.getGitHubToken(),
      };
    } catch (error) {
      console.error(chalk.red("Failed to get GitHub repository information"));
      throw error;
    }
  }

  private getGitHubToken(): string | undefined {
    const isProduction = process.env.NODE_ENV === "production";

    if (process.env.GITHUB_TOKEN) {
      if (!isProduction) {
        console.log(chalk.gray("Using GITHUB_TOKEN from environment variable"));
      }
      return process.env.GITHUB_TOKEN;
    }

    try {
      const token = execFileSync("gh", ["auth", "token"], {
        encoding: "utf-8",
      }).trim();
      if (token) {
        if (!isProduction) {
          console.log(chalk.gray("Using token from gh auth"));
        }
        return token;
      }
    } catch (error) {
      console.warn(
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

    console.log(
      chalk.blue(
        "Pull request number not specified. Attempting to auto-detect..."
      )
    );

    try {
      const currentBranch = execFileSync(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { encoding: "utf-8" }
      ).trim();
      console.log(chalk.gray(`Current branch: ${currentBranch}`));

      if (!this.githubConfig.token) {
        throw new Error(
          "GitHub token is required for auto-detection. Set GITHUB_TOKEN or authenticate with gh auth login"
        );
      }

      const apiUrl = `https://api.github.com/repos/${this.githubConfig.owner}/${this.githubConfig.repo}/pulls?state=open&head=${this.githubConfig.owner}:${currentBranch}`;

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

      const pulls = (await response.json()) as GitHubPullRequest[];

      if (pulls.length === 0) {
        throw new Error(
          `No open pull request found for branch "${currentBranch}"`
        );
      }

      const prNumber = pulls[0].number;
      console.log(chalk.green(`Found pull request #${prNumber}`));

      return prNumber.toString();
    } catch (error) {
      console.error(chalk.red("Failed to auto-detect pull request"));
      throw error;
    }
  }

  private async fetchQualityGate(prId: string): Promise<void> {
    console.log(chalk.bold("\n🎯 Quality Gate Status"));
    console.log("-".repeat(50));

    const url = `https://sonarcloud.io/api/qualitygates/project_status?projectKey=${this.sonarConfig.projectKey}&pullRequest=${prId}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.sonarConfig.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Quality Gate API returned ${response.status}`);
    }

    const data = (await response.json()) as QualityGateResponse;
    const status = data.projectStatus.status;

    console.log(
      `Overall Status: ${
        status === "OK" ? chalk.green(status) : chalk.red(status)
      }`
    );

    if (status === "ERROR") {
      console.log(chalk.red("\n❌ Failed Conditions:"));
      data.projectStatus.conditions
        .filter((c) => c.status === "ERROR")
        .forEach((condition) => {
          const thresholdInfo = `${condition.comparator} ${condition.errorThreshold}`;
          console.log(
            `  • ${condition.metricKey}: ${condition.actualValue} (threshold: ${thresholdInfo})`
          );
        });
    }
  }

  private async fetchIssues(prId: string): Promise<void> {
    console.log(chalk.bold("\n🐛 Issues"));
    console.log("-".repeat(50));

    const url = `https://sonarcloud.io/api/issues/search?componentKeys=${this.sonarConfig.projectKey}&pullRequest=${prId}&organization=${this.sonarConfig.organization}&resolved=false&ps=500`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${this.sonarConfig.token}:`
        ).toString("base64")}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Issues API returned ${response.status}`);
    }

    const data = (await response.json()) as IssuesResponse;

    console.log(`Total Issues: ${data.total}`);
    console.log(`Effort Total: ${data.effortTotal || 0}`);
    console.log(`Debt Total: ${data.debtTotal || 0}`);

    if (data.total > 0) {
      console.log("");
      data.issues.forEach((issue) => {
        console.log(`Issue Key: ${issue.key}`);
        console.log(`Rule: ${issue.rule}`);
        console.log(`Severity: ${this.getSeverityColored(issue.severity)}`);
        const fileName = issue.component.replace(
          `${this.sonarConfig.projectKey}:`,
          ""
        );
        const tagsList = issue.tags.join(", ") || "";
        console.log(`File: ${fileName}`);
        console.log(`Line: ${issue.line || "N/A"}`);
        console.log(`Message: ${issue.message}`);
        console.log(`Effort: ${issue.effort || "0min"}`);
        console.log(`Debt: ${issue.debt || "0min"}`);
        console.log(`Tags: ${tagsList}`);
        console.log("-".repeat(50));
      });
    } else {
      console.log(chalk.green("✅ No issues found."));
    }
  }

  private async fetchSecurityHotspots(prId: string): Promise<void> {
    console.log(chalk.bold("\n🔒 Security Hotspots"));
    console.log("-".repeat(50));

    const url = `https://sonarcloud.io/api/hotspots/search?projectKey=${this.sonarConfig.projectKey}&pullRequest=${prId}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.sonarConfig.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Hotspots API returned ${response.status}`);
    }

    const data = (await response.json()) as HotspotsResponse;

    console.log(`Total Security Hotspots: ${data.paging.total}`);

    if (data.paging.total > 0) {
      console.log("");
      data.hotspots.forEach((hotspot) => {
        console.log(`Hotspot Key: ${hotspot.key}`);
        console.log(`Rule: ${hotspot.ruleKey}`);
        console.log(`Security Category: ${hotspot.securityCategory}`);
        console.log(
          `Vulnerability Probability: ${this.getVulnerabilityColored(
            hotspot.vulnerabilityProbability
          )}`
        );
        console.log(`Status: ${hotspot.status}`);
        const fileName = hotspot.component.replace(
          `${this.sonarConfig.projectKey}:`,
          ""
        );
        console.log(`File: ${fileName}`);
        console.log(`Line: ${hotspot.line || "N/A"}`);
        console.log(`Message: ${hotspot.message}`);
        console.log("-".repeat(50));
      });
    } else {
      console.log(chalk.green("✅ No security hotspots found."));
    }
  }

  private async fetchDuplicationMetrics(prId: string): Promise<void> {
    console.log(chalk.bold("\n🔄 Code Duplication"));
    console.log("-".repeat(50));

    const metrics =
      "new_duplicated_lines_density,new_duplicated_lines,new_duplicated_blocks";
    const url = `https://sonarcloud.io/api/measures/component?component=${this.sonarConfig.projectKey}&metricKeys=${metrics}&pullRequest=${prId}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.sonarConfig.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Measures API returned ${response.status}`);
    }

    const data = (await response.json()) as MeasuresResponse;

    data.component.measures.forEach((measure) => {
      const value = measure.periods?.[0]?.value || "0";
      switch (measure.metric) {
        case "new_duplicated_lines_density":
          console.log(`Duplication Density: ${value}%`);
          break;
        case "new_duplicated_lines":
          console.log(`Duplicated Lines: ${value}`);
          break;
        case "new_duplicated_blocks":
          console.log(`Duplicated Blocks: ${value}`);
          break;
      }
    });
  }

  private async fetchCoverageMetrics(prId: string): Promise<void> {
    console.log(chalk.bold("\n📊 Test Coverage"));
    console.log("-".repeat(50));

    const metrics = "new_coverage,new_lines_to_cover,new_uncovered_lines";
    const url = `https://sonarcloud.io/api/measures/component?component=${this.sonarConfig.projectKey}&metricKeys=${metrics}&pullRequest=${prId}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.sonarConfig.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Coverage API returned ${response.status}`);
    }

    const data = (await response.json()) as MeasuresResponse;

    let hasData = false;
    data.component.measures.forEach((measure) => {
      const value = measure.periods?.[0]?.value;
      if (value) {
        hasData = true;
        switch (measure.metric) {
          case "new_coverage":
            console.log(`Coverage: ${value}%`);
            break;
          case "new_lines_to_cover":
            console.log(`Lines to Cover: ${value}`);
            break;
          case "new_uncovered_lines":
            console.log(`Uncovered Lines: ${value}`);
            break;
        }
      }
    });

    if (!hasData) {
      console.log("Coverage data not available.");
    }
  }

  private async fetchProjectMetrics(branch: string): Promise<void> {
    console.log(chalk.bold("\n📊 Project Metrics"));
    console.log("-".repeat(50));

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
    ].join(",");

    const url = `https://sonarcloud.io/api/measures/component?component=${this.sonarConfig.projectKey}&metricKeys=${metrics}&branch=${branch}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.sonarConfig.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Project Metrics API returned ${response.status}`);
    }

    const data = (await response.json()) as MeasuresResponse;

    data.component.measures.forEach((measure) => {
      const value =
        measure.periods?.[0]?.value || (measure as any).value || "0";
      switch (measure.metric) {
        case "bugs":
          console.log(`🐛 Bugs: ${value}`);
          break;
        case "vulnerabilities":
          console.log(`🔓 Vulnerabilities: ${value}`);
          break;
        case "code_smells":
          console.log(`💨 Code Smells: ${value}`);
          break;
        case "coverage":
          console.log(`📊 Coverage: ${value}%`);
          break;
        case "line_coverage":
          console.log(`📈 Line Coverage: ${value}%`);
          break;
        case "duplicated_lines_density":
          console.log(`🔄 Duplicated Lines Density: ${value}%`);
          break;
        case "complexity":
          console.log(`🎯 Cyclomatic Complexity: ${value}`);
          break;
        case "cognitive_complexity":
          console.log(`🧠 Cognitive Complexity: ${value}`);
          break;
        case "reliability_rating":
          console.log(`⚡ Reliability Rating: ${this.getRatingColored(value)}`);
          break;
        case "security_rating":
          console.log(`🔒 Security Rating: ${this.getRatingColored(value)}`);
          break;
        case "sqale_rating":
          console.log(
            `🏗️  Maintainability Rating: ${this.getRatingColored(value)}`
          );
          break;
        case "ncloc":
          console.log(`📄 Lines of Code: ${value}`);
          break;
        case "sqale_index": {
          const hours = Math.round(parseInt(value) / 60);
          const minutes = parseInt(value) % 60;
          console.log(`⏱️  Technical Debt: ${hours}h ${minutes}min`);
          break;
        }
      }
    });
  }

  private async fetchAllIssues(
    branch: string,
    maxToShow?: number
  ): Promise<void> {
    console.log(chalk.bold("\n🐛 All Issues"));
    console.log("-".repeat(50));

    const data = await this.fetchIssuesData(branch);
    this.displayIssuesSummary(data);

    if (data.total > 0) {
      this.displayIssuesBreakdown(data);
      this.displayDetailedIssues(data, maxToShow);
    } else {
      console.log(chalk.green("✅ No issues found."));
    }
  }

  private async fetchIssuesData(branch: string): Promise<IssuesResponse> {
    const url = `https://sonarcloud.io/api/issues/search?componentKeys=${this.sonarConfig.projectKey}&branch=${branch}&organization=${this.sonarConfig.organization}&resolved=false&ps=500`;

    const basicAuth = Buffer.from(`${this.sonarConfig.token}:`).toString(
      "base64"
    );
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Issues API returned ${response.status}`);
    }

    return (await response.json()) as IssuesResponse;
  }

  private displayIssuesSummary(data: IssuesResponse): void {
    console.log(`Total Issues: ${data.total}`);
    console.log(`Effort Total: ${data.effortTotal || 0} minutes`);
    console.log(`Debt Total: ${data.debtTotal || 0} minutes`);
  }

  private displayIssuesBreakdown(data: IssuesResponse): void {
    console.log(chalk.bold("\n📋 Issue Breakdown by Severity:"));
    const severityCount = data.issues.reduce(
      (acc, issue) => {
        acc[issue.severity] = (acc[issue.severity] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    Object.entries(severityCount).forEach(([severity, count]) => {
      console.log(`  ${this.getSeverityColored(severity)}: ${count}`);
    });

    console.log(chalk.bold("\n📋 Issue Breakdown by Type:"));
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
        console.log(`  ${rule}: ${count}`);
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
    console.log(chalk.bold(`\n📋 Detailed Issues (${detailsHeader}):`));

    const sliceEnd = showAll ? data.issues.length : limit;
    data.issues.slice(0, sliceEnd).forEach((issue, index) => {
      const severityColored = this.getSeverityColored(issue.severity);
      const fileName = issue.component.replace(
        `${this.sonarConfig.projectKey}:`,
        ""
      );
      console.log(`\n${index + 1}. ${severityColored} - ${issue.message}`);
      console.log(`   File: ${fileName}`);
      console.log(`   Line: ${issue.line || "N/A"}`);
      console.log(`   Rule: ${issue.rule}`);
      if (issue.effort) {
        console.log(`   Effort: ${issue.effort}`);
      }
    });

    if (!showAll && data.total > limit) {
      console.log(chalk.yellow(`\n... and ${data.total - limit} more issues`));
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
      const pullRequestId = await this.getPullRequestId(prId);

      console.log(chalk.bold("\n=========================================="));
      console.log(chalk.bold(`SonarCloud Analysis for PR #${pullRequestId}`));
      console.log(chalk.bold("=========================================="));

      await this.fetchQualityGate(pullRequestId);
      await this.fetchIssues(pullRequestId);
      await this.fetchSecurityHotspots(pullRequestId);
      await this.fetchDuplicationMetrics(pullRequestId);
      await this.fetchCoverageMetrics(pullRequestId);

      console.log(chalk.bold("\n=========================================="));
      console.log(chalk.bold("Analysis Complete"));
      console.log(chalk.bold("=========================================="));
    } catch (error) {
      console.error(
        chalk.red("\nError:"),
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  }

  public async runProjectMetrics(branch: string = "main"): Promise<void> {
    try {
      if (!this.sonarConfig.token) {
        throw new Error("SONAR_TOKEN environment variable is not set");
      }

      console.log(chalk.bold("\n=========================================="));
      console.log(chalk.bold(`Project Metrics for branch: ${branch}`));
      console.log(chalk.bold("=========================================="));

      await this.fetchProjectMetrics(branch);

      console.log(chalk.bold("\n=========================================="));
      console.log(chalk.bold("Metrics Complete"));
      console.log(chalk.bold("=========================================="));
    } catch (error) {
      console.error(
        chalk.red("\nError:"),
        error instanceof Error ? error.message : error
      );
      process.exit(1);
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

      console.log(chalk.bold("\n=========================================="));
      console.log(chalk.bold(`All Issues for branch: ${branch}`));
      console.log(chalk.bold("=========================================="));

      await this.fetchAllIssues(branch, maxToShow);

      console.log(chalk.bold("\n=========================================="));
      console.log(chalk.bold("Issues Complete"));
      console.log(chalk.bold("=========================================="));
    } catch (error) {
      console.error(
        chalk.red("\nError:"),
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  }
}

const program = new Command();

program
  .name("get-sonar-feedback")
  .description("Fetch SonarCloud feedback")
  .version("0.2.0");

program
  .command("pr")
  .description("Analyze pull request")
  .argument(
    "[pr-number]",
    "Pull request number (optional, will auto-detect if not provided)"
  )
  .action(async (prNumber?: string) => {
    const feedback = new SonarCloudFeedback();
    await feedback.runPrAnalysis(prNumber);
  });

program
  .command("metrics")
  .description("Get project metrics")
  .option("-b, --branch <branch>", "Branch name", "main")
  .action(async (options) => {
    const feedback = new SonarCloudFeedback();
    await feedback.runProjectMetrics(options.branch);
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
  .action(async (options) => {
    const feedback = new SonarCloudFeedback();
    let limit: number | undefined;
    if (options.all) {
      limit = Number.MAX_SAFE_INTEGER;
    } else if (options.limit !== undefined) {
      const parsed = parseInt(options.limit, 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        console.log(chalk.yellow("Invalid --limit value; using default."));
      } else {
        limit = parsed;
      }
    }

    await feedback.runAllIssues(options.branch, limit);
  });

program.parse();
