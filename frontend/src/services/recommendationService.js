import {calculateMatch} from './scoringService.js';
export function alternativeRecommendations(original,products,dimensions,weights,claims,prices){
 const base=calculateMatch(original,dimensions,weights,claims);
 const price=p=>Math.min(...prices.filter(x=>x.product_id===p.product_id).map(x=>x.price));
 return products.filter(p=>p.product_id!==original.product_id).map(p=>{
  const m=calculateMatch(p,dimensions,weights,claims);
  return {original_product_id:original.product_id,suggested_product_id:p.product_id,
    score_delta:m.raw_score===null||base.raw_score===null?null:m.raw_score-base.raw_score,
    price_delta:Number((price(p)-price(original)).toFixed(2)),
    distance_to_nearest_retailer:null,coverage_percent:m.coverage_percent,product:p};
 }).filter(r=>r.score_delta!==null&&r.score_delta>0).sort((a,b)=>b.score_delta-a.score_delta);
}
