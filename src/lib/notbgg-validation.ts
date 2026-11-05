import { parseGameRef, gameCatalogKey } from './game-identity';
import { accessoryCategories, notBggGameTypes } from './notbgg-contract';
import type { AccessoryCategory, NotBggEditableFields } from './notbgg-contract';

export class NotBggValidationError extends Error {
    constructor(public readonly field: string, message: string) { super(`${field}: ${message}`); }
}
function fail(field: string, message: string): never { throw new NotBggValidationError(field, message); }

export const notBggLimits = {
    name: 300, label: 300, description: 50_000, editorNotes: 10_000, contents: 20_000,
    url: 2048, list: 100, referenceUrls: 50, relatedGames: 100,
    year: 9999, age: 200, players: 1000, minutes: 100_000
} as const;

function defaults(): NotBggEditableFields {
    return { name: '', type: 'boardgame', alternateNames: [], description: null, yearPublished: null,
        minAge: null, minPlayers: null, maxPlayers: null, minPlaytime: null, maxPlaytime: null,
        recommendedPlayers: null, designers: [], artists: [], publishers: [], categories: [], mechanics: [],
        families: [], imageUrl: null, thumbnailUrl: null, referenceUrls: [], editorNotes: null,
        accessoryCategories: [], relatedGameIds: [], contents: null };
}
const allowed = new Set(Object.keys(defaults()));
function inputObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('input', 'Expected a plain object');
    const row = value as Record<string, unknown>;
    for (const key of Reflect.ownKeys(row)) {
        if (typeof key !== 'string' || !allowed.has(key)) fail(String(key), 'Unknown or backend-managed field');
        if (row[key] === undefined) fail(key, 'Omit the field or supply an explicit value/null');
    }
    return row;
}
function text(value: unknown, field: string, max: number, required = false): string | null {
    if (value === null && !required) return null;
    if (typeof value !== 'string') fail(field, 'Expected text');
    if (value.length > max) fail(field, `Maximum length ${max}`);
    const result = value.trim().normalize('NFC');
    if (result.length > max) fail(field, `Maximum normalized length ${max}`);
    if (!result && required) fail(field, 'Required');
    return result || null;
}
function integer(value: unknown, field: string, min: number, max: number): number | null {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        fail(field, `Expected integer ${min}..${max}, or null for unknown`);
    }
    return value;
}
function array(value: unknown, field: string, max: number = notBggLimits.list): unknown[] {
    if (!Array.isArray(value) || value.length > max || Object.keys(value).length !== value.length) fail(field, `Expected dense array with at most ${max} entries`);
    for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) fail(field, 'Sparse arrays are invalid');
    return value;
}
function labels(value: unknown, field: string): string[] {
    const result = array(value, field).map(v => text(v, field, notBggLimits.label, true)!);
    const seen = new Set<string>();
    return result.filter(v => { const key = v.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}
function url(value: unknown, field: string): string | null {
    const raw = text(value, field, notBggLimits.url);
    if (!raw) return null;
    let parsed: URL;
    try { parsed = new URL(raw); } catch { return fail(field, 'Expected absolute HTTP(S) URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        fail(field, 'Expected HTTP(S) URL without credentials');
    }
    const normalized = parsed.href;
    if (normalized.length > notBggLimits.url) fail(field, 'URL too long');
    return normalized;
}

function normalize(row: Record<string, unknown>): NotBggEditableFields {
    const result = defaults();
    result.name = text(row.name, 'name', notBggLimits.name, true)!;
    if (!notBggGameTypes.includes(row.type as never)) fail('type', 'Unsupported NotBGG type');
    result.type = row.type as NotBggEditableFields['type'];
    for (const field of ['alternateNames', 'designers', 'artists', 'publishers', 'categories', 'mechanics', 'families'] as const) {
        result[field] = labels(row[field], field);
    }
    for (const field of ['description', 'editorNotes', 'contents'] as const) result[field] = text(row[field], field, notBggLimits[field]);
    result.yearPublished = integer(row.yearPublished, 'yearPublished', 1, notBggLimits.year);
    // Age zero can mean suitable from birth; it is not used as an unknown sentinel.
    result.minAge = integer(row.minAge, 'minAge', 0, notBggLimits.age);
    for (const field of ['minPlayers', 'maxPlayers'] as const) result[field] = integer(row[field], field, 1, notBggLimits.players);
    for (const field of ['minPlaytime', 'maxPlaytime'] as const) result[field] = integer(row[field], field, 1, notBggLimits.minutes);
    for (const [min, max] of [['minPlayers', 'maxPlayers'], ['minPlaytime', 'maxPlaytime']] as const) {
        if (result[min] !== null && result[max] !== null && result[min]! > result[max]!) fail(max, 'Must be >= minimum');
    }
    result.recommendedPlayers = row.recommendedPlayers === null ? null : [...new Set(array(row.recommendedPlayers, 'recommendedPlayers')
        .map(v => integer(v, 'recommendedPlayers', 1, notBggLimits.players) ?? fail('recommendedPlayers', 'Null entries are invalid')))];
    for (const count of result.recommendedPlayers ?? []) {
        if ((result.minPlayers !== null && count < result.minPlayers) || (result.maxPlayers !== null && count > result.maxPlayers)) {
            fail('recommendedPlayers', 'Outside known player bounds');
        }
    }
    for (const field of ['imageUrl', 'thumbnailUrl'] as const) result[field] = url(row[field], field);
    result.referenceUrls = [...new Set(array(row.referenceUrls, 'referenceUrls', notBggLimits.referenceUrls)
        .map(v => url(v, 'referenceUrls') ?? fail('referenceUrls', 'Empty URL is invalid')))];
    result.accessoryCategories = [...new Set(array(row.accessoryCategories, 'accessoryCategories').map(v => {
        if (!accessoryCategories.includes(v as never)) fail('accessoryCategories', 'Unknown accessory category');
        return v as AccessoryCategory;
    }))];
    const refs = array(row.relatedGameIds, 'relatedGameIds', notBggLimits.relatedGames).map(v => {
        try { return parseGameRef(v); } catch { return fail('relatedGameIds', 'Invalid source identity'); }
    });
    result.relatedGameIds = [...new Map(refs.map(ref => [gameCatalogKey(ref), ref])).values()];
    if (result.type === 'boardgameaccessory') {
        for (const field of ['minPlayers', 'maxPlayers', 'minPlaytime', 'maxPlaytime', 'recommendedPlayers'] as const) {
            if (result[field] !== null) fail(field, 'Not applicable to accessories; use null');
        }
    } else if (result.accessoryCategories.length || result.relatedGameIds.length || result.contents !== null) {
        fail('accessoryCategories', 'Accessory-only fields require boardgameaccessory');
    }
    return result;
}

/** Accept untrusted JSON. Omitted optional create fields get explicit null/empty-list defaults. */
export function validateCreateNotBggGame(value: unknown): NotBggEditableFields {
    const row = inputObject(value);
    if (!Object.hasOwn(row, 'name') || !Object.hasOwn(row, 'type')) fail('input', 'name and type are required');
    return normalize({ ...defaults(), ...row });
}

/** Validate against current editable fields; return the full next value, not a shallow unchecked patch.
 * D2 must independently enforce expected revision and authorize the write.
 */
export function validateUpdateNotBggGame(value: unknown, current: NotBggEditableFields): NotBggEditableFields {
    const patch = inputObject(value);
    if (!Object.keys(patch).length) fail('input', 'Empty update');
    const editable: Record<string, unknown> = {};
    for (const key of allowed) editable[key] = current[key as keyof NotBggEditableFields];
    return normalize({ ...editable, ...patch });
}
