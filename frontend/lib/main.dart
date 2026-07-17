import 'dart:async';
import 'dart:math' as math;
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

class SchermataIniziale extends StatefulWidget {
  const SchermataIniziale({super.key});
  @override
  State<SchermataIniziale> createState() => _SchermataInizialeState();
}

class _SchermataInizialeState extends State<SchermataIniziale> {
  final TextEditingController _usernameController = TextEditingController();
  String _lingua = 'it';
  String _clanScelto = 'ROSSI'; // Corretto il refuso clanSceltto

  final Map<String, Map<String, String>> _testi = {
    'it': {'titolo': 'Username', 'bottone': 'Gioca', 'errore': 'Username troppo corto'},
    'en': {'titolo': 'Username', 'bottone': 'Play', 'errore': 'Username too short'}
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
      MaterialPageRoute(builder: (_) => SchermataMappa(username: username, lingua: _lingua, clan: _clanScelto)),
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
            const Text('🟩 PIXEL ARMY CONQUEST 🟥', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
            const SizedBox(height: 30),
            TextField(controller: _usernameController, decoration: InputDecoration(labelText: _testi[_lingua]!['titolo'], border: const OutlineInputBorder())),
            const SizedBox(height: 16),
            DropdownButton<String>(
              value: _clanScelto,
              items: const [
                DropdownMenuItem(value: 'ROSSI', child: Text('🔴 Clan Rossi')),
                DropdownMenuItem(value: 'BLU', child: Text('🔵 Clan Blu')),
                DropdownMenuItem(value: 'VERDI', child: Text('🟢 Clan Verdi')),
              ],
              onChanged: (val) => setState(() => _clanScelto = val!),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () { if (_usernameController.text.trim().length > 2) _avviaGioco(_usernameController.text.trim()); },
              child: Text(_testi[_lingua]!['bottone']!),
            )
          ],
        ),
      ),
    );
  }
}
class SchermataMappa extends StatefulWidget {
  final String username; final String lingua; final String clan;
  const SchermataMappa({super.key, required this.username, required this.lingua, required this.clan});
  @override
  State<SchermataMappa> createState() => _SchermataMappaState();
}

class _SchermataMappaState extends State<SchermataMappa> with SingleTickerProviderStateMixin {
  late IO.Socket _socket;
  String _statusGps = "Caricamento...";
  List<String> _leaderboard = [];
  double _lat = 0.0; double _lng = 0.0;
  StreamSubscription<Position>? _gpsStream;
  int _numeroTruppe = 0; 
  final Map<String, Map<String, dynamic>> _mappaDatiPixel = {};
  late AnimationController _animationController;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(vsync: this, duration: const Duration(seconds: 4))..repeat();
    _connettiAlServer();
    _inizializzaGpsRapido();
  }

  void _connettiAlServer() {
    _socket = IO.io('http://localhost:3000', IO.OptionBuilder().setTransports(['websocket']).build());
    _socket.connect();
    _socket.onConnect((_) {
      _socket.emit('join_server', {'username': widget.username, 'serverId': 'Europe_Main_1', 'lingua': widget.lingua, 'clanName': widget.clan});
    });

    _socket.on('update_leaderboard', (data) {
      if (!mounted) return;
      final map = data as Map<String, dynamic>;
      List<String> tempBoard = [];
      map.forEach((key, value) => tempBoard.add("Clan $key: $value Px"));
      setState(() => _leaderboard = tempBoard);
    });

    _socket.on('update_truppe', (quantita) {
      if (!mounted) return;
      setState(() => _numeroTruppe = quantita);
    });

    _socket.on('pixel_conquered', (data) {
      if (!mounted) return;
      setState(() {
        _mappaDatiPixel[data['pixelId']] = {
          'color': data['color'],
          'hasDefense': data['hasDefense'] ?? false
        }; 
      });
    });

    _socket.on('game_error', (msg) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: Colors.amber, duration: const Duration(seconds: 2)));
    });
  }

  void _inizializzaGpsRapido() async {
    await Geolocator.requestPermission();
    _gpsStream = Geolocator.getPositionStream(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 5)).listen((position) {
      if (!mounted) return;
      setState(() {
        _lat = position.latitude; _lng = position.longitude;
        _statusGps = "Lat: ${_lat.toStringAsFixed(4)} | Lng: ${_lng.toStringAsFixed(4)}";
      });
      _socket.emit('move_gps', {'lat': position.latitude, 'lng': position.longitude, 'is_mocked': position.isMocked});
    });
  }

  void _piazzaTorrettaDifensiva() {
    _socket.emit('costruisci_difesa', {'lat': _lat, 'lng': _lng});
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text("${widget.username} [${widget.clan}]")),
      body: Stack(
        children: [
          Center(
            child: AnimatedBuilder(
              animation: _animationController,
              builder: (context, child) {
                return CustomPaint(
                  painter: PixelMapPainter(
                    lat: _lat, lng: _lng, datiPixel: _mappaDatiPixel, quantitaTruppe: _numeroTruppe, animValue: _animationController.value
                  ),
                  child: Container(),
                );
              }
            ),
          ),
          Positioned(
            top: 20, left: 20,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(20)),
                  child: Row(
                    children: [
                      const Icon(Icons.groups, color: Colors.cyanAccent),
                      const SizedBox(width: 8),
                      Text("MINIESERCITO: $_numeroTruppe Minion", style: const TextStyle(fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                ElevatedButton.icon(
                  onPressed: _piazzaTorrettaDifensiva,
                  icon: const Icon(Icons.fort),
                  label: const Text("PIAZZA TORRETTA (-20)", style: TextStyle(fontWeight: FontWeight.bold)),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.amber, foregroundColor: Colors.white),
                )
              ],
            ),
          ),
          Positioned(bottom: 20, left: 20, right: 20, child: Container(padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(8)), child: Text(_statusGps, textAlign: TextAlign.center, style: const TextStyle(color: Colors.greenAccent)))),
          Positioned(
            top: 20, right: 20,
            child: Container(width: 180, padding: const EdgeInsets.all(10), decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(8)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              const Text("🏆 CLASSIFICA CLAN", style: TextStyle(fontWeight: FontWeight.bold)),
              const Divider(),
              ..._leaderboard.map((item) => Text(item, style: const TextStyle(fontSize: 12, color: Colors.yellowAccent))),
            ])),
          )
        ],
      ),
    );
  }

  @override
  void dispose() { _gpsStream?.cancel(); _socket.dispose(); _animationController.dispose(); super.dispose(); }
}

class PixelMapPainter extends CustomPainter {
  final double lat; final double lng; 
  final Map<String, Map<String, dynamic>> datiPixel;
  final int quantitaTruppe; final double animValue;
  PixelMapPainter({required this.lat, required this.lng, required this.datiPixel, required this.quantitaTruppe, required this.animValue});

  @override
  void paint(Canvas canvas, Size size) {
    final paintGrid = Paint()..color = Colors.white10..style = PaintingStyle.stroke;
    const double cellSize = 25.0;
    double centerX = size.width / 2; double centerY = size.height / 2;

    for (double x = 0; x < size.width; x += cellSize) { canvas.drawLine(Offset(x, 0), Offset(x, size.height), paintGrid); }
    for (double y = 0; y < size.height; y += cellSize) { canvas.drawLine(Offset(0, y), Offset(size.width, y), paintGrid); }

    datiPixel.forEach((id, dati) {
      final paintClan = Paint()..color = Color(int.parse(dati['color'].replaceAll('#', '0xFF'))).withOpacity(0.4)..style = PaintingStyle.fill;
      Offset posizioneCellaSimulata = Offset(size.width/2 + 50, size.height/2 - 50);
      canvas.drawRect(Rect.fromCenter(center: posizioneCellaSimulata, width: cellSize-2, height: cellSize-2), paintClan);

      if (dati['hasDefense'] == true) {
        final paintTorretta = Paint()..color = Colors.amber..style = PaintingStyle.stroke..strokeWidth = 3.0;
        canvas.drawCircle(posizioneCellaSimulata, cellSize / 3, paintTorretta);
      }
    });

    canvas.drawRect(Rect.fromCenter(center: Offset(centerX, centerY), width: cellSize - 4, height: cellSize - 4), Paint()..color = Colors.greenAccent);

    int minionDaDisegnare = math.min((quantitaTruppe / 5).ceil(), 8);
    final paintMinion = Paint()..color = Colors.cyanAccent..style = PaintingStyle.fill;

    for (int i = 0; i < minionDaDisegnare; i++) {
      double angolo = (i * (2 * math.pi) / minionDaDisegnare) + (animValue * 2 * math.pi);
      double raggioOrbita = 22.0;
      double minionX = centerX + raggioOrbita * math.cos(angolo);
      double minionY = centerY + raggioOrbita * math.sin(angolo);
      canvas.drawRect(Rect.fromCenter(center: Offset(minionX, minionY), width: 5, height: 5), paintMinion);
    }
  }
  @override bool shouldRepaint(covariant PixelMapPainter oldDelegate) => true;
}
