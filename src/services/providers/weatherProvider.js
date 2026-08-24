'use strict';

/**
 * Weather provider abstraction.
 *
 * Default implementation: Open-Meteo (no API key required) for the current
 * weather + a 5-day forecast, for Kanyakumari (lat 8.08, lng 77.56) or a
 * geocoded city.
 *
 * The shape returned matches the public frontend's `weather` object:
 *   { city, tempC, condition, humidity, windKmh,
 *     forecast: [{ day, high, low, condition }] }
 *
 * When no provider is reachable/configured we return
 *   { available:false, reason } — NEVER invented values.
 */
const cache = require('../../utils/cache');

const DEFAULT_CITY = 'Kanyakumari';
const DEFAULT_COORDS = { lat: 8.0833, lon: 77.5667 };
const FORECAST_DAYS = 5;

// Open-Meteo WMO weather codes -> short labels
const WMO = {
  0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Cloudy',
  45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
  61: 'Rain', 63: 'Rain', 65: 'Heavy Rain', 66: 'Rain', 67: 'Rain',
  71: 'Snow', 73: 'Snow', 75: 'Snow', 77: 'Snow',
  80: 'Showers', 81: 'Showers', 82: 'Showers',
  85: 'Snow Showers', 86: 'Snow Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

function label(code) {
  return WMO[code] || 'Unknown';
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Geocode a city name via Open-Meteo geocoding (best-effort).
 * Falls back to Kanyakumari coords when the name is the default.
 */
async function resolveCoords(city) {
  if (!city || city.toLowerCase() === DEFAULT_CITY.toLowerCase()) {
    return { coords: DEFAULT_COORDS, name: DEFAULT_CITY };
  }
  try {
    const data = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
    const hit = data?.results?.[0];
    if (hit) return { coords: { lat: hit.latitude, lon: hit.longitude }, name: hit.name };
  } catch {
    /* fall through to default */
  }
  return { coords: DEFAULT_COORDS, name: DEFAULT_CITY };
}

/**
 * Get current weather + 5-day forecast for a city.
 * @returns {Promise<{available:boolean, data?:object, reason?:string}>}
 */
async function getCurrent(city) {
  const name = city || DEFAULT_CITY;
  const cacheKey = `weather:${name}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const { coords, name: resolvedName } = await resolveCoords(city);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
      `&forecast_days=${FORECAST_DAYS + 1}` +
      `&timezone=Asia%2FKolkata`;
    const data = await fetchJson(url);

    const cur = data.current;
    const daily = data.daily;

    const forecast = [];
    for (let i = 1; i <= Math.min(FORECAST_DAYS, (daily.time || []).length); i++) {
      const d = new Date(daily.time[i] + 'T00:00:00Z');
      forecast.push({
        day: DAY_ABBR[d.getUTCDay()],
        high: Math.round(daily.temperature_2m_max[i]),
        low: Math.round(daily.temperature_2m_min[i]),
        condition: label(daily.weather_code[i]),
      });
    }

    const result = {
      available: true,
      data: {
        city: resolvedName,
        tempC: Math.round(cur.temperature_2m),
        condition: label(cur.weather_code),
        humidity: cur.relative_humidity_2m,
        windKmh: Math.round(cur.wind_speed_10m),
        forecast,
      },
    };
    cache.set(cacheKey, result, 10 * 60 * 1000); // 10 min
    return result;
  } catch (err) {
    // Transient/provider-down: return unavailability (clearly identified),
    // and don't cache the failure.
    return { available: false, reason: `Weather provider unavailable: ${err.message}` };
  }
}

module.exports = { getCurrent, WMO };
