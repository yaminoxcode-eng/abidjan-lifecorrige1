# Abidjan Life — multijoueur + mises à jour automatiques (V2 architecture)

## Fichiers
- `client/index.html` : jeu à publier sur Vercel.
- `client/admin.html` : tableau de bord privé de publication et de suivi.
- `server/server.js` : API, Socket.IO, comptes temporaires et gestionnaire de versions.
- `server/Dockerfile` : déploiement Docker sur Render.

## 1. Déployer le serveur Render
Créer un Web Service depuis le dépôt, environnement **Docker**, Root Directory `server`. Configurer :
- `JWT_SECRET` : secret aléatoire long (32 caractères minimum).
- `UPDATE_ADMIN_TOKEN` : clé privée longue et unique, à garder secrète.
- `CLIENT_ORIGINS` : origine exacte du site Vercel, par exemple `https://abidjan-life.vercel.app`.
- `GAME_VERSION` : version initiale, par exemple `1.26.0`.
- `CLIENT_URL` : URL unique Vercel correspondant exactement à la version initiale.
- `MIN_GAME_VERSION` : version minimale acceptée (facultatif, défaut = GAME_VERSION).
Render fournit `PORT`.

## 2. Déployer le client Vercel
Déployer `client` comme Root Directory. Dans `client/index.html`, remplacer `https://REMPLACE-ICI-URL-RENDER` par l’URL HTTPS du serveur Render. Publier ensuite le site.

## 3. Ouvrir le tableau de bord
Ouvrir `https://TON-SITE-VERCEL/admin.html`. Entrer l’URL Render et `UPDATE_ADMIN_TOKEN`. L’API refuse les demandes sans cette clé. La clé n’est pas écrite dans le jeu public; le tableau de bord la garde uniquement dans la mémoire de l’onglet.

Le panneau permet de :
- voir la version active, les joueurs connectés et leur répartition par version;
- publier une version avec URL de déploiement et notes de version;
- envoyer une mise à jour urgente (les clients connectés reçoivent l’événement);
- revenir à la version précédente;
- consulter l’historique des publications et retours arrière.

## 4. Procédure pour chaque mise à jour
1. Modifier le jeu sans supprimer les systèmes existants.
2. Déployer une nouvelle version sur Vercel et la tester.
3. Copier l’URL **unique et immuable** du déploiement Vercel (sous-domaine `.vercel.app` propre à ce déploiement). Ne pas utiliser l’alias de production qui peut pointer vers la nouvelle version après un rollback.
4. Ouvrir `/admin.html`, saisir le numéro (ex. `1.27.0`), la version minimale, l’URL unique et les nouveautés, puis publier.
5. Les clients vérifient le manifeste toutes les 60 secondes et au retour en ligne. Le serveur pousse aussi un signal immédiat via Socket.IO. Le client sauvegarde localement, tente de synchroniser sa sauvegarde en ligne, puis recharge l’URL de la nouvelle version.

## 5. Retour arrière
Le bouton de rollback remet le manifeste sur l’URL unique de la version précédente et notifie les clients. Le navigateur recharge cette ancienne version. Cela ne remplace pas un test préalable et ne restaure pas automatiquement les données de sauvegarde modifiées par un changement de format. Prévoir des migrations de sauvegarde rétrocompatibles.

## 6. Variables de sécurité et limites connues
- Ne partage jamais `UPDATE_ADMIN_TOKEN`; change-le immédiatement s’il est exposé.
- Le manifeste et l’historique des versions sont en mémoire du processus Render dans cette version prototype : un redémarrage efface l’historique et le rollback mémorisé. Renseigner `GAME_VERSION`, `CLIENT_URL` et `MIN_GAME_VERSION` dans Render permet de restaurer la version de base au démarrage, mais pas l’historique complet.
- Les comptes, sauvegardes et positions restent également en mémoire uniquement. Un redémarrage ou une mise en veille de Render peut les effacer. La synchronisation avant mise à jour ne protège pas contre un redémarrage imprévu.
- Le tableau de bord est un fichier public techniquement accessible par URL, mais toutes ses opérations sont protégées côté serveur par la clé admin. Ne jamais mettre cette clé dans `index.html`.
- Les mises à jour du code client exigent une nouvelle publication Vercel; le serveur ne peut pas modifier à distance le code déjà hébergé.
- Cette architecture n’a pas encore été déployée ni testée en conditions réelles multi-navigateurs.

## Vérifications effectuées lors de la préparation
- Syntaxe JavaScript serveur vérifiée avec `node --check`.
- Syntaxe des scripts inline du jeu vérifiée avec `node --check`.
- Vérification navigateur, installation npm, build Docker et déploiements Render/Vercel restent à effectuer.
