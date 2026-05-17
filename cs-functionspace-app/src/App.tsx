import { useState, useMemo } from 'react';
import { MOCK_MATCHES, type Match } from './data';
import './index.css';

function formatNum(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toString(); }

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getDateLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `TODAY — ${d.toLocaleDateString([], { month: 'short', day: 'numeric' }).toUpperCase()}`;
  if (d.toDateString() === tomorrow.toDateString()) return `TOMORROW — ${d.toLocaleDateString([], { month: 'short', day: 'numeric' }).toUpperCase()}`;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}

/* ── TopBar ── */
function TopBar() {
  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <span className="top-bar-wordmark">FunctionSpace</span>
        <span className="top-bar-tag">CS2</span>
      </div>
      <div className="top-bar-right">
        <span className="top-bar-balance">$1,240.00</span>
        <div className="top-bar-avatar" />
      </div>
    </div>
  );
}

/* ── FilterStrip ── */
function FilterStrip({ search, setSearch, statusFilter, setStatusFilter, myBets, setMyBets }: {
  search: string; setSearch: (s: string) => void;
  statusFilter: string; setStatusFilter: (s: string) => void;
  myBets: boolean; setMyBets: (b: boolean) => void;
}) {
  return (
    <div className="filter-strip">
      <input className="filter-search" placeholder="🔍 Search teams..." value={search} onChange={e => setSearch(e.target.value)} />
      <select className="filter-select">
        <option>All Tournaments</option>
        <option>ESL Pro League S21</option>
        <option>BLAST Premier Spring</option>
      </select>
      <div className="filter-toggle">
        <button className={statusFilter === 'all' ? 'active' : ''} onClick={() => setStatusFilter('all')}>All</button>
        <button className={statusFilter === 'live+upcoming' ? 'active' : ''} onClick={() => setStatusFilter('live+upcoming')}>Live + Upcoming</button>
        <button className={statusFilter === 'live' ? 'active' : ''} onClick={() => setStatusFilter('live')}>Live</button>
      </div>
      <select className="filter-select">
        <option>Sort: Start Time</option>
        <option>Sort: Volume</option>
        <option>Sort: Liquidity</option>
      </select>
      <button className={`filter-mybets ${myBets ? 'active' : ''}`} onClick={() => setMyBets(!myBets)}>
        My Bets {MOCK_MATCHES.filter(m => m.userHasPosition).length > 0 && `(${MOCK_MATCHES.filter(m => m.userHasPosition).length})`}
      </button>
    </div>
  );
}

/* ── MatchCard ── */
function MatchCard({ match }: { match: Match }) {
  const favored = match.winProb >= 50;
  const prob = favored ? match.winProb : 100 - match.winProb;

  return (
    <div className="match-card">
      {/* Header */}
      <div className="match-card-header">
        <span className="tournament">{match.tournament}</span>
        <span className="format">• {match.format}</span>
        {match.isLive ? (
          <span className="live-badge"><span className="live-dot" /> LIVE · Map {match.liveScore!.map}</span>
        ) : (
          <span className="time">{formatTime(match.startTime)}</span>
        )}
      </div>

      {/* Teams */}
      <div className="match-teams">
        <div className="match-team">
          <div className="team-logo">{match.teamA.abbr}</div>
          <div className="team-info">
            <div className="team-name">{match.teamA.name}</div>
            <div className="team-rank">#{match.teamA.rank} world</div>
          </div>
        </div>

        <div className="match-vs">
          {match.isLive ? (
            <>
              <div className="live-score">{match.liveScore!.teamA} – {match.liveScore!.teamB}</div>
              <div className="live-score-info">Round {match.liveScore!.round} · CT: {match.liveScore!.ctSide}</div>
            </>
          ) : (
            <>
              <div className="prob">{prob}%</div>
              <div className="prob-label">Win prob</div>
              <div className="prob-bar">
                <div className="left" style={{ width: `${match.winProb}%` }} />
                <div className="right" style={{ width: `${100 - match.winProb}%` }} />
              </div>
            </>
          )}
        </div>

        <div className="match-team right">
          <div className="team-info">
            <div className="team-name">{match.teamB.name}</div>
            <div className="team-rank">#{match.teamB.rank} world</div>
          </div>
          <div className="team-logo">{match.teamB.abbr}</div>
        </div>
      </div>

      {/* Markets */}
      <div className="match-markets">
        {match.markets.map(m => (
          <button key={m} className="market-pill">
            {m}
            {match.userHasPosition && m === 'Map 1 Rounds' && <span className="has-position" />}
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="match-footer">
        <span><span className="stat-label">Vol: </span><span className="stat-value">{formatNum(match.volume)}</span></span>
        <span><span className="stat-label">Liq: </span><span className="stat-value">{formatNum(match.liquidity)}</span></span>
        <span><span className="stat-label">Traders: </span><span className="stat-value">{match.traders}</span></span>
        <button className="bet-btn">Bet →</button>
      </div>
    </div>
  );
}

/* ── App ── */
export default function App() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('live+upcoming');
  const [myBets, setMyBets] = useState(false);

  const filtered = useMemo(() => {
    let matches = MOCK_MATCHES;
    if (search) {
      const q = search.toLowerCase();
      matches = matches.filter(m =>
        m.teamA.name.toLowerCase().includes(q) ||
        m.teamB.name.toLowerCase().includes(q) ||
        m.tournament.toLowerCase().includes(q)
      );
    }
    if (statusFilter === 'live') matches = matches.filter(m => m.isLive);
    if (myBets) matches = matches.filter(m => m.userHasPosition);
    return matches;
  }, [search, statusFilter, myBets]);

  const liveMatches = filtered.filter(m => m.isLive);
  const upcomingByDate = useMemo(() => {
    const upcoming = filtered.filter(m => !m.isLive);
    const groups: Record<string, Match[]> = {};
    for (const m of upcoming) {
      const label = getDateLabel(m.startTime);
      (groups[label] ??= []).push(m);
    }
    return groups;
  }, [filtered]);

  return (
    <>
      <TopBar />
      <FilterStrip search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} myBets={myBets} setMyBets={setMyBets} />

      <div className="match-list">
        {/* Live section */}
        <div className="section-header">
          <span className="live-dot" />
          LIVE NOW
          <span className="section-count">({liveMatches.length})</span>
        </div>
        {liveMatches.length === 0 && <p style={{ color: 'var(--muted-soft)', fontSize: 12, marginBottom: 16 }}>No live matches right now</p>}
        {liveMatches.map(m => <MatchCard key={m.id} match={m} />)}

        {/* Upcoming sections by date */}
        {Object.entries(upcomingByDate).map(([label, matches]) => (
          <div key={label}>
            <div className="section-header">
              {label}
              <span className="section-count">({matches.length})</span>
            </div>
            {matches.map(m => <MatchCard key={m.id} match={m} />)}
          </div>
        ))}

        {filtered.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>
            No CS2 matches found. Try removing filters.
          </p>
        )}
      </div>
    </>
  );
}
