#pragma once
#include <Arduino.h>
#include "config.h"

// Laufzeit-Konfiguration, aus Firestore geholt. Build-Defaults aus config.h
// werden verwendet wenn Firestore noch leer ist.

struct ScaleConfig {
  bool   exists        = false;  // true wenn Firestore-Dokument vorhanden
  String name;                   // Anzeigename (UI-only)
  double offset        = 0.0;    // raw bei 0 kg
  double scaleFactor   = 0.0;    // (raw - offset) / kg; 0 = nicht kalibriert
  double tempCoef      = 0.0;    // raw-Drift pro Grad C
  double tempRefC      = 20.0;   // Referenz-Temperatur fuer Drift
};

struct MainConfig {
  uint32_t intervalSec        = DEFAULT_INTERVAL_SEC;
  uint64_t stayAwakeUntilMs   = 0;       // ESP bleibt wach bis hier
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
