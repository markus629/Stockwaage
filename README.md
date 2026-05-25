# Stockwaage

Bienenstockwaage mit ESP32 (HX711 + DS18B20) und Firebase-Backend.
Web-UI in Next.js, Daten in Firestore, Akku/Solar-tauglich dank Deep Sleep.

## Architektur

```
ESP32 WROOM-32                Firebase (Spark Free)        Browser
─────────────────             ─────────────────────        ───────
8x HX711  ─┐                                               Next.js UI
DS18B20 x─┼─► Firmware ──► Firestore ──► onSnapshot ─► Live Dashboard
VBat-ADC  │   Wake/Read/Send/Sleep
          │
          └─ WiFiManager Captive Portal beim Erst-Setup
```

## Verzeichnisstruktur

- `firmware/stockwaage/` – ESP32 Arduino-Sketch
- `web/` – Next.js Web-UI
- `firestore.rules` – Security Rules
- `firebase.json` – Firebase-Projekt-Konfig

## Setup

### 1. Firebase (bereits eingerichtet)
- Projekt: `stockwaage-132b6`, Region: europe-west3
- Owner-UID: `F1k284u9bmbJcOkEqt7O8BNOLN53`
- Login: `markus@strogg.de`

### 2. Firestore Rules deployen (einmalig)
```bash
npm install -g firebase-tools
firebase login
firebase use stockwaage-132b6
firebase deploy --only firestore:rules
```

### 3. Web-UI starten (lokal)
```bash
cd web
npm install
npm run dev   # http://localhost:3000
```

### 3b. Web-UI deployen (Firebase Hosting, gratis)
```bash
cd web
npm run deploy   # baut + deployt nach https://stockwaage-132b6.web.app
```
Erstmaliger Setup falls noch nicht passiert:
```bash
firebase use stockwaage-132b6   # einmalig
```

### 4. Firmware flashen
Siehe `firmware/README.md` für Hardware-Verkabelung und Arduino-IDE-Setup.
Erstinbetriebnahme: ESP einschalten → WLAN `stockwaage-setup` verbinden →
Heim-WLAN + Firebase-Passwort eingeben → fertig.

## Status

- [x] Repo-Skelett
- [x] Web-UI: Login + Geräte-Liste + Live-Werte
- [x] Firestore Rules
- [x] ESP32-Firmware: WiFiManager + HX711 + DS18B20 + Deep Sleep
- [ ] Erstes echtes Reading vom ESP empfangen
- [ ] Kalibrierung der Waagen (UI + Firmware-Reload)
- [ ] Charts (24h / 7d / Saison)
- [ ] Konfig-Reload aus Firestore (Intervall, Sensor-Mapping)
- [ ] Mehrere ESPs / Geräte
