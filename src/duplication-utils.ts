import { Measure, parseMeasureNumber } from "./measure-utils";

export interface DuplicationComponentTreeResponse {
  components: Array<{
    key: string;
    path?: string;
    measures?: Measure[];
  }>;
}

export interface DuplicationFileSummary {
  key: string;
  path: string;
  newDuplicatedLinesDensity: number;
  duplicatedLines: number;
}

interface SonarDuplicationFile {
  key: string;
  name?: string;
}

interface SonarDuplicationBlock {
  from: number;
  size: number;
  _ref?: string;
}

interface SonarDuplicationGroup {
  blocks: SonarDuplicationBlock[];
}

export interface DuplicationBlocksResponse {
  duplications?: SonarDuplicationGroup[];
  files?: Record<string, SonarDuplicationFile>;
}

export interface DuplicationRange {
  startLine: number;
  endLine: number;
}

export interface DuplicationBlockDetail {
  range: DuplicationRange;
  otherRange: DuplicationRange;
  otherFileKey: string;
  otherFilePath: string;
  sameFile: boolean;
  displayText: string;
}

export function buildDuplicationFileDetailsUrl(
  projectKey: string,
  organization: string,
  pullRequestId: string,
  pageSize: number
): string {
  const url = new URL("https://sonarcloud.io/api/measures/component_tree");
  url.searchParams.set("component", projectKey);
  url.searchParams.set("organization", organization);
  url.searchParams.set("pullRequest", pullRequestId);
  url.searchParams.set("metricKeys", "new_duplicated_lines_density,duplicated_lines");
  url.searchParams.set("metricPeriod", "1");
  url.searchParams.set("qualifiers", "FIL");
  url.searchParams.set("ps", String(pageSize));
  url.searchParams.set("additionalFields", "metrics");
  return url.toString();
}

export function buildDuplicationBlocksUrl(
  componentKey: string,
  pullRequestId?: string
): string {
  const url = new URL("https://sonarcloud.io/api/duplications/show");
  url.searchParams.set("key", componentKey);
  if (pullRequestId) {
    url.searchParams.set("pullRequest", pullRequestId);
  }
  return url.toString();
}

export function extractDuplicationFileSummaries(
  response: DuplicationComponentTreeResponse,
  projectKey: string
): DuplicationFileSummary[] {
  return response.components
    .map((component) => {
      const newDuplicatedLinesDensity = parseMeasureNumber(
        component.measures,
        "new_duplicated_lines_density"
      ) ?? 0;
      const duplicatedLines = parseMeasureNumber(
        component.measures,
        "duplicated_lines"
      ) ?? 0;

      return {
        key: component.key,
        path: component.path ?? component.key.replace(`${projectKey}:`, ""),
        newDuplicatedLinesDensity,
        duplicatedLines,
      };
    })
    .filter(
      (component) =>
        component.newDuplicatedLinesDensity > 0 || component.duplicatedLines > 0
    )
    .sort((a, b) => {
      if (b.newDuplicatedLinesDensity !== a.newDuplicatedLinesDensity) {
        return b.newDuplicatedLinesDensity - a.newDuplicatedLinesDensity;
      }
      if (b.duplicatedLines !== a.duplicatedLines) {
        return b.duplicatedLines - a.duplicatedLines;
      }
      return a.path.localeCompare(b.path);
    });
}

export function extractDuplicationBlocks(
  response: DuplicationBlocksResponse,
  currentComponentKey: string
): DuplicationBlockDetail[] {
  const details: DuplicationBlockDetail[] = [];

  for (const duplication of response.duplications ?? []) {
    const blocks = duplication.blocks ?? [];
    for (let leftIndex = 0; leftIndex < blocks.length - 1; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < blocks.length; rightIndex += 1) {
        const leftFile = resolveFileRef(response.files, blocks[leftIndex]._ref, currentComponentKey);
        const rightFile = resolveFileRef(response.files, blocks[rightIndex]._ref, currentComponentKey);

        if (
          leftFile.key !== currentComponentKey &&
          rightFile.key !== currentComponentKey
        ) {
          continue;
        }

        const currentBlock = leftFile.key === currentComponentKey ? blocks[leftIndex] : blocks[rightIndex];
        const otherBlock = leftFile.key === currentComponentKey ? blocks[rightIndex] : blocks[leftIndex];
        const otherFile = leftFile.key === currentComponentKey ? rightFile : leftFile;

        const range = toRange(currentBlock);
        const otherRange = toRange(otherBlock);
        const sameFile = otherFile.key === currentComponentKey;

        details.push({
          range,
          otherRange,
          otherFileKey: otherFile.key,
          otherFilePath: otherFile.path,
          sameFile,
          displayText: sameFile
            ? `${formatRange(range)} <-> ${formatRange(otherRange)}`
            : `${formatRange(range)} <-> ${otherFile.path}:${formatRange(otherRange)}`,
        });
      }
    }
  }

  return details.sort((a, b) => {
    if (a.range.startLine !== b.range.startLine) {
      return a.range.startLine - b.range.startLine;
    }
    if (a.otherFilePath !== b.otherFilePath) {
      return a.otherFilePath.localeCompare(b.otherFilePath);
    }
    return a.otherRange.startLine - b.otherRange.startLine;
  });
}

function resolveFileRef(
  files: Record<string, SonarDuplicationFile> | undefined,
  ref: string | undefined,
  fallbackKey: string
): { key: string; path: string } {
  const file = ref ? files?.[ref] : undefined;
  const key = file?.key ?? fallbackKey;
  return {
    key,
    path: file?.name ?? stripProjectPrefix(key),
  };
}

function stripProjectPrefix(componentKey: string): string {
  const separatorIndex = componentKey.indexOf(":");
  if (separatorIndex === -1) {
    return componentKey;
  }
  return componentKey.slice(separatorIndex + 1);
}

function toRange(block: SonarDuplicationBlock): DuplicationRange {
  return {
    startLine: block.from,
    endLine: block.from + block.size - 1,
  };
}

function formatRange(range: DuplicationRange): string {
  return `L${range.startLine}-L${range.endLine}`;
}
