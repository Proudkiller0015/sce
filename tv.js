// SCE TV: an HD TV (ItemMisc/SlimeTV) that plays a YouTube link or a video file. The TV is not one of the game's
// pictures: it is a page element laid over the game's screen where the character stands, so the video keeps its own
// resolution at any size. sce.js loads this file and hands it its guarded hooks (window.SCE.kit), so a hook that fails
// switches the TV off instead of breaking the game.
//
// What plays is kept on the item, so everyone in the room with SCE sees the same thing:
//   Text   the link
//   Text2  when it started (ms, on the game server's clock), so everyone watches from the same moment; "p<seconds>"
//          when it is paused there; "off" when it is switched off (the link stays, so it can be switched on again)
//   Text3  size and place: "<size %>,<right>,<down>" (in the character's own pixels)
(() => {
	'use strict';
	/** @type {any} */
	const w = window;
	const kit = w.SCE && w.SCE.kit;
	if (!kit || !kit.itemMenus || w.SCETVLoaded) {
		return;
	}
	w.SCETVLoaded = true;
	const { hookGame, problem, working, itemMenus, settings, saveSettings, toast } = kit;
	const FEATURE = 'TV';
	const GROUP = 'ItemMisc';
	const NAME = 'SlimeTV';
	/** The TV at 100%, in the character's pixels (the canvas is 500 wide): it just fits, from the shoulders down. */
	const TV = { width: 490, x: 250, y: 370, bezel: 9 };
	const SIZE = { min: 20, max: 140, step: 10 };
	const MOVE = { step: 20, max: 500 };
	const MAX_LINK = 300;
	/**
	 * A TV whose character isn't drawn for a while (a menu over the room, out of sight on the map) is hidden and quiet but
	 * keeps its player, so it comes back at once and YouTube's player doesn't load again (each load fills the console
	 * with YouTube's own messages). It goes when its character leaves the room or takes it off, or after KEEP_MS.
	 */
	const KEEP_MS = 10 * 60 * 1000;
	const MUTE_KEY = 'sce.tv.muted';
	/** The TVs muted here one by one, by their character's member number (kept in this browser). */
	const MUTED_TVS_KEY = 'sce.tv.mutedTVs';
	/** How often each TV checks it is where everyone else is, and how far off it may be before it jumps back. */
	const SYNC_MS = 2000;
	const SYNC_OFF = 1.5;

	// ---- One clock for everyone: the game server's. Each PC's clock may be off by seconds; the server tells the game
	// its time when you connect and now and then after (ServerInfo), so the gap to this PC's clock is measured then.
	let clockGap = 0;
	/** The server's time now (this PC's clock until the server has told its own). */
	const serverNow = () => Date.now() + clockGap;
	/**
	 * Where a TV's video is, from its Text2: playing since `start` (ms, server clock), paused at `at` seconds, or off.
	 * @returns {{ mode: 'play', start: number } | { mode: 'pause', at: number } | { mode: 'off' }}
	 */
	function stateOf(/** @type {any} */ item) {
		const t = String((item && item.Property && item.Property.Text2) || '');
		if (t === 'off') {
			return { mode: 'off' };
		}
		if (t.startsWith('p')) {
			return { mode: 'pause', at: Math.max(0, Number(t.slice(1)) || 0) };
		}
		return { mode: 'play', start: Number(t) || 0 };
	}
	/** Seconds into the video everyone should be at now (before looping round). */
	function wantedAt(/** @type {any} */ item) {
		const st = stateOf(item);
		if (st.mode === 'pause') {
			return st.at;
		}
		return st.mode === 'play' && st.start ? Math.max(0, (serverNow() - st.start) / 1000) : 0;
	}
	/** The last place the mouse was over the page, and when (TV controls show while it moves over a TV). */
	const mouse = { x: -1, y: -1, at: 0 };
	w.addEventListener(
		'mousemove',
		(/** @type {MouseEvent} */ e) => {
			mouse.x = e.clientX;
			mouse.y = e.clientY;
			mouse.at = performance.now();
		},
		{ capture: true, passive: true },
	);
	/** How long a TV's controls stay after the mouse stops moving over it. */
	const UI_MS = 2500;

	/** Whether TVs show for you (SCE's settings). */
	const tvsOn = () => !settings || settings.tvs !== false;
	/**
	 * What you chose to watch in this room, as "<member>|<link>": TVs are opt-in (SCE's settings, on by default), so
	 * someone else's TV loads and plays nothing for you until you press Watch on it; a new link asks again, and so does
	 * every room you enter. Your own TV plays without asking. With the setting off, every TV plays for you.
	 */
	const watching = new Set();
	let watchedRoom = '';
	/** People whose TVs you always or never want to see, in any room: { <member>: 'on' | 'off' } (kept in this browser). */
	const ALWAYS_KEY = 'sce.tv.always';
	/** @returns {Record<string, string>} */
	function always() {
		try {
			const v = JSON.parse(localStorage.getItem(ALWAYS_KEY) || '{}');
			return v && typeof v === 'object' ? v : {};
		} catch {
			return {};
		}
	}
	function setAlways(/** @type {string} */ key, /** @type {'on' | 'off' | ''} */ choice) {
		const all = always();
		if (choice) {
			all[key] = choice;
		} else {
			delete all[key];
		}
		try {
			localStorage.setItem(ALWAYS_KEY, JSON.stringify(all));
		} catch {
			// (blocked storage: the choice holds until this TV's next change)
		}
	}
	const myKey = () => String(w.Player && w.Player.MemberNumber);
	/** Whether a TV on screen may play for you. */
	function allowed(/** @type {any} */ s) {
		const link = String((s.item.Property || {}).Text || '');
		const choice = always()[s.key];
		if (s.key === myKey() || choice === 'on') {
			return true;
		}
		return choice !== 'off' && (!(settings && settings.tvsAsk !== false) || watching.has(`${s.key}|${link}`));
	}
	/** What a TV shows now: its link, when it started, and whether you chose to watch it (a change fills it again). */
	const showing = (/** @type {any} */ s) => {
		const prop = s.item.Property || {};
		return `${prop.Text || ''}|${prop.Text2 === 'off'}|${allowed(s)}|${always()[s.key] || ''}`;
	};
	/** Shows or hides every TV for you (the same switch as in SCE's settings), saying how to undo it. */
	function setTVs(/** @type {boolean} */ on) {
		if (!settings) {
			return;
		}
		settings.tvs = on;
		if (typeof saveSettings === 'function') {
			saveSettings();
		}
		if (!on && typeof toast === 'function') {
			toast('🙈 TVs hidden for you', "Only for you: everyone else still sees them. To see them again: SCE's settings (Settings > Extensions), or the menu of any TV.", 9000);
		}
	}

	// ---- Links
	/**
	 * What a link plays: a YouTube video (watch, youtu.be, shorts, live, embed) or a video file (https, .mp4 .webm .m4v
	 * .mov .ogv); null for anything else.
	 * @param {string} text
	 * @returns {{ yt: string } | { file: string } | null}
	 */
	function parseLink(text) {
		let url;
		try {
			url = new URL(String(text || '').trim());
		} catch {
			return null;
		}
		if (url.protocol !== 'https:') {
			return null;
		}
		const host = url.hostname.toLowerCase();
		const id = /^[A-Za-z0-9_-]{11}$/;
		if (host === 'youtu.be') {
			const v = url.pathname.slice(1).split('/')[0];
			return id.test(v) ? { yt: v } : null;
		}
		if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
			const v = url.searchParams.get('v') || (/^\/(?:shorts|live|embed|v)\/([^/?#]+)/.exec(url.pathname) || [])[1] || '';
			return id.test(v) ? { yt: v } : null;
		}
		return /\.(mp4|webm|m4v|mov|ogv)$/i.test(url.pathname) ? { file: url.href } : null;
	}

	// ---- The item
	/** The TV a character has on, or null. */
	function tvOf(/** @type {any} */ C) {
		const item = C && typeof w.InventoryGet === 'function' ? w.InventoryGet(C, GROUP) : null;
		return item && item.Asset && item.Asset.Name === NAME ? item : null;
	}
	/** The TV's size (%) and how far it is moved, from Text3. */
	function placeOf(/** @type {any} */ item) {
		const [s, x, y] = String((item.Property && item.Property.Text3) || '')
			.split(',')
			// (an empty part is "not set", not 0)
			.map((v) => (v.trim() === '' ? NaN : Number(v)));
		const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi, /** @type {number} */ d) =>
			Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d;
		return { size: clamp(s, SIZE.min, SIZE.max, 100), x: clamp(x, -MOVE.max, MOVE.max, 0), y: clamp(y, -MOVE.max, MOVE.max, 0) };
	}

	// ---- On screen
	/** @type {HTMLDivElement | null} Holds the TVs: right above the game's canvas, under the game's own page elements. */
	let layer = null;
	/**
	 * Each TV drawn lately, by its character: where, and its page element.
	 * @type {Map<string, { box: number[], scale: number, item: any, seen: number, el?: HTMLDivElement, playing?: string, media?: any, volume?: number }>}
	 */
	const shown = new Map();

	/** Notes where a TV goes when the game draws its character (the game's DrawCharacter arguments). */
	function noteDrawn(/** @type {any[]} */ args) {
		const [C, X, Y, Zoom, heightAllowed, canvas] = args;
		if (canvas && canvas !== w.MainCanvas) {
			return;
		}
		const item = tvOf(C);
		if (!item || !tvsOn() || w.CurrentScreen !== 'ChatRoom' || typeof Zoom !== 'number') {
			return;
		}
		if (blocked(C)) {
			return;
		}
		// (the game doesn't draw others for someone who can't see)
		if (!C.IsPlayer() && w.Player && typeof w.Player.GetBlindLevel === 'function' && w.Player.GetBlindLevel() >= 3) {
			return;
		}
		// Where the game puts the character's own pixels on its canvas (as DrawCharacter does).
		const ratio = heightAllowed === false ? 1 : Number(C.HeightRatio) || 1;
		const xOff = typeof w.CharacterAppearanceXOffset === 'function' ? w.CharacterAppearanceXOffset(C, ratio) : 0;
		const yOff = typeof w.CharacterAppearanceYOffset === 'function' ? w.CharacterAppearanceYOffset(C, ratio) : 0;
		const cut = yOff >= 0 || (typeof w.ServerPlayerIsInChatRoom === 'function' && w.ServerPlayerIsInChatRoom());
		const scale = ratio * Zoom;
		const toX = (/** @type {number} */ ax) => X + xOff * Zoom + ax * scale;
		const toY = (/** @type {number} */ ay) => Y + (cut ? 0 : yOff) * Zoom + (ay + (cut ? yOff / ratio : 0)) * scale;
		const place = placeOf(item);
		const width = (TV.width * place.size) / 100;
		const height = (width - 2 * TV.bezel * (place.size / 100)) * (9 / 16) + 2 * TV.bezel * (place.size / 100);
		const cx = TV.x + place.x;
		const cy = TV.y + place.y;
		const key = String(C.MemberNumber ?? `npc${C.CharacterID}`);
		const box = [toX(cx - width / 2), toY(cy - height / 2), toX(cx + width / 2), toY(cy + height / 2)];
		const now = { key, box, scale: scale * (place.size / 100), item, seen: performance.now() };
		// (the same record every frame: the player's callbacks hold on to it)
		const was = shown.get(key);
		if (was) {
			Object.assign(was, now);
		} else {
			shown.set(key, now);
		}
	}

	/**
	 * A TV's volume (0-1): the game's sound volume, lower for someone who can't hear well, 0 when TVs are muted here or
	 * this one is.
	 */
	function volume(/** @type {string} */ key) {
		if (muted() || mutedTVs().has(key)) {
			return 0;
		}
		let v = tvVolume(key) / 100;
		const deaf = w.Player && typeof w.Player.GetDeafLevel === 'function' ? w.Player.GetDeafLevel() : 0;
		v *= Math.max(0, 1 - deaf * 0.25);
		return Math.max(0, Math.min(1, v));
	}
	/**
	 * How loud each person's TV is for you (0-100, by their member number), kept in this browser: until you move a TV's
	 * own slider, the base TV volume in SCE's settings (30 to start). Not the game's sound volume.
	 */
	const VOLUME_KEY = 'sce.tv.volumes';
	const VOLUME_DEFAULT = 30;
	/** @returns {Record<string, number>} */
	function volumes() {
		try {
			const v = JSON.parse(localStorage.getItem(VOLUME_KEY) || '{}');
			return v && typeof v === 'object' ? v : {};
		} catch {
			return {};
		}
	}
	function tvVolume(/** @type {string} */ key) {
		const v = Number(volumes()[key]);
		const base = settings && Number.isFinite(settings.tvVolume) ? settings.tvVolume : VOLUME_DEFAULT;
		return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : Math.max(0, Math.min(100, base));
	}
	function setTvVolume(/** @type {string} */ key, /** @type {number} */ v) {
		const all = volumes();
		all[key] = Math.round(v);
		try {
			localStorage.setItem(VOLUME_KEY, JSON.stringify(all));
		} catch {
			// (blocked storage: the slider still moves this time)
		}
		const s = shown.get(key);
		if (s) {
			s.volume = undefined;
		}
	}
	function muted() {
		try {
			return localStorage.getItem(MUTE_KEY) === '1';
		} catch {
			return false;
		}
	}
	/** @returns {Set<string>} */
	function mutedTVs() {
		try {
			const list = JSON.parse(localStorage.getItem(MUTED_TVS_KEY) || '[]');
			return new Set(Array.isArray(list) ? list.map(String) : []);
		} catch {
			return new Set();
		}
	}
	/** Mutes one TV here, or lets it be heard again. */
	function toggleTV(/** @type {string} */ key) {
		const set = mutedTVs();
		if (!set.delete(key)) {
			set.add(key);
		}
		try {
			localStorage.setItem(MUTED_TVS_KEY, JSON.stringify([...set]));
		} catch {
			status = "This browser can't keep that setting.";
		}
	}

	/** The TV shown full screen for you (its character's member number), or ''. */
	let fullKey = '';
	/**
	 * The TV popped out for you into a small player of its own (its character's member number), or ''. It stays where you
	 * put it, whatever the game shows (someone's profile, a menu, another part of the map), while its character is in the
	 * room with the TV on; you move it by dragging it and size it by its corner.
	 */
	let popKey = '';
	const POP_KEY = 'sce.tv.pop';
	/** Where the popped-out player sits: left, top and width in page pixels from the TV layer's corner. */
	function popPlace() {
		try {
			const v = JSON.parse(localStorage.getItem(POP_KEY) || 'null');
			if (v && [v.x, v.y, v.w].every(Number.isFinite)) {
				return v;
			}
		} catch {
			// (unreadable: the default place)
		}
		return { x: 16, y: 16, w: 360 };
	}
	function savePopPlace(/** @type {{ x: number, y: number, w: number }} */ v) {
		try {
			localStorage.setItem(POP_KEY, JSON.stringify({ x: Math.round(v.x), y: Math.round(v.y), w: Math.round(v.w) }));
		} catch {
			// (blocked storage: it stays there until the page reloads)
		}
	}
	/**
	 * The TV floating over every tab and program, in the browser's own always-on-top window (Chrome, Edge, Opera; not
	 * Firefox): { win, key }, or null. It stays while its character is in the room with the TV on, like the popped-out one.
	 */
	/** @type {{ win: any, key: string } | null} */
	let floating = null;
	/** Where the mouse last moved in that window (its controls show while it moves, as on the page). */
	const winMouse = { x: -1, y: -1, at: 0 };
	const canFloat = () => 'documentPictureInPicture' in w;
	/** Opens that window with this TV in it, or closes it if it holds this TV already. Needs a click (the browser's rule). */
	async function floatTV(/** @type {string} */ key) {
		if (floating) {
			const was = floating.key;
			floating.win.close();
			if (was === key) {
				return;
			}
		}
		const s = shown.get(key);
		if (!s || !s.el || !canFloat()) {
			return;
		}
		const win = await w.documentPictureInPicture.requestWindow({ width: 480, height: 280 });
		win.document.title = 'TV';
		win.document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;';
		win.addEventListener('message', onPlayerMessage);
		win.addEventListener(
			'mousemove',
			(/** @type {MouseEvent} */ e) => {
				winMouse.x = e.clientX;
				winMouse.y = e.clientY;
				winMouse.at = performance.now();
			},
			{ capture: true, passive: true },
		);
		// (closed by its own ✕, or by us: the TV goes back on its character)
		win.addEventListener('pagehide', () => {
			if (floating && floating.win === win) {
				floating = null;
				const t = shown.get(key);
				if (t && t.el && layer) {
					layer.append(t.el);
					t.playing = null;
				}
			}
		});
		floating = { win, key };
		win.document.body.append(s.el);
		// (its player starts again in the new window, from where everyone is)
		s.playing = null;
	}
	// ---- The room's chat beside a full-screen TV (like a stream's live chat): the real chat, mirrored, and a box that
	// sends through the game's own chat (commands, /me and emotes as usual).
	const CHAT_KEY = 'sce.tv.chat';
	/** Whether the chat shows beside a full-screen TV (on unless you hid it; kept in this browser). */
	function chatShown() {
		try {
			return localStorage.getItem(CHAT_KEY) !== '0';
		} catch {
			return true;
		}
	}
	function setChatShown(/** @type {boolean} */ on) {
		try {
			localStorage.setItem(CHAT_KEY, on ? '1' : '0');
		} catch {
			// (blocked storage: for now only)
		}
	}
	const CHAT_W_KEY = 'sce.tv.chatw';
	/** The chat panel's width (page pixels) on a screen this wide: what you dragged it to, or about a quarter. */
	function chatWidth(/** @type {number} */ wd) {
		let v = NaN;
		try {
			v = Number(localStorage.getItem(CHAT_W_KEY) || NaN);
		} catch {
			// (the usual width)
		}
		const want = Number.isFinite(v) ? v : Math.min(360, Math.max(240, wd * 0.28));
		return Math.round(Math.max(200, Math.min(want, wd * 0.6)));
	}
	/** The game's chat log, watched for new lines. */
	let chatSource = /** @type {HTMLElement | null} */ (null);
	let chatChanged = true;
	const chatWatch = new MutationObserver(() => (chatChanged = true));
	/** Copies the newest lines of the room's chat into a panel (only when they changed), keeping it scrolled down. */
	function mirrorChat(/** @type {HTMLElement} */ log) {
		const src = document.getElementById('TextAreaChatLog');
		if (src !== chatSource) {
			chatWatch.disconnect();
			chatSource = src;
			chatChanged = true;
			if (src) {
				chatWatch.observe(src, { childList: true, subtree: true, characterData: true });
			}
		}
		if (!chatChanged && log.childElementCount) {
			return;
		}
		chatChanged = false;
		// (the colours of your own chat, light or dark theme, so its lines look as they do there)
		if (src) {
			const look = getComputedStyle(src);
			log.style.background = look.backgroundColor;
			log.style.color = look.color;
		}
		const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
		const lines = src ? [...src.children].filter((n) => n.classList.contains('ChatMessage')).slice(-80) : [];
		log.replaceChildren(
			...lines.map((n) => {
				const c = /** @type {HTMLElement} */ (n.cloneNode(true));
				// (the copies are only to read: no ids twice on the page)
				c.removeAttribute('id');
				for (const x of c.querySelectorAll('[id]')) {
					x.removeAttribute('id');
				}
				return c;
			}),
		);
		if (atEnd) {
			log.scrollTop = log.scrollHeight;
		}
	}
	/** Says something in the room from the panel, as if typed in the game's own chat box (which keeps what was in it). */
	function sayFromPanel(/** @type {string} */ text) {
		const box = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('InputChat'));
		if (!text.trim() || !box || typeof w.ChatRoomSendChat !== 'function') {
			return false;
		}
		const draft = box.value;
		box.value = text;
		try {
			w.ChatRoomSendChat();
		} finally {
			box.value = draft;
		}
		return true;
	}
	/** The player's height for its width (a 16:9 screen in its frame). */
	const popHeight = (/** @type {number} */ wd) => (wd - 8) * (9 / 16) + 10;
	/** The place kept inside the layer (at least a corner of it always reachable), at least 200 px wide. */
	function clampPop(/** @type {{ x: number, y: number, w: number }} */ v, /** @type {HTMLElement} */ box) {
		const W = box.clientWidth || 1;
		const H = box.clientHeight || 1;
		const wd = Math.max(200, Math.min(v.w, W, (H - 10) * (16 / 9) + 8));
		return { x: Math.max(0, Math.min(v.x, W - wd)), y: Math.max(0, Math.min(v.y, H - popHeight(wd))), w: wd };
	}
	// Esc closes full screen (caught before the game, which takes every Esc for itself).
	w.addEventListener(
		'keydown',
		(/** @type {KeyboardEvent} */ e) => {
			if (fullKey && e.key === 'Escape') {
				e.preventDefault();
				e.stopImmediatePropagation();
				fullKey = '';
			}
		},
		true,
	);

	/** Makes (or finds) the layer the TVs go in. */
	function tvLayer() {
		const canvas = document.getElementById('MainCanvas');
		if (!canvas || !canvas.parentElement) {
			return null;
		}
		if (!layer || !layer.isConnected) {
			layer = document.createElement('div');
			layer.id = 'sce-tv-layer';
			layer.style.cssText = 'position:fixed;overflow:hidden;pointer-events:none;';
			// (right after the canvas: the game's page elements that come later, the chat among them, stay on top)
			canvas.after(layer);
		}
		const r = canvas.getBoundingClientRect();
		Object.assign(layer.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
		return { layer, k: r.width / (Number(/** @type {HTMLCanvasElement} */ (canvas).width) || 2000) };
	}

	/** A TV's page element: the frame, the screen inside it, and its own mute button for you. */
	function makeTV(/** @type {string} */ key) {
		const el = document.createElement('div');
		el.className = 'sce-tv';
		el.style.cssText =
			'position:absolute;box-sizing:border-box;background:linear-gradient(#26262c,#121216);border-radius:6px;' +
			'box-shadow:0 0 0 1px #4a4a55 inset,0 6px 18px #000a;pointer-events:none;';
		const screen = document.createElement('div');
		screen.className = 'sce-tv-screen';
		screen.style.cssText =
			'position:relative;width:100%;height:100%;overflow:hidden;background:radial-gradient(ellipse at 30% 20%,#1c1c26,#050507 70%);border-radius:2px;';
		const led = document.createElement('div');
		led.className = 'sce-tv-led';
		led.style.cssText = 'position:absolute;left:50%;bottom:2px;width:6px;height:3px;margin-left:-3px;border-radius:2px;background:#c43;';
		// The controls, like a video player's: they show while the mouse moves over the TV and fade a moment after it
		// stops (hidden, they take no clicks: the game gets them). Clicks on them never reach the game below.
		const ui = document.createElement('div');
		ui.className = 'sce-tv-ui';
		ui.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .25s,visibility .25s;';
		const stop = (/** @type {HTMLElement} */ x) => {
			for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'wheel', 'keydown']) {
				x.addEventListener(type, (e) => e.stopPropagation());
			}
		};
		const small = (/** @type {string} */ cls, /** @type {() => void} */ act) => {
			const b = document.createElement('button');
			b.className = cls;
			b.type = 'button';
			b.style.cssText =
				'position:absolute;top:4px;width:26px;height:26px;padding:0;border:0;border-radius:50%;' +
				'background:#000b;color:#fff;font:14px/26px sans-serif;cursor:pointer;pointer-events:auto;opacity:.85;';
			b.addEventListener('mouseenter', () => (b.style.opacity = '1'));
			b.addEventListener('mouseleave', () => (b.style.opacity = '.85'));
			stop(b);
			b.addEventListener('click', (e) => {
				e.stopPropagation();
				e.preventDefault();
				act();
			});
			return b;
		};
		// The bottom bar, for whoever may change the TV (as for ⏻): pause or play, and where in the video, for everyone.
		const bar = document.createElement('div');
		bar.className = 'sce-tv-bar';
		bar.style.cssText =
			'position:absolute;left:6px;right:6px;bottom:6px;display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:12px;' +
			'background:#000b;color:#fff;font:11px sans-serif;pointer-events:auto;';
		stop(bar);
		const pause = small('sce-tv-pause', () => {
			const C = ownerOf(key);
			const s = shown.get(key);
			if (C && s) {
				togglePause(C, tvOf(C) || s.item, s);
			}
		});
		pause.style.cssText += 'position:static;flex:none;width:22px;height:22px;font-size:12px;line-height:22px;background:transparent;';
		const seek = document.createElement('input');
		seek.className = 'sce-tv-seek';
		seek.type = 'range';
		seek.min = '0';
		seek.max = '1000';
		seek.step = '1';
		seek.style.cssText = 'flex:1;min-width:0;height:14px;margin:0;cursor:pointer;accent-color:#c9a0ff;';
		const time = document.createElement('span');
		time.className = 'sce-tv-time';
		time.style.cssText = 'flex:none;font-variant-numeric:tabular-nums;opacity:.9;';
		seek.addEventListener('input', () => {
			const s = shown.get(key);
			if (s) {
				s.dragging = true;
				const d = lengthOf(s);
				time.textContent = `${clock((Number(seek.value) / 1000) * d)} / ${clock(d)}`;
			}
		});
		seek.addEventListener('change', () => {
			const C = ownerOf(key);
			const s = shown.get(key);
			if (C && s) {
				s.dragging = false;
				seekTo(C, tvOf(C) || s.item, s, (Number(seek.value) / 1000) * lengthOf(s));
			}
		});
		// (how loud this person's TV is for you: everyone gets it, not only who may change the TV)
		const vol = document.createElement('input');
		vol.className = 'sce-tv-vol';
		vol.type = 'range';
		vol.min = '0';
		vol.max = '100';
		vol.step = '1';
		vol.title = "This TV's volume (for you)";
		vol.style.cssText = 'flex:none;width:56px;height:12px;margin:0;cursor:pointer;accent-color:#c9a0ff;';
		vol.addEventListener('input', () => setTvVolume(key, Number(vol.value)));
		const volIcon = document.createElement('span');
		volIcon.textContent = '🔉';
		volIcon.style.cssText = 'flex:none;font-size:11px;opacity:.85;';
		bar.append(pause, seek, time, volIcon, vol);
		const mute = small('sce-tv-mute', () => toggleTV(key));
		mute.style.right = '34px';
		const full = small('sce-tv-full', () => {
			fullKey = fullKey === key ? '' : key;
		});
		full.style.right = '4px';
		// (a small player of its own, moved anywhere: like a browser's picture in picture)
		const pop = small('sce-tv-pop', () => {
			popKey = popKey === key ? '' : key;
			if (fullKey === key) {
				fullKey = '';
			}
		});
		// (over every tab and program: the browser's always-on-top window)
		const win = small('sce-tv-win', () => {
			floatTV(key).catch((e) => problem(FEATURE, e));
		});
		const grip = document.createElement('div');
		grip.className = 'sce-tv-grip';
		grip.title = 'Drag to size it';
		grip.style.cssText =
			'position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;pointer-events:auto;' +
			'background:linear-gradient(135deg,transparent 50%,#fffa 50%,#fffa 60%,transparent 60%,transparent 72%,#fffa 72%,#fffa 82%,transparent 82%);';
		// Dragging the popped-out player moves it; dragging its corner sizes it. Only while it's popped out.
		const drag = (/** @type {PointerEvent} */ e, /** @type {boolean} */ sizing) => {
			const s = shown.get(key);
			if (!s || !s.pop || !layer || e.button !== 0) {
				return;
			}
			const t = /** @type {HTMLElement} */ (e.target);
			if (!sizing && t.closest('button, input, .sce-tv-bar, .sce-tv-grip')) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			const box = layer;
			const start = { x: e.clientX, y: e.clientY, place: clampPop(popPlace(), box) };
			const move = (/** @type {PointerEvent} */ m) => {
				const dx = m.clientX - start.x;
				const dy = m.clientY - start.y;
				const v = sizing ? { ...start.place, w: start.place.w + dx } : { ...start.place, x: start.place.x + dx, y: start.place.y + dy };
				savePopPlace(clampPop(v, box));
			};
			const up = () => {
				w.removeEventListener('pointermove', move, true);
				w.removeEventListener('pointerup', up, true);
			};
			w.addEventListener('pointermove', move, true);
			w.addEventListener('pointerup', up, true);
		};
		el.addEventListener('pointerdown', (e) => drag(e, false));
		// Closing it can't be missed: a red ✕ always showing in its corner, and a double click, put the TV back.
		const putBack = () => {
			if (floating && floating.key === key) {
				floating.win.close();
			} else if (popKey === key) {
				popKey = '';
			}
		};
		const chat = document.createElement('div');
		chat.className = 'sce-tv-chat';
		chat.style.cssText =
			'position:absolute;top:0;right:0;bottom:0;box-sizing:border-box;display:flex;flex-direction:column;background:#101016;color:#eee;' +
			'border-left:1px solid #333;pointer-events:auto;z-index:2;font:15px sans-serif;';
		chat.hidden = true;
		const chatHead = document.createElement('div');
		chatHead.textContent = 'Room chat';
		chatHead.style.cssText = 'flex:none;padding:10px 12px;font-weight:bold;border-bottom:1px solid #333;';
		const chatLog = document.createElement('div');
		chatLog.className = 'sce-tv-chatlog';
		chatLog.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:6px 8px;color:#eee;background:#101016;';
		const chatIn = document.createElement('input');
		chatIn.className = 'sce-tv-chatin';
		chatIn.type = 'text';
		chatIn.maxLength = 1000;
		chatIn.placeholder = 'Talk in the room...';
		chatIn.style.cssText = 'flex:none;margin:8px;padding:8px 10px;border:1px solid #444;border-radius:16px;background:#1d1d26;color:#fff;font:14px sans-serif;outline:none;';
		chatIn.addEventListener('keydown', (e) => {
			// (Esc still closes full screen; every other key is the box's, not the game's)
			if (e.key === 'Escape') {
				return;
			}
			e.stopPropagation();
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				if (sayFromPanel(chatIn.value)) {
					chatIn.value = '';
				}
			}
		});
		for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'wheel', 'keyup', 'keypress', 'input']) {
			chat.addEventListener(type, (e) => e.stopPropagation());
		}
		// (its left edge, dragged, makes it wider or narrower; kept in this browser)
		const chatEdge = document.createElement('div');
		chatEdge.className = 'sce-tv-chatedge';
		chatEdge.title = 'Drag to make the chat wider or narrower';
		chatEdge.style.cssText = 'position:absolute;left:-4px;top:0;bottom:0;width:8px;cursor:ew-resize;z-index:1;';
		chatEdge.addEventListener('pointerdown', (e) => {
			if (e.button !== 0 || !layer) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			const box = layer;
			const x0 = e.clientX;
			const w0 = chat.getBoundingClientRect().width;
			const move = (/** @type {PointerEvent} */ m) => {
				const v = Math.max(200, Math.min(w0 - (m.clientX - x0), box.clientWidth * 0.6));
				try {
					localStorage.setItem(CHAT_W_KEY, String(Math.round(v)));
				} catch {
					// (blocked storage: it springs back)
				}
			};
			const up = () => {
				w.removeEventListener('pointermove', move, true);
				w.removeEventListener('pointerup', up, true);
			};
			w.addEventListener('pointermove', move, true);
			w.addEventListener('pointerup', up, true);
		});
		chat.append(chatEdge, chatHead, chatLog, chatIn);
		// (shows or hides the chat beside a full-screen TV)
		const chatButton = small('sce-tv-chatbtn', () => setChatShown(!chatShown()));
		chatButton.textContent = '💬';
		const close = small('sce-tv-close', putBack);
		close.textContent = '✕';
		close.title = 'Close: puts the TV back on the character';
		close.style.cssText += 'left:4px;right:auto;z-index:2;background:#d33;opacity:1;font-weight:bold;box-shadow:0 0 0 2px #fff8;';
		close.addEventListener('mouseleave', () => (close.style.opacity = '1'));
		close.hidden = true;
		el.addEventListener('dblclick', (e) => {
			if (shown.get(key)?.pop && !/** @type {HTMLElement} */ (e.target).closest('button, input, .sce-tv-bar')) {
				e.stopPropagation();
				putBack();
			}
		});
		grip.addEventListener('pointerdown', (e) => drag(e, true));
		for (const type of ['mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'wheel']) {
			// (clicks on the popped-out player never reach the game under it)
			el.addEventListener(type, (e) => {
				if (shown.get(key)?.pop) {
					e.stopPropagation();
				}
			});
		}
		// (hides every TV for you alone, for anyone who never finds the setting)
		const off = small('sce-tv-off', () => setTVs(false));
		off.style.right = '64px';
		off.textContent = '🙈';
		off.title = 'Hide all TVs (only for you: everyone else still sees them)';
		// (on and off for everyone in the room, for whoever may change the TV)
		const powerButton = small('sce-tv-power', () => {
			const C = ownerOf(key);
			const s = shown.get(key);
			if (C && s) {
				power(C, tvOf(C) || s.item, !s.on);
			}
		});
		powerButton.textContent = '⏻';
		ui.append(powerButton, off, mute, win, pop, chatButton, full, bar, grip);
		el.append(screen, led, chat, ui, close);
		return el;
	}

	/** What a TV shows: nothing (off), a YouTube player, a video, or a note that the link can't play. */
	function fill(/** @type {any} */ s) {
		const screen = /** @type {HTMLElement} */ (s.el.querySelector('.sce-tv-screen'));
		const led = /** @type {HTMLElement} */ (s.el.querySelector('.sce-tv-led'));
		const prop = s.item.Property || {};
		const link = String(prop.Text || '');
		s.playing = showing(s);
		const paused = stateOf(s.item).mode === 'pause';
		s.media = null;
		s.volume = undefined;
		screen.replaceChildren();
		const on = !!link && prop.Text2 !== 'off';
		s.on = on;
		led.style.background = on ? '#3c6' : '#c43';
		if (!on) {
			return;
		}
		if (!allowed(s)) {
			// Someone else's TV: nothing of it loads until you choose to watch it.
			const ask = document.createElement('div');
			ask.className = 'sce-tv-ask';
			ask.style.cssText =
				'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#ccc;font:13px sans-serif;text-align:center;padding:30px 6px 6px;';
			const C = ownerOf(s.key);
			const who = C ? `${nick(C)}'s` : "This person's";
			const choice = (/** @type {string} */ text, /** @type {string} */ cls, /** @type {string} */ tip, /** @type {() => void} */ act) => {
				const b = document.createElement('button');
				b.className = cls;
				b.type = 'button';
				b.textContent = text;
				b.title = tip;
				b.style.cssText =
					'pointer-events:auto;cursor:pointer;border:0;border-radius:14px;padding:5px 11px;background:#3a3a46;color:#fff;font:13px sans-serif;';
				for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'wheel']) {
					b.addEventListener(type, (e) => e.stopPropagation());
				}
				b.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();
					act();
				});
				return b;
			};
			const note = document.createElement('div');
			const row = document.createElement('div');
			row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center;';
			if (always()[s.key] === 'off') {
				note.textContent = `🚫 You chose never to see ${who} TV`;
				row.append(choice('Undo', 'sce-tv-undo', 'Ask me again about their TV', () => setAlways(s.key, '')));
			} else {
				note.textContent = `📺 ${who} TV is playing something`;
				row.append(
					choice('▶ Watch', 'sce-tv-watch', 'Watch this, only for you (a new room asks again)', () => watching.add(`${s.key}|${link}`)),
					choice('Always', 'sce-tv-always', "Always play this person's TVs for you, in every room", () => setAlways(s.key, 'on')),
					choice('Never', 'sce-tv-never', "Never show this person's TVs to you", () => setAlways(s.key, 'off')),
				);
			}
			ask.append(note, row);
			screen.append(ask);
			return;
		}
		const what = parseLink(link);
		const from = wantedAt(s.item);
		if (!what) {
			const note = document.createElement('div');
			note.textContent = "This link can't play here";
			note.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#bbb;font:14px sans-serif;';
			screen.append(note);
			return;
		}
		if ('yt' in what) {
			const f = document.createElement('iframe');
			const q = new URLSearchParams({
				autoplay: paused ? '0' : '1',
				start: String(Math.floor(from)),
				controls: '0',
				rel: '0',
				playsinline: '1',
				enablejsapi: '1',
				loop: '1',
				playlist: what.yt,
				origin: location.origin,
			});
			f.src = `${YT_ORIGIN}/embed/${what.yt}?${q}`;
			f.allow = 'autoplay; encrypted-media';
			f.referrerPolicy = 'strict-origin-when-cross-origin';
			f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none;';
			f.addEventListener('load', () => {
				// (nothing is sent before the player's page has loaded: until then the frame is still a blank page of
				// this site, and the browser refuses messages addressed to YouTube with a console error)
				if (s.media) {
					s.media.ready = true;
				}
				// (the player takes commands once it has loaded: ask it to report where it is, and tell it the volume a
				// few times while it starts)
				for (const t of [0, 1000, 3000]) {
					setTimeout(() => {
						s.volume = undefined;
						f.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT_ORIGIN);
					}, t);
				}
			});
			s.media = { yt: f, time: -1, duration: 0, state: -1, at: 0, synced: 0 };
			screen.append(f);
			return;
		}
		const v = document.createElement('video');
		v.src = what.file;
		v.autoplay = !paused;
		v.loop = true;
		v.playsInline = true;
		v.preload = 'auto';
		v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;pointer-events:none;';
		v.addEventListener('loadedmetadata', () => {
			if (Number.isFinite(v.duration) && v.duration > 0) {
				v.currentTime = from % v.duration;
			}
		});
		v.addEventListener('error', () => {
			screen.replaceChildren();
			const note = document.createElement('div');
			note.textContent = "This video can't play here";
			note.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#bbb;font:14px sans-serif;';
			screen.append(note);
		});
		s.media = { video: v };
		screen.append(v);
		if (paused) {
			return;
		}
		v.play().catch(() => {
			// (the browser won't start sound before the page was clicked: start it quiet; the next check sets the sound)
			v.muted = true;
			v.play().catch(() => {});
		});
	}

	const YT_ORIGIN = 'https://www.youtube-nocookie.com';
	// What each YouTube player reports (where it is, how long the video is, playing or not).
	w.addEventListener('message', onPlayerMessage);
	/** A YouTube player's report (where it is, how long, playing or not), from this page or the floating window. */
	function onPlayerMessage(/** @type {MessageEvent} */ e) {
		if (e.origin !== YT_ORIGIN || typeof e.data !== 'string') {
			return;
		}
		for (const s of shown.values()) {
			const m = s.media;
			if (!m || !m.yt || e.source !== m.yt.contentWindow) {
				continue;
			}
			try {
				const d = JSON.parse(e.data);
				const info = d && d.info;
				if (info && typeof info === 'object') {
					if (typeof info.currentTime === 'number') {
						m.time = info.currentTime;
						m.at = performance.now();
					}
					if (typeof info.duration === 'number') {
						m.duration = info.duration;
					}
					if (typeof info.playerState === 'number') {
						m.state = info.playerState;
					}
				}
			} catch {
				// (not one of the player's reports)
			}
		}
	}

	/**
	 * Keeps a TV where everyone else is: where the video should be now (from when it started, on the server's clock,
	 * round again for a looping one); a TV that fell behind or ran ahead by more than SYNC_OFF jumps there, and one that
	 * stopped plays again. Live streams have no length and are left alone.
	 */
	function keepInSync(/** @type {any} */ s) {
		const m = s.media;
		const st = stateOf(s.item);
		if (!m || st.mode === 'off' || (st.mode === 'play' && !st.start) || performance.now() - (m.synced || 0) < SYNC_MS) {
			return;
		}
		m.synced = performance.now();
		const since = wantedAt(s.item);
		const paused = st.mode === 'pause';
		// (paused: held exactly there; playing: near enough, as a looping video goes round)
		const off = paused ? 0.4 : SYNC_OFF;
		if (m.video) {
			const v = m.video;
			if (!Number.isFinite(v.duration) || v.duration <= 0 || v.seeking || v.readyState < 1) {
				return;
			}
			const want = paused ? Math.min(since, v.duration) : since % v.duration;
			if (Math.abs(v.currentTime - want) > off && (paused || Math.abs(v.currentTime - want) < v.duration - off)) {
				v.currentTime = want;
			}
			if (paused && !v.paused) {
				v.pause();
			} else if (!paused && v.paused && !v.ended) {
				v.play().catch(() => {});
			}
			return;
		}
		if (m.yt && m.ready && m.duration > 0 && m.time >= 0) {
			const send = (/** @type {string} */ func, /** @type {any[]} */ args = []) =>
				m.yt.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), YT_ORIGIN);
			// (states: 1 playing, 2 paused, 3 loading, 5 not started)
			if (m.state === 3) {
				return;
			}
			const now = m.time + (m.state === 1 ? (performance.now() - m.at) / 1000 : 0);
			const want = paused ? Math.min(since, m.duration) : since % m.duration;
			if (Math.abs(now - want) > (paused ? 1 : SYNC_OFF) && (paused || Math.abs(now - want) < m.duration - SYNC_OFF)) {
				send('seekTo', [want, true]);
			}
			if (paused && m.state === 1) {
				send('pauseVideo');
			} else if (!paused && (m.state === 2 || m.state === 5 || m.state === -1)) {
				send('playVideo');
			}
		}
	}

	/** Whether a character is on your blacklist or ghost list (/ignore): their TVs never show for you, nothing loads. */
	function blocked(/** @type {any} */ C) {
		const P = w.Player;
		const listed = (/** @type {any} */ list) => Array.isArray(list) && !!C && list.includes(C.MemberNumber);
		return !!C && !C.IsPlayer() && !!P && (listed(P.BlackList) || listed(P.GhostList));
	}
	/** The character a TV on screen belongs to (in the room), or null. */
	function ownerOf(/** @type {string} */ key) {
		const list = Array.isArray(w.ChatRoomCharacter) ? w.ChatRoomCharacter : [];
		return list.find((/** @type {any} */ c) => String(c.MemberNumber ?? `npc${c.CharacterID}`) === key) || null;
	}
	/**
	 * Whether you may switch a character's TV on and off, as the game lets you change their items: always your own; someone
	 * else's when they let you use items on them and the TV isn't blocked or limited for you.
	 */
	function mayPower(/** @type {any} */ C, /** @type {any} */ item) {
		if (!C || !item) {
			return false;
		}
		if (C.IsPlayer()) {
			return true;
		}
		const blocked = typeof w.InventoryBlockedOrLimited === 'function' && w.InventoryBlockedOrLimited(C, item);
		return C.AllowItem !== false && !blocked;
	}
	/** Switches a TV off for everyone (its link stays), or on again from the start, and tells the room. */
	function power(/** @type {any} */ C, /** @type {any} */ item, /** @type {boolean} */ on) {
		const prop = item.Property || {};
		if (!prop.Text || !mayPower(C, item)) {
			return;
		}
		item.Property = { ...prop, Text2: on ? String(Math.round(serverNow())) : 'off' };
		if (typeof w.ChatRoomCharacterItemUpdate === 'function') {
			w.ChatRoomCharacterItemUpdate(C, GROUP);
		}
		const tv = C.IsPlayer() ? 'the TV' : `${nick(C)}'s TV`;
		say(`${nick(w.Player)} turns ${tv} ${on ? 'on' : 'off'}.`);
	}

	/** Where a TV's video is now (seconds), as its player says. */
	function timeOf(/** @type {any} */ s) {
		const m = s.media;
		if (m && m.video) {
			return m.video.currentTime || 0;
		}
		if (m && m.yt && m.time >= 0) {
			return m.time + (m.state === 1 ? (performance.now() - m.at) / 1000 : 0);
		}
		return 0;
	}
	/** How long a TV's video is (seconds); 0 while unknown, and for live streams. */
	function lengthOf(/** @type {any} */ s) {
		const m = s.media;
		const d = m && m.video ? m.video.duration : m && m.yt ? m.duration : 0;
		return Number.isFinite(d) && d > 0 ? d : 0;
	}
	/** 75 -> "1:15", 3725 -> "1:02:05". */
	function clock(/** @type {number} */ sec) {
		const t = Math.max(0, Math.floor(sec || 0));
		const h = Math.floor(t / 3600);
		const mm = Math.floor((t % 3600) / 60);
		const ss = String(t % 60).padStart(2, '0');
		return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
	}
	/** Sets where a TV is for everyone (Text2) and sends it to the room; this TV follows at once. */
	function setPlace(/** @type {any} */ C, /** @type {any} */ item, /** @type {any} */ s, /** @type {string} */ text2) {
		if (!(item.Property || {}).Text || !mayPower(C, item)) {
			return;
		}
		item.Property = { ...(item.Property || {}), Text2: text2 };
		if (typeof w.ChatRoomCharacterItemUpdate === 'function') {
			w.ChatRoomCharacterItemUpdate(C, GROUP);
		}
		if (s.media) {
			s.media.synced = 0;
		}
	}
	/** Pauses a TV for everyone where it is now, or plays it on from there. */
	function togglePause(/** @type {any} */ C, /** @type {any} */ item, /** @type {any} */ s) {
		const st = stateOf(item);
		if (st.mode === 'off') {
			return;
		}
		if (st.mode === 'pause') {
			setPlace(C, item, s, String(Math.round(serverNow() - st.at * 1000)));
		} else {
			const d = lengthOf(s);
			const at = d ? wantedAt(item) % d : timeOf(s);
			setPlace(C, item, s, `p${at.toFixed(2)}`);
		}
	}
	/** Moves a TV to `sec` seconds into its video for everyone, paused or playing as it was. */
	function seekTo(/** @type {any} */ C, /** @type {any} */ item, /** @type {any} */ s, /** @type {number} */ sec) {
		const st = stateOf(item);
		if (st.mode === 'off') {
			return;
		}
		setPlace(C, item, s, st.mode === 'pause' ? `p${sec.toFixed(2)}` : String(Math.round(serverNow() - sec * 1000)));
	}
	/** Shows a TV's controls while the mouse moves over it (or one of them is in use), and fills its bar. */
	function controls(/** @type {any} */ s) {
		const ui = /** @type {HTMLElement | null} */ (s.el.querySelector('.sce-tv-ui'));
		if (!ui) {
			return;
		}
		const r = s.el.getBoundingClientRect();
		const m = s.float ? winMouse : mouse;
		const over = m.x >= r.left && m.x <= r.right && m.y >= r.top && m.y <= r.bottom;
		if (over && m.at > (s.uiAt || 0)) {
			s.uiAt = m.at;
		}
		const show = !!s.dragging || performance.now() - (s.uiAt || -1e9) < UI_MS || (over && ui.matches(':hover'));
		// (a small TV, as on the map, shows only ⛶: full screen has every control)
		const tiny = !s.full && !s.pop && !s.float && r.width < 170;
		for (const cls of ['.sce-tv-power', '.sce-tv-off', '.sce-tv-mute']) {
			const b = /** @type {HTMLElement | null} */ (s.el.querySelector(cls));
			if (b && tiny) {
				b.hidden = true;
			}
		}
		// (the buttons showing sit side by side from the right: ⛶, ⧉, 📌, 🔊, 🙈, ⏻)
		const side = s.full && s.chatW ? s.chatW : 0;
		let right = s.full ? 10 + side : 4;
		for (const cls of ['.sce-tv-full', '.sce-tv-chatbtn', '.sce-tv-pop', '.sce-tv-win', '.sce-tv-mute', '.sce-tv-off', '.sce-tv-power']) {
			const b = /** @type {HTMLElement | null} */ (s.el.querySelector(cls));
			if (b && !b.hidden) {
				b.style.right = `${right}px`;
				right += s.full ? 34 : 30;
			}
		}
		const grip = /** @type {HTMLElement | null} */ (s.el.querySelector('.sce-tv-grip'));
		if (grip) {
			grip.hidden = !s.pop;
		}
		ui.style.opacity = show ? '1' : '0';
		ui.style.visibility = show ? 'visible' : 'hidden';
		const bar = /** @type {HTMLElement | null} */ (s.el.querySelector('.sce-tv-bar'));
		if (!bar) {
			return;
		}
		const C = ownerOf(s.key);
		const d = lengthOf(s);
		const st = stateOf(s.item);
		// (the bar shows to everyone for the volume; pause and the time bar only to whoever may change the TV)
		const may = mayPower(C, s.item);
		bar.hidden = tiny || !s.media || st.mode === 'off';
		bar.style.bottom = s.full ? '14px' : '6px';
		// (room for the popped-out player's corner grip)
		bar.style.right = s.full ? `${14 + (s.chatW || 0)}px` : s.pop ? '20px' : '6px';
		bar.style.left = s.full ? '14px' : '6px';
		bar.style.fontSize = s.full ? '13px' : '11px';
		const seek = /** @type {HTMLInputElement} */ (bar.querySelector('.sce-tv-seek'));
		const time = /** @type {HTMLElement} */ (bar.querySelector('.sce-tv-time'));
		seek.hidden = !d || !may;
		/** @type {HTMLElement} */ (bar.querySelector('.sce-tv-pause')).hidden = !may;
		const vol = /** @type {HTMLInputElement} */ (bar.querySelector('.sce-tv-vol'));
		if (s.el.ownerDocument.activeElement !== vol) {
			vol.value = String(tvVolume(s.key));
		}
		label(/** @type {HTMLElement} */ (bar.querySelector('.sce-tv-pause')), st.mode === 'pause' ? '▶' : '⏸', st.mode === 'pause' ? 'Play (for everyone)' : 'Pause (for everyone)');
		if (!s.dragging) {
			const at = timeOf(s);
			if (d) {
				seek.value = String(Math.round(((at % d) / d) * 1000));
			}
			time.textContent = d ? `${clock(at % d)} / ${clock(d)}` : 'live';
		}
	}

	/** A small button's label and tip, set only when they change. */
	function label(/** @type {HTMLElement | null} */ b, /** @type {string} */ text, /** @type {string} */ tip) {
		if (b && b.textContent !== text) {
			b.textContent = text;
			b.title = tip;
		}
	}
	/** Sets a TV's sound when it changed. */
	function sound(/** @type {any} */ s) {
		// (its buttons: muted here or not, and full screen or back; shown only while it plays, and always in full screen)
		const off = mutedTVs().has(s.key);
		const mute = /** @type {HTMLElement | null} */ (s.el.querySelector('.sce-tv-mute'));
		const full = /** @type {HTMLElement | null} */ (s.el.querySelector('.sce-tv-full'));
		label(mute, off ? '🔇' : '🔊', off ? 'This TV is muted for you: click to hear it' : 'Mute this TV for you');
		label(full, s.full ? '✕' : '⛶', s.full ? 'Close full screen (Esc)' : 'Full screen (for you)');
		const pop = /** @type {HTMLElement | null} */ (s.el.querySelector('.sce-tv-pop'));
		label(pop, s.pop ? '↩' : '⧉', s.pop ? 'Put it back on the character' : 'Pop out: a small player you can move anywhere (for you)');
		if (pop) {
			pop.hidden = (!s.on && !s.pop) || s.float;
			pop.style.top = s.full ? '10px' : '4px';
		}
		const chatButton = /** @type {HTMLElement | null} */ (s.el.querySelector('.sce-tv-chatbtn'));
		label(chatButton, '💬', chatShown() ? 'Hide the room chat' : 'Show the room chat beside the video');
		if (chatButton) {
			chatButton.hidden = !s.full;
			chatButton.style.top = '10px';
			chatButton.style.opacity = chatShown() ? '1' : '.6';
		}
		const close = /** @type {HTMLElement | null} */ (s.el.querySelector('.sce-tv-close'));
		if (close) {
			close.hidden = !s.pop && !s.float;
		}
		const win = /** @type {HTMLElement | null} */ (s.el.querySelector('.sce-tv-win'));
		label(win, s.float ? '↩' : '📌', s.float ? 'Put it back in the game' : 'Float it over every tab and program (for you)');
		if (win) {
			win.hidden = !canFloat() || (!s.on && !s.float);
			win.style.top = s.full ? '10px' : '4px';
		}
		for (const b of [mute, full]) {
			if (b) {
				b.hidden = !s.media && !s.full;
				b.style.top = s.full ? '10px' : '4px';
			}
		}
		// (⛶ also while it asks whether to watch: on a small TV, the question is answered full screen)
		if (full && s.on) {
			full.hidden = false;
		}
		// (its own window can be made big by the browser: no ⛶ there)
		if (full && s.float) {
			full.hidden = true;
		}
		const powerButton = /** @type {HTMLElement | null} */ (s.el.querySelector('.sce-tv-power'));
		if (powerButton) {
			const prop = s.item.Property || {};
			label(powerButton, '⏻', s.on ? 'Turn this TV off (for everyone)' : 'Turn this TV on again (for everyone)');
			powerButton.hidden = !prop.Text || !mayPower(ownerOf(s.key), s.item);
			powerButton.style.top = s.full ? '10px' : '4px';

			powerButton.style.color = s.on ? '#fff' : '#f66';
		}
		const offButton = /** @type {HTMLElement | null} */ (s.el.querySelector('.sce-tv-off'));
		if (offButton) {
			offButton.hidden = !(s.item.Property || {}).Text && !s.full;
			offButton.style.top = s.full ? '10px' : '4px';

		}

		const v = s.fresh === false ? 0 : volume(s.key);
		if (!s.media || s.volume === v) {
			return;
		}
		s.volume = v;
		if (s.media.video) {
			s.media.video.volume = v;
			s.media.video.muted = v === 0;
		} else if (s.media.yt && s.media.ready && s.media.yt.contentWindow) {
			const send = (/** @type {string} */ func, /** @type {any[]} */ args = []) =>
				s.media.yt.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), YT_ORIGIN);
			send('setVolume', [Math.round(v * 100)]);
			send(v === 0 ? 'mute' : 'unMute');
		}
	}

	/** Every frame: puts each TV drawn lately where its character is, and stops those no longer drawn. */
	function frame() {
		requestAnimationFrame(frame);
		tick();
	}
	// (a hidden tab gets no animation frames: the TVs keep in sync on a timer then, for the floating one)
	setInterval(() => {
		if (document.hidden) {
			tick();
		}
	}, 300);
	function tick() {
		if (!working(FEATURE) || !tvsOn()) {
			if (floating) {
				floating.win.close();
			}
			for (const s of shown.values()) {
				s.el?.remove();
			}
			shown.clear();
			return;
		}
		try {
			const now = performance.now();
			// (a new room asks again)
			const room = (w.ChatRoomData && w.ChatRoomData.Name) || '';
			if (room !== watchedRoom) {
				watchedRoom = room;
				watching.clear();
			}
			const at = shown.size ? tvLayer() : null;
			// A TV in full screen stays while its character is in the room wearing it, drawn or not (a menu over the
			// room, for one); then it closes.
			const fullTV = fullKey ? shown.get(fullKey) : null;
			if (fullTV) {
				const C = w.CurrentScreen === 'ChatRoom' && Array.isArray(w.ChatRoomCharacter)
					? w.ChatRoomCharacter.find((/** @type {any} */ c) => String(c.MemberNumber ?? `npc${c.CharacterID}`) === fullKey)
					: null;
				const item = tvOf(C);
				if (item) {
					fullTV.item = item;
					fullTV.seen = now;
				} else {
					fullKey = '';
				}
			} else {
				fullKey = '';
			}
			// The popped-out TV stays while its character is in the room wearing it, on whatever screen (a profile, a
			// menu, the wardrobe); then it goes.
			const inRoom = typeof w.ServerPlayerIsInChatRoom === 'function' ? w.ServerPlayerIsInChatRoom() : w.CurrentScreen === 'ChatRoom';
			/** Whether a TV taken out of the room view (popped out or floating) stays: its character there with it on. */
			const stays = (/** @type {string} */ key) => {
				const t = key ? shown.get(key) : null;
				const C = t && inRoom ? ownerOf(key) : null;
				const item = C && !blocked(C) ? tvOf(C) : null;
				if (!t || !item || !(item.Property || {}).Text) {
					return false;
				}
				t.item = item;
				t.seen = now;
				return true;
			};
			if (!stays(popKey)) {
				popKey = '';
			}
			if (floating && !stays(floating.key)) {
				floating.win.close();
				floating = null;
			}
			if (at) {
				// (over the game's own page elements while a TV fills the screen or floats over it)
				at.layer.style.zIndex = fullKey || popKey ? '2147483000' : '';
			}
			for (const [key, s] of shown) {
				s.float = !!floating && floating.key === key;
				s.full = key === fullKey && !s.float;
				s.pop = key === popKey && !s.full && !s.float;
				const fresh = s.full || s.pop || s.float || now - s.seen < 400;
				s.fresh = fresh;
				const owner = fresh ? null : ownerOf(key);
				const gone =
					!fresh && (w.CurrentScreen !== 'ChatRoom' || !tvOf(owner) || !(tvOf(owner).Property || {}).Text || blocked(owner));
				// (only the popped-out TV plays outside the chat room screen)
				const away = w.CurrentScreen !== 'ChatRoom' && !s.pop && !s.float;
				if (!at || gone || now - s.seen > KEEP_MS) {
					if (s.float) {
						floating?.win.close();
						floating = null;
					}
					s.el?.remove();
					shown.delete(key);
					continue;
				}
				if (!s.el) {
					s.el = makeTV(key);
					s.el.dataset.member = key;
					at.layer.append(s.el);
				}
				if (s.playing !== showing(s)) {
					fill(s);
				}
				s.el.style.visibility = fresh && !away ? 'visible' : 'hidden';
				if (s.float) {
					// Fills its own window.
					Object.assign(s.el.style, { left: '0', top: '0', width: '100%', height: '100%', padding: '0', zIndex: '', pointerEvents: 'auto', borderRadius: '0', cursor: '' });
				} else if (s.full) {
					// Fills the game's screen, on top of everything; clicks on it don't reach the game. The room's chat
					// sits beside the video (💬 hides it).
					s.chatW = chatShown() && w.CurrentScreen === 'ChatRoom' ? chatWidth(at.layer.clientWidth) : 0;
					Object.assign(s.el.style, { left: '0', top: '0', width: '100%', height: '100%', padding: `0 ${s.chatW}px 0 0`, zIndex: '2', pointerEvents: 'auto', borderRadius: '0' });
				} else if (s.pop) {
					// Its own little player, where you put it, over everything; dragged to move, its corner to size.
					const v = clampPop(popPlace(), at.layer);
					Object.assign(s.el.style, {
						left: `${v.x}px`,
						top: `${v.y}px`,
						width: `${v.w}px`,
						height: `${popHeight(v.w)}px`,
						padding: '4px 4px 6px',
						zIndex: '3',
						pointerEvents: 'auto',
						borderRadius: '8px',
						cursor: 'move',
					});
				} else {
					const [x0, y0, x1, y1] = s.box.map((v) => v * at.k);
					const bezel = Math.max(2, TV.bezel * s.scale * at.k);
					Object.assign(s.el.style, {
						left: `${x0}px`,
						top: `${y0}px`,
						width: `${x1 - x0}px`,
						height: `${y1 - y0}px`,
						padding: `${bezel}px ${bezel}px ${bezel * 1.4}px`,
						zIndex: '',
						pointerEvents: 'none',
						borderRadius: '6px',
						cursor: '',
					});
				}
				const chat = /** @type {HTMLElement | null} */ (s.el.querySelector('.sce-tv-chat'));
				if (chat) {
					const on = !!s.full && !!s.chatW;
					if (!on && chat.contains(s.el.ownerDocument.activeElement)) {
						/** @type {HTMLElement} */ (s.el.ownerDocument.activeElement).blur();
					}
					chat.hidden = !on;
					if (on) {
						chat.style.width = `${s.chatW}px`;
						mirrorChat(/** @type {HTMLElement} */ (chat.querySelector('.sce-tv-chatlog')));
					}
				}
				if (!s.full) {
					s.chatW = 0;
				}
				sound(s);
				controls(s);
				keepInSync(s);
			}
		} catch (e) {
			problem(FEATURE, e);
		}
	}

	// ---- The TV's menu (the item's own screen)
	/** What the menu last said. */
	let status = '';
	/** @type {any} A change waiting to go out (size and place clicks are sent together, a moment after the last). */
	let pending = null;

	function focused() {
		const item = w.DialogFocusItem;
		return item && item.Asset && item.Asset.Name === NAME ? item : null;
	}
	/** Changes the TV being looked at in the menu, and tells the room. */
	function change(/** @type {Record<string, string>} */ props, now = true) {
		const item = focused();
		const C = typeof w.CharacterGetCurrent === 'function' ? w.CharacterGetCurrent() : null;
		if (!item || !C) {
			return;
		}
		item.Property = { ...(item.Property || {}), ...props };
		clearTimeout(pending);
		const send = () => {
			if (typeof w.ChatRoomCharacterItemUpdate === 'function') {
				w.ChatRoomCharacterItemUpdate(C, GROUP);
			}
		};
		if (now) {
			send();
		} else {
			pending = setTimeout(send, 600);
		}
	}
	/** An action line everyone in the room reads, with or without SCE. */
	function say(/** @type {string} */ text) {
		if (w.CurrentScreen === 'ChatRoom' && typeof w.ServerSend === 'function') {
			w.ServerSend('ChatRoomChat', { Content: 'Beep', Type: 'Action', Dictionary: [{ Tag: 'Beep', Text: text }] });
		}
	}
	/** The member number of whose TV the menu shows (how mutes are kept). */
	function menuKey() {
		const C = typeof w.CharacterGetCurrent === 'function' ? w.CharacterGetCurrent() : null;
		return C ? String(C.MemberNumber ?? `npc${C.CharacterID}`) : '';
	}
	const nick = (/** @type {any} */ C) => (typeof w.CharacterNickname === 'function' ? w.CharacterNickname(C) : C.Name);
	function whose() {
		const C = typeof w.CharacterGetCurrent === 'function' ? w.CharacterGetCurrent() : null;
		return !C || C.IsPlayer() ? 'the TV' : `${nick(C)}'s TV`;
	}

	const BUTTONS = {
		play: [1100, 540, 380, 64],
		off: [1520, 540, 380, 64],
		smaller: [1100, 650, 90, 64],
		bigger: [1390, 650, 90, 64],
		left: [1520, 650, 88, 64],
		up: [1617, 650, 88, 64],
		down: [1714, 650, 88, 64],
		right: [1811, 650, 89, 64],
		reset: [1100, 760, 380, 64],
		mute: [1520, 760, 380, 64],
		muteThis: [1100, 840, 380, 56],
		tvs: [1520, 840, 380, 56],
	};
	const inside = (/** @type {number[]} */ b) => typeof w.MouseIn === 'function' && w.MouseIn(b[0], b[1], b[2], b[3]);

	itemMenus.set(NAME, {
		Load(/** @type {any} */ data, /** @type {Function} */ next) {
			const r = typeof next === 'function' ? next() : undefined;
			status = '';
			const item = focused();
			const input = w.ElementCreateInput('SCETVLink', 'text', (item && item.Property && item.Property.Text) || '', MAX_LINK);
			if (input) {
				input.placeholder = 'YouTube or .mp4 link';
				input.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						play();
					}
				});
			}
			return r;
		},
		Draw(/** @type {any} */ data, /** @type {Function} */ next) {
			if (typeof next === 'function') {
				next();
			}
			const item = focused();
			if (!item) {
				return;
			}
			const place = placeOf(item);
			w.ElementPosition('SCETVLink', 1500, 470, 800, 60);
			const B = BUTTONS;
			w.DrawButton(...B.play, '▶ Play', 'White');
			w.DrawButton(...B.off, '■ Turn off', item.Property && item.Property.Text && item.Property.Text2 !== 'off' ? 'White' : '#bbb');
			w.DrawButton(...B.smaller, '−', place.size > SIZE.min ? 'White' : '#bbb');
			w.DrawText(`Size ${place.size}%`, 1290, 682, 'White', 'Black');
			w.DrawButton(...B.bigger, '+', place.size < SIZE.max ? 'White' : '#bbb');
			w.DrawButton(...B.left, '←', 'White');
			w.DrawButton(...B.up, '↑', 'White');
			w.DrawButton(...B.down, '↓', 'White');
			w.DrawButton(...B.right, '→', 'White');
			w.DrawButton(...B.reset, 'Reset size and place', 'White');
			w.DrawButton(...B.mute, muted() ? '🔇 TV sound off (for me)' : '🔊 TV sound on (for me)', 'White');
			const owner = menuKey();
			w.DrawButton(...B.muteThis, mutedTVs().has(owner) ? '🔇 This TV muted for me' : '🔊 Mute this TV (for me)', 'White');
			w.DrawButton(...B.tvs, tvsOn() ? '🙈 Hide all TVs (for me)' : '📺 Show TVs again (for me)', 'White');
			w.DrawText('A YouTube link, or a link to a video file (.mp4, .webm)', 1500, 935, 'White', 'Black');
			if (status || !tvsOn()) {
				w.DrawText(status || 'TVs are switched off in your SCE settings: others still see this one.', 1500, 975, '#ffd479', 'Black');
			}
		},
		Click(/** @type {any} */ data, /** @type {Function} */ next) {
			const item = focused();
			if (!item) {
				return typeof next === 'function' ? next() : undefined;
			}
			const B = BUTTONS;
			const place = placeOf(item);
			const move = (/** @type {number} */ size, /** @type {number} */ x, /** @type {number} */ y) =>
				change({ Text3: `${size},${x},${y}` }, false);
			if (inside(B.play)) {
				play();
			} else if (inside(B.off)) {
				if (item.Property && item.Property.Text && item.Property.Text2 !== 'off') {
					// (the link stays: ⏻ on the TV or Play switches it on again)
					change({ Text2: 'off' });
					status = 'The TV is off.';
					say(`${nick(w.Player)} turns ${whose()} off.`);
				}
			} else if (inside(B.smaller)) {
				move(Math.max(SIZE.min, place.size - SIZE.step), place.x, place.y);
			} else if (inside(B.bigger)) {
				move(Math.min(SIZE.max, place.size + SIZE.step), place.x, place.y);
			} else if (inside(B.left)) {
				move(place.size, Math.max(-MOVE.max, place.x - MOVE.step), place.y);
			} else if (inside(B.right)) {
				move(place.size, Math.min(MOVE.max, place.x + MOVE.step), place.y);
			} else if (inside(B.up)) {
				move(place.size, place.x, Math.max(-MOVE.max, place.y - MOVE.step));
			} else if (inside(B.down)) {
				move(place.size, place.x, Math.min(MOVE.max, place.y + MOVE.step));
			} else if (inside(B.reset)) {
				move(100, 0, 0);
			} else if (inside(B.tvs)) {
				setTVs(!tvsOn());
			} else if (inside(B.muteThis)) {
				toggleTV(menuKey());
			} else if (inside(B.mute)) {
				try {
					localStorage.setItem(MUTE_KEY, muted() ? '0' : '1');
				} catch {
					status = "This browser can't keep that setting.";
				}
			} else {
				return typeof next === 'function' ? next() : undefined;
			}
			return true;
		},
		Exit() {
			if (pending) {
				// (a size or place change still waiting goes out now)
				clearTimeout(pending);
				pending = null;
				const C = typeof w.CharacterGetCurrent === 'function' ? w.CharacterGetCurrent() : null;
				if (C && typeof w.ChatRoomCharacterItemUpdate === 'function') {
					w.ChatRoomCharacterItemUpdate(C, GROUP);
				}
			}
			if (typeof w.ElementRemove === 'function') {
				w.ElementRemove('SCETVLink');
			}
		},
	});

	/** Plays the link in the menu's box. */
	function play() {
		const input = /** @type {HTMLInputElement | null} */ (document.getElementById('SCETVLink'));
		const link = input ? input.value.trim() : '';
		if (!link) {
			status = 'Paste a link first.';
			return;
		}
		if (link.length > MAX_LINK || !parseLink(link)) {
			status = "That isn't a YouTube link or a link to a video file.";
			return;
		}
		change({ Text: link, Text2: String(Math.round(serverNow())) });
		status = 'Playing.';
		say(`${nick(w.Player)} turns on ${whose()}.`);
	}

	// Joining a room pauses your own TV for everyone, where it was: the room gets time to react (and choose whether to
	// watch) before anything plays; ▶ plays it. (Checked every second: a room change, a login, a reload into a room.)
	let myRoom = /** @type {string | null} */ (null);
	setInterval(() => {
		try {
			const room = (w.CurrentScreen === 'ChatRoom' && w.ChatRoomData && w.ChatRoomData.Name) || '';
			if (room === myRoom || !working(FEATURE)) {
				return;
			}
			myRoom = room;
			const item = room ? tvOf(w.Player) : null;
			if (!item || !(item.Property || {}).Text || stateOf(item).mode !== 'play') {
				return;
			}
			const s = shown.get(myKey());
			const d = s ? lengthOf(s) : 0;
			const at = d ? wantedAt(item) % d : wantedAt(item);
			item.Property = { ...item.Property, Text2: `p${at.toFixed(2)}` };
			if (typeof w.ChatRoomCharacterItemUpdate === 'function') {
				w.ChatRoomCharacterItemUpdate(w.Player, GROUP);
			}
			if (typeof toast === 'function') {
				toast('📺 Your TV is paused', 'It pauses when you join a room, so everyone has time to react. Press ▶ on it to play it for the room.', 8000);
			}
		} catch (e) {
			problem(FEATURE, e);
		}
	}, 1000);
	hookGame('ServerInfo', 0, FEATURE, (args, next) => {
		const r = next(args);
		const t = args[0] && args[0].Time;
		if (typeof t === 'number' && Number.isFinite(t)) {
			clockGap = t - Date.now();
		}
		return r;
	});
	if (hookGame('DrawCharacter', 0, FEATURE, (args, next) => {
		const r = next(args);
		noteDrawn(args);
		return r;
	})) {
		requestAnimationFrame(frame);
	}
	w.SCETV = { parseLink, placeOf, shown, serverNow, full: () => fullKey, popped: () => popKey, floating: () => floating && floating.key };
})();
