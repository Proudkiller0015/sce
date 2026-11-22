// Craft protection test: loads sce.js into a clean copy of the game with one test item (in an item group, so it can be
// crafted), makes a craft of it, then has the game drop it the way it does when SCE loads after the login, and checks
// that SCE puts it back: by itself, and with the settings button when the restoreCrafts setting is off. Nothing is
// sent anywhere: the game's server calls are stubbed.
//   BC_ROOT=<BondageClub folder> CHROME=<chrome.exe> node test-crafts.js
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

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
	'base64',
);
/** A throwaway add-on folder: sce.js plus a clothes list with one craftable test item. */
function addonDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sce-crafts-'));
	for (const f of ['sce.js', 'activities.js', 'icon-64.png']) {
		fs.copyFileSync(path.join(__dirname, f), path.join(dir, f));
	}
	fs.mkdirSync(path.join(dir, 'clothes', 'img', 'ItemArms'), { recursive: true });
	fs.mkdirSync(path.join(dir, 'clothes', 'preview'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'clothes', 'img', 'ItemArms', 'CraftTestCuffs_Main.png'), PNG);
	fs.writeFileSync(path.join(dir, 'clothes', 'preview', 'CraftTestCuffs.png'), PNG);
	const piece = {
		name: 'CraftTestCuffs',
		group: 'ItemArms',
		description: 'Craft test cuffs',
		def: {
			Name: 'CraftTestCuffs',
			Priority: 30,
			Value: 0,
			DefaultColor: ['#808080'],
			Layer: [{ Name: 'Main', Left: 0, Top: 0, AllowColorize: true }],
		},
		extended: null,
		texts: {},
		layerNames: {},
		fits: [],
	};
	fs.writeFileSync(path.join(dir, 'clothes', 'clothes.json'), JSON.stringify({ pieces: [piece], images: ['img/ItemArms/CraftTestCuffs_Main.png'], outfits: {} }));
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

(async () => {
	const dir = addonDir();
	/** @type {any} */
	const server = await serve(dir);
	const base = `http://127.0.0.1:${server.address().port}`;
	const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 4).join(' | ')));
	await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => Array.isArray(window.Asset) && window.Asset.length > 100 && window.bcModSdk && window.Player, { timeout: 60000 });
	// A logged-in player, without a server: what the game sends goes nowhere, crafts saved are kept for the test.
	await page.evaluate(() => {
		window.ServerSend = () => {};
		window.ServerPlayerExtensionSettingsSync = () => {};
		window.ServerAccountUpdate = { QueueData: (data) => (window.savedCrafting = data.Crafting) };
		Player.MemberNumber = 1;
		Player.ExtensionSettings = {};
		Player.Crafting = [];
		CharacterAppearanceSetDefault(Player);
	});
	await page.evaluate((b) => {
		window.SCEBase = `${b}/addon/`;
		const s = document.createElement('script');
		s.src = `${b}/addon/sce.js`;
		document.head.appendChild(s);
	}, base);
	await page.waitForFunction(() => window.SCE && AssetGet('Female3DCG', 'ItemArms', 'CraftTestCuffs'), { timeout: 20000 });
	await new Promise((r) => setTimeout(r, 1500));

	const got = await page.evaluate(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const copy = () => JSON.parse(Player.ExtensionSettings.SCE || '{}').crafts || [];
		const ours = { Item: 'CraftTestCuffs', Name: 'Pink cuffs', Description: 'A test', Color: '#ff00ff', Private: false, Lock: '', Property: undefined, ItemProperty: {}, TypeRecord: null, Effects: {} };
		const game = { Item: 'HempRope', Name: 'Game rope', Description: '', Color: '', Private: false, Lock: '', ItemProperty: {}, TypeRecord: null, Effects: {} };
		const r = { craftable: !!CraftingAssets.CraftTestCuffs };
		// 1. A craft is made: the copy keeps SCE's craft (only).
		Player.Crafting = [game, ours];
		CraftingSaveServer();
		r.copied = copy().map((c) => c.slot);
		// 2. Next login, SCE loaded late: the game dropped the craft (an empty slot) and erased it from the account.
		// (a new login: SCE hasn't checked it yet when the game drops the craft and saves, as when SCE loads late)
		const dropAndLogin = async (member) => {
			Player.MemberNumber = member;
			Player.Crafting = [game, null];
			CraftingSaveServer();
			await wait(1600);
		};
		await dropAndLogin(2);
		r.autoBack = Player.Crafting[1] && Player.Crafting[1].Name;
		r.copyAfterAuto = copy().length;
		// 3. With restoreCrafts off: not put back, but the copy keeps it, through more saves of the game's.
		window.SCE.settings.restoreCrafts = false;
		await dropAndLogin(3);
		r.offStaysOut = !Player.Crafting[1];
		Player.Crafting.push({ ...game, Name: 'Another rope' });
		CraftingSaveServer();
		r.copyKeptWhileOff = copy().length;
		// ... and the settings button puts it back, into an empty slot.
		r.button = window.SCE.putBack();
		r.buttonBack = Player.Crafting.filter((c) => c && c.Item === 'CraftTestCuffs').length;
		r.copyAfterButton = copy().length;
		// 4. Deleting the craft while SCE runs is a real delete: the copy lets it go.
		window.SCE.settings.restoreCrafts = true;
		Player.Crafting = Player.Crafting.map((c) => (c && c.Item === 'CraftTestCuffs' ? null : c));
		CraftingSaveServer();
		r.copyAfterDelete = copy().length;
		r.problems = [...window.SCE.problems];
		return r;
	});
	check('the test item can be crafted', got.craftable, got);
	check('the copy keeps the SCE craft only', JSON.stringify(got.copied) === '[1]', got.copied);
	check('a dropped craft comes back by itself', got.autoBack === 'Pink cuffs', got);
	check('the copy still has it', got.copyAfterAuto === 1, got);
	check('setting off: not put back by itself', got.offStaysOut, got);
	check('setting off: the copy keeps it through the game saving crafts', got.copyKeptWhileOff === 1, got);
	check('the settings button puts it back', got.button.includes('Pink cuffs') && got.buttonBack === 1, got);
	check('the copy keeps it after the button', got.copyAfterButton === 1, got);
	check('a craft deleted while SCE runs leaves the copy', got.copyAfterDelete === 0, got);
	check('nothing switched off', got.problems.length === 0, got.problems);
	check('no page errors', errors.length === 0, errors);
	await browser.close();
	server.close();
	fs.rmSync(dir, { recursive: true, force: true });
	console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
	process.exit(failed ? 1 : 0);
})();
