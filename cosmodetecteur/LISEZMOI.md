# Cosmodétecteur — version web 1.2.0

Pilotez le Cosmodétecteur (roue cosmique CPPM, quatre photomultiplicateurs) **directement depuis le navigateur**, sans rien installer.

Adresse : **https://mucosmos.github.io/cosmodetecteur/**

## Ce qu'il faut

- **Navigateur** : Chrome, Edge, Chromium ou Opera, sur ordinateur. Firefox 151 (ou plus récent) fonctionne aussi, sauf en version « snap » ou avec des stratégies d'administration. Safari et les téléphones ne peuvent pas accéder au port USB. La simulation fonctionne dans tous les navigateurs.
- **Boîtier** : allumé et branché en USB sur l'ordinateur qui affiche la page.
- **Linux** : il faut appartenir au groupe `dialout`. Tapez une fois `sudo usermod -aG dialout $USER`, puis fermez et rouvrez la session.

## Fonctionnement

L'interface et le fonctionnement sont les mêmes que ceux du logiciel Python 1.1.0 :

- comptages des quatre voies avec leurs seuils ;
- hautes tensions de 0 à 1500 V, avec jauges ;
- les neuf coïncidences ;
- manips de comptage par intervalle, avec graphique et histogramme comparé à la loi de Poisson ;
- vie du muon, avec histogramme et ajustement exponentiel plus fond plat ;
- fichiers au format de l'ancien logiciel LabVIEW.

Les fichiers de mesure restent **dans le navigateur de l'ordinateur utilisé**. Téléchargez-les depuis l'onglet « Fichiers et aide ».

**Hautes tensions** : elles sont mises à 0 V à la connexion et à la déconnexion. Cliquez toujours sur **Déconnecter** avant de fermer l'onglet. Si l'onglet est fermé directement, la page essaie de couper les HT sans garantie : éteignez alors le boîtier.

## Fichiers

- `index.html` : l'interface.
- `moteur.js` : le protocole du boîtier (Web Serial), le boîtier simulé, la boucle de lecture, les manips et les fichiers. C'est une traduction de `boitier.py` et `station.py`.
- `LICENSE.txt` : licence GNU GPL v3.

## Crédits

Adaptation du logiciel Roue Cosmique [Sciences à l'École, CPPM] [Michel Jevaud, Marta Rodo Bordera, 2011] pour le Cosmodétecteur [José Busto] ; version web — conception et direction du projet : Cédric Vanden Driessche (2026), professeur de physique-chimie au lycée Charles de Gaulle à Caen (cedric.vanden-driessche@ac-normandie.fr) ; développement du code : Claude (Anthropic), sous sa direction.

Logiciel libre sous licence GNU GPL v3 ou ultérieure.
