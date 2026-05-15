import { mkdir, writeFile } from 'node:fs/promises';
import {
  FSClient,
  generateBelief,
  loginUser,
  passwordlessLoginUser,
  previewPayoutCurve,
  queryMarketState,
  validateBeliefVector,
} from '@functionspace/core';
import type { BeliefVector, MarketState, PayoutCurve, RangeInput } from '@functionspace/core';

const BASE_URL = process.env.FS_BASE_URL ?? 'https://fs-engine-api-dev.onrender.com';
const MARKET_ID = Number(process.env.FS_MARKET_ID ?? 212);
const USERNAME = process.env.FS_USERNAME ?? `codex_diag_${Date.now().toString(36)}`;
const PASSWORD = process.env.FS_PASSWORD;
const COLLATERAL = Number(process.env.FS_COLLATERAL ?? 100);
const TOTAL_BRICKS = Number(process.env.FS_TOTAL_BRICKS ?? 20);
const VISUAL_COLUMNS = Number(process.env.FS_VISUAL_COLUMNS ?? 16);
const NUM_OUTCOMES = Number(process.env.FS_NUM_OUTCOMES ?? VISUAL_COLUMNS);
const REPORT_PATH = process.env.FS_REPORT_PATH ?? 'diagnostics/brick-payout-diagnostic.md';

type ScenarioId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5';

interface VisualColumn {
  index: number;
  low: number;
  high: number;
  center: number;
  consensusMass: number;
}

interface Scenario {
  id: ScenarioId;
  name: string;
  brickCounts: number[];
}

interface ColumnPayout {
  column: number;
  center: number;
  bricks: number;
  consensusMass: number;
  beliefMass: number;
  previewOutcome: number;
  payout: number;
  profitLoss: number;
}

interface ScenarioResult {
  scenario: Scenario;
  regions: RangeInput[];
  belief: BeliefVector;
  beliefSum: number;
  regionWeightSum: number;
  curve: PayoutCurve;
  durationMs: number;
  columns: ColumnPayout[];
  assertions: Array<{ name: string; pass: boolean; detail: string }>;
}

function fmt(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : String(value);
}

function money(value: number): string {
  return `$${fmt(value, 2)}`;
}

function markdownTable(headers: string[], rows: Array<Array<string | number>>): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function makeColumns(market: MarketState): VisualColumn[] {
  const { lowerBound, upperBound } = market.config;
  const width = (upperBound - lowerBound) / VISUAL_COLUMNS;
  return Array.from({ length: VISUAL_COLUMNS }, (_, index) => {
    const low = lowerBound + index * width;
    const high = low + width;
    return {
      index,
      low,
      high,
      center: low + width / 2,
      consensusMass: massInRange(market.consensus, market, low, high, index === VISUAL_COLUMNS - 1),
    };
  });
}

function coefficientOutcome(index: number, vectorLength: number, lowerBound: number, upperBound: number): number {
  return lowerBound + (index / (vectorLength - 1)) * (upperBound - lowerBound);
}

function massInRange(
  coefficients: number[],
  market: MarketState,
  low: number,
  high: number,
  includeHigh: boolean,
): number {
  const { lowerBound, upperBound } = market.config;
  let mass = 0;
  for (let index = 0; index < coefficients.length; index += 1) {
    const outcome = coefficientOutcome(index, coefficients.length, lowerBound, upperBound);
    const inRange = includeHigh ? outcome >= low && outcome <= high : outcome >= low && outcome < high;
    if (inRange) mass += coefficients[index];
  }
  return mass;
}

function buildRegions(brickCounts: number[], market: MarketState): RangeInput[] {
  const { lowerBound, upperBound } = market.config;
  const width = (upperBound - lowerBound) / brickCounts.length;
  const bricksPlaced = brickCounts.reduce((sum, count) => sum + count, 0);
  const bricksRemaining = Math.max(0, TOTAL_BRICKS - bricksPlaced);
  const regions: RangeInput[] = [];

  brickCounts.forEach((brickCount, index) => {
    if (brickCount <= 0) return;
    const low = lowerBound + index * width;
    regions.push({
      low,
      high: low + width,
      weight: brickCount / TOTAL_BRICKS,
      sharpness: 1,
    });
  });

  if (bricksRemaining > 0) {
    regions.push({
      low: lowerBound,
      high: upperBound,
      weight: bricksRemaining / TOTAL_BRICKS,
      sharpness: 1,
    });
  }

  return regions;
}

function buildBelief(brickCounts: number[], market: MarketState): { regions: RangeInput[]; belief: BeliefVector } {
  const { numBuckets, lowerBound, upperBound } = market.config;
  const regions = buildRegions(brickCounts, market);
  const regionWeightSum = regions.reduce((sum, region) => sum + (region.weight ?? 1), 0);
  if (Math.abs(regionWeightSum - 1) > 1e-9) {
    throw new Error(`Region weights must sum to 1.0; got ${regionWeightSum}`);
  }
  const belief = generateBelief(
    regions.map((region) => ({ type: 'range' as const, ...region })),
    numBuckets,
    lowerBound,
    upperBound,
  );
  validateBeliefVector(belief, numBuckets);
  return { regions, belief };
}

function mapCurveToColumns(
  curve: PayoutCurve,
  scenario: Scenario,
  columns: VisualColumn[],
  belief: BeliefVector,
  market: MarketState,
): ColumnPayout[] {
  const previews = curve.previews;
  return columns.map((column) => {
    const previewIndex = Math.min(
      previews.length - 1,
      Math.round((column.index / Math.max(1, columns.length - 1)) * (previews.length - 1)),
    );
    const preview = previews[previewIndex];
    return {
      column: column.index,
      center: column.center,
      bricks: scenario.brickCounts[column.index],
      consensusMass: column.consensusMass,
      beliefMass: massInRange(belief, market, column.low, column.high, column.index === columns.length - 1),
      previewOutcome: preview.outcome,
      payout: preview.payout,
      profitLoss: preview.profitLoss,
    };
  });
}

function maxBy<T>(items: T[], getValue: (item: T) => number): T {
  return items.reduce((best, item) => (getValue(item) > getValue(best) ? item : best), items[0]);
}

function minBy<T>(items: T[], getValue: (item: T) => number): T {
  return items.reduce((best, item) => (getValue(item) < getValue(best) ? item : best), items[0]);
}

function brickCounts(entries: Array<[number, number]>): number[] {
  const counts = new Array(VISUAL_COLUMNS).fill(0);
  for (const [index, count] of entries) counts[index] = count;
  return counts;
}

function assertScenario(
  id: ScenarioId,
  columns: ColumnPayout[],
  peak: VisualColumn,
  trough: VisualColumn,
  prior?: Record<string, ScenarioResult>,
  curve?: PayoutCurve,
  market?: MarketState,
): Array<{ name: string; pass: boolean; detail: string }> {
  const peakPayout = columns[peak.index].payout;
  const troughPayout = columns[trough.index].payout;
  const maxColumn = maxBy(columns, (column) => column.payout);
  const nonTroughMax = maxBy(columns.filter((column) => column.column !== trough.index), (column) => column.payout);
  const assertions: Array<{ name: string; pass: boolean; detail: string }> = [];

  const add = (name: string, pass: boolean, detail: string) => assertions.push({ name, pass, detail });

  if (id === 'S1') {
    add('S1a: peak consensus payout < trough consensus payout', peakPayout < troughPayout, `${money(peakPayout)} < ${money(troughPayout)}`);
    add('S1b: no column payout is zero', columns.every((column) => column.payout !== 0), `min payout ${money(minBy(columns, (column) => column.payout).payout)}`);
  }

  if (id === 'S2') {
    add('S2: payout at consensus peak < collateral', peakPayout < COLLATERAL, `${money(peakPayout)} < ${money(COLLATERAL)}`);
  }

  if (id === 'S3') {
    const maxOutcome = curve && market ? normalizedOutcomeToMarket(curve.maxPayoutOutcome, market) : Number.NaN;
    add('S3a: trough column payout is maximum', maxColumn.column === trough.index, `max column ${maxColumn.column}; trough column ${trough.index}`);
    add('S3b: trough column payout > collateral', troughPayout > COLLATERAL, `${money(troughPayout)} > ${money(COLLATERAL)}`);
    add('S3c: all other columns below 10% collateral', nonTroughMax.payout < COLLATERAL * 0.1, `largest non-trough payout ${money(nonTroughMax.payout)}`);
    add('S3d: SDK maxPayoutOutcome matches trough center', Math.abs(maxOutcome - trough.center) <= (columns[1].center - columns[0].center), `SDK max outcome ${fmt(maxOutcome)}; trough center ${fmt(trough.center)}`);
  }

  if (id === 'S4') {
    const s1Trough = prior?.S1.columns[trough.index].payout ?? Number.NaN;
    const s3Trough = prior?.S3.columns[trough.index].payout ?? Number.NaN;
    add('S4a: trough column payout is maximum', maxColumn.column === trough.index, `max column ${maxColumn.column}; trough column ${trough.index}`);
    add('S4b: trough payout is between S1 and S3 trough payouts', troughPayout > s1Trough && troughPayout < s3Trough, `${money(s1Trough)} < ${money(troughPayout)} < ${money(s3Trough)}`);
  }

  if (id === 'S5') {
    add('S5: trough payout > peak payout', troughPayout > peakPayout, `${money(troughPayout)} > ${money(peakPayout)}`);
  }

  return assertions;
}

function normalizedOutcomeToMarket(outcome: number, market: MarketState): number {
  const { lowerBound, upperBound } = market.config;
  if (outcome >= 0 && outcome <= 1 && upperBound - lowerBound > 1) {
    return lowerBound + outcome * (upperBound - lowerBound);
  }
  return outcome;
}

async function authenticate(client: FSClient): Promise<string> {
  if (PASSWORD) {
    const result = await loginUser(client, USERNAME, PASSWORD);
    client.setToken(result.token);
    return `password login as ${result.user.username}`;
  }
  const result = await passwordlessLoginUser(client, USERNAME);
  client.setToken(result.token);
  return `passwordless ${result.action} as ${result.user.username}`;
}

async function runScenario(
  client: FSClient,
  market: MarketState,
  columns: VisualColumn[],
  scenario: Scenario,
): Promise<ScenarioResult> {
  const { regions, belief } = buildBelief(scenario.brickCounts, market);
  const started = Date.now();
  const curve = await previewPayoutCurve(client, MARKET_ID, belief, COLLATERAL, market.config.numBuckets, NUM_OUTCOMES);
  const durationMs = Date.now() - started;
  return {
    scenario,
    regions,
    belief,
    beliefSum: belief.reduce((sum, value) => sum + value, 0),
    regionWeightSum: regions.reduce((sum, region) => sum + (region.weight ?? 1), 0),
    curve,
    durationMs,
    columns: mapCurveToColumns(curve, scenario, columns, belief, market),
    assertions: [],
  };
}

function renderReport(params: {
  authSummary: string;
  market: MarketState;
  peak: VisualColumn;
  trough: VisualColumn;
  results: ScenarioResult[];
}): string {
  const { authSummary, market, peak, trough, results } = params;
  const lines: string[] = [];
  const allAssertions = results.flatMap((result) => result.assertions.map((assertion) => ({ scenario: result.scenario.id, ...assertion })));
  const failedAssertions = allAssertions.filter((assertion) => !assertion.pass);

  lines.push('# Brick-Drop Payout Diagnostic');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Endpoint: \`${BASE_URL}\``);
  lines.push(`Auth: ${authSummary}`);
  lines.push(`Market: ${market.marketId} — ${market.title}`);
  lines.push(`Collateral: ${money(COLLATERAL)}`);
  lines.push(`Visual columns: ${VISUAL_COLUMNS}`);
  lines.push(`Preview outcomes requested: ${NUM_OUTCOMES}`);
  lines.push('');
  lines.push('## Market Config');
  lines.push('');
  lines.push(markdownTable(
    ['numBuckets', 'lowerBound', 'upperBound', 'xAxisUnits', 'resolutionState'],
    [[market.config.numBuckets, market.config.lowerBound, market.config.upperBound, market.xAxisUnits || '(none)', market.resolutionState]],
  ));
  lines.push('');
  lines.push('## Consensus Columns');
  lines.push('');
  lines.push(`Consensus peak column: ${peak.index} (${fmt(peak.center)}), mass ${fmt(peak.consensusMass, 6)}`);
  lines.push(`Consensus trough column: ${trough.index} (${fmt(trough.center)}), mass ${fmt(trough.consensusMass, 6)}`);
  lines.push('');
  lines.push(markdownTable(
    ['Column', 'Center', 'Consensus mass'],
    makeColumns(market).map((column) => [column.index, fmt(column.center), fmt(column.consensusMass, 8)]),
  ));
  lines.push('');

  for (const result of results) {
    lines.push(`## ${result.scenario.id} — ${result.scenario.name}`);
    lines.push('');
    lines.push(`Preview duration: ${result.durationMs}ms`);
    lines.push(`Belief vector length: ${result.belief.length}`);
    lines.push(`Belief vector sum: ${fmt(result.beliefSum, 10)}`);
    lines.push(`Region weight sum: ${fmt(result.regionWeightSum, 10)}`);
    lines.push(`SDK maxPayout: ${money(result.curve.maxPayout)}`);
    lines.push(`SDK maxPayoutOutcome raw: ${fmt(result.curve.maxPayoutOutcome, 6)}`);
    lines.push(`SDK maxPayoutOutcome mapped: ${fmt(normalizedOutcomeToMarket(result.curve.maxPayoutOutcome, market), 2)}`);
    lines.push('');
    lines.push('Regions:');
    lines.push('');
    lines.push(markdownTable(
      ['low', 'high', 'weight', 'sharpness'],
      result.regions.map((region) => [fmt(region.low), fmt(region.high), fmt(region.weight ?? 1, 6), region.sharpness ?? '(default)']),
    ));
    lines.push('');
    lines.push('Per-column SDK payouts:');
    lines.push('');
    lines.push(markdownTable(
      ['Column', 'Center', 'Bricks', 'Consensus mass', 'Belief mass', 'Preview outcome', 'Payout', 'P/L'],
      result.columns.map((column) => [
        column.column,
        fmt(column.center),
        column.bricks,
        fmt(column.consensusMass, 8),
        fmt(column.beliefMass, 6),
        fmt(column.previewOutcome, 6),
        money(column.payout),
        money(column.profitLoss),
      ]),
    ));
    lines.push('');
    lines.push('Assertions:');
    lines.push('');
    lines.push(markdownTable(
      ['Result', 'Condition', 'Detail'],
      result.assertions.map((assertion) => [assertion.pass ? 'PASS' : 'FAIL', assertion.name, assertion.detail]),
    ));
    lines.push('');
  }

  lines.push('## Summary');
  lines.push('');
  lines.push(`Assertions passed: ${allAssertions.length - failedAssertions.length}/${allAssertions.length}`);
  if (failedAssertions.length > 0) {
    lines.push('');
    lines.push('Failed assertions:');
    lines.push('');
    lines.push(markdownTable(
      ['Scenario', 'Condition', 'Detail'],
      failedAssertions.map((assertion) => [assertion.scenario, assertion.name, assertion.detail]),
    ));
  }
  lines.push('');
  lines.push('Interpretation note: payout values above come directly from `previewPayoutCurve`; the script does not implement payout math.');
  lines.push('');

  return lines.join('\n');
}

async function main() {
  const client = new FSClient({ baseUrl: BASE_URL });
  const authSummary = await authenticate(client);
  const market = await queryMarketState(client, MARKET_ID);
  const columns = makeColumns(market);
  const peak = maxBy(columns, (column) => column.consensusMass);
  const trough = minBy(columns, (column) => column.consensusMass);

  const scenarios: Scenario[] = [
    { id: 'S1', name: 'Uniform belief: no bricks placed', brickCounts: brickCounts([]) },
    { id: 'S2', name: 'All bricks on consensus peak column', brickCounts: brickCounts([[peak.index, TOTAL_BRICKS]]) },
    { id: 'S3', name: 'All bricks on consensus trough column', brickCounts: brickCounts([[trough.index, TOTAL_BRICKS]]) },
    { id: 'S4', name: 'Half bricks on trough, half uniform floor', brickCounts: brickCounts([[trough.index, TOTAL_BRICKS / 2]]) },
    { id: 'S5', name: 'Split bricks equally on trough and peak', brickCounts: brickCounts([[trough.index, TOTAL_BRICKS / 2], [peak.index, TOTAL_BRICKS / 2]]) },
  ];

  const prior: Record<string, ScenarioResult> = {};
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    const result = await runScenario(client, market, columns, scenario);
    result.assertions = assertScenario(scenario.id, result.columns, peak, trough, prior, result.curve, market);
    prior[scenario.id] = result;
    results.push(result);
  }

  const report = renderReport({ authSummary, market, peak, trough, results });
  await mkdir(REPORT_PATH.split('/').slice(0, -1).join('/') || '.', { recursive: true });
  await writeFile(REPORT_PATH, report, 'utf8');

  const failed = results.flatMap((result) => result.assertions).filter((assertion) => !assertion.pass);
  console.log(`Wrote report to ${REPORT_PATH}`);
  console.log(`Assertions passed: ${results.flatMap((result) => result.assertions).length - failed.length}/${results.flatMap((result) => result.assertions).length}`);
  if (failed.length > 0) {
    console.error('One or more payout pipeline assertions failed. See the Markdown report for details.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
