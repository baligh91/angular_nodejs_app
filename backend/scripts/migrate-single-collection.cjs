const { MongoClient } = require('mongodb');

if (require('node:fs').existsSync('.env')) process.loadEnvFile('.env');
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is required');
const apply = process.argv.includes('--apply');

async function migrate() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const database = client.db();
    const usersCollection = database.collection('users');
    const fplIndex = (await usersCollection.indexes()).find((index) => index.name === 'fplId_1');
    if (fplIndex && (fplIndex.unique !== true || fplIndex.key.fplId !== 1
      || Object.keys(fplIndex.key).length !== 1 || (fplIndex.sparse && fplIndex.sparse !== true))) {
      throw new Error('Unexpected users.fplId_1 index; review it before migration');
    }
    const replaceSparseFplIndex = Boolean(fplIndex?.sparse);
    const users = await usersCollection.find({}).toArray();
    const teams = await database.collection('fantasy_teams').find({}).toArray();
    const leagues = await database.collection('fpl_leagues').find({}).toArray();
    const managers = await database.collection('fpl_managers').find({}).toArray();
    const scores = await database.collection('scores').find({}).sort({ gw: 1 }).toArray();
    const leagueById = new Map(leagues.map((league) => [String(league._id), league]));
    const teamsByUser = new Map();
    for (const team of teams) {
      const key = String(team.userId);
      teamsByUser.set(key, [...(teamsByUser.get(key) || []), team]);
    }
    const managerById = new Map(managers.map((manager) => [String(manager._id), manager]));
    const scoresByTeam = new Map();
    for (const score of scores) scoresByTeam.set(String(score.teamId), [...(scoresByTeam.get(String(score.teamId)) || []), score]);

    const updates = [];
    for (const user of users) {
      if (!Number.isSafeInteger(user.fplId) || user.fplId < 1) {
        throw new Error(`Cannot migrate user ${user._id}: missing valid fplId`);
      }
      const userTeams = teamsByUser.get(String(user._id)) || [];
      if (userTeams.length > 1) {
        throw new Error(`Cannot migrate FPL ID ${user.fplId}: it owns multiple teams; choose one before migration`);
      }
      const profile = user.fplProfile || {};
      const pseudoParts = String(user.pseudo || '').trim().split(/\s+/).filter(Boolean);
      const set = {
        fplId: user.fplId,
        firstName: user.firstName || profile.firstName || pseudoParts[0] || `FPL ${user.fplId}`,
        lastName: user.lastName || profile.lastName || pseudoParts.slice(1).join(' '),
        fplTeamName: user.fplTeamName || profile.teamName || '',
        fplLeagues: user.fplLeagues || (profile.leagues || []).map((league) => ({ id: league.id, name: league.name })),
        scoreHistory: Array.isArray(user.scoreHistory) ? [...user.scoreHistory] : [],
        totalScore: Number.isFinite(user.totalScore) ? user.totalScore : 0,
      };
      const team = userTeams[0];
      if (team) {
        set.scoreHistory = [];
        set.totalScore = 0;
        if (team.format !== 5 || team.managerIds?.length !== 5) {
          throw new Error(`Cannot migrate FPL ID ${user.fplId}: its team is not format 5`);
        }
        const league = leagueById.get(String(team.leagueId));
        if (!league) throw new Error(`Cannot migrate FPL ID ${user.fplId}: its FPL league is missing`);
        const roster = team.managerIds.map((id) => {
          const manager = managerById.get(String(id));
          if (!manager) throw new Error(`Cannot migrate FPL ID ${user.fplId}: a selected manager is missing`);
          return { fplId: manager.fplId, name: manager.name, rank: manager.rank, price: manager.price };
        });
        const captain = managerById.get(String(team.captainId));
        if (!captain) throw new Error(`Cannot migrate FPL ID ${user.fplId}: captain is missing`);
        const pendingSnapshots = [];
        set.team = {
          name: team.name, leagueFplId: league.fplId, leagueName: league.name, format: 5,
          managerIds: roster.map((manager) => manager.fplId), captainId: captain.fplId,
          budget: team.budget, spent: team.spent, managers: roster, pendingSnapshots,
        };
        for (const score of scoresByTeam.get(String(team._id)) || []) {
          const scoreManagers = (score.managerIds || []).map((id) => managerById.get(String(id)));
          const scoreCaptain = managerById.get(String(score.captainId));
          if (scoreManagers.some((manager) => !manager) || !scoreCaptain) {
            throw new Error(`Cannot migrate FPL ID ${user.fplId}: a scored roster snapshot is incomplete`);
          }
          const snapshot = {
            managerIds: scoreManagers.map((manager) => manager.fplId),
            captainId: scoreCaptain.fplId, teamName: score.teamName || team.name,
            capturedAt: score.capturedAt || new Date(),
          };
          if (score.scored) {
            const points = Number(score.points) || 0;
            set.scoreHistory.push({ gw: score.gw, points, total: 0, ...snapshot });
          } else pendingSnapshots.push({ gw: score.gw, ...snapshot });
        }
        set.scoreHistory.sort((a, b) => a.gw - b.gw);
        for (const score of set.scoreHistory) {
          set.totalScore += score.points;
          score.total = set.totalScore;
        }
        const capturedGameweeks = [
          ...set.scoreHistory.map((score) => score.gw),
          ...set.team.pendingSnapshots.map((snapshot) => snapshot.gw),
        ];
        set.team.firstScoringGw = user.team?.firstScoringGw
          || (capturedGameweeks.length ? Math.min(...capturedGameweeks) : 1);
      } else if (user.team) {
        set.team = user.team;
        set.team.pendingSnapshots ||= [];
        const capturedGameweeks = [
          ...(set.scoreHistory || []).map((score) => score.gw),
          ...set.team.pendingSnapshots.map((snapshot) => snapshot.gw),
        ];
        set.team.firstScoringGw ||= capturedGameweeks.length ? Math.min(...capturedGameweeks) : 1;
      }
      updates.push({ userId: user._id, set, disabled: Boolean(user.disabled), tokenVersion: user.tokenVersion || 0,
        refreshHash: user.refreshHash, refreshExpires: user.refreshExpires });
    }

    const collectionNames = (await database.listCollections().toArray()).map((collection) => collection.name);
    const legacyCollections = collectionNames.filter((name) => name !== 'users' && !name.startsWith('system.'));
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', users: updates.length,
      embeddedTeams: updates.filter((item) => item.set.team).length,
      preservedScoredGameweeks: updates.reduce((sum, item) => sum + item.set.scoreHistory.length, 0),
      replaceSparseFplIndex,
      collectionsToDrop: legacyCollections }, null, 2));
    if (!apply) return;

    for (const item of updates) {
      const set = { ...item.set, disabled: item.disabled, tokenVersion: item.tokenVersion };
      if (item.refreshHash) set.refreshHash = item.refreshHash;
      if (item.refreshExpires) set.refreshExpires = item.refreshExpires;
      await usersCollection.updateOne({ _id: item.userId }, {
        $set: set,
        $unset: { pseudo: 1, role: 1, avatar: 1, favoriteTeam: 1, fplProfile: 1 },
      });
    }
    if (replaceSparseFplIndex) await usersCollection.dropIndex('fplId_1');
    if (!fplIndex || replaceSparseFplIndex) await usersCollection.createIndex({ fplId: 1 }, { unique: true });
    for (const name of legacyCollections) await database.dropCollection(name);
    console.log('Single-collection migration complete.');
  } finally {
    await client.close();
  }
}

migrate().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
