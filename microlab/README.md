# MicroLab

Logiciel de traitement de données expérimentales qui fonctionne dans le navigateur, dans l’esprit de Regressi : tableau de mesures, grandeurs calculées, graphe, modélisation par une fonction avec incertitudes sur les paramètres, statistiques sur des mesures répétées.

Aucun serveur n’est nécessaire : ce sont des fichiers HTML, CSS et JavaScript statiques, prêts pour GitHub Pages.

## Fonctions

- **Import** : CSV, TXT, DAT, TSV, classeurs ODS, XLSX et XLS, collage depuis un tableur (Ctrl+V) ou glisser-déposer. Rien n’est importé sans validation : l’aperçu montre chaque ligne découpée avec son rôle (noms, unités, données, ignorée) et les cellules non numériques en rouge. Le séparateur de colonnes (point-virgule, virgule, tabulation, espace, barre verticale ou caractère libre), le séparateur décimal, la ligne des noms, la ligne des unités, la première et la dernière ligne de données sont proposés automatiquement mais peuvent tous être choisis à la main. Chaque colonne peut être cochée ou décochée. Les données s’arrêtent automatiquement à la première ligne vide ou à une ligne de total, pour ne pas compter un total comme une mesure.
- **Tableau** éditable (double-clic), ajout et suppression de lignes et de variables.
- **Grandeurs calculées** : `v (m/s) = deriv(x, t)`, `Ec (J) = 0.5*m*v^2`, constantes (`m (kg) = 0.250`), `integ`, `mean`, `std`…
- **Angles en degrés ou en radians** : un réglage s’applique à `sin`, `cos`, `tan` et à leurs inverses dans les calculs, les incertitudes et les modèles (les modèles sinusoïdaux s’écrivent alors avec 360 au lieu de 2π). On peut aussi écrire `sin(30 deg)`.
- **Notation scientifique** : les très grands et très petits nombres s’affichent en puissances de 10 (2,568 × 10⁻⁸) dans le tableau, les résultats et les champs ; on peut les saisir sous la forme `2,5×10^-7`, `2,5·10^-7` ou `2,5e-7`. Les unités écrites avec `^` prennent le bon format : `m^3` → m³, `m/s^2` → m/s², `mol.L^-1` → mol.L⁻¹.
- **Incertitudes** par variable : un nombre ou une formule (`0.02*U + 0.01`), affichées en barres d’erreur.
- **Graphe** sur fond millimétré : plusieurs ordonnées, échelles logarithmiques, zoom, export PNG.
- **Modélisation** : modèles prédéfinis (linéaire, affine, parabole, exponentielles, 1er ordre, puissance, logarithme, sinusoïde, sinusoïde amortie, gaussienne…) ou expression libre. Algorithme de Levenberg-Marquardt, valeurs initiales estimées automatiquement, paramètres fixables, domaine choisi à la souris.
- **Estimateurs** : valeurs ± incertitude-type, incertitude relative, intervalle de confiance à 95 % (Student), R², χ² réduit et probabilité du χ² si l’ajustement est pondéré, écart-type des résidus sinon, graphe des résidus (normalisés par l’incertitude quand elle existe).
- **Statistiques** : moyenne, écart-type, incertitude-type s/√n, intervalle à 95 %, écart normalisé à une valeur de référence. Histogramme avec largeur et début des classes réglables, et superposition d’une loi normale (Gauss) ou d’une loi de Poisson : paramètres estimés avec leur incertitude, effectifs attendus par classe et test d’adéquation du χ².
- **Classes** : début, largeur et fin des classes réglables ; « Créer le tableau des classes » ouvre une nouvelle page (centre de classe, effectif N, incertitude √N) prête à modéliser, par exemple par une exponentielle décroissante pour mesurer la durée de vie du muon.
- **Pages** : un projet peut contenir plusieurs pages de données (données brutes, tableau des classes…), choisies dans la barre du haut.
- **Tri** des lignes du tableau selon n’importe quelle colonne.
- **Titrages** (onglet Titrage) : titrage pH-métrique par la méthode des tangentes parallèles et par la méthode de la dérivée (maximum de dpH/dV, lissage réglable), pH à la demi-équivalence ; titrage conductimétrique par l’intersection de deux droites, intervalles choisis automatiquement ou à la souris, avec l’incertitude sur V_E.
- **Sauvegarde** automatique dans le navigateur, export CSV, projet `.json` à rouvrir.

## Mise en ligne sur GitHub Pages

Le site `mucosmos.github.io` est servi depuis le dépôt `mucosmos/mucosmos.github.io`. Le plus simple est d’y ajouter un dossier :

1. Dans le dépôt `mucosmos.github.io`, créez un dossier `microlab/`.
2. Copiez-y le contenu de ce dossier : `index.html`, `style.css` et le dossier `js/`.
3. Validez et poussez :
   ```bash
   git add microlab
   git commit -m "Ajout de MicroLab"
   git push
   ```
4. Après une à deux minutes, le logiciel est accessible à l’adresse **https://mucosmos.github.io/microlab/**.

Sur le site web de GitHub, sans ligne de commande : ouvrez le dépôt, *Add file → Upload files*, glissez les fichiers en conservant le dossier `js/`, puis *Commit changes*.

Autre possibilité : un dépôt séparé nommé `microlab`, avec *Settings → Pages → Deploy from a branch → main / (root)*. L’adresse est alors la même : `https://mucosmos.github.io/microlab/`.

## Structure

```
index.html        page et interface
style.css         mise en forme (thèmes clair et sombre)
js/engine.js      lecture des fichiers, ajustement, statistiques (sans dépendance)
js/examples.js    jeux de données d’exemple
js/app.js         interface : tableau, graphe, modélisation
```

Bibliothèques chargées depuis jsDelivr : [math.js](https://mathjs.org) (expressions), [Plotly](https://plotly.com/javascript/) (graphes), [SheetJS](https://sheetjs.com) (ODS / XLSX). Pour un usage hors ligne, téléchargez ces trois fichiers dans un dossier `lib/` et remplacez les adresses dans `index.html`.

## Détails de calcul

- Ajustement non pondéré : u(pᵢ) = √(s²·Cᵢᵢ) avec s² = Σ résidus² / (n − p) et C = (JᵀJ)⁻¹.
- Ajustement pondéré par u(y) : C = (JᵀWJ)⁻¹ avec W = 1/u². Si x a aussi une incertitude, la méthode de la variance effective est utilisée : u² = u(y)² + (f′(x)·u(x))².
- Intervalle à 95 % : ± t·u, t étant le coefficient de Student à n − p degrés de liberté.
- Dérivée numérique : différences centrées (différences simples aux extrémités). Intégrale : méthode des trapèzes.
