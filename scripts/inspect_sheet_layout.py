from PIL import Image

light = Image.open('references/character-design-sheet-light.png')
dark = Image.open('references/character-design-sheet-dark.png')

# In light sheet:
# Top right: Hero Front (x: 650..840, y: 35..250)
# Turnarounds (Section "TURNAROUND VIEWS", y: 280..420):
#   Front (x: 390..530), Left (x: 520..640), Back (x: 650..770), Right (x: 770..850)
# Expressions & Emotions (y: 450..580):
#   Happy/Idle, Listening, Thinking, Working, Success, Oops/Error, Excited
# Action & Navigation States (y: 610..740):
#   Floating/Moving, Pointing/Indicating, Clicking/Interacting, Typing, Loading, Task Complete
# Behavior Examples (y: 770..890):
#   User Speaks, Understanding, Planning, Navigating, Executing, Completed
# Scale Variations (y: 900..990):
#   Small (Idle), Medium (Active), Large (Celebration)

print("Sheet inspection template ready.")
