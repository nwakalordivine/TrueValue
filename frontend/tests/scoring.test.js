import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateMatch,rankProducts} from '../src/services/scoringService.js';
import products from '../src/data/products.json' with {type:'json'};
import dimensions from '../src/data/ethicalDimensions.json' with {type:'json'};
import claims from '../src/data/claims.json' with {type:'json'};
const weights=Object.fromEntries(dimensions.map(d=>[d.dimension_id,d.default_weight]));
test('scores are computed and evidence coverage is distinct',()=>{
 const s=calculateMatch(products[0],dimensions,weights,claims);
 assert.ok(s.raw_score>=0&&s.raw_score<=100);assert.ok(s.coverage_percent<100);assert.equal(s.model_version,'1.0.0');
});
test('unknown does not become zero',()=>{
 const w=Object.fromEntries(dimensions.map(d=>[d.dimension_id,d.dimension_id==='animal_welfare'?100:0]));
 const s=calculateMatch(products[0],dimensions,w,claims);
 assert.equal(s.raw_score,null);assert.equal(s.coverage_percent,0);
});
test('same inputs give same score and breakdown',()=>{
 const a=calculateMatch(products[0],dimensions,weights,claims),b=calculateMatch(products[0],dimensions,weights,claims);
 assert.equal(a.raw_score,b.raw_score);assert.deepEqual(a.breakdown_json,b.breakdown_json);
});
test('priority weights can change rankings without changing product claims',()=>{
 const first=rankProducts(products,dimensions,weights,claims);
 const before=JSON.stringify(claims);
 const changed={...weights,canadian_ownership:0,environment:100};
 rankProducts(products,dimensions,changed,claims);
 assert.equal(JSON.stringify(claims),before);assert.equal(first.length,products.length);
});
test('no selected weights produces N/A and zero coverage',()=>{
 const w=Object.fromEntries(dimensions.map(d=>[d.dimension_id,0]));
 const s=calculateMatch(products[0],dimensions,w,claims);
 assert.equal(s.raw_score,null);assert.equal(s.coverage_percent,0);
});
