# Home : cache léger et partage des preuves des compteurs

14 novembre 2026. Branche locale `codex/home-day-cache`, implémentation `f786f2a`, référence `15acb75`. Non publié. Voir le [comparatif Agent Time / Timing](2026-11-14-timing-comparison.html) et les [mesures structurées](2026-11-14-home-day-cache.json).

## Résultat observé

Même copie figée : 1 512 772 observations, 631,5 Mio, capture arrêtée, compteurs activés. Chaque moteur démarre dans un processus neuf avec sa propre copie ; ordre 7, 12, 6, 12, 7, 7 novembre. Cache disque système non purgé. Une séquence par version : ces chiffres décrivent ce test, pas une garantie universelle.

| Lecture | Calcul avant | Calcul après | Réponse avant → après |
| --- | ---: | ---: | --- |
| 7 novembre, première | 2 599 ms | 3 188 ms | 12,2 Mo → identique |
| 12 novembre, première | 1 806 ms | 1 850 ms | 13,7 Mo → identique |
| 6 novembre, première | 1 812 ms | 1 901 ms | 9,3 Mo → identique |
| Retour au 12 | 1 010 ms | 26 ms | 13,7 Mo → 39 octets |
| Retour au 7 | 2 089 ms | 42 ms | 12,2 Mo → 39 octets |
| Même jour immédiatement | 701 ms | 22 ms | 39 → 39 octets |

Ce test utilise les tokens conditionnels, comme l’interface. Un second test forçant les réponses complètes donne 62–71 ms sur les lectures chaudes après modification ; il conserve le coût d’expansion et de sérialisation du résumé. La première lecture doit encore reconstruire la journée et payer sa compression. Elle n’est donc pas accélérée de façon démontrée, et le premier échantillon est plus lent.

**Exactitude : les six empreintes SHA-256 des résumés complets sont identiques avant/après**, en excluant uniquement le token de transport. Une réponse inchangée valide l’empreinte précédemment reçue. Durées, intervalles, sessions, crédits et ordre du résultat sont conservés.

## Affichage dans Home

Mesure de la sélection de date à deux images après le chargement du résumé, première marque de chaque navigation ; aperçu local Vite, Chrome intégré 659 × 965. Même fixture que la mesure précédente. Ce n’est pas une mesure du WebView natif empaqueté. Les lectures périodiques ultérieures sont ignorées.

| Navigation | Avant | Après |
| --- | ---: | ---: |
| Première ouverture du 7 | 3 561 ms | 3 686 ms |
| Première ouverture du 12 | 3 340 ms | 2 775 ms |
| Première ouverture du 6 | 3 084 ms | 2 469 ms |
| Retour au 12 | 1 843 ms | 921 ms |
| Retour au 7 | 3 776 ms | 709 ms |

Sur les retours, la réponse principale enveloppée par HTTP fait 94 octets, contre 9–13 Mo avant. Le navigateur doit cependant décompresser son entrée, recréer le résumé et actualiser les graphiques. Les requêtes de notes et de déclarations continuent aussi ; le cache ne garantit pas un affichage instantané.

## Mémoire et limites

Sur la séquence conditionnelle, le pic RSS cumulé du moteur passe de **916 à 671 Mio (−27 %)**. Il n’existe pas encore de plafond global de mémoire. Le test forçant les réponses complètes donne des pics de 746 et 715 Mio, soit un gain plus faible : le protocole conditionnel et l’absence de reconstruction des gros graphes font partie du bénéfice.

Le moteur retient 4,86 Mio de snapshots compressés et environ 2,06 Mio estimés de preuves des compteurs pour ces trois jours. Budgets : 8 Mio / 6 jours pour les snapshots, 8 Mio estimés / 6 jours pour les preuves ; navigateur 8 Mio compressés / 3 jours, un seul encodage transitoire à la fois. Les budgets ne comptent pas les objets actifs ni tout le processus. Les échantillons du tas JavaScript navigateur varient autour de 82–141 Mio après, contre 84–94 Mio dans le relevé antérieur ; ce ne sont ni des pics comparables ni la RAM totale du renderer. **Aucune réduction de RAM navigateur démontrée.**

## Fonctionnement et préservation des résultats

- Journées terminées : garder un snapshot compressé en mémoire, libérer ses graphes bruts et valider les dépendances avant réutilisation. Aujourd’hui et les dates futures restent sur le calcul vivant existant.
- Invalidation : observations pertinentes, corrections, écritures externes, preuves tardives, titre terminal même hors fenêtre, options, ressources et compteurs. Une dépendance modifiée impose une lecture fraîche.
- Compteurs : partager les lignes de preuve SQL, mais recalculer à chaque lecture les durées actives, échéances et états avec l’heure actuelle. Les nouvelles fins de session et le recul de l’horloge sont pris en compte.
- Interface : cache en mémoire, sans localStorage ; validation du token auprès du moteur avant présentation. Les réponses d’une ancienne date ne remplacent pas la nouvelle. Compression indisponible : chargement normal.

Aucun changement de schéma, collecte, formule de temps, attribution, arrondi, facturation, archive ou règle de conservation.

## Vérification

714 tests Node réussis, dont 13 nouveaux tests du cache et de l’interface. Vérifications ciblées : corrections externes, preuves tardives, compteurs actifs, expiration, fins futures, recul d’horloge, ressources, réglages, tailles limites, fallback et navigation concurrente. Build et typage réussis ; avertissement existant du bundle au-dessus de 500 Ko. Les deux implémentations du benchmark produisent les mêmes six résultats complets. Sidecars empaquetés construits ; smoke test du Collector avec Node embarqué 26.9 réussi sur un hit conditionnel de journée terminée.

## Suite proposée

Le premier affichage reste tributaire de la reconstruction. L’étape structurante est de conserver des périodes calculées et une réponse Home compacte, puis charger visites/outils/provenance à la demande. C’est un chantier distinct du cache, à valider avec les réducteurs actuels comme référence d’exactitude. La compaction du disque seule ne résout pas ce coût.
