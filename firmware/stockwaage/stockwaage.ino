// ============================================================================
// Stockwaage - ESP32 Firmware (Haupt-Flow)
// ----------------------------------------------------------------------------
// Wakeup -> WiFi (Portal beim ersten Mal) -> NTP -> Config laden -> Commands
// abarbeiten -> Sensoren messen -> Firestore -> Stay-Awake-Loop oder
// Deep Sleep.
// ============================================================================

#include <WiFi.h>
#include <WiFiManager.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>
#include <math.h>

#include "config.h"
#include "firebase.h"
#include "sensors.h"
#include "runtime_config.h"
#include "commands.h"

// ----- State (ueberlebt Deep Sleep) -----------------------------------------
RTC_DATA_ATTR int     bootCount = 0;
RTC_DATA_ATTR uint8_t failureStreak = 0;

// ----- Globals --------------------------------------------------------------
Preferences   prefs;
String        firebasePassword;
String        deviceId;
uint32_t      bootIntervalSec;       // Build-/Portal-Default
String        idToken;
RuntimeConfig cfg;

// ============================================================================
// Helper
// ============================================================================

void enterDeepSleep(uint32_t seconds) {
  if (seconds < 30) seconds = 30;
  Serial.printf("Deep Sleep %u s\n", seconds);
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
  bootIntervalSec  = prefs.getUInt  ("interval", DEFAULT_INTERVAL_SEC);
}

bool ensureWiFi(bool forcePortal) {
  WiFiManager wm;
  wm.setConfigPortalTimeout(WIFI_PORTAL_TIMEOUT_SEC);
  wm.setConnectTimeout(WIFI_CONNECT_TIMEOUT_SEC);

  WiFiManagerParameter pwParam("fbpass", "Firebase Passwort",
                               firebasePassword.c_str(), 64,
                               "type=\"password\"");
  WiFiManagerParameter idParam("devid",  "Device ID",
                               deviceId.c_str(), 32);
  char ivBuf[12];
  snprintf(ivBuf, sizeof(ivBuf), "%u", bootIntervalSec);
  WiFiManagerParameter ivParam("interval", "Intervall (Sek.)", ivBuf, 8);

  wm.addParameter(&pwParam);
  wm.addParameter(&idParam);
  wm.addParameter(&ivParam);

  bool connected;
  if (forcePortal || firebasePassword.length() == 0) {
    Serial.println("Config Portal...");
    connected = wm.startConfigPortal(AP_SSID);
  } else {
    connected = wm.autoConnect(AP_SSID);
  }
  if (!connected) return false;

  String   newPw = pwParam.getValue();
  String   newId = idParam.getValue();
  uint32_t newIv = (uint32_t)atoi(ivParam.getValue());
  if (newIv < 30) newIv = 30;

  if (newPw != firebasePassword) prefs.putString("fbPass", newPw);
  if (newId != deviceId)         prefs.putString("devId",  newId);
  if (newIv != bootIntervalSec)  prefs.putUInt  ("interval", newIv);
  firebasePassword = newPw;
  deviceId         = newId;
  bootIntervalSec  = newIv;

  Serial.printf("WiFi: %s, IP %s\n",
                WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());
  return true;
}

bool syncTime() {
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
  struct tm tm;
  return getLocalTime(&tm, 5000);
}

// ============================================================================
// Messzyklus: einmal Sensoren -> Firestore.
// ============================================================================

bool measureAndUpload() {
  // 1) Sensoren lesen
  double rawScales[NUM_SCALES];
  sensors::readScalesRaw(rawScales);

  DynamicJsonDocument tempDoc(2048);
  JsonObject tempsObj = tempDoc.to<JsonObject>();
  sensors::readTemps(tempsObj);
  float vBat = sensors::readVBat();

  // Aussentemperatur aus konfigurierter Sensor-Adresse, sonst Durchschnitt
  double ambientC = NAN;
  if (cfg.main.ambientTempAddr.length() > 0 &&
      tempsObj.containsKey(cfg.main.ambientTempAddr.c_str())) {
    ambientC = tempsObj[cfg.main.ambientTempAddr.c_str()].as<double>();
  } else if (!tempsObj.isNull()) {
    double sum = 0; int n = 0;
    for (JsonPair kv : tempsObj) { sum += kv.value().as<double>(); n++; }
    if (n > 0) ambientC = sum / n;
  }

  // 2) Reading-Dokument bauen
  uint64_t tsMs = (uint64_t)time(nullptr) * 1000ULL;
  DynamicJsonDocument out(8192);
  JsonObject fields = out.createNestedObject("fields");
  fb::writeInteger(fields, "ts",    (long long)tsMs);
  fb::writeNumber (fields, "vBat",  vBat);
  fb::writeInteger(fields, "boots", bootCount);
  if (!isnan(ambientC)) fb::writeNumber(fields, "ambientC", ambientC);

  // scales: { s1: { raw, kg }, ... } als verschachtelte Map
  JsonObject scalesFields = fields.createNestedObject("scales")
                                  .createNestedObject("mapValue")
                                  .createNestedObject("fields");
  for (int i = 0; i < NUM_SCALES; i++) {
    if (isnan(rawScales[i])) continue;
    double kg = isnan(ambientC) ? NAN
                                : cfg.computeKg(i, rawScales[i], ambientC);
    JsonObject scaleEntry = scalesFields.createNestedObject(scaleId(i).c_str())
                                        .createNestedObject("mapValue")
                                        .createNestedObject("fields");
    fb::writeNumber(scaleEntry, "raw", rawScales[i]);
    if (!isnan(kg)) fb::writeNumber(scaleEntry, "kg", kg);
  }

  // temps: { addr: °C }
  JsonObject tempsFields = fields.createNestedObject("temps")
                                 .createNestedObject("mapValue")
                                 .createNestedObject("fields");
  for (JsonPair kv : tempsObj) {
    tempsFields[kv.key().c_str()]["doubleValue"] = kv.value().as<double>();
  }

  String body;
  serializeJson(out, body);

  String docPath = String("users/") + OWNER_UID + "/devices/" + deviceId
                 + "/readings/" + String((unsigned long long)tsMs);
  if (!fb::patchDoc(idToken, docPath, body)) return false;

  // 3) Heartbeat
  DynamicJsonDocument hb(512);
  JsonObject hbf = hb.createNestedObject("fields");
  fb::writeInteger(hbf, "lastSeen",    (long long)tsMs);
  fb::writeString (hbf, "deviceId",    deviceId);
  fb::writeNumber (hbf, "vBat",        vBat);
  fb::writeInteger(hbf, "intervalSec", cfg.main.intervalSec);
  String hbBody;
  serializeJson(hb, hbBody);
  fb::patchDoc(idToken, String("users/") + OWNER_UID + "/devices/" + deviceId,
               hbBody, "lastSeen,deviceId,vBat,intervalSec");
  return true;
}

// ============================================================================
// Setup / Loop
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(200);
  bootCount++;
  Serial.printf("\n=== Stockwaage Boot #%d ===\n", bootCount);

  bool forcePortal = shouldForcePortal();
  if (forcePortal) Serial.println("BOOT-Taster -> Portal");

  loadPrefs();

  if (!ensureWiFi(forcePortal)) {
    Serial.println("WiFi failed -> sleep");
    enterDeepSleep(bootIntervalSec);
  }
  syncTime();
  sensors::init();

  // Login einmal pro Wakeup
  auto lr = fb::login(FIREBASE_EMAIL, firebasePassword);
  if (!lr.ok) {
    Serial.printf("Login failed: %s\n", lr.error.c_str());
    enterDeepSleep(bootIntervalSec);
  }
  idToken = lr.idToken;

  // Config + Commands. Portal-Wert dient als Default, falls Firestore leer.
  cfg.main.intervalSec = bootIntervalSec;
  cfg.load(idToken, deviceId);

  // HX711 mit den DT-Pins aus der Firestore-Config initialisieren.
  // Waagen ohne Doku (exists=false) werden ueberspringen -> dtPin=-1.
  int dtPins[NUM_SCALES];
  for (int i = 0; i < NUM_SCALES; i++) {
    dtPins[i] = cfg.scales[i].exists ? cfg.scales[i].dtPin : -1;
  }
  sensors::initScales(dtPins);

  commands::processPending(idToken, deviceId, cfg);
  // commands haben evtl. die Config geaendert (tare/cal) -> erneut laden
  cfg.load(idToken, deviceId);

  bool ok = measureAndUpload();
  if (ok) { failureStreak = 0; Serial.println("Upload OK"); }
  else    { failureStreak++;   Serial.println("Upload FAIL"); }

  // Stay-Awake: ESP bleibt wach und pollt commands, solange stayAwakeUntilMs
  // in der Zukunft liegt.
  uint64_t nowMs = (uint64_t)time(nullptr) * 1000ULL;
  while (cfg.main.stayAwakeUntilMs > nowMs) {
    Serial.printf("StayAwake noch %llu s\n",
                  (cfg.main.stayAwakeUntilMs - nowMs) / 1000ULL);
    delay(3000);
    commands::processPending(idToken, deviceId, cfg);
    cfg.load(idToken, deviceId);
    nowMs = (uint64_t)time(nullptr) * 1000ULL;
  }

  enterDeepSleep(cfg.main.intervalSec);
}

void loop() {
  // never reached
}
