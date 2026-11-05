import assert from 'node:assert/strict';
import test from 'node:test';
import { validGameComplexity } from '../src/lib/game-complexity.ts';
import { getGames } from '../src/lib/games.ts';
import { buildCatalogPayload } from '../src/lib/catalog-payload.ts';

const invalid: [string,unknown][]=[['null',null],['undefined',undefined],['zero',0],['negative',-1],['NaN',NaN],['Infinity',Infinity],['negative Infinity',-Infinity],['above five',5.01],['below one',0.99],['numeric string','3'],['empty string',''],['boolean',true]];
for(const [name,value] of invalid)test(`complexity rejects ${name} as missing`,()=>assert.equal(validGameComplexity(value),null));
for(const value of [1,2,3,4,5,1.5,2.75,3.57,4.99])test(`complexity preserves valid ${value}`,()=>assert.equal(validGameComplexity(value),value));
test('actual #226690 has missing UI complexity without changing raw Parser classification',()=>{
    const bgg=getGames().find(g=>g.bggId===226690)!.bgg!;
    assert.equal(bgg.averageWeight,0);assert.equal(bgg.complexity,'Light');assert.equal(validGameComplexity(bgg.averageWeight),null);
});
test('catalog UI metadata applies the same numeric validity rule without rewriting source records',()=>{
    const seed=getGames().find(g=>g.bggId===226690)!;
    for(const value of [null,undefined,0,-1,NaN,Infinity,5.01,0.99,'3',1,2,3,4,5,2.75]){
        const game={...seed,bgg:{...seed.bgg!,averageWeight:value as number}};
        const record=buildCatalogPayload([game],'en').records[0];
        assert.equal(record.dataset.weight,String(validGameComplexity(value)??''));assert.ok(Object.is(game.bgg.averageWeight,value));
    }
});
