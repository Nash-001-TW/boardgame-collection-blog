/** Preserve the legacy public ownership override exactly; collection status remains independent. */
export function collectionOwned(acquisitionStatus:string,legacyOwned:unknown):boolean {
    if(typeof legacyOwned==='boolean')return legacyOwned;
    if(legacyOwned===1||legacyOwned==='1'||legacyOwned==='true')return true;
    if(legacyOwned===0||legacyOwned==='0'||legacyOwned==='false')return false;
    return acquisitionStatus==='owned';
}
