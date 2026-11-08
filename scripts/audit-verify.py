#!/usr/bin/env python3
"""Source verification for supported start years and draft boards.
Reuses cached pages in /tmp/audit-src. Does not edit game data.
"""
import csv, json, os, re, time, urllib.error, urllib.parse, urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

OUT = Path("/opt/cursor/artifacts")
RAW = Path("/tmp/audit-src")
RAW.mkdir(parents=True, exist_ok=True)
UA_WIKI = "HardwoodGMAudit/1.0 (local research; player-data verification)"
UA_BBR = "Mozilla/5.0 (compatible; HardwoodGMAudit/1.0; research)"

def norm(s):
    import unicodedata
    s = str(s or "").replace("’", "'").replace("`", "'")
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r'["“”]', " ", s)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower().replace(".", " ")
    parts = s.split()
    if len(parts) > 1 and parts[-1] in {"jr", "sr", "ii", "iii", "iv"}:
        parts = parts[:-1]
    s = " ".join(parts)
    s = re.sub(r"[^a-z0-9' ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()

AKA_PAIRS = [
    ("kareem abdul jabbar", "lew alcindor"),
    ("zaid abdul aziz", "don smith"),
    ("jamaal wilkes", "keith wilkes"),
    ("world b free", "lloyd free"),
    ("hakeem olajuwon", "akeem olajuwon"),
    ("mahmoud abdul rauf", "chris jackson"),
    ("bud stallworth", "isaac stallworth"),
    ("hot rod hundley", "rod hundley"),
    ("zeke zawoluk", "bob zawoluk"),
    ("corky devlin", "walter devlin"),
    ("bucky bockhorn", "arlen bockhorn"),
    ("hank finkel", "henry finkel"),
    ("maury king", "maurice king"),
    ("earl g graves", "butch graves"),
    ("cadillac anderson", "greg cadillac anderson"),
    ("stephen bardo", "steve bardo"),
    ("michael holton", "mike holton"),
    ("jim phelan", "james phelan"),
    ("dick atha", "richard atha"),
    ("jim garvin", "james garvin"),
    ("ike austin", "isaac austin"),
]

def aka(a, b):
    x, y = norm(a), norm(b)
    return any(x in pair and y in pair and x != y for pair in AKA_PAIRS)

def same(a, b):
    x, y = norm(a), norm(b)
    if not x or not y:
        return False
    if x == y:
        return True
    def squash(v):
        return re.sub(r"[^a-z0-9]", "", v)
    sx, sy = squash(x), squash(y)
    if len(sx) >= 6 and sx == sy:
        return True
    xs, ys = x.split(), y.split()
    if xs[-1] != ys[-1]:
        return False
    return xs[0] == ys[0] or xs[0].startswith(ys[0]) or ys[0].startswith(xs[0])

def http_get(url, dest, ua):
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size > 800:
        head = dest.read_bytes()[:6]
        if head != b"ERROR ":
            return dest.read_bytes(), None
        if os.environ.get("CACHE_ONLY") == "1":
            return None, dest.read_text(errors="ignore")[:180]
        dest.unlink()
    if os.environ.get("CACHE_ONLY") == "1":
        return None, "not in cache"
    time.sleep(0.35)
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            data = r.read()
        dest.write_bytes(data)
        return data, None
    except Exception as e:
        dest.write_bytes(b"ERROR " + str(e).encode()[:300])
        return None, str(e)

def add_issue(**kw):
    issues.append(kw)

def bbr_codes(abbr):
    # Same club, different site code only. Do not fall through to a later city.
    extra = {
        "PHX": ["PHO"],
        "WAS": ["WSB"],
        "KCK": ["KCO"],
    }
    out = [abbr]
    for a in extra.get(abbr, []):
        if a not in out:
            out.append(a)
    return out

def parse_roster_html(html):
    text = html.decode("utf-8", "ignore") if isinstance(html, bytes) else html
    i = text.find('id="roster"')
    if i < 0:
        return None
    j = text.find("</table>", i)
    chunk = text[i:j if j > i else i + 20000]
    rows = []
    for tr in re.findall(r"<tr\b[^>]*>(.*?)</tr>", chunk, flags=re.S):
        if 'data-append-csv="' not in tr or "/players/" not in tr:
            continue
        name = re.search(r'data-stat="player"[^>]*>\s*<a[^>]*>([^<]+)', tr)
        if not name:
            continue
        pos = re.search(r'data-stat="pos"[^>]*>\s*([^<]*)', tr)
        ht = re.search(r'data-stat="height"[^>]*>\s*([^<]*)', tr)
        dob = re.search(r'data-stat="birth_date"[^>]*>\s*([^<]*)', tr)
        num = re.search(r'data-stat="number"[^>]*>\s*([^<]*)', tr)
        nm = name.group(1).strip()
        if not nm or nm.lower() in {"player", "team"}:
            continue
        rows.append({
            "name": nm,
            "pos": (pos.group(1).strip() if pos else ""),
            "height": (ht.group(1).strip() if ht else ""),
            "birth": (dob.group(1).strip() if dob else ""),
            "num": (num.group(1).strip() if num else ""),
        })
    return rows

def fetch_team(year, abbr):
    last_err = "no code"
    for code in bbr_codes(abbr):
        url = f"https://www.basketball-reference.com/teams/{code}/{year}.html"
        dest = RAW / f"bbr-{year}-{code}.html"
        data, err = http_get(url, dest, UA_BBR)
        if data and b'id="roster"' in data:
            rows = parse_roster_html(data) or []
            if rows:
                return rows, url, None
            last_err = "roster table empty"
        else:
            last_err = err or "no roster marker"
    return [], "", last_err

def ht_cm(s):
    m = re.match(r"(\d+)-(\d+)", s or "")
    if not m:
        return None
    return round((int(m.group(1)) * 12 + int(m.group(2))) * 2.54, 1)

def birth_year(s):
    m = re.search(r"(18|19|20)\d\d", s or "")
    return int(m.group(0)) if m else None

def age_ok(file_age, byear, season):
    if file_age in (None, "") or byear is None:
        return None
    try:
        age = int(float(file_age))
    except ValueError:
        return None
    return any(abs(age - (season - byear)) <= 1 or abs(age - (season - 1 - byear)) <= 1 for _ in (0,))

POS_FAMILY = {
    "PG": {"PG", "G"}, "SG": {"SG", "G"}, "SF": {"SF", "F"}, "PF": {"PF", "F"}, "C": {"C"},
}

def pos_match(file_pos, src_pos):
    if not file_pos or not src_pos:
        return None
    src = [p.strip().upper() for p in re.split(r"[/-]", src_pos) if p.strip()]
    fp = file_pos.upper()
    if fp in src:
        return True
    fam = POS_FAMILY.get(fp, set())
    return any(p in fam or p in {fp} for p in src)

def clean_cell(raw):
    s = raw.strip()
    while s.startswith("|"):
        s = s[1:].strip()
    s = re.sub(r"<ref\b[^>]*>[\s\S]*?</ref>", " ", s, flags=re.I)
    s = re.sub(r"<ref\b[^>]*/>", " ", s, flags=re.I)
    s = re.sub(r"^(?:scope\s*=\s*(?:\"row\"|row)\s+)+", "", s, flags=re.I)
    s = re.sub(
        r"^(?:(?:align|style|bgcolor|width|scope|rowspan|colspan|valign)\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s|]+)\s*)+\|\s*",
        "",
        s,
        flags=re.I,
    )
    s = re.sub(r"\{\{sortname\|([^|}]*)\|([^|}]+)(?:\|[^}]*)?\}\}", lambda m: (m.group(1) + " " + m.group(2)).strip(), s)
    s = re.sub(r"\*?\{\{efn[\s\S]*", "", s)
    s = re.sub(r"\[\[([^\]|#]+)(?:#[^\]|]+)?\|([^\]]+)\]\]", r"\2", s)
    s = re.sub(r"\[\[([^\]|#]+)(?:#[^\]|]+)?\]\]", r"\1", s)
    s = re.sub(r"<sup[^>]*>.*?</sup>", "", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("*", " ")
    s = re.sub(r"\{\{[^{}]*\}\}", " ", s)
    s = s.replace("^", " ").replace("~", " ")
    return re.sub(r"\s+", " ", s).strip(" |")

def parse_draft(wt):
    picks, lines, i = [], wt.splitlines(), 0
    while i < len(lines):
        if not lines[i].strip().startswith("|-"):
            i += 1
            continue
        cells, i = [], i + 1
        while i < len(lines) and lines[i].strip() != "|}" and not lines[i].strip().startswith("|-"):
            stripped = lines[i].lstrip()
            if stripped.startswith("|") and not stripped.startswith("|}"):
                cells.append(lines[i])
            elif stripped.startswith("!scope=row") or stripped.startswith("! scope=\"row\"") or stripped.startswith("!scope=\"row\""):
                cells.append("|" + stripped[1:])
            i += 1
        parts = []
        for c in cells:
            body = c.lstrip()
            if body.startswith("|"):
                body = body[1:]
            buf, depth, j = "", 0, 0
            while j < len(body):
                if body.startswith("{{", j):
                    depth += 1
                    buf += "{{"
                    j += 2
                    continue
                if body.startswith("}}", j) and depth:
                    depth -= 1
                    buf += "}}"
                    j += 2
                    continue
                if depth == 0 and body.startswith("||", j):
                    parts.append(buf)
                    buf = ""
                    j += 2
                    continue
                buf += body[j]
                j += 1
            if buf.strip():
                parts.append(buf)
        texts = [clean_cell("|" + p) for p in parts]
        texts = [t for t in texts if t]
        nums = []
        for t in texts[:3]:
            if re.fullmatch(r"\d+", t):
                nums.append(int(t))
            else:
                break
        if len(nums) < 2 or len(texts) < 4:
            if len(texts) >= 4 and texts[0] in {"–", "-", "—", ""} and texts[1] in {"–", "-", "—", ""}:
                name = texts[2]
                if " " in name and re.search(r"[A-Za-z]", name):
                    picks.append({"round": None, "pick": None, "name": name, "pos": texts[3], "school": texts[-1]})
            continue
        rd, pk = nums[0], nums[1]
        if rd > 20 or pk > 300 or rd == 0:
            continue
        name = texts[len(nums)]
        pos = texts[len(nums) + 1] if len(texts) > len(nums) + 1 else ""
        school = texts[-1]
        if not re.search(r"[A-Za-z]", name) or name.lower() in {"player", "round", "pick"} or name.lower().startswith("forfeited"):
            continue
        picks.append({"round": rd, "pick": pk, "name": name, "pos": pos, "school": school})
    seen, out = set(), []
    for p in picks:
        k = (p["round"], p["pick"], norm(p["name"]))
        if k in seen:
            continue
        seen.add(k)
        out.append(p)
    return out

def draft_titles(year):
    if year <= 1949:
        return [f"{year} BAA draft", f"{year} NBA draft"]
    return [f"{year} NBA draft"]

def fetch_draft(year):
    if year == 2027:
        return None, "2027 is a pre-draft mock in this file. No completed draft exists to compare as of November 2026.", None, None
    last = "not fetched"
    for title in draft_titles(year):
        url = "https://en.wikipedia.org/w/api.php?action=parse&page=" + urllib.parse.quote(title) + "&prop=wikitext&format=json"
        dest = RAW / f"draft-{year}-{title.split()[1]}.json"
        data, err = http_get(url, dest, UA_WIKI)
        if not data:
            last = err or "fetch failed"
            continue
        try:
            body = json.loads(data)
        except Exception as e:
            last = str(e)
            continue
        if "error" in body:
            last = body["error"].get("code", "error")
            continue
        wt = body.get("parse", {}).get("wikitext", {}).get("*", "")
        picks = parse_draft(wt)
        if picks:
            page = "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
            overall_m = re.search(r"\|\s*overall\s*=\s*(\d+)", wt)
            overall = int(overall_m.group(1)) if overall_m else None
            return picks, None, page, overall
        last = "page parsed but no pick table"
    return [], last, None, None

# load local data
start = json.load(open("/workspace/data/start1996.json"))
drafts = json.load(open("/workspace/data/draftclasses.json"))
history = json.load(open("/workspace/data/history.json"))
teams_by_year = json.load(open("/tmp/teams-by-year.json"))
issues, roster_rows, draft_rows, coverage = [], [], [], []

def add_issue(**kw):
    issues.append(kw)

# ---------- 1996-97 and historic rosters ----------
def index_year(year, teams, pages):
    """pages: abbr -> (rows, url or error)"""
    by_name = defaultdict(list)
    failed = []
    for abbr, _city in [(t["abbr"], t["city"]) for t in teams]:
        rows, url, err = pages[abbr]
        if err or not rows:
            failed.append(abbr)
            continue
        for r in rows:
            by_name[norm(r["name"])].append({**r, "team": abbr, "url": url})
    return by_name, failed

def lookup(by_name, name):
    n = norm(name)
    hits = list(by_name.get(n, []))
    if hits:
        return hits
    for k, rows in by_name.items():
        if same(k, name) or aka(k, name):
            hits.extend(rows)
    # unique team
    out, seen = [], set()
    for h in hits:
        if h["team"] in seen:
            continue
        seen.add(h["team"])
        out.append(h)
    return out

def record_roster_player(pool, year, name, file_teams, file_age, file_h, hits, failed_expected, franchises=None):
    def fr(code):
        if not franchises:
            return code
        return franchises.get(code, code)
    src_teams = []
    for h in hits:
        if h["team"] not in src_teams:
            src_teams.append(h["team"])
    primary = hits[0] if hits else None
    fields, unver, reasons = [], [], []
    status = "verified"
    if not hits:
        if failed_expected:
            status = "unreviewed"
            reasons.append("source page for " + ",".join(failed_expected) + " was not available; absence is not evidence")
        else:
            status = "partial"
            reasons.append("not on the parsed season-roster tables for this year")
        unver = ["identity", "team", "birth", "height", "position"]
        url = ""
    else:
        file_fr = []
        for t in file_teams:
            if fr(t) not in file_fr:
                file_fr.append(fr(t))
        src_fr = []
        for t in src_teams:
            if fr(t) not in src_fr:
                src_fr.append(fr(t))
        overlap = [t for t in file_fr if t in src_fr]
        if overlap and len(src_fr) == 1 and len(file_fr) == 1:
            fields.append("team-season-roster")
            reasons.append("name is on that club's season roster table; a franchise id and that year's city code count as the same club. This is not an opening-night freeze, so a later trade is not a mismatch")
        elif overlap:
            fields.append("team-matches-one-listed-club")
            status = "partial"
            extra = [t for t in src_fr if t not in file_fr]
            file_extra = [t for t in file_fr if t not in src_fr]
            reasons.append("matched " + ",".join(overlap) + ("; also on source " + ",".join(extra) if extra else "") + ("; file also names " + ",".join(file_extra) if file_extra else "") + ". Treated as a season appearance, not a false trade.")
        elif failed_expected:
            status = "unreviewed"
            reasons.append("file club page was not available (" + ",".join(failed_expected) + "); name also appears on " + ",".join(src_teams) + ". That is not a confirmed wrong team")
            unver.append("team")
        else:
            status = "discrepancy"
            reasons.append("file teams " + ",".join(file_teams) + " but season roster tables list " + ",".join(src_teams))
            add_issue(severity="P2", kind="source-verified", pool=pool, year=year, name=name, finding="team-not-on-listed-season-roster", evidence=reasons[-1], source=primary["url"])
        by = birth_year(primary["birth"])
        ok = age_ok(file_age, by, year)
        if ok:
            fields.append("age-vs-birth-year")
        elif ok is None:
            unver.append("birth")
            if status == "verified":
                status = "partial"
            reasons.append("birth date missing on the roster table" if not primary["birth"] else "file age missing")
        else:
            status = "discrepancy"
            add_issue(severity="P2", kind="source-verified", pool=pool, year=year, name=name, finding="age-disagrees-with-birth-year", evidence=f"file age {file_age}; source {primary['birth']}", source=primary["url"])
        hcm = ht_cm(primary["height"])
        if hcm and file_h not in (None, "") and abs(float(file_h) - hcm) <= 2.6:
            fields.append("height")
        elif hcm and file_h not in (None, ""):
            if status == "verified":
                status = "partial"
            reasons.append(f"height file {file_h} cm vs source {primary['height']}")
        else:
            unver.append("height")
        if primary["pos"]:
            fields.append("source-position-" + primary["pos"])
        unver.append("draft-slot")
        reasons.append("season roster table does not list draft round or pick")
        url = primary["url"]
    roster_rows.append({
        "pool": pool, "year": year, "name": name, "file_teams": ",".join(file_teams),
        "file_age": file_age if file_age is not None else "", "file_height_cm": file_h if file_h is not None else "",
        "source_teams": ",".join(src_teams), "source_pos": primary["pos"] if primary else "",
        "source_birth": primary["birth"] if primary else "", "source_height": primary["height"] if primary else "",
        "source_url": url, "status": status, "fields_verified": "|".join(fields),
        "fields_unverified": "|".join(unver), "reason": "; ".join(reasons),
    })
    return status

roster_rows = []

def cover_year(year, people, pool):
    teams = teams_by_year[str(year)]
    pages = {}
    def work(t):
        rows, url, err = fetch_team(year, t["abbr"])
        return t["abbr"], rows, url, err
    with ThreadPoolExecutor(max_workers=2) as ex:
        for abbr, rows, url, err in ex.map(work, teams):
            pages[abbr] = (rows, url, err)
    by_name = defaultdict(list)
    failed = set()
    ok_teams = 0
    franchises, abbr_of = {}, {}
    for t in teams:
        franchises[t["abbr"]] = t["fid"]
        franchises[t["fid"]] = t["fid"]
        abbr_of[t["fid"]] = t["abbr"]
        abbr_of[t["abbr"]] = t["abbr"]
    for t in teams:
        rows, url, err = pages[t["abbr"]]
        if err or not rows:
            failed.add(t["abbr"])
            continue
        ok_teams += 1
        for r in rows:
            by_name[norm(r["name"])].append({**r, "team": t["abbr"], "url": url})
    counts = Counter()
    matched = set()
    for person in people:
        hits = lookup(by_name, person["name"])
        for h in hits:
            matched.add((h["team"], norm(h["name"])))
        failed_expected = [t for t in person["teams"] if abbr_of.get(t, t) in failed or t in failed]
        st = record_roster_player(pool, year, person["name"], person["teams"], person.get("age"), person.get("h"), hits, failed_expected, franchises)
        counts[st] += 1
    missing = 0
    for key, hits in by_name.items():
        # one issue per source name not matched to any file person
        if any((h["team"], key) in matched for h in hits):
            continue
        if any(same(h["name"], p["name"]) or aka(h["name"], p["name"]) for h in hits for p in people):
            continue
        missing += 1
        h = hits[0]
        teams_s = ",".join(sorted({x["team"] for x in hits}))
        roster_rows.append({
            "pool": pool + "-not-in-file", "year": year, "name": h["name"], "file_teams": "",
            "file_age": "", "file_height_cm": "", "source_teams": teams_s, "source_pos": h["pos"],
            "source_birth": h["birth"], "source_height": h["height"], "source_url": h["url"],
            "status": "discrepancy", "fields_verified": "missing-from-file", "fields_unverified": "",
            "reason": "on the season roster table and not in this year's included player pool",
        })
        add_issue(severity="P2", kind="source-verified", pool=pool, year=year, name=h["name"], finding="season-roster-player-absent-from-file", evidence=f"teams {teams_s}; pos {h['pos']}; born {h['birth']}", source=h["url"])
        counts["missing-from-file"] += 1
    coverage.append({
        "pool": pool, "year": year, "teams": len(teams), "teams_parsed": ok_teams,
        "teams_unavailable": ",".join(sorted(failed)), "file_rows": len(people),
        "verified": counts["verified"], "partial": counts["partial"],
        "discrepancy": counts["discrepancy"], "unreviewed": counts["unreviewed"],
        "on_source_not_in_file": missing,
    })
    print(year, pool, "parsed", ok_teams, "/", len(teams), dict(counts), flush=True)

DRAFTS_ONLY = os.environ.get("DRAFTS_ONLY") == "1"
if not DRAFTS_ONLY:
    # 1997 modern start
    people_1997 = []
    for p in start["players"]:
        people_1997.append({"name": p["n"], "teams": [p["t"]], "age": p.get("age"), "h": p.get("h")})
    print("year 1997 start file", len(people_1997), flush=True)
    cover_year(1997, people_1997, "start1996")

    # historic
    by_year = defaultdict(list)
    for hp in history["players"]:
        for y, v in hp["s"].items():
            teams = [v[0]] + ([v[1]] if v[1] and v[1] != v[0] else [])
            by_year[int(y)].append({"name": hp["n"], "teams": teams, "age": (int(y) - hp["by"]) if hp.get("by") else None, "h": hp.get("h")})

    for year in range(1947, 1997):
        cover_year(year, by_year.get(year, []), "history")
else:
    print("DRAFTS_ONLY: keeping the roster ledger already written", flush=True)

# ---------- drafts 1947-2026, 2027 separate ----------
class_by_year = {int(y): rows for y, rows in drafts["classes"].items()}

def cover_draft(year):
    src = f"https://en.wikipedia.org/wiki/{year}_NBA_draft"
    picks, err, page, overall = fetch_draft(year)
    ours = class_by_year.get(year, [])
    if year == 2027:
        for r in ours:
            draft_rows.append({
                "pool": "draftclass-mock-2027", "year": 2027, "round": r.get("dr"), "pick": r.get("dp"),
                "file_name": r.get("n"), "wiki_name": "", "file_pos": r.get("pos") or "", "wiki_pos": "",
                "wiki_school": "", "file_age": r.get("age", ""), "source_url": drafts["sources"].get("2027", ""),
                "status": "unreviewed", "fields_verified": "", "fields_unverified": "identity|pick|position|birth",
                "reason": "Projected 2027 mock. Not compared to a completed draft, and no outcome is invented.",
            })
        coverage.append({"pool": "draftclass-mock-2027", "year": 2027, "teams": "", "teams_parsed": "", "teams_unavailable": "", "file_rows": len(ours), "verified": 0, "partial": 0, "discrepancy": 0, "unreviewed": len(ours), "on_source_not_in_file": 0})
        print("2027 mock", len(ours), flush=True)
        return
    if not picks:
        for r in ours:
            draft_rows.append({
                "pool": "draftclass", "year": year, "round": r.get("dr"), "pick": r.get("dp"),
                "file_name": r.get("n"), "wiki_name": "", "file_pos": r.get("pos") or "", "wiki_pos": "",
                "wiki_school": "", "file_age": r.get("age", ""), "source_url": page or src,
                "status": "unreviewed", "fields_verified": "", "fields_unverified": "identity|pick|position",
                "reason": "draft page unavailable or unparsed: " + str(err),
            })
        coverage.append({"pool": "draftclass", "year": year, "teams": "", "teams_parsed": 0, "teams_unavailable": str(err), "file_rows": len(ours), "verified": 0, "partial": 0, "discrepancy": 0, "unreviewed": len(ours), "on_source_not_in_file": 0})
        add_issue(severity="P3", kind="gap", pool="draftclass", year=year, name="", finding="draft-page-unavailable", evidence=str(err), source=page or src)
        print("DRAFT", year, "UNREVIEWED", err, flush=True)
        return
    numbered = [p for p in picks if p.get("round") is not None]
    wiki_by_pick = defaultdict(list)
    wiki_by_name = defaultdict(list)
    for p in picks:
        wiki_by_name[norm(p["name"])].append(p)
        if p.get("round") is not None:
            wiki_by_pick[(p["round"], p["pick"])].append(p)
    page_partial = overall is not None and len(numbered) < overall * 0.85
    used_wiki = set()
    counts = Counter()

    def row_out(match, pk, status, reason, fields, unver):
        counts[status] += 1
        draft_rows.append({
            "pool": "draftclass", "year": year,
            "round": (match or pk or {}).get("dr", pk.get("round") if pk else ""),
            "pick": (match or pk or {}).get("dp", pk.get("pick") if pk else ""),
            "file_name": match.get("n") if match else "",
            "wiki_name": pk["name"] if pk else "",
            "file_pos": (match or {}).get("pos", "") if match else "",
            "wiki_pos": pk.get("pos", "") if pk else "",
            "wiki_school": pk.get("school", "") if pk else "",
            "file_age": (match or {}).get("age", "") if match else "",
            "source_url": page, "status": status,
            "fields_verified": "|".join(fields), "fields_unverified": "|".join(unver),
            "reason": reason,
        })

    def attach_pos(match, pk, status, fields, unver, reason):
        pm = pos_match(match.get("pos") or "", pk.get("pos") or "")
        if pm is True:
            fields.append("position")
        elif pm is False:
            if status == "verified":
                status = "partial"
            unver.append("position-differs")
            add_issue(severity="P3", kind="source-verified", pool="draftclass", year=year, name=match.get("n"), finding="position-differs-from-draft-page", evidence=f"file {match.get('pos')} wiki {pk.get('pos')}", source=page)
        else:
            unver.append("position")
        school = pk.get("school") or ""
        unver.append("nba-arrival")
        if school and not re.search(r"university|college|high school|state|tech", school, re.I) and status == "verified":
            fields.append("non-college-club")
            reason += f"; school/club on the draft page is {school}. Arrival in the NBA is not on this table."
        return status, reason

    for r in ours:
        cands = wiki_by_pick.get((r.get("dr"), r.get("dp")), [])
        named = [p for p in cands if same(r.get("n"), p["name"])]
        aliased = [p for p in cands if aka(r.get("n"), p["name"])]
        hit, name_ok = None, False
        if named:
            hit, name_ok = named[0], True
        elif aliased:
            hit, name_ok = aliased[0], "aka"
        elif len(cands) == 1:
            hit = cands[0]
        else:
            byn = [p for p in wiki_by_name.get(norm(r.get("n")), []) if same(r.get("n"), p["name"])]
            byn.sort(key=lambda p: p.get("round") is None)
            if byn:
                hit, name_ok = byn[0], True
        if hit is None:
            if page_partial:
                row_out(r, None, "unreviewed", f"Wikipedia lists {len(numbered)} numbered picks of {overall} overall. This row is not on that subset, so absence is not evidence.", [], ["identity", "pick", "position", "birth"])
            else:
                row_out(r, None, "discrepancy", "in the class but not on the parsed Wikipedia pick list", [], ["birth"])
                add_issue(severity="P2", kind="source-verified", pool="draftclass", year=year, name=r.get("n"), finding="class-row-not-on-wikipedia-board", evidence=f"R{r.get('dr')} P{r.get('dp')}", source=page)
            continue
        used_wiki.add(id(hit))
        fields, unver = [], ["birth", "age"]
        if hit.get("round") is None:
            status = "partial"
            fields = ["name"]
            unver += ["pick"]
            reason = "name is on the Wikipedia draft page in a list that does not give round and pick; birth date is not on the table"
            status, reason = attach_pos(r, hit, status, fields, unver, reason)
        elif name_ok == "aka" and hit["round"] == r.get("dr") and hit["pick"] == r.get("dp"):
            status = "partial"
            fields = ["round", "pick"]
            reason = f"same slot; page says {hit['name']} and the file says {r.get('n')}. Treated as one player under two names, not a second person."
            status, reason = attach_pos(r, hit, status, fields, unver, reason)
        elif name_ok and hit["round"] == r.get("dr") and hit["pick"] == r.get("dp"):
            status = "verified"
            fields = ["name", "round", "pick"]
            reason = "round, pick, and name match the Wikipedia draft table; the table has no birth date"
            status, reason = attach_pos(r, hit, status, fields, unver, reason)
        elif name_ok:
            status = "partial"
            fields = ["name"]
            unver += ["pick"]
            reason = f"name matches, file slot R{r.get('dr')} P{r.get('dp')}, page slot R{hit['round']} P{hit['pick']}"
            add_issue(severity="P2", kind="source-verified", pool="draftclass", year=year, name=r.get("n"), finding="pick-slot-differs", evidence=reason, source=page)
            status, reason = attach_pos(r, hit, status, fields, unver, reason)
        else:
            status = "discrepancy"
            fields = ["round", "pick"]
            reason = f"file has {r.get('n')} at R{hit['round']} P{hit['pick']}; page has {hit['name']}"
            add_issue(severity="P1", kind="source-verified", pool="draftclass", year=year, name=hit["name"], finding="pick-name-mismatch", evidence=reason, source=page)
        row_out(r, hit, status, reason, fields, unver)

    absent = 0
    for p in numbered:
        if id(p) in used_wiki:
            continue
        absent += 1
        row_out(None, p, "discrepancy", "Wikipedia lists this pick and the class has no row for it", [], ["birth"])
        add_issue(severity="P2", kind="source-verified", pool="draftclass", year=year, name=p["name"], finding="drafted-player-absent", evidence=f"R{p['round']} P{p['pick']} {p['pos']}", source=page)
    for p in picks:
        if p.get("round") is not None or id(p) in used_wiki:
            continue
        absent += 1
        row_out(None, p, "discrepancy", "Wikipedia lists this player without a pick number and the class has no matching name", [], ["pick", "birth"])
        add_issue(severity="P2", kind="source-verified", pool="draftclass", year=year, name=p["name"], finding="drafted-player-absent", evidence="listed without a pick number", source=page)
    note = f"partial-list {len(numbered)} of {overall}" if page_partial else ""
    coverage.append({"pool": "draftclass", "year": year, "teams": overall or "", "teams_parsed": len(numbered), "teams_unavailable": note, "file_rows": len(ours), "verified": counts["verified"], "partial": counts["partial"], "discrepancy": counts["discrepancy"], "unreviewed": counts["unreviewed"], "on_source_not_in_file": absent})
    print("DRAFT", year, "wiki", len(numbered), "overall", overall, "file", len(ours), dict(counts), "absent", absent, note, flush=True)

print("drafts", flush=True)
for year in list(range(1947, 2027)) + [2027]:
    if year not in class_by_year and year != 2027:
        # still try the page so a missing class is visible
        if year > 2026:
            continue
    cover_draft(year)

def write_csv(path, rows):
    if not rows:
        Path(path).write_text("")
        return
    keys = []
    for r in rows:
        for k in r:
            if k not in keys:
                keys.append(k)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

if DRAFTS_ONLY:
    prev_issues = OUT / "player-audit-verify-issues.csv"
    if prev_issues.exists():
        with prev_issues.open(newline="") as f:
            kept = [r for r in csv.DictReader(f) if r.get("pool") in {"start1996", "history", "start1996-not-in-file"} or str(r.get("finding", "")).startswith(("season-", "team-", "age-", "height-"))]
        issues = kept + issues
    prev_cov = OUT / "player-audit-verify-coverage.csv"
    if prev_cov.exists():
        with prev_cov.open(newline="") as f:
            kept_cov = [r for r in csv.DictReader(f) if not str(r.get("pool", "")).startswith("draft")]
        coverage = kept_cov + coverage
else:
    write_csv(OUT / "player-audit-verify-roster-all.csv", roster_rows)
write_csv(OUT / "player-audit-verify-drafts-all.csv", draft_rows)
write_csv(OUT / "player-audit-verify-issues.csv", issues)
write_csv(OUT / "player-audit-verify-coverage.csv", coverage)
# keep the first-tranche filenames as filtered views
if not DRAFTS_ONLY:
    write_csv(OUT / "player-audit-verify-roster-1997.csv", [r for r in roster_rows if str(r["year"]) == "1997" or r["year"] == 1997])
write_csv(OUT / "player-audit-verify-drafts-1997-2000.csv", [r for r in draft_rows if str(r["year"]) in {"1997", "1998", "1999", "2000"}])
roster_n = len(roster_rows)
roster_status = dict(Counter(r["status"] for r in roster_rows))
if DRAFTS_ONLY and (OUT / "player-audit-verify-roster-all.csv").exists():
    with (OUT / "player-audit-verify-roster-all.csv").open(newline="") as f:
        prev_roster = list(csv.DictReader(f))
    roster_n = len(prev_roster)
    roster_status = dict(Counter(r["status"] for r in prev_roster))
summary = {
    "roster_rows": roster_n,
    "draft_rows": len(draft_rows),
    "issues": len(issues),
    "roster_status": roster_status,
    "draft_status": dict(Counter(r["status"] for r in draft_rows)),
    "findings": dict(Counter(i["finding"] for i in issues)),
    "coverage_years": sorted({str(c["year"]) for c in coverage}),
}
(OUT / "player-audit-verify-summary.json").write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2)[:4000])
