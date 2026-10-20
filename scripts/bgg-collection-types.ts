export interface BggCollectionItem {
    bggId: number;
    collectionId?: number;

    name: string;
    originalName?: string;

    yearPublished?: number;

    image?: string;
    thumbnail?: string;

    owned: boolean;
    previouslyOwned: boolean;
    forTrade: boolean;

    wishlist: boolean;
    preordered: boolean;

    wantToPlay: boolean;
    wantToBuy: boolean;
    want: boolean;

    myRating?: number;
    playCount: number;

    lastModified?: string;
}

export interface BggCollectionData {
    username: string;
    items: BggCollectionItem[];
}