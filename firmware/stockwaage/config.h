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

// ----- Firmware Version + Update --------------------------------------------
// FIRMWARE_VERSION wird beim CI-Build aus dem Git-Tag gesetzt (-D Flag).
// Lokale Arduino-IDE-Builds laufen ohne und zeigen "dev".
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION    "dev"
#endif
#define GITHUB_RELEASES_URL \
  "https://api.github.com/repos/markus629/Stockwaage/releases/latest"

// ----- Hardware Pin-Belegung (ESP32-S3-WROOM-1 N16R8) -----------------------
// Reserviert vom Chip/Modul: 19,20 (USB), 26-32 (SPI Flash), 33-37 (Octal
// PSRAM), 43,44 (UART0). Strapping: 0,3,45,46. Onboard NeoPixel: 48.
// HX711: alle teilen sich SCK, jeder hat eigenen DT
#define PIN_HX711_SCK       4

#define NUM_SCALES          8
static const int PIN_HX711_DT[NUM_SCALES] = {
  13, 14, 15, 16, 17, 18, 21, 38
};

// Umgebungssensoren (BME280, INA219x2, Regen) kommen ueber I2C bzw.
// frei waehlbare Pins - Konfiguration liegt in Firestore (mainConfig).

// Akku-Spannung messen (Spannungsteiler 100k/100k empfohlen)
// ADC1 auf S3 = GPIO 1-10, kein WiFi-Konflikt
#define PIN_VBAT_ADC        1
#define VBAT_DIVIDER        2.0f      // Faktor wegen Spannungsteiler
#define VBAT_ADC_REF        3.3f
#define VBAT_ADC_MAX        4095.0f

// BOOT-Taster zum Forcieren des Captive Portals (waehrend Aufwachen halten)
#define PIN_PORTAL_FORCE    0

// Onboard-NeoPixel (WS2812) fuer Status-Feedback
#define PIN_NEOPIXEL        48

// ----- Default-Werte (vom User ueberschreibbar) -----------------------------
#define DEFAULT_DEVICE_ID         "esp-01"
#define DEFAULT_INTERVAL_SEC      900   // 15 Minuten
#define WIFI_PORTAL_TIMEOUT_SEC   180   // 3 Min, danach Deep Sleep
#define WIFI_CONNECT_TIMEOUT_SEC  20

// ----- Schwarm-Erkennung ----------------------------------------------------
// Faellt das Gewicht einer kalibrierten Waage zwischen zwei Messungen um mehr
// als SWARM_DROP_KG (und das negativ -> Verlust), wird ein Alarm-Flag gesetzt.
#define SWARM_DROP_KG             1.5

// ----- Captive Portal -------------------------------------------------------
#define AP_SSID             "stockwaage-setup"
