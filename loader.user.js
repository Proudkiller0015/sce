// ==UserScript==
// @name         Slime Clothing Extension (loader)
// @namespace    slime-clothing-extension
// @version      0.1.1
// @description  Loads the newest Slime Clothing Extension (SCE) add-on for Bondage Club.
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
// @updateURL    https://proudkiller0015.github.io/sce/loader.user.js
// @downloadURL  https://proudkiller0015.github.io/sce/loader.user.js
// ==/UserScript==

// Loads the newest add-on from its GitHub Pages home on every game load; this loader updates itself through @updateURL.
(() => {
	'use strict';
	const BASE = 'https://proudkiller0015.github.io/sce/';
	/** @type {any} */ (window).SCEBase = BASE;
	const s = document.createElement('script');
	s.src = `${BASE}addon.js?t=${Date.now()}`;
	s.async = true;
	document.head.appendChild(s);
})();
