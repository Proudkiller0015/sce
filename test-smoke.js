// Smoke test: loads sce.js into a clean copy of the game (no login) and checks that it registers a piece, sends the
// game's picture requests to the add-on's copies, and switches nothing off; then that an empty list is harmless.
//   BC_ROOT=<BondageClub folder> CHROME=<chrome.exe> node test-smoke.js
// Uses puppeteer-core (installed, or the path in PUPPETEER).
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const { BC_ROOT, CHROME } = process.env;
if (!BC_ROOT || !CHROME) {
	console.log('Set BC_ROOT (a Bondage Club checkout: its BondageClub folder) and CHROME (the Chrome executable).');
	process.exit(2);
}
let failed = 0;
const check = (/** @type {string} */ what, /** @type {boolean} */ ok, /** @type {any} */ got) => {
	console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${ok ? '' : ` ${JSON.stringify(got)}`}`);
	if (!ok) failed++;
};

// A throwaway add-on folder: sce.js plus a clothes list with one test piece (a 1x1 PNG layer) or none.
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
	'base64',
);
function addonDir(/** @type {boolean} */ withPiece) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sce-'));
	fs.copyFileSync(path.join(__dirname, 'sce.js'), path.join(dir, 'sce.js'));
	fs.copyFileSync(path.join(__dirname, 'icon-64.png'), path.join(dir, 'icon-64.png'));
	fs.mkdirSync(path.join(dir, 'clothes', 'img', 'Hat'), { recursive: true });
	fs.mkdirSync(path.join(dir, 'clothes', 'preview'), { recursive: true });
	const pieces = [];
	const images = [];
	if (withPiece) {
		fs.writeFileSync(path.join(dir, 'clothes', 'img', 'Hat', 'SmokeTestCap_Main.png'), PNG);
		fs.writeFileSync(path.join(dir, 'clothes', 'preview', 'SmokeTestCap.png'), PNG);
		images.push('img/Hat/SmokeTestCap_Main.png');
		pieces.push({
			name: 'SmokeTestCap',
			group: 'Hat',
			description: 'Smoke test cap',
			def: {
				Name: 'SmokeTestCap',
				ParentGroup: '',
				Priority: 50,
				Value: 0,
				Hide: [],
				DefaultColor: ['#808080'],
				Layer: [{ Name: 'Main', Left: 200, Top: 0, Priority: 50, ParentGroup: '', AllowColorize: true, Color: ['#808080'] }],
			},
			extended: null,
			texts: {},
			layerNames: { HatSmokeTestCapMain: 'Cap band' },
			fits: [],
		});
	}
	const outfits = withPiece ? { Smoke: { Description: 'Smoke outfit', Items: [{ Group: 'Hat', Name: 'SmokeTestCap', Color: '#ff0000' }] } } : {};
	fs.writeFileSync(path.join(dir, 'clothes', 'clothes.json'), JSON.stringify({ pieces, images, outfits }));
	return dir;
}

/** Serves the game at / and the add-on folder at /addon/. */
function serve(/** @type {string} */ addon) {
	const types = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.html': 'text/html', '.css': 'text/css' };
	const server = http.createServer((req, res) => {
		const url = decodeURIComponent((req.url || '/').split('?')[0]);
		const file = url.startsWith('/addon/') ? path.join(addon, url.slice(7)) : path.join(BC_ROOT, url === '/' ? 'index.html' : url);
		fs.readFile(file, (err, data) => {
			if (err) {
				res.writeHead(404);
				res.end();
				return;
			}
			res.writeHead(200, { 'Content-Type': types[/** @type {keyof typeof types} */ (path.extname(file))] || 'application/octet-stream' });
			res.end(data);
		});
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function run(/** @type {any} */ browser, /** @type {boolean} */ withPiece) {
	const dir = addonDir(withPiece);
	/** @type {any} */
	const server = await serve(dir);
	const base = `http://127.0.0.1:${server.address().port}`;
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => Array.isArray(window.Asset) && window.Asset.length > 100 && window.bcModSdk, { timeout: 60000 });
	await page.evaluate((b) => {
		window.SCEBase = `${b}/addon/`;
		const s = document.createElement('script');
		s.src = `${b}/addon/sce.js`;
		document.head.appendChild(s);
	}, base);
	await page.waitForFunction(() => window.SCE, { timeout: 20000 });
	await new Promise((r) => setTimeout(r, 1500));
	const got = await page.evaluate(async () => {
		const a = AssetGet('Female3DCG', 'Hat', 'SmokeTestCap');
		let picture = null;
		if (a) {
			const res = await CommonFetch('Assets/Female3DCG/Hat/SmokeTestCap_Main.png');
			picture = { ok: res.ok, url: res.url };
		}
		return {
			registered: !!a,
			description: a && a.Description,
			picture,
			problems: [...window.SCE.problems],
			outfits: window.SCE.outfits().map((o) => o.label),
			gameCap: !!AssetGet('Female3DCG', 'Hat', 'Beret1'),
			badge: a ? DialogGetAssetIcons(a) : [],
			gameBadge: DialogGetAssetIcons(AssetGet('Female3DCG', 'Hat', 'Beret1')),
			badgeText: InterfaceTextGet('PreviewIconSCE'),
			badgePicture: (await CommonFetch('Icons/Previews/SCE.png')).url,
		};
	});
	// Logged in: the settings page is registered.
	await page.evaluate(() => {
		Player.MemberNumber = 1;
	});
	await new Promise((r) => setTimeout(r, 1500));
	const settingsPage = await page.evaluate(() => typeof PreferenceExtensionsSettings === 'object' && !!PreferenceExtensionsSettings.SCE);
	// The colour screen names our layers.
	const layerName = withPiece
		? await page.evaluate(async () => {
				const C = CharacterLoadSimple('SmokeTest');
				CharacterAppearanceSetDefault(C);
				InventoryWear(C, 'SmokeTestCap', 'Hat');
				await ItemColorLoad(C, InventoryGet(C, 'Hat'), 1200, 25, 775, 950);
				return ItemColorLayerNames.get('HatSmokeTestCapMain');
			})
		: '';
	if (withPiece) {
		check('the test piece is registered with its name', got.registered && got.description === 'Smoke test cap', got);
		check("the game's picture request goes to the add-on's copy", !!got.picture && got.picture.ok && /\/addon\/clothes\/img\/Hat\/SmokeTestCap_Main\.png/.test(got.picture.url), got.picture);
		check("our piece carries the SCE badge, the game's own items do not", got.badge.includes('SCE') && !got.gameBadge.includes('SCE'), got);
		check('the badge has its hover text and picture', got.badgeText === 'Slime Clothing Extension' && /\/addon\/icon-64\.png/.test(got.badgePicture), got);
		check('once logged in, the settings page is in Preferences > Extensions', settingsPage, settingsPage);
		check('the colour screen shows our layer names', layerName === 'Cap band', layerName);
		check('its outfit is offered whole and by item', got.outfits.join('|') === 'Smoke outfit (full outfit)|Smoke outfit: Smoke test cap', got.outfits);
	} else {
		check('with no clothes nothing is registered', !got.registered && got.outfits.length === 0, got);
	}
	check("the game's own clothes are untouched", got.gameCap, got);
	check('nothing switched off', got.problems.length === 0, got.problems);
	check('no page errors', errors.length === 0, errors);
	await page.close();
	server.close();
	fs.rmSync(dir, { recursive: true, force: true });
}

(async () => {
	const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
	try {
		await run(browser, true);
		await run(browser, false);
	} finally {
		await browser.close();
	}
	console.log(failed ? `${failed} FAILED` : 'All checks passed');
	process.exit(failed ? 1 : 0);
})();
