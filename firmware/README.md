# Stockwaage ESP32-S3 Firmware

ESP32-S3-WROOM-1 **N16R8** (16 MB Flash, 8 MB Octal-PSRAM). Wake auf
Timer oder Taster, misst, sendet an Firestore, schläft. Erst-Setup über
Captive Portal (WiFiManager). Kalibrierung, Temperaturkompensation,
Pin-Belegung und Sensor-Aktivierung kommen zur Laufzeit aus Firestore.
Firmware-Updates per OTA über GitHub Releases.

## Hardware

| Funktion | Pin (Default) | Bemerkung |
| --- | --- | --- |
| HX711 SCK | GPIO 4 | gemeinsam für alle Waagen |
| HX711 DT 1..8 | 13, 14, 15, 16, 17, 18, 21, 38 | je eine Waage, pro Waage im UI änderbar |
| I²C SDA / SCL | GPIO 8 / 9 | gemeinsamer Bus für BME280 + beide INA219 |
| BME280 | I²C 0x76 | Temperatur, Luftfeuchte, Luftdruck |
| INA219 Akku | I²C 0x40 | Spannung + Strom Akku |
| INA219 Solar | I²C 0x41 | Spannung + Strom Solarpanel |
| Regensensor | GPIO 2 (ADC1) | analog, optional |
| Akku-ADC (Fallback) | GPIO 1 (ADC1) | Spannungsteiler 100k/100k |
| Wake-Button | GPIO 5 | 1× = messen, 2× = Messpause |
| BOOT-Taster | GPIO 0 | beim Reset gedrückt halten = Portal erzwingen |
| Onboard-NeoPixel | GPIO 48 | Status-Feedback (Pause-Bestätigung) |

Reservierte S3-Pins (nicht verwenden): 19/20 (USB), 26–32 (SPI-Flash),
33–37 (Octal-PSRAM), 43/44 (UART0), Strapping 0/3/45/46.

Build-Defaults in `stockwaage/config.h`, Laufzeit-Werte (Pins, Adressen,
Aktivierung) kommen aus Firestore und sind im Web-UI einstellbar.

## Arduino IDE 2.x einrichten

1. **Boardverwalter:** `esp32 by Espressif Systems` installieren.
   - Board: **ESP32S3 Dev Module**
   - Flash Size: **16MB (128Mb)**
   - PSRAM: **OPI PSRAM**
   - Partition Scheme: die mitgelieferte `partitions.csv` im
     Sketch-Ordner wird automatisch verwendet (zwei 3-MB-App-Slots für
     OTA + FATFS).

2. **Bibliotheken** (Werkzeuge → Bibliotheken verwalten):
   - `WiFiManager` (tzapu)
   - `HX711 Arduino Library` (Bogdan Necula)
   - `ArduinoJson` (Benoit Blanchon, v7)
   - `Adafruit BME280 Library` (+ `Adafruit Unified Sensor`)
   - `Adafruit INA219`
   - `Adafruit NeoPixel`

3. **Sketch öffnen:** `firmware/stockwaage/stockwaage.ino`. Die weiteren
   Dateien (`config.h`, `firebase.*`, `sensors.*`, `runtime_config.*`,
   `commands.*`, `updater.*`, `daily_stats.*`) lädt die IDE als Tabs.

4. **Upload** per USB (CH340C/UART) oder die fertigen `.bin` aus einem
   GitHub Release flashen (siehe unten).

## Build & Release (CI)

Bei jedem Push, der `firmware/` ändert, baut die GitHub Action
`firmware-release.yml` mit `arduino-cli` und veröffentlicht ein Release
`v0.1.<build-nr>` mit drei Artefakten. Der Versions-String wird per
`-DFIRMWARE_VERSION=...` aus dem Tag gesetzt (lokale IDE-Builds zeigen
`dev`).

Erst-Flash / Recovery per Kabel (Web-Flasher oder esptool):
- `bootloader.bin` → `0x0`
- `partitions.bin` → `0x8000`
- `stockwaage-<version>.bin` → `0x10000`

## OTA-Update

Der ESP prüft bei jedem Wakeup das neueste GitHub Release und schreibt
`firmwareVersion` / `latestFirmwareVersion` in sein Geräte-Dokument. Im
UI (Einstellungen → Firmware):
- **Manuell:** Button „Firmware vX installieren" → `update`-Command.
- **Automatisch:** Checkbox „automatisch installieren". Der ESP zieht
  neue Releases dann selbstständig (auch ohne geöffnetes UI).

## Erstinbetriebnahme

1. ESP einschalten → WLAN-AP `stockwaage-setup`
2. Handy/Laptop verbinden → Captive Portal öffnet sich
3. *Configure WiFi* → Heim-WLAN + Passwort
4. Custom-Felder:
   - **Firebase Passwort** (markus@strogg.de)
   - **Device ID** (z.B. `bienenstand-garten`)
   - **Intervall (Sek.)** Default 900 (= 15 min)
5. *Save* → ESP verbindet, schreibt erste Messung.

**Portal später erzwingen:** BOOT-Taster (GPIO 0) beim Reset/Wakeup
gedrückt halten – Portal kommt wieder, vorhandene Werte sind vorausgefüllt.

## Wake-Button

- **1× drücken:** ESP wacht sofort auf, misst und sendet.
- **2× drücken (Doppelklick):** Messpause für `wakePauseMin` Minuten
  (kein Wiegen, zum Arbeiten an den Bienen). Onboard-LED blinkt grün als
  Bestätigung. Ein einzelner Druck während der Pause beendet sie sofort.

Der Doppelklick wird vor dem WiFi-Connect erkannt; dafür werden die
Wake-Settings bei jedem Config-Load in NVS gecacht.

## Datenmodell (Firestore)

```
users/{ownerUid}/devices/{deviceId}
  deviceId, lastSeen, vBat, intervalSec
  firmwareVersion, latestFirmwareVersion, latestFirmwareUrl
  swarmAlerts: { s1: true, ... }     # Schwarm-Verdacht aus letzter Messung

  config/main
    intervalSec, stayAwakeUntilMs
    i2cSda, i2cScl
    bme280Enabled, bme280Addr
    inaBatteryEnabled, inaBatteryAddr
    inaSolarEnabled, inaSolarAddr
    rainEnabled, rainPin
    wakeButtonEnabled, wakeButtonPin, wakeButtonLevel, wakePauseMin
    autoUpdateEnabled

  scales/{s1..s8}                     # name/dtPin/onDashboard nur vom UI;
    name, offset, scaleFactor, tempCoef, tempRefC,   # ESP schreibt nur
    dtPin, onDashboard, learning                     # offset/scaleFactor/temp*

  readings/{ts}
    ts, expireAt                      # expireAt = ts+60d -> Firestore-TTL
    ambientC, ambientHumidity, ambientPressure
    batteryV, batteryA, solarV, solarA, rainRaw
    scales: { s1: { raw, kg?, swarm? }, ... }   # swarm=true bei Gewichtssturz

  dailyStats/{YYYY-MM-DD}            # Tages-Aggregate für Langzeit-Graph
    date
    scales: { s1: { sum, count, min, max, last }, ... }
    tempC:    { sum, count, min, max, last }
    humidity: { sum, count, min, max, last }

  comments/{id}                     # Logbuch
    scaleId, text, ts, createdAt

  commands/{cmdId}
    type:    "tare" | "calibrate" | "setTempCoef" | "stayAwake"
             | "reload" | "update"
    scaleId: "s1" .. "s8"   (wo zutreffend)
    payload: { knownKg?, tempCoef?, tempRefC?, durationMs?, url?, version? }
    status:  "pending" | "done" | "error"
    error?:  String
    createdAt, processedAt?
```

## Kalibrierungs-Mathematik

```
ambientC    = BME280-Temperatur
raw         = HX711.read_average(5)
kg          = (raw - offset - tempCoef * (ambientC - tempRefC)) / scaleFactor
```

- `offset`      = Tare (raw bei 0 kg)
- `scaleFactor` = (raw_belastet − offset) / known_kg
- `tempCoef`    = Steigung aus Linearregression der Lernphase
- `tempRefC`    = Mittlere Temperatur während der Lernphase

`kg` wird nur geschrieben wenn `scaleFactor != 0` und `ambientC` bekannt.
Der Rohwert wird **immer** geschrieben → spätere Re-Kalibrierung jederzeit
möglich.

## Schwarm-Erkennung

Fällt das Gewicht einer kalibrierten Waage zwischen zwei Messungen um mehr
als `SWARM_DROP_KG` (Default 1,5 kg, in `config.h`), setzt der ESP
`scales.sN.swarm=true` im Reading **und** sammelt alle betroffenen Waagen in
`device.swarmAlerts`. Das Dashboard zeigt pro Waage einen grünen/roten Punkt,
ohne dafür Rohdaten laden zu müssen. Das letzte Gewicht je Waage liegt in
RTC-Memory und übersteht Deep Sleep.

## Firestore-TTL für `readings` (einmalig einrichten)

Jedes Reading bekommt ein `expireAt`-Timestamp (jetzt + 60 Tage). Damit
Firestore die alten Dokumente automatisch löscht, einmalig eine TTL-Policy
anlegen (Langzeit-Historie bleibt in `dailyStats` erhalten):

```bash
gcloud firestore fields ttls update expireAt \
  --collection-group=readings \
  --enable-ttl \
  --project=stockwaage-132b6
```

Alternativ in der Firebase Console → Firestore → TTL → Policy auf
`readings` / Feld `expireAt`.

## Command-Lifecycle

Der ESP arbeitet pending commands bei jedem Wakeup **vor** der Messung ab.
Das UI schreibt `{type, scaleId?, payload, status:"pending", createdAt}`,
der ESP liefert `status:"done"|"error"` zurück.

Für interaktive Kalibrierung: command `stayAwake` mit `durationMs` → ESP
bleibt wach und pollt alle 3 s auf weitere commands. Der `update`-command
trägt die Release-URL im `payload.url` und löst das OTA-Flashen aus.

## Tages-Aggregate

Bei jedem Wakeup pflegt der ESP `dailyStats/{YYYY-MM-DD}` per
Read-modify-write fort (sum/count/min/max/last je Waage + Temperatur/
Feuchte). Der Tages-Key nutzt lokale Zeit (TZ Europe). So liest der
Langzeit-Graph nur ein Dokument pro Tag.
