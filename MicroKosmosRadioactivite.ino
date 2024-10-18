// Programme de comptage du nombre d'impulsion comptées par le compteur geiger au cours d'une durée définie. Prévu pour Arduino Uno.
//// Auteur : Cédric Vanden Driessche, Lycée Charles de Gaulle, CAEN. mél : cedric.vanden-driessche@ac-normandie.fr

// Définition des variables
long Tinit;
long duree_souhaitee;                 
long duree;
long CPS;
long Impulsion;
long Impulsion_moins;
int pinEntree ;

// Routine executée lors de l'interruption. A chaque impulsion détectée dans le tube geiger la variable Impulsion est incrémentée de 1 unité. Une fois lancée cette routine tourne en continue
void GeigerISR(){           
  Impulsion++;
}


// Initialisation des variables
void setup() {
  Serial.begin(9600); 
  duree_souhaitee=10000;                     // réglage de la durée souhaitée de l'expérience. Ici 10 000 ms soit 10s. A modifier selon la durée souhaitée.
  Tinit=millis();
  duree=0;
  Impulsion=0;
  Impulsion_moins=0;
  CPS=0;
  pinEntree=2;
  pinMode(pinEntree, INPUT);
  attachInterrupt(digitalPinToInterrupt(pinEntree),GeigerISR, FALLING);   // Déclenchement de l'interruption, compteur geiger branché sur le Port 2 , front descendant. Sur Arduino Uno seuls les ports 2 et 3 sont disponibles pour les interruptions.
}


// Programme principal On attend la durée souhaitée puis on regarde de combien a augmenté la valeur de la variable Impulsion
void loop() {
  delay(duree_souhaitee);                   // réglage de la durée souhaitée de l'expérience
  duree=(millis()-Tinit)/1000;              // durée totale de l'expérience
  CPS=Impulsion-Impulsion_moins;            // impulsions comptées sur la durée de chaque expérience
  Impulsion_moins=Impulsion;                // stocke le nombre total d'impulsions à l'étape N-1
  Serial.print("nombre impulsion : ");      // Affichage des résultats sur le port série
  Serial.print(CPS);                        // Affichage des résultats sur le port série
  Serial.print("  duree experience : ");    // Affichage des résultats sur le port série
  Serial.print(duree);                      // Affichage des résultats sur le port série
  Serial.println(" s");                     // Affichage des résultats sur le port série
 

}
