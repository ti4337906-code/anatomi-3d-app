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

# 1. Robust TA2.csv parser
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
        eng_idx = next((i for i, h in enumerate(header) if "english" in h or h == "en" or "name" in h), 2 if len(header) > 2 else lat_idx)

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

# Strict helper / plane / cutter / MRI slice exclusion rules
HELPER_COL_KEYWORDS = (
    "cross-section", "cross section", "section", "mri", "slice", "cutter",
    "boolean", "helper", "reference", "gizmo", "interface", "background",
    "regions", "surface region", "labels", "annotations", "planes", "camera", "light"
)
HELPER_NAME_KEYWORDS = (
    "plane", "slice", "section", "cutter", "boolean", "box", "cube", "grid",
    "mri", "gizmo", "panel", "frame", "background", "backdrop", "quad", "rect",
    "arrow", "pointer", "marker", "profile", "bevel", "camera", "light", "lamp", "empty"
)

SYSTEM_RULES = [
    ("lymphatica",    ["lymph", "nodi ", "nodus ", "ductus thoracicus", "cisterna chyli", "spleen", "splen", "thymus", "tonsil"]),
    ("venae",         ["vein", "vena ", "venae", "venous", "venosus", "jugular", "saphen", "cava", "azygos", "portal", "sinus coronarius", "sinus sagittalis", "sinus transversus"]),
    ("arteriae",      ["heart", "cor ", "atrium", "ventric", "pericard", "myocard", "valva", "artery", "arteria", "arteriae", "aorta", "carotid", "coronar", "truncus pulmonalis", "subclavian", "femoral artery", "iliac artery", "cardiovascular"]),
    ("respiratory",   ["respirat", "lung", "pulmo", "trachea", "bronch", "larynx", "laryng", "pleura", "pharynx", "nasal cavity", "alvei", "epiglott", "cricoid", "thyroid cartilage", "arytenoid"]),
    ("digestive",     ["digest", "esophag", "oesophag", "stomach", "gaster", "gastric", "liver", "hepar", "hepat", "gallbladder", "vesica biliar", "bile", "biliar", "pancreas", "duoden", "jejun", "ileum", "colon", "cecum", "caecum", "appendix", "rectum", "intestin", "periton", "omentum", "mesenter", "salivary", "parotid", "tongue", "lingua", "tooth", "teeth", "dent"]),
    ("urogenital",    ["urinar", "kidney", "ren ", "renal", "ureter", "bladder", "vesica urin", "urethra", "adrenal", "suprarenal", "prostate", "testis", "uterus", "ovary", "genital", "reproduct", "endocrin", "thyroid gland"]),
    ("nervous",       ["nervous", "nerve", "nerves", "nervus", "brain", "encephal", "cerebr", "cerebell", "spinal", "plexus", "sense", "eye", "ear", "gangli", "medulla oblongata", "pons", "thalamus"]),
    ("skeletal",      ["skeletal", "bone", "bones", "skeleton", "skull", "cranium", "vertebra", "rib", "costa", "sternum", "femur", "tibia", "fibula", "humerus", "radius", "ulna", "pelvis", "scapula", "clavic", "mandib", "maxilla", "ossa"]),
    ("joints",        ["joint", "joints", "articular", "ligament", "cartilage", "bursa", "meniscus", "synovial", "discus", "capsule"]),
    ("muscular",      ["muscular", "muscle", "muscles", "tendon", "aponeurosis", "fascia", "muscul", "diaphragm"])
]

SYSTEM_META = {
    "arteriae":    {"name": "Cor et Arteriae",       "tr": "Kalp ve Arteriyel Ağaç", "color": "#d92626", "defaultVisible": True,  "defaultOpacity": 1.0},
    "venae":       {"name": "Venae",                 "tr": "Venöz Sistem",           "color": "#1d4ed8", "defaultVisible": True,  "defaultOpacity": 1.0},
    "lymphatica":  {"name": "Systema lymphoideum",   "tr": "Lenfatik Sistem",        "color": "#16a34a", "defaultVisible": False, "defaultOpacity": 1.0},
    "respiratory": {"name": "Systema respiratorium", "tr": "Solunum Sistemi",        "color": "#d9778b", "defaultVisible": True,  "defaultOpacity": 1.0},
    "digestive":   {"name": "Systema digestorium",   "tr": "Sindirim Sistemi",       "color": "#c97a4b", "defaultVisible": True,  "defaultOpacity": 1.0},
    "urogenital":  {"name": "Systema urinarium",     "tr": "Üriner ve Endokrin",     "color": "#9d4edd", "defaultVisible": False, "defaultOpacity": 1.0},
    "skeletal":    {"name": "Systema skeletale",     "tr": "İskelet Sistemi",        "color": "#e5dac3", "defaultVisible": True,  "defaultOpacity": 0.45},
    "joints":      {"name": "Systema articulare",    "tr": "Eklemler ve Bağlar",     "color": "#93c5fd", "defaultVisible": False, "defaultOpacity": 1.0},
    "muscular":    {"name": "Systema musculare",     "tr": "Kas Sistemi",            "color": "#9f3535", "defaultVisible": False, "defaultOpacity": 1.0},
    "nervous":     {"name": "Systema nervosum",      "tr": "Sinir Sistemi",          "color": "#eab308", "defaultVisible": False, "defaultOpacity": 1.0}
}

def classify_object(obj):
    col_names = " ".join(c.name.lower() for c in obj.users_collection)
    combined = obj.name.lower() + " " + col_names
    for sys_id, keywords in SYSTEM_RULES:
        if any(kw in combined for kw in keywords):
            return sys_id
    return None

def classify_subtype(sys_id, name_str, region_str):
    if sys_id == "lymphatica": return "lymph"
    if sys_id == "venae": return "vein"
    if sys_id == "arteriae":
        t = (name_str + " " + region_str).lower()
        return "heart" if any(k in t for k in ("heart", "cor ", "atrium", "ventric", "myocard", "pericard", "valva")) else "artery"
    if sys_id == "nervous": return "nerve"
    if sys_id == "joints": return "ligament"
    if sys_id == "muscular": return "muscle"
    if sys_id == "skeletal": return "bone"
    return "viscera"

def is_flat_plane_or_box(obj):
    if obj.type != "MESH":
        return False
    verts = len(obj.data.vertices)
    polys = len(obj.data.polygons)
    if verts < 12 or polys < 6:
        return True
    dims = sorted([abs(d) for d in obj.dimensions])
    # Flat 2D rectangle/plane sheet (thickness ~0 while wide)
    if dims[0] < 0.0005 and dims[1] > 0.04 and dims[2] > 0.04:
        return True
    return False

def is_helper_object(obj, col_names_lower):
    if obj.display_type in ("WIRE", "BOUNDS"):
        return True
    lower_n = obj.name.lower()
    if any(kw in col_names_lower for kw in HELPER_COL_KEYWORDS):
        return True
    if any(kw in lower_n for kw in HELPER_NAME_KEYWORDS):
        return True
    if "region" in lower_n or "triangle" in lower_n:
        return True
    if is_flat_plane_or_box(obj):
        return True
    if obj.type == "CURVE":
        d = obj.data
        has_volume = (getattr(d, "bevel_depth", 0) > 0) or (getattr(d, "extrude", 0) > 0) or (getattr(d, "bevel_object", None) is not None)
        if not has_volume:
            return True
    return False

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
skipped_helpers = 0

for obj in bpy.context.view_layer.objects:
    col_list = [c.name for c in obj.users_collection if c.name != "Scene Collection"]
    col_names_lower = " ".join(c.lower() for c in col_list)
    region_str = " > ".join(col_list) if col_list else "Corpus"
    lower_n = obj.name.lower()

    # 1. Capture 3D anatomical landmarks (Labels / Text / Empties)
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
        if len(base) >= 3 and not any(k in base.lower() for k in ("camera", "light", "lamp", "line", "arrow", "plane", "slice", "cutter", "box")):
            sys_id = classify_object(obj) or "skeletal"
            loc = obj.matrix_world.translation
            pos = [round(float(loc.x), 4), round(float(loc.z), 4), round(float(-loc.y), 4)]
            dedup = (disp.lower(), round(pos[0], 2), round(pos[1], 2), round(pos[2], 2))
            if dedup not in seen_landmarks:
                seen_landmarks.add(dedup)
                key = re.sub(r"[^a-z0-9]", "", base.lower())
                ta2_info = ta2_lookup.get(key, {})
                landmarks.append({
                    "latin": ta2_info.get("latin", disp),
                    "name": disp,
                    "ta2": ta2_info.get("ta2Code", ""),
                    "system": sys_id,
                    "region": region_str,
                    "pos": pos
                })
        continue

    if obj.type not in ("MESH", "CURVE", "SURFACE"):
        continue

    # 2. Strictly reject planes, cutter boxes, regions, MRI slices, profile curves
    if is_helper_object(obj, col_names_lower):
        skipped_helpers += 1
        continue

    sys_id = classify_object(obj)
    if not sys_id:
        skipped_helpers += 1
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
    valid_count = 0
    for o in objs:
        if o.name not in bpy.context.view_layer.objects or o.type != "MESH":
            continue
        if is_flat_plane_or_box(o):
            skipped_helpers += 1
            continue
        o.hide_set(False)
        o.hide_viewport = False
        o.select_set(True)
        valid_count += 1

    if valid_count == 0:
        continue

    out_file = os.path.join(out_dir, f"{sys_id}.glb")
    print(f"[Z-Anatomy Export] {sys_id}: {valid_count} clean meshes -> {out_file}")
    bpy.ops.export_scene.gltf(
        filepath=out_file,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_extras=True,
        export_yup=True,
        export_normals=True,
        export_materials="EXPORT",
        export_draco_mesh_compression_enable=False
    )
    size_mb = round(os.path.getsize(out_file) / (1024 * 1024), 2)
    meta = dict(SYSTEM_META[sys_id])
    meta["id"] = sys_id
    meta["file"] = f"models/{sys_id}.glb"
    meta["meshCount"] = valid_count
    meta["sizeMB"] = size_mb
    exported_systems.append(meta)

with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as mf:
    json.dump({
        "source": "Z-Anatomy / BodyParts3D (DBCLS)",
        "license": "CC BY-SA 4.0",
        "totalStructures": len(manifest_structures),
        "totalLandmarks": len(landmarks),
        "skippedHelpers": skipped_helpers,
        "systems": exported_systems,
        "structures": manifest_structures
    }, mf, ensure_ascii=False)

with open(os.path.join(out_dir, "landmarks.json"), "w", encoding="utf-8") as lf:
    json.dump(landmarks, lf, ensure_ascii=False)

print(f"[Z-Anatomy Export] Done. CleanMeshes={len(manifest_structures)}, Landmarks={len(landmarks)}, SkippedHelpers={skipped_helpers}")
