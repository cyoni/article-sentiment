import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const googleNewsHostnames = new Set(['news.google.com', 'www.news.google.com']);
const allowedArticleProtocols = new Set(['http:', 'https:']);

export function asArray(value) {
    return value == null ? [] : Array.isArray(value) ? value : [value];
}

export function textValue(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'object' && '#text' in value) return String(value['#text']).trim();
    return String(value).trim();
}

export function normalizeIsoDate(value) {
    if (!value) return null;
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export function truncate(value, limit) {
    const text = String(value ?? '').trim();
    return text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated]`;
}

export function fillTemplate(template, values) {
    return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) =>
        String(values[key] ?? ''),
    );
}

export function companyContextJson(company) {
    return JSON.stringify({
        name: company.name,
        domain: company.domain ?? null,
        sector: company.sector ?? null,
        description: company.description ?? null,
    }, null, 2);
}

export function normalizeUrl(value) {
    const url = new URL(value);
    if (!allowedArticleProtocols.has(url.protocol) || !url.hostname || url.username || url.password) {
        throw new Error('URL must be an absolute HTTP(S) URL without credentials');
    }
    url.hash = '';

    for (const key of [...url.searchParams.keys()]) {
        if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    }

    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, '');
    return url.toString();
}

export function isSafeArticleUrl(value) {
    try {
        normalizeUrl(value);
        return true;
    } catch {
        return false;
    }
}

function isPrivateIpAddress(address) {
    if (isIP(address) === 4) {
        const [first, second] = address.split('.').map(Number);
        return first === 0 || first === 10 || first === 127 ||
            (first === 100 && second >= 64 && second <= 127) ||
            (first === 169 && second === 254) ||
            (first === 172 && second >= 16 && second <= 31) ||
            (first === 192 && second === 168);
    }

    const normalized = address.toLowerCase();
    return normalized === '::' || normalized === '::1' ||
        normalized.startsWith('fc') || normalized.startsWith('fd') ||
        normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
        normalized.startsWith('fea') || normalized.startsWith('feb') ||
        normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') ||
        normalized.startsWith('::ffff:192.168.') || normalized.startsWith('::ffff:169.254.');
}

export async function assertSafeArticleUrl(value) {
    const normalized = normalizeUrl(value);
    const hostname = new URL(normalized).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
        throw new Error('Article URL must not target a local host');
    }
    if (isIP(hostname)) {
        if (isPrivateIpAddress(hostname)) throw new Error('Article URL must not target a private IP address');
        return normalized;
    }

    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIpAddress(address))) {
        throw new Error('Article URL must resolve only to public IP addresses');
    }
    return normalized;
}

export function isGoogleNewsUrl(value) {
    try {
        return googleNewsHostnames.has(new URL(value).hostname.toLowerCase());
    } catch {
        return true;
    }
}

export async function fetchWithTimeout(url, options = {}, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const signal = options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;

    try {
        return await fetch(url, { ...options, signal });
    } finally {
        clearTimeout(timeout);
    }
}

export async function mapWithConcurrency(items, worker, limit) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function consume() {
        while (true) {
            const index = nextIndex++;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
    return results;
}
