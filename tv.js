// SCE TV: an HD TV (ItemMisc/SlimeTV) that plays a YouTube link or a video file. The TV is not one of the game's
// pictures: it is a page element laid over the game's screen where the character stands, so the video keeps its own
// resolution at any size. sce.js loads this file and hands it its guarded hooks (window.SCE.kit), so a hook that fails
// switches the TV off instead of breaking the game.
//
// What plays is kept on the item, so everyone in the room with SCE sees the same thing:
//   Text   the link
//   Text2  when it started (ms), so everyone watches from the same moment
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
	const { hookGame, problem, working, itemMenus } = kit;
	const FEATURE = 'TV';
	const GROUP = 'ItemMisc';
	const NAME = 'SlimeTV';
	/** The TV at 100%, in the character's pixels (the canvas is 500 wide): it just fits, from the shoulders down. */
	const TV = { width: 490, x: 250, y: 370, bezel: 9 };
	const SIZE = { min: 20, max: 140, step: 10 };
	const MOVE = { step: 20, max: 500 };
	const MAX_LINK = 300;
	/** How long a TV stays on once its character is no longer drawn (opening a menu, another screen): then it stops. */
	const KEEP_MS = 1500;
	const MUTE_KEY = 'sce.tv.muted';

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
		if (!item || w.CurrentScreen !== 'ChatRoom' || typeof Zoom !== 'number') {
			return;
		}
		// (the map shows everyone small: no TVs there, except for the character opened in it)
		if (typeof w.ChatRoomMapViewIsActive === 'function' && w.ChatRoomMapViewIsActive() && !w.CurrentCharacter) {
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
		const now = { box, scale: scale * (place.size / 100), item, seen: performance.now() };
		// (the same record every frame: the player's callbacks hold on to it)
		const was = shown.get(key);
		if (was) {
			Object.assign(was, now);
		} else {
			shown.set(key, now);
		}
	}

	/** The volume for TVs (0-1): the game's sound volume, lower for someone who can't hear well, 0 when muted here. */
	function volume() {
		if (muted()) {
			return 0;
		}
		const audio = w.Player && w.Player.AudioSettings;
		let v = audio && typeof audio.Volume === 'number' ? audio.Volume : 1;
		const deaf = w.Player && typeof w.Player.GetDeafLevel === 'function' ? w.Player.GetDeafLevel() : 0;
		v *= Math.max(0, 1 - deaf * 0.25);
		return Math.max(0, Math.min(1, v));
	}
	function muted() {
		try {
			return localStorage.getItem(MUTE_KEY) === '1';
		} catch {
			return false;
		}
	}

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

	/** A TV's page element: the frame, and the screen inside it. */
	function makeTV() {
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
		el.append(screen, led);
		return el;
	}

	/** What a TV shows: nothing (off), a YouTube player, a video, or a note that the link can't play. */
	function fill(/** @type {any} */ s) {
		const screen = /** @type {HTMLElement} */ (s.el.querySelector('.sce-tv-screen'));
		const led = /** @type {HTMLElement} */ (s.el.querySelector('.sce-tv-led'));
		const prop = s.item.Property || {};
		const link = String(prop.Text || '');
		const started = Number(prop.Text2) || 0;
		s.playing = `${link}|${started}`;
		s.media = null;
		s.volume = undefined;
		screen.replaceChildren();
		led.style.background = link ? '#3c6' : '#c43';
		if (!link) {
			return;
		}
		const what = parseLink(link);
		const from = started ? Math.max(0, (Date.now() - started) / 1000) : 0;
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
				autoplay: '1',
				start: String(Math.floor(from)),
				controls: '0',
				rel: '0',
				playsinline: '1',
				enablejsapi: '1',
				loop: '1',
				playlist: what.yt,
				origin: location.origin,
			});
			f.src = `https://www.youtube-nocookie.com/embed/${what.yt}?${q}`;
			f.allow = 'autoplay; encrypted-media';
			f.referrerPolicy = 'strict-origin-when-cross-origin';
			f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none;';
			f.addEventListener('load', () => {
				// (the player takes commands once it has loaded: tell it the volume a few times while it starts)
				for (const t of [0, 1000, 3000]) {
					setTimeout(() => {
						s.volume = undefined;
					}, t);
				}
			});
			s.media = { yt: f };
			screen.append(f);
			return;
		}
		const v = document.createElement('video');
		v.src = what.file;
		v.autoplay = true;
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
		v.play().catch(() => {
			// (the browser won't start sound before the page was clicked: start it quiet; the next check sets the sound)
			v.muted = true;
			v.play().catch(() => {});
		});
	}

	/** Sets a TV's sound when it changed. */
	function sound(/** @type {any} */ s) {
		const v = volume();
		if (!s.media || s.volume === v) {
			return;
		}
		s.volume = v;
		if (s.media.video) {
			s.media.video.volume = v;
			s.media.video.muted = v === 0;
		} else if (s.media.yt && s.media.yt.contentWindow) {
			const send = (/** @type {string} */ func, /** @type {any[]} */ args = []) =>
				s.media.yt.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube-nocookie.com');
			send('setVolume', [Math.round(v * 100)]);
			send(v === 0 ? 'mute' : 'unMute');
		}
	}

	/** Every frame: puts each TV drawn lately where its character is, and stops those no longer drawn. */
	function frame() {
		requestAnimationFrame(frame);
		if (!working(FEATURE)) {
			for (const s of shown.values()) {
				s.el?.remove();
			}
			shown.clear();
			return;
		}
		try {
			const now = performance.now();
			const at = shown.size ? tvLayer() : null;
			for (const [key, s] of shown) {
				const fresh = now - s.seen < 400;
				if (!at || now - s.seen > KEEP_MS) {
					s.el?.remove();
					shown.delete(key);
					continue;
				}
				if (!s.el) {
					s.el = makeTV();
					s.el.dataset.member = key;
					at.layer.append(s.el);
				}
				const prop = s.item.Property || {};
				if (s.playing !== `${prop.Text || ''}|${Number(prop.Text2) || 0}`) {
					fill(s);
				}
				s.el.style.visibility = fresh ? 'visible' : 'hidden';
				const [x0, y0, x1, y1] = s.box.map((v) => v * at.k);
				const bezel = Math.max(2, TV.bezel * s.scale * at.k);
				Object.assign(s.el.style, {
					left: `${x0}px`,
					top: `${y0}px`,
					width: `${x1 - x0}px`,
					height: `${y1 - y0}px`,
					padding: `${bezel}px ${bezel}px ${bezel * 1.4}px`,
				});
				sound(s);
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
			w.DrawButton(...B.off, '■ Turn off', item.Property && item.Property.Text ? 'White' : '#bbb');
			w.DrawButton(...B.smaller, '−', place.size > SIZE.min ? 'White' : '#bbb');
			w.DrawText(`Size ${place.size}%`, 1290, 682, 'White', 'Black');
			w.DrawButton(...B.bigger, '+', place.size < SIZE.max ? 'White' : '#bbb');
			w.DrawButton(...B.left, '←', 'White');
			w.DrawButton(...B.up, '↑', 'White');
			w.DrawButton(...B.down, '↓', 'White');
			w.DrawButton(...B.right, '→', 'White');
			w.DrawButton(...B.reset, 'Reset size and place', 'White');
			w.DrawButton(...B.mute, muted() ? '🔇 TV sound off (for me)' : '🔊 TV sound on (for me)', 'White');
			w.DrawText('A YouTube link, or a link to a video file (.mp4, .webm)', 1500, 870, 'White', 'Black');
			if (status) {
				w.DrawText(status, 1500, 930, '#ffd479', 'Black');
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
				if (item.Property && item.Property.Text) {
					change({ Text: '', Text2: '' });
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
		change({ Text: link, Text2: String(Date.now()) });
		status = 'Playing.';
		say(`${nick(w.Player)} turns on ${whose()}.`);
	}

	if (hookGame('DrawCharacter', 0, FEATURE, (args, next) => {
		const r = next(args);
		noteDrawn(args);
		return r;
	})) {
		requestAnimationFrame(frame);
	}
	w.SCETV = { parseLink, placeOf, shown };
})();
