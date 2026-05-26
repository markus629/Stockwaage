#pragma once

// ============================================================================
// Stockwaage Firmware - Build-Time-Konfiguration
// ============================================================================
// Sensible Werte (Passwoerter) NICHT hier - die kommen zur Laufzeit ueber das
// Captive Portal (WiFiManager) und werden in NVS gespeichert.

// ----- Firebase Projekt (oeffentliche Werte, dauerhaft) ---------------------
#define FIREBASE_API_KEY    "AIzaSyBjcUs-NXaSSw38bJtCfn2J2Oiln7tsd2U"
#define FIREBASE_PROJECT_ID "stockwaage-132b6"
#define FIREBASE_EMAIL      "markus@strogg.de"
#define OWNER_UID           "F1k284u9bmbJcOkEqt7O8BNOLN53"

// ----- Hardware Pin-Belegung (ESP32 WROOM-32) -------------------------------
// HX711: alle teilen sich SCK, jeder hat eigenen DT
#define PIN_HX711_SCK       4

#define NUM_SCALES          8
static const int PIN_HX711_DT[NUM_SCALES] = {
  13, 14, 16, 17, 18, 19, 21, 22
};

// DHT22/AM2302 fuer Temperatur + Feuchtigkeit (1 Sensor pro Pin)
#define PIN_DHT             23
#define DHT_TYPE            DHT22

// Akku-Spannung messen (Spannungsteiler 100k/100k empfohlen)
#define PIN_VBAT_ADC        32
#define VBAT_DIVIDER        2.0f      // Faktor wegen Spannungsteiler
#define VBAT_ADC_REF        3.3f
#define VBAT_ADC_MAX        4095.0f

// BOOT-Taster zum Forcieren des Captive Portals (waehrend Aufwachen halten)
#define PIN_PORTAL_FORCE    0

// ----- Default-Werte (vom User ueberschreibbar) -----------------------------
#define DEFAULT_DEVICE_ID         "esp-01"
#define DEFAULT_INTERVAL_SEC      900   // 15 Minuten
#define WIFI_PORTAL_TIMEOUT_SEC   180   // 3 Min, danach Deep Sleep
#define WIFI_CONNECT_TIMEOUT_SEC  20

// ----- Captive Portal -------------------------------------------------------
#define AP_SSID             "stockwaage-setup"
