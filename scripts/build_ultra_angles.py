import os
import cv2
import numpy as np
from PIL import Image

OUTPUT_DIR = "frontend/public/mascot"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def tight_transparent_extract(img_bgr, bg_color='white', target_size=512):
    """Cleanly isolates mascot foreground, removes background with soft edge feathering, and crops tightly."""
    h, w = img_bgr.shape[:2]
    
    if bg_color == 'white':
        # Pure white background: detect non-white pixels
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        # Background is white/light (> 248)
        fg_mask = (gray < 246).astype(np.uint8) * 255
    else:
        # Dark navy background (#0B1020, #0F172A): detect bright pixels
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        fg_mask = (gray > 42).astype(np.uint8) * 255
        
    # Refine with morphological close & open to eliminate noise
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel)
    
    # Soft alpha feathering for anti-aliased edge
    alpha = cv2.GaussianBlur(fg_mask, (3, 3), 0)
    
    b, g, r = cv2.split(img_bgr)
    rgba = cv2.merge([b, g, r, alpha])
    
    # Find tight bounding box of visible pixels
    coords = cv2.findNonZero(fg_mask)
    if coords is not None:
        bx, by, bw, bh = cv2.boundingRect(coords)
        # Add tiny 4px margin
        m = 4
        y1 = max(0, by - m)
        y2 = min(h, by + bh + m)
        x1 = max(0, bx - m)
        x2 = min(w, bx + bw + m)
        cropped = rgba[y1:y2, x1:x2]
    else:
        cropped = rgba
        
    # Scale tightly to target_size x target_size (character fills ~92% of height)
    ch, cw = cropped.shape[:2]
    scale = (target_size * 0.92) / max(ch, cw)
    nw = int(cw * scale)
    nh = int(ch * scale)
    resized = cv2.resize(cropped, (nw, nh), interpolation=cv2.INTER_LANCZOS4)
    
    canvas = np.zeros((target_size, target_size, 4), dtype=np.uint8)
    ox = (target_size - nw) // 2
    oy = (target_size - nh) // 2
    canvas[oy:oy+nh, ox:ox+nw] = resized
    return canvas

# 1. Load canonical model sheet (1024x1024)
model_cv = cv2.imread("/home/acquaint/.gemini/antigravity-ide/brain/157c22f9-e421-48af-84d7-b3f9b259cf11/mascot_model_sheet_1791902668436.jpg")
idle_cv = cv2.imread("/home/acquaint/.gemini/antigravity-ide/brain/157c22f9-e421-48af-84d7-b3f9b259cf11/mascot_idle_1791902798570.jpg")
listening_cv = cv2.imread("/home/acquaint/.gemini/antigravity-ide/brain/157c22f9-e421-48af-84d7-b3f9b259cf11/mascot_listening_1791902822600.jpg")
light_cv = cv2.imread("references/character-design-sheet-light.png")
dark_cv = cv2.imread("references/character-design-sheet-dark.png")

# Extract tight angles from 1024x1024 model sheet
angle_crops = {
    "angle-front.png": (model_cv[70:470, 40:310], 'white'),
    "angle-front-three-quarter.png": (model_cv[70:470, 370:660], 'white'),
    "angle-side.png": (model_cv[70:470, 710:980], 'white'),
    "angle-rear-three-quarter.png": (model_cv[520:920, 40:310], 'white'),
    "angle-left.png": (model_cv[520:920, 370:660], 'white'),
    "angle-back.png": (model_cv[520:920, 690:980], 'white'),
}

for fname, (crop_img, bg) in angle_crops.items():
    processed = tight_transparent_extract(crop_img, bg_color=bg)
    cv2.imwrite(f"{OUTPUT_DIR}/{fname}", processed)
    # Also save as turnaround-*.png
    turn_name = fname.replace("angle-", "turnaround-")
    cv2.imwrite(f"{OUTPUT_DIR}/{turn_name}", processed)
    print(f"[+] Saved {fname} and {turn_name}")

# Tight idle and listening (hero size)
idle_tight = tight_transparent_extract(idle_cv, bg_color='white')
cv2.imwrite(f"{OUTPUT_DIR}/mascot-idle.png", idle_tight)
cv2.imwrite(f"{OUTPUT_DIR}/idle.png", idle_tight)
cv2.imwrite(f"{OUTPUT_DIR}/hero-front.png", idle_tight)

listening_tight = tight_transparent_extract(listening_cv, bg_color='white')
cv2.imwrite(f"{OUTPUT_DIR}/mascot-listening.png", listening_tight)
cv2.imwrite(f"{OUTPUT_DIR}/listening.png", listening_tight)

# Hero front from light sheet (x: 650..845, y: 25..270)
hero_light = light_cv[25:270, 650:845]
hero_processed = tight_transparent_extract(hero_light, bg_color='white')
cv2.imwrite(f"{OUTPUT_DIR}/mascot-hero.png", hero_processed)

print("\nAll tight angle assets and hero images extracted successfully!")
