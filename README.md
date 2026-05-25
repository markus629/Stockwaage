# Stockwaage

Bienenstockwaage mit Raspberry Pi (HX711 + DS18B20) und Firebase-Backend.
Web-UI in Next.js, Daten in Firestore, Multi-Pi-fähig.

## Architektur

```
Raspberry Pi              Firebase (Spark Free)        Browser
─────────────             ─────────────────────        ───────
HX711 × N      ─┐                                      Next.js UI
DS18B20 × N    ─┼─► main.py ──► Firestore ──► onSnapshot ─► Live Dashboard
                 │              ▲                              │
                 │ Listener ◄───┘ config + commands ◄──────────┘
                 │
                 └─ SQLite Offline-Puffer
```

## Verzeichnisstruktur

- `pi/` – Python-Service für den Raspberry Pi
- `web/` – Next.js Web-UI
- `firestore.rules` – Security Rules
- `firebase.json` – Firebase-Projekt-Konfig

## Setup (einmalig)

### 1. Firebase-Projekt (bereits eingerichtet)
- Projekt: `stockwaage-132b6`
- Owner: `markus@strogg.de` (UID in `firestore.rules` und `web/lib/firebase.ts` hinterlegt)
- Firestore-Region: europe-west3

### 2. Firestore Rules deployen
Einmalig:
```bash
npm install -g firebase-tools
firebase login
firebase use stockwaage-132b6
firebase deploy --only firestore:rules
```

### 3. Web-UI lokal
```bash
cd web
npm install
npm run dev
# → http://localhost:3000, Login mit markus@strogg.de
```

### 4. Pi-Service lokal testen (ohne echte Hardware)
```bash
cd pi
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp config.example.json config.local.json
# In config.local.json das Firebase-Passwort eintragen
python main.py --mock
```

## Status

- [x] Repo-Skelett
- [ ] Pi schreibt Dummy-Werte → Firestore
- [ ] Web-UI zeigt Live-Werte
- [ ] HX711-Integration
- [ ] Konfig-UI + Live-Reload
- [ ] Kalibrier-Wizard
- [ ] DS18B20
- [ ] Charts
- [ ] Multi-Pi-Test
