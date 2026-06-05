#include "sensors.h"
#include "runtime_config.h"
#include <HX711.h>
#include <Wire.h>
#include <Adafruit_BMP280.h>
#include <math.h>

// 1 ESP = 1 Beute: genau ein HX711 + ein BMP280 (Temperatur). Feste Pins
// aus config.h, keine Laufzeit-Pin-Konfiguration mehr.

namespace {
HX711 hx[NUM_SCALES];
bool  hxActive[NUM_SCALES] = {false};

Adafruit_BMP280 bmp;   // Temp + Druck, KEINE Feuchte
bool bmpReady   = false;
bool i2cStarted = false;
} // namespace

namespace sensors {

void init() {
  analogReadResolution(12);
}

void initScales() {
  hx[0].begin(PIN_HX711_DT, PIN_HX711_SCK);
  hxActive[0] = true;
}

void initEnv(const MainConfig& /*cfg*/) {
  bmpReady = false;
  if (!i2cStarted) {
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
    Wire.setClock(100000);
    i2cStarted = true;
  }
  bmpReady = bmp.begin(BMP280_ADDR);
  if (!bmpReady) {
    Serial.printf("[bmp280] init failed at 0x%02X\n", BMP280_ADDR);
  } else {
    // Niedriges Oversampling + Forced-Mode -> schnell, schlaeft danach selbst.
    bmp.setSampling(Adafruit_BMP280::MODE_FORCED,
                    Adafruit_BMP280::SAMPLING_X1,    // temp
                    Adafruit_BMP280::SAMPLING_X1,    // pressure
                    Adafruit_BMP280::FILTER_OFF);
  }
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
    if (!isnan(t)) out.tempC = (double)t;
    // Feuchte/Druck/INA/Regen entfallen in dieser Variante.
  }
}

float readVBat() {
  int raw = analogRead(PIN_VBAT_ADC);
  return (raw / VBAT_ADC_MAX) * VBAT_ADC_REF * VBAT_DIVIDER;
}

bool powerDown() {
  bool any = false;
  for (int i = 0; i < NUM_SCALES; i++) {
    if (hxActive[i]) { hx[i].power_down(); any = true; }
  }
  // BMP280: Forced-Mode -> schlaeft nach jeder Messung selbst.
  return any;
}

} // namespace sensors
