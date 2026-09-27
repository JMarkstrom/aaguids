/*
 * theme-init.js — anti-FOUC theme bootstrap.
 *
 * Why this is a separate file: the page ships a strict CSP with `script-src 'self'`
 * and no 'unsafe-inline', so the usual inline <head> snippet is not an option.
 * A classic, SYNCHRONOUS external script in <head> blocks the parser before it
 * reaches <body>, which gives the same "no flash of the wrong theme" guarantee.
 *
 * MUST stay synchronous: adding `defer`, `async` or `type="module"` makes it
 * implicitly deferred until after the document is parsed, reintroducing the flash.
 */
(function () {
    'use strict';
    var theme;
    try {
        theme = localStorage.getItem('aaguids:theme');
    } catch (e) {
        return; // Storage can throw (private mode, blocked cookies): fall back to system.
    }
    if (theme === 'light' || theme === 'dark') {
        document.documentElement.setAttribute('data-theme', theme);
    }
    // No attribute == "system"; `color-scheme: light dark` tracks the OS natively.
}());
