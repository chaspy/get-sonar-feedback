#!/usr/bin/env node

import { Command } from 'commander';
import fetch from 'node-fetch';
import chalk from 'chalk';
import { execSync } from 'child_process';
import * as path from 'path';

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
  private sonarConfig: SonarConfig;
  private githubConfig: GitHubConfig;

  constructor() {
    this.sonarConfig = {
      projectKey: 'studiuos-jp_Studious_JP',
      organization: 'studiuos-jp',
      token: process.env.SONAR_TOKEN || ''
    };

    this.githubConfig = this.getGitHubConfig();
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
      console.error(chalk.red('Failed to get GitHub repository information'));
      throw error;
    }
  }

  private getGitHubToken(): string | undefined {
    if (process.env.GITHUB_TOKEN) {
      console.log(chalk.gray('Using GITHUB_TOKEN from environment variable'));
      return process.env.GITHUB_TOKEN;
    }

    try {
      const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
      if (token) {
        console.log(chalk.gray('Using token from gh auth'));
        return token;
      }
    } catch (error) {
      console.log(chalk.yellow('Could not get token from gh auth'));
    }

    return undefined;
  }

  private async getPullRequestId(prId?: string): Promise<string> {
    if (prId) {
      return prId;
    }

    console.log(chalk.blue('Pull request number not specified. Attempting to auto-detect...'));

    try {
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
      console.log(chalk.gray(`Current branch: ${currentBranch}`));

      if (!this.githubConfig.token) {
        throw new Error('GitHub token is required for auto-detection. Set GITHUB_TOKEN or authenticate with gh auth login');
      }

      const apiUrl = `https://api.github.com/repos/${this.githubConfig.owner}/${this.githubConfig.repo}/pulls?state=open&head=${this.githubConfig.owner}:${currentBranch}`;
      
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `token ${this.githubConfig.token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
      }

      const pulls = await response.json() as any[];
      
      if (pulls.length === 0) {
        throw new Error(`No open pull request found for branch "${currentBranch}"`);
      }

      const prNumber = pulls[0].number;
      console.log(chalk.green(`Found pull request #${prNumber}`));
      
      return prNumber.toString();
    } catch (error) {
      console.error(chalk.red('Failed to auto-detect pull request'));
      throw error;
    }
  }

  private async fetchQualityGate(prId: string): Promise<void> {
    console.log(chalk.bold('\n🎯 Quality Gate Status'));
    console.log('-'.repeat(50));

    const url = `https://sonarcloud.io/api/qualitygates/project_status?projectKey=${this.sonarConfig.projectKey}&pullRequest=${prId}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.sonarConfig.token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Quality Gate API returned ${response.status}`);
    }

    const data = await response.json() as QualityGateResponse;
    const status = data.projectStatus.status;
    
    console.log(`Overall Status: ${status === 'OK' ? chalk.green(status) : chalk.red(status)}`);

    if (status === 'ERROR') {
      console.log(chalk.red('\n❌ Failed Conditions:'));
      data.projectStatus.conditions
        .filter(c => c.status === 'ERROR')
        .forEach(condition => {
          console.log(`  • ${condition.metricKey}: ${condition.actualValue} (threshold: ${condition.comparator} ${condition.errorThreshold})`);
        });
    }
  }

  private async fetchIssues(prId: string): Promise<void> {
    console.log(chalk.bold('\n🐛 Issues'));
    console.log('-'.repeat(50));

    const url = `https://sonarcloud.io/api/issues/search?componentKeys=${this.sonarConfig.projectKey}&pullRequest=${prId}&organization=${this.sonarConfig.organization}&resolved=false&ps=500`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.sonarConfig.token}:`).toString('base64')}`
      }
    });

    if (!response.ok) {
      throw new Error(`Issues API returned ${response.status}`);
    }

    const data = await response.json() as IssuesResponse;
    
    console.log(`Total Issues: ${data.total}`);
    console.log(`Effort Total: ${data.effortTotal || 0}`);
    console.log(`Debt Total: ${data.debtTotal || 0}`);

    if (data.total > 0) {
      console.log('');
      data.issues.forEach(issue => {
        console.log(`Issue Key: ${issue.key}`);
        console.log(`Rule: ${issue.rule}`);
        console.log(`Severity: ${this.getSeverityColored(issue.severity)}`);
        console.log(`File: ${issue.component.replace(`${this.sonarConfig.projectKey}:`, '')}`);
        console.log(`Line: ${issue.line || 'N/A'}`);
        console.log(`Message: ${issue.message}`);
        console.log(`Effort: ${issue.effort || '0min'}`);
        console.log(`Debt: ${issue.debt || '0min'}`);
        console.log(`Tags: ${issue.tags.join(', ') || ''}`);
        console.log('-'.repeat(50));
      });
    } else {
      console.log(chalk.green('✅ No issues found.'));
    }
  }

  private async fetchSecurityHotspots(prId: string): Promise<void> {
    console.log(chalk.bold('\n🔒 Security Hotspots'));
    console.log('-'.repeat(50));

    const url = `https://sonarcloud.io/api/hotspots/search?projectKey=${this.sonarConfig.projectKey}&pullRequest=${prId}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.sonarConfig.token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Hotspots API returned ${response.status}`);
    }

    const data = await response.json() as HotspotsResponse;
    
    console.log(`Total Security Hotspots: ${data.paging.total}`);

    if (data.paging.total > 0) {
      console.log('');
      data.hotspots.forEach(hotspot => {
        console.log(`Hotspot Key: ${hotspot.key}`);
        console.log(`Rule: ${hotspot.ruleKey}`);
        console.log(`Security Category: ${hotspot.securityCategory}`);
        console.log(`Vulnerability Probability: ${this.getVulnerabilityColored(hotspot.vulnerabilityProbability)}`);
        console.log(`Status: ${hotspot.status}`);
        console.log(`File: ${hotspot.component.replace(`${this.sonarConfig.projectKey}:`, '')}`);
        console.log(`Line: ${hotspot.line || 'N/A'}`);
        console.log(`Message: ${hotspot.message}`);
        console.log('-'.repeat(50));
      });
    } else {
      console.log(chalk.green('✅ No security hotspots found.'));
    }
  }

  private async fetchDuplicationMetrics(prId: string): Promise<void> {
    console.log(chalk.bold('\n🔄 Code Duplication'));
    console.log('-'.repeat(50));

    const metrics = 'new_duplicated_lines_density,new_duplicated_lines,new_duplicated_blocks';
    const url = `https://sonarcloud.io/api/measures/component?component=${this.sonarConfig.projectKey}&metricKeys=${metrics}&pullRequest=${prId}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.sonarConfig.token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Measures API returned ${response.status}`);
    }

    const data = await response.json() as MeasuresResponse;
    
    data.component.measures.forEach(measure => {
      const value = measure.periods?.[0]?.value || '0';
      switch (measure.metric) {
        case 'new_duplicated_lines_density':
          console.log(`Duplication Density: ${value}%`);
          break;
        case 'new_duplicated_lines':
          console.log(`Duplicated Lines: ${value}`);
          break;
        case 'new_duplicated_blocks':
          console.log(`Duplicated Blocks: ${value}`);
          break;
      }
    });
  }

  private async fetchCoverageMetrics(prId: string): Promise<void> {
    console.log(chalk.bold('\n📊 Test Coverage'));
    console.log('-'.repeat(50));

    const metrics = 'new_coverage,new_lines_to_cover,new_uncovered_lines';
    const url = `https://sonarcloud.io/api/measures/component?component=${this.sonarConfig.projectKey}&metricKeys=${metrics}&pullRequest=${prId}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.sonarConfig.token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Coverage API returned ${response.status}`);
    }

    const data = await response.json() as MeasuresResponse;
    
    let hasData = false;
    data.component.measures.forEach(measure => {
      const value = measure.periods?.[0]?.value;
      if (value) {
        hasData = true;
        switch (measure.metric) {
          case 'new_coverage':
            console.log(`Coverage: ${value}%`);
            break;
          case 'new_lines_to_cover':
            console.log(`Lines to Cover: ${value}`);
            break;
          case 'new_uncovered_lines':
            console.log(`Uncovered Lines: ${value}`);
            break;
        }
      }
    });

    if (!hasData) {
      console.log('Coverage data not available.');
    }
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

      console.log(chalk.bold('\n=========================================='));
      console.log(chalk.bold(`SonarCloud Analysis for PR #${pullRequestId}`));
      console.log(chalk.bold('=========================================='));

      await this.fetchQualityGate(pullRequestId);
      await this.fetchIssues(pullRequestId);
      await this.fetchSecurityHotspots(pullRequestId);
      await this.fetchDuplicationMetrics(pullRequestId);
      await this.fetchCoverageMetrics(pullRequestId);

      console.log(chalk.bold('\n=========================================='));
      console.log(chalk.bold('Analysis Complete'));
      console.log(chalk.bold('=========================================='));
    } catch (error) {
      console.error(chalk.red('\nError:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }
}

const program = new Command();

program
  .name('get-sonar-feedback')
  .description('Fetch SonarCloud feedback for pull requests')
  .version('1.0.0')
  .argument('[pr-number]', 'Pull request number (optional, will auto-detect if not provided)')
  .action(async (prNumber?: string) => {
    const feedback = new SonarCloudFeedback();
    await feedback.run(prNumber);
  });

program.parse();