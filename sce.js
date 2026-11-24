// Slime Clothing Extension (SCE): a Bondage Club clothing add-on, Echo-style. It adds its own clothes to the game's
// clothing groups, with their pictures and texts, extra slots (a second copy of some clothing groups), and (when
// clothes.json lists outfits) a row at the end of the wardrobe that puts on an outfit in one go. The clothes are listed
// in clothes/clothes.json.
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
	const VERSION = '1.8.10';
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
	/** @type {Map<string, any>} The registered pieces (clothes.json entries) by <Group>/<Asset>: one piece may be in two groups. */
	const pieces = new Map();
	const pieceKey = (/** @type {string} */ group, /** @type {string} */ name) => `${group}/${name}`;
	/** The first piece of that asset name, in whichever group (crafts name only the asset). */
	const pieceNamed = (/** @type {string} */ name) => [...pieces.values()].find((p) => p.name === name);
	/** @type {Set<string>} Picture files the pieces have. */
	const images = new Set();
	/** @type {Map<string, Record<string, Function>>} Menus of items with screens of their own, by item name (tv.js). */
	const itemMenus = new Map();
	/** @type {Map<string, string>} The pieces' texts, by the game's text key. */
	const texts = new Map();
	/** @type {Map<string, string>} The pieces' layer names in the colour screen, by <Group><Asset><Layer>. */
	const layerNames = new Map();
	/** @type {Map<string, Record<string, string[]>>} Older colour orders of each piece, by their length. */
	const colorHistories = new Map();
	/** @type {Map<string, string>} Their colour group rows' names, by <Group><Asset><ColorGroup>. */
	const groupNames = new Map();

	/** Whether an asset is one of the add-on's pieces, in its own group or in an extra slot. */
	const isOurs = (/** @type {any} */ asset) =>
		!!asset && !!asset.Group && pieces.has(pieceKey(slotSource.get(asset.Group.Name) || asset.Group.Name, asset.Name));
	/** Whether an asset is worn through SCE: one of its pieces, or anything in an extra slot (both unknown to others' games). */
	const keptBySce = (/** @type {any} */ asset) => isOurs(asset) || (!!asset && !!asset.Group && slotGroups.has(asset.Group.Name));

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
					// (after the pieces, so the slots have them too)
					addSlots();
				})
				.catch((e) => {
					problem(FEATURE, e);
					addSlots();
				});
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
		try {
			addExpressions();
		} catch (e) {
			problem('Expressions', e);
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
		if (data.pieces.some((/** @type {any} */ p) => pieces.has(pieceKey(p.group, p.name)) && String(p.group).startsWith('Item'))) {
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
				piece.extended ? { [piece.group]: { [piece.name]: withoutGameMessages(piece.extended, piece.name) } } : undefined,
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
		pieces.set(pieceKey(piece.group, piece.name), piece);
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
	 * @param {string[]} posed poses with pictures of their own (drawn from that pose's folder), also poses its group
	 * draws like standing (a hakama's arm poses: its standing picture has holes for the hands in front)
	 */
	function standingOnly(source, group, fits, posed = []) {
		const def = JSON.parse(JSON.stringify(source));
		const poses = (group && group.PoseMapping) || {};
		def.PoseMapping = Object.fromEntries(
			Object.entries(poses)
				.filter(([, v]) => v !== '')
				.map(([pose]) => [pose, posed.includes(pose) ? pose : fits.includes(pose) ? '' : 'Hide']),
		);
		for (const pose of posed) {
			def.PoseMapping[pose] = pose;
		}
		return def;
	}
	/**
	 * The extended item config, sending no message of the game's own when an option changes: the game has no text for
	 * ours. (Clothes never send one; items in the other groups do.)
	 */
	function withoutGameMessages(/** @type {any} */ extended, name = '') {
		/** @type {Record<string, any>} */
		const hooks = { ...(extended.ScriptHooks || {}), PublishAction: () => {} };
		if (extended.Archetype === 'noarch' && name) {
			// An item with a menu of its own (the TV): the menu's parts come from itemMenus when they are called, so the
			// file that makes them (tv.js) may load after the item. A part that fails switches the menu back to the game's.
			for (const part of ['Load', 'Draw', 'Click', 'Exit']) {
				hooks[part] = (/** @type {any} */ data, /** @type {any} */ next, /** @type {any[]} */ ...args) => {
					const own = working(`Menu: ${name}`) && itemMenus.get(name)?.[part];
					if (own) {
						try {
							return own(data, next, ...args);
						} catch (e) {
							problem(`Menu: ${name}`, e);
						}
					}
					return typeof next === 'function' ? next(...args) : undefined;
				};
			}
		}
		return { ...extended, ScriptHooks: hooks };
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
				// (only items with options: the game warns in the console for any other, and this runs every frame)
				if (asset.Archetype === 'modular') {
					try {
						const data = w.ExtendedItemGetData(asset, 'modular');
						keys = data && Array.isArray(data.modules) ? data.modules.map((m) => m.Key).filter((k) => typeof k === 'string') : [];
					} catch {
						keys = [];
					}
					if (!keys.length) {
						// (its options aren't built yet: asked again next time)
						return keys;
					}
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

	// ---- Facial expressions
	/**
	 * Expressions SCE adds to the game's own rows in the expression menu (picked like the game's, and kept on the
	 * character like them). Their pictures are faces/<Group>/<Name>/<Group>.png, their menu buttons faces/<Group>/<Name>/
	 * icon.png. Players without SCE see nothing there.
	 */
	const EXPRESSIONS = [{ group: 'Blush', name: 'Sick' }];
	/** Adds the expressions to their groups (and those groups' items), once. */
	function addExpressions() {
		const getGroup = gameFunction('AssetGroupGet') && w.AssetGroupGet;
		if (!getGroup) {
			return;
		}
		for (const { group, name } of EXPRESSIONS) {
			const g = getGroup('Female3DCG', group);
			if (!g || !Array.isArray(g.AllowExpression)) {
				continue;
			}
			// (the group and its items usually share one list; an item with a list of its own gets it too)
			for (const holder of [g, ...(Array.isArray(g.Asset) ? g.Asset : [])]) {
				const list = holder.AllowExpression;
				if (!Array.isArray(list) || list.includes(name)) {
					continue;
				}
				if (Object.isFrozen(list)) {
					holder.AllowExpression = [...list, name];
				} else {
					list.push(name);
				}
			}
		}
	}

	/** The add-on's address for one of the game's picture paths, or '' when it isn't one of ours. */
	function picture(/** @type {string} */ url) {
		if (/^(?:\.\/)?Icons\/Previews\/SCE\.png$/.test(url)) {
			return ICON;
		}
		// (an expression's button in the expression menu: Icons/Expressions/<Group>/<Expression>.png)
		const icon = /^(?:\.\/)?Icons\/Expressions\/([A-Za-z0-9]+)\/([A-Za-z0-9]+)\.png$/.exec(url);
		if (icon && EXPRESSIONS.some((e) => e.group === icon[1] && e.name === icon[2])) {
			return `${BASE}faces/${icon[1]}/${icon[2]}/icon.png${FRESH}`;
		}
		// (an expression's picture: Assets/Female3DCG/<Group>/<Expression>/<Group>.png)
		const face = /^(?:\.\/)?Assets\/Female3DCG\/([A-Za-z0-9]+)\/([A-Za-z0-9]+)\/([A-Za-z0-9]+)\.png$/.exec(url);
		if (face && face[1] === face[3] && EXPRESSIONS.some((e) => e.group === face[1] && e.name === face[2])) {
			return `${BASE}faces/${face[1]}/${face[2]}/${face[3]}.png${FRESH}`;
		}
		// Assets/Female3DCG/<Group>/[<Pose>/]<Asset>[_<option types>]_<Layer>.png, or <Group>/Preview/<Asset>.png
		const m = /^(?:\.\/)?Assets\/Female3DCG\/([A-Za-z0-9]+)\/(?:([A-Za-z0-9]+)\/)?([A-Za-z0-9]+?)((?:_[A-Za-z0-9]+)*)\.png$/.exec(url);
		const piece = m && pieces.get(pieceKey(m[1], m[3]));
		if (!m || !piece) {
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
		if (ok && gameFunction('ElementButton._ParseImage')) {
			// (the pictures of the game's own buttons, such as the worn item's picture in its menu, skip CommonFetch)
			hookGame('ElementButton._ParseImage', 0, 'Button pictures', (args, next) => {
				const url = typeof args[1] === 'string' ? picture(args[1]) : '';
				return next(url ? [args[0], url, ...args.slice(2)] : args);
			});
		}
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
	 * Keeps your clothes when someone without the add-on changes your outfit: their game doesn't know the pieces or the
	 * extra slots, so the outfit it sends leaves them out, which the game would otherwise take as removing them.
	 */
	function keepOnRemove(/** @type {any[]} */ args, /** @type {(a: any[]) => any} */ next) {
		const [previous, params, isSwap] = args;
		const c = params && params.C;
		// (putting something else on in its place is a choice they made, not a piece their game didn't know)
		if (
			isSwap !== true &&
			previous &&
			keptBySce(previous.Asset) &&
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

	// ---- Extra slots: a second copy of some clothing groups (as Echo has), so two tops, two pairs of socks or two sets
	// of body markings can be worn at once. Each is the game's group under a new name, with the game's items and SCE's
	// pieces, listed after every other group in the wardrobe with the SCE logo by its name.
	const SLOTS_FEATURE = 'Extra slots';
	/**
	 * Each slot and the group it copies. The slot names are PERMANENT: they go out in chat and are saved in players'
	 * outfits, so a renamed or removed slot drops whatever was worn in it. Only ever add to this list.
	 * (At equal priority the game draws layers in group-name order, and "Cloth" sorts before "Cloth_SCE": a piece in a
	 * slot is drawn just above the same piece in the group it copies.)
	 * @type {[string, string][]}
	 */
	const SLOTS = [
		['Cloth_SCE', 'Cloth'],
		['ClothOuter_SCE', 'ClothOuter'],
		['ClothLower_SCE', 'ClothLower'],
		['ClothAccessory_SCE', 'ClothAccessory'],
		['Suit_SCE', 'Suit'],
		['SuitLower_SCE', 'SuitLower'],
		['Bra_SCE', 'Bra'],
		['Panties_SCE', 'Panties'],
		['Socks_SCE', 'Socks'],
		['Shoes_SCE', 'Shoes'],
		['Gloves_SCE', 'Gloves'],
		['Hat_SCE', 'Hat'],
		['Necklace_SCE', 'Necklace'],
		['BodyMarkings2_SCE', 'BodyMarkings'],
	];
	/** @type {Map<string, string>} Slot name -> the group it copies. */
	const slotSource = new Map(SLOTS);
	/** @type {Map<string, any>} The slots added this session (the game's group objects), by name. */
	const slotGroups = new Map();
	/** The group a slot copies, for a slot this session added; else ''. */
	const sourceOf = (/** @type {any} */ name) => (slotGroups.has(name) && slotSource.get(name)) || '';
	let slotsTried = false;
	/** @type {Map<string, any> | null} While set, the game's manual extended configs are collected here, not built. */
	let manualCapture = null;
	/** @type {Set<string>} <Slot>/<Item> copies left out: not tried again. */
	const skippedCopies = new Set();

	/**
	 * Adds the slots once, unless the setting turns them off. Every hook they need goes in first: if one can't, no slot
	 * is added. A slot the game refuses is taken back out whole; the others stay.
	 */
	function addSlots() {
		if (slotsTried || !settings.extraSlots) {
			return;
		}
		slotsTried = true;
		const missing =
			['AssetGroupAdd', 'AssetAdd', 'AssetGroupGet', 'AssetGet', 'AssetBuildExtended', 'ExtendedItemManualRegister', 'AssetResolveCopyConfig.AssetDefinition', 'AssetResolveCopyConfig.ExtendedItemConfig'].find(
				(f) => !gameFunction(f),
			) || (Array.isArray(w.AssetFemale3DCG) && Array.isArray(w.AssetGroup) && w.AssetFemale3DCGExtended && w.AssetGroupMap instanceof Map ? '' : 'asset lists');
		if (missing) {
			problem(SLOTS_FEATURE, `the game has no ${missing}`);
			return;
		}
		if (!hookSlots()) {
			return;
		}
		try {
			const manual = manualConfigs();
			const defs = assetDefinitions();
			for (const [slot, source] of SLOTS) {
				try {
					addSlot(slot, source, defs, manual);
				} catch (e) {
					removeSlot(slot);
					problem(`${SLOTS_FEATURE}: ${slot}`, e);
				}
			}
			slotTexts();
		} catch (e) {
			for (const [slot] of SLOTS) {
				removeSlot(slot);
			}
			problem(SLOTS_FEATURE, e);
			return;
		}
		hookSlotLogos();
		hookAddOnItems();
	}

	/** The slots' hooks; false when one can't go in (the feature is then off). */
	function hookSlots() {
		// The owner's wardrobe rules and what hides it: as in the group the slot copies. (Everything in a slot is free.)
		hookGame('AppearanceGroupAllowed', 0, SLOTS_FEATURE, (args, next) => {
			const source = sourceOf(args[1]);
			return next(source ? [args[0], source, ...args.slice(2)] : args);
		});
		hookGame('CharacterAppearanceVisible', 0, SLOTS_FEATURE, (args, next) => {
			const source = sourceOf(args[2]);
			const shown = next(args);
			return source && shown ? next([args[0], args[1], source, ...args.slice(3)]) : shown;
		});
		// The wardrobe lists the slots after every other group, whenever the other add-ons added theirs. (Priority 1000:
		// around the other add-ons' hooks, so this runs after whatever they add.)
		hookGame('AppearanceLoad', 1000, SLOTS_FEATURE, (args, next) => {
			const r = next(args);
			slotsLast();
			return r instanceof Promise ? r.then((v) => (slotsLast(), v)) : r;
		});
		// The game names every group from its text file, ours as missing; a language change does it again.
		for (const name of ['AssetBuildDescription', 'TranslationAssetProcess']) {
			hookGame(name, 0, SLOTS_FEATURE, (args, next) => {
				const r = next(args);
				slotTexts();
				return r;
			});
		}
		hookGame('AssetBuildExtended', 0, SLOTS_FEATURE, (args, next) => {
			if (!manualCapture) {
				return next(args);
			}
			const [asset, config] = args;
			if (asset && asset.Group && config) {
				manualCapture.set(`${asset.Group.Name}/${asset.Name}`, config);
			}
			return null;
		});
		return working(SLOTS_FEATURE);
	}

	/**
	 * The extended configs the game builds by hand after loading (the Latex Catsuit's printed text), by <Group>/<Asset>:
	 * its function is run with their building held back, to read them.
	 * @returns {Map<string, any>}
	 */
	function manualConfigs() {
		const found = new Map();
		manualCapture = found;
		try {
			w.ExtendedItemManualRegister();
		} catch {
			// (without them, those items in the slots just lack their text options)
		} finally {
			manualCapture = null;
		}
		return found;
	}

	/**
	 * The game's own item definitions by group and name, copied: resolving one that copies another's settings writes
	 * into the definitions it reads.
	 * @returns {Record<string, Record<string, any>>}
	 */
	function assetDefinitions() {
		/** @type {Record<string, Record<string, any>>} */
		const record = {};
		for (const g of w.AssetFemale3DCG) {
			if (!g || typeof g.Group !== 'string' || !Array.isArray(g.Asset)) {
				continue;
			}
			const defs = (record[g.Group] = {});
			for (const a of g.Asset) {
				const def = typeof a === 'string' ? { Name: a } : a && typeof a.Name === 'string' ? { ...a } : null;
				if (def) {
					defs[def.Name] = def;
				}
			}
		}
		return record;
	}

	/**
	 * An extended config for a copy, its texts still read from the original's keys (`key`: the original's group and
	 * name), which the game would otherwise look for under the slot's name.
	 * @param {any} config
	 * @param {string} key
	 */
	function slotConfig(config, key) {
		/** @type {Record<string, Record<string, string>>} The game's defaults per archetype. */
		const defaults = {
			typed: { Header: `${key}Select`, Option: key, Chat: `${key}Set`, Npc: key },
			modular: { Header: `${key}Select`, Module: `${key}Module`, Option: `${key}Option`, Chat: `${key}Set` },
			variableheight: { Chat: `${key}Set` },
		};
		return { ...config, DialogPrefix: { ...(defaults[config.Archetype] || {}), ...(config.DialogPrefix || {}) } };
	}

	/**
	 * Adds one slot: the group copied under the slot's name, with a copy of each of the game's items in it and of each
	 * SCE piece. The copies draw from the original's pictures and texts and are free for everyone (Value 0), never in
	 * a buy group or the shop.
	 * @param {string} slot
	 * @param {string} source
	 * @param {Record<string, Record<string, any>>} defs from assetDefinitions()
	 * @param {Map<string, any>} manual from manualConfigs()
	 */
	function addSlot(slot, source, defs, manual) {
		const from = w.AssetGroupGet('Female3DCG', source);
		const fromDef = w.AssetFemale3DCG.find((/** @type {any} */ g) => g && g.Group === source);
		if (!from || !fromDef || !Array.isArray(from.Asset)) {
			throw new Error(`the game has no ${source} group as expected`);
		}
		if (w.AssetGroupGet('Female3DCG', slot)) {
			throw new Error(`another add-on already has a ${slot} group`);
		}
		const groupDef = {
			...fromDef,
			Group: slot,
			Asset: [],
			// (never put on by default or at random; always removable; drawn at its group's height)
			Default: false,
			Random: false,
			AllowNone: true,
			Priority: from.DrawingPriority,
			DynamicGroupName: from.DynamicGroupName || source,
		};
		const group = w.AssetGroupAdd('Female3DCG', groupDef);
		slotGroups.set(slot, group);
		/** @type {Record<string, any>} */
		const configs = {};
		const extended = { ...w.AssetFemale3DCGExtended, [slot]: configs };
		const sourceConfigs = w.AssetFemale3DCGExtended[source] || {};
		/** Adds one copy; a copy the game refuses is left out. */
		const add = (/** @type {any} */ def, /** @type {(copy: any) => void} */ after) => {
			try {
				w.AssetAdd(group, def, extended, groupDef);
				const copy = w.AssetGet('Female3DCG', slot, def.Name);
				if (!copy) {
					throw new Error(`${def.Name} was not added`);
				}
				after(copy);
			} catch (e) {
				unregister(group, def.Name);
				skippedCopies.add(`${slot}/${def.Name}`);
				problem(`${SLOTS_FEATURE}: ${slot}/${def.Name}`, e);
			}
		};
		for (const def of Object.values(defs[source] || {})) {
			const asset = w.AssetGet('Female3DCG', source, def.Name);
			const resolved = asset && w.AssetResolveCopyConfig.AssetDefinition({ ...def }, source, defs);
			if (!resolved) {
				skippedCopies.add(`${slot}/${def.Name}`);
				continue;
			}
			const own = `${source}/${def.Name}`;
			if (sourceConfigs[def.Name]) {
				const config = w.AssetResolveCopyConfig.ExtendedItemConfig(asset, sourceConfigs[def.Name], w.AssetFemale3DCGExtended);
				if (!config) {
					skippedCopies.add(`${slot}/${def.Name}`);
					continue;
				}
				configs[def.Name] = slotConfig(config, `${source}${def.Name}`);
			} else if (asset.Extended && !manual.has(own)) {
				// (an item with screens of its own, which a copy can't share)
				skippedCopies.add(`${slot}/${def.Name}`);
				continue;
			}
			const copyDef = { ...resolved, Value: 0, DynamicGroupName: asset.DynamicGroupName };
			delete copyDef.BuyGroup;
			delete copyDef.CopyConfig;
			add(copyDef, (copy) => {
				copy.Description = asset.Description;
				drawingFunctions(copy, slot, source);
				if (manual.has(own)) {
					w.AssetBuildExtended(copy, manual.get(own), extended, null, false);
				}
			});
		}
		for (const piece of pieces.values()) {
			if (piece.group !== source || w.AssetGet('Female3DCG', slot, piece.name)) {
				continue;
			}
			const def = standingOnly(piece.def, from, piece.fits || [], piece.poses || []);
			def.DynamicGroupName = source;
			if (piece.extended) {
				configs[piece.name] = slotConfig(withoutGameMessages(piece.extended), `${source}${piece.name}`);
			}
			add(def, (copy) => {
				copy.Description = piece.description;
			});
		}
	}

	/** Takes a slot this session added back out of the game's lists, with its items. */
	function removeSlot(/** @type {string} */ slot) {
		const group = slotGroups.get(slot);
		if (!group) {
			return;
		}
		slotGroups.delete(slot);
		for (const a of [...(group.Asset || [])]) {
			unregister(group, a.Name);
		}
		const i = w.AssetGroup.indexOf(group);
		if (i >= 0) {
			w.AssetGroup.splice(i, 1);
		}
		if (w.AssetGroupMap.get(slot) === group) {
			w.AssetGroupMap.delete(slot);
		}
		if (w.AssetActivityMirrorGroups instanceof Map) {
			w.AssetActivityMirrorGroups.delete(slot);
		}
	}

	/**
	 * Gives a copy the drawing functions the game finds by the item's group and name, from the original's; returns
	 * whether it has every one it needs.
	 * @param {any} copy
	 * @param {string} slot
	 * @param {string} source
	 */
	function drawingFunctions(copy, slot, source) {
		let all = true;
		for (const kind of ['BeforeDraw', 'AfterDraw', 'ScriptDraw']) {
			const mine = `Assets${slot}${copy.Name}${kind}`;
			const theirs = w[`Assets${source}${copy.Name}${kind}`];
			if (copy[`Dynamic${kind}`] && typeof w[mine] !== 'function') {
				if (typeof theirs === 'function') {
					w[mine] = theirs;
				} else {
					all = false;
				}
			}
		}
		return all;
	}

	/** The slots' names ("Upper Clothing 2", in the game's language) and their items' names, as the originals'. */
	function slotTexts() {
		for (const [slot, group] of slotGroups) {
			const source = slotSource.get(slot) || '';
			const from = w.AssetGroupGet('Female3DCG', source);
			group.Description = `${(from && from.Description) || source} 2`;
			for (const a of group.Asset) {
				const piece = pieces.get(pieceKey(source, a.Name));
				const original = piece ? null : w.AssetGet('Female3DCG', source, a.Name);
				if (piece) {
					a.Description = piece.description;
				} else if (original && typeof original.Description === 'string') {
					a.Description = original.Description;
				}
			}
		}
	}

	/** Moves the slots to the end of the wardrobe's list of groups, before SCE's outfit row, in place. */
	function slotsLast() {
		const list = w.CharacterAppearanceGroups;
		if (!Array.isArray(list)) {
			return;
		}
		const ours = list.filter((g) => g && slotGroups.get(g.Name) === g);
		if (!ours.length) {
			return;
		}
		const rest = list.filter((g) => !ours.includes(g) && g !== OUTFIT_ROW);
		const row = list.includes(OUTFIT_ROW) ? [OUTFIT_ROW] : [];
		list.splice(0, list.length, ...rest, ...ours, ...row);
	}

	// ---- Other add-ons' items in the slots (setting slotAddOnItems): what an add-on adds to a group a slot copies
	// (Echo's clothes, say) gets a copy in the slot, made from the item as the game built it, drawn from the same
	// pictures. Each copy is checked before it is kept; one that fails is left out on its own, and the add-on's item,
	// its definition and its group are only ever read.
	const ADDON_ITEMS_FEATURE = 'Add-on items in slots';
	/** @type {Map<string, string>} Group a slot copies -> the slot. */
	const slotOfSource = new Map(SLOTS.map(([slot, source]) => [source, slot]));
	/** @type {Map<string, any>} Extended configs other add-ons gave the game's AssetAdd, by <Group>/<Item>. */
	const addOnConfigs = new Map();
	/** @type {Map<string, string>} Per slot, how its group looked at the last look ("<count>/<last item>"). */
	const addOnSeen = new Map();
	let addOnLookQueued = false;

	function hookAddOnItems() {
		if (!slotGroups.size || !gameFunction('AssetAdd')) {
			return;
		}
		hookGame('AssetAdd', 0, ADDON_ITEMS_FEATURE, (args, next) => {
			const [group, def, extended] = args;
			const name = def && typeof def === 'object' && typeof def.Name === 'string' ? def.Name : '';
			// (an item a slot already has is never added to it twice)
			if (group && name && slotGroups.get(group.Name) === group) {
				return w.AssetGet('Female3DCG', group.Name, name) || next(args);
			}
			if (!group || !slotOfSource.has(group.Name)) {
				return next(args);
			}
			const config = name && extended && typeof extended === 'object' && extended[group.Name] ? extended[group.Name][name] : null;
			if (config && typeof config === 'object') {
				addOnConfigs.set(`${group.Name}/${name}`, config);
			}
			const result = next(args);
			// (copied once the add-on is done with it: it may name it or change it right after)
			if (!addOnLookQueued) {
				addOnLookQueued = true;
				setTimeout(() => {
					addOnLookQueued = false;
					copyAddOnItems();
				}, 0);
			}
			return result;
		});
		if (!settings.slotAddOnItems) {
			return;
		}
		// Before an outfit is read (the game drops an item it doesn't know) and before the wardrobe lists the items.
		for (const name of ['ServerAppearanceLoadFromBundle', 'AppearanceLoad']) {
			hookGame(name, 0, ADDON_ITEMS_FEATURE, (args, next) => {
				copyAddOnItems();
				return next(args);
			});
		}
		copyAddOnItems();
		// (add-ons that add their items past the game's AssetAdd, Echo for one, are found at the next look)
		setInterval(copyAddOnItems, 1000);
	}

	/** Copies into the slots what other add-ons added to their groups since the last look. */
	function copyAddOnItems() {
		if (!settings.slotAddOnItems || !working(ADDON_ITEMS_FEATURE)) {
			return;
		}
		try {
			lookForAddOnItems();
		} catch (e) {
			// (a game that changed under the lookup itself: the feature switches off instead of failing every second)
			problem(ADDON_ITEMS_FEATURE, e);
		}
	}

	function lookForAddOnItems() {
		for (const [slot, group] of slotGroups) {
			const from = w.AssetGroupGet('Female3DCG', slotSource.get(slot));
			const list = from && Array.isArray(from.Asset) ? from.Asset : [];
			const last = list[list.length - 1];
			const seen = `${list.length}/${last && last.Name}`;
			if (addOnSeen.get(slot) === seen) {
				continue;
			}
			addOnSeen.set(slot, seen);
			for (const asset of [...list]) {
				const key = `${slot}/${asset && asset.Name}`;
				if (!asset || typeof asset.Name !== 'string' || skippedCopies.has(key) || w.AssetGet('Female3DCG', slot, asset.Name)) {
					continue;
				}
				try {
					copyAddOnItem(slot, group, asset);
				} catch (e) {
					// (only this item is left out, and only once)
					unregister(group, asset.Name);
					skippedCopies.add(key);
					problem(`${ADDON_ITEMS_FEATURE}: ${key}`, e);
				}
			}
		}
	}

	/**
	 * Copies one add-on item into its slot, from the item as the game built it: its own lists and layers cloned, free,
	 * in no buy group, drawn from the original's pictures (same DynamicGroupName), its options built from the config
	 * the add-on gave. Throws, with nothing of it kept, when a part of it is not as the game makes them.
	 * @param {string} slot
	 * @param {any} group the slot
	 * @param {any} asset the add-on's item
	 */
	function copyAddOnItem(slot, group, asset) {
		const source = asset.Group.Name;
		const config = addOnConfigs.get(`${source}/${asset.Name}`) || (w.AssetFemale3DCGExtended[source] || {})[asset.Name] || null;
		if (asset.Extended && !config) {
			throw new Error('it opens screens of its own');
		}
		if (typeof asset.DynamicGroupName !== 'string' || !asset.DynamicGroupName) {
			throw new Error('it has no picture folder');
		}
		/** @type {any} */
		const copy = {};
		for (const [k, v] of Object.entries(asset)) {
			copy[k] = Array.isArray(v) ? [...v] : v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype ? { ...v } : v;
		}
		copy.Group = group;
		copy.Value = 0;
		delete copy.BuyGroup;
		copy.Layer = Array.isArray(asset.Layer) ? asset.Layer.map((/** @type {any} */ l) => (l && typeof l === 'object' ? { ...l, Asset: copy } : l)) : [];
		if (!copy.Layer.length) {
			throw new Error('it has no layers');
		}
		for (const l of copy.Layer) {
			// (each layer as the game makes them, its picture at Assets/<family>/<folder>/<item>[_<layer>].png)
			const drawable =
				l &&
				typeof l === 'object' &&
				(l.Name === null || typeof l.Name === 'string') &&
				typeof l.Priority === 'number' &&
				Array.isArray(l.Alpha) &&
				[l.PoseMapping, l.DrawingLeft, l.DrawingTop].every((o) => o && typeof o === 'object');
			if (!drawable) {
				throw new Error('a layer of it is not as the game makes them');
			}
		}
		group.Asset.push(copy);
		w.Asset.push(copy);
		w.AssetMap.set(`${slot}/${copy.Name}`, copy);
		if (config) {
			const full = w.AssetResolveCopyConfig.ExtendedItemConfig(asset, config, w.AssetFemale3DCGExtended);
			if (!full) {
				throw new Error('its options could not be read');
			}
			w.AssetBuildExtended(copy, slotConfig(full, `${source}${asset.Name}`), w.AssetFemale3DCGExtended);
			if (!copy.Archetype || !w.ExtendedItemGetData(copy, copy.Archetype)) {
				throw new Error('its options did not build');
			}
		}
		// Its drawing functions (the game finds them by group and name), guarded: one that fails on the copy is
		// skipped from then on, and the item draws without it.
		for (const kind of ['BeforeDraw', 'AfterDraw', 'ScriptDraw']) {
			if (!copy[`Dynamic${kind}`]) {
				continue;
			}
			const mine = `Assets${slot}${copy.Name}${kind}`;
			const f = typeof w[mine] === 'function' ? w[mine] : w[`Assets${source}${copy.Name}${kind}`];
			if (typeof f !== 'function') {
				throw new Error(`it has no ${kind} function`);
			}
			const feature = `${ADDON_ITEMS_FEATURE}: ${slot}/${copy.Name}`;
			w[mine] = (/** @type {any[]} */ ...a) => {
				if (!working(feature)) {
					return undefined;
				}
				try {
					return f(...a);
				} catch (e) {
					problem(feature, e);
					return undefined;
				}
			};
		}
		copy.Description = asset.Description;
	}

	// The SCE logo by each slot's name in the wardrobe: the row's label is drawn again, moved right of the logo.
	const LOGO_FEATURE = 'Slot logos';
	/** Whether the wardrobe's rows are being drawn. */
	let drawingWardrobe = false;
	/**
	 * The slot whose wardrobe row a back/next button is: at a row's height, labelled with that row's group. (Read as the
	 * button is drawn, from the list the game is drawing: an add-on may show a filtered list, or move the buttons.)
	 * @param {number} top
	 * @param {any} label
	 */
	function slotRow(top, label) {
		const groups = w.CharacterAppearanceGroups;
		const i = (w.CharacterAppearanceOffset || 0) + (top - 145) / 95;
		const group = Array.isArray(groups) && Number.isInteger(i) ? groups[i] : null;
		return !!group && slotGroups.get(group.Name) === group && typeof label === 'string' && label.startsWith(`${group.Description}: `);
	}
	function hookSlotLogos() {
		if (!slotGroups.size || !gameFunction('AppearanceRun') || !gameFunction('DrawBackNextButton')) {
			return;
		}
		hookGame('AppearanceRun', 0, LOGO_FEATURE, (args, next) => {
			drawingWardrobe = w.CharacterAppearanceMode === '' && !w.DialogFocusItem;
			try {
				return next(args);
			} finally {
				drawingWardrobe = false;
			}
		});
		// The row's back/next button (1210, top, 400, 65): drawn without its label, then the logo past the back arrow and
		// the label in the room left.
		hookGame('DrawBackNextButton', 0, LOGO_FEATURE, (args, next) => {
			const [left, top, width, height, label] = args;
			if (!drawingWardrobe || !slotRow(top, label)) {
				return next(args);
			}
			const result = next([left, top, width, height, '', ...args.slice(5)]);
			const size = Math.round(height * 0.66);
			const x = left + 22;
			w.DrawImageResize(ICON, x, top + Math.round((height - size) / 2), size, size);
			// (the game's canvas is a script-level `let`, not a window property)
			const ctx = MainCanvas;
			const align = ctx.textAlign;
			ctx.textAlign = 'center';
			// (clear of the logo and of the next arrow, as the game keeps its labels)
			const textLeft = x + size + 4;
			const textRight = left + width - 24;
			w.DrawTextFit(label, (textLeft + textRight) / 2, top + height / 2 + 1, textRight - textLeft, 'Black');
			ctx.textAlign = align;
			return result;
		});
	}

	// ---- Settings (Preferences > Extensions), the SCE badge on item tiles, update notes and the update-ready notice
	const ICON = `${BASE}icon-64.png${FRESH}`;
	const SETTINGS_KEY = 'sce.settings';
	const SEEN_KEY = 'sce.notesSeen';
	/** The badge's name among the game's preview icons (drawn from Icons/Previews/<name>.png). */
	const BADGE = 'SCE';
	/** How often a newer published version is looked for. */
	const UPDATE_CHECK = 15 * 60 * 1000;
	/** @type {{ activities: boolean, restoreCrafts: boolean, updateReady: boolean, updateNotes: boolean, extraSlots: boolean, slotAddOnItems: boolean, tvs: boolean, tvsAsk: boolean, tvVolume: number }} */
	const settings = { activities: true, restoreCrafts: true, updateReady: true, updateNotes: true, extraSlots: true, slotAddOnItems: true, tvs: true, tvsAsk: true, tvVolume: 30 };
	/** The base TV volume's range and step (%), on the settings page. */
	const TV_VOLUME = { min: 0, max: 100, step: 10 };
	try {
		const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
		for (const k of /** @type {(keyof typeof settings)[]} */ (Object.keys(settings))) {
			if (typeof saved[k] === 'boolean' && typeof settings[k] === 'boolean') {
				settings[k] = saved[k];
			} else if (typeof saved[k] === 'number' && typeof settings[k] === 'number' && Number.isFinite(saved[k])) {
				settings[k] = Math.max(TV_VOLUME.min, Math.min(TV_VOLUME.max, saved[k]));
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
		// The canvas draws badges by their path in the game's folder (DrawPreviewIcons), where ours isn't: it gets ours.
		if (gameFunction('DrawGetImage')) {
			hookGame('DrawGetImage', 0, 'Badge', (args, next) =>
				typeof args[0] === 'string' && /^(?:\.\/)?Icons\/Previews\/SCE\.png$/.test(args[0]) ? next([ICON, ...args.slice(1)]) : next(args),
			);
		}
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
		const ROW = 66;
		/** @type {[string, keyof typeof settings, (keyof typeof settings)?][]} Label, setting, and the setting it sits under. */
		const boxes = [
			['Add the SCE activities to the activity menu', 'activities'],
			['Put dropped SCE crafts back by themselves (off: SCE asks first)', 'restoreCrafts'],
			['Tell me when an update is ready', 'updateReady'],
			['Show what is new after an update', 'updateNotes'],
			['Add the extra clothing slots (from the next reload)', 'extraSlots'],
			["With other add-ons' items in them too (from the next reload)", 'slotAddOnItems', 'extraSlots'],
		];
		/** A box's left edge: one under another is set in. */
		const boxLeft = (/** @type {any} */ under) => (under ? LEFT + 80 : LEFT);
		/** @type {[number, number, number, number]} Every TV (player) option on a page of its own. */
		const PLAYERS = [LEFT, TOP + boxes.length * ROW + 10, 520, 64];
		/** @type {[number, number, number, number]} The restore button, under the boxes and the status line. */
		const RESTORE = [LEFT, TOP + (boxes.length + 1) * ROW + 80, 640, 64];
		/** The Players page: its boxes (label, setting, the setting it sits under), the volume row and the resets. */
		const PLAYER_BOXES = /** @type {[string, keyof typeof settings, (keyof typeof settings)?][]} */ ([
			['Show TVs (off: no TV shows or plays for you)', 'tvs'],
			["Ask before other people's TVs play (off: see every TV)", 'tvsAsk', 'tvs'],
		]);
		const CHAT_BOX = TOP + 2 * ROW;
		const VOLUME_ROW = TOP + 3 * ROW + 10;
		/** @type {[string, string, string][]} The resets: label, what the count counts, what it does. */
		const RESETS = [
			['Forget my Always / Never choices', 'choices', 'forgetChoices'],
			["Put every person's TV back to the base volume", 'volumes', 'resetVolumes'],
			['Unmute the TVs I muted', 'muted', 'unmuteAll'],
			['Put the floating player and the chat width back', 'placed', 'resetPlaces'],
		];
		const resetBox = (/** @type {number} */ i) => /** @type {[number, number, number, number]} */ ([LEFT, TOP + 5 * ROW + i * (ROW + 6), 760, 60]);
		/** What the last reset did. */
		let playersSaid = '';
		/** @type {[number, number, number, number]} */
		const CLOTHES_LIST = [LEFT, RESTORE[1] + 90, 300, 64];
		/** @type {[number, number, number, number]} */
		const ACTIVITY_LIST = [LEFT + 340, RESTORE[1] + 90, 300, 64];
		/** @type {[number, number, number, number]} */
		const CONTRIBUTE = [LEFT + 680, RESTORE[1] + 90, 240, 64];
		/** @type {[number, number, number, number]} */
		const CREDITS = [LEFT + 940, RESTORE[1] + 90, 200, 64];
		/** @type {[number, number, number, number]} */
		const DEVS = [LEFT + 1160, RESTORE[1] + 90, 240, 64];
		/** @type {[number, number, number, number]} The base TV volume's buttons (their row is the TV line's). */
		const TV_LESS = [1480, 0, 64, 64];
		/** @type {[number, number, number, number]} */
		const TV_MORE = [1880, 0, 64, 64];
		/** @type {[number, number, number, number]} A small link to the repository, by the title. */
		const REPO = [1560, 95, 220, 56];
		/** @type {[number, number, number, number]} The contribute page's link to the guide. */
		const GUIDE = [LEFT, 680, 480, 64];
		/** What the last press of the restore button did. */
		let restoreSaid = '';
		/** @type {'main' | 'players' | 'clothes' | 'activities' | 'contribute' | 'credits' | 'devs'} The page shown: the
		 * settings, the players' options, a list or a small page. */
		let page = 'main';
		const mouseIn = (/** @type {number[]} */ r) => typeof w.MouseIn === 'function' && w.MouseIn(r[0], r[1], r[2], r[3]);
		/** The TV's own choices (tv.js), once it has loaded. */
		const tvPrefs = () => (w.SCETV && w.SCETV.prefs) || null;
		/** The Players page: every TV option in one place (the boombox's join it when it comes). */
		function drawPlayers() {
			const ctx = MainCanvas;
			w.DrawText('- Players: TVs -', LEFT, 125, 'Black', 'Gray');
			PLAYER_BOXES.forEach(([label, key, under], i) =>
				w.DrawCheckbox(boxLeft(under), TOP + i * ROW, 64, 64, label, settings[key], !!under && !settings[under]),
			);
			const prefs = tvPrefs();
			w.DrawCheckbox(LEFT, CHAT_BOX, 64, 64, "Show the room's chat beside a full-screen or floating TV", prefs ? prefs.chat() : true, !prefs);
			w.DrawTextFit("Base TV volume (until you move a TV's own slider)", LEFT, VOLUME_ROW + 32, TV_LESS[0] - LEFT - 30, 'Black', 'Gray');
			ctx.textAlign = 'center';
			w.DrawButton(TV_LESS[0], VOLUME_ROW, TV_LESS[2], TV_LESS[3], '−', settings.tvVolume > TV_VOLUME.min ? 'White' : '#bbb');
			w.DrawText(`${settings.tvVolume}%`, (TV_LESS[0] + TV_MORE[0] + TV_MORE[2]) / 2, VOLUME_ROW + 32, 'Black', 'Gray');
			w.DrawButton(TV_MORE[0], VOLUME_ROW, TV_MORE[2], TV_MORE[3], '+', settings.tvVolume < TV_VOLUME.max ? 'White' : '#bbb');
			const counts = prefs ? prefs.counts() : null;
			RESETS.forEach(([label, what], i) => {
				const n = counts ? counts[what] : 0;
				const text = typeof n === 'number' ? `${label} (${n})` : label;
				w.DrawButton(...resetBox(i), text, n ? 'White' : '#ddd');
			});
			ctx.textAlign = 'left';
			w.DrawText(playersSaid || 'All of these are kept in this browser, only for you.', LEFT, resetBox(RESETS.length)[1] + 30, 'Black', 'Gray');
		}
		function clickPlayers() {
			PLAYER_BOXES.forEach(([, key, under], i) => {
				if (!(under && !settings[under]) && mouseIn([boxLeft(under), TOP + i * ROW, 64, 64])) {
					settings[key] = !settings[key];
					saveSettings();
				}
			});
			const prefs = tvPrefs();
			if (prefs && mouseIn([LEFT, CHAT_BOX, 64, 64])) {
				prefs.setChat(!prefs.chat());
			}
			for (const [box, step] of /** @type {[number[], number][]} */ ([[TV_LESS, -TV_VOLUME.step], [TV_MORE, TV_VOLUME.step]])) {
				if (mouseIn([box[0], VOLUME_ROW, box[2], box[3]])) {
					settings.tvVolume = Math.max(TV_VOLUME.min, Math.min(TV_VOLUME.max, settings.tvVolume + step));
					saveSettings();
				}
			}
			RESETS.forEach(([label, what, act], i) => {
				const counts = prefs ? prefs.counts() : null;
				if (prefs && counts && counts[what] && mouseIn(resetBox(i))) {
					prefs[act]();
					playersSaid = `${label}: done.`;
				}
			});
		}
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
						if (page === 'contribute' || page === 'credits' || page === 'devs') {
							drawInfo(page);
							ctx.textAlign = 'center';
							if (page === 'contribute') {
								w.DrawButton(...GUIDE, 'Open the guide (GitHub)', 'White');
							} else if (page === 'devs') {
								w.DrawButton(...GUIDE, 'Open the repo page (GitHub)', 'White');
							}
							w.DrawButton(...EXIT, '', 'White', 'Icons/Exit.png');
							return;
						}
						if (page === 'players') {
							drawPlayers();
							ctx.textAlign = 'center';
							w.DrawButton(...EXIT, '', 'White', 'Icons/Exit.png');
							return;
						}
						if (page !== 'main') {
							drawList(page);
							ctx.textAlign = 'center';
							w.DrawButton(...EXIT, '', 'White', 'Icons/Exit.png');
							return;
						}
						w.DrawText(`- ${ADDON_NAME} - v${VERSION}`, LEFT, 125, 'Black', 'Gray');
						// (a box under another that is off is greyed out)
						boxes.forEach(([label, key, under], i) =>
							w.DrawCheckbox(boxLeft(under), TOP + i * ROW, 64, 64, label, settings[key], !!under && !settings[under]),
						);
						ctx.textAlign = 'center';
						w.DrawButton(...PLAYERS, `📺 Players: TV options${settings.tvs ? '' : ' (TVs off)'}`, 'White');
						ctx.textAlign = 'left';
						const off = [...problems.keys()];
						// (fitted, and the first few named: items left out of the slots each have their own entry)
						const named = off.length > 4 ? `${off.slice(0, 4).join(', ')} and ${off.length - 4} more` : off.join(', ');
						w.DrawTextFit(
							off.length ? `Switched off this session: ${named}` : 'Everything is working.',
							LEFT,
							TOP + (boxes.length + 1) * ROW + 40,
							1400,
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
						w.DrawButton(...CONTRIBUTE, 'Contribute', 'White');
						w.DrawButton(...CREDITS, 'Credits', 'White');
						w.DrawButton(...DEVS, 'To BC devs', 'White');
						w.DrawButton(...REPO, 'Repo page', 'White');
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
						if ((page === 'contribute' || page === 'devs') && mouseIn(GUIDE)) {
							openPage(page === 'contribute' ? `${REPO_URL}/blob/main/CONTRIBUTING.md` : REPO_URL);
							return;
						}
						if (page === 'players') {
							clickPlayers();
							return;
						}
						if (page !== 'main') {
							return;
						}
						if (mouseIn(REPO)) {
							openPage(REPO_URL);
							return;
						}
						if (mouseIn(CONTRIBUTE)) {
							page = 'contribute';
							return;
						}
						if (mouseIn(CREDITS)) {
							page = 'credits';
							return;
						}
						if (mouseIn(DEVS)) {
							page = 'devs';
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
						if (mouseIn(PLAYERS)) {
							page = 'players';
							playersSaid = '';
							return;
						}
						if (mouseIn(RESTORE)) {
							const back = putBack();
							restoreSaid = back.length ? `Put back: ${back.join(', ')}` : 'Nothing was missing that you may put on now.';
							return;
						}
						boxes.forEach(([, key, under], i) => {
							if (!(under && !settings[under]) && mouseIn([boxLeft(under), TOP + i * ROW, 64, 64])) {
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

	const REPO_URL = 'https://github.com/Proudkiller0015/sce';

	/** Opens a page of SCE's repository in a new tab. */
	function openPage(/** @type {string} */ url) {
		w.open(url, '_blank', 'noopener');
	}

	/** The settings' small pages, drawn left-aligned under the title: how to contribute, the credits, and a word to
	 * the game's developers. */
	function drawInfo(/** @type {'contribute' | 'credits' | 'devs'} */ which) {
		const pages = {
			contribute: [
				'- Contribute to SCE -',
				'',
				'SCE is open to contributors: new clothes, activities and fixes are welcome.',
				'Everything in SCE is free for everyone, and stays that way.',
				'How to take part, the rules and the checklist are in the guide on GitHub.',
				'Items that suit the game may join Bondage Club itself, unless you ask otherwise.',
				'AI-assisted work must be labelled, and carries an AI mark in the wardrobe.',
			],
			credits: ['- Credits -', '', `${ADDON_NAME} is made by SlimeQueenSamantha.`],
			devs: [
				'- To the BC devs -',
				'',
				"SCE adds its clothes, activities and slots with the game's own functions.",
				'Every hook goes through bcModSdk and is guarded: a feature that meets',
				"a game it doesn't expect switches itself off, and the game carries on.",
				"It never changes the game's items or groups (ours: Slime..., ..._SCE).",
				'Vanilla-friendly SCE items are meant to be merged into the game down the line.',
				'Each release is tested with Echo, WCE, BCX, MBS and AEE, both load orders.',
				'Trouble after a game update? Open a GitHub issue or contact Proudkiller0015.',
			],
		};
		const lines = pages[which];
		lines.forEach((line, i) => line && w.DrawTextFit(line, 500, 125 + i * 60, 1300, 'Black', 'Gray'));
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
	// it drops them as unknown. SCE keeps a copy of the SCE clothes you wear (and of whatever is in the extra slots) in
	// your account's add-on settings and puts back what is missing once its clothes are in, into empty slots only.
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
	const isOurCraft = (/** @type {any} */ c) => !!c && typeof c.Item === 'string' && !!pieceNamed(c.Item);
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
	/** Saves a copy of the SCE clothes you wear and what is in the extra slots, when it changed. */
	function saveOutfit() {
		const p = w.Player;
		if (!p || !p.MemberNumber || restoredFor !== p.MemberNumber || !p.ExtensionSettings || !Array.isArray(p.Appearance)) {
			return;
		}
		const worn = p.Appearance.filter((/** @type {any} */ i) => i && keptBySce(i.Asset)).map((/** @type {any} */ i) => ({
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
	 * Puts back saved SCE clothes (and extra-slot items) the outfit is missing, into empty slots that aren't blocked.
	 * Returns their names.
	 * @returns {string[]}
	 */
	function restoreOutfit() {
		const p = w.Player;
		const back = [];
		for (const s of savedOutfit()) {
			const asset = w.AssetGet('Female3DCG', s.Group, s.Name);
			if (!asset || !keptBySce(asset) || w.InventoryGet(p, s.Group)) {
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
			back.push(craft.Name || pieceNamed(craft.Item).description);
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

	/**
	 * The activities live in activities.js and the TV in tv.js, next to this script; they use the hooks above
	 * (window.SCE.kit).
	 */
	function loadScript(/** @type {string} */ file, /** @type {string} */ feature) {
		try {
			const script = document.createElement('script');
			script.src = `${BASE}${file}${FRESH}`;
			script.crossOrigin = 'anonymous';
			script.onerror = () => problem(feature, `${file} did not load`);
			document.head.appendChild(script);
		} catch (e) {
			problem(feature, e);
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
		slots: slotGroups,
		putBack: () => (working('Restore') ? putBack() : []),
		kit: { hookGame, problem, working, gameFunction, settings, saveSettings, toast, itemMenus, ICON, ADDON_NAME, base: BASE, preview: (/** @type {string} */ name) => `${CLOTHES}preview/${name}.png${FRESH}` },
	};
	start();
	startExtras();
	loadScript('activities.js', 'Activities');
	loadScript('tv.js', 'TV');
})();
