// Applies the saved light/dark choice before the first paint, so pages never flash the wrong theme. It is an inline
// script in the root layout, so the Content-Security-Policy for the console allows it by its hash (src/lib/csp.ts):
// change it and the hash follows.
export const THEME_SCRIPT = `try{if(localStorage.getItem("fitron_theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;
