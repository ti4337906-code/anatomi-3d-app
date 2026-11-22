import csv
import json
import os
import re
import sys
import bpy

argv = sys.argv
argv = argv[argv.index("--") + 1:] if "--" in argv else []
ta2_path = "assets_source/TA2.csv"
out_dir = "public/models"
for i, arg in enumerate(argv):
    if arg == "--ta2" and i + 1 < len(argv):
        ta2_path = argv[i + 1]
    elif arg == "--out" and i + 1 < len(argv):
        out_dir = argv[i + 1]

os.makedirs(out_dir, exist_ok=True)

def _unhide_cols(lc):
    lc.exclude = False
    lc.hide_viewport = False
    for ch in lc.children:
        _unhide_cols(ch)

_unhide_cols(bpy.context.view_layer.layer_collection)

# 1. Robust TA2.csv parser (detects delimiter and Latin/English/TA2 columns)
ta2_lookup = {}
if os.path.exists(ta2_path):
    with open(ta2_path, "r", encoding="utf-8", errors="replace") as f:
        sample = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except Exception:
            dialect = csv.excel
        reader = csv.reader(f, dialect)
        header = [h.strip().lower() for h in (next(reader, None) or [])]

        code_idx = next((i for i, h in enumerate(header) if "ta2" in h or "code" in h or "id" in h), 0)
        lat_idx = next((i for i, h in enumerate(header) if "latin" in h), 1 if len(header) > 1 else 0)
        eng_idx = next((i for i, h in enumerate(header) if "english" in h or "en" == h or "name" in h), 2 if len(header) > 2 else lat_idx)

        for row in reader:
            if not row or len(row) <= max(code_idx, lat_idx):
                continue
            code = row[code_idx].strip()
            latin = row[lat_idx].strip() if lat_idx < len(row) else ""
            eng = row[eng_idx].strip() if eng_idx < len(row) else latin
            if not latin and eng:
                latin = eng
            entry = {"ta2Code": code, "latin": latin, "english": eng}
            for cand in (latin, eng):
                if cand:
                    k = re.sub(r"[^a-z0-9]", "", cand.lower())
                    if k and k not in ta2_lookup:
                        ta2_lookup[k] = entry

SYSTEM_RULES = [
    ("skeletal",       ["skeletal", "bone", "bones", "skeleton", "skull", "cranium", "vertebra", "rib", "thoracic cage", "ossa"]),
    ("joints",         ["joint", "joints", "articular", "ligament", "cartilage", "bursa", "meniscus", "synovial"]),
    ("muscular",       ["muscular", "muscle", "muscles", "tendon", "aponeurosis", "fascia", "muscul"]),
    ("cardiovascular", ["cardiovascular", "heart", "artery", "arteries", "arteria", "vein", "veins", "vena", "vascular", "aorta", "lymph", "coronar", "atrium", "ventric", "sinus"]),
    ("nervous",        ["nervous", "nerve", "nerves", "nervus", "brain", "encephal", "spinal", "plexus", "sense", "eye", "ear", "gangli"]),
    ("visceral",       ["visceral", "viscera", "digestive", "respiratory", "urinary", "renal", "reproductive", "endocrine", "lung", "liver", "stomach", "intestine", "kidney"]),
    ("integumentary",  ["integument", "skin", "region", "surface", "hair", "nail"])
]

SYSTEM_META = {
    "skeletal":       {"name": "Systema skeletale",       "tr": "İskelet Sistemi",      "color": "#e5dac3", "defaultVisible": True,  "defaultOpacity": 1.0},
    "joints":         {"name": "Systema articulare",      "tr": "Eklemler ve Bağlar",   "color": "#93c5fd", "defaultVisible": False, "defaultOpacity": 1.0},
    "muscular":       {"name": "Systema musculare",       "tr": "Kas Sistemi",          "color": "#9f3535", "defaultVisible": False, "defaultOpacity": 1.0},
    "cardiovascular": {"name": "Systema cardiovasculare", "tr": "Dolaşım ve Lenfatik",  "color": "#d92626", "defaultVisible": False, "defaultOpacity": 1.0},
    "nervous":        {"name": "Systema nervosum",        "tr": "Sinir Sistemi",        "color": "#eab308", "defaultVisible": False, "defaultOpacity": 1.0},
    "visceral":       {"name": "Viscera",                 "tr": "İç Organlar",          "color": "#c27b60", "defaultVisible": False, "defaultOpacity": 1.0},
    "integumentary":  {"name": "Integumentum commune",    "tr": "Dış Yüzey (Deri)",     "color": "#c9a892", "defaultVisible": False, "defaultOpacity": 0.25}
}

def classify_object(obj):
    col_names = " ".join(c.name.lower() for c in obj.users_collection)
    combined = col_names + " " + obj.name.lower()
    for sys_id, keywords in SYSTEM_RULES:
        if any(kw in combined for kw in keywords):
            return sys_id
    return "visceral"

def classify_subtype(sys_id, name_str, region_str):
    txt = (name_str + " " + region_str).lower()
    if any(k in txt for k in ("lymph", "nodi ", "nodus ", "ductus thoracicus", "cisterna chyli", "spleen", "thymus")):
        return "lymph"
    if any(k in txt for k in ("vein", "vena ", "venae", "venous", "venosus", "sinus ", "jugular", "saphen", "cava")):
        return "vein"
    if any(k in txt for k in ("artery", "arteria", "arteriae", "aorta", "carotid", "coronar", "truncus pulmonalis", "arterios")):
        return "artery"
    if any(k in txt for k in ("heart", "cor ", "atrium", "ventric", "myocard", "pericard")):
        return "heart"
    if sys_id == "nervous" or any(k in txt for k in ("nerve", "nervus", "plexus", "gangli", "brain", "cerebr", "cerebell", "spinal")):
        return "nerve"
    if sys_id == "joints" or any(k in txt for k in ("ligament", "cartilag", "menisc", "discus", "bursa", "capsul")):
        return "ligament"
    if sys_id == "muscular":
        return "muscle"
    if sys_id == "skeletal":
        return "bone"
    return "viscera"

def clean_name(raw_name):
    side = ""
    name = raw_name.strip()
    name = re.sub(r"^(Label[-_\s]*|Text[-_\s]*)", "", name, flags=re.IGNORECASE)
    if name.endswith(".r") or name.endswith("_r"):
        side = " (Dexter)"; name = name[:-2]
    elif name.endswith(".l") or name.endswith("_l"):
        side = " (Sinister)"; name = name[:-2]
    name = re.sub(r"\.\d{3}$", "", name)
    name = name.replace("_", " ").strip()
    return (name + side).strip(), name.strip()

by_system = {k: [] for k in SYSTEM_META.keys()}
manifest_structures = []
landmarks = []
seen_landmarks = set()

for obj in bpy.context.view_layer.objects:
    sys_id = classify_object(obj)
    col_path = [c.name for c in obj.users_collection if c.name != "Scene Collection"]
    region_str = " > ".join(col_path) if col_path else sys_id
    lower_n = obj.name.lower()

    is_label_obj = obj.type in ("FONT", "EMPTY") or "label" in lower_n or lower_n.startswith("text")
    if is_label_obj:
        raw_txt = obj.name
        if obj.type == "FONT":
            try:
                body = obj.data.body
                if body:
                    raw_txt = body
            except Exception:
                raw_txt = obj.name
        disp, base = clean_name(raw_txt)
        if len(base) >= 3 and not base.lower().startswith(("camera", "light", "lamp", "line", "arrow")):
            loc = obj.matrix_world.translation
            pos = [round(float(loc.x), 4), round(float(loc.z), 4), round(float(-loc.y), 4)]
            dedup = (disp.lower(), round(pos[0], 2), round(pos[1], 2), round(pos[2], 2))
            if dedup not in seen_landmarks:
                seen_landmarks.add(dedup)
                key = re.sub(r"[^a-z0-9]", "", base.lower())
                ta2_info = ta2_lookup.get(key, {})
                latin_name = ta2_info.get("latin", disp)
                landmarks.append({
                    "latin": latin_name,
                    "name": disp,
                    "ta2": ta2_info.get("ta2Code", ""),
                    "system": sys_id,
                    "region": region_str,
                    "pos": pos
                })
        continue

    if obj.type not in ("MESH", "CURVE", "SURFACE"):
        continue
    if "line" in lower_n and not any(k in lower_n for k in ("arter", "vein", "vena", "nerv", "aorta", "trunk", "plexus", "branch", "ramus", "lymph")):
        continue
    if obj.type == "MESH" and len(obj.data.vertices) < 3:
        continue

    disp, base = clean_name(obj.name)
    key = re.sub(r"[^a-z0-9]", "", base.lower())
    ta2_info = ta2_lookup.get(key, {})
    latin_name = ta2_info.get("latin", disp)
    subtype = classify_subtype(sys_id, latin_name + " " + disp, region_str)

    obj["anat_system"] = sys_id
    obj["anat_subtype"] = subtype
    obj["anat_latin"] = latin_name
    obj["anat_name"] = disp
    obj["anat_ta2"] = ta2_info.get("ta2Code", "")
    obj["anat_region"] = region_str

    by_system[sys_id].append(obj)
    manifest_structures.append({
        "meshName": obj.name,
        "latin": latin_name,
        "name": disp,
        "ta2": obj["anat_ta2"],
        "system": sys_id,
        "subtype": subtype,
        "region": region_str
    })

exported_systems = []
for sys_id, objs in by_system.items():
    if not objs:
        continue

    curves = [o for o in objs if o.type in ("CURVE", "SURFACE") and o.name in bpy.context.view_layer.objects]
    if curves:
        bpy.ops.object.select_all(action="DESELECT")
        for c in curves:
            c.hide_set(False)
            c.hide_viewport = False
            c.select_set(True)
        bpy.context.view_layer.objects.active = curves[0]
        try:
            bpy.ops.object.convert(target="MESH")
        except Exception as e:
            print(f"[Warn] Curve convert ({sys_id}):", e)

    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        if o.name not in bpy.context.view_layer.objects or o.type != "MESH":
            continue
        o.hide_set(False)
        o.hide_viewport = False
        o.select_set(True)

    out_file = os.path.join(out_dir, f"{sys_id}.glb")
    print(f"[Z-Anatomy Export] {sys_id}: {len(objs)} meshes -> {out_file}")
    bpy.ops.export_scene.gltf(
        filepath=out_file,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_extras=True,
        export_yup=True,
        export_materials="EXPORT",
        export_draco_mesh_compression_enable=False
    )
    size_mb = round(os.path.getsize(out_file) / (1024 * 1024), 2)
    meta = dict(SYSTEM_META[sys_id])
    meta["id"] = sys_id
    meta["file"] = f"models/{sys_id}.glb"
    meta["meshCount"] = len(objs)
    meta["sizeMB"] = size_mb
    exported_systems.append(meta)

with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as mf:
    json.dump({
        "source": "Z-Anatomy / BodyParts3D (DBCLS)",
        "license": "CC BY-SA 4.0",
        "totalStructures": len(manifest_structures),
        "totalLandmarks": len(landmarks),
        "systems": exported_systems,
        "structures": manifest_structures
    }, mf, ensure_ascii=False)

with open(os.path.join(out_dir, "landmarks.json"), "w", encoding="utf-8") as lf:
    json.dump(landmarks, lf, ensure_ascii=False)

print(f"[Z-Anatomy Export] Done. Meshes={len(manifest_structures)}, Landmarks={len(landmarks)}")
