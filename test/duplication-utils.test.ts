import assert from "node:assert";
import {
  buildDuplicationBlocksUrl,
  buildDuplicationFileDetailsUrl,
  extractDuplicationBlocks,
  extractDuplicationFileSummaries,
} from "../src/duplication-utils";

const componentTreeResponse = {
  components: [
    {
      key: "example-project:src/duplicated.ts",
      path: "src/duplicated.ts",
      measures: [
        { metric: "new_duplicated_lines_density", periods: [{ value: "25.714285714285715" }] },
        { metric: "duplicated_lines", value: "36" },
      ],
    },
    {
      key: "example-project:src/secondary.ts",
      measures: [
        { metric: "new_duplicated_lines_density", periods: [{ value: "10" }] },
        { metric: "duplicated_lines", value: "12" },
      ],
    },
    {
      key: "example-project:src/clean.ts",
      path: "src/clean.ts",
      measures: [
        { metric: "new_duplicated_lines_density", periods: [{ value: "0" }] },
        { metric: "duplicated_lines", value: "0" },
      ],
    },
  ],
};

const summaries = extractDuplicationFileSummaries(
  componentTreeResponse,
  "example-project"
);

assert.strictEqual(summaries.length, 2);
assert.deepStrictEqual(summaries[0], {
  key: "example-project:src/duplicated.ts",
  path: "src/duplicated.ts",
  newDuplicatedLinesDensity: 25.714285714285715,
  duplicatedLines: 36,
});
assert.deepStrictEqual(summaries[1], {
  key: "example-project:src/secondary.ts",
  path: "src/secondary.ts",
  newDuplicatedLinesDensity: 10,
  duplicatedLines: 12,
});

const sameFileBlocks = extractDuplicationBlocks(
  {
    duplications: [
      {
        blocks: [
          { from: 1064, size: 36, _ref: "1" },
          { from: 1186, size: 36, _ref: "1" },
        ],
      },
    ],
    files: {
      "1": {
        key: "example-project:src/duplicated.ts",
        name: "src/duplicated.ts",
      },
    },
  },
  "example-project:src/duplicated.ts"
);

assert.deepStrictEqual(sameFileBlocks, [
  {
    range: { startLine: 1064, endLine: 1099 },
    otherRange: { startLine: 1186, endLine: 1221 },
    otherFileKey: "example-project:src/duplicated.ts",
    otherFilePath: "src/duplicated.ts",
    sameFile: true,
    displayText: "L1064-L1099 <-> L1186-L1221",
  },
]);

const crossFileBlocks = extractDuplicationBlocks(
  {
    duplications: [
      {
        blocks: [
          { from: 40, size: 5, _ref: "1" },
          { from: 12, size: 5, _ref: "2" },
        ],
      },
    ],
    files: {
      "1": {
        key: "example-project:src/current.ts",
        name: "src/current.ts",
      },
      "2": {
        key: "example-project:src/other.ts",
        name: "src/other.ts",
      },
    },
  },
  "example-project:src/current.ts"
);

assert.deepStrictEqual(crossFileBlocks, [
  {
    range: { startLine: 40, endLine: 44 },
    otherRange: { startLine: 12, endLine: 16 },
    otherFileKey: "example-project:src/other.ts",
    otherFilePath: "src/other.ts",
    sameFile: false,
    displayText: "L40-L44 <-> src/other.ts:L12-L16",
  },
]);

const treeUrl = buildDuplicationFileDetailsUrl(
  "example-project",
  "example-org",
  "123",
  500
);
const treeParams = new URL(treeUrl).searchParams;
assert.strictEqual(treeParams.get("component"), "example-project");
assert.strictEqual(treeParams.get("organization"), "example-org");
assert.strictEqual(treeParams.get("pullRequest"), "123");
assert.strictEqual(treeParams.get("metricKeys"), "new_duplicated_lines_density,duplicated_lines");
assert.strictEqual(treeParams.get("qualifiers"), "FIL");
assert.strictEqual(treeParams.get("metricPeriod"), "1");
assert.strictEqual(treeParams.get("ps"), "500");

const duplicationUrl = buildDuplicationBlocksUrl("example-project:src/duplicated.ts");
const duplicationParsed = new URL(duplicationUrl);
assert.strictEqual(duplicationParsed.pathname, "/api/duplications/show");
assert.strictEqual(
  duplicationParsed.searchParams.get("key"),
  "example-project:src/duplicated.ts"
);

console.log("duplication-utils tests passed");
