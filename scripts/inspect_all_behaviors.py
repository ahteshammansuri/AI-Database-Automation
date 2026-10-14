import cv2
from PIL import Image

light = Image.open('references/character-design-sheet-light.png')
dark = Image.open('references/character-design-sheet-dark.png')

# In light sheet (856x1024):
# Action & Navigation States: y around 625..735
# 6 items across width 40..840 -> ~130px each:
# 1. Floating/Moving: x 40..170
# 2. Pointing/Indicating: x 175..305
# 3. Clicking/Interacting: x 310..440
# 4. Typing/Entering Data: x 445..580
# 5. Loading/Progress: x 585..715
# 6. Task Complete: x 720..845

actions = {
    'action_floating': (35, 625, 175, 735),
    'action_pointing': (180, 625, 310, 735),
    'action_clicking': (315, 625, 450, 735),
    'action_typing': (455, 625, 590, 735),
    'action_loading': (595, 625, 725, 735),
    'action_complete': (730, 625, 850, 735),
}

for name, box in actions.items():
    crop = light.crop(box)
    crop.save(f'frontend/public/mascot/raw_{name}.png')

# Expressions in light sheet: y around 460..570
# 7 items across width 20..845 -> ~118px each:
expressions = {
    'expr_idle': (20, 460, 135, 570),
    'expr_listening': (140, 460, 255, 570),
    'expr_thinking': (260, 460, 375, 570),
    'expr_working': (380, 460, 495, 570),
    'expr_success': (500, 460, 615, 570),
    'expr_error': (620, 460, 735, 570),
    'expr_excited': (740, 460, 855, 570),
}

for name, box in expressions.items():
    crop = light.crop(box)
    crop.save(f'frontend/public/mascot/raw_{name}.png')

# Sequential flow in light sheet (y: 780..885):
flow = {
    'flow_speaks': (265, 780, 360, 885),
    'flow_understanding': (365, 780, 460, 885),
    'flow_planning': (465, 780, 560, 885),
    'flow_navigating': (565, 780, 660, 885),
    'flow_executing': (665, 780, 760, 885),
    'flow_completed': (765, 780, 855, 885),
}

for name, box in flow.items():
    crop = light.crop(box)
    crop.save(f'frontend/public/mascot/raw_{name}.png')

print("All behavior crops sliced.")
