#pragma once
#include <Arduino.h>
#include "config.h"
#include "sensors.h"

// Pflegt pro Tag ein Aggregat-Dokument users/{uid}/devices/{id}/dailyStats/
// {YYYY-MM-DD}. Read-modify-write bei jedem Wakeup: sum/count/min/max/last
// pro Waage + Aussentemperatur/Feuchte. Der Langzeit-Graph liest daraus
// einen Punkt pro Tag statt 96 Rohwerte.

namespace daily {

void update(const String& idToken, const String& deviceId,
            const String& dayKey,
            const double kg[NUM_SCALES],
            const sensors::EnvReading& env);

} // namespace daily
