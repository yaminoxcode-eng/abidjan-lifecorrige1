# ABIDJAN LIFE — Vérification Supabase et correction de version
**Date :** 18 novembre 2026  
**Dépôt / branche :** `yaminoxcode-eng/abidjan-lifecorrige1` / `abidjan-life-refonte`  
**Commit client :** `404454d072da31f58645de4346fec745f1ac984e`

## Résultat

La connexion de contrôle Supabase a permis d'inspecter le projet « Abidjan life » : il est `ACTIVE_HEALTHY`. Les migrations présentes incluent la persistance des comptes, les sauvegardes cloud, l'optimisation RLS et la migration de suppression sécurisée.

## Corrections faites sur la branche de travail

- Le titre de l'interface client est aligné sur **V1.26.0**.
- La valeur de repli `ABJ_BUILD_VERSION` du client est alignée sur **1.26.0**, comme la valeur de repli `GAME_VERSION` du serveur.
- Aucun déploiement ni fusion dans `main` n'a été lancé.

## Vérifications Supabase

Tables observées :
- `game_accounts` : comptes persistants, RLS activé.
- `player_profiles` et `player_saves` : tables de profils/sauvegardes, RLS activé avec politiques de lecture/écriture propriétaire.
- `creator_reports` et `afgamer_inbox` : RLS activé.

Les rôles `anon` et `authenticated` n'ont pas de privilèges de table sur les tables administratives `game_accounts`, `creator_reports` et `afgamer_inbox` dans le résultat des grants consultés. Le rôle `service_role` et `postgres` disposent des privilèges backend nécessaires. Les tables `game_accounts`, `creator_reports` et `afgamer_inbox` n'ont pas de politique RLS : c'est cohérent avec leur accès réservé au backend, à condition de ne jamais exposer la clé service role dans le navigateur.

### Fonction de suppression
La fonction `public.delete_game_account_data(p_phone text)` est présente. Elle supprime les données associées dans `afgamer_inbox`, `creator_reports`, `player_saves`, `player_profiles` et `game_accounts`. Elle n'est **pas** déclarée `SECURITY DEFINER`; son exécution est accordée à `service_role` et au propriétaire `postgres` uniquement. Son `search_path` est fixé à `pg_catalog, public`. Cette configuration évite d'offrir une fonction administrative exécutable publiquement.

## Alertes restantes

1. L'advisor Supabase signale que la protection contre les mots de passe compromis est désactivée. À activer dans Auth > Security and Protection si compatible avec le parcours d'inscription.
2. Les advisors relèvent des index inutilisés ; ce sont des observations de performance, pas une raison suffisante pour les supprimer sans mesurer l'usage.
3. L'état réel des variables Render (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `GAME_VERSION`, `CLIENT_URL`, `MIN_GAME_VERSION`) n'est pas accessible depuis l'outil Supabase. Leur présence et leur valeur ne sont donc pas confirmées.
4. Les endpoints Render `/health` et `/api/updates/latest` n'ont pas pu être consultés depuis l'environnement de contrôle.
5. Aucun test d'inscription, de connexion, de sauvegarde ou de suppression avec un compte de test n'a été exécuté. Aucune donnée de joueur n'a été supprimée.

## Avant déploiement
- Vérifier dans Render que les variables Supabase et `JWT_SECRET` sont configurées ; `JWT_SECRET` doit être stable entre redémarrages.
- Vérifier que `GAME_VERSION=1.26.0`, `MIN_GAME_VERSION` et `CLIENT_URL` pointent vers la même release testée.
- Vérifier les endpoints Render et réaliser les tests de compte/sauvegarde/suppression avec un compte jetable.
- Déployer d'abord un aperçu de la branche et tester sur PC et mobile avant toute fusion dans `main`.

**Conclusion :** version du client corrigée dans GitHub et base Supabase inspectée. Le service Render, ses variables d'environnement et le parcours complet en navigateur restent à valider ; cette branche n'est pas encore déclarée prête pour la production.
