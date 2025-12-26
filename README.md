# get-sonar-feedback

![release-on-version](https://github.com/chaspy/get-sonar-feedback/actions/workflows/auto-minor-release.yml/badge.svg)
[![npm version](https://img.shields.io/npm/v/get-sonar-feedback.svg)](https://www.npmjs.com/package/get-sonar-feedback)

A CLI tool to fetch SonarCloud feedback for pull requests and project-wide analysis directly from your terminal.

## Features

### 🔴 PR Analysis
- 🎯 Quality Gate status checking
- 🐛 Code issues detection
- 🔒 Security hotspots analysis
- 🔄 Code duplication metrics
- 📊 Test coverage reporting
- 🔍 Auto-detect PR number from current git branch
- 📦 JSON output for automation (`--json`)

### 📊 Project-wide Analysis  
- 📊 **Project metrics**: Get comprehensive quality metrics for any branch
- 🐛 **All issues**: Analyze all issues with severity breakdown and detailed reporting
- 🎆 **Maintenance audits**: Regular quality checks beyond PR reviews

## Installation

```bash
npm install -g get-sonar-feedback
```

Or clone and build locally:

```bash
git clone https://github.com/chaspy/get-sonar-feedback.git
cd get-sonar-feedback
npm install
npm run build
```

## Usage

### PR Analysis
```bash
# Analyze specific pull request
get-sonar-feedback pr 123

# Auto-detect PR from current branch
get-sonar-feedback pr

# JSON output
get-sonar-feedback pr 123 --json

# JSON output to file (still prints to stdout)
get-sonar-feedback pr 123 --json --output /tmp/sonar-feedback.json
```

### Project Metrics
```bash
# Get metrics for main branch
get-sonar-feedback metrics

# Get metrics for specific branch
get-sonar-feedback metrics -b develop

# JSON output
get-sonar-feedback metrics --json
```

### Issues Analysis
```bash
# Get all issues for main branch
get-sonar-feedback issues

# Get all issues for specific branch
get-sonar-feedback issues -b feature-branch

# Show only the first N detailed issues
get-sonar-feedback issues --limit 50

# Show all detailed issues
get-sonar-feedback issues --all

# JSON output
get-sonar-feedback issues --json
```

## Configuration

### Required Environment Variables

- `SONAR_TOKEN`: Your SonarCloud authentication token
- `SONAR_PROJECT_KEY`: Your SonarCloud project key (e.g., `my-org_my-project`)
- `SONAR_ORGANIZATION`: Your SonarCloud organization key

### Optional Environment Variables

- `GITHUB_TOKEN`: GitHub personal access token (required for PR auto-detection if not using GitHub CLI)
- `DEBUG`: Set to `true` to enable debug output (see Debug Mode section below)
- `NODE_ENV`: Set to `debug` to enable debug output

Alternatively, you can authenticate with GitHub CLI:

```bash
gh auth login
```

### Debug Mode

When encountering issues like 404 errors from SonarCloud API, you can enable debug mode to see detailed information about API calls and responses:

```bash
# Using DEBUG environment variable
DEBUG=true get-sonar-feedback pr

# Or using NODE_ENV
NODE_ENV=debug get-sonar-feedback pr
```

Debug mode will display:
- SonarCloud configuration (Project Key, Organization)
- Complete API URLs being called
- Response status codes and error messages
- Response body content for failed requests

This is particularly useful for troubleshooting authentication issues or misconfigured project keys.

## Release & Publish

- Merging a PR into `main` triggers an automated minor version bump, creates a Git tag and a GitHub Release, then publishes to npm.
- Requirements:
  - Add `NPM_TOKEN` in GitHub Actions Secrets with publish permission.
  - The `package.json` `name` must be available on npm, and the next version must be unused.

Workflows involved:
- `.github/workflows/auto-minor-release.yml`: bump minor on merge/push to `main` and create a GitHub Release.
- `.github/workflows/publish-npm.yml`: publish to npm when a GitHub Release is published.

## Example Output

### PR Analysis Output
```
==========================================
SonarCloud Analysis for PR #123
==========================================

🎯 Quality Gate Status
--------------------------------------------------
Overall Status: OK

🐛 Issues
--------------------------------------------------
Total Issues: 2
Effort Total: 10min
Debt Total: 10min

Issue Key: AY1234567890
Rule: typescript:S1234
Severity: MINOR
File: src/index.ts
Line: 42
Message: Remove this unused variable
Effort: 5min
Tags: unused

🔒 Security Hotspots
--------------------------------------------------
Total Security Hotspots: 0
✅ No security hotspots found.

🔄 Code Duplication
--------------------------------------------------
Duplication Density: 0.0%
Duplicated Lines: 0
Duplicated Blocks: 0

📊 Test Coverage
--------------------------------------------------
Coverage: 85.5%
Lines to Cover: 200
Uncovered Lines: 29

==========================================
Analysis Complete
==========================================
```

### Project Metrics Output
```
==========================================
Project Metrics for branch: main
==========================================

📊 Project Metrics
--------------------------------------------------
🐛 Bugs: 0
🔓 Vulnerabilities: 1
💨 Code Smells: 21
📊 Coverage: 85.2%
🔄 Duplicated Lines Density: 2.5%
🎯 Cyclomatic Complexity: 3642
🧠 Cognitive Complexity: 2102
⚡ Reliability Rating: A
🔒 Security Rating: E
🏗️  Maintainability Rating: A
📄 Lines of Code: 33025
⏱️  Technical Debt: 9h 12min

==========================================
Metrics Complete
==========================================
```

## JSON Output

Use `--json` to emit machine-readable output to stdout only. Log messages are suppressed in JSON mode.
Use `--output <path>` to write the same JSON to a file.

```bash
get-sonar-feedback pr 123 --json
```

Example (truncated):

```json
{
  "meta": {
    "projectKey": "my-org_my-project",
    "organization": "my-org",
    "branch": "main",
    "pullRequest": "123",
    "generatedAt": "2025-12-26T12:34:56.789Z"
  },
  "issues": [
    {
      "key": "AY1234567890",
      "rule": "typescript:S1234",
      "severity": "MINOR",
      "type": "CODE_SMELL",
      "component": "my-org_my-project:src/index.ts",
      "filePath": "src/index.ts",
      "line": 42,
      "message": "Remove this unused variable",
      "effort": "5min",
      "debt": "5min",
      "tags": ["unused"],
      "creationDate": "2025-12-25T01:02:03+0000",
      "updateDate": "2025-12-25T01:02:03+0000"
    }
  ],
  "metrics": {
    "coverage": 85.5,
    "ncloc": 38760,
    "complexity": 5624,
    "reliability_rating": 1,
    "security_rating": 1,
    "sqale_rating": 1,
    "new_coverage": 90.1,
    "new_lines_to_cover": 200,
    "new_uncovered_lines": 20
  }
}
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

## License

MIT
