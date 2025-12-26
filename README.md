# get-sonar-feedback

A CLI tool to fetch SonarCloud feedback for pull requests directly from your terminal.

## Features

- 🎯 Quality Gate status checking
- 🐛 Code issues detection
- 🔒 Security hotspots analysis
- 🔄 Code duplication metrics
- 📊 Test coverage reporting
- 🔍 Auto-detect PR number from current git branch
- 📦 JSON output for automation (`--json`)

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

# JSON output
get-sonar-feedback --json

# JSON output to file (still prints to stdout)
get-sonar-feedback --json --output /tmp/sonar-feedback.json
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

## JSON Output

Use `--json` to emit machine-readable output to stdout only. Log messages are suppressed in JSON mode.

```bash
get-sonar-feedback --json
```

Example (truncated):

```json
{
  "meta": {
    "projectKey": "studiuos-jp_Studious_JP",
    "organization": "studiuos-jp",
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
      "component": "studiuos-jp_Studious_JP:src/index.ts",
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
