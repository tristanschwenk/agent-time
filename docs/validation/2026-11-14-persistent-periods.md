# Périodes persistantes et Home compacte

14 novembre 2026 — branche locale `codex/home-day-cache`. Implémentation et correctifs : `6064493`, `bd0e287`, `f14215e`, `487e4e5`, référence `8eddec0`. Travail non publié. [Mesures structurées](2026-11-14-persistent-periods.json).

## Ce qui change

Les réducteurs existants restent la référence. Leurs périodes calculées pour une journée terminée sont enregistrées dans `derived-periods.sqlite`, une base séparée et reconstruisible : bornes et état en colonnes, contextes partagés, preuves séparées. L’ordre des intervalles et même l’ordre des propriétés sont préservés, car les empreintes des jours revus en dépendent.

Les décisions, splits, ressources et crédits des compteurs sont toujours appliqués avec les règles existantes. La journée courante reste vivante. Aucune preuve originale n’est supprimée, aucune formule de temps ou de facturation n’est modifiée.

Une vue Home finale est également persistée : elle conserve les informations nécessaires aux graphiques et filtres, les compteurs de revue originaux et la présence de preuves, sans les paires d’identifiants des visites. Les périodes contiguës ne sont fusionnées que si toutes leurs métadonnées d’affichage et de filtre correspondent. Le transport partage les contextes au lieu de répéter leurs champs pour chaque période.

Home valide cette vue avec une clé couvrant les observations pertinentes, les changements durables, les terminaux, les réglages, le fuseau et les bornes du jour, les décisions/splits, les ressources et les compteurs réévalués à l’heure courante. Une lecture Home valide après redémarrage ne décompresse pas les périodes de preuve. Le statut de revue est inclus dans cette vue, avec ses dépendances de notes et de jours acceptés ; Home ne lance plus de seconde requête de revue en arrière-plan. Ouvrir un projet, les activités humaines ou l’export demande le résumé complet avant de présenter les actions. Review et Reports gardent leur chemin complet.

## Gains mesurés

Même archive figée : **1 512 772 observations, 631,5 Mio**, capture arrêtée, mêmes réglages et compteurs activés. Un processus neuf par phase ; dates 7, 12 puis 6 novembre. La référence sert le résumé complet et la requête de statut de revue que Home envoyait ensuite ; la nouvelle réponse inclut ces informations ensemble. La colonne de calcul cumule ce travail côté service ; les temps du résumé principal et de la revue sont aussi conservés séparément dans le JSON. Cache disque système non purgé, pas de GC forcé. Une séquence par phase : résultats descriptifs sur cette machine, pas une garantie statistique.

| Journée | Avant : calcul | Première construction | Après redémarrage | Réponse avant → après |
| --- | ---: | ---: | ---: | ---: |
| 7 novembre | 2 883 ms | 3 450 ms | 1 515 ms | 12,18 → 3,22 Mo |
| 12 novembre | 1 779 ms | 2 174 ms | 303 ms | 13,70 → 1,10 Mo |
| 6 novembre | 1 997 ms | 2 398 ms | 743 ms | 9,28 → 1,69 Mo |

Après redémarrage : **zéro reconstruction par les réducteurs**, réponses réduites d’environ **74 à 92 %**, calcul réduit de **47 à 83 %**. Les lectures SQL des ressources et déclarations restent présentes pour valider le contexte et les compteurs ; la première requête d’un processus ne devient donc pas instantanée.

Pic RSS cumulé du moteur Node : **678 → 353 Mio, soit −48 % après redémarrage**. Le premier remplissage monte à **798 Mio, environ +18 %** : il paie encore le calcul original, la normalisation, la compression et l’écriture. Cette limite reste réelle. Les chiffres sont relevés après l’encodage JSON du vrai transport ; les comparaisons complètes des graphes s’exécutent dans un autre processus, hors mesure. Ce n’est pas la mémoire totale de l’application et du WebView.

Les trois journées occupent environ **16,4 Mio** de cache dérivé, en plus des preuves originales. Le cache n’est pas une compaction de l’historique.

## Exactitude et vérification

La vérification dans le navigateur a également confirmé l’ouverture des sessions/agents au clic et le chargement des données d’export avant leur utilisation, avec les mêmes compteurs de revue. Les délais UI relevés sur les étapes intermédiaires ne sont pas utilisés comme benchmark de cette version finale.

Une vérification séparée compare intégralement les résumés typés avant/après, avec `assert.deepStrictEqual`, puis les valeurs Home décodées avec la projection d’affichage de la référence. Les huit variantes de filtres vérifient aussi les temps humains par session, les durées par projet et les segments de concurrence. Les trois résumés complets ont les mêmes empreintes SHA-256 ; aucun champ de métadonnées n’est ignoré par la canonicalisation. Les tests comptent aussi les lectures de périodes de preuve : **zéro pour les trois réponses Home persistées**, puis accès complet sur demande.

- **732 tests Node réussis** : reprise après redémarrage, empreintes de revue, corruption, budgets, écritures externes, preuves tardives, ressources/réglages, compteurs, filtres, concurrence, navigation et chargement des détails.
- **36 tests natifs réussis**, plus un contrôle ciblé de la nouvelle méthode du protocole.
- Typage/build réussis ; avertissement existant du bundle au-dessus de 500 Ko.
- Moteur empaqueté vérifié : réponse Home persistante et validation conditionnelle après redémarrage.

Un cas de changement de session sur un même terminal a aussi été reproduit puis corrigé : les périodes humaines ne sont pas fusionnées à travers les limites des fenêtres de session. Une vérification du chargement de revue a supprimé la requête de fond qui aurait relu les preuves malgré la réponse Home compacte.

La revue indépendante a identifié une course Home → Review et un risque de suspension de capture causée par le cache ; les deux sont corrigés et couverts par des tests initialement rouges, puis verts. Le chargement backend des preuves sur les lectures Home valides a aussi été supprimé. Le relecteur n’a pas reproduit le benchmark volumineux ni vérifié une installation sur un autre Mac ; ces mesures sont celles de l’exécutant.

## Taille, invalidation et compatibilité

Budget partagé de **64 Mio estimés/compressés**, au plus 32 journées de périodes et 32 vues compactes ; plafond SQLite principal de **128 Mio**, hors journal transitoire. Le cache compte dans l’affichage du stockage et la politique de capacité. Chaque écriture réserve les nouvelles pages et un éventuel journal, maintient la réserve de 1 Gio libre et reste sous 90 % du budget configuré. Avant de suspendre la capture ou de compresser les preuves pour manque de place, les données dérivées sont évacuées. L’éviction conserve l’inode d’une base valide pour les lecteurs concurrents.

Les ajouts pertinents invalident la fenêtre concernée ; mises à jour, suppressions et remplacements sont suivis par une petite révision durable dans la base source. Son identité et celle du fichier évitent de reprendre le cache d’un autre historique. Les contextes/compteurs et corrections utilisateur sont des dépendances distinctes. Les fins, baux et états actifs ne sont pas figés.

L’API `summary` complète reste disponible. Le nouveau transport `home_summary` est explicite. Les réponses tardives d’un autre mode ou d’une ancienne date ne remplacent pas la page courante. Cache manquant, ancien, plein, corrompu ou impossible à écrire : retour au calcul existant. Les caches dérivés ne sont pas nécessaires pour restaurer les preuves et peuvent être reconstruits.

Les migrations futures des réducteurs ou de leurs résultats devront faire évoluer la version de la projection ; une base dérivée n’est jamais l’autorité de mesure. Aucun déploiement ou publication n’a été effectué.
