# Microcosmos — version web 1.3.0

Pilotez le détecteur Microcosmos (Arduino + 1 ou 2 tubes Geiger) **directement depuis le navigateur**, sans rien installer.

Adresse : **https://mucosmos.github.io/microcosmos/**

## Ce qu'il faut

- **Navigateur** : Chrome, Edge, Opera ou Firefox 151 (ou plus récent), sur ordinateur (Windows, macOS, Linux, Chromebook). Safari, les iPad et les téléphones ne peuvent pas accéder au port USB. La simulation, elle, fonctionne dans tous les navigateurs.
- **Arduino** : branché en USB sur l'ordinateur qui affiche la page, avec le programme `DetectionCosmiques3_0.ino` (recommandé) ou l'ancien `MicroCosmosRadioactivite.ino`. Les deux se trouvent dans le dossier `arduino/` et se téléchargent depuis l'onglet « Fichiers et aide ».
- **Linux** : ajoutez-vous une fois au groupe `dialout` (`sudo usermod -aG dialout $USER`), puis fermez et rouvrez la session.

## Onglets

| Onglet | Contenu |
|---|---|
| Rayons cosmiques | Comptage des deux tubes et des coïncidences, avec un graphique par intervalle et un histogramme comparé à la loi de Poisson. |
| Radioactivité | Séries de mesures de 10 s, avec le tableau des mesures et un histogramme. |
| **Demi-vie (radon)** | Mesure du bruit de fond, puis de la décroissance (filtre d'aspirateur posé sur le tube). La page trace N = f(t) en direct (classes de 30 s à 10 min, barres d'erreur √N) et ajuste N₀·e^(−λt) + fond pour donner T½ ± incertitude. Elle trace aussi ln(N − fond) = f(t) et donne la demi-vie apparente par tranche de temps. On peut comparer la courbe au plomb 214 seul et ouvrir un ancien fichier de mesures. |
| Fichiers et aide | Fichiers de la séance à télécharger (tableur, encodage Windows), programmes Arduino, aide. |
| Journal | Tout ce que l'Arduino envoie. |

Les fichiers de mesure restent **dans le navigateur de l'ordinateur utilisé** : pensez à les télécharger. Pendant une mesure, gardez l'onglet ouvert et l'ordinateur hors veille.

## Fichiers

- `index.html` : l'interface.
- `moteur.js` : le moteur. Il gère la liaison série (Web Serial), le faux Arduino de la simulation, les mesures, l'ajustement de la demi-vie et les fichiers.
- `arduino/` : les programmes à téléverser avec l'IDE Arduino.
- `LICENSE.txt` : licence GNU GPL v3.

## Crédits

Microcosmos — détecteur et programmes Arduino : Cédric Vanden Driessche ; interface web — conception et direction du projet : Cédric Vanden Driessche (2026), professeur de physique-chimie au lycée Charles de Gaulle à Caen (cedric.vanden-driessche@ac-normandie.fr) ; développement du code : Claude (Anthropic), sous sa direction.

Logiciel libre sous licence GNU GPL v3 ou ultérieure.
