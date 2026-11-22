// SCE activities: new entries for the game's activity menu that neither the game nor the popular activity add-ons
// (Echo's Activities Mod, Freya's Seidr, LSCG) have. sce.js loads this file and hands it its guarded hooks
// (window.SCE.kit), so every hook here switches the whole feature off instead of breaking the game.
//
// Activity names (SCE_...) go out in chat messages: never rename one after release.
// Players without SCE still read our chat lines: each message carries its own text for their game to show.
(() => {
	'use strict';
	/** @type {any} */
	const w = window;
	const kit = w.SCE && w.SCE.kit;
	if (!kit || w.SCEActivitiesLoaded) {
		return;
	}
	w.SCEActivitiesLoaded = true;
	const { hookGame, problem, working, gameFunction, settings, ICON, ADDON_NAME } = kit;
	const FEATURE = 'Activities';

	/**
	 * One activity. `self` lines are for doing it to yourself, `other` lines for doing it to someone else; a mode
	 * without lines doesn't exist. A line is one text, or one text per body zone. `penis` replaces the `other` lines
	 * on ItemVulva when the target has a penis (the game calls that zone ItemPenis then).
	 * @typedef {{ label: string, text: string | Record<string, string> }} Lines
	 * @typedef {{
	 *   name: string, image: string, prereq?: string[], max?: number,
	 *   self?: Lines & { groups: string[] }, other?: Lines & { groups: string[] }, penis?: Lines,
	 *   face?: [string, string, number][], react?: [string, string, number][],
	 * }} Def
	 * `image`: a game activity icon's name (Icons/Activity/<image>.png), or a path to another game picture.
	 * `face`: the doer's face for a while (group, expression, seconds). `react`: the target's face, when their game has
	 * SCE and arousal on.
	 */
	/** @type {Def[]} */
	const DEFS = [
		// ---- Your face and body
		{
			name: 'SCE_Blush', image: 'Icons/Expressions/Blush/High.png', face: [['Blush', 'High', 15]],
			self: { groups: ['ItemHead'], label: 'Blush', text: 'SourceCharacter blushes a deep shade of red.' },
		},
		{
			name: 'SCE_Pout', image: 'Icons/Expressions/Mouth/Pout.png', face: [['Mouth', 'Pout', 15]],
			self: { groups: ['ItemMouth'], label: 'Pout', text: 'SourceCharacter pouts.' },
		},
		{
			name: 'SCE_BiteLip', image: 'Bite', face: [['Mouth', 'LipBite', 15]],
			self: { groups: ['ItemMouth'], label: 'Bite Lip', text: 'SourceCharacter bites PronounPossessive lip.' },
		},
		{
			name: 'SCE_LickLips', image: 'Lick', prereq: ['UseTongue'], face: [['Mouth', 'Devious', 10]],
			self: { groups: ['ItemMouth'], label: 'Lick Lips', text: 'SourceCharacter slowly licks PronounPossessive lips.' },
		},
		{
			name: 'SCE_Giggle', image: 'Icons/Expressions/Mouth/Laughing.png', prereq: ['UseMouth'], face: [['Mouth', 'Laughing', 5]],
			self: { groups: ['ItemMouth'], label: 'Giggle', text: 'SourceCharacter giggles.' },
		},
		{
			name: 'SCE_Sigh', image: 'Icons/Expressions/Mouth/Sad.png', face: [['Eyebrows', 'Lowered', 8]],
			self: { groups: ['ItemMouth'], label: 'Sigh', text: 'SourceCharacter lets out a long sigh.' },
		},
		{
			name: 'SCE_Hum', image: 'Icons/Expressions/Emoticon/Music.png', prereq: ['UseMouth'], face: [['Mouth', 'Happy', 10]],
			self: { groups: ['ItemMouth'], label: 'Hum a Tune', text: 'SourceCharacter hums a little tune.' },
		},
		{
			name: 'SCE_Stretch', image: 'Icons/Poses/OverTheHead.png', prereq: ['UseArms'],
			self: { groups: ['ItemArms'], label: 'Stretch', text: 'SourceCharacter stretches PronounPossessive arms high above PronounPossessive head.' },
		},
		{
			name: 'SCE_Clap', image: 'Icons/Expressions/Emoticon/RaisedHand.png', prereq: ['UseHands'],
			self: { groups: ['ItemHands'], label: 'Clap', text: 'SourceCharacter claps PronounPossessive hands.' },
		},
		{
			name: 'SCE_HideFace', image: 'HandGag', prereq: ['UseArms'], face: [['Blush', 'Medium', 15]],
			self: { groups: ['ItemHead'], label: 'Hide Face in Sleeves', text: 'SourceCharacter hides PronounPossessive face behind PronounPossessive sleeves.' },
		},
		{
			name: 'SCE_Present', image: 'Icons/Poses/AllFours.png', face: [['Blush', 'Low', 15]],
			self: { groups: ['ItemButt'], label: 'Present Rear', text: 'SourceCharacter bends over and presents PronounPossessive rear.' },
		},
		{
			name: 'SCE_Wink', image: 'Icons/WinkLeft.png', face: [['Eyes2', 'Closed', 2]],
			self: { groups: ['ItemHead'], label: 'Wink', text: 'SourceCharacter winks.' },
			other: { groups: ['ItemHead'], label: 'Wink', text: 'SourceCharacter winks at TargetCharacter.' },
		},
		{
			name: 'SCE_Bow', image: 'Nod', prereq: ['MoveHead'],
			self: { groups: ['ItemHead'], label: 'Bow', text: 'SourceCharacter bows politely.' },
			other: { groups: ['ItemHead'], label: 'Bow', text: 'SourceCharacter bows politely to TargetCharacter.' },
		},
		{
			name: 'SCE_Curtsy', image: 'Icons/Poses/LegsClosed.png', prereq: ['UseFeet'],
			self: { groups: ['ItemLegs'], label: 'Curtsy', text: 'SourceCharacter holds out PronounPossessive skirt and curtsies.' },
			other: { groups: ['ItemHead'], label: 'Curtsy', text: 'SourceCharacter holds out PronounPossessive skirt and curtsies to TargetCharacter.' },
		},

		// ---- Sweet
		{
			name: 'SCE_BlowKiss', image: 'Icons/Expressions/Emoticon/Hearts.png', prereq: ['UseHands'], react: [['Blush', 'Low', 10]],
			other: { groups: ['ItemHead'], label: 'Blow a Kiss', text: 'SourceCharacter blows a kiss to TargetCharacter.' },
		},
		{
			name: 'SCE_TuckHair', image: 'Caress', prereq: ['UseHands'], react: [['Blush', 'Low', 10]],
			other: { groups: ['ItemEars'], label: 'Tuck Hair Behind Ear', text: 'SourceCharacter gently tucks a strand of hair behind DestinationCharacter ear.' },
		},
		{
			name: 'SCE_WipeTears', image: 'Icons/Expressions/Fluids/TearsLow.png', prereq: ['UseHands'],
			other: { groups: ['ItemHead'], label: 'Wipe Tears', text: 'SourceCharacter gently wipes the tears from DestinationCharacter cheeks.' },
		},
		{
			name: 'SCE_BraidHair', image: 'Pet', prereq: ['UseHands'],
			other: { groups: ['ItemHead'], label: 'Braid Hair', text: 'SourceCharacter braids DestinationCharacter hair with nimble fingers.' },
		},
		{
			name: 'SCE_FixCollar', image: 'CollarGrab', prereq: ['UseHands', 'Collared'],
			other: { groups: ['ItemNeck'], label: 'Straighten Collar', text: 'SourceCharacter straightens DestinationCharacter collar.' },
		},
		{
			name: 'SCE_PinkyPromise', image: 'Icons/Lover.png', prereq: ['UseHands'],
			other: { groups: ['ItemHands'], label: 'Pinky Promise', text: 'SourceCharacter hooks PronounPossessive pinky around DestinationCharacter pinky and makes a promise.' },
		},
		{
			name: 'SCE_FistBump', image: 'BrothersHandshake', prereq: ['UseHands'],
			other: { groups: ['ItemHands'], label: 'Fist Bump', text: 'SourceCharacter bumps fists with TargetCharacter.' },
		},
		{
			name: 'SCE_TugSleeve', image: 'Pull', prereq: ['UseHands'],
			other: { groups: ['ItemArms'], label: 'Tug Sleeve', text: 'SourceCharacter tugs on DestinationCharacter sleeve to get TargetPronounPossessive attention.' },
		},
		{
			name: 'SCE_ObiSpin', image: 'Icons/Expressions/Eyes/Dizzy.png', prereq: ['UseHands', 'SCE_TargetKimono'],
			react: [['Eyes', 'Dizzy', 6], ['Blush', 'Medium', 10]],
			other: { groups: ['ItemTorso'], label: 'Obi Spin', text: 'SourceCharacter grabs the end of DestinationCharacter obi and pulls hard, spinning TargetCharacter round and round!' },
		},
		{
			name: 'SCE_NuzzleNeck', image: 'SiblingsCheekKiss', max: 30,
			other: { groups: ['ItemNeck'], label: 'Nuzzle Neck', text: 'SourceCharacter nuzzles into the crook of DestinationCharacter neck.' },
		},
		{
			name: 'SCE_Raspberry', image: 'Kiss', prereq: ['UseTongue'], react: [['Mouth', 'Laughing', 5]],
			other: { groups: ['ItemPelvis'], label: 'Belly Raspberry', text: 'SourceCharacter blows a loud raspberry on DestinationCharacter belly.' },
		},

		// ---- Lewd
		{
			name: 'SCE_Smother', image: 'Cuddle', prereq: ['SCE_HasBreasts'], max: 20, react: [['Blush', 'High', 10]],
			other: { groups: ['ItemHead'], label: 'Breast Smother', text: 'SourceCharacter pulls DestinationCharacter face into PronounPossessive breasts and smothers TargetPronounObject.' },
		},
		{
			name: 'SCE_TwistNipples', image: 'Pinch', prereq: ['UseHands'], max: 60, react: [['Eyebrows', 'Harsh', 8]],
			other: { groups: ['ItemNipples'], label: 'Twist Nipples', text: 'SourceCharacter twists DestinationCharacter nipples between PronounPossessive fingers.' },
		},
		{
			name: 'SCE_SpreadCheeks', image: 'Grope', prereq: ['UseHands'], max: 30, react: [['Blush', 'High', 10]],
			other: { groups: ['ItemButt'], label: 'Spread Cheeks', text: 'SourceCharacter spreads DestinationCharacter cheeks apart.' },
		},
		{
			name: 'SCE_HandUnder', image: 'Caress', prereq: ['UseHands', 'SCE_TargetClothed'], max: 40, react: [['Blush', 'Medium', 10]],
			other: {
				groups: ['ItemBreast', 'ItemTorso', 'ItemPelvis', 'ItemButt', 'ItemLegs'],
				label: 'Slip Hand Under Clothes',
				text: {
					ItemBreast: 'SourceCharacter slips a hand under DestinationCharacter clothes and cups TargetPronounPossessive breast.',
					ItemTorso: 'SourceCharacter slips a hand under DestinationCharacter clothes and runs it along TargetPronounPossessive bare back.',
					ItemPelvis: 'SourceCharacter slips a hand under DestinationCharacter clothes and strokes TargetPronounPossessive belly.',
					ItemButt: 'SourceCharacter slips a hand under DestinationCharacter clothes and squeezes TargetPronounPossessive butt.',
					ItemLegs: 'SourceCharacter slides a hand up under DestinationCharacter clothes along TargetPronounPossessive inner thigh.',
				},
			},
		},
		{
			name: 'SCE_LapDance', image: 'Icons/Kneel.png', prereq: ['UseFeet'], max: 60, react: [['Blush', 'Medium', 10]],
			other: { groups: ['ItemLegs'], label: 'Lap Dance', text: 'SourceCharacter grinds slowly in DestinationCharacter lap, giving TargetPronounObject a teasing lap dance.' },
		},
		{
			name: 'SCE_SpitInMouth', image: 'Icons/Expressions/Fluids/DroolLow.png', prereq: ['UseTongue', 'TargetCanUseTongue'], max: 10, react: [['Blush', 'Medium', 10]],
			other: { groups: ['ItemMouth'], label: 'Spit in Mouth', text: 'SourceCharacter spits into DestinationCharacter mouth.' },
		},
		{
			name: 'SCE_Edge', image: 'MasturbateHand', prereq: ['UseHands', 'ZoneNaked'], max: 90,
			react: [['Eyes', 'Horny', 10], ['Blush', 'High', 10]],
			other: { groups: ['ItemVulva'], label: 'Edge', text: 'SourceCharacter teases DestinationCharacter pussy right to the edge, then stops.' },
			penis: { label: 'Edge', text: 'SourceCharacter strokes DestinationCharacter cock right to the edge, then stops.' },
		},
		{
			name: 'SCE_Deny', image: 'Icons/Expressions/Emoticon/Warning.png', prereq: ['UseMouth'],
			other: { groups: ['ItemVulva'], label: 'Forbid Orgasm', text: 'SourceCharacter firmly forbids TargetCharacter to cum.' },
			penis: { label: 'Forbid Orgasm', text: 'SourceCharacter firmly forbids TargetCharacter to cum.' },
		},
		{
			name: 'SCE_Scissoring', image: 'Icons/Poses/KneelingSpread.png', prereq: ['SCE_HasVagina', 'SCE_TargetHasVagina', 'ZoneNaked', 'TargetZoneNaked'], max: 100,
			face: [['Blush', 'High', 15]], react: [['Eyes', 'Lewd', 10], ['Blush', 'High', 10]],
			other: { groups: ['ItemVulva'], label: 'Scissoring', text: 'SourceCharacter scissors TargetCharacter, grinding PronounPossessive pussy against TargetPronounPossessive.' },
		},
		{
			name: 'SCE_DoubleDildo', image: 'PenetrateSlow', prereq: ['SCE_WearsDoubleDildo', 'ZoneAccessible', 'SCE_VulvaIsVagina'], max: 100,
			face: [['Blush', 'High', 15]], react: [['Eyes', 'Lewd', 10], ['Blush', 'High', 10]],
			other: {
				groups: ['ItemVulva', 'ItemButt'],
				label: 'Double Dildo',
				text: {
					ItemVulva: 'SourceCharacter slides the other end of PronounPossessive double dildo into DestinationCharacter pussy and rocks against TargetPronounObject, filling them both.',
					ItemButt: 'SourceCharacter slides the other end of PronounPossessive double dildo into DestinationCharacter ass and rocks against TargetPronounObject, filling them both.',
				},
			},
		},
		{
			name: 'SCE_Pegging', image: 'PenetrateFast', prereq: ['SCE_WearsStrapOn', 'ZoneAccessible', 'SCE_VulvaIsVagina'], max: 100,
			react: [['Eyes', 'Lewd', 10], ['Blush', 'High', 10]],
			other: { groups: ['ItemButt'], label: 'Pegging', text: 'SourceCharacter pegs TargetCharacter, thrusting PronounPossessive strap-on deep into DestinationCharacter ass.' },
		},
		{
			name: 'SCE_Titjob', image: 'Wiggle', prereq: ['SCE_TargetHasPenis', 'SCE_BreastsBare', 'ZoneNaked'], max: 100,
			react: [['Eyes', 'Lewd', 10], ['Blush', 'High', 10]],
			penis: { label: 'Titjob', text: 'SourceCharacter wraps PronounPossessive breasts around DestinationCharacter cock and strokes it.' },
			other: { groups: ['ItemVulva'], label: 'Titjob', text: '' },
		},

	];

	/** @type {Map<string, Def>} */
	const byName = new Map(DEFS.map((d) => [d.name, d]));
	const isOursName = (/** @type {any} */ name) => typeof name === 'string' && byName.has(name);

	/** The line for a game text key: Label-ChatOther-ItemNeck-SCE_NuzzleNeck, ChatSelf-ItemHead-SCE_Blush, ActivitySCE_Bow. */
	function line(/** @type {string} */ key) {
		if (key.startsWith('Activity') && isOursName(key.slice(8))) {
			const d = /** @type {Def} */ (byName.get(key.slice(8)));
			return (d.other || d.penis || d.self || { label: d.name }).label;
		}
		const m = /^(Label-)?Chat(Other|Self)-([A-Za-z0-9]+)-(SCE_[A-Za-z0-9]+)$/.exec(key);
		const d = m && byName.get(m[4]);
		if (!m || !d) {
			return '';
		}
		/** @type {Lines | undefined} */
		let lines = m[2] === 'Self' ? d.self : d.other;
		if (m[3] === 'ItemPenis' || m[3] === 'ItemGlans') {
			lines = m[2] === 'Self' ? d.self : d.penis;
		} else if (lines && 'groups' in lines && !(/** @type {any} */ (lines).groups.includes(m[3]))) {
			return '';
		}
		if (!lines) {
			return '';
		}
		if (m[1]) {
			return lines.label;
		}
		const text = typeof lines.text === 'string' ? lines.text : lines.text[m[3]];
		return text || '';
	}

	/** Our prerequisites; the game's own ones it checks itself (it passes names it doesn't know). */
	function prerequisite(/** @type {string} */ prereq, /** @type {any} */ acting, /** @type {any} */ acted, /** @type {any} */ group) {
		const cloth = (/** @type {any} */ C, /** @type {string} */ name) => w.InventoryGet(C, name);
		switch (prereq) {
			case 'SCE_HasBreasts':
				return !acting.IsFlatChested();
			case 'SCE_BreastsBare':
				return !acting.IsFlatChested() && w.InventoryPrerequisiteMessage(acting, 'AccessBreast') === '' && !acting.IsBreastChaste();
			case 'SCE_TargetHasPenis':
				return acted.HasPenis();
			case 'SCE_WearsDoubleDildo': {
				const item = cloth(acting, 'ItemVulva');
				return !!item && item.Asset.Name === 'DoubleEndDildo';
			}
			case 'SCE_WearsStrapOn':
				// A worn item the game lets you penetrate with (its strap-ons), not one worn inside.
				return acting.Appearance.some((/** @type {any} */ item) =>
					!['ItemVulva', 'ItemButt', 'ItemMouth', 'Pussy', 'ItemHandheld'].includes(item.Asset.Group.Name) &&
					/Strap/i.test(item.Asset.Name) && Array.isArray(item.Asset.AllowActivity) && item.Asset.AllowActivity.includes('PenetrateItem'));
			case 'SCE_VulvaIsVagina':
				return !group || group.Name !== 'ItemVulva' || acted.HasVagina();
			case 'SCE_HasVagina':
				return acting.HasVagina();
			case 'SCE_TargetHasVagina':
				return acted.HasVagina();
			case 'SCE_TargetKimono': {
				const item = cloth(acted, 'Cloth');
				return !!item && /Kimono|Yukata|Furisode/i.test(item.Asset.Name);
			}
			case 'SCE_TargetClothed':
				return !!(cloth(acted, 'Cloth') || cloth(acted, 'ClothLower'));
			default:
				return true;
		}
	}

	/** Adds our activities to the game's list (once), after its own ones in the menu order. */
	function addToGame() {
		const list = w.ActivityFemale3DCG;
		// The menu order is a script-level `let`, not a window property.
		const order = typeof ActivityFemale3DCGOrdering !== 'undefined' && Array.isArray(ActivityFemale3DCGOrdering) ? ActivityFemale3DCGOrdering : null;
		for (const d of DEFS) {
			if (list.some((/** @type {any} */ a) => a && a.Name === d.name)) {
				continue;
			}
			// No ActivityID: the game keeps players' likes in a string indexed by it; ours have no setting there.
			list.push({
				Name: d.name,
				MaxProgress: d.max || 0,
				MaxProgressSelf: d.max || 0,
				Prerequisite: [...(d.prereq || [])],
				Target: d.other ? [...d.other.groups] : [],
				...(d.self ? { TargetSelf: [...d.self.groups] } : {}),
				...(d.react ? { ActivityExpression: d.react.map(([Group, Name, Timer]) => ({ Group, Name, Timer })) } : {}),
			});
			if (order && !order.includes(d.name)) {
				order.push(d.name);
			}
		}
	}

	/** The game shows a missing text as this, so players without SCE get our line in its place. */
	const missingTags = (/** @type {string} */ key) => [`MISSING TEXT IN "ActivityDictionary.csv": ${key}`];

	function start() {
		let ok = hookGame('ActivityDictionaryText', 0, FEATURE, (args, next) => {
			const text = typeof args[0] === 'string' ? line(args[0]) : '';
			return text || next(args);
		});
		ok = ok && hookGame('ActivityCheckPrerequisite', 0, FEATURE, (args, next) =>
			typeof args[0] === 'string' && args[0].startsWith('SCE_') ? prerequisite(args[0], args[1], args[2], args[3]) : next(args),
		);
		// Ours have no like/dislike setting: they count as "normal" (2). Switched off in the settings, you can't do them
		// (the game asks with Self false for the doer); done to you by others they still count as normal.
		ok = ok && hookGame('PreferenceGetActivityFactor', 0, FEATURE, (args, next) =>
			isOursName(args[1]) ? (settings.activities === false && args[2] === false ? 0 : 2) : next(args),
		);
		if (!ok) {
			return;
		}
		// The button: our picture from the game's activity icons, and the SCE badge.
		hookGame('ElementButton.CreateForActivity', 0, FEATURE, (args, next) => {
			const d = args[1] && args[1].Activity && byName.get(args[1].Activity.Name);
			if (!d || args[1].Item) {
				return next(args);
			}
			const options = { ...(args[4] || {}) };
			options.image ??= d.image.includes('/') ? `./${d.image}` : `./Icons/Activity/${d.image}.png`;
			options.icons = [...(options.icons || []), { name: 'SCE', iconSrc: ICON, tooltipText: ADDON_NAME }];
			return next([args[0], args[1], args[2], args[3], options, ...args.slice(5)]);
		});
		// The chat line travels with the message, for players whose game doesn't know it.
		hookGame('ServerSend', 0, FEATURE, (args, next) => {
			const data = args[1];
			if (args[0] === 'ChatRoomChat' && data && data.Type === 'Activity' && typeof data.Content === 'string' && Array.isArray(data.Dictionary)) {
				const named = data.Dictionary.find((/** @type {any} */ e) => e && typeof e.ActivityName === 'string');
				const text = named && isOursName(named.ActivityName) ? line(data.Content) : '';
				if (text) {
					const Dictionary = [...data.Dictionary, ...missingTags(data.Content).map((Tag) => ({ Tag, Text: text }))];
					return next([args[0], { ...data, Dictionary }, ...args.slice(2)]);
				}
			}
			return next(args);
		});
		// The doer's face.
		hookGame('ActivityRun', 0, FEATURE, (args, next) => {
			const result = next(args);
			const d = args[3] && args[3].Activity && byName.get(args[3].Activity.Name);
			if (d && d.face && args[0] && args[0].IsPlayer && args[0].IsPlayer()) {
				for (const [group, expression, seconds] of d.face) {
					w.CharacterSetFacialExpression(args[0], group, expression, seconds);
				}
			}
			return result;
		});
		// Ours have no like/dislike setting, so they stay out of the arousal settings' list.
		hookGame('PreferenceSubscreenArousalLoad', 0, FEATURE, (args, next) => {
			const result = next(args);
			if (typeof PreferenceArousalActivityList !== 'undefined' && Array.isArray(PreferenceArousalActivityList)) {
				PreferenceArousalActivityList = PreferenceArousalActivityList.filter((/** @type {string} */ n) => !isOursName(n));
			}
			return result;
		});

		let tries = 0;
		const wait = setInterval(() => {
			if (!working(FEATURE) || ++tries > 1200) {
				clearInterval(wait);
				if (tries > 1200) {
					problem(FEATURE, 'the game never loaded its activities');
				}
				return;
			}
			if (!Array.isArray(w.ActivityFemale3DCG) || !gameFunction('ActivityAllowedForGroup')) {
				return;
			}
			clearInterval(wait);
			try {
				addToGame();
			} catch (e) {
				problem(FEATURE, e);
			}
		}, 50);
	}

	try {
		start();
	} catch (e) {
		problem(FEATURE, e);
	}
	w.SCE.activities = DEFS.map((d) => d.name);
	/** The names players see, for the settings' activity list. */
	w.SCE.activityLabels = DEFS.map((d) => (d.other || d.self || { label: d.name }).label);
})();
