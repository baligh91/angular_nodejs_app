import { FplChallenge, FplProfile, Session } from './models';

export const fplProfile: FplProfile = {
  id: 123456, firstName: 'Test', lastName: 'Manager', teamName: 'FPL Team',
  overallPoints: 450, overallRank: 10000, gameweekPoints: 60, gameweekRank: 5000,
  favoriteTeam: { id: 1, name: 'Arsenal' },
  leagues: [{ id: 123, name: 'Test league', rank: 2 }],
};
export const fplSession: Session = {
  accessToken: 'memory-only-token',
  user: { id: 'u1', fplId: fplProfile.id, pseudo: 'Test Manager', role: 'user', fplProfile },
};
export const fplChallenge: FplChallenge = {
  challengeId: 'opaque-server-proof', code: 'FML-1234567890ABCDEF',
  expiresAt: '2099-01-01T12:00:00Z', profile: fplProfile,
};
