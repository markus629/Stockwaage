#include "updater.h"
#include "config.h"
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <WiFiClientSecure.h>

namespace updater {

LatestInfo fetchLatest() {
  LatestInfo out;
  WiFiClientSecure client;
  client.setInsecure();  // GitHub: kein CA-Bundle, vertrauen via DNS+TLS
  HTTPClient http;
  http.setTimeout(8000);
  if (!http.begin(client, GITHUB_RELEASES_URL)) {
    Serial.println("[update] http.begin failed");
    return out;
  }
  http.addHeader("User-Agent", "Stockwaage-ESP");
  http.addHeader("Accept", "application/vnd.github+json");
  int code = http.GET();
  if (code != 200) {
    Serial.printf("[update] GET releases -> %d\n", code);
    http.end();
    return out;
  }
  String body = http.getString();
  http.end();

  DynamicJsonDocument doc(8192);
  if (deserializeJson(doc, body)) {
    Serial.println("[update] JSON parse failed");
    return out;
  }
  out.version = doc["tag_name"].as<String>();
  JsonArray assets = doc["assets"];
  for (JsonObject a : assets) {
    String name = a["name"].as<String>();
    if (name.endsWith(".bin")) {
      out.binUrl = a["browser_download_url"].as<String>();
      break;
    }
  }
  out.ok = out.version.length() > 0 && out.binUrl.length() > 0;
  return out;
}

static int splitSemver(const String& s, int parts[3]) {
  String v = s;
  if (v.startsWith("v") || v.startsWith("V")) v = v.substring(1);
  parts[0] = parts[1] = parts[2] = 0;
  int n = 0, start = 0;
  for (int i = 0; i <= (int)v.length() && n < 3; i++) {
    if (i == (int)v.length() || v[i] == '.' || v[i] == '-') {
      String chunk = v.substring(start, i);
      parts[n++] = chunk.toInt();
      start = i + 1;
      if (i < (int)v.length() && v[i] == '-') break;
    }
  }
  return n;
}

bool isNewer(const String& local, const String& remote) {
  if (remote.length() == 0) return false;
  if (local == "dev" || local.length() == 0) return true;
  int l[3], r[3];
  splitSemver(local, l);
  splitSemver(remote, r);
  for (int i = 0; i < 3; i++) {
    if (r[i] > l[i]) return true;
    if (r[i] < l[i]) return false;
  }
  return false;
}

bool applyUpdate(const String& binUrl) {
  Serial.printf("[update] downloading %s\n", binUrl.c_str());
  WiFiClientSecure client;
  client.setInsecure();
  httpUpdate.rebootOnUpdate(true);
  t_httpUpdate_return ret = httpUpdate.update(client, binUrl);
  switch (ret) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("[update] FAILED (%d): %s\n",
                    httpUpdate.getLastError(),
                    httpUpdate.getLastErrorString().c_str());
      return false;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("[update] no updates");
      return false;
    case HTTP_UPDATE_OK:
      Serial.println("[update] OK -> reboot");
      return true;
  }
  return false;
}

} // namespace updater
