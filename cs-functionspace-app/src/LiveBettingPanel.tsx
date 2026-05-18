import { useState, useCallback, useMemo, useEffect, useRef, useContext } from 'react';
import type { Match } from './data';
import { BeliefBuilder } from './BeliefBuilder';
import { useMarkets, useMarket, usePositions, useBuy, useAuth, FunctionSpaceContext } from '@functionspace/react';
import { generateBelief, previewPayoutCurve } from '@functionspace/core';
import type { Region } from '@functionspace/core/src/math/generators.js';

const MARKET_TITLE = 'Counter Strike 2: NAVI vs FAZE — Map 1 Total Rounds';
const COLUMNS = 13;
const COLUMN_LABELS = ['13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', 'OT'];
const ROUND_VALUES = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25.5];

interface LiveBettingPanelProps {
  match: Match;
  onClose: () => void;
}

export function LiveBettingPanel({ match, onClose }: LiveBettingPanelProps) {
  const ctx = useContext(FunctionSpaceContext);
  const { user } = useAuth();
  const { markets, loading: marketsLoading } = useMarkets();
  const [bricks, setBricks] = useState<number[]>(new Array(COLUMNS).fill(0));
  const [stake, setStake] = useState('50');
  const [submitted, setSubmitted] = useState(false);
  const [liveMultipliers, setLiveMultipliers] = useState<(number | null)[]>(new Array(COLUMNS).fill(null));
  const [liveReturns, setLiveReturns] = useState<(number | null)[]>(new Array(COLUMNS).fill(null));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Find market by title
  const marketMeta = useMemo(() => markets?.find(m => m.title === MARKET_TITLE), [markets]);
  const marketId = marketMeta?.marketId;

  // Fetch full market state (populates cache for previewPayout)
  const { market } = useMarket(marketId ?? 0);

  const { positions, refetch: refetchPositions } = usePositions(marketId ?? 0, user?.username);
  const { execute: executeBuy } = useBuy(marketId ?? 0);

  // Extract consensus from real market: first 25 interior buckets → 13 columns
  // market.consensus has length numBuckets+2. We take indices 1..25 and group into 13 columns.
  const { consensusP, lowerBound, upperBound, numBuckets } = useMemo(() => {
    if (!market) return { consensusP: null, lowerBound: 12.5, upperBound: 26, numBuckets: 50 };
    const c = market.consensus; // length numBuckets+2
    // Map 13 columns to bucket indices: column i maps to bucket (i * (numBuckets+1) / (COLUMNS-1))
    // But actually: columns represent rounds 13-25, market range is lowerBound..upperBound
    // Each column's center in outcome space:
    const lb = market.config.lowerBound;
    const ub = market.config.upperBound;
    const nb = market.config.numBuckets;
    const pcts = ROUND_VALUES.map(v => {
      const u = (v - lb) / (ub - lb);
      const idx = Math.round(u * (nb + 1));
      return (c[idx] ?? 0) * 100;
    });
    // Normalize so they sum to ~100
    const sum = pcts.reduce((a, b) => a + b, 0);
    const normalized = sum > 0 ? pcts.map(p => p * 100 / sum) : pcts;
    return { consensusP: normalized, lowerBound: lb, upperBound: ub, numBuckets: nb };
  }, [market]);

  const totalBricks = bricks.reduce((a, b) => a + b, 0);
  const stakeNum = parseFloat(stake) || 0;

  // Preview payout when bricks change (debounced)
  useEffect(() => {
    if (!market || !marketId || !ctx?.client || totalBricks === 0 || stakeNum <= 0) {
      setLiveMultipliers(new Array(COLUMNS).fill(null));
      setLiveReturns(new Array(COLUMNS).fill(null));
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const lb = market.config.lowerBound;
        const ub = market.config.upperBound;
        const nb = market.config.numBuckets;
        const spread = (ub - lb) * 0.06;
        const regions: Region[] = [];
        for (let col = 0; col < COLUMNS; col++) {
          if (bricks[col] === 0) continue;
          regions.push({ type: 'point', center: ROUND_VALUES[col], spread, weight: bricks[col] });
        }
        const belief = generateBelief(regions, nb, lb, ub);
        const curve = await previewPayoutCurve(ctx.client, marketId, belief, stakeNum, nb);
        console.log('Market bounds:', lb, ub, 'numBuckets:', nb);
        console.log('Curve previews count:', curve.previews.length);
        console.log('First 5 previews:', curve.previews.slice(0, 5));
        console.log('Max payout:', curve.maxPayout, 'at outcome:', curve.maxPayoutOutcome);
        // Map payout curve previews to 13 columns
        // Preview outcomes are in normalized [0,1] space
        const mults: (number | null)[] = [];
        const rets: (number | null)[] = [];
        for (let col = 0; col < COLUMNS; col++) {
          const v = (ROUND_VALUES[col] - lb) / (ub - lb); // normalize to [0,1]
          const closest = curve.previews.reduce((best, p) =>
            Math.abs(p.outcome - v) < Math.abs(best.outcome - v) ? p : best
          , curve.previews[0]);
          if (closest && stakeNum > 0) {
            const mult = closest.payout / stakeNum;
            mults.push(mult < 0.05 ? null : mult);
            rets.push(closest.payout > 0.01 ? closest.payout : null);
          } else {
            mults.push(null);
            rets.push(null);
          }
        }
        setLiveMultipliers(mults);
        setLiveReturns(rets);
      } catch (e) { console.error('Preview payout failed:', e); }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [bricks, stakeNum, market, marketId, totalBricks, ctx?.client]);

  const handleSubmit = useCallback(async () => {
    if (!market || !marketId || totalBricks < 3 || stakeNum <= 0) return;
    const lb = market.config.lowerBound;
    const ub = market.config.upperBound;
    const nb = market.config.numBuckets;
    const spread = (ub - lb) * 0.06;
    const regions: Region[] = [];
    for (let col = 0; col < COLUMNS; col++) {
      if (bricks[col] === 0) continue;
      regions.push({ type: 'point', center: ROUND_VALUES[col], spread, weight: bricks[col] });
    }
    const belief = generateBelief(regions, nb, lb, ub);
    try {
      await executeBuy(belief, stakeNum);
      setSubmitted(true);
      refetchPositions();
    } catch (e) {
      alert('Trade failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [market, marketId, bricks, stakeNum, totalBricks, executeBuy, refetchPositions]);

  if (marketsLoading || !market) {
    return (
      <>
        <div className="panel-backdrop" onClick={onClose} />
        <div className="betting-panel">
          <div className="panel-header">
            <button className="panel-close" onClick={onClose}>×</button>
            <span className="panel-title">Loading market...</span>
          </div>
          <div className="panel-scroll" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
            {marketsLoading ? 'Fetching market data...' : !marketId ? 'Market not found. Make sure you are logged in.' : 'Loading market state...'}
          </div>
        </div>
      </>
    );
  }

  const canSubmit = totalBricks >= 3 && stakeNum > 0 && !!ctx?.client;

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <div className="betting-panel">
        <div className="panel-header">
          <button className="panel-close" onClick={onClose}>×</button>
          <span className="panel-title">{match.teamA.abbr} vs {match.teamB.abbr} · Map 1 · Rounds (LIVE)</span>
        </div>

        <div className="panel-scroll">
          <div className="panel-context">
            <div className="panel-context-teams">
              <img src={match.teamA.logo} alt={match.teamA.abbr} className="panel-team-logo" />
              <span className="panel-team-name">{match.teamA.abbr}</span>
              <span className="panel-vs">vs</span>
              <span className="panel-team-name">{match.teamB.abbr}</span>
              <img src={match.teamB.logo} alt={match.teamB.abbr} className="panel-team-logo" />
            </div>
            <div className="panel-context-meta">{match.tournament} · {match.format} · Map 1</div>
            <div className="panel-context-meta" style={{ color: '#16a34a', fontWeight: 600 }}>● LIVE MARKET — Real API</div>
          </div>

          {!submitted ? (
            <>
              <div className="panel-section">
                <div className="panel-section-header">
                  <span>Map 1 · Total Rounds</span>
                </div>
                <BeliefBuilder
                  bricks={bricks}
                  onBricksChange={setBricks}
                  consensusP={consensusP ?? undefined}
                  columnLabels={COLUMN_LABELS}
                  roundValues={ROUND_VALUES}
                  columns={COLUMNS}
                  lowerBound={lowerBound}
                  upperBound={upperBound}
                  numBuckets={numBuckets}
                  externalMultipliers={liveMultipliers}
                  externalReturns={liveReturns}
                />
              </div>

              <div className="panel-section panel-summary">
                <div className="stake-row">
                  <label>Stake</label>
                  <div className="stake-input-wrap">
                    <input className="stake-input" type="number" value={stake} onChange={e => setStake(e.target.value)} />
                    <span className="stake-currency">USD</span>
                  </div>
                </div>
                <div className="stake-quick">
                  {[10, 25, 50, 100].map(s => (
                    <button key={s} className={`stake-btn ${stake === String(s) ? 'active' : ''}`} onClick={() => setStake(String(s))}>${s}</button>
                  ))}
                </div>
              </div>

              <div className="panel-submit">
                <button className="submit-btn" disabled={!canSubmit} onClick={handleSubmit}>
                  Place Bet — ${stakeNum}
                </button>
                {!canSubmit && <p className="submit-hint">
                  {!ctx?.client ? 'Log in to place bets' : 'Add at least 3 bricks to place a bet'}
                </p>}
              </div>
            </>
          ) : (
            <div className="panel-confirmation">
              <div className="confirm-check">✓</div>
              <div className="confirm-title">Bet placed!</div>
              <div className="confirm-meta">Map 1 · Total Rounds · ${stake} stake</div>
              <button className="confirm-btn primary" onClick={() => { setSubmitted(false); setBricks(new Array(COLUMNS).fill(0)); }}>Place Another Bet</button>
            </div>
          )}

          {/* Positions list */}
          {positions && positions.length > 0 && user && (
            <div className="panel-section">
              <div className="panel-section-title">Your Positions</div>
              <div className="panel-positions">
                {positions.filter(p => p.status === 'open' && p.owner === user.username).map(p => (
                  <div key={p.positionId} className="panel-position-row">
                    <span>#{p.positionId}</span>
                    <span>${(p.collateral ?? 0).toFixed(2)}</span>
                    <span>{(p.claims ?? 0).toFixed(2)} claims</span>
                    <span className="pos-status">{p.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
