#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

// REST-Client gegen Firebase (Auth + Firestore). Konkret nur was wir brauchen:
// Login (signInWithPassword), GET-Dokument, PATCH-Dokument, GET-Collection.

namespace fb {

struct LoginResult {
  bool   ok = false;
  String idToken;
  String localId;
  String error;
};

LoginResult login(const String& email, const String& password);

// PATCH eines Dokuments. body ist bereits serialisiertes JSON im Firestore-
// "fields"-Format. updateMask ist optional ("foo,bar" -> nur diese Felder).
bool patchDoc(const String& idToken, const String& docPath,
              const String& body, const String& updateMask = "");

// GET eines Dokuments. Liefert true wenn 200 OK; payload landet in resp
// (Firestore-Format "fields:{...}"). bei 404: ok=true aber resp leer.
bool getDoc(const String& idToken, const String& docPath, String& resp,
            int* httpCode = nullptr);

// GET einer Collection mit pageSize Limit. resp enthaelt {"documents":[...]}.
bool listDocs(const String& idToken, const String& collPath, int pageSize,
              String& resp);

// Helper: aus einem Firestore-"fields"-Object einen primitiven Wert lesen.
double readNumber(JsonVariantConst field, double defaultVal = 0.0);
String readString(JsonVariantConst field, const String& defaultVal = "");
bool   readBool  (JsonVariantConst field, bool defaultVal = false);
long long readInteger(JsonVariantConst field, long long defaultVal = 0);

// Helper: in ein JsonObject ein "fields"-Feld einfuegen.
void writeNumber (JsonObject fields, const char* key, double v);
void writeInteger(JsonObject fields, const char* key, long long v);
void writeString (JsonObject fields, const char* key, const String& v);
void writeBool   (JsonObject fields, const char* key, bool v);

} // namespace fb
