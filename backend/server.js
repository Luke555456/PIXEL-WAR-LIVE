const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const h3 = require('h3-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- BOT ANTI-VOLGARITÀ ---
const BLACKLIST_PAROLE = ['parolaccia1', 'insulto2', 'scemo', 'volgare3']; 
const utentiBannati = new Set(); 

function contieneVolgarita(username) {
    const nomeMinuscolo = username.toLowerCase();
    return BLACKLIST_PAROLE.some(parola => nomeMinuscolo.includes(parola));
}

// Database temporaneo in memoria
const mappaPixel = {}; 
const classifiche = {}; 
const segnalazioni = {}; 
const scontriAttivi = {}; 

// LISTA DEI 5 MINIGIOCHI
const LISTA_MINIGIOCHI = ['CHRONO_STOP', 'CODE_CRACKER', 'TANK_BLITZ', 'TAP_BLITZ', 'MATH_RUSH'];

// --- DIZIONARIO REALE E GRAMMATICALMENTE CORRETTO ---
const DIZIONARIO_CODE_CRACKER = {
    'it': [
        'Precipitovolissimevolmente',
        'Anticostituzionalissimamente',
        'Psiconeuroendocrinoimmunologia',
        'Esofagoduodenodigiunostomia', // Corretto in italiano chirurgico
        'Incontrovertibilissimamente',
        'Particolarissimamente'
    ],
    'en': [
        'Pneumonoultramicroscopicsilicovolcanoconiosis', // Termine da record reale
        'Antidisestablishmentarianism',
        'Floccinaucinihilipilification',
        'Pseudopseudohypoparathyroidism',
        'Incomprehensibilities',
        'Honorificabilitudinitatibus'
    ]
};

io.on('connection', (socket) => {
    console.log(`Connesso: ${socket.id}`);

    socket.on('join_server', ({ username, serverId, lingua }) => {
        if (utentiBannati.has(username) || contieneVolgarita(username)) {
            utentiBannati.add(username); 
            socket.emit('auth_error', 'Username non consentito o Account Bannato.');
            socket.disconnect();
            return;
        }

        socket.username = username;
        socket.serverId = serverId;
        socket.lingua = lingua || 'it'; 
        socket.join(serverId);
        
        if (!classifiche[serverId]) classifiche[serverId] = {};
        if (!classifiche[serverId][username]) classifiche[serverId][username] = 0;
        
        socket.emit('update_leaderboard', classifiche[serverId]);
    });

    socket.on('move_gps', ({ lat, lng }) => {
        if (!socket.username || !socket.serverId || utentiBannati.has(socket.username)) return;

        const pixelId = h3.latLngToCell(lat, lng, 9);
        const serverId = socket.serverId;

        if (mappaPixel[pixelId] && mappaPixel[pixelId].owner !== socket.username && !scontriAttivi[pixelId]) {
            const vecchioProprietario = mappaPixel[pixelId];
            const giocoEstratto = LISTA_MINIGIOCHI[Math.floor(Math.random() * LISTA_MINIGIOCHI.length)];

            const tempoTargetCrono = Math.floor(Math.random() * 5) + 3; // Da 3 a 7 secondi
            
            const linguaScontro = socket.lingua || 'it';
            const listaFrasiLingua = DIZIONARIO_CODE_CRACKER[linguaScontro] || DIZIONARIO_CODE_CRACKER['it'];
            const parolaSelezionata = listaFrasiLingua[Math.floor(Math.random() * listaFrasiLingua.length)];

            scontriAttivi[pixelId] = {
                attaccante: { id: socket.id, username: socket.username, punti: 0 },
                difensore: { id: vecchioProprietario.socketId, username: vecchioProprietario.owner, punti: 0 },
                tipoGioco: giocoEstratto,
                tempoTarget: tempoTargetCrono,
                parolaSegreta: parolaSelezionata,
                round: 1
            };

            socket.emit('avvia_minigioco', { 
                msg: `Attacco a ${vecchioProprietario.owner}!`, 
                ruolo: 'attaccante', 
                gioco: giocoEstratto,
                tempoTarget: tempoTargetCrono,
                parolaSegreta: parolaSelezionata,
                pixelId 
            });
            
            io.to(vecchioProprietario.socketId).emit('avvia_minigioco', { 
                msg: `Difendi da ${socket.username}!`, 
                ruolo: 'difensore', 
                gioco: giocoEstratto,
                tempoTarget: tempoTargetCrono,
                parolaSegreta: parolaSelezionata,
                pixelId 
            });
            return;
        }

        if (!mappaPixel[pixelId]) {
            mappaPixel[pixelId] = { owner: socket.username, socketId: socket.id };
            classifiche[serverId][socket.username] = (classifiche[serverId][socket.username] || 0) + 1;

            io.to(serverId).emit('pixel_conquered', { pixelId, owner: socket.username });
            io.to(serverId).emit('update_leaderboard', classifiche[serverId]);
        }
    });

    socket.on('invia_punteggio_gioco', ({ pixelId, score }) => {
        const scontro = scontriAttivi[pixelId];
        if (!scontro) return;

        if (socket.id === scontro.attaccante.id) {
            scontro.attaccante.punti += score;
        } else if (socket.id === scontro.difensore.id) {
            scontro.difensore.punti += score;
        }

        if (scontro.round >= 3) {
            const vincitore = scontro.attaccante.punti > scontro.difensore.punti ? scontro.attaccante : scontro.difensore;
            const perdente = vincitore.username === scontro.attaccante.username ? scontro.difensore : scontro.attaccante;

            mappaPixel[pixelId] = { owner: vincitore.username, socketId: vincitore.id };
            
            const serverId = socket.serverId;
            classifiche[serverId][vincitore.username] = (classifiche[serverId][vincitore.username] || 0) + 1;
            if (classifiche[serverId][perdente.username] > 0) classifiche[serverId][perdente.username]--;

            io.to(scontro.attaccante.id).to(scontro.difensore.id).emit('fine_minigioco', { 
                vincitore: vincitore.username, 
                puntiVincitore: vincitore.punti,
                puntiPerdente: perdente.punti
            });

            io.to(serverId).emit('pixel_conquered', { pixelId, owner: vincitore.username });
            io.to(serverId).emit('update_leaderboard', classifiche[serverId]);

            delete scontriAttivi[pixelId]; 
        } else {
            scontro.round++;
        }
    });

    socket.on('disconnect', () => {
        console.log(`Disconnesso: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));
