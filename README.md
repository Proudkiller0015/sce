# Untitled Wardrobe (working name)

A future Bondage Club clothing add-on, in the spirit of Echo's clothing pack. **It has no clothes yet, no name and no
home**: nothing is published, nothing is installed anywhere.

## What it does

- `addon.js` registers the clothes in `clothes/clothes.json` with the game, in their clothing groups, with their
  pictures, previews and option texts. Pictures are drawn standing; in poses their group draws differently they show
  only where a piece's `Fits` says they still sit right.
- It keeps your clothes on when someone without the add-on changes your outfit (their game doesn't know them).
  Players with the add-on are recognised by a key in their shared settings.
- Outfits: a row at the end of the wardrobe puts on a whole outfit, or any item of it on its own, in its colours.
  It never touches a locked item or a blocked slot.
- Every game hook is guarded: a feature that meets a game it doesn't expect switches itself off for the session, and
  the game carries on untouched.

What it does not have (Void-only parts left out): the Order's server, the power armour carry limit, any weapons.

## Adding clothes

1. Put the drawings in `art/out/`: `pieces.json`, `<Group>/<Asset>_<Layer>.png`, `preview-<Asset>.png`
   (the format is at the top of `tools/build-clothes.js`).
2. `node tools/build-clothes.js` writes `clothes/`.
3. Load `addon.js` on a test copy of the game and check every piece, standing and posed, with Echo, WCE, BCX and MBS
   loaded alongside.

## Before it goes public

- Choose the name: change `ADDON_ID` / `ADDON_NAME` in `addon.js`, the `UntitledWardrobe*` globals, the loader's
  header, and pick an asset-name prefix (see `NAME` in the build tool).
- Give it a home (e.g. GitHub Pages) and set `BASE` in `loader.user.js`.
