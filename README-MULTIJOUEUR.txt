BACKROOMS SYNT — MULTIJOUEUR PUBLIC

FICHIERS
- backrooms-synt-multiplayer.html : jeu avec menu multijoueur et synchronisation des joueurs
- server.js : serveur WebSocket + hébergement du jeu
- package.json : dépendance ws et commande de démarrage
- render.yaml : configuration Render

DÉPLOIEMENT RENDER
1. Crée un dépôt GitHub et ajoute ces 4 fichiers à la racine.
2. Dans Render, crée un Web Service depuis ce dépôt.
3. Render détecte render.yaml. Sinon : Runtime Node, Build Command `npm install`, Start Command `npm start`.
4. Déploie. Vérifie `https://TON-SERVICE.onrender.com/health` : le résultat doit contenir {"ok":true}.
5. Ouvre `https://TON-SERVICE.onrender.com/` : le jeu se charge.
6. Dans le menu du jeu, clique MULTIJOUEUR EN LIGNE. L'adresse du serveur est normalement préremplie. Connecte-toi, crée un salon public, puis démarre la partie. Les amis ouvrent le même site, se connectent et rejoignent le salon dans la liste.

NOTES
- Les salons publics sont hébergés en mémoire : ils disparaissent quand le serveur redémarre ou se met en veille.
- Maximum actuel : 8 joueurs par salon.
- Cette première version synchronise les positions, orientations, niveaux et apparences des joueurs. Les monstres et objets du monde sont encore simulés localement par chaque client ; les dégâts, inventaires, photos et progression ne sont pas encore autoritaires/synchronisés.
- Le navigateur doit être servi par HTTPS sur Render ; le jeu utilise alors WSS automatiquement.
