const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const h3 = require('h3-js');
const helmet = require('helmet');
const { Pool } = require('pg');

const app = express();
app.use(helmet());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const pool = new Pool({
    connectionString: "postgresql://postgres:password_segreta@db.supabase.co:5432/postgres",
    ssl: { rejectUnauthorized: false }
});

const EARTH_RADIUS = 6371000;
const MAX_SPEED_KMH = 25.0;

const utentiBannati = new Set();
const scontriAttivi = {};
const ultimaPosizioneUtenti = {};

const DIZIONARIO_CLAN = { 'ROSSI': '#FF0000', 'BLU': '#0000FF', 'VERDI': '#00FF00' };

// 🗺️ SINCRONIZZAZIONE DATABASE CON TRUPPE E DIFESE
async function inizializzaDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS server_pixels (
            pixel_id VARCHAR(30) PRIMARY KEY,
            owner_name VARCHAR(50),
            clan_name VARCHAR(20),
            defense_hp INT DEFAULT 0,       -- HP della torretta statica (0 = nessuna difesa)
            protected_until INT DEFAULT 0
        );
    `);
    console.log("Database Difese/Truppe sincronizzato.");
}
inizializzaDatabase();

function toRadians(degree) { return degree * Math.PI / 180; }

function calculateDistance(lat1, lon1, lat2, lon2) {
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return EARTH_RADIUS * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

io.on('connection', (socket) => {
    
    socket.on('join_server', async ({ username, serverId, lingua, clanName }) => {
        if (utentiBannati.has(username)) {
            socket.emit('auth_error', 'Account Bannato.');
            socket.disconnect();
            return;
        }
        socket.username = username;
        socket.serverId = serverId;
        socket.lingua = lingua || 'it';
        socket.clan = clanName ? clanName.toUpperCase() : 'ROSSI';
        
        // Ogni giocatore parte con un piccolo miniesercito di 50 truppe salvato nella sessione
        socket.truppe = 50; 
        
        socket.join(serverId);

        const res = await pool.query("SELECT clan_name, COUNT(*) as conteggio FROM server_pixels GROUP BY clan_name");
        let board = { 'ROSSI': 0, 'BLU': 0, 'VERDI': 0 };
        res.rows.forEach(row => { if (board[row.clan_name] !== undefined) board[row.clan_name] = parseInt(row.conteggio); });
        
        socket.emit('update_leaderboard', board);
        socket.emit('update_truppe', socket.truppe);
    });

    socket.on('move_gps', async ({ lat, lng, is_mocked }) => {
        if (!socket.username || !socket.serverId) return;

        if (is_mocked) {
            socket.emit('game_error', 'Uso di Fake GPS rilevato dall\'hardware.');
            return;
        }

        const now = Math.floor(Date.now() / 1000);
        const storico = ultimaPosizioneUtenti[socket.id];

        if (storico) {
            const timeElapsed = now - storico.timestamp;
            if (timeElapsed <= 0) return;
            const distanza = calculateDistance(storico.lat, storico.lng, lat, lng);
            if ((distanza / timeElapsed) * 3.6 > MAX_SPEED_KMH) {
                socket.emit('game_error', 'Velocità troppo alta! Spostamento annullato.');
                return;
            }
        }

        ultimaPosizioneUtenti[socket.id] = { lat, lng, timestamp: now };
        const pixelId = h3.latLngToCell(lat, lng, 9);
        
        const dbRes = await pool.query("SELECT * FROM server_pixels WHERE pixel_id = $1", [pixelId]);
        const pixelEsistente = dbRes.rows[0];

        // ⚔️ SE L'ESAGONO APPARTIENE A UN CLAN NEMICO
        if (pixelEsistente && pixelEsistente.clan_name !== socket.clan) {
            
            // 🛡️ CONTROLLO TORRETTA DI DIFESA STATICA
            if (pixelEsistente.defense_hp > 0) {
                // Il miniesercito del giocatore attacca automaticamente la torretta
                if (socket.truppe > 0) {
                    let dannoAlleDifese = Math.min(socket.truppe, pixelEsistente.defense_hp);
                    socket.truppe -= dannoAlleDifese;
                    let nuoviHpDifesa = pixelEsistente.defense_hp - dannoAlleDifese;

                    // Aggiorna le difese sul Database
                    await pool.query("UPDATE server_pixels SET defense_hp = $1 WHERE pixel_id = $2", [nuoviHpDifesa, pixelId]);
                    socket.emit('update_truppe', socket.truppe);

                    if (nuoviHpDifesa > 0) {
                        socket.emit('game_error', `⚔️ Hai attaccato le difese! Torretta nemica rimasta a ${nuoviHpDifesa} HP. Il tuo miniesercito ha subito perdite.`);
                        return;
                    } else {
                        socket.emit('game_error', `💥 Complimenti! Il tuo miniesercito ha distrutto la torretta di difesa nemica! Ora l'esagono è vulnerabile.`);
                        return;
                    }
                } else {
                    socket.emit('game_error', `❌ Questo territorio è protetto da una Torretta (${pixelEsistente.defense_hp} HP)! Non hai abbastanza miniesercito per attaccare.`);
                    return;
                }
            }

            // Se la torretta è a 0 HP, scatta il minigioco classico per conquistare la cella
            if (!scontriAttivi[pixelId]) {
                scontriAttivi[pixelId] = { attaccante: { id: socket.id, username: socket.username, clan: socket.clan }, round: 1 };
                socket.emit('avvia_minigioco', { gioco: 'CODE_CRACKER', ruolo: 'attaccante', pixelId, msg: "Torretta abbattuta! Avvia l'invasione finale!" });
            }
            return;
        }

        // SE L'ESAGONO È VUOTO, CONQUISTA E RIGENERA 1 MINION DEL MINIESERCITO
        if (!pixelEsistente) {
            await pool.query("INSERT INTO server_pixels (pixel_id, owner_name, clan_name, defense_hp) VALUES ($1, $2, $3, 0)", [pixelId, socket.username, socket.clan]);
            
            socket.truppe += 2; // Camminare in territori neutri fa reclutare truppe (+2 minion)
            socket.emit('update_truppe', socket.truppe);

            io.to(socket.serverId).emit('pixel_conquered', { pixelId, owner: socket.username, clan: socket.clan, color: DIZIONARIO_CLAN[socket.clan], hasDefense: false });
        }
    });

    // 🔨 COSTRUZIONE DIFESE: Il giocatore spende truppe/risorse per piazzare una torretta nell'esagono corrente
    socket.on('costruisci_difesa', async ({ lat, lng }) => {
        if (!socket.username) return;
        const pixelId = h3.latLngToCell(lat, lng, 9);

        const dbRes = await pool.query("SELECT * FROM server_pixels WHERE pixel_id = $1", [pixelId]);
        const pixel = dbRes.rows[0];

        if (pixel && pixel.clan_name === socket.clan) {
            if (socket.truppe >= 20) {
                socket.truppe -= 20; // Costruire una torretta costa 20 soldati del miniesercito
                let nuoviHp = (pixel.defense_hp || 0) + 100; // Aggiunge 100 HP di scudo statico

                await pool.query("UPDATE server_pixels SET defense_hp = $1 WHERE pixel_id = $2", [nuoviHp, pixelId]);
                
                socket.emit('update_truppe', socket.truppe);
                socket.emit('game_error', `🔨 Torretta costruita! Difese aumentate a ${nuoviHp} HP.`);
                io.to(socket.serverId).emit('pixel_conquered', { pixelId, owner: pixel.owner_name, clan: pixel.clan_name, color: DIZIONARIO_CLAN[pixel.clan_name], hasDefense: true });
            } else {
                socket.emit('game_error', '❌ Truppe insufficienti! Ti servono almeno 20 minion per erigere una difesa.');
            }
        } else {
            socket.emit('game_error', '❌ Puoi piazzare torrette di difesa solo nei territori già conquistati dal tuo Clan!');
        }
    });
});

server.listen(3000, () => console.log('Server Truppe & Torrette attivo sulla porta 3000'));
