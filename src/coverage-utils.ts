import { parseMeasureNumber } from "./measure-utils";

export interface ComponentMeasure {
  metric: string;
  value?: string;
  periods?: Array<{
    value: string;
  }>;
}

export interface ComponentTreeComponent {
  key: string;
  path?: string;
  measures?: ComponentMeasure[];
}

export interface ComponentTreeResponse {
  components?: ComponentTreeComponent[];
}

export interface CoverageFileDetail {
  path: string;
  uncovered: number;
  linesToCover?: number;
  coverage?: number;
}

export function buildCoverageDetailsUrl(
  projectKey: string,
  organization: string,
  prId: string,
  pageSize: number
): string {
  const params = new URLSearchParams({
    component: projectKey,
    metricKeys: "new_coverage,new_lines_to_cover,new_uncovered_lines",
    pullRequest: prId,
    organization,
    qualifiers: "FIL",
    ps: String(pageSize),
    metricPeriod: "1", // use new-code period for PRs
    additionalFields: "metrics",
  });

  return `https://sonarcloud.io/api/measures/component_tree?${params.toString()}`;
}

export function extractCoverageFileDetails(
  response: ComponentTreeResponse,
  projectKey: string
): CoverageFileDetail[] {
  const components = response.components || [];

  return components
    .map((component) => {
      const measures = component.measures || [];
      const uncovered = parseMeasureNumber(measures, "new_uncovered_lines") ?? 0;
      const linesToCover = parseMeasureNumber(measures, "new_lines_to_cover");
      const coverage = parseMeasureNumber(measures, "new_coverage");
      const path =
        component.path ||
        component.key.replace(`${projectKey}:`, "");

      return {
        path,
        uncovered,
        linesToCover,
        coverage,
      };
    })
    .filter((file) => file.uncovered > 0)
    .sort((a, b) => b.uncovered - a.uncovered);
}
