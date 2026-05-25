// ============================================================================
// Stockwaage - ESP32 Firmware
// ----------------------------------------------------------------------------
// Wakeup -> WiFi (Portal beim ersten Mal) -> NTP -> Sensoren -> Firestore
// -> Deep Sleep.
// ============================================================================

#include <WiFi.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <HX711.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>

#include "config.h"

// ----- State (RTC-Memory ueberlebt Deep Sleep) ------------------------------
RTC_DATA_ATTR int     bootCount = 0;
RTC_DATA_ATTR uint8_t lastFailures = 0;

// ----- Globals --------------------------------------------------------------
Preferences        prefs;
HX711              scales[NUM_SCALES];
OneWire            oneWire(PIN_ONEWIRE);
DallasTemperature  ds(&oneWire);

String firebasePassword;
String deviceId;
uint32_t intervalSec;
String idToken;

// ============================================================================
// Hilfsfunktionen
// ============================================================================

void enterDeepSleep(uint32_t seconds) {
  Serial.printf("Deep sleep fuer %u s...\n", seconds);
  Serial.flush();
  esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);
  esp_deep_sleep_start();
}

bool shouldForcePortal() {
  pinMode(PIN_PORTAL_FORCE, INPUT_PULLUP);
  delay(50);
  return digitalRead(PIN_PORTAL_FORCE) == LOW;
}

void loadPrefs() {
  prefs.begin("stockwaage", false);
  firebasePassword = prefs.getString("fbPass", "");
  deviceId         = prefs.getString("devId",  DEFAULT_DEVICE_ID);
  intervalSec      = prefs.getUInt  ("interval", DEFAULT_INTERVAL_SEC);
  Serial.printf("Prefs: devId=%s interval=%us pwSet=%d\n",
                deviceId.c_str(), intervalSec, firebasePassword.length() > 0);
}

// ============================================================================
// WiFi / Captive Portal
// ============================================================================

bool ensureWiFi(bool forcePortal) {
  WiFiManager wm;
  wm.setConfigPortalTimeout(WIFI_PORTAL_TIMEOUT_SEC);
  wm.setConnectTimeout(WIFI_CONNECT_TIMEOUT_SEC);

  WiFiManagerParameter pwParam("fbpass", "Firebase Passwort",
                               firebasePassword.c_str(), 64,
                               "type=\"password\"");
  WiFiManagerParameter idParam("devid",  "Device ID",
                               deviceId.c_str(), 32);
  char intervalBuf[12];
  snprintf(intervalBuf, sizeof(intervalBuf), "%u", intervalSec);
  WiFiManagerParameter ivParam("interval", "Intervall (Sek.)",
                               intervalBuf, 8);
  wm.addParameter(&pwParam);
  wm.addParameter(&idParam);
  wm.addParameter(&ivParam);

  bool connected;
  if (forcePortal || firebasePassword.length() == 0) {
    Serial.println("Starte Config Portal...");
    connected = wm.startConfigPortal(AP_SSID);
  } else {
    Serial.println("AutoConnect...");
    connected = wm.autoConnect(AP_SSID);
  }

  if (!connected) return false;

  // Geaenderte Params persistieren
  String newPw = pwParam.getValue();
  String newId = idParam.getValue();
  uint32_t newIv = (uint32_t)atoi(ivParam.getValue());
  if (newIv < 30) newIv = 30;   // Sicherheits-Untergrenze

  if (newPw != firebasePassword) prefs.putString("fbPass", newPw);
  if (newId != deviceId)         prefs.putString("devId",  newId);
  if (newIv != intervalSec)      prefs.putUInt  ("interval", newIv);
  firebasePassword = newPw;
  deviceId         = newId;
  intervalSec      = newIv;

  Serial.printf("WiFi verbunden: %s, IP %s\n",
                WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());
  return true;
}

// ============================================================================
// Zeit ueber NTP
// ============================================================================

bool syncTime() {
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 5000)) {
    Serial.println("NTP fehlgeschlagen");
    return false;
  }
  Serial.printf("Zeit: %04d-%02d-%02d %02d:%02d:%02d UTC\n",
                timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
  return true;
}

// ============================================================================
// Sensoren
// ============================================================================

void initSensors() {
  for (int i = 0; i < NUM_SCALES; i++) {
    scales[i].begin(PIN_HX711_DT[i], PIN_HX711_SCK);
  }
  ds.begin();
  ds.setWaitForConversion(true);
}

void readScalesInto(JsonObject obj) {
  for (int i = 0; i < NUM_SCALES; i++) {
    if (!scales[i].wait_ready_timeout(500)) {
      Serial.printf("  scale %d: timeout\n", i + 1);
      continue;
    }
    long raw = scales[i].read_average(5);
    char key[8];
    snprintf(key, sizeof(key), "s%d", i + 1);
    obj[key] = (double)raw;   // unscaliert; Kalibrierung kommt spaeter
    Serial.printf("  %s: %ld\n", key, raw);
  }
}

void readTempsInto(JsonObject obj) {
  ds.requestTemperatures();
  int n = ds.getDeviceCount();
  Serial.printf("DS18B20 gefunden: %d\n", n);
  for (int i = 0; i < n; i++) {
    DeviceAddress addr;
    if (!ds.getAddress(addr, i)) continue;
    float t = ds.getTempC(addr);
    if (t == DEVICE_DISCONNECTED_C) continue;
    char key[20];
    snprintf(key, sizeof(key), "%02x%02x%02x%02x%02x%02x%02x%02x",
             addr[0], addr[1], addr[2], addr[3],
             addr[4], addr[5], addr[6], addr[7]);
    obj[key] = t;
    Serial.printf("  %s: %.2f C\n", key, t);
  }
}

float readVBat() {
  int raw = analogRead(PIN_VBAT_ADC);
  float v = (raw / VBAT_ADC_MAX) * VBAT_ADC_REF * VBAT_DIVIDER;
  Serial.printf("VBat: %.2f V (raw %d)\n", v, raw);
  return v;
}

// ============================================================================
// Firebase (REST)
// ============================================================================

bool firebaseLogin() {
  HTTPClient http;
  String url = String("https://identitytoolkit.googleapis.com/v1/accounts:"
                      "signInWithPassword?key=") + FIREBASE_API_KEY;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> req;
  req["email"] = FIREBASE_EMAIL;
  req["password"] = firebasePassword;
  req["returnSecureToken"] = true;
  String body;
  serializeJson(req, body);

  int code = http.POST(body);
  String resp = http.getString();
  http.end();

  if (code != 200) {
    Serial.printf("Login fehlgeschlagen: %d\n%s\n", code, resp.c_str());
    return false;
  }

  DynamicJsonDocument res(2048);
  if (deserializeJson(res, resp)) return false;
  idToken = String((const char*)res["idToken"]);
  return idToken.length() > 0;
}

bool firestorePatch(const String& docPath, const String& body) {
  HTTPClient http;
  String url = String("https://firestore.googleapis.com/v1/projects/")
             + FIREBASE_PROJECT_ID
             + "/databases/(default)/documents/" + docPath;
  http.begin(url);
  http.addHeader("Authorization", String("Bearer ") + idToken);
  http.addHeader("Content-Type", "application/json");
  int code = http.PATCH(body);
  if (code < 200 || code >= 300) {
    Serial.printf("PATCH %s failed: %d\n%s\n",
                  docPath.c_str(), code, http.getString().c_str());
    http.end();
    return false;
  }
  http.end();
  return true;
}

void buildMapField(JsonObject parent, const char* key, JsonObject values) {
  JsonObject mapVal = parent.createNestedObject(key)
                            .createNestedObject("mapValue")
                            .createNestedObject("fields");
  for (JsonPair kv : values) {
    mapVal[kv.key()]["doubleValue"] = kv.value().as<double>();
  }
}

bool sendReading(JsonObject scalesObj, JsonObject tempsObj, float vbat) {
  uint64_t tsMs = (uint64_t)time(nullptr) * 1000ULL;
  String docPath = String("users/") + OWNER_UID
                 + "/devices/" + deviceId
                 + "/readings/" + String((unsigned long long)tsMs);

  DynamicJsonDocument doc(4096);
  JsonObject fields = doc.createNestedObject("fields");
  fields["ts"]["integerValue"]    = String((unsigned long long)tsMs);
  fields["vBat"]["doubleValue"]   = vbat;
  fields["boots"]["integerValue"] = String(bootCount);
  buildMapField(fields, "scales", scalesObj);
  buildMapField(fields, "temps",  tempsObj);

  String body;
  serializeJson(doc, body);
  return firestorePatch(docPath, body);
}

bool sendHeartbeat(float vbat) {
  uint64_t tsMs = (uint64_t)time(nullptr) * 1000ULL;
  String docPath = String("users/") + OWNER_UID + "/devices/" + deviceId
                 + "?updateMask.fieldPaths=lastSeen"
                   "&updateMask.fieldPaths=deviceId"
                   "&updateMask.fieldPaths=vBat"
                   "&updateMask.fieldPaths=intervalSec";

  DynamicJsonDocument doc(512);
  JsonObject fields = doc.createNestedObject("fields");
  fields["lastSeen"]["integerValue"]    = String((unsigned long long)tsMs);
  fields["deviceId"]["stringValue"]     = deviceId;
  fields["vBat"]["doubleValue"]         = vbat;
  fields["intervalSec"]["integerValue"] = String(intervalSec);

  String body;
  serializeJson(doc, body);
  return firestorePatch(docPath, body);
}

// ============================================================================
// Main
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(200);

  bootCount++;
  Serial.printf("\n=== Stockwaage Boot #%d ===\n", bootCount);

  bool forcePortal = shouldForcePortal();
  if (forcePortal) Serial.println("BOOT-Taster gedrueckt -> Portal erzwingen");

  loadPrefs();

  if (!ensureWiFi(forcePortal)) {
    Serial.println("Kein WiFi - schlafen.");
    enterDeepSleep(intervalSec);
  }

  syncTime();
  initSensors();

  DynamicJsonDocument tmp(2048);
  JsonObject scalesObj = tmp.createNestedObject("scales");
  JsonObject tempsObj  = tmp.createNestedObject("temps");
  readScalesInto(scalesObj);
  readTempsInto(tempsObj);
  float vbat = readVBat();

  bool ok = false;
  if (firebaseLogin()) {
    bool a = sendReading(scalesObj, tempsObj, vbat);
    bool b = sendHeartbeat(vbat);
    ok = a && b;
  }

  if (ok) {
    lastFailures = 0;
    Serial.println("Upload OK.");
  } else {
    lastFailures++;
    Serial.printf("Upload FAIL (#%u in Folge)\n", lastFailures);
  }

  enterDeepSleep(intervalSec);
}

void loop() {
  // never reached; setup() endet im Deep Sleep
}
