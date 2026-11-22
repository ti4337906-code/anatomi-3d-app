"""
Assembles all downloaded open-source CT/MRI regional GLB models (NIH HuBMAP HRA,
Dundee CAHID Interior Heart, Brainproject Neuroanatomy, Dental Scope, and any
user-supplied custom_models/*.glb) into public/models/manifest.json.
"""
import glob
import json
import os
import shutil

OUT_DIR = "public/models"
MANIFEST_PATH = os.path.join(OUT_DIR, "manifest.json")
manifest = json.load(open(MANIFEST_PATH, encoding="utf-8"))

added = []

def register_glb(src_path, dest_name, entry):
    if not src_path or not os.path.isfile(src_path):
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
    return True

# 1. Cor HD — Dundee CAHID Interior Heart (BT/MR)
heart_glbs = glob.glob("assets_source/heart_hd/**/*.glb", recursive=True)
if heart_glbs:
    register_glb(heart_glbs[0], "cor_hd.glb", {
        "id": "cor_hd",
        "name": "Cor HD — Interior (BT/MR)",
        "tr": "Dundee CAHID İç Kalp & Kapakçıklar",
        "group": "ct_hd",
        "color": "#b91c1c",
        "meshCount": 1
    })

# 2. Encephalon HD — Brainproject (MR + MNI Atlas)
brain_glbs = glob.glob("assets_source/brainproject/**/brain.glb", recursive=True)
if brain_glbs:
    register_glb(brain_glbs[0], "encephalon_hd.glb", {
        "id": "encephalon_hd",
        "name": "Encephalon HD (MR Atlas)",
        "tr": "Giruslar, Çekirdekler & Willis Poligonu",
        "group": "ct_hd",
        "color": "#e2b8ac",
        "meshCount": 250
    })

# 3. Dental Scope — Craniofacial Jaws, Sinuses & Trigeminal Nerves
dental_glbs = sorted(glob.glob("assets_source/dental_scope/public/models/*.glb"))
for i, dg in enumerate(dental_glbs[:4]):
    base = os.path.splitext(os.path.basename(dg))[0]
    register_glb(dg, f"dental_{base}.glb", {
        "id": f"dental_{base}",
        "name": f"Craniofacialis HD: {base.replace('_', ' ').title()}",
        "tr": "BT/Atlas Çene, Sinüs & Trigeminal",
        "group": "ct_hd",
        "color": "#dfd4be",
        "meshCount": 40
    })

# 4. NIH HuBMAP HRA (Visible Human Project — 1mm CT & 0.33mm Cryo-section)
HRA_TARGETS = [
    ("VH_M_Heart",           "hra_cor",        "NIH HRA: Cor (Visible Human BT)",      "Kalp — NIH Visible Human", "#c93b3b"),
    ("VH_M_Lung",            "hra_pulmo",      "NIH HRA: Pulmones (Visible Human BT)", "Akciğerler & Bronşlar",    "#d9778b"),
    ("VH_M_Liver",           "hra_hepar",      "NIH HRA: Hepar (Visible Human BT)",    "Karaciğer — BT/Kriyo",     "#8b3a2b"),
    ("VH_M_Kidney_L",        "hra_ren_s",      "NIH HRA: Ren Sinister (BT)",           "Sol Böbrek — BT/Kriyo",    "#9d4edd"),
    ("VH_M_Kidney_R",        "hra_ren_d",      "NIH HRA: Ren Dexter (BT)",             "Sağ Böbrek — BT/Kriyo",    "#9d4edd"),
    ("VH_M_Pancreas",        "hra_pancreas",   "NIH HRA: Pancreas (BT)",               "Pankreas — BT/Kriyo",      "#d9a84e"),
    ("VH_M_Spleen",          "hra_splen",      "NIH HRA: Splen (BT)",                  "Dalak — BT/Kriyo",         "#6b2149"),
    ("VH_M_Large_Intestine", "hra_colon",      "NIH HRA: Intestinum Crassum (BT)",     "Kalın Bağırsak — BT",      "#a85f4d"),
    ("VH_M_Small_Intestine", "hra_tenue",      "NIH HRA: Intestinum Tenue (BT)",       "İnce Bağırsak — BT",       "#d4846e"),
    ("VH_M_Pelvis",          "hra_pelvis",     "NIH HRA: Pelvis (BT)",                 "Pelvis Kemikleri — BT",    "#e5dac3"),
    ("VH_M_Blood_Vasculature","hra_vasa",      "NIH HRA: Vasa Sanguinea (BT)",         "Damar Ağacı — NIH HRA",    "#d92626")
]

all_hra = glob.glob("assets_source/hubmap_hra/**/*.glb", recursive=True)
for token, sid, lat_name, tr_name, col in HRA_TARGETS:
    matches = [p for p in all_hra if token.lower() in os.path.basename(p).lower()]
    if matches:
        # Pick latest version if multiple exist
        matches.sort()
        register_glb(matches[-1], f"{sid}.glb", {
            "id": sid,
            "name": lat_name,
            "tr": tr_name,
            "group": "ct_hra",
            "color": col,
            "meshCount": 30
        })

# 5. User-supplied custom_models/*.glb (e.g. high-res CT skull from NIH 3D)
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

json.dump(manifest, open(MANIFEST_PATH, "w", encoding="utf-8"), ensure_ascii=False)
print(f"[Hybrid CT Assembler] Added {len(added)} CT/MRI modules:", added)
