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

ta2_lookup = {}
if os.path.exists(ta2_path):
    with open(ta2_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        next(reader, None)
        for row in reader:
            joined = [c.strip() for c in row if c.strip()]
            if len(joined) >= 2:
                key = re.sub(r"[^a-z0-9]", "", joined[1].lower())
                ta2_lookup[key] = {
                    "ta2Code": joined[0],
                    "latin": joined[1],
                    "english": joined[2] if len(joined) > 2 else joined[1]
                }

SYSTEM_RULES = [
    ("skeletal",       ["skeletal", "bone", "bones", "skeleton", "skull", "cranium", "vertebra", "rib", "thoracic cage"]),
    ("joints",         ["joint", "joints", "articular", "ligament", "cartilage", "bursa", "meniscus", "synovial"]),
    ("muscular",       ["muscular", "muscle", "muscles", "tendon", "aponeurosis", "fascia"]),
    ("cardiovascular", ["cardiovascular", "heart", "artery", "arteries", "vein", "veins", "vascular", "aorta", "lymph", "coronar", "atrium", "ventric"]),
    ("nervous",        ["nervous", "nerve", "nerves", "brain", "encephal", "spinal", "plexus", "sense", "eye", "ear"]),
    ("visceral",       ["visceral", "viscera", "digestive", "respiratory", "urinary", "renal", "reproductive", "endocrine", "lung", "liver", "stomach", "intestine", "kidney"]),
    ("integumentary",  ["integument", "skin", "region", "surface", "hair", "nail"])
]

SYSTEM_META = {
    "skeletal":       {"name": "İskelet Sistemi", "latin": "Systema skeletale", "color": "#dfd4be", "defaultVisible": True,  "defaultOpacity": 1.0},
    "joints":         {"name": "Eklemler ve Bağlar", "latin": "Systema articulare", "color": "#b8c7d9", "defaultVisible": False, "defaultOpacity": 1.0},
    "muscular":       {"name": "Kas Sistemi", "latin": "Systema musculare", "color": "#a84444", "defaultVisible": False, "defaultOpacity": 1.0},
    "cardiovascular": {"name": "Dolaşım ve Lenfatik", "latin": "Systema cardiovasculare", "color": "#c93b3b", "defaultVisible": False, "defaultOpacity": 1.0},
    "nervous":        {"name": "Sinir Sistemi ve Duyu", "latin": "Systema nervosum", "color": "#d4b34e", "defaultVisible": False, "defaultOpacity": 1.0},
    "visceral":       {"name": "İç Organlar (Vissera)", "latin": "Viscera (Splanchnologia)", "color": "#c27b60", "defaultVisible": False, "defaultOpacity": 1.0},
    "integumentary":  {"name": "Dış Yüzey (Deri)", "latin": "Integumentum commune", "color": "#c9a892", "defaultVisible": False, "defaultOpacity": 0.25}
}

def classify_object(obj):
    col_names = " ".join(c.name.lower() for c in obj.users_collection)
    combined = col_names + " " + obj.name.lower()
    for sys_id, keywords in SYSTEM_RULES:
        if any(kw in combined for kw in keywords):
            return sys_id
    return "visceral"

def clean_name(raw_name):
    side = ""
    name = raw_name.strip()
    name = re.sub(r"^(Label[-_\s]*|Text[-_\s]*)", "", name, flags=re.IGNORECASE)
    if name.endswith(".r") or name.endswith("_r"):
        side = " (Sağ)"; name = name[:-2]
    elif name.endswith(".l") or name.endswith("_l"):
        side = " (Sol)"; name = name[:-2]
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

    # 1. Capture 3D anatomical landmarks (Labels / Text / Empties like Ostium sinus coronarii, Foramina, Sulci)
    is_label_obj = obj.type in ("FONT", "EMPTY") or "label" in lower_n or lower_n.startswith("text")
    if is_label_obj:
        raw_txt = obj.data.body if (obj.type == "FONT" and getattr(obj.data, "body", "")) else obj.name
        disp, base = clean_name(raw_txt)
        if len(base) >= 3 and not base.lower().startswith(("camera", "light", "lamp", "line", "arrow")):
            loc = obj.matrix_world.translation
            # Blender Z-up -> glTF Y-up: (x, z, -y)
            pos = [round(float(loc.x), 4), round(float(loc.z), 4), round(float(-loc.y), 4)]
            dedup = (disp.lower(), round(pos[0], 2), round(pos[1], 2), round(pos[2], 2))
            if dedup not in seen_landmarks:
                seen_landmarks.add(dedup)
                key = re.sub(r"[^a-z0-9]", "", base.lower())
                ta2_info = ta2_lookup.get(key, {})
                landmarks.append({
                    "name": disp,
                    "latin": ta2_info.get("latin", base),
                    "ta2": ta2_info.get("ta2Code", ""),
                    "system": sys_id,
                    "region": region_str,
                    "pos": pos
                })
        continue

    if obj.type != "MESH" or "line" in lower_n or len(obj.data.vertices) < 3:
        continue

    disp, base = clean_name(obj.name)
    key = re.sub(r"[^a-z0-9]", "", base.lower())
    ta2_info = ta2_lookup.get(key, {})

    obj["anat_system"] = sys_id
    obj["anat_name"] = disp
    obj["anat_latin"] = ta2_info.get("latin", base)
    obj["anat_ta2"] = ta2_info.get("ta2Code", "")
    obj["anat_region"] = region_str

    by_system[sys_id].append(obj)
    manifest_structures.append({
        "meshName": obj.name,
        "name": disp,
        "latin": obj["anat_latin"],
        "ta2": obj["anat_ta2"],
        "system": sys_id,
        "region": region_str
    })

exported_systems = []
for sys_id, objs in by_system.items():
    if not objs:
        continue
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        if o.name not in bpy.context.view_layer.objects:
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
