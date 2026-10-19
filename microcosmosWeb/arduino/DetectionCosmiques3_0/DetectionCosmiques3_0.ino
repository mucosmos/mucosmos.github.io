// Programme de comptage de coïncidences entre 2 tubes Geiger. Prévu pour Arduino Uno.
// Auteur : Cédric Vanden Driessche, Lycée Charles de Gaulle, CAEN. mél : cedric.vanden-driessche@ac-normandie.fr
//
// Version 3.0 (2026) : même principe de comptage que la version 2.0, mais l'Arduino envoie
// chaque seconde une ligne facile à lire par l'interface web « Microcosmos » :
//
//     D;seconde;impulsions GM1;impulsions GM2;coincidences
//
// (nombres comptés pendant la seconde écoulée). Le moniteur série de l'IDE Arduino
// affiche aussi ces lignes : il suffit de régler la vitesse sur 9600 bauds.
//
// Coïncidence : comme dans la version 2.0, le temps est découpé en fenêtres de 1 ms ;
// on compte une coïncidence quand les deux tubes ont reçu une impulsion dans la même fenêtre.

const byte PIN_GM1 = 2;                  // tube Geiger 1 sur l'entrée 2 (interruption 0)
const byte PIN_GM2 = 3;                  // tube Geiger 2 sur l'entrée 3 (interruption 1)
const unsigned long FENETRE_US = 1000;   // largeur de la fenêtre de coïncidence (µs)
const unsigned long PERIODE_MS = 1000;   // envoi des résultats toutes les secondes

volatile unsigned long impulsions1 = 0;  // modifiées dans les interruptions : « volatile »
volatile unsigned long impulsions2 = 0;
volatile byte etat1 = 0;
volatile byte etat2 = 0;

unsigned long coincidences = 0;          // coïncidences pendant la seconde en cours
unsigned long seconde = 0;               // numéro de la seconde depuis le démarrage
unsigned long debutPeriode;              // en ms
unsigned long debutFenetre;              // en µs

void GeigerISR1() {                      // impulsion sur le tube 1
  impulsions1++;
  etat1 = 1;
}

void GeigerISR2() {                      // impulsion sur le tube 2
  impulsions2++;
  etat2 = 1;
}

void setup() {
  Serial.begin(9600);
  pinMode(PIN_GM1, INPUT);
  pinMode(PIN_GM2, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_GM1), GeigerISR1, FALLING);   // front descendant
  attachInterrupt(digitalPinToInterrupt(PIN_GM2), GeigerISR2, FALLING);
  Serial.println(F("# MICROCOSMOS 3.0 - D;seconde;impulsions GM1;impulsions GM2;coincidences"));
  debutPeriode = millis();
  debutFenetre = micros();
}

void loop() {
  // Fin d'une fenêtre de coïncidence de 1 ms
  if (micros() - debutFenetre >= FENETRE_US) {
    debutFenetre += FENETRE_US;
    noInterrupts();                      // lecture et remise à zéro sans être interrompu
    byte e1 = etat1;
    byte e2 = etat2;
    etat1 = 0;
    etat2 = 0;
    interrupts();
    if (e1 && e2) {
      coincidences++;                    // les 2 tubes ont réagi dans la même fenêtre
    }
  }

  // Fin d'une seconde : envoi des comptages puis remise à zéro
  if (millis() - debutPeriode >= PERIODE_MS) {
    debutPeriode += PERIODE_MS;
    seconde++;
    noInterrupts();
    unsigned long n1 = impulsions1;
    unsigned long n2 = impulsions2;
    impulsions1 = 0;
    impulsions2 = 0;
    interrupts();
    unsigned long n12 = coincidences;
    coincidences = 0;

    Serial.print(F("D;"));
    Serial.print(seconde);
    Serial.print(';');
    Serial.print(n1);
    Serial.print(';');
    Serial.print(n2);
    Serial.print(';');
    Serial.println(n12);
  }
}
