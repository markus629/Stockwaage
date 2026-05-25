# Stockwaage ESP32 Firmware

ESP32 WROOM-32. Wake auf Timer, misst, sendet an Firestore, schlaeft.
Erstes Setup ueber Captive Portal (WiFiManager).

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
   - Upload-Speed: 921600, Flash-Frequenz: 80 MHz, Partition: Default

2. **Bibliotheken** (Werkzeuge -> Bibliotheken verwalten)
   - `WiFiManager` von tzapu
   - `HX711 Arduino Library` von Bogdan Necula
   - `OneWire` von Paul Stoffregen
   - `DallasTemperature` von Miles Burton
   - `ArduinoJson` von Benoit Blanchon (>= 7.0)

3. **Sketch oeffnen:** `firmware/stockwaage/stockwaage.ino`. Die Datei
   `config.h` muss im selben Ordner liegen, IDE zeigt sie als Tab.

4. **Upload:** ESP32 anschliessen, Port waehlen, Upload-Knopf.

## Erstinbetriebnahme

1. ESP einschalten -> macht einen WLAN-AP `stockwaage-setup` auf
2. Mit Handy/Laptop verbinden (Captive Portal oeffnet sich automatisch,
   sonst http://192.168.4.1)
3. *Configure WiFi* -> dein Heim-WLAN waehlen, Passwort eintragen
4. Custom-Felder ausfuellen:
   - **Firebase Passwort**: dein Konto-Passwort fuer markus@strogg.de
   - **Device ID**: z.B. `bienenstand-garten` (eindeutig pro ESP)
   - **Intervall (Sek.)**: Default 900 (= 15 min)
5. *Save* -> ESP verbindet sich, schreibt erste Messung nach Firestore
6. Web-UI: ueberpruefen ob Geraet erscheint

## Spaeter aendern

**BOOT-Taster druecken** waehrend Reset oder Wakeup -> Portal kommt
wieder, alle bisherigen Einstellungen werden vorausgefuellt.

## Datenformat in Firestore

`users/{ownerUid}/devices/{deviceId}/readings/{tsMillis}`:
```
ts:     <unix ms>
vBat:   <volt>
boots:  <counter seit Power-On>
scales: { s1: <raw>, s2: <raw>, ... }    # Rohwerte, Kalibrierung folgt
temps:  { <1wire-addr>: <celsius>, ... }
```

`users/{ownerUid}/devices/{deviceId}`:
```
deviceId, lastSeen, vBat, intervalSec
```
