// Slime Clothing Extension (SCE): a Bondage Club clothing add-on, Echo-style. It adds its own clothes to the game's
// clothing groups, with their pictures and texts, and a row at the end of the wardrobe that puts on its outfits in one
// go. The clothes are listed in clothes/clothes.json, built by tools/build-clothes.js. Pictures are fetched with the
// add-on's VERSION: raise it whenever pictures change, or players keep cached old ones.
//
// Every game hook goes through guard(): a feature that meets a game it doesn't expect is switched off for the session
// and the game's own code runs untouched. It never throws into the game.
(() => {
	'use strict';
	/** @type {any} */
	const w = window;
	/** The add-on's id (its OnlineSharedSettings key and mod SDK name) and the name players see. Change both when it is named. */
	const ADDON_ID = 'SCE';
	const ADDON_NAME = 'Slime Clothing Extension';
	const VERSION = '0.1.0';
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
			mod = w.bcModSdk.registerMod({ name: ADDON_ID, fullName: ADDON_NAME, version: VERSION });
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
		if (!hookPictures()) {
			return;
		}
		hookGame('AssetTextGet', 0, 'Clothes texts', (args, next) =>
			typeof args[0] === 'string' && texts.has(args[0]) ? texts.get(args[0]) : next(args),
		);
		for (const piece of data.pieces) {
			const group = w.AssetGroupGet('Female3DCG', piece.group);
			const groupDef = w.AssetFemale3DCG.find((/** @type {any} */ g) => g && g.Group === piece.group);
			if (!group || !groupDef || !Array.isArray(group.Asset)) {
				throw new Error(`the game has no ${piece.group} group as expected`);
			}
			if (w.AssetGet('Female3DCG', piece.group, piece.name)) {
				continue;
			}
			try {
				w.AssetAdd(
					group,
					standingOnly(piece.def, group, piece.fits || []),
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
		}
		hookOutfits(data.outfits || {});
		hookGame('ValidationResolveRemoveDiff', 0, 'Keeping the clothes on', keepOnRemove);
	}
	/**
	 * The piece's definition for this game: drawn in the standing pictures, in every pose its group draws the same and
	 * in those of the others where they still fit (`fits`); hidden in the rest, whose pictures aren't made yet.
	 * @param {any} source
	 * @param {any} group the game's group (its pose mapping: how it draws in each pose)
	 * @param {string[]} fits
	 */
	function standingOnly(source, group, fits) {
		const def = JSON.parse(JSON.stringify(source));
		const poses = (group && group.PoseMapping) || {};
		def.PoseMapping = Object.fromEntries(
			Object.entries(poses)
				.filter(([, v]) => v !== '')
				.map(([pose]) => [pose, fits.includes(pose) ? '' : 'Hide']),
		);
		return def;
	}
	/** The extended item config, sending no message of the game's own when the option changes (it has no text for ours). */
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

	/** The add-on's address for one of the game's picture paths, or '' when it isn't one of ours. */
	function picture(/** @type {string} */ url) {
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
		const ok = hookGame('CommonFetch', 10, FEATURE, (args, next) => {
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
				options.image ??= `${CLOTHES}preview/${asset.Name}.png`;
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
		const [previous, params] = args;
		const c = params && params.C;
		if (
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

	/** For the console and tests: what is registered, and which features were switched off. */
	w.SCE = { version: VERSION, pieces, problems, outfits: () => outfitChoices };
	start();
})();
