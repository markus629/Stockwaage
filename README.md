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

### 1. Firebase-Projekt anlegen
1. https://console.firebase.google.com → neues Projekt `stockwaage`
2. **Authentication** aktivieren → Email/Password
3. User anlegen: deine Mail + ein Pi-User (`pi@stockwaage.local`)
4. **Firestore** aktivieren (Region: `europe-west3`, Modus: production)
5. Web-App registrieren → Config kopieren nach `web/.env.local`
6. Pi-Auth: Pi nutzt Email/Password – Zugangsdaten in `pi/config.local.json`

### 2. Web-UI lokal
```bash
cd web
npm install
cp .env.example .env.local   # Firebase-Config eintragen
npm run dev
```

### 3. Pi-Service lokal testen (ohne echte Hardware)
```bash
cd pi
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp config.example.json config.local.json   # Zugangsdaten eintragen
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
