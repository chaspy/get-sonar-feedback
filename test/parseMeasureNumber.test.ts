import assert from "assert";
import { parseMeasureNumber, Measure } from "../src/measure-utils";

type M = Measure;

const measures: M[] = [
  { metric: "new_coverage", periods: [{ value: "85.5" }] },
  { metric: "new_uncovered_lines", value: "3" },
];

// value from periods
assert.strictEqual(parseMeasureNumber(measures, "new_coverage"), 85.5);

// value from value field
assert.strictEqual(parseMeasureNumber(measures, "new_uncovered_lines"), 3);

// missing metric
assert.strictEqual(parseMeasureNumber(measures, "unknown"), undefined);

// NaN handling
const badMeasures: M[] = [{ metric: "new_coverage", value: "abc" }];
assert.strictEqual(parseMeasureNumber(badMeasures, "new_coverage"), undefined);

// empty measures
assert.strictEqual(parseMeasureNumber([], "new_coverage"), undefined);

console.log("parseMeasureNumber tests passed");
