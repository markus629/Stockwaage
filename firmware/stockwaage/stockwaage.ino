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
#include "daily_stats.h"
#include <Adafruit_NeoPixel.h>

// ----- State (ueberlebt Deep Sleep) -----------------------------------------
RTC_DATA_ATTR int     bootCount = 0;
RTC_DATA_ATTR uint8_t failureStreak = 0;

// GitHub-Release-Check wird nur ~1x/Tag durchgefuehrt (spart Calls + Strom).
// Letztes Ergebnis ueberlebt Deep Sleep im RTC-RAM (Strings als char-Puffer,
// da heap-basierte String-Objekte einen Deep Sleep nicht ueberstehen).
RTC_DATA_ATTR uint32_t lastUpdateCheckEpoch = 0;
RTC_DATA_ATTR bool     rtcLatestOk = false;
RTC_DATA_ATTR char     rtcLatestVersion[24]  = {0};
RTC_DATA_ATTR char     rtcLatestUrl[200]      = {0};

// ----- Globals --------------------------------------------------------------
Preferences   prefs;
String        firebasePassword;
String        deviceId;
uint32_t      bootIntervalSec;       // Build-/Portal-Default
String        idToken;
RuntimeConfig cfg;

// Wake-Button-Settings, in NVS gecacht damit der Doppelklick schon VOR
// dem WiFi-Connect erkannt werden kann.
bool     wakeCfgEnabled = false;
int      wakeCfgPin     = 5;
int      wakeCfgLevel   = 0;
uint32_t wakeCfgPauseMin = 30;

// Ergebnis des GitHub-Release-Checks. Wird einmal pro Wakeup frueh in
// setup() geholt (fuer Auto-Update) und im Heartbeat wiederverwendet.
updater::LatestInfo gLatest;

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
  wakeCfgEnabled   = prefs.getBool  ("wkEn",   false);
  wakeCfgPin       = prefs.getInt   ("wkPin",  5);
  wakeCfgLevel     = prefs.getInt   ("wkLvl",  0);
  wakeCfgPauseMin  = prefs.getUInt  ("wkPause", 30);
}

// Onboard-LED kurz gruen blinken (Bestaetigung Messpause).
void blinkPause() {
  Adafruit_NeoPixel px(1, PIN_NEOPIXEL, NEO_GRB + NEO_KHZ800);
  px.begin();
  for (int i = 0; i < 3; i++) {
    px.setPixelColor(0, px.Color(0, 50, 0));
    px.show();
    delay(150);
    px.clear();
    px.show();
    delay(150);
  }
}

// Nach ext0-Wakeup pruefen ob ein zweiter Tastendruck folgt (Doppelklick).
// Der erste Druck haelt den Pin beim Boot noch aktiv -> erst Loslassen
// abwarten, dann ~1.5s Fenster auf den zweiten Druck.
bool detectDoublePress(int pin, int level) {
  const int active = (level == 0) ? LOW : HIGH;
  pinMode(pin, (level == 0) ? INPUT_PULLUP : INPUT_PULLDOWN);
  uint32_t t = millis();
  while (digitalRead(pin) == active && millis() - t < 1500) delay(5);
  delay(40);  // entprellen
  t = millis();
  while (millis() - t < 1500) {
    if (digitalRead(pin) == active) {
      delay(40);
      return true;
    }
    delay(5);
  }
  return false;
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
  // Lokale Zeitzone (Deutschland) fuer den Tages-Key der dailyStats.
  // time(nullptr) bleibt UTC-Epoch (fuer reading-ts), nur localtime()
  // liefert dann CET/CEST.
  setenv("TZ", "CET-1CEST,M3.5.0,M10.5.0/3", 1);
  tzset();
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
  // TTL-Marker: Firestore loescht das Reading nach READINGS_TTL_DAYS (Policy
  // auf "expireAt"). Langzeitdaten leben in dailyStats und bleiben.
  fb::writeTimestamp(fields, "expireAt",
                     (time_t)(tsMs / 1000ULL) + (time_t)READINGS_TTL_DAYS * 86400);
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
  double kgScales[NUM_SCALES];
  JsonObject scalesFields = fields.createNestedObject("scales")
                                  .createNestedObject("mapValue")
                                  .createNestedObject("fields");
  for (int i = 0; i < NUM_SCALES; i++) {
    kgScales[i] = NAN;
    if (isnan(rawScales[i])) continue;
    double kg = isnan(ambientC) ? NAN
                                : cfg.computeKg(i, rawScales[i], ambientC);
    kgScales[i] = kg;
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

  // 2b) Tages-Aggregat fortschreiben (fuer den Langzeit-Graph).
  {
    time_t now = time(nullptr);
    struct tm lt;
    localtime_r(&now, &lt);
    char dayKey[11];
    strftime(dayKey, sizeof(dayKey), "%Y-%m-%d", &lt);
    daily::update(idToken, deviceId, String(dayKey), kgScales, env);
  }

  // 3) Heartbeat. latest-Info kommt aus dem frueheren Check in setup().
  const updater::LatestInfo& latest = gLatest;

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

// HX711-Pins + Umgebungssensoren aus der aktuellen Config (neu) initialisieren.
// Idempotent -> auch im Wachbetrieb bei geaenderten Pins/Sensoren aufrufbar.
void initSensorsFromCfg() {
  int dtPins[NUM_SCALES];
  for (int i = 0; i < NUM_SCALES; i++) {
    // Waagen ohne Doku (exists=false) ueberspringen -> dtPin=-1.
    dtPins[i] = cfg.scales[i].exists ? cfg.scales[i].dtPin : -1;
  }
  sensors::initScales(dtPins, cfg.main.sckPin);
  sensors::initEnv(cfg.main);
}

// Wachbetrieb (Deep Sleep deaktiviert): ESP bleibt wach, uebernimmt
// Einstellungen + Update-Commands sofort und misst weiterhin im eingestellten
// Intervall. Kehrt zurueck, sobald Deep Sleep wieder aktiviert wird.
void runAwakeMode() {
  Serial.println("[awake] Deep Sleep AUS -> bleibe wach");
  uint32_t lastMeasureMs = millis();
  uint32_t lastLoginMs   = millis();
  const uint32_t LOGIN_REFRESH_MS = 50UL * 60UL * 1000UL;  // Token < 1h gueltig

  while (true) {
    delay(3000);

    // WLAN ggf. wiederherstellen.
    if (WiFi.status() != WL_CONNECTED) {
      WiFi.reconnect();
      delay(2000);
    }

    // ID-Token erneuern, bevor er nach ~1h ablaeuft.
    if (millis() - lastLoginMs >= LOGIN_REFRESH_MS) {
      auto lr = fb::login(FIREBASE_EMAIL, firebasePassword);
      if (lr.ok) { idToken = lr.idToken; lastLoginMs = millis(); }
    }

    // Commands (inkl. Firmware-Update) sofort abarbeiten und Config jedes Mal
    // neu laden, damit UI-Einstellungen unmittelbar greifen.
    commands::processPending(idToken, deviceId, cfg);
    cfg.load(idToken, deviceId);

    // Deep Sleep wieder aktiviert? -> raus, normaler Sleep-Zyklus uebernimmt.
    if (cfg.main.deepSleepEnabled) {
      Serial.println("[awake] Deep Sleep wieder AN");
      return;
    }

    // Weiterhin im eingestellten Intervall messen.
    uint32_t ivSec = cfg.main.intervalSec < 30 ? 30 : cfg.main.intervalSec;
    if (millis() - lastMeasureMs >= ivSec * 1000UL) {
      initSensorsFromCfg();   // evtl. geaenderte Pins/Sensoren uebernehmen
      measureAndUpload();
      lastMeasureMs = millis();
    }
  }
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

  // Doppelklick auf den Wake-Button = Messpause. Wird VOR dem WiFi-Connect
  // geprueft, damit das Zeitfenster fuer den zweiten Druck nicht verstreicht.
  if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT0 &&
      wakeCfgEnabled && wakeCfgPin > 0) {
    if (detectDoublePress(wakeCfgPin, wakeCfgLevel)) {
      Serial.printf("[wake] Doppelklick -> Messpause %u min\n",
                    wakeCfgPauseMin);
      blinkPause();
      // ext0-Config aus Cache, damit man die Pause per 1x-Druck beenden kann.
      cfg.main.wakeButtonEnabled = wakeCfgEnabled;
      cfg.main.wakeButtonPin     = wakeCfgPin;
      cfg.main.wakeButtonLevel   = wakeCfgLevel;
      enterDeepSleep(wakeCfgPauseMin * 60);
    }
  }

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

  // Wake-Settings fuer den naechsten Boot cachen (Doppelklick-Erkennung
  // vor WiFi).
  prefs.putBool("wkEn",  cfg.main.wakeButtonEnabled);
  prefs.putInt ("wkPin", cfg.main.wakeButtonPin);
  prefs.putInt ("wkLvl", cfg.main.wakeButtonLevel);
  prefs.putUInt("wkPause", cfg.main.wakePauseMin);

  // HX711 + I2C-Sensoren (BME280, INA219x2) + Regensensor aus der Config.
  initSensorsFromCfg();

  bool cfgChanged = false;
  commands::processPending(idToken, deviceId, cfg, &cfgChanged);
  // Nur erneut laden, wenn ein Command die Config tatsaechlich geaendert hat
  // (tare/cal/stayAwake). Sonst sparen wir uns den zweiten Load-Roundtrip.
  if (cfgChanged) cfg.load(idToken, deviceId);

  // Firmware-Update so frueh wie moeglich pruefen, noch VOR der Messung.
  // So gilt: Neustart -> (falls neuere Version + Auto-Update an) sofort
  // flashen -> fertig, ohne erst den ganzen Messzyklus abzuwarten.
  // Ein manueller Update-Command wurde bereits in processPending behandelt.
  // Der GitHub-Check selbst laeuft aber nur ~1x/Tag (Rate-Limit + Strom);
  // dazwischen kommt das letzte Ergebnis aus dem RTC-RAM.
  {
    time_t nowEpoch = time(nullptr);
    bool checkDue = (lastUpdateCheckEpoch == 0) ||
        ((uint32_t)nowEpoch - lastUpdateCheckEpoch >= UPDATE_CHECK_INTERVAL_SEC);
    if (checkDue) {
      gLatest = updater::fetchLatest();
      if (gLatest.ok) {
        lastUpdateCheckEpoch = (uint32_t)nowEpoch;
        rtcLatestOk = true;
        strncpy(rtcLatestVersion, gLatest.version.c_str(),
                sizeof(rtcLatestVersion) - 1);
        rtcLatestVersion[sizeof(rtcLatestVersion) - 1] = '\0';
        strncpy(rtcLatestUrl, gLatest.binUrl.c_str(),
                sizeof(rtcLatestUrl) - 1);
        rtcLatestUrl[sizeof(rtcLatestUrl) - 1] = '\0';
      }
    } else if (rtcLatestOk) {
      gLatest.ok      = true;
      gLatest.version = rtcLatestVersion;
      gLatest.binUrl  = rtcLatestUrl;
    }
  }
  if (cfg.main.autoUpdateEnabled && gLatest.ok &&
      updater::isNewer(FIRMWARE_VERSION, gLatest.version)) {
    Serial.printf("[auto-update] %s -> %s (sofort)\n",
                  FIRMWARE_VERSION, gLatest.version.c_str());
    updater::applyUpdate(gLatest.binUrl);  // rebootet im Erfolgsfall
    // wenn wir hier landen, ist das Update fehlgeschlagen -> normal weiter.
  }

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
    bool changed = false;
    commands::processPending(idToken, deviceId, cfg, &changed);
    if (changed) cfg.load(idToken, deviceId);
    nowMs = (uint64_t)time(nullptr) * 1000ULL;
  }

  // Deep Sleep deaktiviert? -> wach bleiben statt schlafen (sofortige
  // Uebernahme von Einstellungen/Updates). Kehrt erst zurueck, wenn der
  // Nutzer Deep Sleep wieder einschaltet.
  if (!cfg.main.deepSleepEnabled) {
    runAwakeMode();
  }

  enterDeepSleep(cfg.main.intervalSec);
}

void loop() {
  // never reached
}
