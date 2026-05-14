import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';
import {
  FSClient,
  generateRange,
  passwordlessLoginUser,
  previewPayoutCurve,
  queryMarketState,
  validateBeliefVector,
} from '@functionspace/core';

const BASE_URL = process.env.FS_BASE_URL ?? 'https://fs-engine-api-dev.onrender.com';
const MARKET_ID = Number(process.env.FS_MARKET_ID ?? 212);
const USERNAME = process.env.FS_USERNAME ?? `preview_repro_${Date.now().toString(36)}`;
const COLLATERAL = Number(process.env.FS_COLLATERAL ?? 100);
const REPORT_PATH = process.env.FS_REPORT_PATH ?? 'diagnostics/preview-payout-contract-repro.md';

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function mapOutcome(outcome: number, lowerBound: number, upperBound: number): number {
  if (outcome >= 0 && outcome <= 1 && upperBound - lowerBound > 1) {
    return lowerBound + outcome * (upperBound - lowerBound);
  }
  return outcome;
}

function table(headers: string[], rows: Array<Array<string | number>>): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

async function main() {
  const client = new FSClient({ baseUrl: BASE_URL });
  const auth = await passwordlessLoginUser(client, USERNAME);
  client.setToken(auth.token);

  const market = await queryMarketState(client, MARKET_ID);
  const { numBuckets, lowerBound, upperBound } = market.config;
  const NUM_OUTCOMES = Number(process.env.FS_NUM_OUTCOMES ?? numBuckets);

  console.log(`Market ${MARKET_ID} has numBuckets=${numBuckets}, lowerBound=${lowerBound}, upperBound=${upperBound}`);
  const width = upperBound - lowerBound;
  const bucketWidth = width / numBuckets;

  // Minimal hypothetical position: exactly one engine bucket in the middle of the outcome space.
  const targetBucket = Math.floor(numBuckets / 2);
  const rangeLow = lowerBound + bucketWidth * targetBucket;
  const rangeHigh = rangeLow + bucketWidth;
  console.log(`bucket width=${bucketWidth}, target bucket=${targetBucket}, testing range [${rangeLow}, ${rangeHigh}]`);
  const rangeCenter = (rangeLow + rangeHigh) / 2;
  const belief = generateRange(rangeLow, rangeHigh, numBuckets, lowerBound, upperBound, 1);
  validateBeliefVector(belief, numBuckets);

  const started = Date.now();
  const curve = await previewPayoutCurve(client, MARKET_ID, belief, COLLATERAL, numBuckets, NUM_OUTCOMES);
  // serialize curve to json
  const curveJson = JSON.stringify(curve);
  await writeFile('diagnostics/preview-payout-curve.json', curveJson, 'utf8');
  console.log(`Generated ${curve.previews.length} preview points`);
  console.log(`target bucket preview: ${curve.previews[targetBucket] ? `outcome=${curve.previews[targetBucket].outcome} payout=${money(curve.previews[targetBucket].payout)}` : 'N/A'}`);
  const durationMs = Date.now() - started;
  const mappedOutcome = mapOutcome(curve.previews[targetBucket].outcome, lowerBound, upperBound);
  console.log(`Mapped target bucket payout to outcome space: ${mappedOutcome}`);
  const outcomeInsideRange = mappedOutcome >= rangeLow && mappedOutcome <= rangeHigh;
  if (outcomeInsideRange) {
    console.log(`PASS: mappedOutcome ${curve.previews[targetBucket].outcome} maps to ${mappedOutcome}, which is inside the belief range [${rangeLow}, ${rangeHigh}]`);
  }
  let bucketsLargerCount = 0;
  for (let i = 0; i < curve.previews.length; i++) {
    const preview = curve.previews[i];
    if (curve.previews[targetBucket].payout < preview.payout) {
      // console.warn(`Warning: payout for 100% concentrated target bucket is less than for bucket #${i}`);
      bucketsLargerCount++;
    }
  }
  console.log(`Total buckets with larger payout than target bucket: ${bucketsLargerCount} out of ${curve.previews.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
