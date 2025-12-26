#!/usr/bin/env node

import { Command } from 'commander';
import fetch from 'node-fetch';
import chalk from 'chalk';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

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
    creationDate: string;
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
  creationDate: string;
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

interface JsonOutput {
  meta: JsonMeta;
  qualityGate: JsonQualityGate;
  issues: JsonIssue[];
  issuesSummary: {
    total: number;
    effortTotal: number;
    debtTotal: number;
  };
  securityHotspots: {
    total: number;
    hotspots: JsonSecurityHotspot[];
  };
  duplication: Record<string, number | null>;
  metrics: Record<string, number | null>;
}

interface JsonError {
  error: {
    message: string;
    statusCode: number | null;
    details: unknown | null;
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

class SonarCloudFeedback {
  private sonarConfig: SonarConfig;
  private githubConfig: GitHubConfig;
  private jsonMode: boolean;
  private outputPath?: string;
  private currentBranch?: string;

  constructor(options?: { json?: boolean; output?: string }) {
    this.jsonMode = Boolean(options?.json || options?.output);
    this.outputPath = options?.output;
    this.sonarConfig = {
      projectKey: 'studiuos-jp_Studious_JP',
      organization: 'studiuos-jp',
      token: process.env.SONAR_TOKEN || ''
    };

    this.githubConfig = this.getGitHubConfig();
  }

  private log(message: string = ''): void {
    if (this.jsonMode) {
      console.error(message);
      return;
    }
    console.log(message);
  }

  private logError(message: string = ''): void {
    console.error(message);
  }

  private writeJson(data: unknown): void {
    const json = `${JSON.stringify(data)}\n`;
    if (this.outputPath) {
      fs.writeFileSync(this.outputPath, json, 'utf-8');
    }
    process.stdout.write(json);
  }

  private writeJsonSafely(data: unknown): void {
    const json = `${JSON.stringify(data)}\n`;
    if (this.outputPath) {
      try {
        fs.writeFileSync(this.outputPath, json, 'utf-8');
      } catch {
        // Ignore file write errors when already in error handling.
      }
    }
    process.stdout.write(json);
  }

  private async fetchJson<T>(url: string, headers: Record<string, string>, errorLabel: string): Promise<T> {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      let details: unknown;
      try {
        details = await response.json();
      } catch {
        details = await response.text();
      }
      throw new ApiError(`${errorLabel} API returned ${response.status}`, response.status, details);
    }
    return response.json() as Promise<T>;
  }

  private getCurrentBranchSilent(): string | null {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
      return branch || null;
    } catch {
      return null;
    }
  }

  private toNumber(value?: string): number | null {
    if (value === undefined) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private getMeasureValue(measure: { value?: string; periods?: Array<{ value: string }> }): string | undefined {
    return measure.periods?.[0]?.value ?? measure.value;
  }

  private getFilePath(component: string): string {
    const prefix = `${this.sonarConfig.projectKey}:`;
    return component.startsWith(prefix) ? component.slice(prefix.length) : component;
  }

  private getGitHubConfig(): GitHubConfig {
    try {
      const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
      const match = remoteUrl.match(/github\.com[:\/]([^\/]+)\/(.+?)(\.git)?$/);
      
      if (!match) {
        throw new Error('Could not parse GitHub repository information from remote URL');
      }

      return {
        owner: match[1],
        repo: match[2],
        token: this.getGitHubToken()
      };
    } catch (error) {
      this.logError(chalk.red('Failed to get GitHub repository information'));
      throw error;
    }
  }

  private getGitHubToken(): string | undefined {
    if (process.env.GITHUB_TOKEN) {
      this.log(chalk.gray('Using GITHUB_TOKEN from environment variable'));
      return process.env.GITHUB_TOKEN;
    }

    try {
      const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
      if (token) {
        this.log(chalk.gray('Using token from gh auth'));
        return token;
      }
    } catch (error) {
      this.log(chalk.yellow('Could not get token from gh auth'));
    }

    return undefined;
  }

  private async getPullRequestId(prId?: string): Promise<string> {
    if (prId) {
      return prId;
    }

    this.log(chalk.blue('Pull request number not specified. Attempting to auto-detect...'));

    try {
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
      this.currentBranch = currentBranch;
      this.log(chalk.gray(`Current branch: ${currentBranch}`));

      if (!this.githubConfig.token) {
        throw new Error('GitHub token is required for auto-detection. Set GITHUB_TOKEN or authenticate with gh auth login');
      }

      const apiUrl = `https://api.github.com/repos/${this.githubConfig.owner}/${this.githubConfig.repo}/pulls?state=open&head=${this.githubConfig.owner}:${currentBranch}`;

      const pulls = await this.fetchJson<any[]>(
        apiUrl,
        {
          'Authorization': `token ${this.githubConfig.token}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        'GitHub API'
      );
      
      if (pulls.length === 0) {
        throw new Error(`No open pull request found for branch "${currentBranch}"`);
      }

      const prNumber = pulls[0].number;
      this.log(chalk.green(`Found pull request #${prNumber}`));
      
      return prNumber.toString();
    } catch (error) {
      this.logError(chalk.red('Failed to auto-detect pull request'));
      throw error;
    }
  }

  private async fetchQualityGate(prId: string): Promise<JsonQualityGate> {
    this.log(chalk.bold('\n🎯 Quality Gate Status'));
    this.log('-'.repeat(50));

    const url = `https://sonarcloud.io/api/qualitygates/project_status?projectKey=${this.sonarConfig.projectKey}&pullRequest=${prId}`;

    const data = await this.fetchJson<QualityGateResponse>(
      url,
      { 'Authorization': `Bearer ${this.sonarConfig.token}` },
      'Quality Gate'
    );
    const status = data.projectStatus.status;
    
    this.log(`Overall Status: ${status === 'OK' ? chalk.green(status) : chalk.red(status)}`);

    if (status === 'ERROR') {
      this.log(chalk.red('\n❌ Failed Conditions:'));
      data.projectStatus.conditions
        .filter(c => c.status === 'ERROR')
        .forEach(condition => {
          this.log(`  • ${condition.metricKey}: ${condition.actualValue} (threshold: ${condition.comparator} ${condition.errorThreshold})`);
        });
    }

    return {
      status,
      conditions: data.projectStatus.conditions
    };
  }

  private async fetchIssues(prId: string): Promise<{ summary: { total: number; effortTotal: number; debtTotal: number }; issues: JsonIssue[] }> {
    this.log(chalk.bold('\n🐛 Issues'));
    this.log('-'.repeat(50));

    const url = `https://sonarcloud.io/api/issues/search?componentKeys=${this.sonarConfig.projectKey}&pullRequest=${prId}&organization=${this.sonarConfig.organization}&resolved=false&ps=500`;

    const data = await this.fetchJson<IssuesResponse>(
      url,
      { 'Authorization': `Basic ${Buffer.from(`${this.sonarConfig.token}:`).toString('base64')}` },
      'Issues'
    );

    const effortTotal = data.effortTotal || 0;
    const debtTotal = data.debtTotal || 0;

    this.log(`Total Issues: ${data.total}`);
    this.log(`Effort Total: ${effortTotal}`);
    this.log(`Debt Total: ${debtTotal}`);

    if (data.total > 0) {
      this.log('');
      data.issues.forEach(issue => {
        this.log(`Issue Key: ${issue.key}`);
        this.log(`Rule: ${issue.rule}`);
        this.log(`Severity: ${this.getSeverityColored(issue.severity)}`);
        this.log(`File: ${this.getFilePath(issue.component)}`);
        this.log(`Line: ${issue.line || 'N/A'}`);
        this.log(`Message: ${issue.message}`);
        this.log(`Effort: ${issue.effort || '0min'}`);
        this.log(`Debt: ${issue.debt || '0min'}`);
        this.log(`Tags: ${issue.tags.join(', ') || ''}`);
        this.log('-'.repeat(50));
      });
    } else {
      this.log(chalk.green('✅ No issues found.'));
    }

    const issues = data.issues.map(issue => ({
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
      tags: issue.tags || [],
      creationDate: issue.creationDate,
      updateDate: issue.updateDate ?? null
    }));

    return {
      summary: {
        total: data.total,
        effortTotal,
        debtTotal
      },
      issues
    };
  }

  private async fetchSecurityHotspots(prId: string): Promise<{ total: number; hotspots: JsonSecurityHotspot[] }> {
    this.log(chalk.bold('\n🔒 Security Hotspots'));
    this.log('-'.repeat(50));

    const url = `https://sonarcloud.io/api/hotspots/search?projectKey=${this.sonarConfig.projectKey}&pullRequest=${prId}`;

    const data = await this.fetchJson<HotspotsResponse>(
      url,
      { 'Authorization': `Bearer ${this.sonarConfig.token}` },
      'Hotspots'
    );

    this.log(`Total Security Hotspots: ${data.paging.total}`);

    if (data.paging.total > 0) {
      this.log('');
      data.hotspots.forEach(hotspot => {
        this.log(`Hotspot Key: ${hotspot.key}`);
        this.log(`Rule: ${hotspot.ruleKey}`);
        this.log(`Security Category: ${hotspot.securityCategory}`);
        this.log(`Vulnerability Probability: ${this.getVulnerabilityColored(hotspot.vulnerabilityProbability)}`);
        this.log(`Status: ${hotspot.status}`);
        this.log(`File: ${this.getFilePath(hotspot.component)}`);
        this.log(`Line: ${hotspot.line || 'N/A'}`);
        this.log(`Message: ${hotspot.message}`);
        this.log('-'.repeat(50));
      });
    } else {
      this.log(chalk.green('✅ No security hotspots found.'));
    }

    return {
      total: data.paging.total,
      hotspots: data.hotspots.map(hotspot => ({
        key: hotspot.key,
        ruleKey: hotspot.ruleKey,
        securityCategory: hotspot.securityCategory,
        vulnerabilityProbability: hotspot.vulnerabilityProbability,
        status: hotspot.status,
        component: hotspot.component,
        filePath: this.getFilePath(hotspot.component),
        line: hotspot.line ?? null,
        message: hotspot.message
      }))
    };
  }

  private async fetchDuplicationMetrics(prId: string): Promise<Record<string, number | null>> {
    this.log(chalk.bold('\n🔄 Code Duplication'));
    this.log('-'.repeat(50));

    const metrics = ['new_duplicated_lines_density', 'new_duplicated_lines', 'new_duplicated_blocks'];
    const url = `https://sonarcloud.io/api/measures/component?component=${this.sonarConfig.projectKey}&metricKeys=${metrics.join(',')}&pullRequest=${prId}`;

    const data = await this.fetchJson<MeasuresResponse>(
      url,
      { 'Authorization': `Bearer ${this.sonarConfig.token}` },
      'Measures'
    );

    data.component.measures.forEach(measure => {
      const value = this.getMeasureValue(measure) || '0';
      switch (measure.metric) {
        case 'new_duplicated_lines_density':
          this.log(`Duplication Density: ${value}%`);
          break;
        case 'new_duplicated_lines':
          this.log(`Duplicated Lines: ${value}`);
          break;
        case 'new_duplicated_blocks':
          this.log(`Duplicated Blocks: ${value}`);
          break;
      }
    });

    const result: Record<string, number | null> = {
      new_duplicated_lines_density: null,
      new_duplicated_lines: null,
      new_duplicated_blocks: null
    };

    data.component.measures.forEach(measure => {
      if (measure.metric in result) {
        result[measure.metric] = this.toNumber(this.getMeasureValue(measure));
      }
    });

    return result;
  }

  private async fetchCoverageMetrics(prId: string): Promise<Record<string, number | null>> {
    this.log(chalk.bold('\n📊 Test Coverage'));
    this.log('-'.repeat(50));

    const metrics = ['new_coverage', 'new_lines_to_cover', 'new_uncovered_lines'];
    const url = `https://sonarcloud.io/api/measures/component?component=${this.sonarConfig.projectKey}&metricKeys=${metrics.join(',')}&pullRequest=${prId}`;

    const data = await this.fetchJson<MeasuresResponse>(
      url,
      { 'Authorization': `Bearer ${this.sonarConfig.token}` },
      'Coverage'
    );

    let hasData = false;
    data.component.measures.forEach(measure => {
      const value = this.getMeasureValue(measure);
      if (value !== undefined) {
        hasData = true;
        switch (measure.metric) {
          case 'new_coverage':
            this.log(`Coverage: ${value}%`);
            break;
          case 'new_lines_to_cover':
            this.log(`Lines to Cover: ${value}`);
            break;
          case 'new_uncovered_lines':
            this.log(`Uncovered Lines: ${value}`);
            break;
        }
      }
    });

    if (!hasData) {
      this.log('Coverage data not available.');
    }

    const result: Record<string, number | null> = {
      new_coverage: null,
      new_lines_to_cover: null,
      new_uncovered_lines: null
    };

    data.component.measures.forEach(measure => {
      if (measure.metric in result) {
        result[measure.metric] = this.toNumber(this.getMeasureValue(measure));
      }
    });

    return result;
  }

  private async fetchOverallMetrics(): Promise<Record<string, number | null>> {
    const metrics = [
      'coverage',
      'ncloc',
      'complexity',
      'reliability_rating',
      'security_rating',
      'sqale_rating'
    ];
    const url = `https://sonarcloud.io/api/measures/component?component=${this.sonarConfig.projectKey}&metricKeys=${metrics.join(',')}`;

    const data = await this.fetchJson<MeasuresResponse>(
      url,
      { 'Authorization': `Bearer ${this.sonarConfig.token}` },
      'Metrics'
    );

    const result: Record<string, number | null> = {
      coverage: null,
      ncloc: null,
      complexity: null,
      reliability_rating: null,
      security_rating: null,
      sqale_rating: null
    };

    data.component.measures.forEach(measure => {
      if (measure.metric in result) {
        result[measure.metric] = this.toNumber(this.getMeasureValue(measure));
      }
    });

    return result;
  }

  private getSeverityColored(severity: string): string {
    switch (severity.toUpperCase()) {
      case 'BLOCKER':
        return chalk.red(severity);
      case 'CRITICAL':
        return chalk.red(severity);
      case 'MAJOR':
        return chalk.yellow(severity);
      case 'MINOR':
        return chalk.blue(severity);
      case 'INFO':
        return chalk.gray(severity);
      default:
        return severity;
    }
  }

  private getVulnerabilityColored(probability: string): string {
    switch (probability.toUpperCase()) {
      case 'HIGH':
        return chalk.red(probability);
      case 'MEDIUM':
        return chalk.yellow(probability);
      case 'LOW':
        return chalk.green(probability);
      default:
        return probability;
    }
  }

  public async run(prId?: string): Promise<void> {
    try {
      if (!this.sonarConfig.token) {
        throw new Error('SONAR_TOKEN environment variable is not set');
      }

      const pullRequestId = await this.getPullRequestId(prId);

      const branch = this.currentBranch ?? this.getCurrentBranchSilent();

      if (!this.jsonMode) {
        this.log(chalk.bold('\n=========================================='));
        this.log(chalk.bold(`SonarCloud Analysis for PR #${pullRequestId}`));
        this.log(chalk.bold('=========================================='));
      }

      const qualityGate = await this.fetchQualityGate(pullRequestId);
      const issuesResult = await this.fetchIssues(pullRequestId);
      const hotspotsResult = await this.fetchSecurityHotspots(pullRequestId);
      const duplicationMetrics = await this.fetchDuplicationMetrics(pullRequestId);
      const coverageMetrics = await this.fetchCoverageMetrics(pullRequestId);
      const overallMetrics = this.jsonMode ? await this.fetchOverallMetrics() : {};

      if (this.jsonMode) {
        const output: JsonOutput = {
          meta: {
            projectKey: this.sonarConfig.projectKey,
            organization: this.sonarConfig.organization,
            branch: branch ?? null,
            pullRequest: pullRequestId,
            generatedAt: new Date().toISOString()
          },
          qualityGate,
          issues: issuesResult.issues,
          issuesSummary: issuesResult.summary,
          securityHotspots: hotspotsResult,
          duplication: duplicationMetrics,
          metrics: {
            ...overallMetrics,
            ...coverageMetrics
          }
        };

        this.writeJson(output);
        return;
      }

      this.log(chalk.bold('\n=========================================='));
      this.log(chalk.bold('Analysis Complete'));
      this.log(chalk.bold('=========================================='));
    } catch (error) {
      if (this.jsonMode) {
        const message = error instanceof Error ? error.message : String(error);
        const statusCode = error instanceof ApiError ? error.statusCode ?? null : null;
        const details = error instanceof ApiError ? error.details ?? null : null;
        const jsonError: JsonError = {
          error: {
            message,
            statusCode,
            details
          }
        };
        this.writeJsonSafely(jsonError);
        process.exit(1);
      }
      this.logError(chalk.red('\nError:') + ' ' + (error instanceof Error ? error.message : String(error)));
      process.exit(1);
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
      details
    }
  };
  const json = `${JSON.stringify(payload)}\n`;
  if (outputPath) {
    try {
      fs.writeFileSync(outputPath, json, 'utf-8');
    } catch {
      // Ignore file write errors when already in error handling.
    }
  }
  process.stdout.write(json);
};

const program = new Command();

program
  .name('get-sonar-feedback')
  .description('Fetch SonarCloud feedback for pull requests')
  .version('1.0.0')
  .argument('[pr-number]', 'Pull request number (optional, will auto-detect if not provided)')
  .option('--json', 'Output results as JSON')
  .option('--output <path>', 'Write JSON output to a file (enables --json)')
  .action(async (prNumber: string | undefined, options: { json?: boolean; output?: string }) => {
    const jsonMode = Boolean(options.json || options.output);
    if (!jsonMode) {
      const feedback = new SonarCloudFeedback();
      await feedback.run(prNumber);
      return;
    }
    try {
      const feedback = new SonarCloudFeedback({
        json: options.json,
        output: options.output
      });
      await feedback.run(prNumber);
    } catch (error) {
      emitJsonError(error, options.output);
      process.exit(1);
    }
  });

program.parse();
