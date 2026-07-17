const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const h3 = require('h3-js');
const helmet = require('helmet');

const app = express();
app.use(helmet());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const EARTH_RADIUS = 6371000; // Raggio terrestre in metri
const MAX_SPEED_KMH = 25.0;   // Limite massimo di camminata/corsa per convalidare i pixel

// --- MEMORIA DI GIOCO GLOBALE PER I CLAN ---
const mappaPixel = {};            // Struttura: { "pixelId": { clan: "ROSSI", owner: "Luke", protectedUntil: 0 } }
const classificheClan = {};       // Classifica dei Clan: { "Europe_Main_1": { "ROSSI": 0, "BLU": 0, "VERDI": 0 } }
const utentiBannati = new Set();
const scontriAttivi = {};
const ultimaPosizioneUtenti = {};

// Registro ufficiale dei Clan con relativo colore esadecimale sulla mappa
const DIZIONARIO_CLAN = {
    'ROSSI': '#FF0000',
    'BLU': '#0000FF',
    'VERDI': '#00FF00'
};

const LISTA_MINIGIOCHI = ['CHRONO_STOP', 'CODE_CRACKER', 'TANK_BLITZ', 'TAP_BLITZ', 'MATH_RUSH'];
const DIZIONARIO_CODE_CRACKER = {
    'it': ['Precipitovolissimevolmente', 'Anticostituzionalissimamente', 'Psiconeuroendocrinoimmunologia'],
    'en': ['Pneumonoultramicroscopicsilicovolcanoconiosis', 'Antidisestablishmentarianism']
};

function toRadians(degree) { return degree * Math.PI / 180; }

/// Formula di Haversine per calcolare la distanza reale tra celle H3
function calculateDistance(lat1, lon1, lat2, lon2) {
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return EARTH_RADIUS * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

io.on('connection', (socket) => {
    console.log(`Connesso: ${socket.id}`);

    // Gestione dell'autenticazione iniziale con assegnazione del Clan scelto
    socket.on('join_server', ({ username, serverId, lingua, clanName }) => {
        if (utentiBannati.has(username)) {
            socket.emit('auth_error', 'Account Bannato.');
            socket.disconnect();
            return;
        }

        const clanSelezionato = clanName ? clanName.toUpperCase() : 'ROSSI';
        if (!DIZIONARIO_CLAN[clanSelezionato]) {
            socket.emit('game_error', 'Clan selezionato non esistente.');
            return;
        }

        socket.username = username;
        socket.serverId = serverId;
        socket.lingua = lingua || 'it';
        socket.clan = clanSelezionato; 
        socket.join(serverId);
        
        if (!classificheClan[serverId]) {
            classificheClan[serverId] = { 'ROSSI': 0, 'BLU': 0, 'VERDI': 0 };
        }
        
        socket.emit('update_leaderboard', classificheClan[serverId]);
    });

    // Ricezione pacchetto GPS e attivazione filtri Anti-Cheat
    socket.on('move_gps', ({ lat, lng, is_mocked }) => {
        if (!socket.username || !socket.serverId) return;

        if (is_mocked) {
            socket.emit('game_error', 'Rilevato uso di Fake GPS a livello hardware.');
            return;
        }

        const now = Math.floor(Date.now() / 1000);
        const storico = ultimaPosizioneUtenti[socket.id];

        if (storico) {
            const timeElapsed = now - storico.timestamp;
            if (timeElapsed <= 0) return;

            const distanzaMetri = calculateDistance(storico.lat, storico.lng, lat, lng);
            const velocitaKmh = (distanzaMetri / timeElapsed) * 3.6;

            if (velocitaKmh > MAX_SPEED_KMH) {
                socket.emit('game_error', `Troppo veloce (${velocitaKmh.toFixed(1)} km/h)! Conquista annullata.`);
                return;
            }
        }

        ultimaPosizioneUtenti[socket.id] = { lat, lng, timestamp: now };
        const pixelId = h3.latLngToCell(lat, lng, 9);
        const serverId = socket.serverId;

        const pixelEsistente = mappaPixel[pixelId];

        // ⚔️ BATTAGLIA TRA CLAN NEMICI CON VERIFICA DELLO SCUDO DI PROTEZIONE (MONETIZZAZIONE)
        if (pixelEsistente && pixelEsistente.clan !== socket.clan && !scontriAttivi[pixelId]) {
            
            // Verifica se la cella è protetta da uno scudo acquistato o sbloccato con Ads
            if (pixelEsistente.protectedUntil && pixelEsistente.protectedUntil > now) {
                const tempoRimasto = pixelEsistente.protectedUntil - now;
                socket.emit('game_error', `Esagono protetto dallo Scudo del Clan avversario per altri ${tempoRimasto} secondi!`);
                return;
            }

            const giocoEstratto = LISTA_MINIGIOCHI[Math.floor(Math.random() * LISTA_MINIGIOCHI.length)];
            const tempoTargetCrono = Math.floor(Math.random() * 5) + 3;
            const listaFrasi = DIZIONARIO_CODE_CRACKER[socket.lingua] || DIZIONARIO_CODE_CRACKER['it'];
            const parolaSelezionata = listaFrasi[Math.floor(Math.random() * listaFrasi.length)];

            scontriAttivi[pixelId] = {
                attaccante: { id: socket.id, username: socket.username, clan: socket.clan, punti: 0 },
                difensore: { id: pixelEsistente.socketId, username: pixelEsistente.owner, clan: pixelEsistente.clan, punti: 0 },
                tipoGioco: giocoEstratto,
                tempoTarget: tempoTargetCrono,
                parolaSegreta: parolaSelezionata,
                round: 1,
                timestampInizioRound: now
            };

            socket.emit('avvia_minigioco', { gioco: giocoEstratto, ruolo: 'attaccante', tempoTarget: tempoTargetCrono, parolaSegreta: parolaSelezionata, pixelId, msg: `Stai attaccando il Clan ${pixelEsistente.clan}!` });
            io.to(pixelEsistente.socketId).emit('avvia_minigioco', { gioco: giocoEstratto, ruolo: 'difensore', tempoTarget: tempoTargetCrono, parolaSegreta: parolaSelezionata, pixelId, msg: `Il tuo esagono è sotto attacco dal Clan ${socket.clan}!` });
            return;
        }

        // SE L'ESAGONO È VUOTO, CONQUISTA IMMEDIATA PER IL CLAN
        if (!pixelEsistente) {
            mappaPixel[pixelId] = { owner: socket.username, clan: socket.clan, socketId: socket.id, protectedUntil: 0 };
            classificheClan[serverId][socket.clan] = (classificheClan[serverId][socket.clan] || 0) + 1;

            io.to(serverId).emit('pixel_conquered', { pixelId, owner: socket.username, clan: socket.clan, color: DIZIONARIO_CLAN[socket.clan] });
            io.to(serverId).emit('update_leaderboard', classificheClan[serverId]);
        }
    });

    // 💰 MONETIZZAZIONE: Evento scatenato dalla visione di pubblicità o acquisto in-app
    socket.on('compra_scudo_pixel', ({ pixelId }) => {
        if (!socket.username || !mappaPixel[pixelId]) return;

        if (mappaPixel[pixelId].clan === socket.clan) {
            const ora = Math.floor(Date.now() / 1000);
            mappaPixel[pixelId].protectedUntil = ora + 7200; // Imposta uno scudo difensivo di 2 ore (7200 secondi)
            socket.emit('game_error', 'Scudo energetico di 2 ore attivato con successo su questa cella!');
        }
    });

    socket.on('invia_punteggio_gioco', ({ pixelId, score }) => {
        const scontro = scontriAttivi[pixelId];
        if (!scontro) return;

        if (socket.id === scontro.attaccante.id) scontro.attaccante.punti += score;
        else if (socket.id === scontro.difensore.id) scontro.difensore.punti += score;

        if (scontro.round >= 3) {
            const vincitore = scontro.attaccante.punti > scontro.difensore.punti ? scontro.attaccante : scontro.difensore;
            const perdente = vincitore.username === scontro.attaccante.username ? scontro.difensore : scontro.attaccante;

            mappaPixel[pixelId] = { owner: vincitore.username, clan: vincitore.clan, socketId: vincitore.id, protectedUntil: 0 };
            
            const serverId = socket.serverId;
            classificheClan[serverId][vincitore.clan] = (classificheClan[serverId][vincitore.clan] || 0) + 1;
            if (classificheClan[serverId][perdente.clan] > 0) classificheClan[serverId][perdente.clan]--;

            io.to(scontro.attaccante.id).to(scontro.difensore.id).emit('fine_minigioco', { vincitore: vincitore.username, clanVincitore: vincitore.clan });
            io.to(serverId).emit('pixel_conquered', { pixelId, owner: vincitore.username, clan: vincitore.clan, color: DIZIONARIO_CLAN[vincitore.clan] });
            io.to(serverId).emit('update_leaderboard', classificheClan[serverId]);

            delete scontriAttivi[pixelId];
        } else {
            scontro.round++;
            scontro.timestampInizioRound = Math.floor(Date.now() / 1000);
        }
    });

    socket.on('disconnect', () => {
        delete ultimaPosizioneUtenti[socket.id];
    });
});

server.listen(3000, () => console.log('Server attivo sulla porta 3000'));
