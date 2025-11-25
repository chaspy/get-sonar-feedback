export interface Measure {
  metric: string;
  value?: string;
  periods?: Array<{
    value: string;
  }>;
}

export function parseMeasureNumber(
  measures: Measure[] | undefined,
  metric: string
): number | undefined {
  if (!measures) return undefined;
  const measure = measures.find((m) => m.metric === metric);
  if (!measure) return undefined;

  const rawValue = measure.periods?.[0]?.value ?? measure.value;
  if (rawValue === undefined) return undefined;

  const parsed = Number(rawValue);
  return Number.isNaN(parsed) ? undefined : parsed;
}
