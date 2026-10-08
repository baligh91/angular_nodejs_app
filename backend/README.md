# FML API

Backend NestJS minimal pour l’application FML format 5.

## Données

Mongoose n’initialise qu’une collection : `users`. Chaque document contient l’ID FPL, prénom, nom, nom d’équipe FPL, la session refresh, l’équipe FML intégrée, les snapshots de roster par GW, les scores GW et le cumul.

```text
users
  fplId, firstName, lastName, fplTeamName
  passwordHash (scrypt)
  team: { name, leagueFplId, leagueName, managerIds, captainId, budget, spent, managers[], pendingSnapshots[] }
  scoreHistory: [{ gw, points, total, managerIds, captainId, teamName, capturedAt }]
  totalScore, tokenVersion, refreshHash, refreshExpires
```

La collection ne contient pas les ligues, managers, GW, scores, prix, membres, classements ou challenges séparément. Les candidats managers sont lus à la demande depuis les standings publics de FPL. Avant chaque deadline, le roster et le capitaine sont intégrés dans `team.pendingSnapshots`; le score d’une GW est la somme des points FPL de ce snapshot, avec le capitaine doublé. Après calcul, le snapshot est déplacé dans `scoreHistory` et consommé pour empêcher un double comptage.

## API

Toutes les routes sont sous `/api`.

| Méthode | Route | Usage |
| --- | --- | --- |
| `POST` | `/auth/register` | `{fplId, password}`; vérifie l’entrée FPL, stocke un hash scrypt et ouvre une session |
| `POST` | `/auth/login` | `{fplId, password}`; ouvre une session avec les identifiants |
| `POST` | `/auth/refresh` | Renouvelle la session via cookie HttpOnly |
| `POST` | `/auth/logout` | Révoque la session |
| `GET` | `/auth/me` | Document utilisateur courant |
| `GET` | `/team/leagues` | Ligues classiques publiques du compte connecté, chargées depuis FPL |
| `GET` | `/team/managers?leagueFplId=...` | Managers d’une ligue classique publique |
| `GET` | `/team` | Équipe et scores GW/cumul |
| `PUT` | `/team` | Crée/remplace l’équipe format 5 |
| `POST` | `/team/sync` | Actualise les GW terminées et le total |
| `GET` | `/health` | Vérifie la connexion MongoDB |

L’API limite l’inscription et la connexion à cinq requêtes par minute et vérifie l’origine des opérations de session. Les mots de passe ont au moins 12 caractères à l’inscription et ne sont stockés que sous forme de hash scrypt. L’ID FPL reste public et sa propriété n’est pas vérifiée : un visiteur peut inscrire en premier un ID encore disponible. Ne pas présenter cette inscription comme une preuve d’identité FPL.

## Installation et lancement

Utiliser Node.js 22 et npm depuis ce dossier :

```powershell
npm ci
Copy-Item .env.example .env
# Configurer MONGODB_URI, JWT_SECRET (32 caractères minimum), APP_ORIGIN et CRON_SECRET.
npm run build
npm run start:dev
```

MongoDB standalone suffit : les opérations ne dépendent plus de transactions multi-collections. Valeurs locales par défaut : API sur le port 3000, Mongo `mongodb://127.0.0.1:27017/fml`, frontend `http://localhost:4200`.

## Migration depuis l’ancien modèle

La migration est en simulation par défaut et refuse les utilisateurs avec plusieurs équipes ou une équipe autre que format 5 :

```powershell
npm run migrate:single-collection
```

Vérifier le résumé, puis appliquer explicitement :

```powershell
npm run migrate:single-collection -- --apply
```

Elle intègre l’identité, l’équipe, les managers sélectionnés, les scores finalisés et les snapshots non scorés dans `users`, puis supprime les collections historiques. Les GW sans roster capturé ne sont jamais converties en faux scores; le prochain sync crée les snapshots des GW encore ouvertes. Sauvegarder la base avant l’application.

## Tests

```powershell
npm run build
npm test
npm run test:integration
```

Les tests d’intégration créent un MongoDB temporaire standalone et mockent l’API FPL. Ils vérifient la collection unique, le roster format 5, le capitaine, les scores par GW, le cumul et l’absence des routes supprimées.
