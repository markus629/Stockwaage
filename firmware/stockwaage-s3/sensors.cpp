#include "sensors.h"
#include "runtime_config.h"
#include <HX711.h>
#include <Wire.h>
#include <Adafruit_BMP280.h>
#include <Adafruit_INA219.h>
#include <math.h>

namespace {
HX711 hx[NUM_SCALES];
bool  hxActive[NUM_SCALES] = {false};

Adafruit_BMP280 bmp;   // Hardware: BMP280 (Temp + Druck, KEINE Feuchte)
bool bmpReady = false;

Adafruit_INA219* inaBat = nullptr;
Adafruit_INA219* inaSol = nullptr;
bool inaBatReady = false;
bool inaSolReady = false;

int  envRainPin  = -1;
bool i2cStarted  = false;
} // namespace

namespace sensors {

void init() {
  analogReadResolution(12);
}

void initScales(const int dtPins[NUM_SCALES], int sckPin) {
  // ESP32-S3 hat GPIOs 0-48, plus reservierte SPI-Flash (26-32) und
  // Octal-PSRAM (33-37) bei N*R8 Modulen.
  if (sckPin <= 0 || sckPin >= 50) sckPin = PIN_HX711_SCK;  // Fallback
  bool pinUsed[50] = {false};
  pinUsed[sckPin]        = true;
  pinUsed[PIN_VBAT_ADC]  = true;
  pinUsed[PIN_PORTAL_FORCE] = true;

  for (int i = 0; i < NUM_SCALES; i++) {
    int pin = dtPins[i];
    if (pin <= 0 || pin >= 50 || pinUsed[pin]) {
      hxActive[i] = false;
      continue;
    }
    hx[i].begin(pin, sckPin);
    hxActive[i] = true;
    pinUsed[pin] = true;
  }
}

void initEnv(const MainConfig& cfg) {
  // Re-entrant: bei wiederholtem Aufruf (Wachbetrieb) alten Zustand sauber
  // freigeben, sonst leaken die INA219-Objekte.
  if (inaBat) { delete inaBat; inaBat = nullptr; }
  if (inaSol) { delete inaSol; inaSol = nullptr; }
  bmpReady = inaBatReady = inaSolReady = false;

  const bool needI2C = cfg.bme280Enabled || cfg.inaBatteryEnabled ||
                       cfg.inaSolarEnabled;
  if (needI2C) {
    // Erneutes begin() ist unkritisch und uebernimmt evtl. geaenderte Pins.
    Wire.begin(cfg.i2cSda, cfg.i2cScl);
    Wire.setClock(100000);  // konservativ fuer lange Kabel
    i2cStarted = true;
  }

  if (cfg.bme280Enabled) {
    bmpReady = bmp.begin((uint8_t)cfg.bme280Addr);
    if (!bmpReady) {
      Serial.printf("[bmp280] init failed at 0x%02X\n", cfg.bme280Addr);
    } else {
      // Niedriges Oversampling = schnell, kein Selbstwaerme-Drift bei
      // forced mode. BMP280 hat keine Feuchte.
      bmp.setSampling(Adafruit_BMP280::MODE_FORCED,
                      Adafruit_BMP280::SAMPLING_X1,    // temp
                      Adafruit_BMP280::SAMPLING_X1,    // pressure
                      Adafruit_BMP280::FILTER_OFF);
    }
  }

  if (cfg.inaBatteryEnabled) {
    inaBat = new Adafruit_INA219((uint8_t)cfg.inaBatteryAddr);
    inaBatReady = inaBat->begin(&Wire);
    if (!inaBatReady) {
      Serial.printf("[ina-bat] init failed at 0x%02X\n", cfg.inaBatteryAddr);
    } else {
      inaBat->setCalibration_16V_400mA();  // realistisch fuer LiPo + ESP
    }
  }

  if (cfg.inaSolarEnabled) {
    inaSol = new Adafruit_INA219((uint8_t)cfg.inaSolarAddr);
    inaSolReady = inaSol->begin(&Wire);
    if (!inaSolReady) {
      Serial.printf("[ina-sol] init failed at 0x%02X\n", cfg.inaSolarAddr);
    } else {
      inaSol->setCalibration_32V_2A();  // Solar kann hoeher / mehr Strom
    }
  }

  envRainPin = (cfg.rainEnabled && cfg.rainPin > 0) ? cfg.rainPin : -1;
}

void readScalesRaw(double rawOut[NUM_SCALES]) {
  for (int i = 0; i < NUM_SCALES; i++) {
    if (!hxActive[i]) { rawOut[i] = NAN; continue; }
    if (!hx[i].wait_ready_timeout(500)) { rawOut[i] = NAN; continue; }
    long r = hx[i].read_average(5);
    rawOut[i] = (double)r;
  }
}

double readScaleRawAvg(int idx, int samples) {
  if (idx < 0 || idx >= NUM_SCALES) return NAN;
  if (!hxActive[idx]) return NAN;
  if (!hx[idx].wait_ready_timeout(1000)) return NAN;
  if (samples < 1) samples = 1;
  return (double)hx[idx].read_average(samples);
}

void readEnv(EnvReading& out, const MainConfig& /*cfg*/) {
  if (bmpReady) {
    bmp.takeForcedMeasurement();
    float t = bmp.readTemperature();
    float p = bmp.readPressure();
    if (!isnan(t)) out.tempC    = (double)t;
    if (!isnan(p) && p > 0) out.pressure = (double)p / 100.0; // hPa
    // BMP280: keine Luftfeuchte.
  }
  if (inaBatReady && inaBat) {
    float v = inaBat->getBusVoltage_V();
    float i = inaBat->getCurrent_mA();
    out.batteryV = (double)v;
    out.batteryA = (double)i / 1000.0;  // A
  }
  if (inaSolReady && inaSol) {
    float v = inaSol->getBusVoltage_V();
    float i = inaSol->getCurrent_mA();
    out.solarV = (double)v;
    out.solarA = (double)i / 1000.0;
  }
  if (envRainPin > 0) {
    out.rainRaw = analogRead(envRainPin);
  }
}

float readVBat() {
  int raw = analogRead(PIN_VBAT_ADC);
  return (raw / VBAT_ADC_MAX) * VBAT_ADC_REF * VBAT_DIVIDER;
}

bool powerDown() {
  bool anyScale = false;
  for (int i = 0; i < NUM_SCALES; i++) {
    if (hxActive[i]) {
      hx[i].power_down();   // HX711 in Standby (~1.5mA -> ~1.5uA)
      anyScale = true;
    }
  }
  // INA219 in Power-Down (~1mA -> ~6uA). Beim naechsten Boot re-initialisiert
  // initEnv die INAs wieder (begin + setCalibration).
  if (inaBatReady && inaBat) inaBat->powerSave(true);
  if (inaSolReady && inaSol) inaSol->powerSave(true);
  // BME280: Forced-Mode -> schlaeft nach jeder Messung selbst, nichts zu tun.
  return anyScale;
}

} // namespace sensors
