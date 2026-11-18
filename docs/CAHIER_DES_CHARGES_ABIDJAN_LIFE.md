# ABIDJAN LIFE — Cahier des charges consolidé
**Référence de travail :** audit du dépôt `yaminoxcode-eng/abidjan-lifecorrige1`, fichier `client/index.html`, base V1.24 repérée le 18 novembre 2026.  
**Branche de travail documentaire :** `abidjan-life-refonte`.  
**Statut :** document de consolidation ; il ne certifie pas que toutes les fonctions sont terminées ou déployées.

## 1. Règles de gestion du projet

1. La base récente V1.24 est la référence d'audit, car elle contient les évolutions récentes retrouvées (aéroport, Voyage ABJ, immobilier, applications et correctifs de chargement).
2. L'ancienne base `yaminoxcode-eng/abidjan-lyfe`, branche `abidjan-life-refonte`, reste une source historique à comparer. Ne pas écraser ni abandonner ses améliorations sans comparaison.
3. Toutes les prochaines modifications de code doivent être faites sur une branche de travail, jamais directement sur `main`. La branche documentaire créée dans le dépôt récent est `abidjan-life-refonte`.
4. Ne jamais déclarer une fonctionnalité « terminée » sur la seule présence d'un bouton, d'un menu ou d'une fonction JavaScript. Il faut réussir un test utilisateur représentatif.
5. Ne pas présenter les simulations internes comme des services externes réels : Wave simulé n'est pas Wave réel ; horaires/itinéraires provisoires ne sont pas des horaires officiels ; un vol visible n'établit pas encore un voyage complet.
6. Préserver les fonctions déjà existantes lors des améliorations visuelles et techniques.
7. Priorité aux solutions gratuites ou à coût nul, avec avertissement clair sur les limites des offres gratuites.

## 2. Légende des statuts

- **Repéré dans le code** : élément ou fonction identifié dans la base V1.24, sans garantie de fonctionnement complet.
- **Test antérieur rapporté** : test réussi dans une version historique, à refaire sur la base récente.
- **Partiel / à valider** : logique commencée ou présence insuffisante pour certifier le parcours complet.
- **À construire** : demande connue sans preuve suffisante d'intégration.
- **Bloquant** : problème qui doit être résolu avant d'étendre les fonctionnalités dépendantes.

## 3. Vision du jeu

Abidjan Life est un jeu de simulation de vie en monde ouvert situé à Abidjan. Le joueur crée son identité et son personnage, explore les communes, se déplace, habite, travaille, étudie, fait des achats, développe ses relations, gère son argent, entreprend des activités et peut voyager. Le téléphone est l'interface centrale de services réellement connectés à l'état du joueur et au monde.

Le jeu doit privilégier une ville reconnaissable, vivante, cohérente et jouable sur PC et téléphone. Les systèmes doivent partager les mêmes données : argent, inventaire, identité, logement, emploi, documents, relations, temps et progression.

## 4. Monde ouvert et représentation d'Abidjan

### Exigences
- Représenter les communes et secteurs demandés : Anyama, Abobo, Songon, Yopougon, Attécoubé, Adjamé, Cocody, Bingerville, Le Plateau, Treichville, Marcory, Koumassi et Port-Bouët.
- Routes, carrefours, ronds-points, relief, bâtiments, commerces, écoles, universités, bureaux, hôpitaux et lieux de loisirs.
- Noms de rues et signalisation crédibles ; panneaux de carrefour utilisant les vrais noms de rues lorsque les données le permettent.
- Densité et architecture adaptées aux quartiers ; éviter les grandes zones vides, les bâtiments génériques répétés et le terrain uniformément plat.
- Circulation automobile, piétons, PNJ, jour/nuit et activités locales.
- Déplacements à pied : marcher, courir, sauter ; caméra contrôlable, rotation et zoom.
- Collisions cohérentes : pas de traversée des maisons, murs, meubles ou véhicules solides.

### État repéré
- Données OpenStreetMap et génération de ville présentes.
- Réseau routier et panneaux de rues améliorés dans les commits du 18 novembre.
- Plusieurs zones/communes reconnues dans la logique du jeu.
- PNJ, véhicules, trafic, carte et caméra présents.

### À valider / améliorer
- Exactitude des limites communales et couverture réelle de toutes les communes.
- Densité et reconnaissance visuelle quartier par quartier.
- Relief, routes, collisions et continuité entre zones.
- Comportement naturel du trafic et des piétons sur une session longue.

## 5. Personnage, identité et compte

### Exigences
- Création de personnage avec identité, apparence, genre, vêtements et aperçu 3D.
- Profil joueur et sauvegarde de progression.
- Compte par téléphone et mot de passe, récupération de compte et gestion de session.
- Paramètres du compte accessibles depuis le téléphone.
- Suppression du compte : confirmation explicite, suppression de toutes les données réellement liées au compte, puis retour à l'écran d'accueil.
- Les données sensibles ne doivent pas être stockées en clair ni protégées uniquement par du code côté client.

### État repéré
- Écran de création et aperçu 3D repérés.
- Écrans de compte et récupération repérés.
- Option de suppression de compte repérée dans les paramètres.

### À valider
- Authentification serveur réelle, envoi effectif des codes et sécurité des mots de passe.
- Récupération complète sur un autre appareil.
- Suppression serveur + locale + caches + sauvegardes liées au compte.
- Persistance de la session et prévention des doublons de comptes.

## 6. Téléphone et applications

Le téléphone doit fonctionner comme un système d'applications, pas comme une collection de boutons décoratifs. Chaque app doit lire et modifier les mêmes données de jeu.

### Applications recensées dans les versions et le code
- Carte / localisation.
- Mobilité, transports publics, Yango / CourseGo.
- Banque et Wave.
- Emploi / Travail.
- Boutique, Jumia, inventaire / Mon sac.
- Glovo / livraison.
- Contacts et Messages.
- Appareil photo et Galerie.
- Voyage ABJ.
- Immo ABJ.
- Google / recherche dans le jeu.
- TikTok et YouTube / médias.
- Mairie / démarches.
- Santé.
- Éducation / cours.
- Agenda.
- Réglages / paramètres du compte.
- App Store et groupes d'applications : Mobilité, Achats, Finances, Communication, Médias, Vie pratique.
- Applications de jeux et loisirs.

### Critères communs d'acceptation
- Ouvrir et fermer chaque app sans bloquer le jeu.
- Les boutons effectuent une action réelle et donnent un retour compréhensible.
- Les données restent cohérentes entre les apps et après rechargement.
- Les états vides, erreurs, manque d'argent et absence de réseau sont gérés.
- Les applications installées restent installées après rechargement si cette persistance est prévue.

## 7. Transports urbains

### Exigences
- Bus SOTRA, gbaka, taxis, Yango / CourseGo et motos de livraison.
- Arrêts et gares identifiables par leurs noms locaux et quartiers ; éviter les identifiants répétitifs tels que 010071.
- Gares de taxis avec véhicules présents, hangars différenciés selon leur fonction.
- Véhicules qui suivent des routes cohérentes, s'arrêtent aux arrêts, attendent, embarquent et déposent les passagers.
- Le joueur doit pouvoir manquer un véhicule et attendre le suivant.
- PNJ qui choisissent des destinations et utilisent réellement les transports.
- Yango : choisir une destination, estimer le prix, commander, attendre le chauffeur, monter avec E, voyager et payer à l'arrivée.
- Glovo : accepter une livraison, récupérer une commande, suivre une destination et recevoir le paiement.

### État repéré
- Arrêts OSM, véhicules, attente de PNJ, embarquement/débarquement et applications de mobilité repérés dans l'historique.
- Des lignes de transport provisoires ont été ajoutées.

### Limite connue
Les lignes simulées ne sont pas à présenter comme des itinéraires officiels SOTRA/gbaka tant que les parcours et horaires réels ne sont pas sourcés et vérifiés.

## 8. Aéroport et voyages interurbains

### Exigences
- Aéroport Félix-Houphouët-Boigny avec extérieur, terminal, intérieur, comptoirs, portes et personnel.
- Personnel et voyageurs animés.
- Horaires de départ et d'arrivée, tableau de vols et avions visibles.
- Application Voyage ABJ : villes, destinations, recherche de vols, réservation, billet et documents.
- Parcours complet : acheter le billet, rejoindre l'aéroport, faire l'enregistrement, passer les contrôles, attendre l'embarquement, monter dans l'avion, décoller, voyager, atterrir et arriver dans la ville cible.
- Possibilité de voir les avions décoller/atterrir depuis la ville ou l'aéroport.
- Les vols doivent avoir des horaires cohérents et un nombre de places limité si le système de réservation le prévoit.

### État repéré
- Aéroport, intérieur, interactions de comptoir, personnel animé, horaires programmés, avions et application Voyage ABJ ont des commits dédiés le 18 novembre 2026.

### À valider
- Réservation et paiement de bout en bout.
- Contrôle du billet et embarquement.
- Transition effective vers une autre ville et retour.
- Synchronisation entre horaire affiché, avion, passagers et état du joueur.
- Les villes desservies et les horaires ne doivent pas être inventés comme des horaires réels de compagnies sans source.

## 9. Logement, immobilier et intérieurs

### Exigences
- Entrer/sortir seulement près des portes ; ressortir devant le même bâtiment à l'emplacement cohérent.
- Intérieurs distincts et reconnaissables : salon, chambre, cuisine, salle de bain/douche.
- Sols et murs différenciés par pièce, mobilier adapté, portes et fenêtres.
- Collisions avec murs et meubles ; murs transparents lorsque la caméra est bloquée derrière eux.
- S'asseoir, dormir, se laver et utiliser les équipements.
- Location, achat, vente, terrains et locaux.
- Annonces Immo ABJ reliées aux parcelles physiques.
- Loyer, charges, factures d'eau et d'électricité.
- Jumia pour les achats liés au logement et livraison des objets.

### État repéré
- Intérieurs, portes, logements, Immo ABJ, annonces liées aux parcelles, projets et factures repérés dans le code.

### À valider
- Qualité et complétude de chaque intérieur.
- Cohérence entre annonce, bâtiment, prix, disponibilité et propriété.
- Sauvegarde des meubles et de l'état du logement.
- Paiement et conséquences d'un impayé.

## 10. Économie, banque, travail et entreprises

### Exigences
- Un solde central en FCFA, partagé entre achats, travail, banque, transport, logement et entreprises.
- Historique des entrées/sorties et justificatifs.
- Banque et transferts simulés ; ne jamais prétendre à une connexion bancaire réelle sans intégration officielle.
- Emploi avec métier, lieu, horaires, tâches, salaire, énergie et progression.
- Entreprises : création, employés, activités, revenus, dépenses et documents.
- Autorisations administratives et projets immobiliers.
- Factures, loyer, charges et budget du foyer.

### État repéré
- Emploi, Banque, Wave simulé, entreprises, documents, factures et projets présents à divers degrés.
- Un test historique de l'emploi avait confirmé un paiement de service et une sauvegarde locale ; à rejouer sur V1.24.

### À valider
- Un seul portefeuille de référence.
- Transactions atomiques : pas de double débit ni de solde négatif involontaire.
- Persistance après fermeture et reconnexion.
- Calcul correct des salaires, prix, loyers, charges et revenus.

## 11. Achats, inventaire et livraison

### Exigences
- Catalogue de boutiques locales, produits et prix en FCFA.
- Achat qui débite le portefeuille et ajoute le produit à l'inventaire.
- Inventaire consultable depuis Mon sac.
- Utilisation/consommation des objets avec effets sur faim, énergie, hygiène ou social selon l'objet.
- Jumia pour les objets et équipements du logement.
- Glovo pour la livraison et les missions de coursier.
- Historique des commandes et livraisons.

### État repéré
- Boutique, inventaire, Jumia et Glovo ont des fonctions repérées dans le code V1.24 ou les versions historiques.

### À valider
- Achat, quantité, débit, inventaire, consommation et sauvegarde.
- Empêcher les achats en cas de fonds insuffisants.
- Ne pas dupliquer les objets en double-clic ou après rechargement.
- Livraison avec progression réelle dans le monde.

## 12. Éducation, santé, loisirs et relations

### Exigences
- Écoles et universités, inscription, emploi du temps, cours, examens, progression et compétences.
- Hôpitaux, soins, rendez-vous et conséquences cohérentes sur l'état du personnage.
- Contacts PNJ, conversations, relations et événements sociaux.
- Maquis, bars, boîtes de nuit, karaoké et mini-jeux.
- TikTok / YouTube : publier, obtenir vues/abonnés et éventuellement revenus simulés.
- Agenda avec rendez-vous, horaires de travail, cours et événements.

### État repéré
- Applications Éducation, Santé, Contacts, Messages, médias et Agenda repérées.
- Les systèmes de contacts/messages et emploi avaient réussi des tests dans une version historique ; à revalider.

### À valider
- PNJ avec routines et horaires persistants.
- Conséquences réelles des interactions sur relations et progression.
- Établissements accessibles physiquement et services associés.

## 13. PNJ et simulation de vie

- PNJ avec identité et comportements distincts.
- Routine quotidienne : domicile, travail, école, courses, loisirs, transports et repos.
- Réactions aux événements et au joueur.
- Cohérence avec les horaires et lieux.
- Files d'attente, embarquement, descente et déplacements piétons.
- Éviter que les PNJ restent immobiles, traversent les bâtiments ou disparaissent sans logique.

**Critère de validation :** observer plusieurs PNJ pendant une session longue et vérifier des cycles complets, pas seulement une animation isolée.

## 14. Multijoueur et infrastructure

### Exigences
- Client du jeu et serveur séparés.
- Connexion de comptes et sauvegardes persistantes.
- Synchronisation des joueurs : identité, position, mouvements et état utile.
- Gestion des déconnexions et reconnexions.
- Protection des données et validation des actions côté serveur.
- Architecture à coût nul ou gratuit au départ, en signalant les limites de veille, quotas et pertes de stockage éphémère.

### État historique
- Kit serveur/client préparé avec Vercel, Render, Docker, Node.js et Socket.io.
- Des réponses précédentes signalaient un stockage mémoire seulement et une instance gratuite pouvant s'endormir.

### À valider
- Base persistante réellement configurée.
- Deux appareils peuvent se voir et se déplacer en même temps.
- Les sauvegardes survivent au redémarrage du serveur.
- Authentification et suppression de compte fonctionnent côté serveur.
- Les limites et coûts éventuels sont documentés.

## 15. PC, téléphone, performance et accessibilité

- PC : clavier/souris, caméra fluide et interface lisible.
- Téléphone : joystick, courir, sauter, action, meuble, glissement caméra et zoom tactile.
- Interface moderne, propre et inspirée de l'Afrique contemporaine.
- Chargement progressif, cache des données OSM, gestion des erreurs et reprise.
- Objectif de performance : viser 30 FPS minimum sur appareils modestes et 60 FPS sur appareils compatibles, sans promettre ces chiffres avant mesure.
- Écran de mise à jour : message clair, barre de progression, bouton Lancer et retour d'erreur utile.

### État repéré
- Correctifs de cache OSM, trafic par lots, personnel aéroportuaire et écran manuel de mise à jour commis le 18 novembre.
- Le blocage historique à 93 % doit être testé sur appareil et réseau réels.

## 16. Plan de validation priorisé

### P0 — Fiabilité avant toute nouvelle fonctionnalité
1. Vérifier le dépôt, le commit et le lien de déploiement réellement servis.
2. Ouvrir le jeu sur PC et téléphone ; vérifier console et chargement jusqu'au monde jouable.
3. Tester l'écran de mise à jour et le bouton Lancer.
4. Créer un compte, créer un personnage, sauvegarder, recharger et retrouver la progression.
5. Tester déconnexion, reconnexion et suppression complète du compte.
6. Vérifier qu'aucune erreur JavaScript ne bloque les scripts.

**Acceptation P0 :** aucune erreur bloquante ; progression conservée après rechargement ; compte supprimé conformément à la demande.

### P1 — Boucle de vie quotidienne
1. Acheter un produit.
2. Vérifier le débit et l'ajout à l'inventaire.
3. Consommer l'objet et vérifier les besoins.
4. Fermer/recharger et vérifier la persistance.
5. Effectuer un service de travail et vérifier salaire, énergie, temps et historique.
6. Effectuer un transfert simulé et vérifier les deux côtés du portefeuille.
7. Régler une facture et vérifier le solde.

**Acceptation P1 :** argent, inventaire, besoins et progression cohérents entre les applications.

### P2 — Monde et déplacements
1. Parcourir plusieurs communes et contrôler routes, panneaux, bâtiments et collisions.
2. Entrer/sortir de plusieurs bâtiments et logements.
3. Vérifier routines PNJ et trafic.
4. Prendre un bus/gbaka, attendre, monter, descendre et manquer un véhicule.
5. Commander un Yango et terminer une course.
6. Réaliser une livraison Glovo.

**Acceptation P2 :** déplacement sans blocage, arrêts cohérents, interactions terminées et état sauvegardé.

### P3 — Aéroport et voyages
1. Accéder au terminal.
2. Interagir avec un comptoir.
3. Rechercher et réserver un vol.
4. Contrôler le billet et effectuer l'embarquement.
5. Observer le décollage et l'atterrissage.
6. Arriver dans une autre ville et vérifier la possibilité de retour.

**Acceptation P3 :** un voyage complet fonctionne du paiement à l'arrivée, sans téléportation incohérente ni horaire contradictoire.

### P4 — Services avancés et multijoueur
1. Inscription scolaire, cours et progression.
2. Rendez-vous santé.
3. Relations et messages PNJ.
4. Publication média et progression simulée.
5. Création d'entreprise, documents et revenus.
6. Connexion simultanée de deux joueurs.
7. Redémarrage du serveur et restauration des sauvegardes.

**Acceptation P4 :** les systèmes communiquent entre eux et les données persistent.

## 17. Ordre de développement recommandé

1. Audit technique V1.24 et comparaison avec l'ancienne base V1.11.
2. Stabilisation chargement, sauvegardes, compte et suppression.
3. Consolidation d'un état joueur central (profil, argent, inventaire, besoins, logement, emploi, temps, documents).
4. Finalisation boutique, inventaire, travail, banque et factures.
5. Finalisation transports urbains et PNJ.
6. Finalisation logements et intérieurs.
7. Finalisation aéroport et parcours de voyage.
8. Éducation, santé, loisirs, médias et entreprises.
9. Infrastructure multijoueur persistante.
10. Optimisation PC/mobile et validation de déploiement.

## 18. Registre des points à ne pas oublier

- Ne pas perdre les améliorations du dépôt historique.
- Ne pas développer dans deux copies différentes sans stratégie de fusion.
- Ne pas confondre code présent, fonctionnalité testée et fonctionnalité déployée.
- Ne pas remplacer les données réelles d'Abidjan par des noms ou trajets inventés présentés comme officiels.
- Ne pas supprimer les systèmes existants lors d'une refonte visuelle.
- Ne pas considérer une app comme terminée tant qu'elle ne partage pas ses données avec le jeu.
- Conserver les contraintes de budget : priorité aux solutions gratuites.
- Livrer les versions validées avec un ZIP vérifié et un lien GitHub vers le commit exact ; ne jamais annoncer un ZIP ou un déploiement qui n'a pas été créé et contrôlé.

---
**Fin du cahier des charges consolidé.**  
Ce document est un référentiel de travail et de test. Les statuts devront être actualisés à chaque audit et chaque livraison.
