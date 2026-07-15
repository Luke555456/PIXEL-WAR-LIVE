import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:shared_preferences/shared_preferences.dart';

void main() => runApp(const PixelGameApp());

class PixelGameApp extends StatelessWidget {
  const PixelGameApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Pixel Conquest',
      theme: ThemeData.dark(),
      home: const SchermataIniziale(),
    );
  }
}

// --- 1. SCHERMATA LOGIN / USERNAME / LINGUA ---
class SchermataIniziale extends StatefulWidget {
  const SchermataIniziale({super.key});

  @override
  State<SchermataIniziale> createState() => _SchermataInizialeState();
}

class _SchermataInizialeState extends State<SchermataIniziale> {
  final TextEditingController _usernameController = TextEditingController();
  String _lingua = 'it';

  // Testi tradotti per il multilingua automatico
  final Map<String, Map<String, String>> _testi = {
    'it': {
      'titolo': 'Inserisci Username',
      'bottone': 'Gioca',
      'errore': 'Username troppo corto',
    },
    'en': {
      'titolo': 'Enter Username',
      'bottone': 'Play',
      'errore': 'Username too short',
    }
  };

  @override
  void initState() {
    super.initState();
    _controllaUtenteEsistente();
  }

  void _controllaUtenteEsistente() async {
    final prefs = await SharedPreferences.getInstance();
    final salvato = prefs.getString('username') ?? '';
    if (salvato.isNotEmpty) {
      _avviaGioco(salvato);
    }
  }

  void _avviaGioco(String username) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('username', username);
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => SchermataMappa(username: username, lingua: _lingua)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                DropdownButton<String>(
                  value: _lingua,
                  items: const [
                    DropdownMenuItem(value: 'it', child: Text('🇮🇹 IT')),
                    DropdownMenuItem(value: 'en', child: Text('🇬🇧 EN')),
                  ],
                  onChanged: (val) => setState(() => _lingua = val!),
                )
              ],
            ),
            const Text('🟩 PIXEL CONQUEST 🟥', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
            const SizedBox(height: 40),
            TextField(
              controller: _usernameController,
              decoration: InputDecoration(
                labelText: _testi[_lingua]!['titolo'],
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () {
                if (_usernameController.text.trim().length > 2) {
                  _avviaGioco(_usernameController.text.trim());
                } else {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(_testi[_lingua]!['errore']!)),
                  );
                }
              },
              child: Text(_testi[_lingua]!['bottone']!),
            )
          ],
        ),
      ),
    );
  }
}

// --- 2. SCHERMATA MAPPA E GPS OTTIMIZZATO ---
class SchermataMappa extends StatefulWidget {
  final String username;
  final String lingua;
  const SchermataMappa({super.key, required this.username, required this.lingua});

  @override
  State<SchermataMappa> createState() => _SchermataMappaState();
}

class _SchermataMappaState extends State<SchermataMappa> {
  late IO.Socket _socket;
  String _statusGps = "Caricamento GPS...";
  List<String> _leaderboard = [];
  double _lat = 0.0;
  double _lng = 0.0;

  @override
  void initState() {
    super.initState();
    _connettiAlServer();
    _inizializzaGpsRapido();
  }

  void _connettiAlServer() {
    // Nota: 'localhost' funziona per i test locali su PC. Per l'app reale andrà messo l'IP pubblico del server.
    _socket = IO.io('http://localhost:3000', IO.OptionBuilder().setTransports(['websocket']).build());

    _socket.onConnect((_) {
      _socket.emit('join_server', {
        'username': widget.username,
        'serverId': 'Europe_Main_1'
      });
    });

    _socket.on('update_leaderboard', (data) {
      if (!mounted) return;
      final map = data as Map<String, dynamic>;
      List<String> tempBoard = [];
      map.forEach((key, value) => tempBoard.add("$key: $value Px"));
      setState(() => _leaderboard = tempBoard);
    });
  }

  // OTTIMIZZAZIONE GPS: Evita i caricamenti infiniti
  void _inizializzaGpsRapido() async {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return;

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) return;
    }

    // Carica subito l'ultima posizione conosciuta (risolve l'attesa iniziale a schermo bianco)
    Position? lastPos = await Geolocator.getLastKnownPosition();
    if (lastPos != null) {
      _aggiornaPosizioneLocale(lastPos);
    }

    // Si attiva ad alta precisione solo se il telefono si sposta fisicamente di 5 metri
    Geolocator.getPositionStream(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 5)
    ).listen((Position position) {
      _aggiornaPosizioneLocale(position);
      _socket.emit('move_gps', {'lat': position.latitude, 'lng': position.longitude});
    });
  }

  void _aggiornaPosizioneLocale(Position pos) {
    if (!mounted) return;
    setState(() {
      _lat = pos.latitude;
      _lng = pos.longitude;
      _statusGps = "Lat: ${_lat.toStringAsFixed(5)} | Lng: ${_lng.toStringAsFixed(5)}";
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text("Player: ${widget.username}")),
      body: Stack(
        children: [
          // MAPPA DEL MONDO PIXELATA (Generata matematicamente)
          Center(
            child: Container(
              color: Colors.blueGrey[900],
              child: CustomPaint(
                painter: PixelMapPainter(lat: _lat, lng: _lng),
                child: Container(),
              ),
            ),
          ),
          // Coordinate e Stato GPS in basso
          Positioned(
            bottom: 20,
            left: 20,
            right: 20,
            child: Container(
              padding: const EdgeInsets.all(12),
              color: Colors.black87,
              child: Text(_statusGps, textAlign: TextAlign.center, style: const TextStyle(color: Colors.greenAccent)),
            ),
          ),
          // Classifica Server in tempo reale
          Positioned(
            top: 20,
            right: 20,
            child: Container(
              width: 180,
              padding: const EdgeInsets.all(10),
              color: Colors.black54,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(widget.lingua == 'it' ? "🏆 CLASSIFICA" : "🏆 LEADERBOARD", style: const TextStyle(fontWeight: FontWeight.bold)),
                  const Divider(color: Colors.white),
                  ..._leaderboard.map((player) => Text(player, style: const TextStyle(fontSize: 12))).toList(),
                ],
              ),
            ),
          )
        ],
      ),
    );
  }

  @override
  void dispose() {
    _socket.dispose();
    super.dispose();
  }
}

// --- 3. MOTORE GRAFICO MAPPA INFELTRITA/PIXELATA ---
class PixelMapPainter extends CustomPainter {
  final double lat;
  final double lng;
  PixelMapPainter({required this.lat, required this.lng});

  @override
  void paint(Canvas canvas, Size size) {
    final paintGriglia = Paint()..color = Colors.white10..style = PaintingStyle.stroke..strokeWidth = 1.0;
    final paintGiocatore = Paint()..color = Colors.redAccent..style = PaintingStyle.fill;

    double pixelSize = 40.0; // Dimensione del pixel grafico
    
    // Disegna la griglia infinita del mondo
    for (double x = 0; x < size.width; x += pixelSize) {
      for (double y = 0; y < size.height; y += pixelSize) {
        canvas.drawRect(Rect.fromLTWH(x, y, pixelSize, pixelSize), paintGriglia);
      }
    }

    // Disegna il punto rosso del giocatore fisso al centro dello schermo
    if (lat != 0.0 && lng != 0.0) {
      canvas.drawCircle(Offset(size.width / 2, size.height / 2), 10, paintGiocatore);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}
