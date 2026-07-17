import 'dart:async';
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
  String _clanScelto = 'ROSSI'; 

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
            const Text('🟩 PIXEL CONQUEST (CLAN) 🟥', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
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
              onPressed: () {
                if (_usernameController.text.trim().length > 2) _avviaGioco(_usernameController.text.trim());
              },
              child: Text(_testi[_lingua]!['bottone']!),
            )
          ],
        ),
      ),
    );
  }
}

class SchermataMappa extends StatefulWidget {
  final String username;
  final String lingua;
  final String clan;
  const SchermataMappa({super.key, required this.username, required this.lingua, required this.clan});
  @override
  State<SchermataMappa> createState() => _SchermataMappaState();
}

class _SchermataMappaState extends State<SchermataMappa> {
  late IO.Socket _socket;
  String _statusGps = "Caricamento...";
  List<String> _leaderboard = [];
  double _lat = 0.0;
  double _lng = 0.0;
  StreamSubscription<Position>? _gpsStream;
  final Map<String, String> _mappaColoriPixel = {}; 

  @override
  void initState() {
    super.initState();
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

    _socket.on('pixel_conquered', (data) {
      if (!mounted) return;
      setState(() {
        _mappaColoriPixel[data['pixelId']] = data['color']; 
      });
    });

    _socket.on('game_error', (msg) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: Colors.amber));
    });
  }

  void _inizializzaGpsRapido() async {
    await Geolocator.requestPermission();
    _gpsStream = Geolocator.getPositionStream(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 5)).listen((position) {
      if (!mounted) return;
      setState(() {
        _lat = position.latitude;
        _lng = position.longitude;
        _statusGps = "Lat: ${_lat.toStringAsFixed(4)} | Lng: ${_lng.toStringAsFixed(4)}";
      });
      _socket.emit('move_gps', {'lat': position.latitude, 'lng': position.longitude, 'is_mocked': position.isMocked});
    });
  }

  // 💰 LOGICA MONETIZZAZIONE AD-REWARDED
  void _attivaScudoMonetizzato() {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Caricamento pubblicità... Scudo in attivazione!')));
    _socket.emit('compra_scudo_pixel', {'pixelId': 'cella_corrente_simulata'}); 
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text("${widget.username} (${widget.clan})")),
      body: Stack(
        children: [
          Center(child: CustomPaint(painter: PixelMapPainter(lat: _lat, lng: _lng, coloriPixel: _mappaColoriPixel), child: Container())),
          Positioned(
            top: 20, left: 20,
            child: FloatingActionButton.extended(
              onPressed: _attivaScudoMonetizzato,
              icon: const Icon(Icons.shield, color: Colors.black),
              backgroundColor: Colors.amberAccent,
              label: const Text("ATTIVA SCUDO (Ads)", style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
            ),
          ),
          Positioned(bottom: 20, left: 20, right: 20, child: Container(padding: const EdgeInsets.all(12), color: Colors.black87, child: Text(_statusGps, textAlign: TextAlign.center, style: const TextStyle(color: Colors.greenAccent)))),
          Positioned(
            top: 20, right: 20,
            child: Container(width: 180, padding: const EdgeInsets.all(10), color: Colors.black87, child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
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
  void dispose() { _gpsStream?.cancel(); _socket.dispose(); super.dispose(); }
}

class PixelMapPainter extends CustomPainter {
  final double lat; final double lng; final Map<String, String> coloriPixel;
  PixelMapPainter({required this.lat, required this.lng, required this.coloriPixel});

  @override
  void paint(Canvas canvas, Size size) {
    final paintGrid = Paint()..color = Colors.white10..style = PaintingStyle.stroke;
    const double cellSize = 25.0;
    for (double x = 0; x < size.width; x += cellSize) { canvas.drawLine(Offset(x, 0), Offset(x, size.height), paintGrid); }
    for (double y = 0; y < size.height; y += cellSize) { canvas.drawLine(Offset(0, y), Offset(size.width, y), paintGrid); }

    coloriPixel.forEach((id, hexColor) {
      final paintClan = Paint()..color = Color(int.parse(hexColor.replaceAll('#', '0xFF')))..style = PaintingStyle.fill;
      canvas.drawRect(Rect.fromCenter(center: Offset(size.width/2 + 50, size.height/2), width: cellSize-2, height: cellSize-2), paintClan);
    });

    canvas.drawRect(Rect.fromCenter(center: Offset(size.width / 2, size.height / 2), width: cellSize - 4, height: cellSize - 4), Paint()..color = Colors.greenAccent);
  }
  @override bool shouldRepaint(covariant PixelMapPainter oldDelegate) => true;
}
