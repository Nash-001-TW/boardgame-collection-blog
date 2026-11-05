export type BrowserModule = "games" | "collection";

const sharedSorts = ["name-asc", "name-desc", "year-desc", "year-asc", "bgg-rating-desc", "weight-desc"];
const sharedParameters = ["q", "filter", "sort", "players", "time", "weight", "mechanic", "page"];

/** One source of truth for controls and URL validation, not inferred from ownership. */
export const browserCapabilities = {
    games: {
        filters: ["base", "all", "expansion", "accessory", "unknown"],
        defaultFilter: "base",
        searchAllTypesByDefault: true,
        views: ["grid", "list"],
        sorts: sharedSorts,
        parameters: [...sharedParameters, "view", "accessory"]
    },
    collection: {
        filters: ["all", "base", "expansion", "bundle", "promo", "accessory", "owned", "unowned", "wishlist", "preorder"],
        defaultFilter: "all",
        searchAllTypesByDefault: false,
        views: ["grid"],
        // Personal rating / want-to-play / want-to-buy are not provided by this adapter yet.
        sorts: sharedSorts,
        parameters: [...sharedParameters, "tagMechanic", "category"]
    }
} satisfies Record<BrowserModule, { filters: string[]; sorts: string[]; parameters: string[];
    defaultFilter: string; searchAllTypesByDefault: boolean; views: string[] }>;
