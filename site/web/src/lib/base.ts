// Every link and fetch goes through the Vite base, so the same build works at / (Bun server) and /quorum/ (GitHub Pages).
export const BASE = import.meta.env.BASE_URL
export const asset = (path: string) => BASE + path.replace(/^\//, "")
export const APP = asset("app.html")
/** GitHub Pages build: there is no API, so the console plays the recorded live run instead. */
export const STATIC = import.meta.env.VITE_QUORUM_STATIC === "1"
