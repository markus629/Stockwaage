#pragma once
#include <Arduino.h>

namespace updater {

struct LatestInfo {
  bool   ok = false;
  String version;     // z.B. "v0.1.2"
  String binUrl;      // browser_download_url des .bin Assets
};

// Holt latest release via GitHub API. Bei Fehler: ok=false.
LatestInfo fetchLatest();

// Vergleich Semver-Strings; true wenn "remote" neuer ist als "local".
// Strips fuehrendes 'v'. "dev" gilt immer als aelter (Update erlaubt).
bool isNewer(const String& local, const String& remote);

// Fuehrt OTA-Download + Apply + Reboot aus. Returnt nur bei Fehler
// (im Erfolgsfall rebootet das System).
bool applyUpdate(const String& binUrl);

} // namespace updater
