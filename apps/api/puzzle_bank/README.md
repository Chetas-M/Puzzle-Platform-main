# Puzzle Bank

Put all puzzle definitions in this folder.

## Primary file
- `puzzles.json`: source of truth for seeded puzzle catalog.

## Required puzzle fields
- `slug`
- `title`
- `type`
- `answerKey`
- `prompt`
- `builtinUtils`
- `externalLinks`
- `isInspectPuzzle`
- `isolatedUrl`
- `hints` (array of `tier`, `content`, `penaltySeconds`)

The API seed script reads this file and creates puzzles for the active event.
