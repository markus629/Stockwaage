# Stockwaage ESP32 Firmware

**1 ESP = 1 Beute:** ein HX711 (Wägezelle) + ein BMP280 (Temperatur) +
Akku-Messung. Der ESP wacht per Timer auf, misst, sendet an Firestore und
schläft wieder. Erst-Setup über Captive Portal (WiFiManager). Kalibrierung
und Temperaturkompensation kommen zur Laufzeit aus Firestore; die
Geräte­einstellungen sind **global** (`config/main`). Firmware-Updates per OTA
über GitHub Releases.

Entwickelt auf normalem ESP32(-S3); Ziel-Board **Seeed XIAO ESP32-C5**.
Board-Umschaltung über `BOARD_XIAO_C5` in `config.h` (oder Build-Flag
`-DBOARD_XIAO_C5=1`).

## Hardware (feste Pins, in `config.h`)

| Funktion | ESP32 / -S3 | XIAO ESP32-C5 |
| --- | --- | --- |
| HX711 DT (Daten) | GPIO 13 | GPIO 2 (A1) |
| HX711 SCK (Clock) | GPIO 4 | GPIO 3 (A2) |
| I²C SDA (BMP280) | GPIO 8 | GPIO 23 (D4) |
| I²C SCL (BMP280) | GPIO 9 | GPIO 24 (D5) |
| Akku-ADC | GPIO 1 | GPIO 1 (A0) |
| BOOT-Taster (Portal) | GPIO 0 | GPIO 28 |

- **BMP280** auf I²C-Adresse `0x76` (`0x77` falls SDO am Modul auf VCC).
- **Akku** über Spannungsteiler 100k/100k an den ADC (`VBAT_DIVIDER = 2.0`).
- **SCK** sollte RTC-/LP-fähig sein (ESP32-S3: GPIO ≤ 21, C5: LP-GPIO), damit
  der HX711 im Deep Sleep zuverlässig im `power_down` gehalten wird.
- Pins ggf. an die eigene Verkabelung anpassen.

## Arduino IDE 2.x einrichten

1. **Boardverwalter:** `esp32 by Espressif Systems`.
   - Normaler ESP: **ESP32S3 Dev Module**, Flash 16MB, PSRAM OPI.
   - XIAO C5: das passende Seeed-Board wählen + `BOARD_XIAO_C5 1` in
     `config.h` setzen.
   - Partition Scheme: die mitgelieferte `partitions.csv` (zwei 3-MB-App-Slots
     für OTA + FATFS) wird automatisch genutzt.
2. **Bibliotheken:**
   - `WiFiManager` (tzapu)
   - `HX711 Arduino Library` (Bogdan Necula)
   - `ArduinoJson` (Benoit Blanchon)
   - `Adafruit BMP280 Library` (+ `Adafruit Unified Sensor`)
3. **Sketch:** `firmware/stockwaage/stockwaage.ino` öffnen; die übrigen Tabs
   (`config.h`, `firebase.*`, `sensors.*`, `runtime_config.*`, `commands.*`,
   `updater.*`, `daily_stats.*`) lädt die IDE mit.

## Build & Release (CI)

Push, der `firmware/` ändert → GitHub Action `firmware-release.yml` baut mit
`arduino-cli` (ESP32-S3) und veröffentlicht ein Release `v0.1.<build-nr>` mit
`bootloader.bin`, `partitions.bin`, `stockwaage-<version>.bin`. Der
Versions-String kommt aus einem generierten `fw_version.h` (lokale Builds ohne
diese Datei zeigen `dev`).

**Erst-Flash / Recovery** per Kabel (Web-Flasher oder esptool):
`bootloader.bin`→`0x0`, `partitions.bin`→`0x8000`,
`stockwaage-<version>.bin`→`0x10000`.

## Erstinbetriebnahme

1. ESP einschalten → WLAN-AP `stockwaage-setup`.
2. Verbinden → Captive Portal → *Configure WiFi*.
3. Custom-Felder: **Firebase-Passwort**, **Device-ID** (pro ESP eindeutig,
   z. B. `beute-01`), **Intervall (Sek.)** (Default 900).
4. *Save* → ESP verbindet und schreibt die erste Messung.

**Portal später erzwingen:** BOOT-Taster beim Reset/Wakeup gedrückt halten.

## OTA-Update

Der ESP prüft ~1×/Tag das neueste GitHub Release und schreibt
`firmwareVersion` / `latestFirmwareVersion` in sein Geräte-Dokument. Im UI
(Einstellungen → Firmware-Liste): „aktualisieren" je ESP oder „Alle
aktualisieren". Mit `autoUpdateEnabled` (global) zieht jeder ESP neue
Releases selbst.

## Deep Sleep & Wachbetrieb

- **Deep Sleep an** (global, Default): messen → schlafen bis Intervall. Vor
  dem Schlafen `power_down` von HX711 (+ SCK-Pin-Hold).
- **Deep Sleep aus:** der ESP bleibt wach, übernimmt Einstellungen/Updates
  sofort, schreibt alle ~5 s das Live-Gewicht (`live/current`) und misst
  weiter im Intervall. Praktisch zum Kalibrieren/Testen.

## Datenmodell (Firestore)

```
users/{ownerUid}/
  config/main                         # GLOBAL: intervalSec, deepSleepEnabled,
                                      #         autoUpdateEnabled, feedStepThresholdKg
  devices/{deviceId}
    (Dokument)  deviceId, lastSeen, vBat, intervalSec,
                firmwareVersion, latestFirmwareVersion, latestFirmwareUrl
    scales/s1   name, offset, scaleFactor, tempCoef, tempRefC   (+ UI: learning, feed*)
    readings/{ts}   ts, vBat, ambientC, scales:{ s1:{ raw, kg? } }, expireAt
    dailyStats/{YYYY-MM-DD}   date, scales:{ s1:{sum,count,min,max,last} }, tempC:{…}
    live/current    ts, vBat, scales:{ s1:{ raw, kg? } }   (nur im Wachbetrieb)
    comments/{id}   scaleId, text, ts, createdAt
    commands/{id}   type, scaleId?, payload, status, …
```

## Kalibrierungs-Mathematik

```
ambientC = BMP280-Temperatur
raw      = HX711.read_average(5)
kg       = (raw - offset - tempComp) / scaleFactor
tempComp = (tempCoef != 0 && tempC bekannt) ? tempCoef * (ambientC - tempRefC) : 0
```

- `offset` = Tare (raw bei 0 kg), `scaleFactor` = (raw_belastet − offset)/known_kg
- `tempCoef`/`tempRefC` = Steigung & Mitteltemperatur aus der Lernphase
- `kg` nur wenn `scaleFactor != 0`; **raw wird immer geschrieben**
  (Re-Kalibrierung jederzeit möglich).

## Commands

Der ESP arbeitet pending `commands` bei jedem Wakeup **vor** der Messung ab
(`tare`, `calibrate`, `setTempCoef`, `stayAwake`, `reload`, `update`). Das UI
schreibt `status:"pending"`, der ESP liefert `done`/`error` zurück.
`stayAwake` hält den ESP für `durationMs` wach (Kalibrier-Wizard);
`update` trägt die Release-URL im `payload.url`.

## Tages-Aggregate

Bei jedem Wakeup pflegt der ESP `dailyStats/{YYYY-MM-DD}` per
Read-modify-write fort (sum/count/min/max/last je Waage + Temperatur,
lokaler Tages-Key). So liest der Langzeit-Graph nur ein Dokument pro Tag.
