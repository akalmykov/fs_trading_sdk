export interface Match {
  id: number;
  tournament: string;
  format: 'BO1' | 'BO3' | 'BO5';
  startTime: string;
  isLive: boolean;
  liveScore?: { teamA: number; teamB: number; map: number; round: number; ctSide: string };
  teamA: { name: string; rank: number; abbr: string; logo: string };
  teamB: { name: string; rank: number; abbr: string; logo: string };
  winProb: number; // teamA win probability 0-100
  markets: string[];
  volume: number;
  liquidity: number;
  traders: number;
  userHasPosition?: boolean;
}

export const MOCK_MATCHES: Match[] = [
  {
    id: 1, tournament: 'ESL Pro League S21', format: 'BO3',
    startTime: '2026-05-17T14:00:00Z', isLive: true,
    liveScore: { teamA: 9, teamB: 7, map: 2, round: 17, ctSide: 'NaVi' },
    teamA: { name: 'Natus Vincere', rank: 3, abbr: 'NAVI', logo: '/team_logos/NaVi_logo.svg' },
    teamB: { name: 'FaZe Clan', rank: 7, abbr: 'FAZE', logo: '/team_logos/Faze_Clan.svg' },
    winProb: 65, markets: ['Map 1 Rounds', 'Map 2 Rounds', 'Map 3 Rounds'],
    volume: 48200, liquidity: 31100, traders: 142, userHasPosition: true,
  },
  {
    id: 2, tournament: 'BLAST Premier Spring', format: 'BO3',
    startTime: '2026-05-17T15:30:00Z', isLive: true,
    liveScore: { teamA: 12, teamB: 10, map: 1, round: 23, ctSide: 'G2' },
    teamA: { name: 'G2 Esports', rank: 2, abbr: 'G2', logo: '/team_logos/G2_Esports.svg' },
    teamB: { name: 'Vitality', rank: 1, abbr: 'VIT', logo: '/team_logos/Vitality-logo-pink.svg' },
    winProb: 42, markets: ['Map 1 Rounds', 'Map 2 Rounds', 'Map 3 Rounds'],
    volume: 62400, liquidity: 44800, traders: 203,
  },
  {
    id: 3, tournament: 'ESL Pro League S21', format: 'BO3',
    startTime: '2026-05-17T18:00:00Z', isLive: false,
    teamA: { name: 'Team Spirit', rank: 4, abbr: 'SPR', logo: '/team_logos/Team_Spirit_new_em.svg' },
    teamB: { name: 'MOUZ', rank: 5, abbr: 'MOUZ', logo: '/team_logos/mouze.svg' },
    winProb: 58, markets: ['Map 1 Rounds', 'Map 2 Rounds', 'Map 3 Rounds'],
    volume: 22100, liquidity: 18400, traders: 87,
  },
  {
    id: 4, tournament: 'BLAST Premier Spring', format: 'BO1',
    startTime: '2026-05-17T20:00:00Z', isLive: false,
    teamA: { name: 'Cloud9', rank: 9, abbr: 'C9', logo: '/team_logos/Cloud9_logo.svg' },
    teamB: { name: 'Heroic', rank: 11, abbr: 'HRC', logo: '/team_logos/NaVi_logo.svg' },
    winProb: 51, markets: ['Map 1 Rounds'],
    volume: 8900, liquidity: 6200, traders: 41,
  },
  {
    id: 5, tournament: 'ESL Pro League S21', format: 'BO3',
    startTime: '2026-05-18T12:00:00Z', isLive: false,
    teamA: { name: 'Liquid', rank: 6, abbr: 'TL', logo: '/team_logos/Cloud9_logo.svg' },
    teamB: { name: 'Complexity', rank: 14, abbr: 'COL', logo: '/team_logos/CompLexity_Gaming_logo.svg' },
    winProb: 72, markets: ['Map 1 Rounds', 'Map 2 Rounds', 'Map 3 Rounds'],
    volume: 15600, liquidity: 12300, traders: 63,
  },
  {
    id: 6, tournament: 'BLAST Premier Spring', format: 'BO3',
    startTime: '2026-05-18T16:00:00Z', isLive: false,
    teamA: { name: 'Astralis', rank: 8, abbr: 'AST', logo: '/team_logos/Astralis_logo.svg' },
    teamB: { name: 'ENCE', rank: 12, abbr: 'ENCE', logo: '/team_logos/ENCE.svg' },
    winProb: 61, markets: ['Map 1 Rounds', 'Map 2 Rounds', 'Map 3 Rounds'],
    volume: 19800, liquidity: 14200, traders: 78,
  },
  {
    id: 7, tournament: 'ESL Pro League S21', format: 'BO3',
    startTime: '2026-05-19T14:00:00Z', isLive: false,
    teamA: { name: 'Natus Vincere', rank: 3, abbr: 'NAVI', logo: '/team_logos/NaVi_logo.svg' },
    teamB: { name: 'Team Spirit', rank: 4, abbr: 'SPR', logo: '/team_logos/Team_Spirit_new_em.svg' },
    winProb: 55, markets: ['Map 1 Rounds', 'Map 2 Rounds', 'Map 3 Rounds', 'Series Score'],
    volume: 34500, liquidity: 28100, traders: 118, userHasPosition: true,
  },
];
