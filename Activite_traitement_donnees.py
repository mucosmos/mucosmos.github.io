
"""
Created on Fri Jun 14 11:24:09 2024

# -*- coding: utf-8 -*-


@author: cedric
"""

import matplotlib.pyplot as plt
import numpy as np
import statistics as stat


def gauss(Nmoy, Sigma, val):
    return 1 / (Sigma * (2 * np.pi)**0.5)*np.exp(-0.5 * ((val-Nmoy)**2 / Sigma**2))


plt.clf()

# Lecture des donnees du fichier txt
N= np.loadtxt('Activite2024-09-17-16-16-32.txt', unpack = True , usecols=(0), delimiter = '\t', skiprows = 1)



Nmoy=stat.mean(N)
Sigma=stat.pstdev(N)
u=Sigma/np.sqrt(len(N))

Nth=np.linspace(0,20,300)
Fth=[len(N) * gauss(Nmoy, Sigma, val) for val in Nth]

plt.figure(dpi=300)

plt.hist(N,range=(0,30),bins=30,edgecolor='black')
plt.text(20,4,r"$\overline {N}=$"+f"{Nmoy:.1f}")
plt.text(20,3,r"$\sigma_{n-1}=$"+f"{Sigma:.1f}")
plt.text(20,2,r"$u(N)=$"+f"{u:.1f}")
plt.xlabel('Activité pour 10 s')
plt.ylabel('fréquence')

plt.plot(Nth, Fth,color='red',label=r'$f(N)=\frac{N_{total}}{\sqrt{2.\pi.\sigma^2}}.e^{-\frac{(N-\overline{N})^2}{2\sigma^2}}$')
plt.legend()

plt.show()