#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"

namespace sensors {

// Peripherie ohne Waagen-Pins (OneWire, ADC). Muss einmal beim Boot laufen.
void init();

// HX711-Instanzen mit den Pins aus der Runtime-Config initialisieren.
// dtPins[i] <= 0 -> Waage i ist deaktiviert (kein HX711-init, kein Read).
// Doppelte Pins werden ignoriert (nur erstes Vorkommen wird aktiv).
void initScales(const int dtPins[NUM_SCALES]);

// liest alle aktiven HX711 in den Out-Array (Laenge NUM_SCALES).
// Wert = NAN bei Timeout oder wenn Waage nicht aktiv ist.
void readScalesRaw(double rawOut[NUM_SCALES]);

// Mittelwert ueber N samples fuer eine einzelne Waage (fuer Tare/Kalibrierung).
// Liefert NAN bei Timeout oder wenn Waage nicht aktiv ist.
double readScaleRawAvg(int scaleIdx, int samples);

// liest DS18B20 in eine Map (addr -> tempC). addr-Format: "28-aabbccddeeff".
void readTemps(JsonObject mapOut);

// Akku-Spannung in Volt.
float readVBat();

} // namespace sensors
