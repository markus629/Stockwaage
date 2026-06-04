# Stockwaage

Bienenstockwaagen mit Firebase-Backend nach dem Prinzip **1 ESP = 1 Beute**:
jede Waage hat einen eigenen kleinen ESP mit **HX711** (Wägezelle),
**BMP280** (Temperatur) und Akku-Messung. Alle ESPs schreiben in dasselbe
Firebase-Projekt. Web-UI in Next.js, Daten in Firestore, akku-/solar-tauglich
dank Deep Sleep, Firmware-Updates per OTA über GitHub Releases.

Entwickelt wird auf einem normalen ESP32(-S3); Ziel-Hardware ist der
**Seeed XIAO ESP32-C5** (Board-Umschaltung in `config.h`).

## Architektur

```
pro Beute: 1 ESP                Firebase (Spark Free)        Browser
────────────────                ─────────────────────        ───────
HX711  ─┐                                                     Next.js UI
BMP280 ─┼─► Firmware ──► Firestore ──► onSnapshot ──►        (statisch
Akku-ADC┘   Wake → Read → Send → Sleep                        gehostet)
            WiFiManager-Portal beim Erst-Setup                Dashboard /
                       ▲                                       Einstellungen
      GitHub Releases ─┘  (OTA, Auto-Update)
```

Gesendet wird pro Messung: **Gewicht (kg + roh)**, **Temperatur**,
**Akkuspannung**.

## Verzeichnisstruktur

- `firmware/stockwaage/` – Arduino-Sketch (Details: `firmware/README.md`)
- `web/` – Next.js Web-UI (statischer Export für Firebase Hosting)
- `firestore.rules` – Security Rules
- `firebase.json` – Firebase-Hosting + Firestore-Konfig
- `.github/workflows/` – CI: Hosting-Deploy + Firmware-Release

## Web-UI

Eine Seite mit zwei Tabs:

- **Dashboard** – jede Beute als **Kachel** (aktuelles Gewicht, Temperatur,
  Akku, Online-Punkt). Klick auf eine Kachel öffnet ein **Floating-Window**
  mit der Detailansicht der Waage:
  - **Kalibrierung** (Tare, Kalibrieren) + **Temperatur-Lernphase**
  - **Charts**: 24-h-Tagesverlauf (gestapelt), Tages-Änderung, Langzeit
  - **Futter-Tracker** (Baseline → Restmenge → Reichweite)
  - **Logbuch** (Kommentare, Marker im Langzeit-Chart)
- **Einstellungen** – **global für alle ESPs**: Mess-Intervall, Deep Sleep,
  Auto-Update, Futter-Tracker-Schwelle. Dazu die **Firmware-Liste**: neueste
  Version auf GitHub + alle ESPs mit installierter Version und
  „aktualisieren" / „Alle aktualisieren".

**Globale vs. individuelle Einstellungen:** Alles unter „Einstellungen" gilt
für alle ESPs (ein Dokument `config/main`). Pro Waage individuell ist nur die
**Kalibrierung** (im Detail-Window).

## Datenmodell (Firestore)

```
users/{uid}/
  config/main                         globale Einstellungen (alle ESPs)
  devices/{deviceId}/
    (Dokument)                        Heartbeat: lastSeen, vBat, firmwareVersion …
    scales/s1                         Kalibrierung der Waage (offset/factor/tempCoef …)
    readings/{tsMs}                   Rohmesswerte (ts, vBat, ambientC, scales.s1) + expireAt (TTL)
    dailyStats/{YYYY-MM-DD}           Tages-Aggregate (für Langzeit/Futter)
    live/current                      Live-Gewicht (nur im Wachbetrieb, alle ~5 s überschrieben)
    commands/{id}                     UI → ESP (tare, calibrate, setTempCoef, update, stayAwake)
    comments/{id}                     Logbuch
```

## Free-Plan-Sparmaßnahmen (Reads/Writes)

- `readings` bekommen ein `expireAt`-Feld; eine Firestore-**TTL-Policy** löscht
  sie nach 60 Tagen. Langzeitdaten leben in `dailyStats`. → einmalig einrichten.
- Das UI lädt Roh-/Tagesdaten **lazy** (per `getDocs`, kein Dauer-Listener);
  Detaildaten erst beim Öffnen des Floating-Windows.
- Eingabefelder schreiben gedebounced / onBlur statt pro Tastendruck.
- Die Firmware prüft GitHub-Releases nur **1×/Tag** und legt HX711/Sensoren
  vor dem Deep Sleep schlafen (`power_down`).

## Setup

### 1. Firebase
- Projekt: `stockwaage-132b6`, Region: europe-west3, Owner-UID
  `F1k284u9bmbJcOkEqt7O8BNOLN53`, Login `markus@strogg.de`.
- Auth-Methode **E-Mail/Passwort** aktiv, Owner-User angelegt.

### 2. Firestore Rules deployen (einmalig)
```bash
npm install -g firebase-tools
firebase login
firebase use stockwaage-132b6
firebase deploy --only firestore:rules
```

### 3. TTL-Policy für `readings` (einmalig)
```bash
gcloud firestore fields ttls update expireAt \
  --collection-group=readings --enable-ttl --project=stockwaage-132b6
```
Alternativ in der Firebase Console → Firestore → TTL. Die Firmware schreibt
`expireAt` bereits (Standard 60 Tage, `READINGS_TTL_DAYS` in `config.h`).

### 4. Web-UI
```bash
cd web && npm install && npm run dev   # http://localhost:3000
```
Deploy automatisch per GitHub Action (`firebase-hosting-deploy.yml`) bei jedem
Push, der `web/` ändert → live auf **https://stockwaage-132b6.web.app**.

### 5. Firmware
Details in `firmware/README.md`. Kurz:
- **Board wählen** in `firmware/stockwaage/config.h` (`BOARD_XIAO_C5` = 0 für
  normalen ESP32(-S3), 1 für XIAO ESP32-C5) bzw. Verkabelung anpassen.
- **Erst-Flash** per Kabel: die drei `.bin` aus dem neuesten
  [GitHub Release](https://github.com/markus629/Stockwaage/releases)
  flashen (`bootloader.bin`→`0x0`, `partitions.bin`→`0x8000`,
  `stockwaage-*.bin`→`0x10000`).
- **Erst-Setup**: ESP einschalten → WLAN `stockwaage-setup` verbinden →
  Heim-WLAN + Firebase-Passwort + **Device-ID** eingeben (pro ESP eindeutig!).
- **Updates** danach per OTA über die Firmware-Liste in den Einstellungen.

## Continuous Integration

| Workflow | Trigger | Ergebnis |
| --- | --- | --- |
| `firebase-hosting-deploy.yml` | Push, der `web/` ändert | Next.js-Build → Firebase Hosting |
| `firmware-release.yml` | Push, der `firmware/` ändert | `arduino-cli`-Build (ESP32-S3) → GitHub Release `v0.1.<build-nr>` mit `.bin` |

## Status

- [x] 1 ESP = 1 Beute: HX711 + BMP280 + Akku, feste Pins (C5 / ESP32-S3)
- [x] Kalibrierung + Temperaturkompensation (Lernphase)
- [x] Dashboard (Kacheln) + Detail-Floating-Window (Charts, Futter, Logbuch)
- [x] Globale Einstellungen + Firmware-Flotten-Übersicht
- [x] Deep Sleep + Sensor-Power-Down, Wachbetrieb mit 5-s-Live-Gewicht
- [x] OTA-Updates über GitHub Releases (manuell + automatisch)
- [x] Free-Plan-Sparmaßnahmen: TTL, lazy Laden, Debounce, 1×/Tag Update-Check

### Später / Ideen
- [ ] Schwarm-Alarm wieder anzeigen (Logik war entfernt worden)
- [ ] Geräteübergreifende Auswertungen
