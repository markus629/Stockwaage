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
#include <driver/rtc_io.h>
#include <esp_sleep.h>
#include <time.h>
#include <math.h>

#include "config.h"
#include "firebase.h"
#include "sensors.h"
#include "runtime_config.h"
#include "commands.h"
#include "updater.h"

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
  if (cfg.main.wakeButtonEnabled && cfg.main.wakeButtonPin > 0) {
    gpio_num_t pin = (gpio_num_t)cfg.main.wakeButtonPin;
    if (rtc_gpio_is_valid_gpio(pin)) {
      // Bei LOW-Trigger den internen Pull-Up aktivieren, sonst Pull-Down.
      if (cfg.main.wakeButtonLevel == 0) {
        rtc_gpio_pullup_en(pin);
        rtc_gpio_pulldown_dis(pin);
      } else {
        rtc_gpio_pulldown_en(pin);
        rtc_gpio_pullup_dis(pin);
      }
      esp_sleep_enable_ext0_wakeup(pin, cfg.main.wakeButtonLevel);
    } else {
      Serial.printf("[wake] GPIO %d ist nicht RTC-faehig\n", (int)pin);
    }
  }
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

  sensors::EnvReading env;
  sensors::readEnv(env, cfg.main);

  float vBat = sensors::readVBat();

  // 2) Reading-Dokument bauen
  uint64_t tsMs = (uint64_t)time(nullptr) * 1000ULL;
  DynamicJsonDocument out(4096);
  JsonObject fields = out.createNestedObject("fields");
  fb::writeInteger(fields, "ts",    (long long)tsMs);
  fb::writeNumber (fields, "vBat",  vBat);
  fb::writeInteger(fields, "boots", bootCount);
  if (!isnan(env.tempC))    fb::writeNumber(fields, "ambientC",        env.tempC);
  if (!isnan(env.humidity)) fb::writeNumber(fields, "ambientHumidity", env.humidity);
  if (!isnan(env.pressure)) fb::writeNumber(fields, "ambientPressure", env.pressure);
  if (!isnan(env.batteryV)) fb::writeNumber(fields, "batteryV",        env.batteryV);
  if (!isnan(env.batteryA)) fb::writeNumber(fields, "batteryA",        env.batteryA);
  if (!isnan(env.solarV))   fb::writeNumber(fields, "solarV",          env.solarV);
  if (!isnan(env.solarA))   fb::writeNumber(fields, "solarA",          env.solarA);
  if (env.rainRaw >= 0)     fb::writeInteger(fields, "rainRaw",        env.rainRaw);

  // ambientC fuer die Waagen-Temperaturkompensation.
  const double ambientC = env.tempC;

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

  String body;
  serializeJson(out, body);

  String docPath = String("users/") + OWNER_UID + "/devices/" + deviceId
                 + "/readings/" + String((unsigned long long)tsMs);
  if (!fb::patchDoc(idToken, docPath, body)) return false;

  // 3) Heartbeat (inkl. latest-Firmware-Check von GitHub)
  updater::LatestInfo latest = updater::fetchLatest();

  DynamicJsonDocument hb(1024);
  JsonObject hbf = hb.createNestedObject("fields");
  fb::writeInteger(hbf, "lastSeen",        (long long)tsMs);
  fb::writeString (hbf, "deviceId",        deviceId);
  fb::writeNumber (hbf, "vBat",            vBat);
  fb::writeInteger(hbf, "intervalSec",     cfg.main.intervalSec);
  fb::writeString (hbf, "firmwareVersion", FIRMWARE_VERSION);
  if (latest.ok) {
    fb::writeString(hbf, "latestFirmwareVersion", latest.version);
    fb::writeString(hbf, "latestFirmwareUrl",     latest.binUrl);
  }
  String hbBody;
  serializeJson(hb, hbBody);
  fb::patchDoc(
    idToken, String("users/") + OWNER_UID + "/devices/" + deviceId,
    hbBody,
    latest.ok
      ? "lastSeen,deviceId,vBat,intervalSec,firmwareVersion,latestFirmwareVersion,latestFirmwareUrl"
      : "lastSeen,deviceId,vBat,intervalSec,firmwareVersion");
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

  // I2C-Sensoren (BME280, INA219x2) + Regensensor.
  sensors::initEnv(cfg.main);

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
