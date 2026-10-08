import { Session } from './models';

export const fplSession: Session = {
  accessToken: 'memory-only-token',
  user: {
    id: 'u1', fplId: 123456, firstName: 'Test', lastName: 'Manager',
    fplTeamName: 'FPL Team', fplLeagues: [{ id: 999001, name: 'Public league' }],
    scoreHistory: [], totalScore: 0,
  },
};
