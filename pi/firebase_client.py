"""Firebase-Client für den Pi: Email/Password-Login + Firestore-Schreibzugriff
via REST. Bewusst kein firebase-admin, weil das einen Service Account
erfordern würde - wir bleiben bei normaler User-Auth (Spark-tauglich)."""

import time
import requests


class FirebaseClient:
    def __init__(self, config: dict):
        self.api_key = config["firebase"]["apiKey"]
        self.project_id = config["firebase"]["projectId"]
        self.email = config["auth"]["email"]
        self.password = config["auth"]["password"]
        self.owner_uid = config["ownerUid"]
        self.device_id = config["deviceId"]

        self.id_token: str | None = None
        self.refresh_token: str | None = None
        self.token_expiry: float = 0.0

    def _login(self) -> None:
        url = (
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
            f"?key={self.api_key}"
        )
        resp = requests.post(
            url,
            json={
                "email": self.email,
                "password": self.password,
                "returnSecureToken": True,
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        self.id_token = data["idToken"]
        self.refresh_token = data["refreshToken"]
        self.token_expiry = time.time() + int(data["expiresIn"]) - 60

    def _refresh(self) -> None:
        url = f"https://securetoken.googleapis.com/v1/token?key={self.api_key}"
        resp = requests.post(
            url,
            data={"grant_type": "refresh_token", "refresh_token": self.refresh_token},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        self.id_token = data["id_token"]
        self.refresh_token = data["refresh_token"]
        self.token_expiry = time.time() + int(data["expires_in"]) - 60

    def _ensure_token(self) -> str:
        if self.id_token and time.time() < self.token_expiry:
            return self.id_token
        if self.refresh_token:
            try:
                self._refresh()
                return self.id_token  # type: ignore[return-value]
            except Exception:
                pass
        self._login()
        return self.id_token  # type: ignore[return-value]

    def _firestore_url(self, path: str) -> str:
        return (
            f"https://firestore.googleapis.com/v1/projects/{self.project_id}"
            f"/databases/(default)/documents/{path}"
        )

    def write_reading(self, scales: dict[str, float], temps: dict[str, float]) -> None:
        token = self._ensure_token()
        ts_ms = int(time.time() * 1000)
        doc_path = (
            f"users/{self.owner_uid}/devices/{self.device_id}/readings/{ts_ms}"
        )
        body = {
            "fields": {
                "ts": {"integerValue": str(ts_ms)},
                "scales": {
                    "mapValue": {
                        "fields": {
                            k: {"doubleValue": float(v)} for k, v in scales.items()
                        }
                    }
                },
                "temps": {
                    "mapValue": {
                        "fields": {
                            k: {"doubleValue": float(v)} for k, v in temps.items()
                        }
                    }
                },
            }
        }
        resp = requests.patch(
            self._firestore_url(doc_path),
            json=body,
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        resp.raise_for_status()

    def heartbeat(self) -> None:
        token = self._ensure_token()
        doc_path = f"users/{self.owner_uid}/devices/{self.device_id}"
        body = {
            "fields": {
                "lastSeen": {"integerValue": str(int(time.time() * 1000))},
                "deviceId": {"stringValue": self.device_id},
            }
        }
        resp = requests.patch(
            self._firestore_url(doc_path) + "?updateMask.fieldPaths=lastSeen"
            "&updateMask.fieldPaths=deviceId",
            json=body,
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        resp.raise_for_status()
