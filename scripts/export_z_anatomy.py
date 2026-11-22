import csv
import json
import os
import re
import sys
import bpy
from mathutils import Vector

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

# 1. Robust TA2.csv Latin parser
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

HELPER_COL_KEYWORDS = (
    "cross-section", "cross section", "mri", "slice", "cutter",
    "boolean", "helper", "reference", "gizmo", "interface", "background",
    "labels", "annotations", "planes", "camera", "light"
)
HELPER_NAME_KEYWORDS = (
    "plane", "slice", "section", "cutter", "boolean", "box", "cube", "grid",
    "mri", "gizmo", "panel", "frame", "background", "backdrop", "quad", "rect",
    "arrow", "pointer", "marker", "camera", "light", "lamp", "empty"
)

CORONARY_KEYWORDS = (
    "coronar", "interventricular", "circumflex", "cardiac vein", "cardiac_vein",
    "vena cardiaca", "venae cardiacae", "sinus coronarius", "coronary sinus",
    "diagonal branch", "marginal branch", "sinoatrial nodal", "atrioventricular nodal",
    "conus arteriosus", "oblique vein of left atrium", "posterior vein of left ventricle",
    "great cardiac", "middle cardiac", "small cardiac", "anterior cardiac"
)

PROTECTED_ANAT_KEYWORDS = CORONARY_KEYWORDS + (
    "artery", "arteria", "vein", "vena", "nerve", "nervus", "heart", "cor_",
    "atrium", "ventric", "valva", "valve", "aorta", "pulmonary", "bronch", "trachea"
)

SYSTEM_RULES = [
    ("cor_detail",  [
        "heart", "cor ", "cor_", "atrium", "ventric", "pericard", "myocard", "endocard",
        "valva", "valve", "tricuspid", "mitral", "bicuspid", "semilunar", "papillar",
        "chordae", "trabecul", "auricul", "coronar", "interventricular", "circumflex",
        "cardiac vein", "great cardiac", "middle cardiac", "small cardiac", "anterior cardiac",
        "sinus coronarius", "fossa ovalis", "crista terminalis", "pectinate",
        "aortic root", "ascending aorta", "pulmonary trunk", "truncus pulmonalis",
        "diagonal branch", "marginal branch", "sinoatrial", "atrioventricular",
        "conus arteriosus", "oblique vein of left atrium", "posterior vein of left ventricle"
    ]),
    ("lymphatica",  ["lymph", "nodi ", "nodus ", "ductus thoracicus", "cisterna chyli", "spleen", "splen", "thymus", "tonsil"]),
    ("venae",       ["vein", "vena ", "venae", "venous", "venosus", "jugular", "saphen", "cava", "azygos", "portal", "sinus sagittalis", "sinus transversus"]),
    ("arteriae",    ["artery", "arteria", "arteriae", "aorta", "carotid", "subclavian", "femoral artery", "iliac artery", "brachial", "radial artery", "ulnar artery", "mesenteric", "celiac", "coeliac", "renal artery", "cardiovascular"]),
    ("respiratory", ["respirat", "lung", "pulmo", "trachea", "bronch", "larynx", "laryng", "pleura", "pharynx", "nasal cavity", "alvei", "epiglott", "cricoid", "thyroid cartilage", "arytenoid"]),
    ("digestive",   ["digest", "esophag", "oesophag", "stomach", "gaster", "gastric", "liver", "hepar", "hepat", "gallbladder", "vesica biliar", "bile", "biliar", "pancreas", "duoden", "jejun", "ileum", "colon", "cecum", "caecum", "appendix", "rectum", "intestin", "periton", "omentum", "mesenter", "salivary", "parotid", "tongue", "lingua", "tooth", "teeth", "dent"]),
    ("urogenital",  ["urinar", "kidney", "ren ", "renal", "ureter", "bladder", "vesica urin", "urethra", "adrenal", "suprarenal", "prostate", "testis", "uterus", "ovary", "genital", "reproduct", "endocrin", "thyroid gland"]),
    ("nervous",     ["nervous", "nerve", "nerves", "nervus", "brain", "encephal", "cerebr", "cerebell", "spinal", "plexus", "sense", "eye", "ear", "gangli", "medulla oblongata", "pons", "thalamus"]),
    ("skeletal",    ["skeletal", "bone", "bones", "skeleton", "skull", "cranium", "vertebra", "rib", "costa", "sternum", "femur", "tibia", "fibula", "humerus", "radius", "ulna", "pelvis", "scapula", "clavic", "mandib", "maxilla", "ossa", "frontal", "parietal", "temporal", "occipital", "sphenoid", "ethmoid"]),
    ("joints",      ["joint", "joints", "articular", "ligament", "cartilage", "bursa", "meniscus", "synovial", "discus", "capsule"]),
    ("muscular",    ["muscular", "muscle", "muscles", "tendon", "aponeurosis", "fascia", "muscul", "diaphragm"])
]

SYSTEM_META = {
    "cor_detail":  {"name": "Cor et Vasa Coronaria", "tr": "Parçalanabilir Kalp & Koronerler", "group": "zanatomy", "color": "#b91c1c", "defaultVisible": True,  "defaultOpacity": 1.0},
    "arteriae":    {"name": "Arteriae",              "tr": "Arteriyel Ağaç",                  "group": "zanatomy", "color": "#d92626", "defaultVisible": True,  "defaultOpacity": 1.0},
    "venae":       {"name": "Venae",                 "tr": "Venöz Sistem",                    "group": "zanatomy", "color": "#1d4ed8", "defaultVisible": True,  "defaultOpacity": 1.0},
    "lymphatica":  {"name": "Systema lymphoideum",   "tr": "Lenfatik Sistem",                 "group": "zanatomy", "color": "#16a34a", "defaultVisible": False, "defaultOpacity": 1.0},
    "respiratory": {"name": "Systema respiratorium", "tr": "Solunum Sistemi",                 "group": "zanatomy", "color": "#d9778b", "defaultVisible": True,  "defaultOpacity": 1.0},
    "digestive":   {"name": "Systema digestorium",   "tr": "Sindirim Sistemi",                "group": "zanatomy", "color": "#c97a4b", "defaultVisible": True,  "defaultOpacity": 1.0},
    "urogenital":  {"name": "Systema urinarium",     "tr": "Üriner ve Endokrin",              "group": "zanatomy", "color": "#9d4edd", "defaultVisible": False, "defaultOpacity": 1.0},
    "skeletal":    {"name": "Systema skeletale",     "tr": "İskelet Sistemi",                 "group": "zanatomy", "color": "#e5dac3", "defaultVisible": False, "defaultOpacity": 1.0},
    "joints":      {"name": "Systema articulare",    "tr": "Eklemler ve Bağlar",              "group": "zanatomy", "color": "#93c5fd", "defaultVisible": False, "defaultOpacity": 1.0},
    "muscular":    {"name": "Systema musculare",     "tr": "Kas Sistemi",                     "group": "zanatomy", "color": "#9f3535", "defaultVisible": False, "defaultOpacity": 1.0},
    "nervous":     {"name": "Systema nervosum",      "tr": "Sinir Sistemi",                   "group": "zanatomy", "color": "#eab308", "defaultVisible": False, "defaultOpacity": 1.0}
}

def is_coronary_name(text):
    t = (text or "").lower()
    return any(kw in t for kw in CORONARY_KEYWORDS)

def is_protected_anat(obj):
    ln = obj.name.lower()
    if any(k in ln for k in ("-profile", "_profile", "bevel_profile", "bevel-profile")):
        return False
    return any(kw in ln for kw in PROTECTED_ANAT_KEYWORDS)

def classify_object(obj):
    col_names = " ".join(c.name.lower() for c in obj.users_collection)
    name_low = obj.name.lower()
    # First check object's OWN name so coronary arteries inside a generic "Arteries" collection still go to cor_detail
    for sys_id, keywords in SYSTEM_RULES:
        if any(kw in name_low for kw in keywords):
            return sys_id
    combined = name_low + " " + col_names
    for sys_id, keywords in SYSTEM_RULES:
        if any(kw in combined for kw in keywords):
            return sys_id
    return "digestive"

def classify_subtype(sys_id, name_str, region_str):
    t = (name_str + " " + region_str).lower()
    if sys_id == "cor_detail":
        if any(k in t for k in ("vein", "vena", "sinus coronarius", "cardiac vein", "great cardiac", "middle cardiac", "small cardiac")):
            return "vein"
        if any(k in t for k in ("arter", "coronar", "interventricular", "circumflex", "marginal", "diagonal", "sinoatrial", "atrioventricular", "aort", "conus")):
            return "artery"
        return "heart"
    if sys_id == "lymphatica": return "lymph"
    if sys_id == "venae": return "vein"
    if sys_id == "arteriae": return "artery"
    if sys_id == "nervous": return "nerve"
    if sys_id == "joints": return "ligament"
    if sys_id == "muscular": return "muscle"
    if sys_id == "skeletal": return "bone"
    return "viscera"

def is_flat_plane_or_box(obj):
    if obj.type != "MESH":
        return False
    # Never drop protected fine vessels / coronary branches!
    if is_protected_anat(obj):
        return len(obj.data.vertices) < 3 or len(obj.data.polygons) < 1
    if len(obj.data.vertices) < 12 or len(obj.data.polygons) < 6:
        return True
    dims = sorted([abs(d) for d in obj.dimensions])
    if dims[0] < 0.0005 and dims[1] > 0.04 and dims[2] > 0.04:
        return True
    return False

def is_helper_object(obj, col_names_lower):
    if obj.display_type in ("WIRE", "BOUNDS"):
        return True
    lower_n = obj.name.lower()
    if any(k in lower_n for k in ("-profile", "_profile", "bevel_profile", "bevel-profile")):
        return True
    if any(kw in col_names_lower for kw in HELPER_COL_KEYWORDS):
        return True
    if not is_protected_anat(obj) and any(kw in lower_n for kw in HELPER_NAME_KEYWORDS):
        return True
    if is_flat_plane_or_box(obj):
        return True
    if obj.type == "CURVE":
        d = obj.data
        has_volume = (
            (getattr(d, "bevel_depth", 0) > 0)
            or (getattr(d, "extrude", 0) > 0)
            or (getattr(d, "bevel_object", None) is not None)
            or (len(obj.modifiers) > 0)
        )
        if not has_volume:
            if is_protected_anat(obj):
                # Give thin anatomical vessel/coronary curves a real 1.2mm 3D radius so they export visibly
                try:
                    d.bevel_depth = 0.0012
                    d.bevel_resolution = 2
                    return False
                except Exception:
                    return True
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
    name = re.sub(r"_\d+$", "", name)
    name = name.replace("_", " ").strip()
    return (name + side).strip(), name.strip()

def canonical_key(sys_id, latin):
    base = re.sub(r"(_\d+|\.\d{3})$", "", (latin or "")).strip().lower()
    return f"{sys_id}::{base}"

by_system = {k: [] for k in SYSTEM_META.keys()}
manifest_structures = []
coronary_names = []
raw_labels = []
skipped_helpers = 0

for obj in bpy.context.view_layer.objects:
    col_list = [c.name for c in obj.users_collection if c.name != "Scene Collection"]
    col_names_lower = " ".join(c.lower() for c in col_list)
    region_str = col_list[0] if col_list else "Corpus"
    lower_n = obj.name.lower()

    if obj.type in ("FONT", "EMPTY") or "label" in lower_n or lower_n.startswith("text"):
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
            raw_labels.append((obj, disp, base, classify_object(obj)))
        continue

    if obj.type not in ("MESH", "CURVE", "SURFACE"):
        continue
    if is_helper_object(obj, col_names_lower):
        skipped_helpers += 1
        continue

    sys_id = classify_object(obj)
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
    if is_coronary_name(obj.name) or is_coronary_name(latin_name):
        coronary_names.append(f"{latin_name} [{obj.type}]")
    manifest_structures.append({
        "meshName": obj.name,
        "latin": latin_name,
        "name": disp,
        "ta2": obj["anat_ta2"],
        "system": sys_id,
        "subtype": subtype,
        "region": region_str
    })

# 2. Snap osteology & organ labels directly onto nearest real mesh surface
surface_pins = {}
mesh_centers = {}
for sys_id in ("skeletal", "cor_detail", "respiratory", "digestive"):
    centers = []
    for o in by_system[sys_id]:
        if o.type == "MESH" and len(o.data.vertices) >= 12:
            c = o.matrix_world @ (sum((Vector(b) for b in o.bound_box), Vector()) / 8.0)
            centers.append((o, c))
    mesh_centers[sys_id] = centers

snapped_count = 0
for lbl_obj, disp, base, sys_id in raw_labels:
    if sys_id not in mesh_centers or not mesh_centers[sys_id]:
        continue
    wloc = lbl_obj.matrix_world.translation
    cands = sorted(mesh_centers[sys_id], key=lambda item: (item[1] - wloc).length)[:3]
    best_dist = 1e9
    best_pt = None
    best_owner = None
    for m_obj, _ in cands:
        try:
            inv = m_obj.matrix_world.inverted()
            ok, loc_pt, _, _ = m_obj.closest_point_on_mesh(inv @ wloc)
            if ok:
                world_pt = m_obj.matrix_world @ loc_pt
                d = (world_pt - wloc).length
                if d < best_dist:
                    best_dist = d
                    best_pt = world_pt
                    best_owner = m_obj
        except Exception:
            pass
    if best_owner and best_pt and best_dist < 0.25:
        ekey = canonical_key(sys_id, best_owner.get("anat_latin", best_owner.name))
        k = re.sub(r"[^a-z0-9]", "", base.lower())
        ta2_info = ta2_lookup.get(k, {})
        lat = ta2_info.get("latin", disp)
        arr = surface_pins.setdefault(ekey, [])
        if not any(x["latin"].lower() == lat.lower() for x in arr) and len(arr) < 18:
            arr.append({
                "latin": lat,
                "pos": [round(float(best_pt.x), 4), round(float(best_pt.z), 4), round(float(-best_pt.y), 4)]
            })
            snapped_count += 1

exported_systems = []
exported_coronaries = 0
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
        if sys_id == "cor_detail" and (is_coronary_name(o.name) or is_coronary_name(o.get("anat_latin", ""))):
            exported_coronaries += 1

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
        "source": "Z-Anatomy / BodyParts3D + NIH HuBMAP HRA + Dundee CAHID + Brainproject",
        "license": "CC BY-SA 4.0 / CC BY 4.0",
        "totalStructures": len(manifest_structures),
        "coronaryCount": exported_coronaries,
        "coronarySamples": sorted(set(coronary_names))[:25],
        "snappedPins": snapped_count,
        "skippedHelpers": skipped_helpers,
        "systems": exported_systems,
        "structures": manifest_structures
    }, mf, ensure_ascii=False)

with open(os.path.join(out_dir, "surface_pins.json"), "w", encoding="utf-8") as pf:
    json.dump(surface_pins, pf, ensure_ascii=False)

print(f"[Z-Anatomy Export] Done. CleanMeshes={len(manifest_structures)}, ExportedCoronaries={exported_coronaries}, SnappedPins={snapped_count}, SkippedHelpers={skipped_helpers}")
if coronary_names:
    print("[Z-Anatomy Coronaries]", sorted(set(coronary_names))[:15])
