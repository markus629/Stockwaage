#include "sensors.h"
#include <HX711.h>
#include <DHT.h>
#include <math.h>

namespace {
HX711 hx[NUM_SCALES];
bool  hxActive[NUM_SCALES] = {false};
DHT   dht(PIN_DHT, DHT_TYPE);
} // namespace

namespace sensors {

void init() {
  dht.begin();
  analogReadResolution(12);
}

void initScales(const int dtPins[NUM_SCALES]) {
  bool pinUsed[40] = {false};
  pinUsed[PIN_HX711_SCK] = true;          // SCK ist gemeinsam
  pinUsed[PIN_DHT]       = true;
  pinUsed[PIN_VBAT_ADC]  = true;
  pinUsed[PIN_PORTAL_FORCE] = true;

  for (int i = 0; i < NUM_SCALES; i++) {
    int pin = dtPins[i];
    if (pin <= 0 || pin >= 40 || pinUsed[pin]) {
      hxActive[i] = false;
      continue;
    }
    hx[i].begin(pin, PIN_HX711_SCK);
    hxActive[i] = true;
    pinUsed[pin] = true;
  }
}

void readScalesRaw(double rawOut[NUM_SCALES]) {
  for (int i = 0; i < NUM_SCALES; i++) {
    if (!hxActive[i]) { rawOut[i] = NAN; continue; }
    if (!hx[i].wait_ready_timeout(500)) {
      rawOut[i] = NAN;
      continue;
    }
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

void readEnvironment(double& tempC, double& humidity) {
  // DHT22 braucht ~2s zwischen Reads. Bei Cold-Boot direkt nach init()
  // ist der erste Read oft NAN, daher zweimal versuchen.
  for (int attempt = 0; attempt < 2; attempt++) {
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t) && !isnan(h)) {
      tempC = (double)t;
      humidity = (double)h;
      return;
    }
    delay(2100);
  }
  tempC = NAN;
  humidity = NAN;
}

float readVBat() {
  int raw = analogRead(PIN_VBAT_ADC);
  return (raw / VBAT_ADC_MAX) * VBAT_ADC_REF * VBAT_DIVIDER;
}

} // namespace sensors
