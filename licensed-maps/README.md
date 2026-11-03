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
    "difficulty": "medium",
    "finish": [1024, -512, 64]
  }
]
```

`file` and `name` are required. `author`, `permission`, `proof`, `source`, `difficulty` and `finish` are optional, but fill in the credit and proof before a map goes public.

## Leaderboards

Every map here gets its own leaderboard, as long as its finish is the same for everyone. Most maps have a finish built in, and then there's nothing to do.

If a map doesn't, the game tells you when you load it. Stand at the finish, open the console, type `setgoal`, and copy the `"finish"` line it prints into the map's entry. Until then, times on that map stay on each player's PC, because a personal `setgoal` could be placed anywhere.

Replacing a map file keeps its old times, so a changed course can leave records nobody can beat. To reset a board, delete that map's rows in the database.

The build stops with an error if a map here has no entry, or an entry names a map or proof that isn't here. It does not stop a map with no credit or proof. The author and permission text, when given, are shown in the game's credits.

## What to ask an author

Ask for permission to include the map in a free browser game that anyone can download it from, and how they'd like to be credited.

## Things to check first

- **Textures:** only textures packed inside the `.bsp` come along. CS:GO's stock textures don't, so those surfaces fall back to the game's plain stone. The map still plays the same but may look different, so try it before adding it.
- **Other people's content:** a permission only covers what that author made. If the map packs models or textures from other games or artists, ask about those too.
- **File size:** GitHub refuses files over 100 MB, and every player has to download the map, so smaller is better.
