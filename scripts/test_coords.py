import cv2
import numpy as np
from PIL import Image

# Load light sheet
light = Image.open('references/character-design-sheet-light.png')
w, h = light.size
print(f"Light dimensions: {w}x{h}")

# Load dark sheet
dark = Image.open('references/character-design-sheet-dark.png')
dw, dh = dark.size
print(f"Dark dimensions: {dw}x{dh}")

# Hero shot in light sheet is in top right
# Box roughly x: 600..850, y: 30..250
hero = light.crop((580, 25, 845, 275))
hero.save('frontend/public/mascot/test_hero.png')
print("Saved test_hero.png")
