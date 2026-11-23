<p align="center"><img src="icon-128.png" alt="SCE" width="128"></p>

# SCE - Slime Clothing Extension

Made by **SlimeQueenSamantha**.

More clothes for [Bondage Club](https://www.bondageprojects.elementfx.com/), with many options and every part in its own colour. The kimonos come first.

## Install

**Easiest: [the install page](https://proudkiller0015.github.io/sce/install.html)** has every way. Pick one.

- **🐒 Userscript:** with [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/), click **[Install SCE](https://raw.githubusercontent.com/Proudkiller0015/sce/main/sce.user.js)** and confirm. It starts with the game every time.
- **🔖 Bookmark, no extension needed:** drag the SCE button from the install page onto your bookmarks bar, then click it on the login screen.

Both run the same SCE and always load its newest version, so there's nothing to update by hand. Other players see your SCE clothes when they have SCE too; if someone without it changes your outfit, your SCE clothes stay on.

## Use

- **👘 Kimono** (Clothes): pick it in your wardrobe; SCE's clothes carry the slime kimono badge on their tile. Click it again for its options:
  - **Style:** Furisode or Short (more styles coming).
  - **Sleeves:** Long sleeves, Detached sleeves (bare shoulders) or Sleeveless.
  - **Pattern:** Plain, Sakura, Seigaiha waves, Asanoha, Akatsuki clouds or Dragon.
  - **Collar** and **Obi:** on or off.
  - **Colours:** the kimono, sleeves, lining, pattern, pattern outline, collar, sleeve band, obi and obi cord each have their own.
  - Fits every chest and hip size, in every pose.
- **⛩ Miko Top** (Clothes, or Outer Clothes) and **Hakama** (Lower Clothes): a shrine maiden outfit. The top's colour and its cords, the hakama and its bow each have their own colour. Fits every chest and hip size, in every pose.
- **⛩ Gohei** (Held items): a shrine maiden's wand, paper and stick each their own colour. Hold it for its own activities.
- **🎒 School uniforms:** **Sailor Top**, **School Blazer** and **School Cardigan** (Clothes) and a **Pleated Skirt** (Lower Clothes) that goes with all three. Every part its own colour; every chest and hip size, every pose.
- **⚔ Lightsaber** (Held items): blade, hilt and grip each their own colour. Hold it for Force powers and blade activities.
- **👕 Extra slots:** a second Upper Clothing, Outerwear, Lower Clothing, Clothing Accessory, Suit (Upper and Lower), Bra, Panties, Socks, Shoes, Gloves, Hat, Necklace and Body Markings, at the end of the wardrobe with the SCE logo by their names (after Echo's and other add-ons' slots). They hold the game's items and SCE's, drawn just above the same group. Players without SCE don't see what you wear in them. Switch them off in SCE's settings.
- **🎭 Activities:** 51 new actions in the activity menu (faces, sweet ones, lewd ones), each with the SCE badge; players without SCE still read them in chat. Switch them off in SCE's settings.
- **♻ Restore:** if the game loads your outfit before SCE (a slow connection, or the bookmark clicked late), it drops SCE clothes it doesn't know yet. SCE keeps a copy of what you wear (SCE clothes and the extra slots) with your account and puts it back into empty slots once it's loaded, never over anything else. Crafts of SCE items the same way: the game drops them and would erase them, SCE keeps a copy and puts them back (or asks first, if you switch that off).
- **⚙ Settings > Extensions > Slime Clothing Extension:** the activities on/off, the extra slots on/off, putting back crafts by itself or asking, the update-ready notice, the update notes, **Put my SCE clothes and crafts back**, and the **Clothing list** and **Activity list** (everything SCE adds).
- **🔔 Updates:** a notice tells you when a newer SCE is ready (reload the game to get it), and what's new shows once after an update.

## For developers

Want to add clothes, activities or fixes? See **[CONTRIBUTING.md](CONTRIBUTING.md)**.


- `sce.js` registers the clothes in `clothes/clothes.json` with the game (pictures, texts, option names, colour layer names), keeps them on when someone without SCE changes your outfit, and adds the wardrobe badge, the settings page and the update notices. Every game hook is guarded: a feature that meets a game it doesn't expect switches itself off for the session and the game carries on untouched.
- `activities.js` adds the activities; `sce.js` loads it and lends it its guarded hooks.
- `sce.user.js` is the loader: it adds the newest `sce.js` from GitHub Pages (jsDelivr as a backup) on every game load.
- Item names are saved in players' outfits: never rename one after release. The same goes for the extra slots' group names (`Cloth_SCE`, `BodyMarkings2_SCE`, ...): only ever add slots.
- Pictures are fetched with `sce.js`'s VERSION: raise it whenever pictures change. `news.json` holds each version's note.
