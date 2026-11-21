// ==UserScript==
// @name         SCE - Slime Clothing Extension
// @namespace    https://github.com/Proudkiller0015/sce
// @version      1.0.0
// @description  More clothes for Bondage Club, with many options and colours: kimonos first. Always runs the newest version.
// @icon         https://raw.githubusercontent.com/Proudkiller0015/sce/main/icon-64.png
// @homepageURL  https://github.com/Proudkiller0015/sce
// @downloadURL  https://raw.githubusercontent.com/Proudkiller0015/sce/main/sce.user.js
// @updateURL    https://raw.githubusercontent.com/Proudkiller0015/sce/main/sce.user.js
// @match        https://www.bondageprojects.elementfx.com/*
// @match        https://bondageprojects.elementfx.com/*
// @match        https://bondageprojects.com/*
// @match        https://www.bondageprojects.com/*
// @match        https://www.bondage-europe.com/*
// @match        https://bondage-europe.com/*
// @match        https://www.bondageeurope.com/*
// @match        https://bondageeurope.com/*
// @match        https://www.bondage-asia.com/*
// @match        https://bondage-asia.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

/*
 * The SCE loader. It never needs updating: on every game load it adds the newest SCE, so new clothes reach
 * everybody the next time they reload. SCE comes from GitHub Pages; if that fails, from jsDelivr (a copy of the
 * GitHub repo). SCE fetches its clothes from the same place it was loaded from.
 */
(function () {
	'use strict';
	const minute = Math.floor(Date.now() / 60000);
	const homes = ['https://proudkiller0015.github.io/sce/', 'https://cdn.jsdelivr.net/gh/Proudkiller0015/sce@main/'];
	const add = (i = 0) => {
		if (i >= homes.length || window.SCELoaded) {
			return;
		}
		window.SCEBase = homes[i];
		const script = document.createElement('script');
		script.src = `${homes[i]}sce.js?v=${minute}`;
		script.crossOrigin = 'anonymous';
		script.onerror = () => {
			script.remove();
			add(i + 1);
		};
		document.head.appendChild(script);
	};
	add();
})();
