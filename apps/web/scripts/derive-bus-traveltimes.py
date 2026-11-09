#!/usr/bin/env python3
"""Derive the per-line travel time from your bus stop -> Hauptbahnhof.

Produces the value for VITE_BUS_HBF_MINUTES (see src/lib/transit.ts). Downloads the
Stadtwerke Münster GTFS feed, finds every timetable trip that serves the given
stop platform (its Busradar/GTFS stop id) and later reaches a Hauptbahnhof
platform (4100001-4100010), and prints the median scheduled minutes per line.

Re-run after a timetable change (~twice a year) and put the printed JSON into
VITE_BUS_HBF_MINUTES.

    python3 apps/web/scripts/derive-bus-traveltimes.py <stop-id>

Stdlib only — no dependencies.
"""
import csv
import io
import json
import statistics
import sys
import urllib.request
import zipfile
from collections import defaultdict

GTFS_URL = "https://api.busradar.conterra.de/data/stadtwerke_feed.zip"
HBF_PLATFORMS = {f"410000{i}" for i in range(1, 10)} | {"4100010"}


def hhmmss_to_sec(t: str) -> int:
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Aufruf: derive-bus-traveltimes.py <stop-id>")
    stop_id = sys.argv[1]
    print(f"Downloading {GTFS_URL} ...")
    data = urllib.request.urlopen(GTFS_URL, timeout=120).read()
    zf = zipfile.ZipFile(io.BytesIO(data))

    def reader(name):
        return csv.DictReader(io.TextIOWrapper(zf.open(name), encoding="utf-8"))

    # trip_id -> {"cor": (seq, dep_sec), "hbf": (seq, arr_sec)}  (first Hbf visit)
    trips = defaultdict(dict)
    for row in reader("stop_times.txt"):
        sid = row["stop_id"]
        if sid == stop_id:
            trips[row["trip_id"]]["cor"] = (int(row["stop_sequence"]), hhmmss_to_sec(row["departure_time"]))
        elif sid in HBF_PLATFORMS:
            seq = int(row["stop_sequence"])
            cur = trips[row["trip_id"]].get("hbf")
            if cur is None or seq < cur[0]:
                trips[row["trip_id"]]["hbf"] = (seq, hhmmss_to_sec(row["arrival_time"]))

    trip_route = {r["trip_id"]: r["route_id"] for r in reader("trips.txt")}
    route_name = {r["route_id"]: r["route_short_name"] for r in reader("routes.txt")}

    deltas = defaultdict(list)
    for tid, d in trips.items():
        if "cor" in d and "hbf" in d and d["hbf"][0] > d["cor"][0]:
            minutes = (d["hbf"][1] - d["cor"][1]) / 60.0
            if 0 < minutes < 60:  # drop obvious garbage / midnight wraps
                deltas[route_name.get(trip_route.get(tid), "?")].append(minutes)

    result = {}
    print(f"\n{'Line':6}{'trips':>7}{'median':>8}{'  range'}")
    for line in sorted(deltas):
        v = deltas[line]
        result[line] = round(statistics.median(v))
        print(f"{line:6}{len(v):>7}{result[line]:>8}  {min(v):.0f}-{max(v):.0f} min")

    print("\nVITE_BUS_HBF_MINUTES=" + json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
