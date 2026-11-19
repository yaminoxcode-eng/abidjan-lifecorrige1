# Configuration production — Abidjan Life

Le service Render connecté utilise la branche `main`. La branche `ai-economy-accounts-analysts-v1` reste une branche de préparation jusqu'à validation de la PR et configuration des services externes.

## 1. Supabase (stockage permanent)
1. Ouvre le SQL Editor du projet Supabase.
2. Exécute le fichier `supabase/migrations/20261119_abidjan_life_core.sql`.
3. Dans Render > service `abidjan-lifecorrige1` > Environment, ajoute `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`.
4. La clé `service_role` reste uniquement sur Render. Ne la colle jamais dans le client ou GitHub.

Le schéma crée les tables `game_accounts`, `creator_reports`, `afgamer_inbox` et la fonction de suppression ciblée appelée par l'API. Il ne supprime aucune donnée existante.

## 2. Sécurité des sessions et du compte créateur
- Définis `JWT_SECRET` comme une valeur aléatoire longue et stable. Le fallback temporaire du code actuel génère une nouvelle clé à chaque redémarrage et invalide les sessions précédentes.
- Définis `CREATOR_ACCOUNT_PHONE` avec le numéro du compte officiel, uniquement dans Render. Le rôle créateur actuel est déterminé par ce numéro après authentification : une protection MFA/OTP dédiée au compte créateur reste à ajouter avant ouverture publique des outils sensibles.
- N'ajoute aucun mot de passe ni numéro personnel dans ce dépôt.

## 3. Assistant IA
Ajoute `OPENAI_API_KEY` dans Render. Le modèle configuré par défaut est dans `OPENAI_MODEL`. Mets une limite de dépenses et surveille l'utilisation du compte API. Sans clé, l'assistant répond en mode local limité.

## 4. E-mails
Ajoute `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. La récupération par code e-mail restera indisponible tant que SMTP n'est pas opérationnel. L'inscription actuelle vérifie le format de l'adresse mais ne réalise pas encore de vérification de possession de l'e-mail : ne pas présenter cette étape comme terminée.

## 5. Paiements et abonnements
Wave n'est pas connecté au code actuel. Aucun bouton ne doit annoncer un achat réel comme réussi. Avant activation : compte marchand Wave Business, accès API officiel, création d'une commande côté serveur, vérification cryptographique du webhook, identifiant de transaction unique/idempotent, journal de transactions, remboursements et tests sandbox. Les gemmes sont une monnaie virtuelle : 1 gemme = 1 000 000 FCFA dans le jeu uniquement. Le tarif utilisateur communiqué est 5 gemmes pour 500 FCFA réels. Aucune conversion gemmes-vers-argent réel.

## 6. Déploiement
Après les secrets et la migration : vérifier les tests GitHub Actions, relire la PR, puis fusionner. Render déploiera automatiquement `main`. Contrôler ensuite `/health`, inscription, connexion, sauvegarde, multijoueur et récupération e-mail. Les paiements restent désactivés jusqu'à validation Wave.

## Variables de référence
Voir `server/.env.example` pour la liste des noms de variables (sans secrets).
