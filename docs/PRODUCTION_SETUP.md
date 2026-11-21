# Configuration production — Abidjan Life

Le service Render connecté utilise actuellement la branche `main`. La branche `staging/multiplayer-free-tier` reste une branche de préparation : ses changements ne sont pas encore en production.

## 1. Supabase (stockage permanent)
1. Ouvre le SQL Editor du projet Supabase.
2. Pour une nouvelle base, exécute `supabase/migrations/20261119_abidjan_life_core.sql`.
3. Pour une base ayant déjà reçu la migration initiale, exécute ensuite `supabase/migrations/20261121_allow_shared_email_accounts.sql`.
4. Dans Render > service `abidjan-lifecorrige1` > Environment, ajoute `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`.
5. La clé `service_role` reste uniquement sur Render. Ne la colle jamais dans le client ou GitHub.

Le schéma conserve le téléphone comme identifiant unique du compte. Une même adresse e-mail peut être associée à plusieurs comptes téléphoniques ; elle sert de contact de récupération. L'index e-mail est non unique.

## 2. Sécurité des sessions et du compte créateur
- Définis `JWT_SECRET` comme une valeur aléatoire longue et stable. Le fallback temporaire du code actuel génère une nouvelle clé à chaque redémarrage et invalide les sessions précédentes.
- Définis `CREATOR_ACCOUNT_PHONE` avec le numéro du compte officiel, uniquement dans Render. Le rôle créateur actuel est déterminé par ce numéro après authentification : une protection MFA/OTP dédiée au compte créateur reste à ajouter avant ouverture publique des outils sensibles.
- N'ajoute aucun mot de passe ni numéro personnel dans ce dépôt.

## 3. Assistant IA
Ajoute `OPENAI_API_KEY` dans Render uniquement si l'assistant IA distant est activé. Le modèle configuré est dans `OPENAI_MODEL`. Sans clé, l'assistant reste en mode local limité. Ne crée aucune dépense API non souhaitée.

## 4. Comptes et récupération
La création actuelle demande un numéro ivoirien, un mot de passe, une adresse e-mail et un code de vérification. Il faut donc configurer SMTP sur Render (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) pour que l'inscription et la récupération par e-mail fonctionnent. Le fournisseur SMTP peut être choisi avec une offre gratuite ; aucun abonnement payant n'est requis par le code. Les mots de passe sont hachés côté serveur. La date et la commune de naissance sont validées côté serveur.

## 5. Économie du jeu — sans monétisation réelle
Tous les achats disponibles dans le jeu utilisent exclusivement la monnaie virtuelle du joueur. Les gemmes peuvent être converties en monnaie virtuelle depuis l'application Récompenses. Aucun achat en argent réel, paiement Wave réel, carte bancaire, crédit de gemmes payant ou conversion en argent réel n'est actif. Les abonnements affichent uniquement « Abonnements indisponibles pour le moment ». La valeur des gemmes reste strictement virtuelle : 1 gemme = 1 000 000 FCFA de monnaie du jeu, sans valeur ni conversion en francs CFA réels.

## 6. Déploiement
Après configuration des secrets et application des migrations : vérifier les tests GitHub Actions, relire la PR, puis fusionner uniquement après validation. Render déploiera automatiquement `main`. Contrôler ensuite `/health`, inscription, connexion, sauvegarde, multijoueur et récupération e-mail. Les paiements restent désactivés jusqu'à validation Wave.

## Variables de référence
Voir `server/.env.example` pour la liste des noms de variables (sans secrets).
