#pragma once
#include <Arduino.h>
#include "runtime_config.h"

namespace commands {

// Holt pending commands aus Firestore, fuehrt sie aus, markiert sie als done.
// Modifiziert cfg in-place (z.B. tare schreibt offset, calibrate scaleFactor).
// Schreibt geaenderte Config zurueck nach Firestore.
// Liefert true wenn alle commands ohne Fehler abgearbeitet wurden.
// changed (optional) wird true gesetzt, wenn ueberhaupt ein Command
// verarbeitet wurde -> der Aufrufer kann ein erneutes cfg.load() sparen.
bool processPending(const String& idToken, const String& deviceId,
                    RuntimeConfig& cfg, bool* changed = nullptr);

} // namespace commands
