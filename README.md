# Fantasy Manager League

Application FML simplifiée : un compte par ID FPL, une équipe de cinq managers, un score pour chaque GW terminée et un cumul de saison.

## Architecture

- Frontend : Angular 21, écran de connexion, dashboard et éditeur d’équipe.
- API : NestJS, inscription/connexion par ID FPL et mot de passe, recherche de managers dans une ligue classique publique et calcul des scores.
- MongoDB : une seule collection, `users`. L’identité, l’équipe, les snapshots de roster et les scores sont intégrés dans le document utilisateur.
- Format unique : 5 managers, budget 25M, capitaine à points doubles.

## Connexion

Sur `/fml/connect`, créer un compte avec l’ID FPL et un mot de passe d’au moins 12 caractères, ou se connecter avec ces identifiants. Le profil FPL public est récupéré lors de l’inscription. Le mot de passe est stocké sous forme de hash scrypt dans le document `users`; il n’est jamais renvoyé par l’API.

**Limite d’identité :** l’ID FPL est public. Le mot de passe protège le compte après son inscription, mais l’application ne vérifie pas que la personne qui crée le compte possède réellement cet ID. Quelqu’un peut donc inscrire en premier un ID FPL non encore enregistré. Ne réutilisez pas le mot de passe d’un autre service.

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

## Déploiement Vercel

Le dépôt est configuré pour publier l’application Angular et son API NestJS sur Vercel. La version Node est fixée à 22; les routes Angular retombent sur `index.csr.html`, et l’API est servie sous `/api`.

Importer le dépôt GitHub dans Vercel en utilisant sa racine comme répertoire du projet, puis définir ces variables pour Production (et Preview si nécessaire) :

- `MONGODB_URI` : URI MongoDB Atlas ou autre MongoDB accessible depuis Vercel.
- `JWT_SECRET` : secret aléatoire d’au moins 32 caractères.
- `CRON_SECRET` : secret aléatoire utilisé pour autoriser la synchronisation horaire.
- `APP_ORIGIN` : URL HTTPS exacte du déploiement de production, sans slash final.

Le cron Vercel appelle `/api/cron/sync` chaque jour à 00:00 UTC (compatible avec l’offre Hobby); le secret `CRON_SECRET` est envoyé dans son en-tête Bearer. La synchronisation manuelle reste disponible entre deux passages. Ne pas copier `.env` dans le dépôt : seuls les noms de variables et exemples non secrets sont versionnés.

Le login par mot de passe n’inclut pas encore de preuve de propriété de l’ID FPL. Voir la limite décrite dans « Connexion » avant de rendre le site public.

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
