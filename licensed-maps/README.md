# Maps you have permission to use

Maps in this folder ship in the hosted game, so only add a map if its author has said yes or its licence allows it.

## Adding a map

1. Copy the map's `.bsp` file into this folder.
2. Save the proof in `proofs/`: a screenshot of the author's message, or a copy of the licence.
3. Add an entry to `manifest.json`:

```json
[
  {
    "file": "surf_example.bsp",
    "name": "Example",
    "author": "Their name",
    "permission": "Author said yes on Discord, 2026-11-03",
    "proof": "proofs/surf_example.png",
    "source": "https://link-to-the-map",
    "difficulty": "medium"
  }
]
```

`file`, `name`, `author`, `permission` and `proof` are required. `source` and `difficulty` are optional.

The build stops with an error if a map here has no complete entry, or an entry has no map or proof, so nothing goes out uncredited. The author and permission text are shown in the game's credits.

## What to ask an author

Ask for permission to include the map in a free browser game that anyone can download it from, and how they'd like to be credited.

## Things to check first

- **Textures:** only textures packed inside the `.bsp` come along. CS:GO's stock textures don't, so those surfaces fall back to the game's plain stone. The map still plays the same but may look different, so try it before adding it.
- **Other people's content:** a permission only covers what that author made. If the map packs models or textures from other games or artists, ask about those too.
- **File size:** GitHub refuses files over 100 MB, and every player has to download the map, so smaller is better.
