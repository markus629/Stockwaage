#include "runtime_config.h"
#include "firebase.h"
#include <ArduinoJson.h>
#include <math.h>

String scaleId(int idx) {
  return String("s") + String(idx + 1);
}

// GLOBALE Config (gilt fuer alle ESPs): users/{uid}/config/main. Pro-Geraet
// bleibt nur die Kalibrierung (scales). deviceId wird hier nicht gebraucht.
static String mainDocPath(const String& /*deviceId*/) {
  return String("users/") + OWNER_UID + "/config/main";
}
static String scaleDocPath(const String& deviceId, int idx) {
  return String("users/") + OWNER_UID + "/devices/" + deviceId
       + "/scales/" + scaleId(idx);
}
static String scalesCollPath(const String& deviceId) {
  return String("users/") + OWNER_UID + "/devices/" + deviceId + "/scales";
}

// "users/.../scales/s3" -> 2 (0-basiert). -1 wenn kein gueltiger Slot.
static int scaleIdxFromName(const String& name) {
  int slash = name.lastIndexOf('/');
  if (slash < 0) return -1;
  String sid = name.substring(slash + 1);
  if (!sid.startsWith("s")) return -1;
  int n = sid.substring(1).toInt();
  if (n < 1 || n > NUM_SCALES) return -1;
  return n - 1;
}

bool RuntimeConfig::load(const String& idToken, const String& deviceId) {
  // --- main ---
  String resp;
  if (fb::getDoc(idToken, mainDocPath(deviceId), resp) && resp.length() > 0) {
    DynamicJsonDocument doc(2048);
    if (!deserializeJson(doc, resp)) {
      JsonObject fields = doc["fields"];
      main.intervalSec      = (uint32_t)fb::readInteger(fields["intervalSec"],
                                                       main.intervalSec);
      // stayAwakeUntilMs ist transient (per stayAwake-Command gesetzt) und
      // steht NICHT in der globalen Config -> in-memory-Wert behalten.
      main.stayAwakeUntilMs = (uint64_t)fb::readInteger(
                                  fields["stayAwakeUntilMs"],
                                  main.stayAwakeUntilMs);
      main.autoUpdateEnabled = fb::readBool  (fields["autoUpdateEnabled"],
                                              false);
      main.deepSleepEnabled  = fb::readBool  (fields["deepSleepEnabled"], true);
    }
  }

  // --- scales: EIN Collection-Listing statt acht Einzel-GETs (spart Reads).
  String scalesResp;
  if (fb::listDocs(idToken, scalesCollPath(deviceId), NUM_SCALES, scalesResp)
      && scalesResp.length() > 0) {
    DynamicJsonDocument doc(16384);
    if (!deserializeJson(doc, scalesResp)) {
      JsonArrayConst arr = doc["documents"].as<JsonArrayConst>();
      for (JsonObjectConst d : arr) {
        int i = scaleIdxFromName(String((const char*)d["name"]));
        if (i < 0) continue;
        JsonObjectConst f = d["fields"];
        scales[i].exists      = true;
        scales[i].name        = fb::readString (f["name"], "");
        scales[i].offset      = fb::readNumber (f["offset"], 0.0);
        scales[i].scaleFactor = fb::readNumber (f["scaleFactor"], 0.0);
        scales[i].tempCoef    = fb::readNumber (f["tempCoef"], 0.0);
        scales[i].tempRefC    = fb::readNumber (f["tempRefC"], 20.0);
      }
    }
  }

  return true;
}

bool RuntimeConfig::saveScale(const String& idToken, const String& deviceId,
                              int idx) const {
  const auto& s = scales[idx];
  DynamicJsonDocument doc(1024);
  JsonObject fields = doc.createNestedObject("fields");
  fb::writeNumber (fields, "offset",      s.offset);
  fb::writeNumber (fields, "scaleFactor", s.scaleFactor);
  fb::writeNumber (fields, "tempCoef",    s.tempCoef);
  fb::writeNumber (fields, "tempRefC",    s.tempRefC);
  String body;
  serializeJson(doc, body);
  // updateMask: nur die ESP-Felder (Kalibrierung) ueberschreiben. Name und
  // UI-Felder (learning) bleiben unberuehrt.
  return fb::patchDoc(idToken, scaleDocPath(deviceId, idx), body,
                      "offset,scaleFactor,tempCoef,tempRefC");
}

double RuntimeConfig::computeKg(int idx, double raw, double tempC) const {
  const auto& s = scales[idx];
  if (s.scaleFactor == 0.0) return NAN;
  // Temperaturkompensation nur, wenn ein Koeffizient gesetzt UND eine
  // Temperatur verfuegbar ist. Ohne Temp-Sensor (tempC=NaN) oder ohne
  // Koeffizient wird unkompensiert gerechnet, statt kg=NaN zu liefern
  // (sonst zeigt eine kalibrierte Waage ohne BME280 nie kg an).
  double tempComp = 0.0;
  if (s.tempCoef != 0.0 && !isnan(tempC)) {
    tempComp = s.tempCoef * (tempC - s.tempRefC);
  }
  return (raw - s.offset - tempComp) / s.scaleFactor;
}
