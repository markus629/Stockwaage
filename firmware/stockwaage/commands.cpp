#include "commands.h"
#include "firebase.h"
#include "sensors.h"
#include <ArduinoJson.h>
#include <math.h>

namespace {

String commandsCollPath(const String& deviceId) {
  return String("users/") + OWNER_UID + "/devices/" + deviceId + "/commands";
}
String commandDocPath(const String& deviceId, const String& cmdId) {
  return commandsCollPath(deviceId) + "/" + cmdId;
}

int scaleIdxFromId(const String& sid) {
  if (!sid.startsWith("s")) return -1;
  int n = sid.substring(1).toInt();
  if (n < 1 || n > NUM_SCALES) return -1;
  return n - 1;
}

bool markDone(const String& idToken, const String& deviceId, const String& cmdId,
              const String& status, const String& err = "") {
  DynamicJsonDocument doc(512);
  JsonObject fields = doc.createNestedObject("fields");
  fb::writeString (fields, "status",      status);
  fb::writeInteger(fields, "processedAt", (long long)(time(nullptr) * 1000LL));
  if (err.length()) fb::writeString(fields, "error", err);
  String body;
  serializeJson(doc, body);
  return fb::patchDoc(idToken, commandDocPath(deviceId, cmdId), body,
                      err.length() ? "status,processedAt,error"
                                   : "status,processedAt");
}

} // namespace

namespace commands {

bool processPending(const String& idToken, const String& deviceId,
                    RuntimeConfig& cfg) {
  String resp;
  if (!fb::listDocs(idToken, commandsCollPath(deviceId), 20, resp)) return false;
  if (resp.length() == 0) return true;

  DynamicJsonDocument doc(8192);
  if (deserializeJson(doc, resp)) {
    Serial.println("[cmd] JSON parse failed");
    return false;
  }
  JsonArray docs = doc["documents"].as<JsonArray>();
  if (docs.isNull() || docs.size() == 0) return true;

  bool allOk = true;
  bool mainDirty = false;
  bool scaleDirty[NUM_SCALES] = {false};

  for (JsonObject d : docs) {
    String name = String((const char*)d["name"]);     // .../commands/{id}
    int slash = name.lastIndexOf('/');
    if (slash < 0) continue;
    String cmdId = name.substring(slash + 1);

    JsonObject f = d["fields"];
    String status = fb::readString(f["status"], "pending");
    if (status != "pending") continue;

    String type    = fb::readString(f["type"]);
    String scaleSid= fb::readString(f["scaleId"]);
    JsonObject payload = f["payload"]["mapValue"]["fields"];

    Serial.printf("[cmd] %s id=%s scale=%s\n",
                  type.c_str(), cmdId.c_str(), scaleSid.c_str());

    bool ok = false;
    String err;

    if (type == "tare") {
      int idx = scaleIdxFromId(scaleSid);
      if (idx < 0) { err = "bad scaleId"; }
      else {
        double raw = sensors::readScaleRawAvg(idx, 10);
        if (isnan(raw)) { err = "hx711 timeout"; }
        else {
          cfg.scales[idx].offset = raw;
          if (!cfg.scales[idx].enabled) cfg.scales[idx].enabled = true;
          scaleDirty[idx] = true;
          ok = true;
        }
      }
    }
    else if (type == "calibrate") {
      int idx = scaleIdxFromId(scaleSid);
      double knownKg = fb::readNumber(payload["knownKg"], 0.0);
      if (idx < 0)            err = "bad scaleId";
      else if (knownKg <= 0)  err = "knownKg must be > 0";
      else {
        double raw = sensors::readScaleRawAvg(idx, 10);
        if (isnan(raw)) { err = "hx711 timeout"; }
        else {
          double sf = (raw - cfg.scales[idx].offset) / knownKg;
          if (sf == 0) { err = "scaleFactor zero"; }
          else {
            cfg.scales[idx].scaleFactor = sf;
            scaleDirty[idx] = true;
            ok = true;
          }
        }
      }
    }
    else if (type == "setTempCoef") {
      int idx = scaleIdxFromId(scaleSid);
      if (idx < 0) err = "bad scaleId";
      else {
        cfg.scales[idx].tempCoef = fb::readNumber(payload["tempCoef"], 0.0);
        cfg.scales[idx].tempRefC = fb::readNumber(payload["tempRefC"], 20.0);
        scaleDirty[idx] = true;
        ok = true;
      }
    }
    else if (type == "stayAwake") {
      long long durMs = fb::readInteger(payload["durationMs"], 600000); // 10 min
      cfg.main.stayAwakeUntilMs = (uint64_t)(time(nullptr) * 1000LL + durMs);
      mainDirty = true;
      ok = true;
    }
    else if (type == "reload") {
      ok = true; // schon dadurch, dass wir hier sind
    }
    else {
      err = String("unknown type: ") + type;
    }

    if (ok) {
      markDone(idToken, deviceId, cmdId, "done");
    } else {
      markDone(idToken, deviceId, cmdId, "error", err);
      Serial.printf("[cmd] error: %s\n", err.c_str());
      allOk = false;
    }
  }

  if (mainDirty) cfg.saveMain(idToken, deviceId);
  for (int i = 0; i < NUM_SCALES; i++) {
    if (scaleDirty[i]) cfg.saveScale(idToken, deviceId, i);
  }

  return allOk;
}

} // namespace commands
