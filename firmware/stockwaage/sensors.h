#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"

namespace sensors {

void init();

// liest alle aktiven HX711 in den Out-Array (Laenge NUM_SCALES).
// Wert = NAN bei Timeout.
void readScalesRaw(double rawOut[NUM_SCALES]);

// Mittelwert ueber N samples fuer eine einzelne Waage (fuer Tare/Kalibrierung).
// Liefert NAN bei Timeout.
double readScaleRawAvg(int scaleIdx, int samples);

// liest DS18B20 in eine Map (addr -> tempC). addr-Format: "28-aabbccddeeff".
void readTemps(JsonObject mapOut);

// Akku-Spannung in Volt.
float readVBat();

} // namespace sensors
