#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Created on Wed Feb 21 10:29:08 2024

@author: Jonas Forlot Modifications Compteur Geiger 2024 Cédric Vanden Driessche
"""

#Importation des modules
import serial
import serial.tools.list_ports   # pour la communication avec le port série
import time # gestion du temps
import matplotlib.pyplot as plt  # pour le tracé de graphe
import time
#from matplotlib import animation # pour la figure animée


#initialisation des listes
liste_temps_mesure =[] # liste pour stocker le temps"brut"
liste_temps=[] # liste pour stocker les valeurs de temps en partant de t=0
liste_impulsion= [] # liste pour stocker les impulsions
liste_duree=[]

t_acquisition = 300

def recup_port_Arduino():
    ports = list(serial.tools.list_ports.comports())
    
    for p in ports:
        print(p.description)
        if "ttyACM0" in p.description or "ttyACM1" in p.description or "ttyACM2" in p.description:
             mData =serial.Serial (p.device,9600)
    print(mData.is_open)
    print(mData.name)
    return mData

Data=recup_port_Arduino()

temps_reel =0
while temps_reel < t_acquisition :
    ligne1=Data.readline()
       
    liste_données=ligne1.strip().split()    
    #print(liste_données)
    
    if len(liste_données) != 0:
        impulsion=float(liste_données[3].decode())
        liste_impulsion.append(impulsion)
        duree=float(liste_données[7].decode())
        liste_duree.append(duree)
        temps_mesure=time.time()
        liste_temps_mesure.append(temps_mesure)
        temps_reel= temps_mesure-liste_temps_mesure[0]
        
        print('Nombre d impulsions ', impulsion)
        print('duree experience ', duree, 's')
        print('temps reel',temps_reel,'s')

Data.close()# pour arrêter la lecture des données série

plt.title('Pulse par 10s') # titre du graphique
plt.hist(liste_impulsion, bins=50, color='skyblue', edgecolor='black')
#plt.xlim (0,1000)  #limtes pour les axes avec les valeurs extrêmes de I et de U
#plt.ylim(0,100)
plt.xlabel('pulse par 10 s')
plt.ylabel('fréquence')
plt.show()

#Ecriture dans un fichier txt
lines=['N \t duree \n'] #première ligne du fichier txt
for i in range (len (liste_impulsion)):
    line = (str(liste_impulsion[i])+'\t'+ str(liste_duree[i])+'\n')
    lines.append(line)

fichier = open('Activite'+time.strftime("%Y-%m-%d-%H-%M-%S")+'.txt', 'w').writelines(lines) # création d'un nouveau fichier texte