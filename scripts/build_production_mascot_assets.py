import os
import json
import cv2
import numpy as np
from PIL import Image

OUTPUT_DIR = "frontend/public/mascot"
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(f"{OUTPUT_DIR}/references", exist_ok=True)

# 1. Load canonical sources
dark_path = "references/character-design-sheet-dark.png"
light_path = "references/character-design-sheet-light.png"
model_sheet_path = "/home/acquaint/.gemini/antigravity-ide/brain/157c22f9-e421-48af-84d7-b3f9b259cf11/mascot_model_sheet_1791902668436.jpg"
idle_path = "/home/acquaint/.gemini/antigravity-ide/brain/157c22f9-e421-48af-84d7-b3f9b259cf11/mascot_idle_1791902798570.jpg"
listening_path = "/home/acquaint/.gemini/antigravity-ide/brain/157c22f9-e421-48af-84d7-b3f9b259cf11/mascot_listening_1791902822600.jpg"

dark_cv = cv2.imread(dark_path)
light_cv = cv2.imread(light_path)
model_cv = cv2.imread(model_sheet_path)
idle_cv = cv2.imread(idle_path)
listening_cv = cv2.imread(listening_path)

def process_rgba(img_bgr, bg_is_dark=False, pad_size=512):
    """Cleanly isolates mascot foreground, removes background, centers in square canvas with transparent alpha."""
    h, w = img_bgr.shape[:2]
    
    mask = np.zeros((h, w), np.uint8)
    bgdModel = np.zeros((1, 65), np.float64)
    fgdModel = np.zeros((1, 65), np.float64)
    
    margin_x = max(2, int(w * 0.05))
    margin_y = max(2, int(h * 0.05))
    rect = (margin_x, margin_y, w - 2 * margin_x, h - 2 * margin_y)
    
    try:
        cv2.grabCut(img_bgr, mask, rect, bgdModel, fgdModel, 3, cv2.GC_INIT_WITH_RECT)
        fg_mask = np.where((mask == 2) | (mask == 0), 0, 255).astype('uint8')
    except Exception:
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        if bg_is_dark:
            fg_mask = (gray > 45).astype(np.uint8) * 255
        else:
            fg_mask = (gray < 245).astype(np.uint8) * 255
            
    # Soft alpha anti-aliasing
    alpha = cv2.GaussianBlur(fg_mask, (3, 3), 0)
    
    b, g, r = cv2.split(img_bgr)
    rgba = cv2.merge([b, g, r, alpha])
    
    coords = cv2.findNonZero(fg_mask)
    if coords is not None:
        bx, by, bw, bh = cv2.boundingRect(coords)
        cropped = rgba[by:by+bh, bx:bx+bw]
    else:
        cropped = rgba
        
    ch, cw = cropped.shape[:2]
    scale = (pad_size * 0.82) / max(ch, cw)
    nw = int(cw * scale)
    nh = int(ch * scale)
    resized = cv2.resize(cropped, (nw, nh), interpolation=cv2.INTER_AREA)
    
    final_canvas = np.zeros((pad_size, pad_size, 4), dtype=np.uint8)
    start_x = (pad_size - nw) // 2
    start_y = (pad_size - nh) // 2
    final_canvas[start_y:start_y+nh, start_x:start_x+nw] = resized
    return final_canvas

def save_dual(name, rgba_img):
    """Saves both mascot-{name}.png and {name}.png for compatibility."""
    p1 = f"{OUTPUT_DIR}/mascot-{name}.png"
    p2 = f"{OUTPUT_DIR}/{name}.png"
    cv2.imwrite(p1, rgba_img)
    cv2.imwrite(p2, rgba_img)
    print(f"[+] Saved {p1} and {p2}")

# 1. Model sheet
cv2.imwrite(f"{OUTPUT_DIR}/mascot-model-sheet.png", model_cv)
cv2.imwrite(f"{OUTPUT_DIR}/model-sheet.png", model_cv)

# 2. Idle & Listening from high-res 1024x1024 renders
idle_rgba = process_rgba(idle_cv, bg_is_dark=False)
save_dual("idle", idle_rgba)

listening_rgba = process_rgba(listening_cv, bg_is_dark=False)
save_dual("listening", listening_rgba)

# 3. Turnarounds from 1024x1024 model sheet
turnarounds = {
    "turnaround-front": (40, 70, 310, 470),
    "turnaround-front-three-quarter": (370, 70, 660, 470),
    "turnaround-side": (710, 70, 980, 470),
    "turnaround-rear-three-quarter": (40, 520, 310, 920),
    "turnaround-left": (370, 520, 660, 920),
    "turnaround-back": (690, 520, 980, 920),
}
for tname, (x1, y1, x2, y2) in turnarounds.items():
    crop = model_cv[y1:y2, x1:x2]
    rgba = process_rgba(crop, bg_is_dark=False)
    cv2.imwrite(f"{OUTPUT_DIR}/{tname}.png", rgba)
    print(f"[+] Saved {tname}.png")

# 4. Action & behavior states from dark reference sheet (1024x682)
# y1=470, y2=565 for row 1; y1=575, y2=675 for row 2
dark_states = {
    "thinking": (185, 470, 265, 565),
    "flying": (270, 470, 355, 565),
    "navigating": (360, 470, 445, 565),
    "speaking": (450, 470, 545, 565),
    "planning": (15, 575, 95, 675),
    "working": (100, 575, 180, 675),
    "success": (185, 575, 265, 675),
    "error": (275, 575, 355, 675),
    "validating": (365, 575, 445, 675),
    "celebrate": (455, 575, 545, 675),
    "dark-theme": (790, 650, 870, 780),
    "light-theme": (885, 650, 975, 780),
}

for sname, (x1, y1, x2, y2) in dark_states.items():
    crop = dark_cv[y1:y2, x1:x2]
    rgba = process_rgba(crop, bg_is_dark=True)
    save_dual(sname, rgba)

# 5. Additional states from light sheet (856x1024)
# Oops/Error, Warning, Interrupted, Paused, Offline
light_states = {
    "warning": (610, 465, 720, 570), # Oops / concerned
    "paused": (390, 290, 520, 420), # Front calm resting pose
    "interrupted": (715, 465, 830, 570), # Alert turning back
    "offline": (770, 290, 850, 420), # Right dormant resting
}

for lsname, (x1, y1, x2, y2) in light_states.items():
    crop = light_cv[y1:y2, x1:x2]
    rgba = process_rgba(crop, bg_is_dark=False)
    save_dual(lsname, rgba)

# 6. Compact version (optimized 64x64 and 128x128 for UI badges)
compact_64 = cv2.resize(idle_rgba, (64, 64), interpolation=cv2.INTER_AREA)
cv2.imwrite(f"{OUTPUT_DIR}/mascot-compact.png", compact_64)
cv2.imwrite(f"{OUTPUT_DIR}/compact.png", compact_64)

# 7. Generate manifest.json
manifest = {
    "character": {
        "name": "Orbit",
        "description": "Original full-body AI companion mascot for database automation platform",
        "color_palette": {
            "shell_primary": "#FFFFFF",
            "shell_secondary": "#F2F6FF",
            "screen_face": "#0B1020",
            "led_eyes": "#00D4FF",
            "cape": "#6366F1",
            "chest_emblem_glow": "#8B5CF6",
            "hover_thrust": "#06B6D4"
        },
        "canvas_size": 512,
        "format": "image/png",
        "has_alpha": True
    },
    "states": {
        "idle": { "file": "mascot-idle.png", "description": "Calm, friendly hover levitation, soft blinking" },
        "listening": { "file": "mascot-listening.png", "description": "Attentive head tilt, hand near ear, antenna pulsing" },
        "thinking": { "file": "mascot-thinking.png", "description": "Analytical gaze upward, hand near chin, resolving intent" },
        "speaking": { "file": "mascot-speaking.png", "description": "Animated mouth, expressive hands communicating response" },
        "planning": { "file": "mascot-planning.png", "description": "Studying data tiles, constructing typed execution plan" },
        "flying": { "file": "mascot-flying.png", "description": "Levitating with motion trail toward target UI destination" },
        "navigating": { "file": "mascot-navigating.png", "description": "Pointing or reaching toward relevant portal module" },
        "working": { "file": "mascot-working.png", "description": "Interacting with schema or data records safely" },
        "validating": { "file": "mascot-validating.png", "description": "Inspecting schema constraints and verification checks" },
        "success": { "file": "mascot-success.png", "description": "Joyful celebration, smiling eyes, task verified" },
        "warning": { "file": "mascot-warning.png", "description": "Concerned, attentive expression, awaiting user input" },
        "error": { "file": "mascot-error.png", "description": "Honest alert expression with recovery options" },
        "paused": { "file": "mascot-paused.png", "description": "Calm resting hover, execution held safely" },
        "interrupted": { "file": "mascot-interrupted.png", "description": "Immediately halts motion and turns attention to user" },
        "offline": { "file": "mascot-offline.png", "description": "Dormant resting state when voice or model unavailable" },
        "celebrate": { "file": "mascot-celebrate.png", "description": "High-energy celebration upon completed deployment" },
        "compact": { "file": "mascot-compact.png", "description": "Optimized compact resolution for small floating badges" }
    },
    "turnarounds": {
        "front": "turnaround-front.png",
        "front_three_quarter": "turnaround-front-three-quarter.png",
        "side": "turnaround-side.png",
        "rear_three_quarter": "turnaround-rear-three-quarter.png",
        "back": "turnaround-back.png"
    }
}

with open(f"{OUTPUT_DIR}/manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)

print("\n[SUCCESS] All production mascot assets and manifest.json generated successfully!")
