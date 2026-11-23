<p align="center"><img src="icon-128.png" alt="SCE" width="96"></p>

# Contributing to SCE

Thanks for wanting to help. SCE is listed in FUSAM and loads for a lot of players every day, so every change has to be safe first and pretty second. This page explains what to send, how to make it, and how to test it before you open a pull request.

Everything in SCE is free for everyone, the moment they install it. Nothing is sold, unlocked or owned, and contributions must keep it that way: every item's `Value` is `0`.

## What you can send

- **Clothes**: new pieces, or fixes to existing ones (a gap, a wrong colour, a missing pose).
- **Activities**: new entries for the activity menu, in `activities.js`.
- **Bug fixes**: in `sce.js` or `activities.js`.
- **Ideas and bug reports**: open an issue. Add a screenshot from the game if it's something you can see.

Not sure if something fits? Open an issue first and ask. It saves you work.

## Rules that never bend

1. **Names are permanent.** Item names (`SlimeKimono`), layer names, activity names (`SCE_...`) and the extra slots' group names (`Cloth_SCE`, ...) are saved in players' outfits and sent in chat. Never rename or remove one after it has been released. Only add.
2. **Never break the game.** Every game hook in `sce.js` and `activities.js` goes through `hookGame()`. A feature that meets a game it doesn't expect switches itself off with `problem()`, and the game carries on untouched. New code follows the same pattern: no bare `bcModSdk` hooks, no overwriting game functions.
3. **Live alongside the other add-ons.** SCE is tested with Echo (clothing and activities), WCE, BCX, MBS and AEE, in both load orders. Don't rely on loading first or last, and don't change other add-ons' groups, items or hooks.
4. **No layer above priority 30.** The game's jackets and coats (Outer Clothes, 30) and necklaces (31) must be able to go over SCE clothes.
5. **Everything free.** `Value: 0` on every piece, no buy groups.

## Making clothes

### How a piece is stored

All clothes live in `clothes/clothes.json`, under `pieces`. Each piece is a normal game asset definition plus a few SCE fields:

| Field | What it is |
|---|---|
| `name` | The item name, starting with `Slime`. Permanent. |
| `group` | The game group: `Cloth`, `ClothLower`, `ClothOuter`, `ItemHandheld`, ... |
| `description` | The name players see. |
| `def` | The game's asset definition (`Name`, `Priority`, `DefaultColor`, `Layer`, ...), with `Value: 0`. |
| `extended` | Options (typed or modular archetype), or `null`. |
| `texts` | The option texts, keyed like the game's own (`ClothSlimeKimonoSelectBase`, ...). |
| `layerNames` | The colour names players see for each colourable layer. |
| `fits` | Poses that use the standing pictures as they are (for example `TapedHands`, or leg poses for a top). |
| `poses` | Poses that have their own pictures. Every pose not in `fits` or `poses` hides the piece, so it never shows the wrong picture. |

Every picture file also goes in the `images` list.

### Pictures

- **Canvas:** 500 × 1000, the game's character size. Layers use `Left: 0, Top: 0`, so every picture lines up with the body as drawn. Empty space at the right and bottom may be cropped off.
- **File names:** `clothes/img/<Group>/<Name>_<Size>_<Layer>.png` standing, and `clothes/img/<Group>/<Pose>/<Name>_<Size>_<Layer>.png` for a pose.
- **Sizes:** a layer whose `ParentGroup` is `BodyUpper` needs all six chests: `FlatSmall`, `FlatMedium`, `Small`, `Normal`, `Large`, `XLarge`. The flat ones are real drawings, not shrunk ones: men wear SCE too. `BodyLower` layers need the four hips: `Small`, `Normal`, `Large`, `XLarge`.
- **Colour:** pictures are greyscale shading. The game tints them with the layer's colour, so each part that has its own colour is its own layer. Keep the plain fabric around mid-grey, so colours come out as players pick them.
- **Edges follow drawn lines.** Every layer's edge sits on a line in the drawing. Don't cut parts with straight rows or masks, and don't patch-fill. After you split a piece into layers, recolour every layer in the game to check nothing leaks.
- **Wardrobe tile:** `clothes/preview/<Name>.png`.

### Layering

Many players move and scale their clothes in the game's Layering screen, so pieces must hold up there:

- **Standing tops** are drawn *under* the hands (priority 27), with no hand-shaped holes. Fill the area behind the hands with fabric, so moving the top never shows skin.
- **Cuffs:** the game's picture of the clasped hands carries a wide oval of wrist. Each standing layer gets a twin at 30, named `<Part>Cuff`, that covers the wrists up to the backs of the hands. Copy the wrist area of your standing pictures, or ask in your pull request and we'll make them.
- **Posed tops** (arms tied, up, out, lying) are at 29–30 and may cut around the hands. They hide in the standing pose, and the standing layers hide in theirs (`PoseMapping`).
- **Lower clothes** sit at 26, under the tops.
- **Outer pieces** (`ClothOuter`) must cover a top at 30. Give them a hole-free backing copy at 27.

### Before you send a piece

- [ ] It shows in the wardrobe with every chest and hip size.
- [ ] It works in every pose in `poses`, and hides in the rest. Check standing, arms tied behind (box tie, cuffs, elbows), arms up, yoked, kneeling, all fours and hogtied.
- [ ] Each colour changes only its own part.
- [ ] No skin or underwear shows along the edges, at the shoulders, under the arms or around the hands. Look at every chest size, lying poses especially.
- [ ] No doubled chest: no second bulge or crease across the body on any size.
- [ ] Moved and scaled in the Layering screen, it shows no holes.
- [ ] A game jacket and a necklace still go over it.
- [ ] No errors in the browser console.

## Testing your change in the game

1. Fork this repository and turn on GitHub Pages for your fork (Settings > Pages, branch `main`, root).
2. Open the game, but don't load the normal SCE: switch off its userscript, or don't click the bookmark.
3. On the login screen, open the browser console (F12) and load your fork:
   ```js
   const s = document.createElement('script');
   s.src = 'https://YOUR-NAME.github.io/sce/sce.js?' + Date.now();
   document.head.appendChild(s);
   ```
   SCE loads its clothes from next to `sce.js`, so your fork's clothes are used.
4. Log in and go through the checklist above. Then do it once more with Echo, WCE, BCX, MBS and AEE switched on in FUSAM.

## AI-assisted work

SCE wants to reward artists, so hand-made art comes first. AI-assisted work isn't banned, but it has to be labelled:

- Mark it clearly in your pull request: say which parts were made or helped by AI.
- Don't present AI-made work as an artist's own work.
- The maintainer may decline AI-assisted work, even when it's labelled.

## Pull requests

- One piece or one fix per pull request, on its own branch.
- Say what it adds or fixes. Include **screenshots from the game**: every chest size standing, and the poses it supports. Use colours that show each part clearly.
- Don't change `VERSION` in `sce.js` or `news.json`. The maintainer does that at release.
- The maintainer tests every pull request locally, in the game, with the other add-ons, before it goes live. Expect questions or small changes. SCE is in FUSAM, so nothing goes live on trust.

Contributors are credited in the update notes.

## Going into the game itself

Any item that is vanilla-friendly, meaning it fits Bondage Club's own style and rules, is bound to be merged into Bondage Club itself eventually, unless you ask otherwise. Say so in your pull request if you want your item to stay in SCE only. Otherwise, by contributing one, you agree that it may be submitted to the game, with your credit kept. Items that only make sense with SCE stay in SCE.

## Items from films, games and shows

Fan-made items based on someone else's work are allowed, but they are the most likely to be taken down. SCE's Lightsaber, from Star Wars, is an example.

Every item in SCE, these included, is made by fans and offered free of charge for players to enjoy. No item is sold, and none is meant to misuse or misrepresent anyone's work. If a rights holder (Disney, for example) wants an item removed, they are free to contact the maintainer, Proudkiller0015 on GitHub, or to open an issue on this repository, and it will be taken down.
