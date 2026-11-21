// The first SCE loader (loader.user.js, 20 Nov 2026) loads this file. SCE now lives in sce.js; this hands over to it.
// Kept for a while so that loader keeps working until it updates itself to sce.user.js.
(function () {
	'use strict';
	if (window.SCELoaded) {
		return;
	}
	const base = window.SCEBase || 'https://proudkiller0015.github.io/sce/';
	const script = document.createElement('script');
	script.src = `${base}sce.js?v=${Math.floor(Date.now() / 60000)}`;
	script.crossOrigin = 'anonymous';
	document.head.appendChild(script);
})();
