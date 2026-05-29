# Stockwaage

Bienenstockwaage auf Basis eines **ESP32-S3** mit Firebase-Backend.
Bis zu 8 Wägezellen (HX711), Umgebungssensorik (BME280), Strom-/
Spannungsmessung von Akku und Solar (2× INA219) sowie optionaler
Regensensor. Web-UI in Next.js, Daten in Firestore, akku-/solar-tauglich
dank Deep Sleep. Firmware-Updates laufen per OTA über GitHub Releases.

## Architektur

```
ESP32-S3-WROOM-1 N16R8        Firebase (Spark Free)        Browser
──────────────────────        ─────────────────────        ───────
8× HX711  ─┐                                                Next.js UI
BME280    ─┤                                                (statisch
INA219 ×2 ─┼─► Firmware ──► Firestore ──► onSnapshot ──►   gehostet)
Regen-ADC ─┤   Wake → Read → Send → Sleep                   Dashboard /
Wake-Btn  ─┘                                                Waagen /
           └─ WiFiManager Captive Portal beim Erst-Setup    Einstellungen
                         ▲
        GitHub Releases ─┘  (OTA-Firmware, Auto-Update)
```

## Verzeichnisstruktur

- `firmware/stockwaage/` – ESP32-S3 Arduino-Sketch (Details: `firmware/README.md`)
- `web/` – Next.js Web-UI (statischer Export für Firebase Hosting)
- `firestore.rules` – Security Rules
- `firebase.json` – Firebase-Hosting + Firestore-Konfig
- `.github/workflows/` – CI: Hosting-Deploy + Firmware-Release

## Daten & Funktionen

- **Dashboard** – konfigurierbare Kacheln pro Waage (3-Tage-Tagesverlauf)
  sowie Außenklima, Akku, Solar und Regen (sofern Sensor aktiv).
- **Waagen** – pro Waage drei Charts: 24-h-Tagesverlauf (gestapelt),
  Tages-Änderung (Eintrag/Verlust), Langzeit (Ø/Min/Max). Dazu ein
  Logbuch (Kommentare) mit Markern im Langzeit-Chart.
- **Einstellungen** – Mess-Intervall, I²C-Pins, Sensor-Aktivierung +
  Adressen, Wake-Button, Firmware-Update.
- **Langzeit** – der ESP schreibt pro Tag ein Aggregat (`dailyStats`);
  der Graph liest 1 Dokument/Tag statt tausender Rohwerte.

## Setup

### 1. Firebase (bereits eingerichtet)
- Projekt: `stockwaage-132b6`, Region: europe-west3
- Owner-UID: `F1k284u9bmbJcOkEqt7O8BNOLN53`
- Login: `markus@strogg.de`
- Auth-Methode **E-Mail/Passwort** muss aktiv sein, der Owner-User angelegt.

### 2. Firestore Rules deployen (einmalig)
```bash
npm install -g firebase-tools
firebase login
firebase use stockwaage-132b6
firebase deploy --only firestore:rules
```

### 3. Web-UI lokal starten
```bash
cd web
npm install
npm run dev   # http://localhost:3000
```

### 4. Web-UI deployen
Automatisch per GitHub Action (`firebase-hosting-deploy.yml`) bei jedem
Push, der `web/` ändert → live auf **https://stockwaage-132b6.web.app**.

Manuell ginge auch:
```bash
cd web && npm run deploy
```

### 5. Firmware
Siehe `firmware/README.md` für Hardware-Verkabelung, Arduino-IDE-Setup
und OTA. Kurz:
- **Erst-Flash** per Kabel: die drei `.bin` aus dem neuesten
  [GitHub Release](https://github.com/markus629/Stockwaage/releases)
  flashen (`bootloader.bin`→`0x0`, `partitions.bin`→`0x8000`,
  `stockwaage-*.bin`→`0x10000`).
- **Erst-Setup**: ESP einschalten → WLAN `stockwaage-setup` verbinden →
  Heim-WLAN + Firebase-Passwort + Device-ID eingeben.
- **Updates** danach: über das UI (Einstellungen → Firmware) per OTA,
  kein Kabel mehr nötig.

## Continuous Integration

| Workflow | Trigger | Ergebnis |
| --- | --- | --- |
| `firebase-hosting-deploy.yml` | Push, der `web/` ändert | Next.js-Build → Firebase Hosting |
| `firmware-release.yml` | Push, der `firmware/` ändert | `arduino-cli`-Build → GitHub Release `v0.1.<build-nr>` mit `.bin`-Dateien |

## Status

- [x] Web-UI: Login, Dashboard, Waagen, Einstellungen
- [x] Firestore Rules
- [x] ESP32-S3-Firmware: WiFiManager, HX711, BME280, INA219 ×2, Regen
- [x] Kalibrierung + Temperaturkompensation (UI + Firmware)
- [x] Charts: 24 h, Tages-Änderung, Langzeit (Tagesaggregate)
- [x] Logbuch/Kommentare mit Markern im Langzeit-Chart
- [x] Konfigurierbare Pins + Add/Remove Waagen
- [x] Wake-Button (1× messen, 2× Messpause)
- [x] OTA-Firmware-Update über GitHub Releases (manuell + automatisch)
- [x] Mehrere Geräte (pro `deviceId`)
