/**
 * 🎴 Dynamic Anime Fetcher
 * Multiple APIs • Random rotation • Failover
 * NO API KEY required
 */

const axios = require("axios");

const APIS = [
    {
        name: "Jikan (MyAnimeList)",
        url: "https://api.jikan.moe/v4/random/characters",
        parse: (data) => ({
            name: data.data?.name || "Unknown",
            image: data.data?.images?.jpg?.image_url || null,
            source: data.data?.anime?.[0]?.anime?.title || "Unknown Anime"
        })
    },
    {
        name: "AniList GraphQL",
        url: "https://graphql.anilist.co",
        method: "POST",
        body: {
            query: `query {
                Character(id: ${Math.floor(Math.random() * 50000) + 1}) {
                    name { full }
                    image { large }
                    media(perPage: 1) { nodes { title { romaji } } }
                }
            }`
        },
        parse: (data) => {
            const c = data?.data?.Character;
            if (!c) return null;
            return {
                name: c.name?.full || "Unknown",
                image: c.image?.large || null,
                source: c.media?.nodes?.[0]?.title?.romaji || "Unknown"
            };
        }
    }
];

// Simple in-memory cache for 5 minutes (max 20 entries)
const cache = new Map();
const CACHE_TTL = 300000;
const MAX_CACHE = 20;

function getCached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) {
        cache.delete(key);
        return null;
    }
    return entry.data;
}

function setCache(key, data) {
    if (cache.size >= MAX_CACHE) {
        // Remove oldest entry
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
    }
    cache.set(key, { data, ts: Date.now() });
}

/**
 * Fetch a random anime character
 * Tries multiple APIs with failover
 * @returns {Object|null} { name, image, source }
 */
async function fetchRandomCharacter() {
    // Shuffle API order for rotation
    const shuffled = [...APIS].sort(() => Math.random() - 0.5);

    for (const api of shuffled) {
        try {
            const cacheKey = `${api.name}`;
            const cached = getCached(cacheKey);
            if (cached) return cached;

            let response;

            if (api.method === "POST") {
                response = await axios.post(api.url, api.body, {
                    headers: { "Content-Type": "application/json" },
                    timeout: 5000
                });
            } else {
                response = await axios.get(api.url, { timeout: 5000 });
            }

            const parsed = api.parse(response.data);
            if (parsed && parsed.name && parsed.image) {
                setCache(cacheKey, parsed);
                return parsed;
            }

        } catch (err) {
            console.warn(`⚠️ [AnimeFetcher] ${api.name} failed: ${err.message}`);
            continue;
        }
    }

    return null;
}

/**
 * Fetch multiple characters for card drops
 * @param {number} count
 * @returns {Array} array of character objects
 */
async function fetchMultipleCharacters(count = 1) {
    const results = [];
    for (let i = 0; i < count; i++) {
        const char = await fetchRandomCharacter();
        if (char) results.push(char);
        // Small delay between requests to respect rate limits
        if (i < count - 1) {
            await new Promise(r => setTimeout(r, 500));
        }
    }
    return results;
}

module.exports = {
    fetchRandomCharacter,
    fetchMultipleCharacters
};
