## Avec l'Arduino
Les élèves travaillent sur des séries de trente mesures de dix secondes qu'ils relèvent directement à partir du moniteur série de l'Arduino. Il est possible de récupérer ces données directement sur un écran LCD pour simplifier les choses en modifiant le code proposé.
> [MicroKosmosRadioactivite.ino](/mikrocosmos/MicroKosmosRadioactivite.ino)

Une évaluation expérimentale est ensuite proposée aux élèves, ils y testent une source différente. L'évaluation est en deux parties (30 min expérimentale + 30 min théorique) ce qui permet de faire tourner les élèves sur un nombre restreint de postes. En réalité 20 min suffisent pour les mesures (donc jusqu'à 24 élèves par heure si 8 postes). Lorsque je n'ai pas de groupes, la partie expérimentale se prolonge sur la séance suivante en parallèle d'une activité documentaire non évaluée.

> [Activité Classe](/mikrocosmos/Activité_Classe.pdf)
> 
> [EvalPartiePratique](/mikrocosmos/EvalPartiePratique.pdf)
> 
> [EvalPartieThéorique](/mikrocosmos/EvalPartieThéorique.pdf)

  

## En rajoutant Python :-)
Pour des acquisitions longues un programme Python est nécéssaire (sauf à passer des heures à relever les mesures à l'ancienne ;-) ). Ce programme récupère les données du port série de l'Arduino (attention à avoir bien fermé le moniteur série de l'Arduino)
> [MicroKosmosPyRadioactivite.py](/mikrocosmos/MicroKosmosPyRadioactivite.py)


Les données récupérées peuvent être traitées à l'aide d'un tableur ou traitées en Python. Voici un programme de traitement des données :
> [MicroKosmosActivite_traitement_donnees.py](/mikrocosmos/MicroKosmosActivite_traitement_donnees.py)



[Retour à l'accueil](/index.md)

