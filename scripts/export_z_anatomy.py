"""
Headless Blender Python script to export Z-Anatomy (Startup.blend) into
system-layered, Draco-compressed GLB files with Terminologia Anatomica (TA2)
metadata preserved on every mesh.

Usage:
  blender -b assets_source/Startup.blend -P scripts/export_z_anatomy.py -- \
    --ta2 assets_source/TA2.csv \
    --out public/models
"""
import csv
import json
import os
import re
import sys
import bpy

# Parse CLI args after '--'
argv = sys.argv
if "--" in argv:
    argv = argv[argv.index("--") + 1:]
else:
    argv = []

ta2_path = "assets_source/TA2.csv"
out_dir = "public/models"
for i, arg in enumerate(argv):
    if arg == "--ta2" and i + 1 < len(argv):
        ta2_path = argv[i + 1]
    elif arg == "--out" and i + 1 < len(argv):
        out_dir = argv[i + 1]

os.makedirs(out_dir, exist_ok=True)

# 1. Load TA2.csv lookup (clean name -> Latin/TA2 metadata)
ta2_lookup = {}
if os.path.exists(ta2_path):
    with open(ta2_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        for row in reader:
            if not row:
                continue
            joined = [c.strip() for c in row if c.strip()]
            if len(joined) >= 2:
                key = re.sub(r"[^a-z0-9]", "", joined[1].lower())
                ta2_lookup[key] = {
                    "ta2Code": joined[0] if len(joined) > 0 else "",
                    "latin": joined[1] if len(joined) > 1 else "",
                    "english": joined[2] if len(joined) > 2 else joined[1]
                }

# 2. System classification rules based on Z-Anatomy collection names
SYSTEM_RULES = [
    ("skeletal",       ["skeletal", "bone", "bones", "skeleton", "skull", "cranium", "vertebra", "rib", "thoracic cage"]),
    ("joints",         ["joint", "joints", "articular", "ligament", "cartilage", "bursa", "meniscus", "synovial"]),
    ("muscular",       ["muscular", "muscle", "muscles", "tendon", "aponeurosis", "fascia"]),
    ("cardiovascular", ["cardiovascular", "heart", "artery", "arteries", "vein", "veins", "vascular", "aorta", "lymph"]),
    ("nervous",        ["nervous", "nerve", "nerves", "brain", "encephal", "spinal", "plexus", "sense", "eye", "ear"]),
    ("visceral",       ["visceral", "viscera", "digestive", "respiratory", "urinary", "renal", "reproductive", "endocrine", "lung", "liver", "stomach", "intestine", "kidney"]),
    ("integumentary",  ["integument", "skin", "region", "surface", "hair", "nail"])
]

SYSTEM_META = {
    "skeletal":       {"name": "İskelet Sistemi", "latin": "Systema skeletale", "color": "#e6dcc8", "defaultVisible": True,  "defaultOpacity": 1.0},
    "joints":         {"name": "Eklemler ve Bağlar", "latin": "Systema articulare", "color": "#93c5fd", "defaultVisible": True,  "defaultOpacity": 0.95},
    "muscular":       {"name": "Kas Sistemi", "latin": "Systema musculare", "color": "#b83c3c", "defaultVisible": False, "defaultOpacity": 0.85},
    "cardiovascular": {"name": "Dolaşım ve Lenfatik", "latin": "Systema cardiovasculare", "color": "#dc2626", "defaultVisible": True,  "defaultOpacity": 1.0},
    "nervous":        {"name": "Sinir Sistemi ve Duyu", "latin": "Systema nervosum", "color": "#eab308", "defaultVisible": True,  "defaultOpacity": 1.0},
    "visceral":       {"name": "İç Organlar (Vissera)", "latin": "Viscera (Splanchnologia)", "color": "#d97757", "defaultVisible": True,  "defaultOpacity": 0.95},
    "integumentary":  {"name": "Dış Yüzey (Deri)", "latin": "Integumentum commune", "color": "#60a5fa", "defaultVisible": False, "defaultOpacity": 0.16}
}

def classify_object(obj):
    col_names = " ".join(c.name.lower() for c in obj.users_collection)
    obj_name = obj.name.lower()
    combined = col_names + " " + obj_name
    for sys_id, keywords in SYSTEM_RULES:
        if any(kw in combined for kw in keywords):
            return sys_id
    return "visceral"

def clean_anatomical_name(raw_name):
    # Strip Blender duplicate suffixes like .001, .l, .r while preserving side tag
    side = ""
    name = raw_name.strip()
    if name.endswith(".r") or name.endswith("_r"):
        side = " (Sağ)"
        name = name[:-2]
    elif name.endswith(".l") or name.endswith("_l"):
        side = " (Sol)"
        name = name[:-2]
    name = re.sub(r"\.\d{3}$", "", name)
    name = name.replace("_", " ").strip()
    return name + side, name

# 3. Group all real MESH objects (skip labels, text, cameras, empties, curves)
by_system = {k: [] for k in SYSTEM_META.keys()}
manifest_structures = []

for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    if obj.hide_render and "label" in obj.name.lower():
        continue
    if "label" in obj.name.lower() or "line" in obj.name.lower() or obj.name.startswith("Text"):
        continue
    if len(obj.data.vertices) < 3:
        continue

    sys_id = classify_object(obj)
    display_name, base_name = clean_anatomical_name(obj.name)
    col_path = [c.name for c in obj.users_collection if c.name != "Scene Collection"]

    lookup_key = re.sub(r"[^a-z0-9]", "", base_name.lower())
    ta2_info = ta2_lookup.get(lookup_key, {})

    obj["anat_system"] = sys_id
    obj["anat_name"] = display_name
    obj["anat_latin"] = ta2_info.get("latin", base_name)
    obj["anat_ta2"] = ta2_info.get("ta2Code", "")
    obj["anat_region"] = " > ".join(col_path) if col_path else sys_id

    by_system[sys_id].append(obj)
    manifest_structures.append({
        "meshName": obj.name,
        "name": display_name,
        "latin": obj["anat_latin"],
        "ta2": obj["anat_ta2"],
        "system": sys_id,
        "region": obj["anat_region"]
    })

# 4. Export each system to a separate Draco-compressed GLB (high detail preserved)
exported_systems = []
for sys_id, objs in by_system.items():
    if not objs:
        continue

    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
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
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10
    )

    size_mb = round(os.path.getsize(out_file) / (1024 * 1024), 2)
    meta = dict(SYSTEM_META[sys_id])
    meta["id"] = sys_id
    meta["file"] = f"models/{sys_id}.glb"
    meta["meshCount"] = len(objs)
    meta["sizeMB"] = size_mb
    exported_systems.append(meta)

manifest = {
    "source": "Z-Anatomy (Models-of-human-anatomy) / BodyParts3D (DBCLS)",
    "license": "CC BY-SA 4.0",
    "totalStructures": len(manifest_structures),
    "systems": exported_systems,
    "structures": manifest_structures
}

with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as mf:
    json.dump(manifest, mf, ensure_ascii=False)

print(f"[Z-Anatomy Export] Done. Total meshes exported: {len(manifest_structures)}")
