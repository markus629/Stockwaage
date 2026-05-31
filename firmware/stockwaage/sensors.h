#pragma once
#include <Arduino.h>
#include "config.h"

struct MainConfig;  // forward decl, voller Typ in runtime_config.h

namespace sensors {

// Sammeltyp fuer Umgebungs-/Versorgungs-Sensoren. NAN / -1 = nicht
// gemessen (Sensor disabled oder Fehler).
struct EnvReading {
  double tempC    = NAN;
  double humidity = NAN;
  double pressure = NAN;
  double batteryV = NAN;
  double batteryA = NAN;
  double solarV   = NAN;
  double solarA   = NAN;
  int    rainRaw  = -1;
};

// Einmal beim Boot (ADC-Resolution etc.).
void init();

// I2C-Bus + aktivierte Sensoren initialisieren. Muss NACH cfg.load
// aufgerufen werden. Sensoren ohne mainCfg.*Enabled werden uebersprungen.
void initEnv(const MainConfig& cfg);

// HX711-Instanzen mit den Pins aus der Runtime-Config initialisieren.
// dtPins[i] <= 0 -> Waage i ist deaktiviert (kein HX711-init, kein Read).
// sckPin = gemeinsamer Clock-Pin aller Waagen. Doppelte Pins werden
// ignoriert (nur erstes Vorkommen wird aktiv).
void initScales(const int dtPins[NUM_SCALES], int sckPin);

// liest alle aktiven HX711 in den Out-Array (Laenge NUM_SCALES).
// Wert = NAN bei Timeout oder wenn Waage nicht aktiv ist.
void readScalesRaw(double rawOut[NUM_SCALES]);

// Mittelwert ueber N samples fuer eine einzelne Waage (fuer Tare/Kalibrierung).
// Liefert NAN bei Timeout oder wenn Waage nicht aktiv ist.
double readScaleRawAvg(int scaleIdx, int samples);

// Liest alle aktivierten Umgebungssensoren in einen Rutsch.
void readEnv(EnvReading& out, const MainConfig& cfg);

// Akku-Spannung (Spannungsteiler auf ADC). Fallback wenn kein INA219.
float readVBat();

} // namespace sensors
