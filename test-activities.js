// Activities test: loads sce.js (+ activities.js) into a clean copy of the game and checks every SCE activity:
// it is in the game's list once, shows on its zones with its label, picture and the SCE badge, its chat line reads
// right for SCE players AND for a game without SCE, the doer's face changes, prerequisites hide what can't be done,
// the settings switch removes them, and nothing is switched off or throws.
//   BC_ROOT=<BondageClub folder> CHROME=<chrome.exe> node test-activities.js
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const { BC_ROOT, CHROME } = process.env;
let failed = 0;
const check = (what, ok, got) => {
	console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${ok ? '' : ` ${JSON.stringify(got).slice(0, 1500)}`}`);
	if (!ok) failed++;
};

function addonDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sce-act-'));
	for (const f of ['sce.js', 'activities.js', 'icon-64.png']) fs.copyFileSync(path.join(__dirname, f), path.join(dir, f));
	fs.mkdirSync(path.join(dir, 'clothes'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'clothes', 'clothes.json'), JSON.stringify({ pieces: [], images: [], outfits: {} }));
	return dir;
}
function serve(addon) {
	const types = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.html': 'text/html', '.css': 'text/css' };
	const server = http.createServer((req, res) => {
		const url = decodeURIComponent((req.url || '/').split('?')[0]);
		const file = url.startsWith('/addon/') ? path.join(addon, url.slice(7)) : path.join(BC_ROOT, url === '/' ? 'index.html' : url);
		fs.readFile(file, (err, data) => {
			if (err) { res.writeHead(404); res.end(); return; }
			res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
			res.end(data);
		});
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** In the page: a logged-in-looking player and a second character, both with arousal on. */
const SETUP = () => {
	window.__sent = [];
	Player.MemberNumber = 1;
	Player.Name = 'Alice';
	Player.CharacterID = 'p';
	Player.Type = CharacterType.PLAYER;
	Player.Nickname = 'Alice';
	PreferenceInit(Player);
	Player.ArousalSettings.Active = 'Hybrid';
	ServerSocket = { emit: (...a) => window.__sent.push(a), connected: true };
	ServerPlayerIsInChatRoom = () => true;
	ChatRoomData = { Admin: [] };
	const make = (n, name) => {
		const C = CharacterLoadSimple(`ActTest${n}`);
		CharacterAppearanceSetDefault(C);
		C.MemberNumber = n;
		C.Type = CharacterType.ONLINE;
		C.Name = name;
		C.Nickname = name;
		PreferenceInit(C);
		C.ArousalSettings.Active = 'Hybrid';
		C.OnlineSharedSettings = { ItemsAffectExpressions: true };
		return C;
	};
	window.Bob = make(2, 'Bob');
	if (!Character.includes(Player)) Character.push(Player);
};

async function run() {
	const dir = addonDir();
	const server = await serve(dir);
	const base = `http://127.0.0.1:${server.address().port}`;
	const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 120000 });
	const errors = [];
	const open = async (withSce) => {
		const page = await browser.newPage();
		page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 4).join(' | ')));
		await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(() => Array.isArray(window.Asset) && window.Asset.length > 100 && window.bcModSdk && window.Player, { timeout: 60000 });
		const inject = async (urls) => {
			for (const u of urls) {
				await page.evaluate((src) => new Promise((res) => {
					const s = document.createElement('script');
					s.src = src;
					s.crossOrigin = 'anonymous';
					s.onload = res;
					s.onerror = res;
					document.head.appendChild(s);
				}), u);
			}
			await new Promise((r) => setTimeout(r, 6000));
		};
		const extra = (process.env.EXTRA || '').split(',').filter(Boolean);
		if (withSce && process.env.ORDER === 'before') await inject(extra);
		if (withSce) {
			await page.evaluate((b) => {
				window.SCEBase = `${b}/addon/`;
				const s = document.createElement('script');
				s.src = `${b}/addon/sce.js`;
				document.head.appendChild(s);
			}, base);
			await page.waitForFunction(() => window.SCE && window.SCE.activities && ActivityFemale3DCG.some((a) => a.Name === 'SCE_Blush'), { timeout: 20000 });
		}
		if (withSce && process.env.ORDER !== 'before') await inject(extra);
		if (withSce && extra.length) {
			const others = await page.evaluate(() => ({ total: ActivityFemale3DCG.length, mods: (window.bcModSdk ? bcModSdk.getModsInfo().map((m) => m.name) : []) }));
			console.log(`(loaded with ${others.mods.join(', ')}; ${others.total} activities in the game's list)`);
		}
		await page.evaluate(SETUP);
		if (withSce && (process.env.EXTRA || '')) {
			await new Promise((r) => setTimeout(r, 8000));
			const n = await page.evaluate(() => ({ total: ActivityFemale3DCG.length, echo: ActivityFemale3DCG.filter((a) => !a.Name.startsWith('SCE_') && !ActivityFemale3DCGOrdering.slice(0, 80).includes(a.Name)).length }));
			console.log(`(after login: ${n.total} activities, ${n.echo} from other add-ons)`);
		}
		return page;
	};
	const page = await open(true);
	const plain = await open(false);

	// ---- In the game's list, once, with no clash
	const list = await page.evaluate(() => {
		const ours = ActivityFemale3DCG.filter((a) => a.Name.startsWith('SCE_')).map((a) => a.Name);
		return { ours, expected: window.SCE.activities, dupes: ours.filter((n, i) => ours.indexOf(n) !== i), ordered: ours.every((n) => ActivityFemale3DCGOrdering.includes(n)) };
	});
	check(`all ${list.expected.length} activities are in the game's list once`, list.ours.length === list.expected.length && !list.dupes.length, list);
	check('they are in the menu order (after the game\'s own)', list.ordered, list);

	// ---- Every activity: on its zones, with its label and line (as doer on Bob, and on yourself)
	const each = await page.evaluate(() => {
		const out = [];
		const bob = window.Bob;
		// Bob: naked, with a kimono-like Cloth for the obi, a collar; a second Bob with a penis.
		const setBody = (C, { naked, penis, kimono, collar }) => {
			CharacterAppearanceSetDefault(C);
			if (naked) for (const g of ['Cloth', 'ClothOuter', 'ClothLower', 'ClothAccessory', 'Bra', 'Panties', 'Socks', 'Shoes', 'Corset', 'Gloves']) InventoryRemove(C, g, false);
			if (kimono) InventoryWear(C, 'Yukata1', 'Cloth');
			if (collar) InventoryWear(C, 'LeatherCollar', 'ItemNeck');
			if (penis) InventoryWear(C, 'Penis', 'Pussy');
			CharacterRefresh(C, false, false);
		};
		for (const def of window.SCE.activities) {
			const act = AssetGetActivity('Female3DCG', def);
			const tries = [
				...(act.Target || []).map((g) => ({ who: 'other', g })),
				...(Array.isArray(act.TargetSelf) ? act.TargetSelf : []).map((g) => ({ who: 'self', g })),
			];
			for (const t of tries) {
				const C = t.who === 'self' ? Player : bob;
				const needsNaked = act.Prerequisite.includes('ZoneNaked');
				const needsPenis = act.Prerequisite.includes('SCE_TargetHasPenis');
				setBody(Player, { naked: ['SCE_Titjob', 'SCE_Scissoring', 'SCE_DoubleDildo'].includes(def) });
				if (def === 'SCE_DoubleDildo') InventoryWear(Player, 'DoubleEndDildo', 'ItemVulva');
				if (def === 'SCE_Pegging') InventoryWear(Player, 'StraponPanties', 'ItemPelvis');
				if (t.who === 'other') setBody(bob, { naked: needsNaked, penis: needsPenis, kimono: def === 'SCE_ObiSpin' || def === 'SCE_HandUnder', collar: def === 'SCE_FixCollar' });
				const allowed = ActivityAllowedForGroup(C, t.g).find((a) => a.Activity.Name === def);
				const group = AssetGroupGet('Female3DCG', t.g);
				const label = ActivityDictionaryText(ActivityBuildChatTag(C, group, act, true));
				const text = ActivityDictionaryText(ActivityBuildChatTag(C, group, act));
				let button = null;
				if (allowed) {
					const b = ElementButton.CreateForActivity(null, allowed, C, () => {});
					button = {
						img: (b.querySelector('img.button-image') || b.querySelector('img') || {}).getAttribute?.('src'),
						badge: !!b.querySelector('[id$="-icon-li-SCE"]'),
						badgeSrc: (b.querySelector('[id$="-icon-li-SCE"]') || {}).style?.backgroundImage || '',
					};
					b.remove();
				}
				const why = allowed ? undefined : act.Prerequisite.filter((p) => !ActivityCheckPrerequisite(p, Player, C, group)).concat(ActivityCheckPermissions(act, Player, true) ? [] : ['perm']);
				out.push({ def, who: t.who, g: t.g, allowed: !!allowed, label, text, button, why, flat: Player.IsFlatChested() });
			}
		}
		setBody(Player, {});
		setBody(bob, {});
		return out;
	});
	const blocked = each.filter((e) => !e.allowed);
	check('every activity shows on every one of its zones (when its needs are met)', !blocked.length, blocked);
	const noText = each.filter((e) => !e.label || /MISSING/.test(e.label) || !e.text || /MISSING/.test(e.text));
	check('every one has its label and chat line', !noText.length, noText);
	const pics = each.filter((e) => e.button && (!/^\.\/Icons\/[A-Za-z/]+\.png$/.test(e.button.img || '') || !e.button.badge || !/icon-64\.png/.test(e.button.badgeSrc)));
	check('every button has a game picture and the SCE badge with our icon', !pics.length, pics.slice(0, 5));
	const picFiles = [...new Set(each.map((e) => e.button && e.button.img).filter(Boolean))];
	const missingPics = picFiles.filter((p) => !fs.existsSync(path.join(BC_ROOT, p.replace(/^\.\//, ''))));
	check('those pictures exist in the game', !missingPics.length, missingPics);
	check(`(${each.length} activity/zone pairs checked)`, true);

	// ---- Prerequisites hide what can't be done
	const pre = await page.evaluate(() => {
		const bob = window.Bob;
		CharacterAppearanceSetDefault(bob);
		InventoryRemove(bob, 'Cloth', false);
		InventoryRemove(bob, 'ClothLower', false);
		const has = (C, g, n) => ActivityAllowedForGroup(C, g).some((a) => a.Activity.Name === n);
		const r = {
			obiWithoutKimono: has(bob, 'ItemTorso', 'SCE_ObiSpin'),
			handUnderNaked: has(bob, 'ItemTorso', 'SCE_HandUnder'),
			collarWithout: has(bob, 'ItemNeck', 'SCE_FixCollar'),
			titjobOnVulva: has(bob, 'ItemVulva', 'SCE_Titjob'),
			edgeClothed: (() => { CharacterAppearanceSetDefault(bob); return has(bob, 'ItemVulva', 'SCE_Edge'); })(),
		};
		for (const g of ['Cloth', 'ClothOuter', 'ClothLower', 'ClothAccessory', 'Panties', 'Socks']) InventoryRemove(bob, g, false);
		r.scissorDoerClothed = has(bob, 'ItemVulva', 'SCE_Scissoring');
		CharacterAppearanceSetDefault(bob);
		InventoryWear(bob, 'Penis', 'Pussy');
		for (const g of ['Cloth', 'ClothLower', 'Panties']) InventoryRemove(bob, g, false);
		for (const g of ['ClothOuter', 'ClothAccessory', 'Socks']) InventoryRemove(bob, g, false);
		r.scissorOnPenis = has(bob, 'ItemVulva', 'SCE_Scissoring');
		r.peggingWithout = has(bob, 'ItemButt', 'SCE_Pegging');
		r.dildoPic = (() => { const b = ElementButton.CreateForActivity(null, { Activity: AssetGetActivity('Female3DCG', 'SCE_Pegging'), Group: 'ItemButt' }, bob, () => {}); const src = b.querySelector('img').getAttribute('src'); b.remove(); return src; })();
		r.doubleDildoWithout = has(bob, 'ItemVulva', 'SCE_DoubleDildo') || has(bob, 'ItemButt', 'SCE_DoubleDildo');
		r.edgePenisLabel = ActivityDictionaryText(ActivityBuildChatTag(bob, AssetGroupGet('Female3DCG', 'ItemVulva'), AssetGetActivity('Female3DCG', 'SCE_Edge')));
		r.ddOnPenis = (() => { InventoryWear(Player, 'DoubleEndDildo', 'ItemVulva'); const on = has(bob, 'ItemVulva', 'SCE_DoubleDildo'); return on; })();
		r.ddClothedPlugged = (() => { CharacterAppearanceSetDefault(bob); InventoryWear(bob, 'BlackButtPlug', 'ItemButt'); const ok = has(bob, 'ItemButt', 'SCE_DoubleDildo') && has(bob, 'ItemVulva', 'SCE_DoubleDildo'); InventoryRemove(Player, 'ItemVulva', false); InventoryRemove(bob, 'ItemButt', false); return ok; })();
		r.peggingClothedPlugged = (() => { InventoryWear(Player, 'StraponPanties', 'ItemPelvis'); CharacterAppearanceSetDefault(bob); InventoryWear(bob, 'BlackButtPlug', 'ItemButt'); const ok = has(bob, 'ItemButt', 'SCE_Pegging'); InventoryRemove(Player, 'ItemPelvis', false); InventoryRemove(bob, 'ItemButt', false); return ok; })();
		CharacterAppearanceSetDefault(bob);
		return r;
	});
	check('Obi Spin needs a kimono, Hand Under Clothes needs clothes, Straighten Collar a collar', !pre.obiWithoutKimono && !pre.handUnderNaked && !pre.collarWithout, pre);
	check('Titjob only on a penis, Edge only when bare, Scissoring not on a penis', !pre.titjobOnVulva && !pre.edgeClothed && !pre.scissorOnPenis, pre);
	check('Pegging works on a clothed, plugged ass', pre.peggingClothedPlugged, pre);
	check('Double Dildo works clothed or plugged, never into a penis', pre.ddClothedPlugged && !pre.ddOnPenis, pre);
	check('Double Dildo needs the doer wearing one, Pegging a strap-on', !pre.doubleDildoWithout && !pre.peggingWithout, pre);
	check('the dildo activities use the black dildo picture', /Icons\/Activity\/PenetrateFast\.png$/.test(pre.dildoPic), pre.dildoPic);
	check('Scissoring needs the doer bare too', !pre.scissorDoerClothed, pre);
	check('Edge on a penis reads as a penis line', /cock/.test(pre.edgePenisLabel), pre.edgePenisLabel);

	// ---- Doing one: the message carries its own text; SCE players and plain games both read it right
	const sent = await page.evaluate(() => {
		window.__sent = [];
		const bob = window.Bob;
		const act = AssetGetActivity('Female3DCG', 'SCE_NuzzleNeck');
		ActivityRun(Player, bob, AssetGroupGet('Female3DCG', 'ItemNeck'), { Activity: act, Group: 'ItemNeck' });
		const selfAct = AssetGetActivity('Female3DCG', 'SCE_Blush');
		ActivityRun(Player, Player, AssetGroupGet('Female3DCG', 'ItemHead'), { Activity: selfAct, Group: 'ItemHead' });
		const blush = InventoryGet(Player, 'Blush');
		return { msgs: window.__sent.filter((a) => a[0] === 'ChatRoomChat' && a[1].Type === 'Activity').map((a) => a[1]), blush: blush && blush.Property && blush.Property.Expression };
	});
	check('the doer\'s face changes (Blush)', sent.blush === 'High', sent.blush);
	check('two activity messages went out', sent.msgs.length === 2, sent.msgs);
	const render = (msgs) => msgs.map((data) => {
		const sender = Character.find((c) => c.MemberNumber === 1);
		const { substitutions } = ChatRoomMessageRunExtractors(data, sender);
		return CommonStringSubstitute(ActivityDictionaryText(data.Content), substitutions);
	});
	const withSce = await page.evaluate(render, sent.msgs);
	const without = await plain.evaluate(render, sent.msgs);
	const want = ["Alice nuzzles into the crook of Bob's neck.", 'Alice blushes a deep shade of red.'];
	check('an SCE player reads the lines', JSON.stringify(withSce) === JSON.stringify(want), withSce);
	check('a game WITHOUT SCE reads the same lines', JSON.stringify(without) === JSON.stringify(want), without);
	const gameMsg = await page.evaluate(() => {
		window.__sent = [];
		ActivityRun(Player, window.Bob, AssetGroupGet('Female3DCG', 'ItemNeck'), { Activity: AssetGetActivity('Female3DCG', 'Kiss'), Group: 'ItemNeck' });
		return window.__sent.filter((a) => a[0] === 'ChatRoomChat' && a[1].Type === 'Activity').map((a) => a[1]);
	});
	check("the game's own activities' messages are untouched", gameMsg.length === 1 && !gameMsg[0].Dictionary.some((e) => 'Text' in e && /MISSING/.test(e.Tag)), gameMsg);

	// ---- The target's face reacts (their game has SCE): run as if Bob were the player receiving it
	const react = await page.evaluate(() => {
		const real = window.Player;
		const bob = window.Bob;
		ActivityEffect(real, bob, 'SCE_ObiSpin', 'ItemTorso', 1);
		const eyes = InventoryGet(bob, 'Eyes');
		return eyes && eyes.Property && eyes.Property.Expression;
	});
	check('the target\'s face reacts (Obi Spin: dizzy)', react === 'Dizzy', react);

	// ---- Arousal settings screen leaves ours out; the settings switch takes them out of the menu
	const prefs = await page.evaluate(() => {
		PreferenceSubscreenArousalLoad();
		const inList = PreferenceArousalActivityList.some((n) => n.startsWith('SCE_'));
		const gameStill = PreferenceArousalActivityList.includes('Kiss');
		window.SCE.settings.activities = false;
		const off = ActivityAllowedForGroup(window.Bob, 'ItemNeck').some((a) => a.Activity.Name.startsWith('SCE_'));
		const gameOff = ActivityAllowedForGroup(window.Bob, 'ItemNeck').some((a) => a.Activity.Name === 'Kiss');
		window.SCE.settings.activities = true;
		const on = ActivityAllowedForGroup(window.Bob, 'ItemNeck').some((a) => a.Activity.Name.startsWith('SCE_'));
		return { inList, gameStill, off, gameOff, on, factor: PreferenceGetActivityFactor(Player, 'Kiss', false) };
	});
	check('the arousal settings list has the game\'s activities and none of ours', !prefs.inList && prefs.gameStill, prefs);
	check('switching SCE activities off removes them, the game\'s stay; on brings them back', !prefs.off && prefs.gameOff && prefs.on, prefs);

	if (process.env.SHOT) {
		await page.evaluate(() => {
			const grid = document.createElement('div');
			grid.id = 'sce-shot';
			grid.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;display:grid;grid-template-columns:repeat(8,150px);gap:6px;padding:8px;font-size:14px';
			document.body.appendChild(grid);
			for (const name of window.SCE.activities) {
				const act = AssetGetActivity('Female3DCG', name);
				const self = !act.Target.length;
				const C = self ? Player : window.Bob;
				const g = self ? act.TargetSelf[0] : act.Target[0];
				const b = ElementButton.CreateForActivity(null, { Activity: act, Group: g }, C, () => {}, null, { button: { parent: grid, classList: ['dialog-grid-button'] } });
				b.style.cssText += ';width:150px;height:190px';
			}
		});
		await page.setViewport({ width: 1250, height: 1100 });
		await new Promise((r) => setTimeout(r, 1500));
		const box = await page.evaluate(() => { const r = document.getElementById('sce-shot').getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height) }; });
		await page.screenshot({ path: process.env.SHOT, clip: box, captureBeyondViewport: false });
		await page.evaluate(() => document.getElementById('sce-shot').remove());
	}
	const problems = await page.evaluate(() => [...window.SCE.problems]);
	check('nothing switched off', problems.length === 0, problems);
	check('no page errors', errors.length === 0, errors);

	await browser.close();
	server.close();
	fs.rmSync(dir, { recursive: true, force: true });
}

run().then(() => {
	console.log(failed ? `${failed} FAILED` : 'All checks passed');
	process.exit(failed ? 1 : 0);
}, (e) => {
	console.error(e);
	process.exit(1);
});
