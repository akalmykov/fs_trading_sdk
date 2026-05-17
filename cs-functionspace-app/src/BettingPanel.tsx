import { useState } from 'react';
import type { Match } from './data';
import { BeliefBuilder } from './BeliefBuilder';

interface BettingPanelProps {
  match: Match;
  onClose: () => void;
}

const QUICK_STAKES = [10, 25, 50, 100];

export function BettingPanel({ match, onClose }: BettingPanelProps) {
  const [activeMarket, setActiveMarket] = useState(match.markets[0]);
  const [stake, setStake] = useState('50');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [evOpen, setEvOpen] = useState(false);
  const [beliefState, setBeliefState] = useState<{ userMean: number; totalBricks: number } | null>(null);

  const stakeNum = parseFloat(stake) || 0;
  const canSubmit = (beliefState?.totalBricks ?? 0) >= 3 && stakeNum > 0;

  const userMean = beliefState?.userMean ?? null;

  const marketMean = 21.9; // consensus mean from BeliefBuilder
  const edge = userMean !== null ? (userMean - marketMean).toFixed(1) : null;
  const estPayout = stakeNum > 0 && userMean !== null ? (stakeNum * 2.36).toFixed(0) : null;

  const handleSubmit = () => {
    setSubmitting(true);
    setTimeout(() => { setSubmitting(false); setSubmitted(true); }, 1000);
  };

  const mapLabel = activeMarket.includes('Map') ? activeMarket.split(' ').slice(0, 2).join(' ') : 'Map 1';

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <div className="betting-panel">
        {/* Header */}
        <div className="panel-header">
          <button className="panel-close" onClick={onClose}>×</button>
          <span className="panel-title">{match.teamA.abbr} vs {match.teamB.abbr} · {mapLabel} · Rounds</span>
        </div>

        <div className="panel-scroll">
          {/* Match Context */}
          <div className="panel-context">
            <div className="panel-context-teams">
              <img src={match.teamA.logo} alt={match.teamA.abbr} className="panel-team-logo" />
              <span className="panel-team-name">{match.teamA.abbr}</span>
              <span className="panel-vs">vs</span>
              <span className="panel-team-name">{match.teamB.abbr}</span>
              <img src={match.teamB.logo} alt={match.teamB.abbr} className="panel-team-logo" />
            </div>
            <div className="panel-context-meta">
              {match.tournament} · {match.format} · {mapLabel}
            </div>
            <div className="panel-context-meta">
              {match.isLive ? (
                <span className="panel-live">● LIVE · Round {match.liveScore!.round} · {match.liveScore!.ctSide} CT side</span>
              ) : (
                <span>Starting: {new Date(match.startTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              )}
            </div>
          </div>

          {/* Market Selector */}
          <div className="panel-markets">
            {match.markets.map(m => (
              <button
                key={m}
                className={`panel-market-pill ${m === activeMarket ? 'active' : ''}`}
                onClick={() => { setActiveMarket(m); setBricks({}); setSubmitted(false); }}
              >
                {m}
                {match.userHasPosition && m === 'Map 1 Rounds' && <span className="has-position" />}
              </button>
            ))}
          </div>

          {!submitted ? (
            <>
              {/* Belief Builder */}
              <div className="panel-section">
                <div className="panel-section-header">
                  <span>{mapLabel} · Total Rounds</span>
                  <button className="panel-link" onClick={() => setExplainerOpen(!explainerOpen)}>What is this? ›</button>
                </div>

                <BeliefBuilder onBeliefChange={(_userP, mean, total) => setBeliefState({ userMean: mean, totalBricks: total })} />
              </div>

              {/* Position Summary */}
              <div className="panel-section panel-summary">
                <div className="panel-section-title">Your position</div>

                <div className="stake-row">
                  <label>Stake</label>
                  <div className="stake-input-wrap">
                    <input className="stake-input" type="number" value={stake} onChange={e => setStake(e.target.value)} />
                    <span className="stake-currency">USD</span>
                  </div>
                </div>
                <div className="stake-quick">
                  {QUICK_STAKES.map(s => (
                    <button key={s} className={`stake-btn ${stake === String(s) ? 'active' : ''}`} onClick={() => setStake(String(s))}>${s}</button>
                  ))}
                </div>

                <div className="summary-rows">
                  <div className="summary-row"><span>Your mean</span><span className="summary-val">{userMean?.toFixed(1) ?? '—'} rounds</span></div>
                  <div className="summary-row"><span>Market mean</span><span className="summary-val">{marketMean} rounds</span></div>
                  <div className="summary-row"><span>Your edge</span><span className={`summary-val ${edge && parseFloat(edge) !== 0 ? 'edge-green' : ''}`}>{edge ?? '—'} rounds vs market</span></div>
                  <div className="summary-row"><span>Est. payout</span><span className="summary-val">{estPayout ? `$${estPayout}` : '—'}</span></div>
                  <div className="summary-row"><span>Max loss</span><span className="summary-val">${stakeNum || '—'} (your stake)</span></div>
                </div>
              </div>

              {/* Submit */}
              <div className="panel-submit">
                <button className="submit-btn" disabled={!canSubmit || submitting} onClick={handleSubmit}>
                  {submitting ? 'Placing bet...' : `Place Bet — $${stakeNum}`}
                </button>
                {!canSubmit && <p className="submit-hint">Add your round predictions above to place a bet</p>}
              </div>
            </>
          ) : (
            /* Confirmation */
            <div className="panel-confirmation">
              <div className="confirm-check">✓</div>
              <div className="confirm-title">Bet placed</div>
              <div className="confirm-meta">{mapLabel} · Total Rounds</div>
              <div className="confirm-meta">{match.teamA.abbr} vs {match.teamB.abbr} · ${stake} stake</div>
              <div className="confirm-stats">
                <span>Your mean: {userMean?.toFixed(1)} rounds</span>
                <span>Market mean: {marketMean} rounds</span>
              </div>
              <div className="confirm-actions">
                <button className="confirm-btn secondary" onClick={onClose}>View in My Bets</button>
                <button className="confirm-btn primary" onClick={() => { setSubmitted(false); setBricks({}); }}>Bet Another Market →</button>
              </div>
            </div>
          )}

          {/* Explainer */}
          <div className="panel-explainer">
            <button className="explainer-toggle" onClick={() => setExplainerOpen(!explainerOpen)}>
              {explainerOpen ? '▾' : '▸'} How MR12 Rounds betting works
            </button>
            {explainerOpen && (
              <div className="explainer-content">
                <p><strong>MR12 format:</strong> Each map plays up to 24 regulation rounds (first to 13 wins). If 12–12, overtime adds 6-round sets.</p>
                <p><strong>What you're betting on:</strong> The total number of rounds played on this map — anywhere from 13 (stomp) to 25+ (overtime).</p>
                <p><strong>How your payout works:</strong> You build a probability distribution over possible round counts. You earn based on how much probability mass you placed near the actual outcome, weighted against consensus.</p>
                <p><strong>Possible outcomes:</strong> 13–24 regulation rounds, or 25+ (overtime bucket).</p>
              </div>
            )}
            <button className="explainer-toggle" onClick={() => setEvOpen(!evOpen)}>
              {evOpen ? '▾' : '▸'} Expected value & payout calculation
            </button>
            {evOpen && (
              <div className="explainer-content">
                <p>Your payout = Stake × (Your probability at outcome / Market probability at outcome). Higher divergence from consensus at the settled outcome = higher return.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
