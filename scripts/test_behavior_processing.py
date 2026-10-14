import cv2
import numpy as np

def process_high_def_behavior(img_bgr, bg_mode='white', target_size=512):
    h, w = img_bgr.shape[:2]
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    
    if bg_mode == 'white':
        # Pure white/light background from light sheet
        # White background pixels have R, G, B all > 245
        fg_mask = (gray < 246).astype(np.uint8) * 255
    else:
        # Dark navy background (#0B1020)
        fg_mask = (gray > 42).astype(np.uint8) * 255
        
    # Morphological clean
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel)
    alpha = cv2.GaussianBlur(fg_mask, (3, 3), 0)
    
    b, g, r = cv2.split(img_bgr)
    rgba = cv2.merge([b, g, r, alpha])
    
    coords = cv2.findNonZero(fg_mask)
    if coords is not None:
        bx, by, bw, bh = cv2.boundingRect(coords)
        m = 3
        y1, y2 = max(0, by - m), min(h, by + bh + m)
        x1, x2 = max(0, bx - m), min(w, bx + bw + m)
        cropped = rgba[y1:y2, x1:x2]
    else:
        cropped = rgba
        
    ch, cw = cropped.shape[:2]
    # Scale to fill 92% of target_size height with Lanczos4 high definition interpolation
    scale = (target_size * 0.92) / max(ch, cw)
    nw, nh = int(cw * scale), int(ch * scale)
    resized = cv2.resize(cropped, (nw, nh), interpolation=cv2.INTER_LANCZOS4)
    
    # Sharpness enhancement for upscaled crops
    gaussian = cv2.GaussianBlur(resized, (0, 0), 2.0)
    unsharp = cv2.addWeighted(resized, 1.35, gaussian, -0.35, 0)
    # Restore original smooth alpha channel
    unsharp[:, :, 3] = resized[:, :, 3]
    
    canvas = np.zeros((target_size, target_size, 4), dtype=np.uint8)
    ox = (target_size - nw) // 2
    oy = (target_size - nh) // 2
    canvas[oy:oy+nh, ox:ox+nw] = unsharp
    return canvas

# Test on action_pointing
pt = cv2.imread('frontend/public/mascot/raw_action_pointing.png')
res = process_high_def_behavior(pt, bg_mode='white')
cv2.imwrite('frontend/public/mascot/test_hd_pointing.png', res)
print("Saved test_hd_pointing.png, shape:", res.shape)
