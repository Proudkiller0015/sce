// ==UserScript==
// @name         Untitled Wardrobe (loader)
// @namespace    untitled-wardrobe
// @version      0.1.0
// @description  Loads the newest Untitled Wardrobe clothing add-on for Bondage Club.
// @match        https://bondageprojects.elementfx.com/*
// @match        https://www.bondageprojects.elementfx.com/*
// @match        https://bondage-europe.com/*
// @match        https://www.bondage-europe.com/*
// @match        https://bondageprojects.com/*
// @match        https://www.bondageprojects.com/*
// @match        https://bondage-asia.com/*
// @match        https://www.bondage-asia.com/*
// @match        https://bondageeurope.com/*
// @match        https://www.bondageeurope.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

// Not published yet: BASE is a placeholder until the add-on has a name and a home (e.g. its GitHub Pages address).
(() => {
	'use strict';
	const BASE = 'https://example.invalid/untitled-wardrobe/';
	/** @type {any} */ (window).UntitledWardrobeBase = BASE;
	const s = document.createElement('script');
	s.src = `${BASE}addon.js?t=${Date.now()}`;
	s.async = true;
	document.head.appendChild(s);
})();
