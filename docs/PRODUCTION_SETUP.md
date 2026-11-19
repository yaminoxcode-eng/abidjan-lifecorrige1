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

## 4. Comptes et récupération
La création de compte se fait directement avec le numéro de téléphone et le mot de passe. L'adresse e-mail est facultative et sert uniquement à la récupération du mot de passe. SMTP Brevo n'est donc pas nécessaire pour créer un compte ; il reste facultatif pour la récupération par e-mail. Les mots de passe restent hachés côté serveur.

## 5. Économie du jeu — sans monétisation réelle
Tous les achats disponibles dans le jeu utilisent exclusivement la monnaie virtuelle du joueur. Les gemmes peuvent être converties en monnaie virtuelle depuis l'application Récompenses. Aucun achat en argent réel, paiement Wave réel, carte bancaire, crédit de gemmes payant ou conversion en argent réel n'est actif. Les abonnements affichent uniquement « Abonnements indisponibles pour le moment ». La valeur des gemmes reste strictement virtuelle : 1 gemme = 1 000 000 FCFA de monnaie du jeu, sans valeur ni conversion en francs CFA réels.

## 6. Déploiement
Après les secrets et la migration : vérifier les tests GitHub Actions, relire la PR, puis fusionner. Render déploiera automatiquement `main`. Contrôler ensuite `/health`, inscription, connexion, sauvegarde, multijoueur et récupération e-mail. Les paiements restent désactivés jusqu'à validation Wave.

## Variables de référence
Voir `server/.env.example` pour la liste des noms de variables (sans secrets).
