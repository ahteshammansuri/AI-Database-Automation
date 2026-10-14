import cv2
import numpy as np
from PIL import Image

dark_img = Image.open('references/character-design-sheet-dark.png')
light_img = Image.open('references/character-design-sheet-light.png')
model_sheet = Image.open('/home/acquaint/.gemini/antigravity-ide/brain/157c22f9-e421-48af-84d7-b3f9b259cf11/mascot_model_sheet_1791902668436.jpg')

# Model sheet slices (1024x1024):
# Row 1:
# Front: (45, 90, 310, 460)
# Front 3/4: (385, 90, 650, 460)
# Right profile: (720, 90, 970, 460)
# Row 2:
# Rear 3/4: (45, 540, 310, 900)
# Left profile: (385, 540, 650, 900)
# Back view: (690, 540, 960, 900)

slices_model = {
    'turnaround-front.png': (40, 90, 320, 460),
    'turnaround-front-three-quarter.png': (380, 90, 655, 460),
    'turnaround-side.png': (715, 90, 975, 460),
    'turnaround-rear-three-quarter.png': (40, 540, 320, 900),
    'turnaround-left.png': (380, 540, 655, 900),
    'turnaround-back.png': (690, 540, 960, 900),
}

for name, box in slices_model.items():
    cropped = model_sheet.crop(box)
    cropped.save(f'frontend/public/mascot/raw_{name}')

print("Model sheet slices extracted.")
