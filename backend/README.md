# FML backend

NestJS REST API with MongoDB persistence. It imports FPL **classic** leagues and
lets users select managers, not football players. Domain rules live in `src/domain`,
use cases in `src/application`, Mongo/FPL adapters in `src/infrastructure`, and
validated HTTP contracts in `src/presentation`.

## Install and run

Use Node.js 22.12+ and npm. Run commands from this directory:

```powershell
npm ci
Copy-Item .env.example .env
# Edit .env, especially JWT_SECRET and MONGODB_URI.
npm run build
npm start
```

`npm run start:dev` watches TypeScript, compiles with `tsc`'s decorator metadata,
and restarts the compiled server after successful compilation. Running decorated
Nest classes directly with `tsx` is not supported: its transpiler does not emit
the dependency-injection/DTO metadata needed by this application.

The server loads `.env` from its working directory. Defaults are port 3000,
API prefix `/api`, and frontend origin `http://localhost:4200`.
Swagger UI is `/api/docs`; OpenAPI JSON is `/api/docs-json`.

### Mongo replica set is mandatory

**A standalone MongoDB server cannot run this application correctly.** Team edits,
FPL challenge consumption/session creation, snapshot capture, settlement, market updates, rankings, and fixtures use multi-document
transactions. Use MongoDB 7+ as a replica set (a single member is sufficient locally)
or a transaction-capable Atlas deployment. For a local MongoDB installation, in
separate PowerShell terminals:

```powershell
New-Item -ItemType Directory -Force .\mongo-data
mongod --dbpath .\mongo-data --replSet rs0 --bind_ip 127.0.0.1 --port 27017
```

```powershell
mongosh "mongodb://127.0.0.1:27017" --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
mongosh "mongodb://127.0.0.1:27017" --eval 'db.hello().isWritablePrimary'
```

Wait for a writable primary; use
`MONGODB_URI=mongodb://127.0.0.1:27017/fml?replicaSet=rs0`.
Keep database data outside version control. No container tooling is required.
Production deployments must configure database authentication, network restrictions,
backup/restore, and TLS separately.

## Configuration and authentication

| Variable | Meaning |
| --- | --- |
| `NODE_ENV` | `production` enforces HTTPS URLs and secure cookies |
| `PORT` | Integer 1–65535; defaults to 3000 |
| `MONGODB_URI` | Mongo connection URI; must support transactions |
| `JWT_SECRET` | Required, at least 32 characters; use a cryptographically random secret |
| `APP_ORIGIN` | Exact permitted frontend origin; defaults to `http://localhost:4200` |
| `COOKIE_SECURE` | `true` enables secure cookies; always enabled in production |
| `SYNC_ENABLED` | `false` disables hourly sync and minute snapshot jobs, not manual admin sync |
| `FPL_BASE_URL` | Defaults to `https://fantasy.premierleague.com/api/`; retain trailing slash |
| `ADMIN_FPL_IDS` | Optional comma-separated positive FPL entry IDs explicitly designated by the operator as administrators |

The secret variable is **`JWT_SECRET`**, not `JWT_ACCESS_SECRET`.
Sign-in requires proof that the user controls an FPL entry, never just a public ID.
Access JWTs expire after 15 minutes, with
issuer `fml`, audience `fml-web`, and user token-version checks on every request.
Send `Authorization: Bearer <accessToken>` for protected routes.
Successful ownership verification and refresh return `{accessToken,user}`; refresh credentials are a
7-day rotating HttpOnly, SameSite=Lax `fml_refresh` cookie scoped to `/api/auth`.
Refresh replay is rejected; one refresh session is stored per user. Browser
clients must include credentials for cookie-based endpoints.

Successful ownership re-verification, disabling an account or logging out its current refresh
session invalidates access tokens via token version. Admin cannot disable themselves.
Verified identities become ordinary users unless explicitly listed in `ADMIN_FPL_IDS`.
The role is recalculated on each proof-based sign-in, never taken from the submitted
profile or an old account. Admin IDs must still prove ownership. There is no public
role-promotion or FPL-ID-reassignment API. Restart after changing admin configuration.

Cookie-changing auth routes reject untrusted origins. CORS allows only `APP_ORIGIN`.
Behind a proxy, configure trusted client-IP forwarding deliberately before changing
Express trust-proxy settings; default throttling uses the peer IP. Throttle state is
process-local, not a shared distributed limiter.
Do not expose JWT secrets, challenge IDs, ownership codes, or refresh cookies in logs.

### FPL ownership flow

1. `POST /auth/fpl/challenge` with `{fplId:123456}` returns
   `{challengeId,code,expiresAt,profile}` and no session/cookie. The opaque ID is
   256 random bits; the proof code is `FML-` plus 16 uppercase random hexadecimal
   characters (20 characters total, suitable as the whole FPL team name).
2. In the official FPL site, temporarily change the **team name**, not manager name,
   to **exactly** the code. Only leading/trailing whitespace is ignored.
   Prefixes, suffixes, additional tokens, brackets, case changes and partial matches fail.
3. `POST /auth/fpl/verify` with `{challengeId}` fetches that bound entry freshly
   from FPL; neither a client-submitted profile nor a different ID can satisfy proof.
   Codes are compared through fixed-length SHA-256 digests using timing-safe comparison.
4. Verification atomically consumes the challenge and creates/updates the bound
   user plus refresh session in one replica-set transaction. Concurrent/replayed
   successful verification cannot create multiple sessions from one challenge.
   The user may restore their previous team name after success.

Challenges expire after 15 minutes and permit at most ten verification attempts,
including failed upstream reads. Mongo stores only hashes of challenge IDs/codes.
TTL cleanup is not the expiry authority: every reserve/consume query checks expiry.
Wrong proof, expired/exhausted or replayed challenge returns 401; disabled account
returns 403 even with valid proof. Upstream outage returns 503 and no session.
FPL entry 404 remains an explicit 404; unknown private upstream data is never exposed.
Name changes may take time to propagate; retry within the remaining attempts or
create a fresh challenge. Keep the opaque challenge ID private even though the code
is temporarily public in the FPL name.

`FplProfile` is a whitelist: `{id,firstName,lastName,teamName,overallPoints,overallRank,
gameweekPoints,gameweekRank,favoriteTeam:{id,name}|null,leagues:[{id,name,rank:number|null}]}`.
Points and ranks can be null before official data is available. Only classic league metadata
is included. Favorite-club names are resolved from official bootstrap teams.
No birth date, country/region, contact information, upstream credentials or arbitrary
entry properties are returned/stored. `User` is
`{id,fplId,pseudo,role,avatar?,favoriteTeam?,fplProfile?}`; `favoriteTeam` is the
optional club-name string, while `fplProfile.favoriteTeam` contains its ID/name or null.
The challenge includes the original public team name; verification returns the current
team name, which may still contain the proof code. Restore the original name in FPL
after verification, then synchronize the profile. No synthetic season label is added:
this is the upstream current-season entry, and database season rollover remains manual.
`pseudo` derives from FPL first/last name. `POST /auth/fpl/sync` refreshes only the
authenticated user's bound identity and returns the updated User. Identity/profile
data is read-only locally; `PATCH /auth/me` accepts only an optional HTTPS avatar.

### Existing-database migration

There is no automatic email-account linkage or privilege reuse. Legacy users with
no `fplId` remain orphaned; their old access/refresh tokens are rejected and their
teams are not reassigned. The old credential/SMTP routes and dependencies are removed.
Back up before upgrading. Startup inspects and removes only the legacy `users.email_1`
index with exactly `{email:1}` and `unique:true`; an unexpected definition stops
startup for operator review. Equivalent explicit operator command after inspection:

```powershell
mongosh "<your-replica-set-uri>" --eval 'db.users.getIndexes()'
mongosh "<your-replica-set-uri>" --eval 'const i=db.users.getIndexes().find(i=>i.name==="email_1"); if(i && i.unique===true && i.key.email===1 && Object.keys(i.key).length===1){db.users.dropIndex("email_1")}else if(i){throw Error("Unexpected email_1 definition")}'
```

Removing that known legacy unique index is mandatory
(otherwise it would reject multiple users with no email) and creates a unique
**sparse** `users.fplId_1` index. Ensure no duplicate bound IDs exist and grant the
application index-management permission. Sparse means legacy users must omit
`fplId`, not set it to null. This is not an automatic migration of historical teams.
An operator must design any audited manual ownership transfer separately. Old
credential fields may remain physically in existing documents but are not in the
schema or projections and cannot authenticate; securely remove them according to
your retention/migration policy. Both access and refresh authorization require
a bound FPL ID and matching imported `fplProfile.id`. There is no bypass to restore
their old privileges. Re-verification increments token version and rotates the
refresh session so previously issued access and refresh tokens cannot survive it.

## HTTP contracts

All routes below are relative to `/api`. Reads require authentication unless marked
public. DTOs reject unknown properties; Mongo IDs must be 24 hexadecimal characters.
Responses use `id` strings instead of Mongo `_id`.

| Method / path | Input / behavior |
| --- | --- |
| `GET /health` | Public Mongo ping; `{status:"ok"}` or 503 |
| `POST /auth/fpl/challenge` | Public `{fplId:number}`; 200 challenge/profile, no session |
| `POST /auth/fpl/verify` | Public `{challengeId}`; 200 session only after ownership proof |
| `POST /auth/refresh`, `/auth/logout` | Public cookie-authenticated rotation/logout; 200 |
| `GET /auth/me` | User projection |
| `PATCH /auth/me` | Optional HTTPS `avatar` only; null/blank clears it |
| `POST /auth/fpl/sync` | Authenticated empty body `{}`; refresh bound FPL profile, return User |
| `GET /leagues`, `/leagues/:id` | Active imported leagues `{id,fplId,name}` |
| `POST /leagues` | Authenticated user `{fplId}` imports/resynchronizes a public FPL classic league; 201 |
| `GET /managers?leagueId=...` | Active managers sorted by FPL league rank |
| `GET /teams/mine` | Current user's teams including manager projections |
| `GET /teams/:id` | Team projection; authenticated public league-team visibility |
| `POST /teams`, `PUT /teams/:id` | Create/update; updates require ownership; 201/200 |
| `GET /teams/:id/history` | Settled historical chart data, ascending GW |
| `GET /rankings/gw/:gw?leagueId=...` | Settled GW competition ranking; GW integer 1–100; omit leagueId for worldwide |
| `GET /rankings/overall?leagueId=...` | Current cumulative competition ranking; omit leagueId for worldwide |
| `GET /gameweeks` | Official IDs, deadlines, finished/current flags |
| `POST /admin/sync` | Admin manual import/scoring/market settlement; 200 |
| `GET /admin/users` | Admin sanitized users including disabled flag |
| `PATCH /admin/users/:id` | Admin `{disabled:boolean}`; revokes sessions |
| `GET /admin/leagues` | Admin includes inactive leagues and import/sync dates |
| `PATCH /admin/leagues/:id` | Admin `{active:boolean}`; 200 `{id,fplId,name,active}` |
| `GET /admin/gameweeks` | Admin also sees `dataChecked`; no deadline override |

Disabling a league removes it from active league discovery, stops scheduled league
imports/settlement, and prevents team creation/edits in it. It retains managers,
teams, scores and history. Existing history/rankings remain readable. Activation
requires a previously completed import. Management and synchronization share a
lease, so a concurrent sync cannot silently re-enable a disabled league. Explicit
authenticated `POST /leagues` import can re-enable it. Status PATCH remains admin-only.
Import accepts a numeric FPL league ID only, never a caller-supplied upstream URL,
and retains the three-imports/minute throttle. Gameweeks are upstream-controlled; there
is deliberately **no admin PATCH** to fabricate deadlines or finish/data-check flags.

FPL IDs must be positive safe integers; challenge IDs are 43-character base64url
strings. Locally created fantasy team names are 2–80 characters.
Team input is `{name,leagueId,format,managerIds,captainId}`.
Errors use Nest's `{statusCode,message,error}` convention: validation 400,
unauthenticated 401, admin denial 403, missing/foreign-owned team 404,
deadline/duplicate/lease conflict 409, upstream failure 503, throttle 429.
Global limit is 120 requests/minute/IP/endpoint; ownership challenge 5, verification
30 (also ten attempts/challenge in Mongo), profile sync 5, league import 3, manual sync 2.
Forbidden requests may consume their throttle bucket too.

Worldwide rankings aggregate all settled fantasy teams across imported leagues,
not individual FPL managers. Each team is a separate entrant (a user's teams in
different leagues are not merged). Overall sums its settled GW points; GW rankings
use only that GW. Competition ties share rank with gaps and stable team-ID ordering.
Existing/deactivated league history remains included. To request worldwide, omit
`leagueId` entirely; an empty or malformed ID returns 400. Manager listing still
requires `leagueId`. Avatar updates preserve omitted fields and persist explicit
null (or normalized blank strings) when clearing it; FPL-owned profile fields cannot
be changed locally.

### Chart contracts: no synthetic historical values

Manager projection:
`{id,fplId,name,rank,gwPoints,form,price,priceHistory:[{gw,price,delta}]}`.
**The history key is `gw`, not `gameweek`.** `gw:0` is the recorded import baseline,
not a played GW. All prices, budgets and values are integers in **tenths of £1M**.

Team history is an array, not a wrapper:

```json
[
  {"gw":1,"points":260,"overallPoints":260,"rank":1,"teamValue":97}
]
```

Only `scored:true` snapshots are included; candidates/future/live events are omitted.
An existing team with no settled scores returns `[]`. `points` is settled fantasy
GW points, `overallPoints` sums the team's settled points through that GW, and
`rank` is the **historical overall league** competition rank from cumulative settled
points through that GW, including league teams with earlier scores but no score in
that GW. It is not GW-only rank, today's overall rank, or an FPL manager rank. Ties share rank,
with gaps (1,1,3). `teamValue` sums the snapshot's distinct managers' latest recorded
market prices at or before the GW, including that GW's settlement; captain price
is counted once. It is not the team's original purchase cost/current roster value.
These three historical metrics are durably stored during settlement. Legacy scored
rows without them are reconstructed from settled league scores through that GW, running totals,
and recorded historical prices, never today's roster/prices. Missing legacy prices
fail explicitly with 409 rather than inventing a value.

## Rules and settlement

* One team per user/league; formats 5/7/11 have budgets 250/300/500 (£25M/30M/50M).
  Select exactly that many distinct active managers from the league; captain must
  be one selected manager. Managers can belong to multiple fantasy teams.
* Initial prices linearly interpolate FPL league rank from 100 to 10 (£10M to £1M),
  rounded to integer tenths; a singleton costs 100. Transfers revalue the entire
  selected roster at current prices, not purchase/sell accounting.
* Official gameweeks must exist. Writes are blocked between any official deadline
  and its `finished` flag. There must be a future unfinished GW, and the transaction
  verifies that its deadline was not crossed while writing.
* Team saves and periodic/bootstrap capture persist candidates for future GWs.
  Candidates can change before the deadline; scoring requires `capturedAt < deadline`.
  Missing predeadline snapshots are not retroactively fabricated.
* Only `finished && dataChecked` events settle. Manager GW points come from FPL
  entry history; captain is doubled using the immutable scored roster. Missing
  selected manager histories block settlement instead of becoming zero.
* Market performance is the mean of GW points and the trailing up-to-five-GW form.
  Midrank percentiles preserve tied performance. Top 10% gain 2, next 20% gain 1,
  middle hold, bottom 20% lose 1, bottom 10% lose 2 tenths, clamped 10–150.
* New league imports set `pricingFromGw` to the first GW after the latest finished,
  checked event. Already-completed upstream events are not retroactively repriced.
  Active managers are repriced; departed managers' historical records are retained.
* Scoring, price history, live manager prices, rankings, historical metrics and the
  processed-operation marker commit together per league/GW. Retried syncs cannot
  double-score or double-reprice. Failures roll back that settlement; earlier completed
  leagues/GWs in a multi-league sync remain committed.
* A Mongo lease serializes sync/import/league-status operations, expires after 30
  minutes, renews every minute, and is checked transactionally before settlement.
  FPL reads retry timeout/429/5xx up to three attempts, page classic standings, and
  fetch manager history in batches of four.

## Mongo collections and indexes

Mongoose creates indexes at startup (`model.init`); allow time/permissions for this.
Every collection also has Mongo's default unique `_id` index.

| Collection | Stored schema / additional indexes |
| --- | --- |
| `users` | Optional bound FPL ID (missing only for legacy orphans), imported whitelisted FPL profile, pseudo, role, disabled, optional avatar/club name, token version, refresh hash/expiry; unique sparse `fplId` |
| `fpl_auth_challenges` | Hashed opaque challenge ID/code, bound FPL ID, expiresAt, attempts, optional consumedAt; unique `challengeHash`, TTL `expiresAt` with expireAfterSeconds 0 |
| `fpl_leagues` | FPL ID, name, active, syncing, import/sync dates, pricing start GW; unique `fplId` |
| `fpl_managers` | League/FPL entry IDs, name, rank, GW points, form, current price, active, `{gw,points,rank}` FPL history; unique `(leagueId,fplId)` |
| `fantasy_teams` | Owner/league IDs, name, format, manager IDs, captain ID, budget, spent, overall points/rank, timestamps; unique `(userId,leagueId)` |
| `team_members` | Team/manager IDs and captain flag; unique `(teamId,managerId)` |
| `gameweeks` | Official ID, deadline, finished/current/dataChecked, capture/processing flags; unique `id` |
| `scores` | Team/league/user/GW, captured names/pseudo/roster/captain/time, settled points/scored flag, optional historical overallPoints/rank/teamValue; unique `(teamId,gw)` and `(leagueId,gw,scored)` lookup |
| `market_prices` | League/manager/GW, price and actual clamped delta; unique `(managerId,gw)` |
| `rankings` | League/team/GW, rank, names, points; unique `(leagueId,gw,teamId)`; GW 0 means current overall |
| `operations` | Sync lease `{key,owner,until}` or durable processed marker `{key,completedAt}`; unique `key` |

No TTL index deletes scores/prices or operation markers. Refresh expiries are
checked by queries, not TTL deletion of users. `gameweeks.processingComplete` and
league `syncing` are legacy bookkeeping fields, not settlement authority; per-league
operation markers and scored rows are authoritative.

## Offline fixtures and tests

Use an isolated development database, **never an existing real league database**:

```powershell
$env:SYNC_ENABLED = "false"
$env:ADMIN_FPL_IDS = "90000001"
npm run seed
npm run start:dev
```

Seed creates bound fixture identities `90000020` (player) and `90000001` (admin),
classic fixture league `999001`,
20 managers, one affordable 5-manager team, a settled GW1 and a future GW2.
Seed compiles first to preserve decorator metadata. It overwrites known fixture
IDs/profiles and resets fixture sessions; there are no fixture passwords.
Do not rerun after simulating new GWs.
It is rejected in production. Keep `SYNC_ENABLED=false`: fixture FPL IDs/dates are
synthetic and are not compatible with live upstream synchronization. Seed grants
**no authentication bypass**: browser development must use an explicitly local
mocked FPL source that serves the entry/profile and accepts a team-name update for
the generated code, or mock `FplClient.entry` in a local test harness. Never expose
such a source publicly or enable it in production. Set `ADMIN_FPL_IDS=90000001` in
that isolated harness for the fixture admin role to persist at verification.

```powershell
npm run build
npm test
npm run test:integration
```

Integration tests start their own one-member Mongo replica set via
`mongodb-memory-server`, download MongoDB 7.0.14 into `.mongodb-binaries` on first
run, and mock FPL responses (no real FPL league needed). They cover auth/ownership,
validation, deadlines/snapshots, rollback, historical chart metrics, league activation,
proof boundaries, wrong-identity proof, expiry, attempt limits, replay/concurrency,
disabled identities, profile sync, removed auth routes, real HTTP throttling and
scoring/market idempotency. Settlement tests call the real
service directly so they do not accidentally exhaust the separately tested HTTP limit.

## Known limitations and operational work

* Completed GW operation markers deliberately freeze settlement. Later FPL point
  corrections refresh manager history but **do not** rewrite settled team scores,
  ranks or prices. Reconciliation requires a designed audited replay/migration;
  deleting markers manually is not a safe replay mechanism.
* Current data is single-season: no season dimension or automatic rollover. FPL
  entry IDs are **not permanent identities** and may be reused across seasons.
  Proving current team-name control does not establish continuity with last season's
  owner. **Before every season rollover, isolate/archive the old database and use
  a fresh identity/fantasy database (or an audited complete season reset)**, including
  users, challenges, refresh sessions, teams, scores, prices, rankings and GW markers.
  Do not keep old bound users/admin mappings and attach a new season's public entry
  by ID. Review `ADMIN_FPL_IDS` for the new season and rotate `JWT_SECRET` to invalidate
  old tokens. Season-aware identity migration is not implemented.
* Importing a league does not create fantasy teams or invent historical rosters.
  Missing historical prices/rosters cannot be recovered from current selections.
* Admin tooling supports importing/enabling/disabling leagues and viewing official
  GWs, not arbitrary FPL event editing, role promotion, score corrections or deletion.
* Offline fixtures are demonstrations, not representative live-season data. Live
  FPL availability, public-name propagation, network policy, backup recovery,
  distributed throttling and deployment monitoring require independent validation.
