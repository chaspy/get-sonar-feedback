# get-sonar-feedback

A CLI tool to fetch SonarCloud feedback for pull requests and project-wide analysis directly from your terminal.

## Features

### 🔴 PR Analysis
- 🎯 Quality Gate status checking
- 🐛 Code issues detection
- 🔒 Security hotspots analysis
- 🔄 Code duplication metrics
- 📊 Test coverage reporting
- 🔍 Auto-detect PR number from current git branch

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
```

### Project Metrics
```bash
# Get metrics for main branch
get-sonar-feedback metrics

# Get metrics for specific branch
get-sonar-feedback metrics -b develop
```

### Issues Analysis
```bash
# Get all issues for main branch
get-sonar-feedback issues

# Get all issues for specific branch
get-sonar-feedback issues -b feature-branch
```

## Configuration

### Required Environment Variables

- `SONAR_TOKEN`: Your SonarCloud authentication token
- `SONAR_PROJECT_KEY`: Your SonarCloud project key (e.g., `my-org_my-project`)
- `SONAR_ORGANIZATION`: Your SonarCloud organization key

### Optional Environment Variables

- `GITHUB_TOKEN`: GitHub personal access token (required for PR auto-detection if not using GitHub CLI)

Alternatively, you can authenticate with GitHub CLI:

```bash
gh auth login
```

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
