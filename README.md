# Fantasy Manager League (FML)

FML est une fantasy de managers FPL : recrutez des managers d'une ligue
Fantasy Premier League, designez un capitaine et comparez vos scores.

## Architecture

- **Frontend** : Angular 21, composants standalone, Angular Material, Tailwind,
  signaux et RxJS, rendu serveur Angular.
- **API** : NestJS / TypeScript, monolithe modulaire, REST et Swagger.
- **Persistance** : MongoDB, prix en dixiemes de million (10 = 1 M).
- **Identite** : ID FPL et verification de propriete par code temporaire dans
  le nom de l'equipe FPL. Session JWT courte et refresh token en cookie HttpOnly,
  rotation et stockage hache ; aucun token persistant dans localStorage.
- **Execution locale** : serveur Angular, API NestJS et MongoDB.

Le projet contient uniquement FML. La demonstration produits, ses pages,
services et son backend Express/MySQL ont ete supprimes.

## Parcours ID FPL

1. Ouvrir `/fml/connect` et saisir l'ID de manager visible dans l'URL de la page
   de points FPL (`/entry/123456/event/1`).
2. FML recupere le profil **public** depuis l'API FPL : nom du manager,
   nom d'equipe, points et rangs saison/GW, club favori et ligues classiques.
3. Un code temporaire est affiche. Modifier le nom de son equipe sur le site
   officiel FPL pour y placer exactement ce code, puis enregistrer.
4. Cliquer sur la verification : FML relit le profil sur FPL et ouvre une
   session uniquement si le code valide correspond.
5. Retablir son nom d'equipe FPL puis actualiser le profil FML.

Il n'existe plus de formulaire email/mot de passe, inscription ou reset password.
Un ID public **ne constitue pas** une preuve de propriete. Le profil previsualise
n'autorise aucune modification persistante avant verification.
Ne jamais partager son code ni utiliser un code envoye par quelqu'un d'autre.
Une nouvelle verification est necessaire apres expiration/deconnexion de session.
Les emails prives, mots de passe et autres informations privees FPL ne sont
ni accessibles ni demandes. FML n'est pas une connexion OAuth officielle FPL.
Les IDs FPL ne doivent pas etre consideres comme une identite permanente entre
deux saisons. Cette version est mono-saison : archiver/isoler les donnees avant
une nouvelle saison pour ne pas rattacher un ancien compte a un ID reutilise.

Le dashboard distingue les statistiques FPL personnelles des points des equipes
FML. Les ligues classiques du profil sont proposees dans l'annuaire des managers.

Les details du modele MongoDB, les regles de calcul et les commandes de l'API
se trouvent dans [backend/README.md](backend/README.md).

## Regles retenues

| Format | Managers | Budget |
| --- | ---: | ---: |
| Squad 5 | 5 | 25 M |
| Squad 7 | 7 | 30 M |
| Squad 11 | 11 | 50 M |

- Recrutement non exclusif ; capitaine parmi les membres, points doubles.
- Prix initial : interpolation du rang entre 10 M et 1 M.
- Apres une GW terminee : indicateur compose a 50 % du score GW et a 50 %
  de la moyenne des cinq dernieres GW disponibles.
- Variation par percentile de ligue : top 10 % +0,2 M ; tranche suivante
  jusqu'au top 30 % +0,1 M ; centre 0 ; bas 30 % -0,1 M ; bas 10 % -0,2 M.
  Prix bornes entre 1 M et 15 M.
- Composition et capitaine **bloques de la deadline officielle jusqu'a la fin
  de la GW**. Les scores utilisent la composition eligible a la deadline,
  pas une equipe creee apres la deadline.
- La source de verite reste FPL ; une synchronisation echouee n'est pas
  remplacee par des donnees simulees.

## Installation locale

Prerequis : Node.js 22, npm 10 et MongoDB 8 en **replica set obligatoire**
(les sauvegardes d'equipes et reglements de GW utilisent des transactions).

```powershell
npm ci
Set-Location backend
npm ci
Copy-Item .env.example .env
# Renseigner MongoDB, JWT_SECRET et APP_ORIGIN dans .env.
npm run start:dev
```

Dans un autre terminal a la racine :

```powershell
npm start
```

Frontend : `http://localhost:4200/fml` ; API : `http://localhost:3000/api` ;
documentation interactive : `http://localhost:3000/api/docs`.
Le proxy Angular de developpement transmet `/api` a NestJS.

Les erreurs de reseau, d'import FPL et de validation sont affichees dans l'UI.

`COOKIE_SECURE=false` est reserve a l'execution HTTP locale.
Pour un deploiement public : terminaison TLS, origine HTTPS exacte,
`COOKIE_SECURE=true` et secrets geres hors Git.

## Donnees de demonstration

Le seed est **explicite** et ne se lance jamais au demarrage. Il est reserve
a une base de demonstration isolee et n'offre pas de raccourci public pour
contourner la verification FPL.
Voir [le guide backend](backend/README.md) pour la commande et les comptes.
L'import d'une ligue reelle se fait ensuite depuis l'interface FML.

## Verification

```powershell
npm run build
npm test -- --watch=false
Set-Location backend
npm run build
npm test
```

Les tests backend d'integration et leurs prerequis sont precises dans
[backend/README.md](backend/README.md).

La suite frontend couvre FML et le shell applicatif. Les anciens tests produits
ont ete retires avec les fonctionnalites correspondantes.

## Execution du frontend compile sans conteneurs

```powershell
npm run build
$env:PORT = '4000'
$env:FML_API_URL = 'http://127.0.0.1:3000'
npm run serve:ssr:angular-nodejs-app
```

Le serveur Angular transmet `/api` a NestJS, y compris les cookies de refresh.
Configurer `APP_ORIGIN=http://localhost:4000` dans le backend pour cette
execution locale (au lieu de `http://localhost:4200` pour `npm start`).
Les pages FML authentifiees sont rendues cote client pour ne pas partager
de session pendant le prerendu.
Pour un domaine public, renseigner aussi la liste explicite
`security.allowedHosts` de la configuration Angular avant compilation.
Ne pas utiliser un wildcard pour contourner cette protection.

## Qualification avant mise en production

Cette livraison fournit une implementation applicative ; elle ne vaut pas
certification SaaS de production. Avant exposition publique :

- verifier les conditions d'utilisation FPL et les limites d'appels autorisees ;
- tester les synchronisations sur de grandes ligues et les corrections FPL ;
- effectuer une recette multi-utilisateur avec deadlines et changements de GW ;
- mettre en place sauvegardes MongoDB et restauration testee, supervision,
  alertes, politique de retention et exigences RGPD ;
- proteger les services publics avec TLS et verifier les cookies/origines ;
- valider la propagation des changements de nom FPL et le parcours de preuve
  de propriete sans partage de codes ;
- appliquer la migration des anciens comptes documentee dans le guide backend
  sans rattachement automatique par nom ou ID non verifie ;
- definir la disponibilite attendue et le nombre d'instances API avant de
  multiplier les workers cron.

Les resultats des validations executees sont fournis dans le compte rendu de
livraison ; les validations non executees ne doivent pas etre presumees.
