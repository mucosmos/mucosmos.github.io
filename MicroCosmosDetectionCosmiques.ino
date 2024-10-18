// Programme de comptage de coïncidences entre 2 tubes Geiger. Prévu pour Arduino Uno.
// Auteur : Cédric Vanden Driessche, Lycée Charles de Gaulle, CAEN. mél : cedric.vanden-driessche@ac-normandie.fr

long Tinit;                 // Définition des variables
long duree;

long Impulsion1;            // comptage geiger 1
int pinEntree1 ;

long Impulsion2;            // comptage geiger 2
int pinEntree2;

long N12;                   // comptage Coincidences
volatile int Etat1;
volatile int Etat2;

void GeigerISR1(){           // Routine executée lors de l'interruption tube 1
  Impulsion1++;
  Etat1=1;  
}

void GeigerISR2(){           // Routine executée lors de l'interruption tube 2
  Impulsion2++;
  Etat2=1;
}

void setup() {
  noInterrupts();   
  Serial.begin(9600); 
  
  Tinit=millis();             // Initialisation des variables
  duree=0;

  Impulsion1=0;
  pinEntree1=2;

  Impulsion2=0;
  pinEntree2=3;

  N12=0;
  Etat1=0;
  Etat2=0;
  
  pinMode(pinEntree1, INPUT);
  pinMode(pinEntree2, INPUT);
  attachInterrupt(digitalPinToInterrupt(pinEntree1),GeigerISR1, FALLING);   // Déclenchement de l'interruption, Port 2 , front descendant
  attachInterrupt(digitalPinToInterrupt(pinEntree2),GeigerISR2, FALLING);   // Déclenchement de l'interruption, Port 3 , front descendant
  interrupts();   
}

void loop() {  
  for (int t=0; t<1000; t++){                    // Comptage pendant 1 s avant d'afficher le résultat
                                                 //                             sur le moniteur série
    delay(1);                                    // réglage de la durée de la fenêtre de coincidence en ms
  
    duree=(millis()-Tinit)/1000;                 // durée totale de l'expérience
 
  
   if ((Etat1==1) && (Etat2==1)){
        N12++;                                  //  Si les 2 GM sont dans l'état 1 on compte une coïncidence
      }
  Etat1=0;
  Etat2=0;
  }

  Serial.print("nombre impulsion 1 : ");      // Affichage des résultats sur le port série
  Serial.print(Impulsion1);                        // Affichage des résultats sur le port série
  Serial.print(" nombre impulsion 2 : ");      // Affichage des résultats sur le port série
  Serial.print(Impulsion2); 
  Serial.print(" nombre de coincidences : ");      // Affichage des résultats sur le port série
  Serial.print(N12); 
  Serial.print("  duree experience : ");    // Affichage des résultats sur le port série
  Serial.print(duree);                      // Affichage des résultats sur le port série
  Serial.println(" s");                     // Affichage des résultats sur le port série

  
  
}
