from PIL import Image

dark = Image.open('references/character-design-sheet-dark.png')
light = Image.open('references/character-design-sheet-light.png')

# In dark sheet (1024x682):
# Section 3. CHARACTER FROM DIFFERENT ANGLES is at top right:
# Let's crop x: 620..990, y: 30..200
dark_angles = dark.crop((630, 40, 990, 195))
dark_angles.save('frontend/public/mascot/dark_angles_strip.png')
print("Dark angles strip saved:", dark_angles.size)

# In light sheet (856x1024):
# Section TURNAROUND VIEWS:
light_turn = light.crop((390, 270, 850, 420))
light_turn.save('frontend/public/mascot/light_angles_strip.png')
print("Light angles strip saved:", light_turn.size)

# Light Hero Shot (top right):
hero = light.crop((650, 25, 850, 270))
hero.save('frontend/public/mascot/hero_front.png')
print("Hero front saved:", hero.size)
