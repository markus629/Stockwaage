#pragma once
#include <Arduino.h>
#include "config.h"

// Laufzeit-Konfiguration, aus Firestore geholt. Build-Defaults aus config.h
// werden verwendet wenn Firestore noch leer ist.

struct ScaleConfig {
  bool   exists        = false;  // true wenn Firestore-Dokument vorhanden
  bool   enabled       = false;
  String name;                   // Anzeigename, leer = "s1" usw.
  double offset        = 0.0;    // raw bei 0 kg
  double scaleFactor   = 0.0;    // (raw - offset) / kg; 0 = nicht kalibriert
  double tempCoef      = 0.0;    // raw-Drift pro Grad C
  double tempRefC      = 20.0;   // Referenz-Temperatur fuer Drift
  int    dtPin         = -1;     // HX711 DT-Pin; -1 = kein Pin -> Waage skip
};

struct MainConfig {
  uint32_t intervalSec        = DEFAULT_INTERVAL_SEC;
  uint64_t stayAwakeUntilMs   = 0;       // ESP bleibt wach bis hier
  int      i2cSda             = 8;
  int      i2cScl             = 9;
  bool     bme280Enabled      = false;
  int      bme280Addr         = 0x76;
  bool     inaBatteryEnabled  = false;
  int      inaBatteryAddr     = 0x40;
  bool     inaSolarEnabled    = false;
  int      inaSolarAddr       = 0x41;
  bool     rainEnabled        = false;
  int      rainPin            = 2;
  bool     wakeButtonEnabled  = false;
  int      wakeButtonPin      = 5;
  int      wakeButtonLevel    = 0;        // 0 = LOW (Taster nach GND)
  uint32_t wakePauseMin       = 30;       // Doppelklick -> Messpause-Dauer
  bool     autoUpdateEnabled  = false;
  bool     deepSleepEnabled   = true;     // false = ESP bleibt wach (sofortige
                                          // Uebernahme von Settings/Updates)
};

class RuntimeConfig {
 public:
  MainConfig    main;
  ScaleConfig   scales[NUM_SCALES];

  // Holt config/main und config/scales/* aus Firestore.
  // Fehlende Dokumente sind ok -> Defaults bleiben.
  bool load(const String& idToken, const String& deviceId);

  // Schreibt nur die Felder einer einzelnen Waage.
  bool saveScale(const String& idToken, const String& deviceId,
                 int scaleIdx) const;

  // Schreibt main-Config (stayAwakeUntilMs etc.)
  bool saveMain(const String& idToken, const String& deviceId) const;

  // Hilfsmethode: kg aus raw rechnen unter Verwendung der Kompensation.
  // Liefert NaN wenn Waage nicht kalibriert.
  double computeKg(int scaleIdx, double raw, double tempC) const;
};

// "s1".."s8"
String scaleId(int idx);
