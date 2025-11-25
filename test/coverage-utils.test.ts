import assert from "assert";
import {
  buildCoverageDetailsUrl,
  extractCoverageFileDetails,
} from "../src/coverage-utils";

const sampleResponse = {
  components: [
    {
      key: "example-project:src/fileA.ts",
      path: "src/fileA.ts",
      measures: [
        { metric: "new_uncovered_lines", periods: [{ value: "2" }] },
        { metric: "new_lines_to_cover", periods: [{ value: "10" }] },
        { metric: "new_coverage", periods: [{ value: "80" }] },
      ],
    },
    {
      key: "example-project:src/fileB.ts",
      measures: [
        { metric: "new_uncovered_lines", periods: [{ value: "0" }] },
        { metric: "new_lines_to_cover", periods: [{ value: "5" }] },
        { metric: "new_coverage", periods: [{ value: "100" }] },
      ],
    },
    {
      key: "example-project:src/fileC.ts",
      measures: [
        { metric: "new_uncovered_lines", periods: [{ value: "1" }] },
      ],
    },
  ],
};

const details = extractCoverageFileDetails(
  sampleResponse,
  "example-project"
);

assert.strictEqual(details.length, 2);
assert.deepStrictEqual(details[0], {
  path: "src/fileA.ts",
  uncovered: 2,
  linesToCover: 10,
  coverage: 80,
});
assert.deepStrictEqual(details[1], {
  path: "src/fileC.ts",
  uncovered: 1,
  linesToCover: undefined,
  coverage: undefined,
});

const url = buildCoverageDetailsUrl(
  "example-project",
  "example-org",
  "123",
  500
);
const parsed = new URL(url);
const params = parsed.searchParams;

assert.strictEqual(parsed.pathname, "/api/measures/component_tree");
assert.strictEqual(params.get("component"), "example-project");
assert.strictEqual(params.get("organization"), "example-org");
assert.strictEqual(params.get("pullRequest"), "123");
assert.strictEqual(params.get("ps"), "500");
assert.strictEqual(params.get("metricPeriod"), "1");
assert.strictEqual(params.get("additionalFields"), "metrics");
assert.strictEqual(
  params.get("metricKeys"),
  "new_coverage,new_lines_to_cover,new_uncovered_lines"
);

console.log("coverage-utils tests passed");
