# Quatre optimisations des lectures Agent Time

15 novembre 2026 — changements locaux sur `codex/home-day-cache`, non publiés. Référence `b366afd`. [Mesures structurées](2026-11-15-reading-model-lots.json).

## Livraison

1. **Review et Reports** réutilisent des résumés finaux de journées terminées, conservés dans la base dérivée bornée. La facturation conserve aussi son entrée journalière compacte : intervalles éligibles, exclusions, présence et usage, produits par le calcul existant. Les preuves détaillées restent dans la source ; leur chargement n'est plus nécessaire pour recalculer un rapport inchangé.
2. **Validation ciblée** : de petites révisions transactionnelles suivent observations par fenêtre, ressources, déclarations, fins de session et décisions. Les nouvelles observations humaines ne déclenchent plus une relecture de tous les compteurs et ressources. Les corrections/suppressions, remplacements, écritures externes et changements de blocs invalident de façon conservatrice. Les ressources continuent de résoudre les chemins sur la cadence existante de dix secondes, en réutilisant leurs payloads si le SQL n'a pas changé. Les anciennes bases lues seules sans révisions gardent le calcul complet.
3. **Journée courante** : les ajouts agents ordonnés réutilisent les intervalles humains déjà traités. Le réducteur original traite toujours les agents et leur regroupement. Limites : 4 096 événements non humains, 128 époques et 4 Mio de preuves supplémentaires, également limités par le budget du jour. Événements tardifs, égalités d'horloge, retours en arrière, nouvelles limites de capture, nouveaux workers et dépassements de budget renvoient au calcul complet. Les limites et workers déjà présents restent dans le préfixe rejoué ; le dernier ancrage humain respecte exactement les changements de capture. Aucun découpage indépendant des agents n'a été introduit : promotions de sessions, liens aux terminaux et tâches en arrière-plan peuvent traverser ces frontières.
4. **Stockage des preuves** : les enregistrements partagés existants du codec version 1 servent aussi aux contextes canoniques des hooks et déclarations. L'encodeur conserve l'ancien bloc si le candidat compressé est plus gros. Les identifiants, payloads exacts, ordre des champs et des événements sont restitués ; aucune frontière début/fin n'est supprimée. Les blocs déjà froids ne sont pas réécrits par cette livraison.

## Temps et mémoire

Copie privée figée de **1,593,311 événements**. Même base, réglages et projet ; horloge fixée au 15 novembre à 12 h UTC pour les compteurs. Un processus neuf par phase, sans GC forcé et sans purge du cache disque système. Les résultats concernent le service Node ; ils n'incluent pas le WebView ni le rendu des tableaux.

| Facturation, 30 jours | Temps | Pic RSS Node |
| --- | ---: | ---: |
| Référence | 49.17 s | 652 Mio |
| Première construction, cache dérivé vide | 52.95 s | 920 Mio |
| Réutilisation après redémarrage | 0.24 s | 218 Mio |

Après construction : **203 fois plus rapide**, pic RSS réduit de **67 %** dans cette mesure. Le premier calcul reste coûteux : il exécute le réducteur, les règles originales et construit les vues. La mise en cache peut augmenter sa consommation transitoire ; ce gain ne doit pas être annoncé comme une accélération équivalente du premier calcul.

| Review, réponse complète | Référence avec périodes brutes déjà disponibles | Vue finale après redémarrage |
| --- | ---: | ---: |
| 2026-11-07 | 1793 ms | 142 ms |
| 2026-11-12 | 616 ms | 52 ms |
| 2026-11-06 | 1105 ms | 44 ms |

Pic des trois lectures Review : 448 → 394 Mio. La réponse complète contient toujours les preuves : son volume métier n'a pas été réduit. Le bénéfice vient du travail évité avant de la produire.

Test synthétique des ajouts agents : 12 000 échantillons humains et 200 événements agents, 15 passages, médiane **12.16 → 3.69 ms**. L'état supplémentaire conserve 201 événements source (les agents et le dernier échantillon humain), en partageant les intervalles déjà calculés. Ce test isole le réducteur, pas le temps total de l'application. Reproduction : `node scripts/benchmark-live-summary.ts`.

Les mesures sur données réelles sont des passages descriptifs sur ce Mac partagé ; certains premiers passages ont coexisté avec les tests. La référence facturation et la première mesure finale de réutilisation ont été refaites hors de ces tests avant la dernière extension des dépendances de fichiers. Les compteurs finaux ci-dessus sont issus de la version qui valide ces dépendances. Elles ne constituent pas une garantie statistique pour toutes les bases.

## Stockage et coût de compression

Sur 20 000 événements agents représentatifs : **1,536,348 → 1,504,953 octets**, soit 2.04 % de moins. Sur 20 000 échantillons humains : **999,658 → 994,715 octets**, soit 0.49 % de moins. Ces pourcentages concernent les blocs testés, pas la base entière.

Le coût CPU d'encodage augmente : 188 → 300 ms pour l'échantillon agent, 184 → 231 ms pour l'échantillon humain. Le travail reste borné dans la maintenance existante. L'ancien décodeur a restitué exactement les 40 000 payloads encodés par le nouveau code.

Les vues ajoutent un cache, elles ne réduisent pas à elles seules la taille du journal source. Budget partagé de 64 Mio estimés/compressés et plafond de 128 Mio pour le fichier SQLite principal, hors journal transitoire. Les graphes bruts sont évacués avant les vues finales indépendantes ; chaque namespace garde au plus 32 entrées, avec un maximum global de 96 vues génériques. La réserve de 1 Gio et le budget de capture gardent priorité ; la pression de stockage supprime le cache dérivé avant d'interrompre la capture.

## Conservation et exactitude

- Comparaison profonde de trois journées réelles pour les résumés Review et les snapshots de facturation : périodes, sessions, métadonnées, Maps et identifiants de preuves inclus.
- Réponse complète du rapport de 30 jours identique à la référence ; les arrondis, pauses, sommeil, exclusions, tarifs et formules ne changent pas.
- Les baux et fins des compteurs restent évalués à l'horloge courante. Les clés comprennent les bornes locales et l'identité de la source ; changement de fuseau ou retour d'horloge invalident correctement.
- Les vues de facturation suivent les chemins effectivement résolus, y compris les worktrees et leurs suppressions. Les dépendances imbriquées sont conservées ; une liste supérieure à 8 192 chemins ou une résolution contradictoire pendant un calcul désactive son stockage. Un ancien format de vue provoque un recalcul.
- Les révisions internes sont exclues uniquement des comparaisons d'archives et de compaction où elles peuvent légitimement différer. Les preuves et tables utilisateur restent vérifiées.
- Revue indépendante : 30 000 comparaisons complètes sur des flux agents synthétiques et 9 000 comparaisons d'une simulation de l'admission après démarrage ; corrections des cas fuseau et worktree vérifiées par tests initialement rouges.
- **756 tests Node réussis**, typage et build réussis. Avertissement préexistant : bundle principal supérieur à 500 Ko. Aucun protocole natif n'a changé.

Les fichiers de l'utilisateur ont uniquement servi de source de lecture pour une copie cohérente. Les modifications et benchmarks ont porté sur les copies privées et les fixtures temporaires. Les deux copies de bases et leurs caches ont été supprimés après validation ; seuls les scripts et mesures agrégées sont conservés. Aucune publication ni remplacement de sa base n'a été effectué.
