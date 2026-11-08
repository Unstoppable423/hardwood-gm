#!/usr/bin/env python3
"""Build data/season-totals.json from the TallData season tables.

Download, then run from the repo root:

  curl -fsSL -o /tmp/basketball_players.csv https://raw.githubusercontent.com/TallData/NBA-Stats/master/data/Stats_Extended_Before_2013/basketball_players.csv
  curl -fsSL -o /tmp/basketball_teams.csv https://raw.githubusercontent.com/TallData/NBA-Stats/master/data/Stats_Extended_Before_2013/basketball_teams.csv
  curl -fsSL -o /tmp/basketball_master.csv https://raw.githubusercontent.com/TallData/NBA-Stats/master/data/Stats_Extended_Before_2013/basketball_master.csv
  python3 scripts/build-season-totals.py /tmp

The source repo (https://github.com/TallData/NBA-Stats) is published under MIT,
Copyright 2026 TallData. Its README does not name the compiler of these tables.
The column names match the season table that circulated for years through 2011-12.
This script keeps NBA/BAA rows only, drops ABA/NBL/other leagues, and writes null
where a category was not recorded yet. It does not claim that the MIT grant
clears any earlier compiler's terms. Samples checked while building: Abdul-Jabbar
38387 points, Jordan 32292 points, Russell 21620 rebounds, Chamberlain 1961-62
4029 points, Fulks 1946-47 1389 points, Erving 18364 NBA points.
"""
import csv, json, sys
from pathlib import Path

src = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/nba-src")
players = list(csv.DictReader(open(src / "basketball_players.csv")))
teams = list(csv.DictReader(open(src / "basketball_teams.csv")))
master = list(csv.DictReader(open(src / "basketball_master.csv")))

# tmID overrides where the source franchise id is not the id this game uses.
# CHH/NOH/NOK are one Hornets lineage (this game's id is CHH). VAN/MEM are the
# Grizzlies (id VAN). SEA/OKC are one club (id SEA). PHO is PHX. CHA is the
# Bobcats, a different club from the original Hornets, and those seasons are
# after every supported start.
TM = {
    "PHO": "PHX",
    "CHH": "CHH", "NOH": "CHH", "NOK": "CHH",
    "CHA": "CHA", "CHR": "CHA",
    "VAN": "VAN", "MEM": "VAN",
    "SEA": "SEA", "OKC": "SEA",
}
franch = {}
for t in teams:
    if t["lgID"] != "NBA":
        continue
    franch[(int(t["year"]), t["tmID"])] = TM.get(t["tmID"], t["franchID"] or t["tmID"])

# End year = source start year + 1. A category is null before these end years.
TRACKED = {"min": 1952, "reb": 1951, "orb": 1974, "drb": 1974, "stl": 1974, "blk": 1974, "tov": 1978, "tpm": 1980, "tpa": 1980}
REG = [
    ("gp", "GP"), ("min", "minutes"), ("pts", "points"), ("fgm", "fgMade"), ("fga", "fgAttempted"),
    ("tpm", "threeMade"), ("tpa", "threeAttempted"), ("ftm", "ftMade"), ("fta", "ftAttempted"),
    ("orb", "oRebounds"), ("drb", "dRebounds"), ("reb", "rebounds"), ("ast", "assists"),
    ("stl", "steals"), ("blk", "blocks"), ("tov", "turnovers"),
]
POST = [
    ("gp", "PostGP"), ("min", "PostMinutes"), ("pts", "PostPoints"), ("fgm", "PostfgMade"), ("fga", "PostfgAttempted"),
    ("tpm", "PostthreeMade"), ("tpa", "PostthreeAttempted"), ("ftm", "PostftMade"), ("fta", "PostftAttempted"),
    ("orb", "PostoRebounds"), ("drb", "PostdRebounds"), ("reb", "PostRebounds"), ("ast", "PostAssists"),
    ("stl", "PostSteals"), ("blk", "PostBlocks"), ("tov", "PostTurnovers"),
]

def num(row, col, end, key):
    if key in TRACKED and end < TRACKED[key]:
        return None
    raw = row.get(col, "")
    if raw is None or raw == "":
        return None
    return int(raw)

bios = {}
for m in master:
    bid = m.get("bioID") or ""
    if not bid or bid == "bioID":
        continue
    first = (m.get("useFirst") or m.get("firstName") or "").strip()
    last = (m.get("lastName") or "").strip()
    suf = (m.get("nameSuffix") or "").strip()
    name = (first + " " + last).strip()
    if suf:
        name = name + " " + suf
    bd = m.get("birthDate") or ""
    by = bm = None
    if len(bd) >= 7 and not bd.startswith("0000"):
        y, mo, *_ = bd.split("-")
        if y.isdigit() and int(y) > 1800:
            by = int(y)
        if mo.isdigit() and int(mo) > 0:
            bm = int(mo)
    bios[bid] = (name, by, bm)

lines = {}
for r in players:
    if r["lgID"] != "NBA":
        continue
    end = int(r["year"]) + 1
    fid = TM.get(r["tmID"]) or franch.get((int(r["year"]), r["tmID"])) or r["tmID"]
    reg = [num(r, col, end, key) for key, col in REG]
    if not reg[0]:
        continue
    post = None
    if (r.get("PostGP") or "0") not in ("", "0"):
        post = [num(r, col, end, key) for key, col in POST]
    lines.setdefault(r["playerID"], []).append((end, int(r["stint"] or 1), fid, reg, post))

out_players = []
for pid in sorted(lines):
    name, by, bm = bios.get(pid, (pid, None, None))
    seq = sorted(lines[pid], key=lambda x: (x[0], x[1], x[2]))
    packed = [[end, fid, reg, post] for end, _stint, fid, reg, post in seq]
    out_players.append([name, by, bm, pid, packed])

doc = {
    "v": 1,
    "year": "Season code is the year the season ends. The source file's year is the start year; 1996 there is 1996-97 here.",
    "trackedFrom": TRACKED,
    "keys": [k for k, _ in REG],
    "source": "Season counting totals for NBA/BAA only, derived from TallData/NBA-Stats data/Stats_Extended_Before_2013/basketball_players.csv (through the 2011-12 season). That repository is MIT, Copyright 2026 TallData, and does not name the earlier compiler of the tables. ABA, NBL, and other leagues are excluded. A zero in the source before the league recorded a category is stored as null. This file does not assert that the MIT grant clears any upstream compilation terms.",
    "players": out_players,
}
dest = Path(__file__).resolve().parents[1] / "data" / "season-totals.json"
dest.write_text(json.dumps(doc, separators=(",", ":")))
print("players", len(out_players), "bytes", dest.stat().st_size)
