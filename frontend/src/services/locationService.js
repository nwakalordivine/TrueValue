// Automatic location: asks the browser once, remembers it for the session,
// and falls back to downtown Regina when the user says no (or the browser can't tell).
const KEY = 'truevalue-location-v1';
export const REGINA = { lat: 50.4452, lon: -104.6189, source: 'default', label: 'Downtown Regina (default)' };

export function cachedLocation() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
}

export function getLocation({ timeout = 10000, force = false } = {}) {
  const cached = cachedLocation();
  if (cached && !force) return Promise.resolve(cached);
  return new Promise(resolve => {
    const fallback = reason => resolve({ ...REGINA, reason });
    if (!('geolocation' in navigator)) return fallback('Your browser does not support location.');
    if (!window.isSecureContext) return fallback('Location needs https (or localhost).');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy),
          source: 'browser', label: 'Your location' };
        try { sessionStorage.setItem(KEY, JSON.stringify(loc)); } catch { /* private mode */ }
        resolve(loc);
      },
      err => fallback(err.code === 1 ? 'Location permission was declined.' : 'Your location could not be found.'),
      { enableHighAccuracy: false, timeout, maximumAge: 10 * 60 * 1000 },
    );
  });
}

export function mapEmbedUrl(lat, lon, zoom = 0.035) {
  const bbox = [lon - zoom * 1.6, lat - zoom, lon + zoom * 1.6, lat + zoom].map(n => n.toFixed(5)).join('%2C');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(5)}%2C${lon.toFixed(5)}`;
}

export function openNearbyStores() {
  window.open('https://www.openstreetmap.org/search?query=grocery%20stores%20Regina%20Saskatchewan', '_blank', 'noopener,noreferrer');
}
