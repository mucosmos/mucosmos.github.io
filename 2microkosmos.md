Le programme Arduino, utilisé tel quel en classe, avec la feuille de mesure associée ([feuille de mesure](/feuille_mesure.pdf) ). Les élèves travaillent sur des séries de trente mesures de dix secondes qu'ils relèvent directement à partir du moniteur série. Il est possible de récupérer ces données directement sur un écran LCD pour simplifier les choses en modifiant le code proposé.
> [MicroKosmosRadioactivite.ino](/MicroKosmosRadioactivite.ino)


Pour des acquisitions longues un programme Python est nécéssaire (sauf à passer des heures à relever les mesures à l'ancienne ;-) ). Ce programme récupère les données du port série de l'Arduino (attention à avoir bien fermé le moniteur série de l'Arduino)
> [MicroKosmosPyRadioactivite.py](/MicroKosmosPyRadioactivite.py)


Les données récupérées peuvent être traitées à l'aide d'un tableur ou traitées en Python. Voici un programme de traitement des données :
> [MicroKosmosActivite_traitement_donnees.py](/MicroKosmosActivite_traitement_donnees.py)

[Retour à l'accueil](/index.md)
