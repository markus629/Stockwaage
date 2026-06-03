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

// BMP280 (Temperatur) initialisieren. Feste Pins/Adresse aus config.h.
void initEnv(const MainConfig& cfg);

// HX711 mit den festen Pins aus config.h initialisieren.
void initScales();

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

// Sensoren vor dem Deep Sleep stromsparend schlafen legen: HX711 power_down,
// INA219 powerSave. Der BME280 laeuft im Forced-Mode und schlaeft ohnehin
// nach jeder Messung selbst. Liefert true, wenn mind. eine Waage aktiv war
// (-> der SCK-Pin sollte ueber den Sleep gehalten werden).
bool powerDown();

} // namespace sensors
