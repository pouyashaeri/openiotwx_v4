/**
 * The security headers sent with every response (pages, the API and static files such as the flasher).
 * Applied by the server in vite.config.ts (Nitro route rules); kept here as plain data so it can be tested.
 *
 * What the Content-Security-Policy allows, and why:
 *  - script-src 'self' 'unsafe-inline': the framework starts the page with an inline script, and the flasher
 *    pages have their own inline scripts. No eval, no outside scripts.
 *  - style-src: our own styles plus Google Fonts' stylesheet.
 *  - connect-src 'self' https: the pages call our own API, and public https services (place search, elevation,
 *    the CDC and EPA layers) and any https address a person points the page at as their own server. Plain http,
 *    websockets and other schemes are not allowed.
 *  - img-src: map tiles and station photos come from many https hosts.
 *  - frame-src: the dashboard embed (Metabase) over https. Nothing may embed US (frame-ancestors 'none').
 *  - object-src 'none', base-uri 'self', form-action 'self': the usual closing of the side doors.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https:",
  "frame-src 'self' https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  // Browsers only honour this over https, so it is harmless on http://localhost. No includeSubDomains: this site
  // does not speak for the rest of the domain it lives under.
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // The location button and the flasher (USB serial) need these two. Nothing else is needed.
  "Permissions-Policy": "geolocation=(self), serial=(self), usb=(self), camera=(), microphone=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
};
