# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Development mode (run TypeScript directly)
npm run dev

# Run the CLI tool (after building)
./dist/index.js [pr-number]

# Or using npm bin
get-sonar-feedback [pr-number]
```

## Architecture Overview

This is a TypeScript CLI tool that fetches SonarCloud analysis feedback for pull requests. The architecture is straightforward:

- **Single-file implementation**: All logic is contained in `src/index.ts`
- **Main class**: `SonarCloudFeedback` handles all API interactions with SonarCloud
- **Configuration**: 
  - SonarCloud config via environment variables:
    - `SONAR_PROJECT_KEY` (defaults to `studiuos-jp_Studious_JP`)
    - `SONAR_ORGANIZATION` (defaults to `studiuos-jp`)
  - GitHub config is auto-detected from git remote
- **Authentication**:
  - Requires `SONAR_TOKEN` environment variable for SonarCloud API
  - Uses `GITHUB_TOKEN` env var or `gh auth token` for GitHub API (optional, needed for PR auto-detection)

## Key Implementation Details

- **PR Auto-detection**: If no PR number is provided, the tool will attempt to find an open PR for the current git branch using GitHub API
- **API Endpoints Used**:
  - Quality Gate Status: `/api/qualitygates/project_status`
  - Issues: `/api/issues/search`
  - Security Hotspots: `/api/hotspots/search`
  - Code Metrics: `/api/measures/component`
- **Output**: Uses chalk for colored terminal output with structured sections for each metric type