# Fantasy Manager League

Application FML simplifiée : un compte par ID FPL, une équipe de cinq managers, un score pour chaque GW terminée et un cumul de saison.

## Architecture

- Frontend : Angular 21, écran de connexion, dashboard et éditeur d’équipe.
- API : NestJS, login FPL, recherche de managers dans une ligue classique publique et calcul des scores.
- MongoDB : une seule collection, `users`. L’identité, l’équipe, les snapshots de roster et les scores sont intégrés dans le document utilisateur.
- Format unique : 5 managers, budget 25M, capitaine à points doubles.

## Connexion

Sur `/fml/connect`, saisir l’ID FPL public. L’application récupère le prénom, le nom et le nom d’équipe FPL, puis ouvre une session.

**Risque important :** l’ID FPL est public, pas un secret. Toute personne qui le connaît peut se connecter à ce compte et modifier son équipe FML. Ce mode ne protège pas l’identité et ne doit pas être présenté comme une authentification sûre.

## Équipe et scores

Dans « My team », les ligues classiques publiques de l’utilisateur sont chargées depuis son profil FPL; la ligue actuelle est présélectionnée, sinon la première ligue disponible. Ses managers sont chargés automatiquement. Choisir exactement cinq managers, un capitaine et un nom d’équipe. Le coût est calculé depuis le rang FPL avec le budget de 25M.

Les scores sont la somme des points GW FPL des cinq managers; le capitaine compte double. Avant chaque deadline, le roster et le capitaine sont figés comme snapshot. Chaque score GW, son roster source et le cumul restent dans le même document Mongo. Le bouton « Update scores » synchronise les GW finalisées et prépare les snapshots futurs; le backend effectue aussi une synchronisation horaire.

## Lancement local

Prérequis : Node.js 22, npm 10 et MongoDB local ou distant.

```powershell
npm ci
Set-Location backend
npm ci
Copy-Item .env.example .env
# Configurer MONGODB_URI, JWT_SECRET (32 caractères minimum) et APP_ORIGIN.
npm run start:dev
```

Dans un autre terminal à la racine :

```powershell
npm start
```

Frontend : http://localhost:4200/fml · API : http://localhost:3000/api · Santé : `/api/health`.
Le proxy Angular transmet `/api` à NestJS.

Pour une ancienne base FML, vérifier d’abord la migration :

```powershell
Set-Location backend
npm run migrate:single-collection
```

La commande est en simulation par défaut. Si le résumé est correct et que les équipes/scorings à conserver sont bien détectés, appliquer la migration destructive qui intègre les équipes dans `users` et supprime les anciennes collections :

```powershell
npm run migrate:single-collection -- --apply
```

## Vérification

```powershell
npm run build
npm test -- --watch=false
Set-Location backend
npm run build
npm test
```

`COOKIE_SECURE=false` est réservé au développement HTTP local. Le login par ID seul est inadapté à un service public avec de vrais comptes; une preuve secrète ou une authentification distincte sera nécessaire avant tout déploiement public.
