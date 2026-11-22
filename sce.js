// Slime Clothing Extension (SCE): a Bondage Club clothing add-on, Echo-style. It adds its own clothes to the game's
// clothing groups, with their pictures and texts, and (when clothes.json lists outfits) a row at the end of the wardrobe
// that puts on an outfit in one go. The clothes are listed in clothes/clothes.json, built by tools/build-clothes.js.
// Pictures are fetched with the add-on's VERSION: raise it whenever pictures change, or players keep cached old ones.
//
// Every game hook goes through hookGame(): a feature that meets a game it doesn't expect is switched off for the
// session and the game's own code runs untouched. It never throws into the game.
(() => {
	'use strict';
	/** @type {any} */
	const w = window;
	/** The add-on's id (its OnlineSharedSettings key and mod SDK name) and the name players see. Change both when it is named. */
	const ADDON_ID = 'SCE';
	const ADDON_NAME = 'Slime Clothing Extension';
	const VERSION = '1.0.1';
	/** Where clothes/ lives: the loader sets SCEBase; else next to this script. */
	const BASE = (
		w.SCEBase ||
		(document.currentScript && /** @type {HTMLScriptElement} */ (document.currentScript).src.replace(/[^/]*$/, '')) ||
		''
	).replace(/\/?$/, '/');
	const CLOTHES = `${BASE}clothes/`;
	/** Added to every picture's address, so a release that redraws a piece is never mixed with a browser's old copies. */
	const FRESH = `?v=${encodeURIComponent(VERSION)}`;

	if (w.SCELoaded) {
		return;
	}
	w.SCELoaded = VERSION;

	// ---- Guard: hooks that switch their feature off instead of breaking the game
	/** @type {any} */
	let mod = null;
	const gameMod = () => {
		if (!mod && w.bcModSdk && typeof w.bcModSdk.registerMod === 'function') {
			try {
				mod = w.bcModSdk.registerMod({ name: ADDON_ID, fullName: ADDON_NAME, version: VERSION });
			} catch (e) {
				// (another mod already took the name): every hook then reports the game function as missing
				console.warn(`[${ADDON_NAME}] the mod SDK refused SCE: ${String((e && e.message) || e)}`);
			}
		}
		return mod;
	};
	/** @type {Map<string, string>} Features switched off this session, with why. */
	const problems = new Map();
	function problem(/** @type {string} */ feature, /** @type {any} */ error) {
		if (problems.has(feature)) {
			return;
		}
		const message = String((error && error.message) || error || 'unknown error').slice(0, 300);
		problems.set(feature, message);
		console.warn(`[${ADDON_NAME}] ${feature} switched off: ${message}`);
	}
	const working = (/** @type {string} */ feature) => !problems.has(feature);
	/** The game function at a global name or dotted path ("ElementButton.CreateForAsset"), or undefined. */
	const gameFunction = (/** @type {string} */ name) => {
		const f = name.split('.').reduce((/** @type {any} */ o, k) => (o == null ? undefined : o[k]), w);
		return typeof f === 'function' ? f : undefined;
	};
	/**
	 * Hooks a game function for one feature. While the feature works, `body` runs with the arguments and `next` (the
	 * game's function); if `body` throws, the feature is switched off and the game's function runs as if it had never
	 * been hooked. Errors thrown by the game's own function pass through unchanged. Returns false when the function
	 * isn't there, and the feature is then off.
	 * @param {string} name
	 * @param {number} priority
	 * @param {string} feature
	 * @param {(args: any[], next: (args: any[]) => any) => any} body
	 */
	function hookGame(name, priority, feature, body) {
		const handle = gameMod();
		if (!handle || !gameFunction(name)) {
			problem(feature, `the game has no ${name}`);
			return false;
		}
		/** @type {WeakSet<object>} */
		const gameErrors = new WeakSet();
		try {
			handle.hookFunction(name, priority, (/** @type {any[]} */ args, /** @type {(a: any[]) => any} */ next) => {
				if (!working(feature)) {
					return next(args);
				}
				let called = false;
				let result;
				let changedArgs = false;
				const once = (/** @type {any[]} */ a) => {
					called = true;
					try {
						result = next(a);
					} catch (e) {
						if (e && typeof e === 'object') {
							gameErrors.add(e);
						}
						changedArgs = a !== args;
						throw e;
					}
					return result;
				};
				try {
					return body(args, once);
				} catch (e) {
					if (e && typeof e === 'object' && gameErrors.has(e)) {
						if (!changedArgs) {
							throw e;
						}
						problem(feature, e);
						return next(args);
					}
					problem(feature, e);
					return called ? result : next(args);
				}
			});
		} catch (e) {
			problem(feature, e);
			return false;
		}
		return true;
	}

	// ---- The clothes
	const FEATURE = 'Clothes';
	/** @type {Map<string, any>} The registered pieces (clothes.json entries) by asset name. */
	const pieces = new Map();
	/** @type {Set<string>} Picture files the pieces have. */
	const images = new Set();
	/** @type {Map<string, string>} The pieces' texts, by the game's text key. */
	const texts = new Map();
	/** @type {Map<string, string>} The pieces' layer names in the colour screen, by <Group><Asset><Layer>. */
	const layerNames = new Map();
	/** @type {Map<string, Record<string, string[]>>} Older colour orders of each piece, by their length. */
	const colorHistories = new Map();
	/** @type {Map<string, string>} Their colour group rows' names, by <Group><Asset><ColorGroup>. */
	const groupNames = new Map();

	/** Whether an asset is one of the add-on's. */
	const isOurs = (/** @type {any} */ asset) =>
		!!asset && !!asset.Group && pieces.has(asset.Name) && pieces.get(asset.Name).group === asset.Group.Name;

	/** Fetches the clothes and registers them, once the game has loaded its own items. */
	function start() {
		const missing = () =>
			['AssetAdd', 'AssetGroupGet', 'AssetGet'].find((f) => !gameFunction(f)) ||
			(Array.isArray(w.AssetFemale3DCG) ? '' : 'AssetFemale3DCG');
		let tries = 0;
		const wait = setInterval(() => {
			if (++tries > 1200) {
				clearInterval(wait);
				problem(FEATURE, 'the game never finished loading its items');
				return;
			}
			if (!Array.isArray(w.Asset) || !w.Asset.length) {
				return;
			}
			clearInterval(wait);
			if (missing()) {
				problem(FEATURE, `the game has no ${missing()}`);
				return;
			}
			fetch(`${CLOTHES}clothes.json${FRESH}`, { cache: 'no-cache' })
				.then((res) => {
					if (!res.ok) {
						throw new Error(`clothes.json: HTTP ${res.status}`);
					}
					return res.json();
				})
				.then((data) => {
					try {
						register(data);
					} catch (e) {
						problem(FEATURE, e);
					}
				})
				.catch((e) => problem(FEATURE, e));
		}, 50);
		markSelf();
	}

	/**
	 * The game keeps every picture it has drawn in a store in the browser (Cache API "bc-images-v1"), under the game's
	 * own path, and keeps using that copy. Pictures saved by an older SCE would stay. Once per SCE version, ours are
	 * taken out of that store, so the current ones are fetched.
	 */
	function dropStoredPictures(/** @type {string[]} */ names) {
		const KEY = 'sce.picturesFresh';
		try {
			if (localStorage.getItem(KEY) === VERSION || typeof caches === 'undefined' || !names.length) {
				return;
			}
		} catch {
			return;
		}
		const ours = new RegExp(`/(${names.map((n) => n.replace(/[^A-Za-z0-9]/g, '')).join('|')})[_.][^/]*$`);
		caches
			.open('bc-images-v1')
			.then(async (store) => {
				for (const req of await store.keys()) {
					if (ours.test(new URL(req.url).pathname)) {
						await store.delete(req);
					}
				}
				try {
					localStorage.setItem(KEY, VERSION);
				} catch {
					// blocked storage: tried again next time
				}
			})
			.catch(() => {
				// no store: nothing saved to drop
			});
	}

	/**
	 * Adds the pieces to their clothing groups, with their pictures and texts. A name the game already has is left
	 * alone. If the game refuses one, the pieces stop there and the ones added are kept.
	 * @param {any} data clothes/clothes.json
	 */
	function register(data) {
		if (!Array.isArray(data.pieces) || !Array.isArray(data.images)) {
			throw new Error('clothes.json is not as expected');
		}
		if (!data.pieces.length && !Object.keys(data.outfits || {}).length) {
			return;
		}
		for (const f of data.images) {
			images.add(f);
		}
		dropStoredPictures(data.pieces.map((/** @type {any} */ p) => p.name));
		if (!hookPictures()) {
			return;
		}
		hookGame('AssetTextGet', 0, 'Clothes texts', (args, next) =>
			typeof args[0] === 'string' && texts.has(args[0]) ? texts.get(args[0]) : next(args),
		);
		for (const piece of data.pieces) {
			try {
				addPiece(piece);
			} catch (e) {
				// (that piece is left out; the others, and the hooks they need, carry on)
				problem(`Clothes: ${piece.name}`, e);
			}
		}
		hookLayerNames();
		hookColorHistory();
		hookFullTypes();
		hookOutfits(data.outfits || {});
		hookGame('ValidationResolveRemoveDiff', 0, 'Keeping the clothes on', keepOnRemove);
		if (data.pieces.some((/** @type {any} */ p) => pieces.has(p.name) && String(p.group).startsWith('Item'))) {
			refreshCraftable();
		}
	}
	/** Adds one piece to its group, with its texts and names. Throws when the game refuses it (nothing of it stays). */
	function addPiece(/** @type {any} */ piece) {
		const group = w.AssetGroupGet('Female3DCG', piece.group);
		const groupDef = w.AssetFemale3DCG.find((/** @type {any} */ g) => g && g.Group === piece.group);
		if (!group || !groupDef || !Array.isArray(group.Asset)) {
			throw new Error(`the game has no ${piece.group} group as expected`);
		}
		if (w.AssetGet('Female3DCG', piece.group, piece.name)) {
			return;
		}
		try {
			w.AssetAdd(
				group,
				standingOnly(piece.def, group, piece.fits || [], piece.poses || []),
				piece.extended ? { [piece.group]: { [piece.name]: withoutGameMessages(piece.extended) } } : undefined,
				groupDef,
			);
		} catch (e) {
			unregister(group, piece.name);
			throw e;
		}
		const asset = w.AssetGet('Female3DCG', piece.group, piece.name);
		if (!asset) {
			throw new Error(`${piece.name} was not added`);
		}
		asset.Description = piece.description;
		pieces.set(piece.name, piece);
		for (const [k, v] of Object.entries(piece.texts || {})) {
			texts.set(k, String(v));
		}
		for (const [k, v] of Object.entries(piece.layerNames || {})) {
			layerNames.set(k, String(v));
		}
		if (piece.colorHistory && typeof piece.colorHistory === 'object') {
			colorHistories.set(piece.name, piece.colorHistory);
		}
		for (const [k, v] of Object.entries(piece.groupNames || {})) {
			groupNames.set(k, String(v));
		}
	}
	/** The game lists what can be crafted when it loads its items: our items are added after, so the list is made again. */
	function refreshCraftable() {
		const populate = gameFunction('CraftingAssetsPopulate');
		try {
			// (a script-level `let` of the game's, not a window property)
			if (populate && typeof CraftingAssets === 'object') {
				CraftingAssets = populate();
			}
		} catch (e) {
			problem('Restore crafts', e);
		}
	}
	/**
	 * The piece's definition for this game: drawn in the standing pictures, in every pose its group draws the same and
	 * in those of the others where they still fit (`fits`); hidden in the rest, whose pictures aren't made yet.
	 * @param {any} source
	 * @param {any} group the game's group (its pose mapping: how it draws in each pose)
	 * @param {string[]} fits
	 * @param {string[]} posed poses with pictures of their own (drawn from that pose's folder)
	 */
	function standingOnly(source, group, fits, posed = []) {
		const def = JSON.parse(JSON.stringify(source));
		const poses = (group && group.PoseMapping) || {};
		def.PoseMapping = Object.fromEntries(
			Object.entries(poses)
				.filter(([, v]) => v !== '')
				.map(([pose]) => [pose, posed.includes(pose) ? pose : fits.includes(pose) ? '' : 'Hide']),
		);
		return def;
	}
	/**
	 * The extended item config, sending no message of the game's own when an option changes: the game has no text for
	 * ours. (Clothes never send one; items in the other groups do.)
	 */
	function withoutGameMessages(/** @type {any} */ extended) {
		return { ...extended, ScriptHooks: { ...(extended.ScriptHooks || {}), PublishAction: () => {} } };
	}
	/** Takes a half-added piece back out of the game's lists. */
	function unregister(/** @type {any} */ group, /** @type {string} */ name) {
		const drop = (/** @type {any[]} */ list) => {
			const i = Array.isArray(list) ? list.findIndex((a) => a && a.Name === name && a.Group === group) : -1;
			if (i >= 0) {
				list.splice(i, 1);
			}
		};
		drop(group.Asset);
		drop(w.Asset);
		if (w.AssetMap instanceof Map) {
			w.AssetMap.delete(`${group.Name}/${name}`);
		}
	}

	/**
	 * The colour keys of an asset in the game's order: index -> the layer (or the layer it copies) that colour paints.
	 * @param {any} asset
	 */
	function colorKeys(asset) {
		/** @type {string[]} */
		const keys = [];
		for (const l of asset.Layer || []) {
			if (l.AllowColorize && typeof l.ColorIndex === 'number' && keys[l.ColorIndex] === undefined) {
				keys[l.ColorIndex] = l.CopyLayerColor || l.Name;
			}
		}
		return keys;
	}
	/**
	 * Colours saved in an older layer order (a different number of colours), mapped by part onto today's order; parts
	 * that didn't exist then take their default. Returns null when the colours are already in today's order.
	 * @param {any} item
	 */
	function remappedColors(item) {
		const history = item && item.Asset && colorHistories.get(item.Asset.Name);
		if (!history || !Array.isArray(item.Color)) {
			return null;
		}
		const keys = colorKeys(item.Asset);
		if (item.Color.length === keys.length) {
			return null;
		}
		const old = history[String(item.Color.length)];
		if (!Array.isArray(old)) {
			return null;
		}
		return keys.map((k) => {
			const i = old.indexOf(k);
			return i >= 0 && typeof item.Color[i] === 'string' ? item.Color[i] : 'Default';
		});
	}
	/**
	 * A saved item that predates one of its options (an outfit saved before sleeves or collars could be chosen) has no
	 * entry for it, and the game then draws none of the parts that depend on that option: the sleeves' edges and the
	 * collar vanish and the pattern shows past the outline. Before anyone is drawn, a missing option is filled in with
	 * its first choice.
	 */
	function hookFullTypes() {
		/** @type {Map<string, string[]>} item name -> its option keys */
		const keysOf = new Map();
		const optionKeys = (/** @type {any} */ asset) => {
			const name = `${asset.Group.Name}/${asset.Name}`;
			if (!keysOf.has(name)) {
				let keys = [];
				try {
					const data = w.ExtendedItemGetData(asset, 'modular');
					keys = data && Array.isArray(data.modules) ? data.modules.map((m) => m.Key).filter((k) => typeof k === 'string') : [];
				} catch {
					keys = [];
				}
				if (!keys.length) {
					return keys;
				}
				keysOf.set(name, keys);
			}
			return /** @type {string[]} */ (keysOf.get(name));
		};
		hookGame('CharacterAppearanceSortLayers', 0, 'Full options', (args, next) => {
			const C = args[0];
			// (the game draws from DrawAppearance, a copy of Appearance: both get it)
			for (const list of C ? [C.Appearance, C.DrawAppearance] : []) {
				if (!Array.isArray(list)) {
					continue;
				}
				for (const item of list) {
					if (!item || !isOurs(item.Asset)) {
						continue;
					}
					const keys = optionKeys(item.Asset);
					if (!keys.length) {
						continue;
					}
					const record = item.Property && item.Property.TypeRecord;
					if (record && keys.every((k) => typeof record[k] === 'number')) {
						continue;
					}
					const full = Object.fromEntries(keys.map((k) => [k, record && typeof record[k] === 'number' ? record[k] : 0]));
					item.Property = { ...(item.Property || {}), TypeRecord: { ...(record || {}), ...full } };
				}
			}
			return next(args);
		});
	}

	/** Draws everyone's older-order colours on the right parts; fixes your own saved outfit once. */
	function hookColorHistory() {
		// Saved outfits are parsed here, which cuts a colour list to today's length: map it by part first.
		hookGame('ServerParseColor', 0, 'Colour order', (args, next) => {
			const [asset, color] = args;
			if (isOurs(asset) && Array.isArray(color)) {
				const mapped = remappedColors({ Asset: asset, Color: color });
				if (mapped) {
					return next([asset, mapped, ...args.slice(2)]);
				}
			}
			return next(args);
		});
		hookGame('CommonDrawResolveLayerColor', 0, 'Colour order', (args, next) => {
			const item = args[1];
			if (item && isOurs(item.Asset)) {
				const mapped = remappedColors(item);
				if (mapped) {
					return next([args[0], { ...item, Color: mapped }, ...args.slice(2)]);
				}
			}
			return next(args);
		});
	}
	/** Rewrites your own SCE items' colours into today's order (once, after login); returns whether any changed. */
	function fixOwnColors() {
		const p = w.Player;
		let changed = false;
		for (const item of (p && Array.isArray(p.Appearance) ? p.Appearance : [])) {
			if (item && isOurs(item.Asset)) {
				const mapped = remappedColors(item);
				if (mapped) {
					item.Color = mapped;
					changed = true;
				}
			}
		}
		return changed;
	}

	/**
	 * Our layers' names in the colour screen. The screen reads them from a text cache of Assets/LayerNames.csv that it
	 * makes anew each time it opens; ours are added to it whenever it (re)builds.
	 */
	function hookLayerNames() {
		hookGame('ItemColorLoad', 0, 'Layer names', (args, next) => {
			const result = next(args);
			// The game's caches are script-level `let`s, not window properties.
			const layers = typeof ItemColorLayerNames === 'object' && ItemColorLayerNames ? ItemColorLayerNames : null;
			const groups = typeof ItemColorGroupNames === 'object' && ItemColorGroupNames ? ItemColorGroupNames : null;
			for (const [cache, names] of /** @type {[any, Map<string, string>][]} */ ([[layers, layerNames], [groups, groupNames]])) {
				if (cache && typeof cache.onRebuild === 'function') {
					cache.onRebuild(() => {
						if (cache.cache && typeof cache.cache === 'object') {
							for (const [k, v] of names) {
								cache.cache[k] = v;
							}
						}
					}, true);
				}
			}
			return result;
		});
	}

	/** The add-on's address for one of the game's picture paths, or '' when it isn't one of ours. */
	function picture(/** @type {string} */ url) {
		if (/^(?:\.\/)?Icons\/Previews\/SCE\.png$/.test(url)) {
			return ICON;
		}
		// Assets/Female3DCG/<Group>/[<Pose>/]<Asset>[_<option types>]_<Layer>.png, or <Group>/Preview/<Asset>.png
		const m = /^(?:\.\/)?Assets\/Female3DCG\/([A-Za-z0-9]+)\/(?:([A-Za-z0-9]+)\/)?([A-Za-z0-9]+?)((?:_[A-Za-z0-9]+)*)\.png$/.exec(url);
		const piece = m && pieces.get(m[3]);
		if (!m || !piece || piece.group !== m[1]) {
			return '';
		}
		if (m[2] === 'Preview') {
			return m[4] ? '' : `${CLOTHES}preview/${piece.name}.png${FRESH}`;
		}
		const file = `img/${piece.group}/${m[2] ? `${m[2]}/` : ''}${piece.name}${m[4]}.png`;
		return images.has(file) ? `${CLOTHES}${file}${FRESH}` : '';
	}
	/** Sends the game's requests for our pictures to the add-on's copies, and gives our buttons their pictures. */
	function hookPictures() {
		// (priority 10: before other add-ons' own picture redirects, which don't know our files)
		const ok = hookGame('CommonFetch', 10, FEATURE, (args, next) => {
			// The game's picture store checks its saved copies for updates with a Request: that check is sent to our
			// files too. Without the game's "changed since" headers: GitHub Pages refuses them from another site, and the
			// version in our addresses already tells copies apart.
			if (typeof Request === 'function' && args[0] instanceof Request) {
				// (its address is a full one: match from the Assets folder on)
				const moved = picture(new URL(args[0].url).pathname.replace(/^.*?\/(?=Assets\/)/, ''));
				return next(moved ? [new Request(moved), ...args.slice(1)] : args);
			}
			const url = typeof args[0] === 'string' ? picture(args[0]) : '';
			return next(url ? [url, ...args.slice(1)] : args);
		});
		if (ok && gameFunction('ElementButton.CreateForAsset')) {
			hookGame('ElementButton.CreateForAsset', 0, 'Clothes buttons', (args, next) => {
				const asset = args[1] && ('Asset' in args[1] ? args[1].Asset : args[1]);
				if (!isOurs(asset)) {
					return next(args);
				}
				const options = { ...(args[4] || {}) };
				options.image ??= `${CLOTHES}preview/${asset.Name}.png${FRESH}`;
				return next([args[0], args[1], args[2], args[3], options, ...args.slice(5)]);
			});
		}
		return ok;
	}

	// ---- Players who don't have the add-on
	/** Tells other players' add-ons that you have it (a key in your shared settings), once you are logged in. */
	function markSelf() {
		let tries = 0;
		const wait = setInterval(() => {
			if (++tries > 2400) {
				clearInterval(wait);
				return;
			}
			const p = w.Player;
			if (!p || !p.MemberNumber || !p.OnlineSharedSettings || !w.ServerAccountUpdate) {
				return;
			}
			clearInterval(wait);
			try {
				if (p.OnlineSharedSettings[ADDON_ID] !== VERSION) {
					p.OnlineSharedSettings[ADDON_ID] = VERSION;
					w.ServerAccountUpdate.QueueData({ OnlineSharedSettings: p.OnlineSharedSettings });
				}
			} catch (e) {
				problem('Shared settings', e);
			}
		}, 500);
	}
	/** Whether the player with that member number is known to use the add-on (you always do). */
	function usesAddOn(/** @type {number} */ member) {
		if (w.Player && member === w.Player.MemberNumber) {
			return true;
		}
		const c = Array.isArray(w.Character) ? w.Character.find((/** @type {any} */ x) => x && x.MemberNumber === member) : null;
		return !!(c && c.OnlineSharedSettings && c.OnlineSharedSettings[ADDON_ID]);
	}
	/**
	 * Keeps your clothes when someone without the add-on changes your outfit: their game doesn't know the pieces, so the
	 * outfit it sends leaves them out, which the game would otherwise take as removing them.
	 */
	function keepOnRemove(/** @type {any[]} */ args, /** @type {(a: any[]) => any} */ next) {
		const [previous, params, isSwap] = args;
		const c = params && params.C;
		// (putting something else on in its place is a choice they made, not a piece their game didn't know)
		if (
			isSwap !== true &&
			previous &&
			isOurs(previous.Asset) &&
			c &&
			typeof c.IsPlayer === 'function' &&
			c.IsPlayer() &&
			!params.fromSelf &&
			typeof params.sourceMemberNumber === 'number' &&
			!usesAddOn(params.sourceMemberNumber)
		) {
			return { item: previous, valid: false };
		}
		return next(args);
	}

	// ---- Outfits: the last row of the wardrobe's list of clothes. Its choices are each outfit's complete fit, then each
	// of its items on its own; "Put on" wears the choice, in the outfit's colours.
	/** @type {{ label: string, full: boolean, items: { Group: string, Name: string, Color: string | string[] }[] }[]} */
	const outfitChoices = [];
	let outfitChoice = 0;
	/** Stands in for the row in the game's list of groups, so its pages reach it; the game's own loops skip it. */
	const OUTFIT_ROW = Object.freeze({ Name: `${ADDON_ID}Outfits`, Description: `${ADDON_NAME} outfits`, IsAppearance: () => false });
	/** The row's top on the screen when it is on the page shown (else -1). */
	function outfitRowTop() {
		const groups = w.CharacterAppearanceGroups;
		const i = Array.isArray(groups) ? groups.indexOf(OUTFIT_ROW) : -1;
		const offset = w.CharacterAppearanceOffset || 0;
		const per = w.CharacterAppearanceNumGroupPerPage || 0;
		if (i < 0 || i < offset || i >= offset + per || w.CharacterAppearanceMode !== '' || w.DialogFocusItem) {
			return -1;
		}
		if (w.Layering && typeof w.Layering.IsActive === 'function' && w.Layering.IsActive()) {
			return -1;
		}
		return 145 + (i - offset) * 95;
	}
	/**
	 * Hooks the wardrobe: the row is added last when it opens, drawn after the game's rows, and its clicks are taken
	 * before the game's.
	 * @param {Record<string, any>} outfits clothes.json's outfits: { id: { Description, Items } }
	 */
	function hookOutfits(outfits) {
		for (const u of Object.values(outfits)) {
			const items = (u.Items || []).filter((/** @type {any} */ x) => w.AssetGet('Female3DCG', x.Group, x.Name));
			if (!items.length) {
				continue;
			}
			outfitChoices.push({ label: `${u.Description} (full outfit)`, full: true, items });
			for (const x of items) {
				outfitChoices.push({
					label: `${u.Description}: ${w.AssetGet('Female3DCG', x.Group, x.Name).Description}`,
					full: false,
					items: [x],
				});
			}
		}
		if (!outfitChoices.length || !['AppearanceLoad', 'AppearanceRun', 'AppearanceClick'].every((f) => gameFunction(f))) {
			return;
		}
		const feature = 'Outfits';
		hookGame('AppearanceLoad', 0, feature, (args, next) => {
			const r = next(args);
			const add = () => {
				if (Array.isArray(w.CharacterAppearanceGroups) && !w.CharacterAppearanceGroups.includes(OUTFIT_ROW)) {
					w.CharacterAppearanceGroups.push(OUTFIT_ROW);
				}
			};
			return r instanceof Promise ? r.then((v) => (add(), v)) : (add(), r);
		});
		hookGame('AppearanceRun', 0, feature, (args, next) => {
			const r = next(args);
			const top = outfitRowTop();
			if (top >= 0 && w.CharacterAppearanceSelection) {
				const choice = outfitChoices[outfitChoice] || outfitChoices[0];
				const around = (/** @type {number} */ d) => outfitChoices[(outfitChoice + d + outfitChoices.length) % outfitChoices.length].label;
				w.DrawBackNextButton(1210, top, 400, 65, `${ADDON_NAME}: ${choice.label}`, '#d9c8ff', '', () => around(-1), () => around(1));
				w.DrawButton(1635, top, 250, 65, 'Put on', 'White');
			}
			return r;
		});
		hookGame('AppearanceClick', 0, feature, (args, next) => {
			const top = outfitRowTop();
			const C = w.CharacterAppearanceSelection;
			if (top < 0 || !C || typeof w.MouseIn !== 'function') {
				return next(args);
			}
			if (w.MouseIn(1210, top, 400, 65)) {
				outfitChoice = (outfitChoice + (w.MouseX > 1410 ? 1 : -1) + outfitChoices.length) % outfitChoices.length;
				return undefined;
			}
			if (w.MouseIn(1635, top, 250, 65)) {
				const choice = outfitChoices[outfitChoice];
				if (choice) {
					wearOutfit(C, choice);
				}
				return undefined;
			}
			return next(args);
		});
	}
	/**
	 * An item's colours from an outfit: one colour for every colourable layer, or one per layer of the asset (in its
	 * layers' order, those that take no colour included), put in the asset's colour slots.
	 * @param {any} asset
	 * @param {string | string[]} color
	 */
	function outfitColors(asset, color) {
		const count = asset.ColorableLayerCount || 0;
		if (!count) {
			return null;
		}
		if (typeof color === 'string') {
			return Array(count).fill(color);
		}
		const colors = Array(count).fill('Default');
		asset.Layer.forEach((/** @type {any} */ l, /** @type {number} */ i) => {
			if (l.AllowColorize && !l.CopyLayerColor && Number.isInteger(l.ColorIndex) && typeof color[i] === 'string') {
				colors[l.ColorIndex] = color[i];
			}
		});
		return colors;
	}
	/** Whether C's item in that group may be changed here: '' if so, else 'blocked' or 'locked'. */
	function mayChange(/** @type {any} */ C, /** @type {any} */ group) {
		const now = w.InventoryGet(C, group.Name);
		const blocked =
			(typeof w.AppearanceGroupAllowed === 'function' && !w.AppearanceGroupAllowed(C, group.Name)) ||
			(typeof w.WardrobeGroupAccessible === 'function' && !w.WardrobeGroupAccessible(C, group));
		const locked =
			!!now && ((now.Property && now.Property.LockedBy) || (typeof w.InventoryGetLock === 'function' && w.InventoryGetLock(now)));
		return blocked ? 'blocked' : locked ? 'locked' : '';
	}
	/**
	 * Puts an outfit choice on C in the wardrobe, as the wardrobe would: only what it offers for C, never in a group C
	 * can't change here, never over a locked item. A full outfit also takes off C's other clothes (not underwear) where
	 * it may, like a saved outfit. One redraw at the end; the wardrobe saves it all when accepted. The header says what
	 * went on and what was left, and why.
	 * @param {any} C
	 * @param {{ label: string, full: boolean, items: { Group: string, Name: string, Color: string | string[] }[] }} choice
	 */
	function wearOutfit(C, choice) {
		const offered = w.CharacterAppearanceGroupedAssets;
		const put = [];
		const left = [];
		let off = 0;
		if (choice.full && Array.isArray(w.AssetGroup)) {
			const mine = choice.items.map((x) => x.Group);
			for (const g of w.AssetGroup) {
				if (
					g.Family === (C.AssetFamily || 'Female3DCG') &&
					g.Clothing &&
					!g.Underwear &&
					g.AllowNone &&
					!mine.includes(g.Name) &&
					w.InventoryGet(C, g.Name) &&
					!mayChange(C, g)
				) {
					w.CharacterAppearanceSetItem(C, g.Name, null);
					off++;
				}
			}
		}
		for (const x of choice.items) {
			const asset = w.AssetGet(C.AssetFamily || 'Female3DCG', x.Group, x.Name);
			const group = w.AssetGroupGet(C.AssetFamily || 'Female3DCG', x.Group);
			const name = asset ? asset.Description : x.Name;
			const why = asset && group ? mayChange(C, group) : '';
			if (!asset || !group) {
				left.push(`${name} (not in this game)`);
			} else if (why === 'blocked') {
				left.push(`${name} (that slot is blocked)`);
			} else if (why === 'locked') {
				left.push(`${name} (${w.InventoryGet(C, x.Group).Asset.Description} is locked on)`);
			} else if (!(offered instanceof Map) || !(offered.get(x.Group) || []).includes(asset)) {
				left.push(`${name} (not in the wardrobe)`);
			} else {
				w.CharacterAppearanceSetItem(C, x.Group, asset, outfitColors(asset, x.Color));
				put.push(name);
			}
		}
		if ((put.length || off) && typeof w.CharacterRefresh === 'function') {
			w.CharacterRefresh(C, false);
		}
		w.CharacterAppearanceHeaderText = `${put.length ? `Put on: ${put.join(', ')}.` : 'Nothing put on.'}${off ? ` Took off ${off} other clothes.` : ''}${left.length ? ` Left: ${left.join(', ')}.` : ''}`;
		w.CharacterAppearanceHeaderTextTime = (typeof w.CommonTime === 'function' ? w.CommonTime() : Date.now()) + 6000;
	}

	// ---- Settings (Preferences > Extensions), the SCE badge on item tiles, update notes and the update-ready notice
	const ICON = `${BASE}icon-64.png${FRESH}`;
	const SETTINGS_KEY = 'sce.settings';
	const SEEN_KEY = 'sce.notesSeen';
	/** The badge's name among the game's preview icons (drawn from Icons/Previews/<name>.png). */
	const BADGE = 'SCE';
	/** How often a newer published version is looked for. */
	const UPDATE_CHECK = 15 * 60 * 1000;
	/** @type {{ activities: boolean, restoreCrafts: boolean, updateReady: boolean, updateNotes: boolean }} */
	const settings = { activities: true, restoreCrafts: true, updateReady: true, updateNotes: true };
	try {
		const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
		for (const k of /** @type {(keyof typeof settings)[]} */ (Object.keys(settings))) {
			if (typeof saved[k] === 'boolean') {
				settings[k] = saved[k];
			}
		}
	} catch {
		// unreadable or blocked storage: the defaults stay
	}
	function saveSettings() {
		try {
			localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
		} catch {
			// blocked storage: the change lasts for this session
		}
	}

	/** Whether version a is newer than b (x.y.z). */
	const newer = (/** @type {string} */ a, /** @type {string} */ b) => {
		const pa = a.split('.').map(Number);
		const pb = b.split('.').map(Number);
		for (let i = 0; i < 3; i++) {
			if ((pa[i] || 0) !== (pb[i] || 0)) {
				return (pa[i] || 0) > (pb[i] || 0);
			}
		}
		return false;
	};

	/** The game colours only its own toast types; ours gets a solid background so its text stays readable over any room. */
	function toastStyle() {
		if (document.getElementById('sce-toast-style')) {
			return;
		}
		const style = document.createElement('style');
		style.id = 'sce-toast-style';
		style.textContent = '.toast.sce-toast { --background-color: #3b1f3a; --accent-color: #ffe3f1; }';
		document.head.appendChild(style);
	}

	/** Shows a game toast with the add-on's icon; does nothing on a game without toasts. */
	function toast(/** @type {string} */ title, /** @type {string} */ text, ms = 12000) {
		try {
			if (w.ToastManager && typeof w.ToastManager.custom === 'function') {
				toastStyle();
				w.ToastManager.custom(text, 'sce-toast', { title, icon: ICON, iconColor: 'default', duration: ms, category: ADDON_ID });
			}
		} catch (e) {
			problem('Toasts', e);
		}
	}

	/** Our items get the SCE badge in the corner of their tile, with the add-on's name on hover. */
	function hookBadge() {
		hookGame('DialogGetAssetIcons', 0, 'Badge', (args, next) => {
			const icons = next(args);
			return isOurs(args[0]) && Array.isArray(icons) ? [...icons, BADGE] : icons;
		});
		hookGame('InterfaceTextGet', 0, 'Badge', (args, next) =>
			args[0] === `PreviewIcon${BADGE}` ? ADDON_NAME : next(args),
		);
		// Item buttons made of page elements load a named badge straight from the game's folder, where ours isn't: they
		// get it with its own picture (the canvas draws it through the picture hook)
		if (gameFunction('ElementButton._ParseIcons')) {
			hookGame('ElementButton._ParseIcons', 0, 'Badge', (args, next) =>
				Array.isArray(args[1]) && args[1].includes(BADGE)
					? next([args[0], args[1].map((i) => (i === BADGE ? { name: BADGE, iconSrc: ICON, tooltipText: ADDON_NAME } : i)), ...args.slice(2)])
					: next(args),
			);
		}
	}

	/** When GitHub Pages has a newer version, says once that a reload gets it. */
	let updateTold = '';
	function checkForUpdate() {
		if (!settings.updateReady) {
			return;
		}
		fetch(`${BASE}sce.js?t=${Date.now()}`, { cache: 'no-store' })
			.then((r) => (r.ok ? r.text() : ''))
			.then((code) => {
				const m = /const VERSION = '(\d+\.\d+\.\d+)'/.exec(code);
				if (!m || !newer(m[1], VERSION) || m[1] === updateTold) {
					return;
				}
				updateTold = m[1];
				toast(`${ADDON_NAME} update`, `v${m[1]} is ready (you have v${VERSION}). Reload the game to get it.`, 20000);
			})
			.catch(() => {
				// offline: tried again next time
			});
	}

	/** This version's note from news.json ({ id: version, title, text }), shown once per browser. */
	function showUpdateNote() {
		if (!settings.updateNotes) {
			return;
		}
		/** @type {string[]} */
		let seen = [];
		try {
			const s = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
			seen = Array.isArray(s) ? s.filter((x) => typeof x === 'string') : [];
		} catch {
			// unreadable: shown again, at worst
		}
		if (seen.includes(VERSION)) {
			return;
		}
		fetch(`${BASE}news.json?t=${Date.now()}`, { cache: 'no-store' })
			.then((r) => (r.ok ? r.json() : []))
			.then((/** @type {any} */ news) => {
				const item = Array.isArray(news) ? news.find((n) => n && n.id === VERSION && typeof n.text === 'string') : null;
				if (!item) {
					return;
				}
				toast(typeof item.title === 'string' ? item.title : `${ADDON_NAME} v${VERSION}`, item.text, 20000);
				try {
					localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, VERSION].slice(-20)));
				} catch {
					// blocked storage
				}
			})
			.catch(() => {
				// offline: shown next time
			});
	}

	/** The add-on's page in Preferences > Extensions. */
	function registerSettings() {
		const register = gameFunction('PreferenceRegisterExtensionSetting');
		// The game's list is a script-level `let`, not a window property.
		const registered = typeof PreferenceExtensionsSettings === 'object' && PreferenceExtensionsSettings && PreferenceExtensionsSettings[ADDON_ID];
		if (!register || registered) {
			return;
		}
		/** @type {[number, number, number, number]} */
		const EXIT = [1815, 75, 90, 90];
		const LEFT = 500;
		const TOP = 220;
		const ROW = 90;
		/** @type {[string, keyof typeof settings][]} */
		const boxes = [
			['Add the SCE activities to the activity menu', 'activities'],
			['Put dropped SCE crafts back by themselves (off: SCE asks first)', 'restoreCrafts'],
			['Tell me when an update is ready', 'updateReady'],
			['Show what is new after an update', 'updateNotes'],
		];
		/** @type {[number, number, number, number]} The restore button, under the boxes and the status line. */
		const RESTORE = [LEFT, TOP + boxes.length * ROW + 100, 640, 64];
		/** @type {[number, number, number, number]} */
		const CLOTHES_LIST = [LEFT, RESTORE[1] + 100, 300, 64];
		/** @type {[number, number, number, number]} */
		const ACTIVITY_LIST = [LEFT + 340, RESTORE[1] + 100, 300, 64];
		/** What the last press of the restore button did. */
		let restoreSaid = '';
		/** @type {'main' | 'clothes' | 'activities'} The page shown: the settings, or one of the two lists. */
		let page = 'main';
		const mouseIn = (/** @type {number[]} */ r) => typeof w.MouseIn === 'function' && w.MouseIn(r[0], r[1], r[2], r[3]);
		try {
			register({
				Identifier: ADDON_ID,
				ButtonText: ADDON_NAME,
				Image: ICON,
				load: () => {
					restoreSaid = '';
					page = 'main';
				},
				// (the game calls these when the page closes, or another add-on opens its own; from a list, Esc goes
				// back to the settings)
				exit: () => {
					if (page !== 'main') {
						page = 'main';
						return false;
					}
					return true;
				},
				unload: () => {},
				run: () => {
					// The game's canvas is a script-level `let`, not a window property.
					const ctx = MainCanvas;
					const align = ctx.textAlign;
					try {
						ctx.textAlign = 'left';
						if (page !== 'main') {
							drawList(page);
							ctx.textAlign = 'center';
							w.DrawButton(...EXIT, '', 'White', 'Icons/Exit.png');
							return;
						}
						w.DrawText(`- ${ADDON_NAME} - v${VERSION}`, LEFT, 125, 'Black', 'Gray');
						boxes.forEach(([label, key], i) => w.DrawCheckbox(LEFT, TOP + i * ROW, 64, 64, label, settings[key]));
						const off = [...problems.keys()];
						w.DrawText(
							off.length ? `Switched off this session: ${off.join(', ')}` : 'Everything is working.',
							LEFT,
							TOP + boxes.length * ROW + 40,
							off.length ? 'Red' : 'Black',
							'Gray',
						);
						if (restoreSaid) {
							w.DrawText(restoreSaid, RESTORE[0] + RESTORE[2] + 30, RESTORE[1] + 32, 'Black', 'Gray');
						}
						ctx.textAlign = 'center';
						w.DrawButton(...RESTORE, 'Put my SCE clothes and crafts back', 'White');
						w.DrawButton(...CLOTHES_LIST, 'Clothing list', 'White');
						w.DrawButton(...ACTIVITY_LIST, 'Activity list', 'White');
						w.DrawButton(...EXIT, '', 'White', 'Icons/Exit.png');
					} catch (e) {
						problem('Settings', e);
					} finally {
						ctx.textAlign = align;
					}
				},
				click: () => {
					try {
						if (mouseIn(EXIT)) {
							if (page !== 'main') {
								page = 'main';
							} else if (typeof w.PreferenceSubscreenExtensionsExit === 'function') {
								w.PreferenceSubscreenExtensionsExit();
							}
							return;
						}
						if (page !== 'main') {
							return;
						}
						if (mouseIn(CLOTHES_LIST)) {
							page = 'clothes';
							return;
						}
						if (mouseIn(ACTIVITY_LIST)) {
							page = 'activities';
							return;
						}
						if (mouseIn(RESTORE)) {
							const back = putBack();
							restoreSaid = back.length ? `Put back: ${back.join(', ')}` : 'Nothing was missing that you may put on now.';
							return;
						}
						boxes.forEach(([, key], i) => {
							if (mouseIn([LEFT, TOP + i * ROW, 64, 64])) {
								settings[key] = !settings[key];
								saveSettings();
							}
						});
					} catch (e) {
						problem('Settings', e);
					}
				},
			});
		} catch (e) {
			problem('Settings', e);
		}
	}

	/**
	 * One of the settings' two lists, drawn left-aligned: every SCE piece with its options, or every SCE activity.
	 * @param {'clothes' | 'activities'} which
	 */
	function drawList(which) {
		const LEFT = 300;
		const WIDTH = 1400;
		if (which === 'clothes') {
			w.DrawText(`- ${ADDON_NAME}: clothing -`, LEFT, 125, 'Black', 'Gray');
			let y = 220;
			for (const piece of pieces.values()) {
				const group = w.AssetGroupGet('Female3DCG', piece.group);
				w.DrawTextFit(`${piece.description} (${(group && group.Description) || piece.group})`, LEFT, y, WIDTH, 'Black', 'Gray');
				y += 70;
				const key = `${piece.group}${piece.name}`;
				const modules = (piece.extended && Array.isArray(piece.extended.Modules) && piece.extended.Modules) || [];
				for (const m of modules) {
					const name = (piece.texts && piece.texts[`${key}Module${m.Name}`]) || m.Name;
					const options = (m.Options || []).map(
						(/** @type {any} */ _, /** @type {number} */ i) => (piece.texts && piece.texts[`${key}Option${m.Key}${i}`]) || `${m.Key}${i}`,
					);
					w.DrawTextFit(`${name}: ${options.join(', ')}`, LEFT + 60, y, WIDTH - 60, 'Black', 'Gray');
					y += 60;
				}
				y += 30;
			}
			return;
		}
		/** @type {string[]} */
		const names = Array.isArray(w.SCE && w.SCE.activityLabels) ? w.SCE.activityLabels : [];
		w.DrawText(`- ${ADDON_NAME}: activities (${names.length}) -`, LEFT, 125, 'Black', 'Gray');
		if (!names.length) {
			w.DrawText('The activities are not loaded.', LEFT, 220, 'Black', 'Gray');
			return;
		}
		const COLUMNS = 3;
		const rows = Math.ceil(names.length / COLUMNS);
		const rowHeight = Math.min(60, Math.floor(700 / rows));
		names.forEach((name, i) => {
			w.DrawTextFit(name, LEFT + Math.floor(i / rows) * (WIDTH / COLUMNS), 220 + (i % rows) * rowHeight, WIDTH / COLUMNS - 40, 'Black', 'Gray');
		});
	}

	// ---- Restore: if the game loads your outfit before SCE has added its clothes (a slow connection, the bookmark),
	// it drops them as unknown. SCE keeps a copy of the SCE clothes you wear in your account's add-on settings and
	// puts back what is missing once its clothes are in, into empty slots only.
	// Crafts the same way: the game drops a craft of an item it doesn't know yet at login, and erases it from your
	// account the next time it saves your crafts. The copy keeps SCE's crafts (the game's own text for each) until they
	// are back: by themselves, or with the settings button when the restoreCrafts setting is off.
	/** Your account's copy: { worn: [{ Group, Name, Color, Property }], crafts: [{ slot, craft }] }. */
	function saved() {
		try {
			const raw = w.Player && w.Player.ExtensionSettings && w.Player.ExtensionSettings[ADDON_ID];
			const data = typeof raw === 'string' && raw ? JSON.parse(raw) : null;
			return {
				worn: data && Array.isArray(data.worn) ? data.worn.filter((/** @type {any} */ x) => x && typeof x.Group === 'string' && typeof x.Name === 'string') : [],
				crafts:
					data && Array.isArray(data.crafts)
						? data.crafts.filter((/** @type {any} */ x) => x && Number.isInteger(x.slot) && x.slot >= 0 && typeof x.craft === 'string' && x.craft)
						: [],
			};
		} catch {
			return { worn: [], crafts: [] };
		}
	}
	const savedOutfit = () => saved().worn;
	/** Whether a craft (the game's object) is of an SCE item. */
	const isOurCraft = (/** @type {any} */ c) => !!c && typeof c.Item === 'string' && pieces.has(c.Item);
	/** @type {{ slot: number, craft: string }[]} SCE crafts missing at login and not back yet (restoreCrafts off): the copy keeps them. */
	let missingCrafts = [];
	/** The SCE crafts you have now, as the copy keeps them; null when the game's crafts can't be read. */
	function currentCrafts() {
		const p = w.Player;
		const serialize = gameFunction('CraftingSerialize');
		if (!p || !Array.isArray(p.Crafting) || !serialize || !working('Restore crafts')) {
			return null;
		}
		try {
			/** @type {{ slot: number, craft: string }[]} */
			const out = [];
			p.Crafting.forEach((/** @type {any} */ c, /** @type {number} */ slot) => {
				const craft = isOurCraft(c) ? serialize(c) : '';
				if (craft) {
					out.push({ slot, craft });
				}
			});
			return out;
		} catch (e) {
			// (the copy then stays as it was: switched off, never emptied)
			problem('Restore crafts', e);
			return null;
		}
	}
	/** The member number whose login the restore check has run for: before it, the outfit may be missing pieces, so no copy is taken. */
	let restoredFor = 0;
	/** Saves a copy of the SCE clothes you wear, when it changed. */
	function saveOutfit() {
		const p = w.Player;
		if (!p || !p.MemberNumber || restoredFor !== p.MemberNumber || !p.ExtensionSettings || !Array.isArray(p.Appearance)) {
			return;
		}
		const worn = p.Appearance.filter((/** @type {any} */ i) => i && isOurs(i.Asset)).map((/** @type {any} */ i) => ({
			Group: i.Asset.Group.Name,
			Name: i.Asset.Name,
			Color: i.Color,
			Property: i.Property ? JSON.parse(JSON.stringify(i.Property)) : undefined,
		}));
		const now = currentCrafts();
		const crafts = now ? [...now, ...missingCrafts.filter((m) => !now.some((c) => c.craft === m.craft))] : saved().crafts;
		const text = JSON.stringify({ v: 1, worn, crafts });
		if (p.ExtensionSettings[ADDON_ID] === text || typeof w.ServerPlayerExtensionSettingsSync !== 'function') {
			return;
		}
		p.ExtensionSettings[ADDON_ID] = text;
		w.ServerPlayerExtensionSettingsSync(ADDON_ID);
	}
	/**
	 * Puts back saved SCE clothes the outfit is missing, into empty slots that aren't blocked. Returns their names.
	 * @returns {string[]}
	 */
	function restoreOutfit() {
		const p = w.Player;
		const back = [];
		for (const s of savedOutfit()) {
			const asset = w.AssetGet('Female3DCG', s.Group, s.Name);
			if (!asset || !isOurs(asset) || w.InventoryGet(p, s.Group)) {
				continue;
			}
			if (
				(typeof w.InventoryGroupIsBlocked === 'function' && w.InventoryGroupIsBlocked(p, s.Group)) ||
				(typeof w.AppearanceGroupAllowed === 'function' && !w.AppearanceGroupAllowed(p, s.Group))
			) {
				continue;
			}
			w.InventoryWear(p, s.Name, s.Group, s.Color);
			const item = w.InventoryGet(p, s.Group);
			if (item && item.Asset === asset) {
				if (s.Property && typeof s.Property === 'object') {
					item.Property = JSON.parse(JSON.stringify(s.Property));
				}
				back.push(asset.Description);
			}
		}
		if (back.length) {
			syncPlayer();
		}
		return back;
	}
	/** Redraws you and sends your outfit: to the room when in one, else to your account. */
	function syncPlayer() {
		w.CharacterRefresh(w.Player);
		if (typeof w.ServerPlayerIsInChatRoom === 'function' && w.ServerPlayerIsInChatRoom() && typeof w.ChatRoomCharacterUpdate === 'function') {
			w.ChatRoomCharacterUpdate(w.Player);
		} else if (typeof w.ServerPlayerAppearanceSync === 'function') {
			w.ServerPlayerAppearanceSync();
		}
	}
	/**
	 * Puts saved SCE crafts back into your crafts: into their own slot when it is empty, else the first empty one.
	 * Returns their names.
	 * @param {{ slot: number, craft: string }[]} list
	 * @returns {string[]}
	 */
	function restoreCrafts(list) {
		const p = w.Player;
		const deserialize = gameFunction('CraftingDeserialize');
		const validate = gameFunction('CraftingValidate');
		const save = gameFunction('CraftingSaveServer');
		const now = currentCrafts();
		if (!list.length || !now || !deserialize || !validate || !save) {
			return [];
		}
		/** The game's CraftingStatusType.CRITICAL_ERROR: a craft it would throw away. */
		const CRITICAL = 0;
		const back = [];
		for (const s of list) {
			if (now.some((c) => c.craft === s.craft)) {
				continue;
			}
			const craft = deserialize(s.craft, { C: p });
			// (an item this version doesn't have, or a craft the game rejects: kept in the copy, never forced in)
			if (!isOurCraft(craft) || validate(craft, undefined, false, true) === CRITICAL) {
				continue;
			}
			let slot = p.Crafting[s.slot] ? p.Crafting.findIndex((/** @type {any} */ c) => !c) : s.slot;
			if (slot < 0) {
				slot = p.Crafting.length;
			}
			if (slot >= 200) {
				continue;
			}
			while (p.Crafting.length < slot) {
				p.Crafting.push(null);
			}
			p.Crafting[slot] = craft;
			now.push({ slot, craft: s.craft });
			back.push(craft.Name || pieces.get(craft.Item).description);
		}
		missingCrafts = missingCrafts.filter((m) => !now.some((c) => c.craft === m.craft));
		if (back.length) {
			save();
		}
		return back;
	}
	/** SCE crafts in the copy that you don't have now. */
	function droppedCrafts() {
		const now = currentCrafts();
		return now ? saved().crafts.filter((s) => !now.some((c) => c.craft === s.craft)) : [];
	}
	/** The settings button: everything missing, clothes and crafts. Returns their names. */
	function putBack() {
		// (only clothes you may change yourself now: a bound player can't dress herself through the settings)
		const p = w.Player;
		const back = p && (typeof p.CanChangeOwnClothes !== 'function' || p.CanChangeOwnClothes()) ? restoreOutfit() : [];
		/** @type {string[]} */
		let crafts = [];
		try {
			const list = droppedCrafts();
			crafts = restoreCrafts([...list, ...missingCrafts.filter((m) => !list.some((s) => s.craft === m.craft))]);
		} catch (e) {
			problem('Restore crafts', e);
		}
		return [...back, ...crafts];
	}
	/** Once per login, when SCE's clothes are in and your outfit has loaded: puts back what the game dropped. */
	function checkRestore() {
		const p = w.Player;
		if (!p || !p.MemberNumber || restoredFor === p.MemberNumber || !pieces.size || !Array.isArray(p.Appearance) || !p.Appearance.length) {
			return;
		}
		if (!p.ExtensionSettings || ['AssetGet', 'InventoryGet', 'InventoryWear', 'CharacterRefresh'].some((f) => !gameFunction(f))) {
			return;
		}
		restoredFor = p.MemberNumber;
		try {
			if (fixOwnColors()) {
				syncPlayer();
			}
			const back = restoreOutfit();
			if (back.length) {
				toast(ADDON_NAME, `Put back what the game had dropped: ${back.join(', ')}.`);
			}
			checkCrafts();
			// (the first copy of this login: when nothing was missing, nothing was sent that would have saved it)
			saveOutfit();
		} catch (e) {
			problem('Restore', e);
		}
	}
	/** At login: SCE crafts the game dropped go back by themselves, or wait in the copy while SCE asks. */
	function checkCrafts() {
		if (!working('Restore crafts')) {
			return;
		}
		try {
			const dropped = droppedCrafts();
			if (!dropped.length) {
				return;
			}
			if (settings.restoreCrafts) {
				const back = restoreCrafts(dropped);
				if (back.length) {
					toast(ADDON_NAME, `Put back the crafts the game had dropped: ${back.join(', ')}.`);
				}
				return;
			}
			missingCrafts = dropped;
			const count = dropped.length === 1 ? '1 SCE craft' : `${dropped.length} SCE crafts`;
			toast(ADDON_NAME, `The game dropped ${count}. SCE kept a copy: put it back in Preferences > Extensions > ${ADDON_NAME}.`, 20000);
		} catch (e) {
			problem('Restore crafts', e);
		}
	}
	function hookRestore() {
		hookGame('ServerPlayerAppearanceSync', 0, 'Restore', (args, next) => {
			const result = next(args);
			saveOutfit();
			return result;
		});
		// A change to your crafts updates the copy of SCE's.
		if (gameFunction('CraftingSaveServer')) {
			hookGame('CraftingSaveServer', 0, 'Restore crafts', (args, next) => {
				const result = next(args);
				saveOutfit();
				return result;
			});
		}
		// In a chat room your outfit is saved through the room update instead.
		if (gameFunction('ChatRoomCharacterUpdate')) {
			hookGame('ChatRoomCharacterUpdate', 0, 'Restore', (args, next) => {
				const result = next(args);
				if (args[0] && w.Player && args[0].MemberNumber === w.Player.MemberNumber) {
					saveOutfit();
				}
				return result;
			});
		}
		setInterval(() => {
			if (working('Restore')) {
				try {
					checkRestore();
				} catch (e) {
					problem('Restore', e);
				}
			}
		}, 1000);
	}

	// ---- The SCE mark: SCE users in a room see each other's, with the version under the mouse (like SlimeBeep's
	// slime and ER's mark; it sits right of ER's) ----

	/** Content of the hidden room message SCE copies greet each other with: Dictionary [{ sce: version, reply? }]. */
	const ROOM_HELLO = 'SCE';
	/** @type {Map<number, string>} Member number -> SCE version, for people met in a chat room. */
	const roomVersions = new Map();
	/** @type {Map<number, number>} Member number -> when we last answered their hello. */
	const helloAnswered = new Map();
	/** The room SCE last said hello in. */
	let helloRoom = '';

	/** Says hello to the room (hidden), or answers one person's hello; other SCE copies answer with their version. */
	function sendHello(/** @type {number} */ to = 0) {
		try {
			w.ServerSend('ChatRoomChat', {
				Content: ROOM_HELLO,
				Type: 'Hidden',
				...(to ? { Target: to } : {}),
				Dictionary: [{ sce: VERSION, ...(to ? {} : { reply: true }) }],
			});
		} catch {
			// no room, no hello
		}
	}

	/** Where the mark sits on a character in the room (at zoom 1): in the row SlimeBeep and ER use, right of ER's. */
	const [MARK_X, MARK_Y, MARK_SIZE, MARK_VERSION_X] = [406, 42, 34, 470];
	/** SlimeBeep's and ER's marks in that row. */
	const NEIGHBOUR_MARKS_X = [330, 368];
	/** Draws the mark above an SCE user, right of ER's, and the version while the mouse is on it. */
	function drawRoomBadge(/** @type {any} */ C, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ zoom) {
		try {
			if (!C || typeof C.MemberNumber !== 'number' || !w.Player) {
				return;
			}
			if (typeof ChatRoomHideIconState === 'number' && ChatRoomHideIconState > 0) {
				return;
			}
			const version = C.MemberNumber === w.Player.MemberNumber ? VERSION : roomVersions.get(C.MemberNumber);
			if (!version) {
				return;
			}
			const [bx, by, size] = [x + MARK_X * zoom, y + MARK_Y * zoom, MARK_SIZE * zoom];
			const mouse = typeof w.MouseIn === 'function';
			// SlimeBeep and ER write their version right of their mark, over this one: it is hidden meanwhile
			if (mouse && NEIGHBOUR_MARKS_X.some((nx) => w.MouseIn(x + nx * zoom, by, size, size))) {
				return;
			}
			w.DrawImageResize(ICON, bx, by, size, size);
			if (mouse && w.MouseIn(bx, by, size, size)) {
				w.DrawTextFit(version, x + MARK_VERSION_X * zoom, by + 18 * zoom, 60 * zoom, '#7dffb0', 'black');
			}
		} catch {
			// a mark is never worth an error
		}
	}

	/** The hello listener, the drawing and the once-per-room hello. */
	function hookRoomBadge() {
		// (priority 1000: ahead of add-ons that answer hidden messages themselves and don't pass them on; it always does)
		hookGame('ChatRoomMessage', 1000, 'RoomBadge', (args, next) => {
			try {
				const m = args[0];
				if (m && m.Type === 'Hidden' && m.Content === ROOM_HELLO && typeof m.Sender === 'number' && w.Player && m.Sender !== w.Player.MemberNumber) {
					const d = Array.isArray(m.Dictionary) ? m.Dictionary[0] : null;
					const v = d && typeof d === 'object' ? d.sce : null;
					if (typeof v === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)) {
						roomVersions.set(m.Sender, v);
						if (d.reply === true && Date.now() - (helloAnswered.get(m.Sender) || 0) > 10000) {
							helloAnswered.set(m.Sender, Date.now());
							sendHello(m.Sender);
						}
					}
				}
			} catch {
				// not ours
			}
			return next(args);
		});
		hookGame('ChatRoomCharacterViewDrawOverlay', 0, 'RoomBadge', (args, next) => {
			const res = next(args);
			drawRoomBadge(args[0], args[1], args[2], args[3]);
			return res;
		});
		setInterval(() => {
			let room = '';
			try {
				const data = typeof ChatRoomData === 'object' ? ChatRoomData : null;
				if (typeof w.ServerPlayerIsInChatRoom === 'function' && w.ServerPlayerIsInChatRoom() && data && data.Name) {
					room = String(data.Name);
				}
			} catch {
				room = '';
			}
			if (room === helloRoom) {
				return;
			}
			helloRoom = room;
			if (room) {
				sendHello();
			}
		}, 1000);
	}

	/** The activities live in activities.js, next to this script; it uses the hooks above (window.SCE.kit). */
	function loadActivities() {
		try {
			const script = document.createElement('script');
			script.src = `${BASE}activities.js${FRESH}`;
			script.crossOrigin = 'anonymous';
			script.onerror = () => problem('Activities', 'activities.js did not load');
			document.head.appendChild(script);
		} catch (e) {
			problem('Activities', e);
		}
	}

	/** Once logged in: the settings page, this version's note, then a look for updates now and then. */
	function startExtras() {
		try {
			hookBadge();
			hookRoomBadge();
			hookRestore();
		} catch (e) {
			problem('Extras', e);
		}
		let tries = 0;
		const wait = setInterval(() => {
			if (++tries > 2400) {
				clearInterval(wait);
				return;
			}
			if (!w.Player || !w.Player.MemberNumber) {
				return;
			}
			clearInterval(wait);
			registerSettings();
			setTimeout(showUpdateNote, 4000);
			setInterval(checkForUpdate, UPDATE_CHECK);
		}, 500);
	}

	/** For the console, tests and activities.js: what is registered, which features were switched off, the hooks. */
	w.SCE = {
		version: VERSION,
		pieces,
		problems,
		settings,
		outfits: () => outfitChoices,
		putBack: () => (working('Restore') ? putBack() : []),
		kit: { hookGame, problem, working, gameFunction, settings, ICON, ADDON_NAME },
	};
	start();
	startExtras();
	loadActivities();
})();
