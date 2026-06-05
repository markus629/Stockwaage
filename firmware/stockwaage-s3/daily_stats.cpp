#include "daily_stats.h"
#include "firebase.h"
#include "runtime_config.h"  // scaleId()
#include <ArduinoJson.h>
#include <math.h>

namespace {

String statsPath(const String& deviceId, const String& dayKey) {
  return String("users/") + OWNER_UID + "/devices/" + deviceId +
         "/dailyStats/" + dayKey;
}

// Neuen Messwert in ein Aggregat-Feld einrechnen (sum/count/min/max/last).
void mergeMetric(JsonObject target, JsonVariantConst prev, double v) {
  const bool hasPrev = !prev.isNull();
  double sum = fb::readNumber(prev["sum"], 0.0);
  double cnt = fb::readNumber(prev["count"], 0.0);
  double mn  = hasPrev ? fb::readNumber(prev["min"], v) : v;
  double mx  = hasPrev ? fb::readNumber(prev["max"], v) : v;
  sum += v;
  cnt += 1;
  if (v < mn) mn = v;
  if (v > mx) mx = v;
  fb::writeNumber(target, "sum",   sum);
  fb::writeNumber(target, "count", cnt);
  fb::writeNumber(target, "min",   mn);
  fb::writeNumber(target, "max",   mx);
  fb::writeNumber(target, "last",  v);
}

// Bestehendes Aggregat unveraendert uebernehmen (wenn diese Messung fuer
// die Metrik keinen Wert hatte, aber frueher am Tag schon).
void copyMetric(JsonObject target, JsonVariantConst prev) {
  fb::writeNumber(target, "sum",   fb::readNumber(prev["sum"], 0.0));
  fb::writeNumber(target, "count", fb::readNumber(prev["count"], 0.0));
  fb::writeNumber(target, "min",   fb::readNumber(prev["min"], 0.0));
  fb::writeNumber(target, "max",   fb::readNumber(prev["max"], 0.0));
  fb::writeNumber(target, "last",  fb::readNumber(prev["last"], 0.0));
}

// Eine Metrik (mapValue mit fields) in den Output schreiben - mergen wenn
// neuer Wert da, sonst alten Stand kopieren, sonst gar nichts.
void emitMetric(JsonObject parentFields, const char* key,
                JsonVariantConst prev, double v) {
  const bool hasNew  = !isnan(v);
  const bool hasPrev = !prev.isNull();
  if (!hasNew && !hasPrev) return;
  JsonObject e = parentFields.createNestedObject(key)
                             .createNestedObject("mapValue")
                             .createNestedObject("fields");
  if (hasNew) mergeMetric(e, prev, v);
  else        copyMetric(e, prev);
}

} // namespace

namespace daily {

void update(const String& idToken, const String& deviceId,
            const String& dayKey,
            const double kg[NUM_SCALES],
            const sensors::EnvReading& env) {
  const String path = statsPath(deviceId, dayKey);

  // 1) bestehendes Tages-Dokument lesen (404 -> leer).
  String resp;
  DynamicJsonDocument existing(8192);
  bool has = false;
  if (fb::getDoc(idToken, path, resp) && resp.length() > 0) {
    has = (deserializeJson(existing, resp) == DeserializationError::Ok);
  }
  JsonVariantConst ef = existing["fields"];  // null wenn nicht vorhanden
  (void)has;
  JsonVariantConst prevScales = ef["scales"]["mapValue"]["fields"];

  // 2) neues Dokument bauen.
  DynamicJsonDocument out(12288);
  JsonObject fields = out.createNestedObject("fields");
  fb::writeString(fields, "date", dayKey);

  JsonObject scalesF = fields.createNestedObject("scales")
                             .createNestedObject("mapValue")
                             .createNestedObject("fields");
  for (int i = 0; i < NUM_SCALES; i++) {
    const String sid = scaleId(i);
    JsonVariantConst prev = prevScales[sid]["mapValue"]["fields"];
    emitMetric(scalesF, sid.c_str(), prev, kg[i]);
  }

  emitMetric(fields, "tempC",
             ef["tempC"]["mapValue"]["fields"], env.tempC);
  emitMetric(fields, "humidity",
             ef["humidity"]["mapValue"]["fields"], env.humidity);

  String body;
  serializeJson(out, body);
  fb::patchDoc(idToken, path, body);
}

} // namespace daily
