"""
Assembles and STRICTLY VALIDATES all downloaded open-source CT/MRI regional GLB models
(NIH HuBMAP HRA via Git LFS or official HRA SPARQL/CDN, Dundee CAHID Interior Heart,
Brainproject Neuroanatomy, Dental Scope, and user custom_models/*.glb).
Zero silent failures: rejects Git LFS pointers (<50KB or non-glTF magic header).
"""
import glob
import json
import os
import shutil
import sys
import urllib.parse
import urllib.request

OUT_DIR = "public/models"
MANIFEST_PATH = os.path.join(OUT_DIR, "manifest.json")
manifest = json.load(open(MANIFEST_PATH, encoding="utf-8"))

added = []
rejected = []

def is_valid_glb(path, min_bytes=40000):
    if not path or not os.path.isfile(path):
        return False, "missing"
    sz = os.path.getsize(path)
    if sz < min_bytes:
        return False, f"too_small({sz}B)"
    with open(path, "rb") as f:
        hdr = f.read(4)
    if hdr != b"glTF":
        return False, f"invalid_header({hdr!r})"
    return True, f"{round(sz / (1024 * 1024), 2)}MB"

def register_glb(src_path, dest_name, entry):
    ok, info = is_valid_glb(src_path)
    if not ok:
        rejected.append((entry["id"], src_path, info))
        print(f"[Hybrid CT REJECT] {entry['id']} <- {src_path} ({info})")
        return False
    dst = os.path.join(OUT_DIR, dest_name)
    shutil.copy2(src_path, dst)
    sz = round(os.path.getsize(dst) / (1024 * 1024), 2)
    entry["file"] = f"models/{dest_name}"
    entry["sizeMB"] = sz
    entry["standalone"] = True
    entry["defaultVisible"] = False
    entry["defaultOpacity"] = 1.0
    manifest["systems"].insert(0, entry)
    added.append((entry["id"], sz))
    print(f"[Hybrid CT OK] {entry['id']} ({sz} MB) <- {src_path}")
    return True

def download_file(url, dst_path):
    req = urllib.request.Request(url, headers={"User-Agent": "AtlasAnatomicus3D-Builder/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    with open(dst_path, "wb") as f:
        f.write(data)
    return dst_path

def query_hra_sparql_glbs():
    """Fetch official NIH HuBMAP HRA 3D Reference Organ GLB URLs via HRA LOD SPARQL."""
    sparql = """
    SELECT DISTINCT ?url WHERE {
      ?s ?p ?url .
      FILTER(isURI(?url) && CONTAINS(LCASE(STR(?url)), "ref-organ") && STRENDS(LCASE(STR(?url)), ".glb"))
    } LIMIT 200
    """
    endpoint = "https://lod.humanatlas.io/sparql?query=" + urllib.parse.quote(sparql)
    req = urllib.request.Request(
        endpoint,
        headers={"Accept": "application/sparql-results+json", "User-Agent": "AtlasAnatomicus3D-Builder/1.0"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        urls = [b["url"]["value"] for b in payload.get("results", {}).get("bindings", []) if "url" in b]
        print(f"[HRA SPARQL] Found {len(urls)} official GLB URLs")
        return urls
    except Exception as e:
        print(f"[HRA SPARQL Warn] Could not query LOD endpoint: {e}")
        return []

# 1. Cor HD — Dundee CAHID Interior Heart (BT/MR)
heart_glbs = sorted(glob.glob("assets_source/heart_hd/**/*.glb", recursive=True))
print(f"[Scan] heart_hd GLBs: {len(heart_glbs)}")
for hg in heart_glbs:
    if register_glb(hg, "cor_hd.glb", {
        "id": "cor_hd",
        "name": "Cor HD — Interior (BT/MR)",
        "tr": "Dundee CAHID İç Kalp & Kapakçıklar",
        "group": "ct_hd",
        "color": "#b91c1c",
        "meshCount": 1
    }):
        break

# 2. Encephalon HD — Brainproject (MR + MNI Atlas)
brain_glbs = sorted(glob.glob("assets_source/brainproject/**/*.glb", recursive=True))
print(f"[Scan] brainproject GLBs: {len(brain_glbs)}")
brain_glbs.sort(key=lambda p: (0 if "brain.glb" in os.path.basename(p).lower() else 1, -os.path.getsize(p)))
for bg in brain_glbs:
    if register_glb(bg, "encephalon_hd.glb", {
        "id": "encephalon_hd",
        "name": "Encephalon HD (MR Atlas)",
        "tr": "Giruslar, Çekirdekler & Willis Poligonu",
        "group": "ct_hd",
        "color": "#e2b8ac",
        "meshCount": 250
    }):
        break

# 3. Dental Scope — Craniofacial Jaws, Sinuses & Trigeminal Nerves
dental_glbs = sorted(glob.glob("assets_source/dental_scope/**/*.glb", recursive=True))
print(f"[Scan] dental_scope GLBs: {len(dental_glbs)}")
dental_added = 0
for dg in dental_glbs:
    if dental_added >= 4:
        break
    base = os.path.splitext(os.path.basename(dg))[0]
    if register_glb(dg, f"dental_{base}.glb", {
        "id": f"dental_{base}",
        "name": f"Craniofacialis HD: {base.replace('_', ' ').title()}",
        "tr": "BT/Atlas Çene, Sinüs & Trigeminal",
        "group": "ct_hd",
        "color": "#dfd4be",
        "meshCount": 40
    }):
        dental_added += 1

# 4. NIH HuBMAP HRA (Visible Human Project — 1mm CT & 0.33mm Cryo-section)
HRA_TARGETS = [
    (["vh_m_heart", "heart-male"],                     "hra_cor",      "NIH HRA: Cor (Visible Human BT)",      "Kalp — NIH Visible Human", "#c93b3b"),
    (["vh_m_lung", "lung-male"],                       "hra_pulmo",    "NIH HRA: Pulmones (Visible Human BT)", "Akciğerler & Bronşlar",    "#d9778b"),
    (["vh_m_liver", "liver-male"],                     "hra_hepar",    "NIH HRA: Hepar (Visible Human BT)",    "Karaciğer — BT/Kriyo",     "#8b3a2b"),
    (["vh_m_kidney_l", "kidney-male-left"],            "hra_ren_s",    "NIH HRA: Ren Sinister (BT)",           "Sol Böbrek — BT/Kriyo",    "#9d4edd"),
    (["vh_m_kidney_r", "kidney-male-right"],           "hra_ren_d",    "NIH HRA: Ren Dexter (BT)",             "Sağ Böbrek — BT/Kriyo",    "#9d4edd"),
    (["vh_m_pancreas", "pancreas-male"],               "hra_pancreas", "NIH HRA: Pancreas (BT)",               "Pankreas — BT/Kriyo",      "#d9a84e"),
    (["vh_m_spleen", "spleen-male"],                   "hra_splen",    "NIH HRA: Splen (BT)",                  "Dalak — BT/Kriyo",         "#6b2149"),
    (["vh_m_large_intestine", "large-intestine-male"], "hra_colon",    "NIH HRA: Intestinum Crassum (BT)",     "Kalın Bağırsak — BT",      "#a85f4d"),
    (["vh_m_small_intestine", "small-intestine-male"], "hra_tenue",    "NIH HRA: Intestinum Tenue (BT)",       "İnce Bağırsak — BT",       "#d4846e"),
    (["vh_m_pelvis", "pelvis-male"],                   "hra_pelvis",   "NIH HRA: Pelvis (BT)",                 "Pelvis Kemikleri — BT",    "#e5dac3"),
    (["vh_m_blood_vasculature", "blood-vasculature-male"], "hra_vasa", "NIH HRA: Vasa Sanguinea (BT)",         "Damar Ağacı — NIH HRA",    "#d92626")
]

all_hra_local = glob.glob("assets_source/hubmap_hra/**/*.glb", recursive=True)
print(f"[Scan] hubmap_hra local GLBs: {len(all_hra_local)}")
hra_dl_dir = "assets_source/hra_cdn"
os.makedirs(hra_dl_dir, exist_ok=True)
sparql_urls = None

hra_added = 0
for tokens, sid, lat_name, tr_name, col in HRA_TARGETS:
    matches = [p for p in all_hra_local if any(t in p.lower() for t in tokens)]
    matches = [p for p in matches if is_valid_glb(p)[0]]
    chosen = None
    if matches:
        matches.sort()
        chosen = matches[-1]
    else:
        if sparql_urls is None:
            sparql_urls = query_hra_sparql_glbs()
        url_matches = [u for u in sparql_urls if any(t in u.lower() for t in tokens)]
        if url_matches:
            url_matches.sort()
            dl_target = os.path.join(hra_dl_dir, f"{sid}.glb")
            try:
                download_file(url_matches[-1], dl_target)
                chosen = dl_target
            except Exception as e:
                print(f"[HRA DL Warn] {sid} ({url_matches[-1]}): {e}")
    if chosen and register_glb(chosen, f"{sid}.glb", {
        "id": sid,
        "name": lat_name,
        "tr": tr_name,
        "group": "ct_hra",
        "color": col,
        "meshCount": 30
    }):
        hra_added += 1

# 5. User-supplied custom_models/*.glb
for cg in sorted(glob.glob("custom_models/*.glb")):
    base = os.path.splitext(os.path.basename(cg))[0]
    sid = "custom_" + "".join(ch if ch.isalnum() else "_" for ch in base.lower())
    register_glb(cg, f"{sid}.glb", {
        "id": sid,
        "name": f"Özel BT Modeli: {base}",
        "tr": "custom_models/ klasöründen",
        "group": "custom",
        "color": "#e5dac3",
        "meshCount": 1
    })

total_mb = round(sum(s.get("sizeMB", 0) for s in manifest["systems"]), 2)
manifest["ctModuleCount"] = len(added)
manifest["totalModelsMB"] = total_mb
json.dump(manifest, open(MANIFEST_PATH, "w", encoding="utf-8"), ensure_ascii=False)

print(f"[Hybrid CT Assembler] Added {len(added)} CT/MRI modules ({hra_added} NIH HRA), Total Models={total_mb} MB")
print("[Hybrid CT Added]", added)
if rejected:
    print("[Hybrid CT Rejected]", rejected)

if len(added) < 2:
    print("ERROR: Yeterli gecerli BT/MR GLB modeli eklenemedi! Sessiz hata engellendi.", file=sys.stderr)
    sys.exit(1)
