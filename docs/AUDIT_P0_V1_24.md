# ABIDJAN LIFE — Audit P0 de la base V1.24
**Date de l’audit :** 18 novembre 2026  
**Branche examinée :** `abidjan-life-refonte`  
**Dépôt :** `yaminoxcode-eng/abidjan-lifecorrige1`  
**Référence client :** `client/index.html` (801 303 octets, blob `3ec35e402f8d554c378f5232d50731ccbf81c94b`)  
**Référence serveur :** `server/server.js` (41 919 octets) et `server/package.json`.

## Résultat général
**Audit statique commencé — mise en production non autorisée à ce stade.** Le code contient les parcours de compte, de sauvegarde, de suppression de compte et de mise à jour, mais plusieurs dépendances de configuration et de cohérence de version doivent être vérifiées avant de considérer la base comme fiable.

Aucun code du jeu n’a été modifié pendant cet audit. Aucun déploiement n’a été lancé. Les vérifications HTTP du serveur Render n’ont pas pu être obtenues depuis l’environnement de contrôle ; les tests réels dans un navigateur PC/téléphone restent donc à faire.

## Constats P0

### P0-1 — Persistance serveur conditionnelle à Supabase
**Constaté dans le code.** Le serveur n’active la persistance que si `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont tous deux définis. Sinon, il démarre avec `storage: memory-only`. Dans ce mode :
- l’inscription serveur échoue avec HTTP 503, car `persistAccount()` refuse explicitement les écritures ;
- les sauvegardes distantes échouent et le serveur renvoie `persistent: false` ;
- la suppression définitive de compte est refusée avec HTTP 503 ;
- les comptes chargés uniquement en mémoire ne survivent pas à un redémarrage du processus.

**Action requise :** vérifier dans l’hébergeur que les deux variables Supabase sont configurées, que la table `game_accounts` existe et que la fonction RPC `delete_game_account_data` est déployée. Ne jamais ajouter la clé service_role au client.

### P0-2 — Version client / serveur à aligner
**Constaté dans le code.**
- Le titre HTML affiche « Abidjan Life V1.24 ».
- Le client définit comme valeur de repli `ABJ_BUILD_VERSION = '1.0.1'`.
- Le serveur définit comme version de repli `GAME_VERSION = '1.26.0'`.

Ces valeurs ne sont pas cohérentes si aucune variable de déploiement ne les remplace. Le client peut alors considérer qu’une mise à jour est disponible à chaque nouvelle session, même si l’écran affiche V1.24.

**Action requise :** fixer une seule version de référence pour le client et le serveur au moment du build/déploiement, puis tester le manifeste `/api/updates/latest` avec un client identique et un client ancien.

### P0-3 — Mise à jour manuelle : parcours présent, application réelle à tester
**Constaté dans le code.** L’écran d’excuse, la barre de progression et le bouton « LANCER LE CHARGEMENT » sont présents. Le bouton lit `clientUrl` depuis le manifeste, télécharge la réponse pour suivre sa progression, puis navigue vers cette URL ; si aucune URL n’est configurée, il recharge la page courante.

**Risque à vérifier :** si `clientUrl` est vide ou pointe vers une ancienne version, le chargement peut afficher 100 % sans apporter le nouveau client. Le téléchargement préalable n’installe pas un paquet séparé : la navigation finale vers l’URL est ce qui charge la version cible.

**Action requise :** vérifier l’URL et la version réellement servies, puis tester succès, erreur réseau, bouton Réessayer et conservation de la sauvegarde.

### P0-4 — Stockage local de secours non durable
**Constaté dans le code.** Le client tente `localStorage`, puis `sessionStorage`, puis une mémoire JavaScript temporaire. Le mode mémoire ne garantit pas la conservation après fermeture/rechargement de la page.

**Action requise :** tester le jeu dans le navigateur réellement utilisé, vérifier le mode de stockage effectif, puis confirmer que le compte authentifié et la sauvegarde serveur restent disponibles sur un second appareil.

### P0-5 — Suppression de compte dépendante du stockage permanent
**Constaté dans le code.** Le client appelle `DELETE /api/account/me`, attend une confirmation `deleted: true`, puis nettoie les clés locales et recharge l’accueil. Le serveur exige Supabase et appelle `rpc/delete_game_account_data` avant de supprimer la session active.

**Action requise :** tester avec un compte de test uniquement, vérifier la suppression des données liées côté base, la déconnexion des sessions actives et le retour à l’accueil. Ne pas tester avec le compte principal avant confirmation de la procédure.

## Éléments positifs repérés
- Le serveur utilise `bcryptjs` pour hacher les mots de passe et JWT pour les sessions.
- Les routes d’inscription, connexion, récupération et suppression sont présentes.
- Le serveur refuse explicitement les écritures quand la persistance Supabase n’est pas configurée, plutôt que de prétendre sauvegarder durablement.
- Les erreurs JavaScript et les promesses rejetées disposent de gestionnaires de signalement dans le client.
- Le parcours de mise à jour contient un bouton de relance après échec réseau.

## Tests non réalisés — à ne pas considérer comme réussis
- Ouverture du site déployé et vérification du commit effectivement servi.
- Chargement complet sur PC et iPhone, console sans erreur, rendu 3D et chargement OSM.
- Inscription, connexion, récupération de compte et migration d’un ancien compte.
- Sauvegarde, rechargement, reconnexion sur un autre appareil.
- Suppression complète d’un compte de test.
- Mise à jour manuelle avec une version cible distincte.
- Vérification du serveur Render, de sa configuration Supabase et de la fonction SQL de suppression.

## Ordre de correction recommandé
1. Vérifier le serveur Render et son état de stockage ; confirmer Supabase sans exposer de secrets.
2. Aligner la version client/serveur et contrôler le manifeste de mise à jour.
3. Exécuter les tests P0 avec un compte de test et conserver les preuves de résultat.
4. Corriger seulement les anomalies reproduites, sur cette branche de travail.
5. Relancer l’audit puis préparer un déploiement contrôlé ; ne pas fusionner dans `main` avant validation.

## Limites de cet audit
Cet audit est une inspection statique des fichiers GitHub et des chemins de code. Il ne prouve pas la configuration réelle des variables d’environnement, l’état de la base Supabase, le comportement du service Render ni le résultat d’une session de jeu dans un navigateur.


## Mise à jour de vérification — 18 novembre 2026
### Supabase : connexion au projet confirmée
Le projet Supabase **Abidjan life** (`aczdojrkgrynvlzshbyw`) est accessible et son état est `ACTIVE_HEALTHY`. Le schéma public contient les tables `game_accounts`, `creator_reports`, `player_profiles`, `player_saves` et `afgamer_inbox`. La base contient déjà des comptes et des signalements ; aucune donnée de compte n’a été lue ou modifiée.

### Fonction de suppression : sécurisation effectuée et vérifiée
La fonction `public.delete_game_account_data(text)` existait et supprime les enregistrements associés au numéro dans les tables de profils, sauvegardes, comptes, signalements et boîte de réception. Une migration a été appliquée pour limiter son exécution au rôle backend `service_role`.

Résultat de vérification après migration :
- `service_role` peut exécuter la fonction : **oui** ;
- `anon` peut l’exécuter : **non** ;
- `authenticated` peut l’exécuter : **non** ;
- aucune politique d’écriture publique n’a été détectée sur `game_accounts` et `creator_reports`.

Migration : `secure_account_deletion_rpc`. Cette opération a modifié les permissions SQL, pas les données des joueurs.

### Render : non vérifié depuis cette session
Aucun connecteur Render ni accès aux variables d’environnement du service n’est disponible dans cet espace. Les URLs `/`, `/health` et `/api/updates/latest` n’ont pas pu être consultées via l’outil de navigation. Il est donc impossible de confirmer ici :
- que `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont configurées dans le service Render ;
- que `GAME_VERSION`, `MIN_GAME_VERSION` et `CLIENT_URL` ont les valeurs attendues ;
- que le serveur actuellement déployé utilise cette même base Supabase.

**Aucune clé secrète n’a été demandée, copiée ou exposée.** Ne jamais coller la clé `service_role` dans GitHub ou dans le code client.

### Version client/serveur : correction différée volontairement
Le fichier client conserve le titre V1.24 et une valeur de repli `ABJ_BUILD_VERSION=1.0.1`, tandis que le serveur utilise `GAME_VERSION=1.26.0` comme valeur de repli. Comme la valeur réellement définie dans Render n’est pas accessible, modifier arbitrairement l’un de ces numéros risquerait de provoquer une mise à jour forcée incorrecte ou d’étiqueter faussement le client. Aucun numéro de version n’a donc été changé. La correction doit être faite après lecture des variables Render et confirmation du client réellement déployé.

### État réel après cette passe
- Supabase actif : **confirmé**.
- Tables de persistance présentes : **confirmé**.
- RPC de suppression réservée au backend : **corrigé et vérifié**.
- Variables Supabase du service Render : **à vérifier dans Render**.
- Manifeste de mise à jour et URL cible en production : **à vérifier**.
- Parcours navigateur (PC/iPhone), inscription, sauvegarde, connexion et suppression d’un compte de test : **non exécutés**.
- Code du jeu modifié : **non**.
- Déploiement déclenché : **non**.
