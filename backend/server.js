const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const h3 = require('h3-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- BOT ANTI-VOLGARITÀ (Espandibile con altre parole) ---
const BLACKLIST_PAROLE = ['parolaccia1', 'insulto2', 'scemo', 'volgare3']; 
const utentiBannati = new Set(); 

function contieneVolgarita(username) {
    const nomeMinuscolo = username.toLowerCase();
    return BLACKLIST_PAROLE.some(parola => nomeMinuscolo.includes(parola));
}

// Database temporaneo in memoria
const mappaPixel = {}; // Struttura: { "pixelId": { owner: "username", socketId: "id" } }
const classifiche = {}; 
const segnalazioni = {}; 
const scontriAttivi = {}; // Memorizza i minigiochi in corso: { "pixelId": { attaccante, difensore, round } }

io.on('connection', (socket) => {
    console.log(`Connesso: ${socket.id}`);

    // --- ACCESSO AL SERVER CON CONTROLLO BAN ---
    socket.on('join_server', ({ username, serverId }) => {
        if (utentiBannati.has(username) || contieneVolgarita(username)) {
            utentiBannati.add(username); // Ban immediato se tenta di usare parole volgari
            socket.emit('auth_error', 'Username non consentito o Account Bannato.');
            socket.disconnect();
            return;
        }

        socket.username = username;
        socket.serverId = serverId;
        socket.join(serverId);
        
        if (!classifiche[serverId]) classifiche[serverId] = {};
        if (!classifiche[serverId][username]) classifiche[serverId][username] = 0;
        
        socket.emit('update_leaderboard', classifiche[serverId]);
    });

    // --- RICEZIONE MOVIMENTO GPS E AVVIO SCONTRO PRIVATO ---
    socket.on('move_gps', ({ lat, lng }) => {
        if (!socket.username || !socket.serverId || utentiBannati.has(socket.username)) return;

        // Converte Lat/Lng nel sistema a pixel geometrici (Risoluzione 9 = circa 100 metri)
        const pixelId = h3.latLngToCell(lat, lng, 9);
        const serverId = socket.serverId;

        // Se il pixel appartiene a qualcun altro e non c'è già una sfida attiva su quel pixel
        if (mappaPixel[pixelId] && mappaPixel[pixelId].owner !== socket.username && !scontriAttivi[pixelId]) {
            const vecchioProprietario = mappaPixel[pixelId];

            // Inizializza la sessione del minigioco tra i due player
            scontriAttivi[pixelId] = {
                attaccante: { id: socket.id, username: socket.username, punti: 0 },
                difensore: { id: vecchioProprietario.socketId, username: vecchioProprietario.owner, punti: 0 },
                round: 1
            };

            // Invia l'allerta di scontro ESCLUSIVAMENTE ai due sfidanti coinvolti
            socket.emit('avvia_minigioco', { msg: "Stai attaccando il territorio di " + vecchioProprietario.owner, ruolo: 'attaccante', pixelId });
            io.to(vecchioProprietario.socketId).emit('avvia_minigioco', { msg: `Il tuo territorio è SOTTO ATTACCO da ${socket.username}!`, ruolo: 'difensore', pixelId });
            return;
        }

        // Se il pixel è completamente libero, viene conquistato normalmente
        if (!mappaPixel[pixelId]) {
            mappaPixel[pixelId] = { owner: socket.username, socketId: socket.id };
            classifiche[serverId][socket.username] = (classifiche[serverId][socket.username] || 0) + 1;

            // Invia l'aggiornamento a tutto il server per mostrare lo username sul pixel della mappa
            io.to(serverId).emit('pixel_conquered', { pixelId, owner: socket.username });
            io.to(serverId).emit('update_leaderboard', classifiche[serverId]);
        }
    });

    // --- GESTIONE DEI REALI ROUND DEL MINIGIOCO (Ricezione Tap) ---
    socket.on('invia_punteggio_tap', ({ pixelId, puntiRound }) => {
        const scontro = scontriAttivi[pixelId];
        if (!scontro) return;

        // Aggiunge i punti del round al giocatore corretto
        if (socket.id === scontro.attaccante.id) {
            scontro.attaccante.punti += puntiRound;
        } else if (socket.id === scontro.difensore.id) {
            scontro.difensore.punti += puntiRound;
        }

        // Se entrambi hanno completato i 3 round veloci di scontro
        if (scontro.round >= 3) {
            const vincitore = scontro.attaccante.punti > scontro.difensore.punti ? scontro.attaccante : scontro.difensore;
            const perdente = vincitore.username === scontro.attaccante.username ? scontro.difensore : scontro.attaccante;

            // Il vincitore prende il controllo del pixel sul server
            mappaPixel[pixelId] = { owner: vincitore.username, socketId: vincitore.id };
            
            // Aggiornamento dei punteggi generali per la classifica
            const serverId = socket.serverId;
            classifiche[serverId][vincitore.username] = (classifiche[serverId][vincitore.username] || 0) + 1;
            if (classifiche[serverId][perdente.username] > 0) {
                classifiche[serverId][perdente.username]--;
            }

            // Invia il verdetto finale privatamente solo ai due sfidanti
            io.to(scontro.attaccante.id).to(scontro.difensore.id).emit('fine_minigioco', { 
                vincitore: vincitore.username, 
                puntiVincitore: vincitore.punti,
                puntiPerdente: perdente.punti
            });

            // Aggiorna la mappa visiva e la classifica di tutto il server in tempo reale
            io.to(serverId).emit('pixel_conquered', { pixelId, owner: vincitore.username });
            io.to(serverId).emit('update_leaderboard', classifiche[serverId]);

            // Cancella la sessione di scontro conclusa
            delete scontriAttivi[pixelId]; 
        } else {
            // Passa al round successivo (fino a 3)
            scontro.round++;
        }
    });

    // --- TASTO REPORT / SEGNALAZIONE GIOCATORE ---
    socket.on('segnala_giocatore', ({ targetUsername }) => {
        if (!segnalazioni[targetUsername]) segnalazioni[targetUsername] = 0;
        segnalazioni[targetUsername]++;

        // Se un utente riceve 3 o più segnalazioni dagli altri player, il bot lo banna all'istante
        if (segnalazioni[targetUsername] >= 3) {
            utentiBannati.add(targetUsername);
            io.to(socket.serverId).emit('player_banned', { username: targetUsername });
            console.log(`Il Bot ha bannato automaticamente: ${targetUsername}`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Disconnesso: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));
