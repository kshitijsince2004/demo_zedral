#!/usr/bin/env python3
"""
Extracts REAL plant data from the uploaded PPC plans (rolling + skin-pass) and
the DPR June 2026 workbook into a single clean JSON file the seed script consumes.

Output: extracted_data.json with keys: ppc, coils, dpr_daily, dpr_delay, meta

Header-driven parsing (robust across the 4 PPC layout variants). DPR daily/delay
dates are remapped onto a contiguous window ending 2026-06-10 so the data lines up
with the live June 1-10 PPC plan window while preserving real magnitudes/shape.
"""
import openpyxl, glob, os, re, json, datetime, sys

PPC_DIR = sys.argv[1] if len(sys.argv) > 1 else "ppc"
DPR_FILE = sys.argv[2] if len(sys.argv) > 2 else "DPR JUNE 2026.xlsx"
MASTER_REF = json.load(open(sys.argv[3] if len(sys.argv) > 3 else "master_ref.json"))
# The DPR workbook has full daily logging for only ~9 contiguous days. Those real
# logged days are the first blocks in the sheet, so we anchor block 0 at WINDOW_START
# (2026-06-01). This lands the 9 real production days on June 1-9 2026, overlapping
# the live PPC plan window (June 1-10) for a continuous, coherent demo timeline.
WINDOW_START = datetime.date(2026, 6, 1)

# ppc_batch.roll_finish CHECK only permits these three values
ALLOWED_FINISH = {"MATT", "BRIGHT", "LOW_MATT"}

def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower()) if s is not None else ""

def to_float(v):
    if v is None: return None
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip().replace(",", "")
    m = re.search(r"-?\d+\.?\d*", s)
    return float(m.group()) if m else None

def clean_finish(v):
    if v is None: return None
    s = str(v).strip().upper().replace(" ", "").replace("-", "_")
    if s in ("LO_MATT", "LOWMATT"): return "LOW_MATT"
    if s == "LOW_MATT": return "LOW_MATT"
    if s in ALLOWED_FINISH: return s
    return None

def parse_date_from_name(fn):
    m = re.search(r"(\d{2})\.(\d{2})\.+(\d{4})", fn)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try: return datetime.date(y, mo, d).isoformat()
        except ValueError: return None
    return None

ALIAS = {
    "mothercoil": "coil_no", "slitid": "slit_id", "batchnumber": "batch_number",
    "saleorder": "sap_order_no", "itemno": "item_no", "customername": "customer_name",
    "grade": "grade_code", "coilweight": "ppc_weight_mt", "width": "width_mm",
    "count": "coil_count", "finishthickness": "finish_thk_mm",
    "prestagethickness": "input_thk_mm", "spthickness": "sp_thk",
    "1strollingthickness": "roll1_thk", "1strollingsurf": "roll_surf1",
    "1strollingsurface": "roll_surf1", "2ndrollingthickness": "roll2_thk",
    "2ndrollingsurf": "roll_surf2", "2ndrollingsurface": "roll_surf2",
    "spsurfacefinish": "sp_surf", "processroute": "process_route_raw",
    "fromworkcenter": "from_work_center", "toworkcenter": "to_work_center",
    "plandate": "plan_date_col", "ageing": "ageing",
}

def build_colmap(header_row):
    cm = {}
    tol_cols = []
    for idx, h in enumerate(header_row):
        n = norm(h)
        if not n: continue
        if "thicktol" in n or "thicktoleranc" in n:
            tol_cols.append(idx); continue
        if n in ALIAS and ALIAS[n] not in cm:
            cm[ALIAS[n]] = idx
        else:
            for k, v in ALIAS.items():
                if (n.startswith(k) or k.startswith(n)) and v not in cm and len(n) >= 4:
                    cm[v] = idx; break
    if tol_cols:
        cm["min_thk_tol_mm"] = tol_cols[0]
        if len(tol_cols) > 1: cm["max_thk_tol_mm"] = tol_cols[1]
    return cm

def extract_ppc():
    rows_out = []
    skipped = 0
    files = sorted(glob.glob(os.path.join(PPC_DIR, "*.xlsx")))
    for f in files:
        base = os.path.basename(f)
        up = base.upper()
        is_skin = "SKIN" in up
        sub_process = "SKIN_PASS" if is_skin else "ROLLING"
        machine_code = "2HI" if is_skin else "4HI"
        plan_date = parse_date_from_name(base)
        wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
        ws = wb.active
        data = list(ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True))
        wb.close()
        if len(data) < 3: continue
        header = data[1]
        cm = build_colmap(header)
        for r in data[2:]:
            if not r: continue
            def g(k):
                i = cm.get(k); return r[i] if (i is not None and i < len(r)) else None
            coil_no = g("coil_no"); batch = g("batch_number")
            if coil_no is None or batch is None: continue
            coil_no = str(coil_no).strip(); batch = str(batch).strip()
            if not coil_no or not batch or coil_no.upper().startswith("MOTHER"): continue
            width = to_float(g("width_mm"))
            weight = to_float(g("ppc_weight_mt"))
            input_thk = to_float(g("input_thk_mm"))
            finish_thk = to_float(g("finish_thk_mm"))
            sp_thk = to_float(g("sp_thk"))
            ppc_thk = (sp_thk if is_skin else finish_thk) or finish_thk or sp_thk or to_float(g("roll1_thk"))
            if input_thk is None: input_thk = ppc_thk
            if None in (width, weight, ppc_thk, input_thk) or (ppc_thk or 0) <= 0 or (width or 0) <= 0:
                skipped += 1; continue
            if is_skin:
                finish = clean_finish(g("sp_surf"))
            else:
                finish = clean_finish(g("roll_surf1")) or clean_finish(g("roll_surf2"))
            cust = g("customer_name")
            cust = str(cust).strip() if cust is not None else None
            if not cust or re.fullmatch(r"\d+(\.\d+)?", cust or ""):
                cust = "PPC HOLD"
            grade = g("grade_code"); grade = (str(grade).strip() if grade else "NA")[:30] or "NA"
            sale = g("sap_order_no")
            rows_out.append({
                "batch_number": batch[:30], "plan_date": plan_date,
                "machine_code": machine_code, "sub_process": sub_process,
                "coil_no": coil_no[:40], "slit_id": (str(g("slit_id")).strip()[:8] if g("slit_id") else None),
                "customer_name": cust[:120], "grade_code": grade,
                "width_mm": round(width, 2), "input_thk_mm": round(input_thk, 3),
                "ppc_thk_mm": round(ppc_thk, 3),
                "finish_thk_mm": round(finish_thk, 3) if finish_thk else None,
                "ppc_weight_mt": round(weight, 3), "roll_finish": finish,
                "sap_order_no": (str(sale).strip()[:30] if sale else None),
                "item_no": (str(g("item_no")).strip()[:20] if g("item_no") else None),
                "process_route_raw": (str(g("process_route_raw")).strip()[:60] if g("process_route_raw") else None),
                "from_work_center": (str(g("from_work_center")).strip()[:10] if g("from_work_center") else None),
                "to_work_center": (str(g("to_work_center")).strip()[:10] if g("to_work_center") else None),
                "source_file": base,
            })
    return rows_out, skipped

def derive_coils(ppc):
    coils = {}
    for b in ppc:
        cn = b["coil_no"]
        if cn not in coils:
            coils[cn] = {
                "coil_no": cn, "customer_name": b["customer_name"],
                "grade_code": b["grade_code"], "nominal_width_mm": b["width_mm"],
                "coil_thk_mm": b["input_thk_mm"], "weight_mt": b["ppc_weight_mt"],
            }
    return list(coils.values())

def dpr_label_map():
    m = {}
    for r in MASTER_REF["line_area"]:
        m[norm(r["dpr_area_label"])] = (r["area_code"], r["process_code"])
    return m

def extract_dpr():
    wb = openpyxl.load_workbook(DPR_FILE, read_only=True, data_only=True)
    lblmap = dpr_label_map()
    ws = wb["NOV 2025"] if "NOV 2025" in wb.sheetnames else wb.worksheets[0]
    data = list(ws.iter_rows(values_only=True))
    anchors = []
    for i, r in enumerate(data):
        for j, c in enumerate(r):
            if c is not None and str(c).strip().upper() == "DATE":
                anchors.append(i); break
    n_blocks = len(anchors)
    daily_dates = [(WINDOW_START + datetime.timedelta(days=i)).isoformat() for i in range(n_blocks)]
    daily = []
    for bi, a in enumerate(anchors):
        end = anchors[bi + 1] if bi + 1 < len(anchors) else len(data)
        date = daily_dates[bi]
        for r in data[a + 1:end]:
            if not r or r[0] is None: continue
            key = norm(r[0])
            if key not in lblmap: continue
            area_code, proc = lblmap[key]
            def v(i): return to_float(r[i]) if i < len(r) else None
            tgt, A, B, C, tot = v(1), v(2), v(3), v(4), v(5)
            if not any(x for x in (A, B, C, tot)): continue
            daily.append({
                "date": date, "area_code": area_code, "process_code": proc,
                "target_mt": tgt, "a_mt": A or 0, "b_mt": B or 0, "c_mt": C or 0,
                "total_mt": tot, "elect_min": v(8) or 0, "mech_min": v(10) or 0,
                "oprn_min": v(12) or 0,
            })
    wd = wb["DELAY"]
    dd = list(wd.iter_rows(values_only=True))
    danchors = [i for i, r in enumerate(dd)
                if r and r[0] is not None and str(r[0]).strip().upper() == "LINE"]
    delays = []
    def agency(a):
        a = (a or "").upper()
        if "MMD" in a or "MECH" in a: return "MECH"
        if "EMD" in a or "ELE" in a: return "EL"
        return "OP"
    for bi, a in enumerate(danchors):
        end = danchors[bi + 1] if bi + 1 < len(danchors) else len(dd)
        day_index = bi // 3
        if day_index >= len(daily_dates): break
        date = daily_dates[day_index]
        for r in dd[a + 1:end]:
            if not r or r[0] is None: continue
            key = norm(r[0])
            if key not in lblmap: continue
            shift = (str(r[2]).strip().upper() if len(r) > 2 and r[2] else None)
            if shift not in ("A", "B", "C"): continue
            timev = r[3] if len(r) > 3 else None
            reason = r[5] if len(r) > 5 else None
            if reason is None or str(reason).strip().upper() in ("", "NIL"): continue
            mins = [int(x) for x in re.findall(r"\d+", str(timev))] if timev else []
            dur = min(sum(mins), 470) if mins else 0
            if dur <= 0: continue
            area_code, proc = lblmap[key]
            delays.append({
                "date": date, "shift_code": shift, "area_code": area_code,
                "process_code": proc, "duration_min": dur,
                "agency_code": agency(str(r[4]) if len(r) > 4 else ""),
                "reason": str(reason).strip()[:120],
            })
    wb.close()
    return daily, delays, {"daily_dates": daily_dates, "n_blocks": n_blocks}

def main():
    ppc, skipped = extract_ppc()
    coils = derive_coils(ppc)
    daily, delays, meta = extract_dpr()
    out = {
        "ppc": ppc, "coils": coils, "dpr_daily": daily, "dpr_delay": delays,
        "meta": {"ppc_rows": len(ppc), "ppc_skipped": skipped, "coils": len(coils),
                 "dpr_daily": len(daily), "dpr_delay": len(delays),
                 "window": [meta["daily_dates"][0], meta["daily_dates"][-1]],
                 "dpr_blocks": meta["n_blocks"]},
    }
    json.dump(out, open("extracted_data.json", "w"))
    print(json.dumps(out["meta"], indent=1))
    from collections import Counter
    print("ppc by machine/sub:", Counter((b["machine_code"], b["sub_process"]) for b in ppc))
    print("ppc plan_dates:", sorted(set(b["plan_date"] for b in ppc)))
    print("top customers:", Counter(b["customer_name"] for b in ppc).most_common(8))
    print("dpr daily areas:", Counter(d["area_code"] for d in daily).most_common(6))
    print("sample delay:", delays[0] if delays else None)

if __name__ == "__main__":
    main()
