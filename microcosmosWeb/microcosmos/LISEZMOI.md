# Microcosmos — version web 1.4.0

Pilotez le détecteur Microcosmos (Arduino + 1 ou 2 tubes Geiger) **directement depuis le navigateur**, sans rien installer.

Adresse : **https://mucosmos.github.io/microcosmos/**

## Ce qu'il faut

- **Navigateur** : Chrome, Chromium, Edge, Opera ou Firefox 151 (ou plus récent), sur ordinateur (Windows, macOS, Linux, Chromebook). Safari, les iPad et les téléphones ne peuvent pas accéder au port USB. La simulation, elle, fonctionne dans tous les navigateurs.
- **Arduino Uno ou Nano** : branché en USB sur l'ordinateur qui affiche la page. Le programme s'envoie **depuis la page** : onglet « Arduino et fichiers », bouton « Téléverser dans l'Arduino ». L'IDE Arduino n'est pas nécessaire.
- **Linux** : ajoutez-vous une fois au groupe `dialout` (`sudo usermod -aG dialout $USER`), puis fermez et rouvrez la session.

## Onglets

| Onglet | Contenu |
|---|---|
| Rayons cosmiques | Comptage des deux tubes et des coïncidences, avec un graphique par intervalle et un histogramme comparé à la loi de Poisson. |
| Radioactivité | Séries de mesures de 10 s, avec le tableau des mesures et un histogramme. |
| **Demi-vie (radon)** | Mesure du bruit de fond, puis de la décroissance (filtre d'aspirateur posé sur le tube). La page trace N = f(t) en direct (classes de 30 s à 10 min, barres d'erreur √N) et ajuste N₀·e^(−λt) + fond pour donner T½ ± incertitude. Elle trace aussi ln(N − fond) = f(t) et donne la demi-vie apparente par tranche de temps. On peut comparer la courbe au plomb 214 seul et ouvrir un ancien fichier de mesures. |
| Arduino et fichiers | Téléversement du programme dans l'Arduino (ou d'un autre fichier .hex), fichiers de la séance à télécharger (tableur, encodage Windows), aide. |
| Journal | Tout ce que l'Arduino envoie. |

Les fichiers de mesure restent **dans le navigateur de l'ordinateur utilisé** : pensez à les télécharger. Pendant une mesure, gardez l'onglet ouvert et l'ordinateur hors veille.

## Fichiers

- `index.html` : l'interface.
- `moteur.js` : le moteur. Il gère la liaison série (Web Serial), le faux Arduino de la simulation, les mesures, l'ajustement de la demi-vie et les fichiers.
- `flasheur.js` : le téléversement. Il utilise le protocole STK500 des chargeurs optiboot et ATmegaBOOT, comme avrdude, et contient les deux programmes compilés pour l'ATmega328P.
- `arduino/` : les programmes, en source (.ino) et compilés (.hex).
- `LICENSE.txt` : licence GNU GPL v3.

## Firefox

Firefox (151 et plus récent) demande d'ajouter une « autorisation de site » à la première connexion : acceptez. Si la liste des ports reste vide alors que Chrome/Chromium voit l'Arduino, Firefox est probablement en « snap » ou soumis à des stratégies (`about:policies`), ce qui coupe l'accès série : dans `about:config`, mettez `dom.webserial.enabled` à `true` si possible, sinon utilisez Chrome ou Chromium.

## Crédits

Microcosmos — détecteur et programmes Arduino : Cédric Vanden Driessche ; interface web — conception et direction du projet : Cédric Vanden Driessche (2026), professeur de physique-chimie au lycée Charles de Gaulle à Caen (cedric.vanden-driessche@ac-normandie.fr) ; développement du code : Claude (Anthropic), sous sa direction.

Logiciel libre sous licence GNU GPL v3 ou ultérieure.
