"""Stockwaage Pi-Service - Skelett.
Schreibt im Mock-Modus Dummy-Werte nach Firestore. HX711/DS18B20-Integration
kommt im nächsten Schritt.
"""

import argparse
import json
import logging
import math
import random
import signal
import sys
import time
from pathlib import Path

from firebase_client import FirebaseClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("stockwaage")

_running = True


def _stop(_signum, _frame):
    global _running
    _running = False
    log.info("Shutdown signal empfangen.")


def mock_scales(t: float) -> dict[str, float]:
    """Simuliert 2 Waagen mit langsamer Drift + Rauschen."""
    base1 = 42.0 + 2.0 * math.sin(t / 3600)
    base2 = 38.5 + 1.5 * math.sin(t / 3600 + 1.0)
    return {
        "scale-1": round(base1 + random.uniform(-0.05, 0.05), 3),
        "scale-2": round(base2 + random.uniform(-0.05, 0.05), 3),
    }


def mock_temps(t: float) -> dict[str, float]:
    base = 22.0 + 5.0 * math.sin(t / 86400 * 2 * math.pi)
    return {
        "temp-outside": round(base + random.uniform(-0.2, 0.2), 2),
        "temp-hive-1": round(35.0 + random.uniform(-0.3, 0.3), 2),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--config",
        default=str(Path(__file__).parent / "config.local.json"),
        help="Pfad zur Konfigurationsdatei",
    )
    parser.add_argument(
        "--mock",
        action="store_true",
        help="Mock-Modus: erzeugt Dummy-Werte statt echte Sensoren zu lesen",
    )
    args = parser.parse_args()

    config_path = Path(args.config)
    if not config_path.exists():
        log.error("Config nicht gefunden: %s", config_path)
        log.error("Tipp: cp config.example.json config.local.json")
        return 1

    with config_path.open() as f:
        config = json.load(f)

    if not args.mock:
        log.error("Echter Sensor-Modus noch nicht implementiert. Bitte --mock nutzen.")
        return 1

    interval = int(config.get("intervalSec", 60))
    log.info("Starte im Mock-Modus, Intervall=%ds, Device=%s", interval, config["deviceId"])

    client = FirebaseClient(config)
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    next_tick = time.time()
    while _running:
        try:
            t = time.time()
            scales = mock_scales(t)
            temps = mock_temps(t)
            client.write_reading(scales, temps)
            client.heartbeat()
            log.info("Reading geschrieben: scales=%s temps=%s", scales, temps)
        except Exception as e:
            log.exception("Fehler beim Schreiben: %s", e)

        next_tick += interval
        sleep_for = max(0.0, next_tick - time.time())
        end = time.time() + sleep_for
        while _running and time.time() < end:
            time.sleep(min(1.0, end - time.time()))

    log.info("Beendet.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
