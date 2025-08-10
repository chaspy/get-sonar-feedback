# get-sonar-feedback

A CLI tool to fetch SonarCloud feedback for pull requests directly from your terminal.

## Features

- 🎯 Quality Gate status checking
- 🐛 Code issues detection
- 🔒 Security hotspots analysis
- 🔄 Code duplication metrics
- 📊 Test coverage reporting
- 🔍 Auto-detect PR number from current git branch

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

```bash
# With explicit PR number
get-sonar-feedback 123

# Auto-detect PR from current branch
get-sonar-feedback
```

## Configuration

### Required Environment Variables

- `SONAR_TOKEN`: Your SonarCloud authentication token

### Optional Environment Variables

- `GITHUB_TOKEN`: GitHub personal access token (required for PR auto-detection if not using GitHub CLI)

Alternatively, you can authenticate with GitHub CLI:

```bash
gh auth login
```

## Example Output

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

MIT# Trigger Claude Code Action
