import type { Game } from './game-catalog';
import type { BggGameData } from './bgg-types';
import { getCatalogGameType } from './game-content';
import type { CatalogGameType } from './game-content';
import { gameCatalogKey, notBggRouteSegment, parseGameRef } from './game-identity';
import type { GameRef } from './game-identity';
import type { AccessoryCategory, NotBggGame, NotBggEditableFields } from './notbgg-contract';
import { translateGameName } from '../i18n/utils';
import { decodeGameName } from './game-name';

export type DisplayTerm =
    | { source: 'bgg'; bggId: number; name: string }
    | { source: 'notbgg'; name: string };
/** Public projection: excludes editor notes, audit identities and collection data. */
export interface GameViewModel {
    key: string;
    ref: GameRef;
    name: string;
    alternateNames: readonly string[];
    type: CatalogGameType;
    description: string | null;
    yearPublished: number | null;
    minAge: number | null;
    play: { minPlayers: number | null; maxPlayers: number | null; minPlaytime: number | null; maxPlaytime: number | null } | null;
    playerAdvice: { source: 'bgg-community-best' | 'editor-recommended'; counts: readonly number[] } | null;
    designers: readonly DisplayTerm[];
    artists: readonly DisplayTerm[];
    publishers: readonly DisplayTerm[];
    categories: readonly DisplayTerm[];
    mechanics: readonly DisplayTerm[];
    families: readonly DisplayTerm[];
    images: { primary: string | null; thumbnail: string | null; catalog: string | null; fallback: string | null };
    href: string | null;
    referenceUrls: readonly string[];
    accessory: { categories: readonly AccessoryCategory[]; relatedGames: readonly GameRef[]; contents: string | null } | null;
    /** Raw BGG statistics and official relation evidence stay exclusively in this BGG-only branch. */
    bgg: Readonly<BggGameData> | null;
}
const positive = (n: number | undefined): number | null => typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
function images(image: string | null | undefined, thumbnail: string | null | undefined): GameViewModel['images'] {
    const primary = image || thumbnail || null, catalog = thumbnail || image || null;
    return { primary, thumbnail: thumbnail || null, catalog, fallback: image && image !== catalog ? image : null };
}

/** Does not reinterpret BGG relations, translate names, invent statistics, or mutate the source. */
export function bggGameViewModel(game: Game, lang: 'en' | 'zh-TW' = 'zh-TW'): GameViewModel {
    const ref = parseGameRef({ source: 'bgg', bggId: game.bggId });
    const b = game.bgg, type = getCatalogGameType(b?.gameType);
    const terms = (field: 'designers' | 'artists' | 'publishers' | 'categories' | 'mechanics' | 'families'): DisplayTerm[] =>
        (b?.[field] ?? []).map(term => ({ source: 'bgg', bggId: term.id, name: term.name }));
    const name = translateGameName(game.bggId, game.name, lang), original = decodeGameName(game.name);
    return { key: gameCatalogKey(ref), ref, name, alternateNames: name === original ? [] : [original], type,
        description: b?.description || null, yearPublished: positive(b?.year), minAge: positive(b?.minAge),
        play: type === 'accessory' ? null : { minPlayers: positive(b?.minPlayers), maxPlayers: positive(b?.maxPlayers),
            minPlaytime: positive(b?.minPlayTime), maxPlaytime: positive(b?.maxPlayTime) },
        playerAdvice: type !== 'accessory' && b?.bestPlayerCounts.length ? { source: 'bgg-community-best', counts: [...b.bestPlayerCounts] } : null,
        designers: terms('designers'), artists: terms('artists'), publishers: terms('publishers'), categories: terms('categories'),
        mechanics: terms('mechanics'), families: terms('families'), images: images(b?.image, b?.thumbnail),
        href: b ? `${lang === 'en' ? '/en' : ''}/games/${encodeURIComponent(game.slug)}` : null,
        referenceUrls: [`https://boardgamegeek.com/boardgame/${game.bggId}`], accessory: null, bgg: b };
}

/** Projection of the original NotBGG source. Primary-source resolution belongs to identity-resolution, not this source adapter. */
export type NotBggViewSource = Pick<NotBggGame, 'notBggId'> & Omit<NotBggEditableFields, 'editorNotes'>;
export function notBggGameViewModel(game: NotBggViewSource, lang: 'en' | 'zh-TW' = 'zh-TW'): GameViewModel {
    const ref = parseGameRef({ source: 'notbgg', notBggId: game.notBggId });
    const terms = (items: string[]): DisplayTerm[] => items.map(name => ({ source: 'notbgg', name }));
    const accessory = game.type === 'boardgameaccessory';
    return { key: gameCatalogKey(ref), ref, name: game.name, alternateNames: [...game.alternateNames], type: getCatalogGameType(game.type),
        description: game.description, yearPublished: game.yearPublished, minAge: game.minAge,
        play: accessory ? null : { minPlayers: game.minPlayers, maxPlayers: game.maxPlayers, minPlaytime: game.minPlaytime, maxPlaytime: game.maxPlaytime },
        playerAdvice: !accessory && game.recommendedPlayers?.length ? { source: 'editor-recommended', counts: [...game.recommendedPlayers] } : null,
        designers: terms(game.designers), artists: terms(game.artists), publishers: terms(game.publishers), categories: terms(game.categories),
        mechanics: terms(game.mechanics), families: terms(game.families), images: images(game.imageUrl, game.thumbnailUrl),
        href: `${lang === 'en' ? '/en' : ''}/games/notbgg/${notBggRouteSegment(game.notBggId)}`,
        referenceUrls: [...game.referenceUrls], accessory: accessory ? { categories: [...game.accessoryCategories],
            relatedGames: game.relatedGameIds.map(parseGameRef), contents: game.contents } : null, bgg: null };
}
