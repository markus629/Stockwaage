#include "firebase.h"
#include "config.h"
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>

namespace {
const char* kFirestoreBase =
    "https://firestore.googleapis.com/v1/projects/" FIREBASE_PROJECT_ID
    "/databases/(default)/documents/";

String docUrl(const String& path, const String& updateMask) {
  String url = String(kFirestoreBase) + path;
  if (updateMask.length() > 0) {
    // updateMask = "foo,bar" -> ?updateMask.fieldPaths=foo&updateMask.fieldPaths=bar
    url += "?";
    int start = 0;
    bool first = true;
    while (start <= updateMask.length()) {
      int end = updateMask.indexOf(',', start);
      if (end < 0) end = updateMask.length();
      if (!first) url += "&";
      url += "updateMask.fieldPaths=";
      url += updateMask.substring(start, end);
      first = false;
      start = end + 1;
    }
  }
  return url;
}
} // namespace

namespace fb {

LoginResult login(const String& email, const String& password) {
  LoginResult r;
  HTTPClient http;
  String url = String("https://identitytoolkit.googleapis.com/v1/accounts:"
                      "signInWithPassword?key=") + FIREBASE_API_KEY;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> req;
  req["email"] = email;
  req["password"] = password;
  req["returnSecureToken"] = true;
  String body;
  serializeJson(req, body);

  int code = http.POST(body);
  String resp = http.getString();
  http.end();

  if (code != 200) {
    r.error = String("HTTP ") + code + ": " + resp;
    return r;
  }
  DynamicJsonDocument res(2048);
  if (deserializeJson(res, resp)) {
    r.error = "JSON parse failed";
    return r;
  }
  r.idToken = String((const char*)res["idToken"]);
  r.localId = String((const char*)res["localId"]);
  r.ok = r.idToken.length() > 0;
  return r;
}

bool patchDoc(const String& idToken, const String& docPath,
              const String& body, const String& updateMask) {
  HTTPClient http;
  http.begin(docUrl(docPath, updateMask));
  http.addHeader("Authorization", String("Bearer ") + idToken);
  http.addHeader("Content-Type", "application/json");
  int code = http.PATCH(body);
  if (code < 200 || code >= 300) {
    Serial.printf("[fb] PATCH %s -> %d\n%s\n",
                  docPath.c_str(), code, http.getString().c_str());
    http.end();
    return false;
  }
  http.end();
  return true;
}

bool getDoc(const String& idToken, const String& docPath, String& resp,
            int* httpCode) {
  HTTPClient http;
  http.begin(docUrl(docPath, ""));
  http.addHeader("Authorization", String("Bearer ") + idToken);
  int code = http.GET();
  if (httpCode) *httpCode = code;
  if (code == 200) {
    resp = http.getString();
    http.end();
    return true;
  }
  if (code == 404) {
    resp = "";
    http.end();
    return true;  // OK, Doc existiert nicht
  }
  Serial.printf("[fb] GET %s -> %d\n%s\n",
                docPath.c_str(), code, http.getString().c_str());
  http.end();
  return false;
}

bool listDocs(const String& idToken, const String& collPath, int pageSize,
              String& resp) {
  HTTPClient http;
  String url = String(kFirestoreBase) + collPath +
               "?pageSize=" + String(pageSize);
  http.begin(url);
  http.addHeader("Authorization", String("Bearer ") + idToken);
  int code = http.GET();
  if (code != 200) {
    Serial.printf("[fb] LIST %s -> %d\n", collPath.c_str(), code);
    http.end();
    return false;
  }
  resp = http.getString();
  http.end();
  return true;
}

// ----- Field readers --------------------------------------------------------

double readNumber(JsonVariantConst field, double defaultVal) {
  if (field.isNull()) return defaultVal;
  if (field["doubleValue"].is<double>())    return field["doubleValue"].as<double>();
  if (field["integerValue"].is<const char*>())
    return atof(field["integerValue"].as<const char*>());
  if (field["integerValue"].is<long long>())
    return (double)field["integerValue"].as<long long>();
  return defaultVal;
}

long long readInteger(JsonVariantConst field, long long defaultVal) {
  if (field.isNull()) return defaultVal;
  if (field["integerValue"].is<const char*>())
    return atoll(field["integerValue"].as<const char*>());
  if (field["integerValue"].is<long long>())
    return field["integerValue"].as<long long>();
  if (field["doubleValue"].is<double>())
    return (long long)field["doubleValue"].as<double>();
  return defaultVal;
}

String readString(JsonVariantConst field, const String& defaultVal) {
  if (field.isNull()) return defaultVal;
  const char* s = field["stringValue"];
  return s ? String(s) : defaultVal;
}

bool readBool(JsonVariantConst field, bool defaultVal) {
  if (field.isNull()) return defaultVal;
  if (field["booleanValue"].is<bool>()) return field["booleanValue"].as<bool>();
  return defaultVal;
}

// ----- Field writers --------------------------------------------------------

void writeNumber(JsonObject fields, const char* key, double v) {
  fields[key]["doubleValue"] = v;
}
void writeInteger(JsonObject fields, const char* key, long long v) {
  // Firestore erwartet integerValue als String
  char buf[24];
  snprintf(buf, sizeof(buf), "%lld", v);
  fields[key]["integerValue"] = buf;
}
void writeString(JsonObject fields, const char* key, const String& v) {
  fields[key]["stringValue"] = v;
}
void writeBool(JsonObject fields, const char* key, bool v) {
  fields[key]["booleanValue"] = v;
}
void writeTimestamp(JsonObject fields, const char* key, time_t epochSec) {
  struct tm tmv;
  gmtime_r(&epochSec, &tmv);
  char buf[24];  // "2026-05-29T12:00:00Z"
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmv);
  fields[key]["timestampValue"] = buf;
}

} // namespace fb
