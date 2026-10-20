export interface BggCollectionItem {
    bggId: number;
    collectionId?: number;
    name: string;
    originalName?: string;
    yearPublished?: number;
    image?: string;
    thumbnail?: string;
    previouslyOwned: boolean;
    forTrade: boolean;
    want: boolean;
    lastModified?: string;

    owned: boolean;
    wishlist: boolean;
    preordered: boolean;

    wantToPlay: boolean;
    wantToBuy: boolean;

    myRating?: number;
    playCount: number;
}

export interface BggCollectionData {
    username: string;
    items: BggCollectionItem[];
}