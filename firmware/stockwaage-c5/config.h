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
// FIRMWARE_VERSION wird beim CI-Build aus dem Git-Tag gesetzt: der Workflow
// generiert dazu fw_version.h mit dem passenden #define. Ein per -D gesetzter
// Wert hat ebenfalls Vorrang. Lokale Arduino-IDE-Builds (ohne fw_version.h)
// zeigen "dev".
#ifndef FIRMWARE_VERSION
  #if defined(__has_include)
    #if __has_include("fw_version.h")
      #include "fw_version.h"
    #endif
  #endif
#endif
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION    "dev"
#endif
#define GITHUB_RELEASES_URL \
  "https://api.github.com/repos/markus629/Stockwaage/releases/latest"
// GitHub-Release-Check nur 1x/Tag (sonst 96 Calls/Tag -> Rate-Limit + Strom).
#define UPDATE_CHECK_INTERVAL_SEC  86400

// ----- Variante (C5 = eine Waage) -------------------------------------------
// Im Heartbeat gemeldet, damit das UI den Typ kennt. OTA waehlt das passende
// Release-Asset ueber FW_ASSET_PREFIX.
#define BOARD_KIND        "c5"
#define FW_ASSET_PREFIX   "stockwaage-c5"

// ----- Datenhaltung ---------------------------------------------------------
// Rohmesswerte (readings) bekommen ein expireAt-Feld; eine Firestore-TTL-
// Policy auf dieses Feld loescht sie automatisch nach Ablauf. Langzeitdaten
// leben in dailyStats (1 Dok/Tag) und bleiben erhalten.
// TTL-Policy einmalig einrichten (siehe README).
#define READINGS_TTL_DAYS  60

// ----- Hardware Pin-Belegung --------------------------------------------------
// 1 ESP = 1 Beute: ein HX711 + ein BMP280 + Akku-Spannung. Feste Pins.
//
// Board waehlen: 1 = Seeed XIAO ESP32-C5, 0 = normaler ESP32 / ESP32-S3
// Dev-Board. Laesst sich auch per Build-Flag setzen (-DBOARD_XIAO_C5=1),
// ohne diese Datei zu aendern. Die CI baut weiterhin das S3-Profil (=0).
#ifndef BOARD_XIAO_C5
#define BOARD_XIAO_C5       0
#endif

#define NUM_SCALES          1     // genau eine Waage pro ESP

#if BOARD_XIAO_C5
  // ----- Seeed XIAO ESP32-C5 -------------------------------------------------
  // Pinbeschriftung laut Seeed-Pinout (GPIO-Nummern). Bei Bedarf an deine
  // Verkabelung anpassen.
  #define PIN_HX711_DT       2     // A1  (Daten)
  #define PIN_HX711_SCK      3     // A2  (Clock; LP-faehig -> Power-Down-Hold)
  #define PIN_I2C_SDA        23    // D4 / SDA
  #define PIN_I2C_SCL        24    // D5 / SCL
  #define PIN_VBAT_ADC       1     // A0  (Akku ueber Spannungsteiler)
  #define PIN_PORTAL_FORCE   28    // BOOT-Taster
#else
  // ----- ESP32 / ESP32-S3 Dev-Board ------------------------------------------
  #define PIN_HX711_DT       13    // Daten
  #define PIN_HX711_SCK      4     // Clock (RTC-faehig <=21 -> Power-Down-Hold)
  #define PIN_I2C_SDA        8
  #define PIN_I2C_SCL        9
  #define PIN_VBAT_ADC       1     // ADC1 (Akku ueber Spannungsteiler)
  #define PIN_PORTAL_FORCE   0     // BOOT-Taster
#endif

#define BMP280_ADDR         0x76  // 0x77 wenn SDO am Modul auf VCC

// Akku-Spannung messen (Spannungsteiler 100k/100k empfohlen)
#define VBAT_DIVIDER        2.0f      // Faktor wegen Spannungsteiler
#define VBAT_ADC_REF        3.3f
#define VBAT_ADC_MAX        4095.0f

// ----- Default-Werte (vom User ueberschreibbar) -----------------------------
#define DEFAULT_DEVICE_ID         "esp-01"
#define DEFAULT_INTERVAL_SEC      900   // 15 Minuten
#define WIFI_PORTAL_TIMEOUT_SEC   180   // 3 Min, danach Deep Sleep
#define WIFI_CONNECT_TIMEOUT_SEC  20

// ----- Captive Portal -------------------------------------------------------
#define AP_SSID             "stockwaage-setup"
