#include "runtime_config.h"
#include "firebase.h"
#include <ArduinoJson.h>
#include <math.h>

String scaleId(int idx) {
  return String("s") + String(idx + 1);
}

static String mainDocPath(const String& deviceId) {
  return String("users/") + OWNER_UID + "/devices/" + deviceId + "/config/main";
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
      main.stayAwakeUntilMs = (uint64_t)fb::readInteger(
                                  fields["stayAwakeUntilMs"], 0);
      main.sckPin           = (int)fb::readInteger(fields["sckPin"],
                                                   main.sckPin);
      main.i2cSda           = (int)fb::readInteger(fields["i2cSda"],
                                                   main.i2cSda);
      main.i2cScl           = (int)fb::readInteger(fields["i2cScl"],
                                                   main.i2cScl);
      main.bme280Enabled    = fb::readBool   (fields["bme280Enabled"], false);
      main.bme280Addr       = (int)fb::readInteger(fields["bme280Addr"],
                                                   main.bme280Addr);
      main.inaBatteryEnabled = fb::readBool  (fields["inaBatteryEnabled"],
                                              false);
      main.inaBatteryAddr    = (int)fb::readInteger(fields["inaBatteryAddr"],
                                                    main.inaBatteryAddr);
      main.inaSolarEnabled   = fb::readBool  (fields["inaSolarEnabled"], false);
      main.inaSolarAddr      = (int)fb::readInteger(fields["inaSolarAddr"],
                                                    main.inaSolarAddr);
      main.rainEnabled       = fb::readBool  (fields["rainEnabled"], false);
      main.rainPin           = (int)fb::readInteger(fields["rainPin"],
                                                    main.rainPin);
      main.wakeButtonEnabled = fb::readBool  (fields["wakeButtonEnabled"],
                                              false);
      main.wakeButtonPin     = (int)fb::readInteger(fields["wakeButtonPin"],
                                                    main.wakeButtonPin);
      main.wakeButtonLevel   = (int)fb::readInteger(fields["wakeButtonLevel"],
                                                    main.wakeButtonLevel);
      main.wakePauseMin      = (uint32_t)fb::readInteger(
                                  fields["wakePauseMin"], main.wakePauseMin);
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
        scales[i].enabled     = fb::readBool   (f["enabled"], false);
        scales[i].name        = fb::readString (f["name"], "");
        scales[i].offset      = fb::readNumber (f["offset"], 0.0);
        scales[i].scaleFactor = fb::readNumber (f["scaleFactor"], 0.0);
        scales[i].tempCoef    = fb::readNumber (f["tempCoef"], 0.0);
        scales[i].tempRefC    = fb::readNumber (f["tempRefC"], 20.0);
        scales[i].dtPin       = (int)fb::readInteger(f["dtPin"],
                                                     PIN_HX711_DT[i]);
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
  fb::writeBool   (fields, "enabled",     s.enabled);
  fb::writeString (fields, "name",        s.name);
  fb::writeNumber (fields, "offset",      s.offset);
  fb::writeNumber (fields, "scaleFactor", s.scaleFactor);
  fb::writeNumber (fields, "tempCoef",    s.tempCoef);
  fb::writeNumber (fields, "tempRefC",    s.tempRefC);
  String body;
  serializeJson(doc, body);
  // updateMask: nur die ESP-Felder ueberschreiben, damit das vom Browser
  // gesetzte "learning"-Feld erhalten bleibt.
  return fb::patchDoc(idToken, scaleDocPath(deviceId, idx), body,
                      "enabled,name,offset,scaleFactor,tempCoef,tempRefC");
}

bool RuntimeConfig::saveMain(const String& idToken,
                             const String& deviceId) const {
  DynamicJsonDocument doc(512);
  JsonObject fields = doc.createNestedObject("fields");
  fb::writeInteger(fields, "intervalSec",      main.intervalSec);
  fb::writeInteger(fields, "stayAwakeUntilMs", main.stayAwakeUntilMs);
  String body;
  serializeJson(doc, body);
  return fb::patchDoc(idToken, mainDocPath(deviceId), body,
                      "intervalSec,stayAwakeUntilMs");
}

double RuntimeConfig::computeKg(int idx, double raw, double tempC) const {
  const auto& s = scales[idx];
  if (s.scaleFactor == 0.0) return NAN;
  double corrected = raw - s.offset - s.tempCoef * (tempC - s.tempRefC);
  return corrected / s.scaleFactor;
}
