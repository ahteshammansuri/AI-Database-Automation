import cv2
import numpy as np

def extract_transparent_foreground(img_bgr, tolerance=22):
    h, w = img_bgr.shape[:2]
    # Create mask for floodFill (must be 2 pixels larger than image)
    mask = np.zeros((h + 2, w + 2), dtype=np.uint8)
    
    # Target color: sample average of the 4 outer corners
    corners = [img_bgr[0, 0], img_bgr[0, w-1], img_bgr[h-1, 0], img_bgr[h-1, w-1]]
    bg_sample = np.mean(corners, axis=0).astype(np.uint8)
    
    # Copy for floodfill
    img_work = img_bgr.copy()
    diff = (tolerance, tolerance, tolerance)
    
    # FloodFill from all four corners
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        cv2.floodFill(img_work, mask, seed, (255, 255, 255), diff, diff, cv2.FLOODFILL_MASK_ONLY | (4 << 8) | 255)
    
    # Also seed along borders
    for x in range(0, w, 20):
        for y in [0, h - 1]:
            if mask[y + 1, x + 1] == 0:
                # check if close to corner sample
                if np.linalg.norm(img_bgr[y, x] - bg_sample) < tolerance * 1.5:
                    cv2.floodFill(img_work, mask, (x, y), (255, 255, 255), diff, diff, cv2.FLOODFILL_MASK_ONLY | (4 << 8) | 255)
    for y in range(0, h, 20):
        for x in [0, w - 1]:
            if mask[y + 1, x + 1] == 0:
                if np.linalg.norm(img_bgr[y, x] - bg_sample) < tolerance * 1.5:
                    cv2.floodFill(img_work, mask, (x, y), (255, 255, 255), diff, diff, cv2.FLOODFILL_MASK_ONLY | (4 << 8) | 255)

    # In mask, 255 is the connected background
    bg_mask = mask[1:h+1, 1:w+1]
    
    # Soft alpha feathering
    fg_mask = cv2.bitwise_not(bg_mask)
    # Smooth edges
    alpha = cv2.GaussianBlur(fg_mask, (3, 3), 0)
    
    # Create RGBA image
    b, g, r = cv2.split(img_bgr)
    rgba = cv2.merge([b, g, r, alpha])
    return rgba

img = cv2.imread('/home/acquaint/.gemini/antigravity-ide/brain/157c22f9-e421-48af-84d7-b3f9b259cf11/mascot_idle_1791902798570.jpg')
transparent = extract_transparent_foreground(img, tolerance=18)
cv2.imwrite('frontend/public/mascot/test_idle_transparent.png', transparent)
print('Saved test_idle_transparent.png with shape:', transparent.shape)
