// Builds the add-on's clothes from a drawings' output folder.
//   node tools/build-clothes.js [path/to/art/out]
// The folder holds pieces.json and <Group>/<Asset>_<Layer>.png, plus preview-<Asset>.png. pieces.json:
//   { "pieces": [ { Name, Group, Description, Priority, Layer: [{ Name, Left, Top, Color, Priority?, AllowColorize? }],
//                   Options? | Modules?, Hide?, Fits? } ],
//     "outfits": { "<Id>": { Description, Items: [{ Group, Name, Color }] } } }
// Layers sit at Left/Top on the game's 500 x 1000 character canvas. "Fits" lists the poses (of those the piece's group
// draws differently) where the standing pictures still sit right; in the others the piece hides until it has pictures.
// It writes:
//   clothes/clothes.json   the pieces: asset definitions, extended item configs, texts, the image list, the outfits
//   clothes/img/           the layer images, as <Group>/<Asset>_<Layer>.png
//   clothes/preview/       each piece's tile picture
// Run it again whenever the drawings change; files no longer used are removed.
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const SRC = path.resolve(process.argv[2] || path.join(REPO, 'art', 'out'));
const OUT = path.join(REPO, 'clothes');
/** Asset names: pick a prefix once the add-on has a name, so ours never clash with the game's or another add-on's. */
const NAME = /^[A-Z][A-Za-z0-9]+$/;
const LAYER = /^[A-Za-z0-9]+$/;
const COLOR = /^#[0-9A-Fa-f]{6}$/;

const fail = (/** @type {string} */ why) => {
	throw new Error(why);
};
const source = JSON.parse(fs.readFileSync(path.join(SRC, 'pieces.json'), 'utf8'));
if (!Array.isArray(source.pieces)) {
	fail('pieces.json needs "pieces"');
}

/** @type {Set<string>} Files written, relative to clothes/. */
const written = new Set();
/** @type {string[]} */
const changed = [];
function copy(/** @type {string} */ from, /** @type {string} */ to) {
	const data = fs.readFileSync(from);
	if (data.subarray(1, 4).toString() !== 'PNG') {
		fail(`${from} is not a PNG`);
	}
	const target = path.join(OUT, to);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	if (!fs.existsSync(target) || !fs.readFileSync(target).equals(data)) {
		fs.writeFileSync(target, data);
		changed.push(to);
	}
	written.add(to.split(path.sep).join('/'));
}

/**
 * The item's default colours in the game's order: one per colour button, numbered by first appearance in the layer
 * list, where a layer with CopyLayerColor counts as the layer it copies.
 * @param {{ layer: any, color: string }[]} layers
 */
function defaultColors(layers) {
	/** @type {Map<string, string>} */
	const byKey = new Map();
	const own = new Map(layers.filter((x) => !x.layer.CopyLayerColor).map((x) => [x.layer.Name, x.color]));
	for (const x of layers) {
		if (!x.layer.AllowColorize) {
			continue;
		}
		const key = x.layer.CopyLayerColor || x.layer.Name;
		if (!byKey.has(key)) {
			byKey.set(key, own.get(key) || x.color);
		}
	}
	return [...byKey.values()];
}

const names = new Set();
const pieces = source.pieces.map((/** @type {any} */ p) => {
	if (!NAME.test(p.Name) || !LAYER.test(p.Group || '') || !Array.isArray(p.Layer) || !p.Layer.length) {
		fail(`piece ${p.Name}: needs a name, a clothing group and layers`);
	}
	if (names.has(p.Name)) {
		fail(`piece ${p.Name}: the name is used twice`);
	}
	names.add(p.Name);
	// A piece's choices: "Options" (one list: a typed item) or "Modules" (several lists, each with its options: a modular
	// item). An option may hide body groups ("Hide") and the piece's own layers ("HideLayers": names or their starts).
	const options = Array.isArray(p.Options) ? p.Options : [];
	const modules = Array.isArray(p.Modules) ? p.Modules : [];
	if (options.length && modules.length) {
		fail(`piece ${p.Name}: Options or Modules, not both`);
	}
	/** Every list of choices: [its key in AllowTypes, its options]. */
	const lists = options.length ? [['typed', options]] : modules.map((/** @type {any} */ m) => [m.Key || m.Name, m.Options || []]);
	if (modules.some((/** @type {any} */ m) => !LAYER.test(m.Name) || (m.Key && !/^[a-z]+$/.test(m.Key)) || !Array.isArray(m.Options) || !m.Options.length)) {
		fail(`piece ${p.Name}: each module needs a name and options`);
	}
	/** The options of a list in which a layer shows: all but those whose HideLayers names it (or its start). */
	const shownIn = (/** @type {any[]} */ list, /** @type {string} */ layer) =>
		list
			.map((o, i) => [o, i])
			.filter(([o]) => !(o.HideLayers || []).some((/** @type {string} */ h) => layer.startsWith(h)))
			.map(([, i]) => i);
	const layers = p.Layer.map((/** @type {any} */ l) => {
		if (!LAYER.test(l.Name) || !Number.isFinite(l.Left) || !Number.isFinite(l.Top) || !COLOR.test(l.Color || '')) {
			fail(`piece ${p.Name}, layer ${l.Name}: needs a name, Left, Top and a #rrggbb colour`);
		}
		// The layer's pictures: <Asset>_<Layer>.png, or one per option when the layer has CreateLayerTypes
		// (<Asset>_s1p3_<Layer>.png), standing in <Group>/ and in a pose's folder <Group>/<Pose>/.
		const types = Array.isArray(l.CreateLayerTypes) ? l.CreateLayerTypes : [];
		if (types.some((/** @type {string} */ t) => !/^[a-z]+$/.test(t))) {
			fail(`piece ${p.Name}, layer ${l.Name}: CreateLayerTypes are module keys`);
		}
		// A layer with a ParentGroup (BodyUpper / BodyLower) has one picture per body size: <Asset>_<Size>_..._<Layer>.png
		const parent = l.ParentGroup || '';
		if (parent && !['BodyUpper', 'BodyLower'].includes(parent)) {
			fail(`piece ${p.Name}, layer ${l.Name}: ParentGroup is BodyUpper or BodyLower`);
		}
		const size = parent ? '_[A-Za-z]+' : '';
		const file = new RegExp(`^${p.Name}${size}${types.length ? `_${types.map((t) => `${t}\\d+`).join('')}` : ''}_${l.Name}\\.png$`);
		const groupDir = path.join(SRC, p.Group);
		const dirs = ['', ...fs.readdirSync(groupDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)];
		let found = 0;
		for (const dir of dirs) {
			for (const f of fs.readdirSync(path.join(groupDir, dir)).filter((n) => file.test(n))) {
				copy(path.join(groupDir, dir, f), path.join('img', p.Group, dir, f));
				found++;
			}
		}
		if (!found) {
			fail(`piece ${p.Name}, layer ${l.Name}: no pictures`);
		}
		/** @type {Record<string, any>} */
		const layer = { Name: l.Name, Left: l.Left, Top: l.Top, Priority: l.Priority ?? p.Priority, ParentGroup: parent };
		if (types.length) {
			layer.CreateLayerTypes = types;
		}
		// Layers with the same ColorGroup share one row in the colour screen.
		if (l.ColorGroup) {
			if (!LAYER.test(l.ColorGroup)) {
				fail(`piece ${p.Name}, layer ${l.Name}: ColorGroup is a name`);
			}
			layer.ColorGroup = l.ColorGroup;
		}
		layer.AllowColorize = l.AllowColorize !== false;
		// The game takes a layer's default colour from the layer (older versions from the item's DefaultColor).
		if (layer.AllowColorize) {
			layer.Color = [l.Color];
		}
		// A layer that takes another layer's colour (one colour button for both).
		if (l.CopyLayerColor) {
			if (!p.Layer.some((/** @type {any} */ o) => o.Name === l.CopyLayerColor && !o.CopyLayerColor)) {
				fail(`piece ${p.Name}, layer ${l.Name}: CopyLayerColor names no layer of its own colour`);
			}
			layer.CopyLayerColor = l.CopyLayerColor;
		}
		/** @type {Record<string, number[]>} The layer's own AllowTypes (module key: options it shows in), then HideLayers. */
		const allow = { ...(l.AllowTypes || {}) };
		for (const [k, list] of lists) {
			if (allow[k]) {
				continue;
			}
			const shown = shownIn(list, l.Name);
			if (shown.length < list.length) {
				allow[k] = shown;
			}
		}
		if (Object.keys(allow).length) {
			layer.AllowTypes = allow;
		}
		return { layer, color: l.Color };
	});
	const preview = path.join(SRC, `preview-${p.Name}.png`);
	if (fs.existsSync(preview)) {
		copy(preview, path.join('preview', `${p.Name}.png`));
	}
	// A piece with options hides only through them.
	const hide = lists.length ? [] : Array.isArray(p.Hide) ? p.Hide : [];
	const def = {
		Name: p.Name,
		ParentGroup: '',
		Priority: p.Priority,
		Value: 0,
		Hide: hide,
		DefaultColor: defaultColors(layers),
		Layer: layers.map((/** @type {any} */ x) => x.layer),
	};
	if (!def.DefaultColor.length) {
		delete def.DefaultColor;
	}
	const key = `${p.Group}${p.Name}`;
	/** @type {Record<string, string>} */
	const texts = {};
	/** An option in the game's form: its body groups to hide, if any. */
	const asOption = (/** @type {any} */ o) => (Array.isArray(o.Hide) && o.Hide.length ? { Property: { Hide: o.Hide } } : {});
	/** "NeckCover" → "Neck cover". */
	const words = (/** @type {string} */ name) => {
		const t = String(name).replace(/([a-z])([A-Z])/g, '$1 $2');
		return t.charAt(0) + t.slice(1).toLowerCase();
	};
	let extended = null;
	if (modules.length) {
		extended = {
			Archetype: 'modular',
			Modules: modules.map((/** @type {any} */ m) => ({ Name: m.Name, Key: m.Key || m.Name, Options: m.Options.map(asOption), DrawImages: false })),
		};
		texts[`${key}SelectBase`] = `${p.Description}: choose how it is worn.`;
		for (const m of modules) {
			texts[`${key}Module${m.Name}`] = m.Text || words(m.Name);
			texts[`${key}Select${m.Name}`] = `Select ${(m.Text || words(m.Name)).toLowerCase()}`;
			m.Options.forEach((/** @type {any} */ o, /** @type {number} */ i) => {
				// The game names a module's options <Key><index> ("l1").
				texts[`${key}Option${m.Key || m.Name}${i}`] = o.Text || words(o.Name);
			});
		}
	}
	if (options.length) {
		extended = { Archetype: 'typed', Options: options.map((/** @type {any} */ o) => ({ Name: o.Name, ...asOption(o) })) };
		texts[`${key}Select`] = `${p.Description}: choose how it is worn.`;
		for (const o of options) {
			texts[`${key}${o.Name}`] = o.Text || words(o.Name);
		}
	}
	const fits = Array.isArray(p.Fits) ? p.Fits.filter((/** @type {any} */ f) => LAYER.test(f)) : [];
	/** @type {Record<string, string>} Layer names in the colour screen, by the game's key <Group><Asset><Layer>. */
	const layerNames = Object.fromEntries(p.Layer.map((/** @type {any} */ l) => [`${p.Group}${p.Name}${l.Name}`, l.Text || words(l.Name)]));
	/** @type {Record<string, string>} Colour group rows' names, by <Group><Asset><ColorGroup>. */
	const groupNames = Object.fromEntries(
		p.Layer.filter((/** @type {any} */ l) => l.ColorGroup).map((/** @type {any} */ l) => [`${p.Group}${p.Name}${l.ColorGroup}`, words(l.ColorGroup)]),
	);
	/** Older colour orders by their length: { "9": [colour key per index] }, so colours saved then can be mapped by part. */
	const colorHistory = p.ColorHistory && typeof p.ColorHistory === 'object' ? p.ColorHistory : {};
	return { name: p.Name, group: p.Group, description: p.Description, def, extended, texts, layerNames, groupNames, colorHistory, fits };
});

const images = [...written].filter((f) => f.startsWith('img/')).sort();
// Outfits: complete fits worn in one go from the wardrobe, and each of their items on its own. Each item names a group,
// an asset (the game's own or one of the pieces) and its colours (one, or one per layer).
const outfits = source.outfits || {};
for (const [id, u] of Object.entries(outfits)) {
	const bad = !LAYER.test(id) || !u.Description || !Array.isArray(u.Items) || !u.Items.length;
	const badItem = (u.Items || []).find(
		(/** @type {any} */ x) =>
			!LAYER.test(x.Group || '') ||
			!LAYER.test(x.Name || '') ||
			!(COLOR.test(x.Color) || (Array.isArray(x.Color) && x.Color.every((/** @type {string} */ c) => COLOR.test(c)))),
	);
	if (bad || badItem) {
		fail(`outfit ${id}: needs a description and items with a group, a name and colours (${JSON.stringify(badItem || id)})`);
	}
}
const json = `${JSON.stringify({ pieces, images, outfits }, null, '\t')}\n`;
const target = path.join(OUT, 'clothes.json');
if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== json) {
	fs.mkdirSync(OUT, { recursive: true });
	fs.writeFileSync(target, json);
	changed.push('clothes.json');
}
written.add('clothes.json');
// Files from an older build that no piece uses any more, then folders left empty.
const walk = (/** @type {string} */ dir) =>
	fs.existsSync(dir)
		? fs
				.readdirSync(dir, { withFileTypes: true })
				.flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
		: [];
for (const f of walk(OUT)) {
	const rel = path.relative(OUT, f).split(path.sep).join('/');
	if (!written.has(rel)) {
		fs.rmSync(f);
		changed.push(`-${rel}`);
	}
}
for (const dir of fs.existsSync(path.join(OUT, 'img')) ? fs.readdirSync(path.join(OUT, 'img')) : []) {
	const full = path.join(OUT, 'img', dir);
	if (fs.statSync(full).isDirectory() && !fs.readdirSync(full).length) {
		fs.rmdirSync(full);
	}
}
console.log(`${pieces.length} pieces, ${images.length} images; ${changed.length ? `${changed.length} files changed` : 'nothing changed'}`);
