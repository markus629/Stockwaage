#include "sensors.h"
#include <HX711.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <math.h>

namespace {
HX711 hx[NUM_SCALES];
bool  hxActive[NUM_SCALES] = {false};
OneWire oneWire(PIN_ONEWIRE);
DallasTemperature ds(&oneWire);

String addrToHex(const uint8_t* a) {
  char buf[24];
  snprintf(buf, sizeof(buf), "%02x-%02x%02x%02x%02x%02x%02x%02x",
           a[0], a[1], a[2], a[3], a[4], a[5], a[6]);
  return String(buf);
}
} // namespace

namespace sensors {

void init() {
  ds.begin();
  ds.setWaitForConversion(true);
  analogReadResolution(12);
}

void initScales(const int dtPins[NUM_SCALES]) {
  bool pinUsed[40] = {false};
  pinUsed[PIN_HX711_SCK] = true;          // SCK ist gemeinsam
  pinUsed[PIN_ONEWIRE]   = true;
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

void readTemps(JsonObject mapOut) {
  ds.requestTemperatures();
  int n = ds.getDeviceCount();
  for (int i = 0; i < n; i++) {
    DeviceAddress a;
    if (!ds.getAddress(a, i)) continue;
    float t = ds.getTempC(a);
    if (t == DEVICE_DISCONNECTED_C) continue;
    mapOut[addrToHex(a).c_str()] = t;
  }
}

float readVBat() {
  int raw = analogRead(PIN_VBAT_ADC);
  return (raw / VBAT_ADC_MAX) * VBAT_ADC_REF * VBAT_DIVIDER;
}

} // namespace sensors
