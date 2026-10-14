import os
import glob
import cv2
import numpy as np
from PIL import Image

PUBLIC_DIR = "frontend/public/mascot"
DIST_DIR = "frontend/dist/mascot"
os.makedirs(PUBLIC_DIR, exist_ok=True)
if os.path.exists("frontend/dist"):
    os.makedirs(DIST_DIR, exist_ok=True)

# 1. Clean out all ugly crops and dark junk files
junk_patterns = [
    f"{PUBLIC_DIR}/dark_*",
    f"{PUBLIC_DIR}/raw_*",
    f"{PUBLIC_DIR}/sec5_*",
    f"{PUBLIC_DIR}/test_hd_*",
    f"{PUBLIC_DIR}/dark-theme.png",
    f"{PUBLIC_DIR}/mascot-dark-theme.png",
    f"{PUBLIC_DIR}/light-theme.png",
    f"{PUBLIC_DIR}/mascot-light-theme.png",
    f"{PUBLIC_DIR}/action_floating.png",
    f"{PUBLIC_DIR}/light_angles_strip.png",
    f"{PUBLIC_DIR}/light_turnaround_strip.png",
    f"{PUBLIC_DIR}/angle-front-alt.png",
]

for pat in junk_patterns:
    for fpath in glob.glob(pat):
        try:
            os.remove(fpath)
            print(f"Removed junk file: {fpath}")
        except Exception as e:
            print(f"Failed to remove {fpath}: {e}")

# Paths to master AI assets
IDLE_MASTER = "/home/acquaint/.gemini/antigravity-ide/brain/8885ba85-6aca-4e60-9f19-4b52cddb6879/test_clean_idle.png"
LISTENING_MASTER = "/home/acquaint/.gemini/antigravity-ide/brain/8885ba85-6aca-4e60-9f19-4b52cddb6879/test_clean_listening.png"
THINKING_MASTER = "/home/acquaint/.gemini/antigravity-ide/brain/8885ba85-6aca-4e60-9f19-4b52cddb6879/test_clean_thinking.png"
MODEL_SHEET_MASTER = "/home/acquaint/.gemini/antigravity-ide/brain/157c22f9-e421-48af-84d7-b3f9b259cf11/mascot_model_sheet_1791902668436.jpg"
LIGHT_SHEET = "frontend/public/mascot/references/character-design-sheet-light.png"

def save_dual(base_name, rgba_img):
    """Saves to public and dist directories under both mascot-{name}.png and {name}.png."""
    targets = [
        f"{PUBLIC_DIR}/mascot-{base_name}.png",
        f"{PUBLIC_DIR}/{base_name}.png",
    ]
    if os.path.exists(DIST_DIR):
        targets.extend([
            f"{DIST_DIR}/mascot-{base_name}.png",
            f"{DIST_DIR}/{base_name}.png",
        ])
    for t in targets:
        cv2.imwrite(t, rgba_img)
    print(f"[+] Saved asset: {base_name}")

def extract_from_sheet(sheet_bgr, box, pad_size=512):
    x1, y1, x2, y2 = box
    crop = sheet_bgr[y1:y2, x1:x2].copy()
    h, w = crop.shape[:2]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    mask = np.zeros((h + 2, w + 2), np.uint8)

    # Flood fill uniform white background from all four outer borders
    for x in range(w):
        for y in [0, h - 1]:
            if gray[y, x] > 230 and mask[y + 1, x + 1] == 0:
                cv2.floodFill(crop, mask, (x, y), (255, 255, 255), loDiff=(10, 10, 10), upDiff=(10, 10, 10), flags=cv2.FLOODFILL_MASK_ONLY | (255 << 8))

    for y in range(h):
        for x in [0, w - 1]:
            if gray[y, x] > 230 and mask[y + 1, x + 1] == 0:
                cv2.floodFill(crop, mask, (x, y), (255, 255, 255), loDiff=(10, 10, 10), upDiff=(10, 10, 10), flags=cv2.FLOODFILL_MASK_ONLY | (255 << 8))

    bg_mask = mask[1:h + 1, 1:w + 1]
    fg_mask = 255 - bg_mask

    # Disconnect artifacts/stray text remnants (< 45px area or touching the very top edge)
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(fg_mask)
    clean_fg = np.zeros_like(fg_mask)
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        top_y = stats[i, cv2.CC_STAT_TOP]
        # Ignore tiny stray dots and any stray text remnant at the extreme top margin
        if area > 45 and (top_y > 4 or area > 300):
            clean_fg[labels == i] = 255

    alpha = cv2.GaussianBlur(clean_fg, (3, 3), 0)
    b, g, r = cv2.split(crop)
    rgba = cv2.merge([b, g, r, alpha])

    coords = cv2.findNonZero(clean_fg)
    if coords is not None:
        bx, by, bw, bh = cv2.boundingRect(coords)
        cropped = rgba[by:by + bh, bx:bx + bw]
    else:
        cropped = rgba

    ch, cw = cropped.shape[:2]
    # Scale to fill 88% of pad_size for balanced framing
    scale = (pad_size * 0.88) / max(ch, cw)
    nw, nh = int(cw * scale), int(ch * scale)
    resized = cv2.resize(cropped, (nw, nh), interpolation=cv2.INTER_LANCZOS4)

    # Gentle unsharp mask for HD clarity without noise
    rgb = resized[:, :, :3]
    a = resized[:, :, 3]
    blur = cv2.GaussianBlur(rgb, (0, 0), 2.0)
    sharpened = cv2.addWeighted(rgb, 1.3, blur, -0.3, 0)
    sharpened_rgba = cv2.merge([sharpened[:, :, 0], sharpened[:, :, 1], sharpened[:, :, 2], a])

    canvas = np.zeros((pad_size, pad_size, 4), dtype=np.uint8)
    sx = (pad_size - nw) // 2
    sy = (pad_size - nh) // 2
    canvas[sy:sy + nh, sx:sx + nw] = sharpened_rgba
    return canvas

def extract_turnaround(sheet_bgr, box, pad_size=512):
    x1, y1, x2, y2 = box
    crop = sheet_bgr[y1:y2, x1:x2].copy()
    h, w = crop.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    bgdModel = np.zeros((1, 65), np.float64)
    fgdModel = np.zeros((1, 65), np.float64)

    rect = (4, 4, w - 8, h - 8)
    cv2.grabCut(crop, mask, rect, bgdModel, fgdModel, 5, cv2.GC_INIT_WITH_RECT)
    fg_mask = np.where((mask == 2) | (mask == 0), 0, 255).astype('uint8')

    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(fg_mask)
    largest_label = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    clean_fg = (labels == largest_label).astype(np.uint8) * 255

    alpha = cv2.GaussianBlur(clean_fg, (5, 5), 0)
    b, g, r = cv2.split(crop)
    rgba = cv2.merge([b, g, r, alpha])

    coords = cv2.findNonZero(clean_fg)
    bx, by, bw, bh = cv2.boundingRect(coords)
    cropped = rgba[by:by + bh, bx:bx + bw]

    ch, cw = cropped.shape[:2]
    scale = (pad_size * 0.88) / max(ch, cw)
    nw, nh = int(cw * scale), int(ch * scale)
    resized = cv2.resize(cropped, (nw, nh), interpolation=cv2.INTER_LANCZOS4)

    canvas = np.zeros((pad_size, pad_size, 4), dtype=np.uint8)
    sx = (pad_size - nw) // 2
    sy = (pad_size - nh) // 2
    canvas[sy:sy + nh, sx:sx + nw] = resized
    return canvas

# 1. Master Idle (1024x1024 render, pure background removed)
idle_img = cv2.imread(IDLE_MASTER, cv2.IMREAD_UNCHANGED)
save_dual("idle", idle_img)
save_dual("hero", idle_img)
cv2.imwrite(f"{PUBLIC_DIR}/hero-front.png", idle_img)
cv2.imwrite(f"{PUBLIC_DIR}/hero_front.png", idle_img)
cv2.imwrite(f"{PUBLIC_DIR}/angle-front.png", idle_img)
cv2.imwrite(f"{PUBLIC_DIR}/turnaround-front.png", idle_img)
if os.path.exists(DIST_DIR):
    cv2.imwrite(f"{DIST_DIR}/hero-front.png", idle_img)
    cv2.imwrite(f"{DIST_DIR}/hero_front.png", idle_img)
    cv2.imwrite(f"{DIST_DIR}/angle-front.png", idle_img)
    cv2.imwrite(f"{DIST_DIR}/turnaround-front.png", idle_img)

# 2. Master Listening (1024x1024 render)
listening_img = cv2.imread(LISTENING_MASTER, cv2.IMREAD_UNCHANGED)
save_dual("listening", listening_img)

# 3. Master Thinking (1024x1024 render)
thinking_img = cv2.imread(THINKING_MASTER, cv2.IMREAD_UNCHANGED)
save_dual("thinking", thinking_img)

# 4. Turnarounds from 3D Master Model Sheet
model_sheet_cv = cv2.imread(MODEL_SHEET_MASTER)
turnaround_boxes = {
    "angle-front-three-quarter": (350, 95, 670, 480),
    "angle-side": (690, 95, 1000, 480),
    "angle-rear-three-quarter": (20, 520, 330, 920),
    "angle-left": (350, 520, 670, 920),
    "angle-back": (680, 520, 1000, 920),
}

for name, box in turnaround_boxes.items():
    t_img = extract_turnaround(model_sheet_cv, box)
    t_name = name.replace("angle-", "turnaround-")
    cv2.imwrite(f"{PUBLIC_DIR}/{name}.png", t_img)
    cv2.imwrite(f"{PUBLIC_DIR}/{t_name}.png", t_img)
    if os.path.exists(DIST_DIR):
        cv2.imwrite(f"{DIST_DIR}/{name}.png", t_img)
        cv2.imwrite(f"{DIST_DIR}/{t_name}.png", t_img)
    print(f"[+] Saved turnaround: {name} & {t_name}")

# 5. Clean Action States from Light Sheet (Exact boundaries with zero text & full feet glow)
light_sheet_cv = cv2.imread(LIGHT_SHEET)
action_boxes = {
    # Row 4: Actions & Navigation states (y1=650, y2=755)
    "flying": (30, 650, 165, 755),
    "navigating": (170, 650, 308, 755),
    "pointing": (170, 650, 308, 755),
    "clicking": (310, 650, 438, 755),
    "typing": (450, 650, 575, 755),
    "processing": (595, 650, 705, 755),
    "loading": (595, 650, 705, 755),
    "complete": (725, 650, 840, 755),
    "completed": (725, 650, 840, 755),

    # Row 3: Expressions & Statuses (y1=475, y2=592)
    "working": (365, 475, 480, 592),
    "validating": (365, 475, 480, 592),
    "success": (480, 475, 595, 592),
    "error": (600, 475, 715, 592),
    "warning": (600, 475, 715, 592),
    "oops": (600, 475, 715, 592),
    "celebrate": (720, 475, 835, 592),
    "celebration": (720, 475, 835, 592),
    "excited": (720, 475, 835, 592),

    # Row 5: Sequential Flow (y1=808, y2=902)
    "speaking": (255, 808, 330, 902),
    "understanding": (330, 808, 410, 902),
    "planning": (420, 808, 515, 902),
    "executing": (610, 808, 705, 902),
}

for aname, abox in action_boxes.items():
    act_img = extract_from_sheet(light_sheet_cv, abox)
    save_dual(aname, act_img)

# Fallbacks / aliases
cv2.imwrite(f"{PUBLIC_DIR}/action-floating.png", cv2.imread(f"{PUBLIC_DIR}/mascot-flying.png", cv2.IMREAD_UNCHANGED))
cv2.imwrite(f"{PUBLIC_DIR}/mascot-interrupted.png", cv2.imread(f"{PUBLIC_DIR}/mascot-warning.png", cv2.IMREAD_UNCHANGED))
cv2.imwrite(f"{PUBLIC_DIR}/interrupted.png", cv2.imread(f"{PUBLIC_DIR}/mascot-warning.png", cv2.IMREAD_UNCHANGED))
cv2.imwrite(f"{PUBLIC_DIR}/mascot-paused.png", cv2.imread(f"{PUBLIC_DIR}/mascot-idle.png", cv2.IMREAD_UNCHANGED))
cv2.imwrite(f"{PUBLIC_DIR}/paused.png", cv2.imread(f"{PUBLIC_DIR}/mascot-idle.png", cv2.IMREAD_UNCHANGED))
cv2.imwrite(f"{PUBLIC_DIR}/mascot-offline.png", cv2.imread(f"{PUBLIC_DIR}/mascot-idle.png", cv2.IMREAD_UNCHANGED))
cv2.imwrite(f"{PUBLIC_DIR}/offline.png", cv2.imread(f"{PUBLIC_DIR}/mascot-idle.png", cv2.IMREAD_UNCHANGED))

if os.path.exists(DIST_DIR):
    for f in ["action-floating.png", "mascot-interrupted.png", "interrupted.png", "mascot-paused.png", "paused.png", "mascot-offline.png", "offline.png"]:
        src_p = f"{PUBLIC_DIR}/{f}"
        if os.path.exists(src_p):
            cv2.imwrite(f"{DIST_DIR}/{f}", cv2.imread(src_p, cv2.IMREAD_UNCHANGED))

# Compact badge icon (64x64)
compact_64 = cv2.resize(idle_img, (64, 64), interpolation=cv2.INTER_AREA)
cv2.imwrite(f"{PUBLIC_DIR}/mascot-compact.png", compact_64)
cv2.imwrite(f"{PUBLIC_DIR}/compact.png", compact_64)
if os.path.exists(DIST_DIR):
    cv2.imwrite(f"{DIST_DIR}/mascot-compact.png", compact_64)
    cv2.imwrite(f"{DIST_DIR}/compact.png", compact_64)

# Keep model sheet master for reference
cv2.imwrite(f"{PUBLIC_DIR}/model-sheet.png", model_sheet_cv)
cv2.imwrite(f"{PUBLIC_DIR}/mascot-model-sheet.png", model_sheet_cv)
if os.path.exists(DIST_DIR):
    cv2.imwrite(f"{DIST_DIR}/model-sheet.png", model_sheet_cv)
    cv2.imwrite(f"{DIST_DIR}/mascot-model-sheet.png", model_sheet_cv)

print("\n[SUCCESS] All clean mascot production assets generated successfully!")
