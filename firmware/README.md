# Stockwaage ESP32 Firmware

ESP32 WROOM-32. Wake auf Timer, misst, sendet an Firestore, schlaeft.
Erstes Setup ueber Captive Portal (WiFiManager).
Kalibrierung + Temperaturkompensation aus Firestore zur Laufzeit.

## Hardware

| Funktion        | Pin (Default) | Bemerkung |
| --------------- | ------------- | --------- |
| HX711 SCK       | GPIO 4        | gemeinsam fuer alle 8 Waagen |
| HX711 DT 1..8   | 13,14,16,17,18,19,21,22 | je eine Waage |
| DS18B20 OneWire | GPIO 23       | mit 4.7k Pullup an 3.3V |
| Akku-Spannung   | GPIO 32 (ADC) | Spannungsteiler 100k/100k |
| BOOT-Taster     | GPIO 0        | beim Reset gedrueckt halten = Portal erzwingen |

Pins aenderbar in `stockwaage/config.h`.

## Arduino IDE 2.x einrichten

1. **Boards-Manager** (Werkzeuge -> Board -> Boardverwalter)
   - Suche `esp32` -> *esp32 by Espressif Systems* installieren
   - Board waehlen: `ESP32 Dev Module` oder `ESP32-WROOM-DA Module`
   - Upload-Speed: 921600, Partition: Default

2. **Bibliotheken** (Werkzeuge -> Bibliotheken verwalten)
   - `WiFiManager` von tzapu (>= 2.0.16)
   - `HX711 Arduino Library` von Bogdan Necula
   - `OneWire` von Paul Stoffregen
   - `DallasTemperature` von Miles Burton
   - `ArduinoJson` von Benoit Blanchon (**Version 6.21.x**, NICHT v7 - hat
     Breaking Changes)

3. **Sketch oeffnen:** `firmware/stockwaage/stockwaage.ino`. Die weiteren
   Dateien (`config.h`, `firebase.cpp`, `sensors.cpp`, `runtime_config.cpp`,
   `commands.cpp` + Header) werden von der IDE automatisch als Tabs geladen.

4. **Upload:** ESP anschliessen, Port waehlen, Upload.

## Erstinbetriebnahme

1. ESP einschalten -> WLAN-AP `stockwaage-setup`
2. Handy/Laptop verbinden -> Captive Portal oeffnet sich
3. *Configure WiFi* -> Heim-WLAN + Passwort
4. Custom-Felder:
   - **Firebase Passwort** (markus@strogg.de)
   - **Device ID** (z.B. `bienenstand-garten`)
   - **Intervall (Sek.)** Default 900 (= 15 min)
5. *Save* -> ESP verbindet, schreibt erste Messung

## Spaeter aendern: Captive Portal erzwingen

**BOOT-Taster gedrueckt halten waehrend Reset/Wakeup** -> Portal kommt wieder,
alle vorhandenen Werte sind vorausgefuellt.

## Datenmodell (Firestore)

```
users/{ownerUid}/devices/{deviceId}
  deviceId, lastSeen, vBat, intervalSec, firmware?

  config/main
    intervalSec, ambientTempAddr, stayAwakeUntilMs

  scales/{s1..s8}
    enabled, name, offset, scaleFactor, tempCoef, tempRefC

  readings/{ts}
    ts, vBat, boots, ambientC
    scales: { s1: { raw, kg? }, ... }
    temps:  { "28-aabb..": 23.45, ... }

  commands/{cmdId}
    type:    "tare" | "calibrate" | "setTempCoef" | "stayAwake" | "reload"
    scaleId: "s1" .. "s8"   (wo zutreffend)
    payload: { knownKg?, tempCoef?, tempRefC?, durationMs? }
    status:  "pending" | "done" | "error"
    error?:  String
    createdAt, processedAt?
```

## Kalibrierungs-Mathematik

```
ambientC          = temps[ambientTempAddr]                    (DS18B20)
raw               = HX711.read_average(5)
kg                = (raw - offset - tempCoef * (ambientC - tempRefC))
                    / scaleFactor
```

- `offset`      = Tare (raw bei 0 kg)
- `scaleFactor` = (raw_belastet - offset) / known_kg
- `tempCoef`    = Steigung aus Linearregression der Lernphase
- `tempRefC`    = Mittelwert der Temperaturen waehrend der Lernphase

`kg` wird nur geschrieben wenn `scaleFactor != 0` und `ambientC` bekannt.
Roher Wert wird **immer** geschrieben -> spaetere Re-Kalibrierung jederzeit
moeglich.

## Command-Lifecycle

ESP arbeitet pending commands ab beim jedem Wakeup **vor** der Messung. UI
schreibt `{type, scaleId?, payload, status:"pending", createdAt}` -> ESP
liefert `status:"done"|"error"` zurueck.

Fuer interaktive Kalibrierung im UI: command `stayAwake` mit `durationMs`
gesetzt -> ESP bleibt wach und pollt alle 3 Sek auf weitere commands.
