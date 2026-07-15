const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const h3 = require('h3-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Database temporaneo in memoria per i test
const mappaPixel = {};
const classifiche = {}; 

io.on('connection', (socket) => {
    console.log(`Giocatore connesso: ${socket.id}`);

    // Il giocatore entra nel server di gioco locale
    socket.on('join_server', ({ username, serverId }) => {
        socket.username = username;
        socket.serverId = serverId;
        socket.join(serverId);
        
        if (!classifiche[serverId]) classifiche[serverId] = {};
        if (!classifiche[serverId][username]) classifiche[serverId][username] = 0;
        
        // Invia subito la classifica attuale
        socket.emit('update_leaderboard', classifiche[serverId]);
    });

    // Ricezione delle coordinate GPS dallo smartphone
    socket.on('move_gps', ({ lat, lng }) => {
        if (!socket.username || !socket.serverId) return;

        // Converte Lat/Lng in un ID Pixel unico al mondo (Risoluzione 9 = circa 100 metri)
        const pixelId = h3.latLngToCell(lat, lng, 9);
        const serverId = socket.serverId;

        // Se il pixel è libero o appartiene a un altro, viene conquistato
        if (!mappaPixel[pixelId] || mappaPixel[pixelId].owner !== socket.username) {
            
            // Sottrae il punto al vecchio proprietario se esisteva nello stesso server
            if (mappaPixel[pixelId] && classifiche[serverId][mappaPixel[pixelId].owner]) {
                classifiche[serverId][mappaPixel[pixelId].owner]--;
            }

            // Assegna il pixel al nuovo giocatore
            mappaPixel[pixelId] = { owner: socket.username, serverId: serverId };
            classifiche[serverId][socket.username] = (classifiche[serverId][socket.username] || 0) + 1;

            // Aggiorna tutti i giocatori connessi a questo server
            io.to(serverId).emit('pixel_conquered', { pixelId, owner: socket.username });
            io.to(serverId).emit('update_leaderboard', classifiche[serverId]);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Giocatore disconnesso: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));
