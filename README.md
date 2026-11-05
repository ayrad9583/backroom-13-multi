# Backrooms Niveau 0 — salons multijoueurs

Cette version ajoute des salons privés pour jouer à plusieurs (jusqu’à 4 joueurs) : un joueur crée un salon, partage le code, l’autre le saisit, puis l’hôte lance la partie lorsque tous les participants sont prêts.

## Lancer le jeu

Prérequis : Node.js 18 ou plus récent.

```bash
npm install
npm start
```

Ouvre ensuite **http://localhost:3000**. Pour jouer avec quelqu’un à distance, il faut héberger ce serveur sur une machine accessible à l’autre joueur (ou utiliser un tunnel HTTPS/WSS). Les deux joueurs ouvrent la même adresse publique.

Le serveur ajoute `multiplayer.js` à la page du jeu à la volée : le fichier HTML original reste intact. Le code de salon est temporaire, aléatoire et expire après 30 minutes si la partie n’a pas commencé.

## Limite actuelle

Le serveur gère les salons, les joueurs présents, leur état « prêt » et le lancement simultané depuis l’écran d’accueil du jeu. Il ne synchronise pas encore le monde 3D, les positions, les monstres, les objets, les dégâts ou la progression : les joueurs ne se voient donc pas encore dans la partie et ne partagent pas l’état du jeu.
