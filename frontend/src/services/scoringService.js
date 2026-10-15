export const MODEL_VERSION = '1.0.0';
const validStatus = new Set(['Verified', 'Claimed']);
// Unknown is null, never zero. Claimed scores are provisional, never presented as independently verified.
export function calculateMatch(product, dimensions, weights, claims, userId = 'demo-user') {
  const rows = dimensions.map(d => {
    const weight = Math.max(0, Math.min(100, Number(weights[d.dimension_id]) || 0));
    const claim = claims.find(c => c.product_id === product.product_id && c.dimension_id === d.dimension_id);
    const scored = Boolean(claim && validStatus.has(claim.status) && Number.isFinite(claim.raw_score));
    return {dimension_id:d.dimension_id, dimension:d.label, weight,
      raw_score:scored ? claim.raw_score : null,
      confidence:scored ? claim.confidence : 0,
      coverage_percent:scored ? claim.coverage_percent : 0,
      status:claim?.status || 'Unknown', source_id:claim?.source_id || null,
      claim_id:claim?.claim_id || null, contribution:scored ? weight*claim.raw_score : null};
  });
  const totalWeight=rows.reduce((s,r)=>s+r.weight,0);
  const available=rows.filter(r=>r.weight>0 && r.raw_score !== null);
  const coveredWeight=available.reduce((s,r)=>s+r.weight*(r.coverage_percent/100),0);
  const denominator=available.reduce((s,r)=>s+r.weight,0);
  const score=denominator ? Math.round(available.reduce((s,r)=>s+r.contribution,0)/denominator) : null;
  const coverage_percent=totalWeight ? Math.round(coveredWeight/totalWeight*100) : 0;
  const confidence=denominator ? Number((available.reduce((s,r)=>s+r.weight*r.confidence,0)/denominator).toFixed(2)) : 0;
  return {score_id:`computed-${product.product_id}-${userId}`,product_id:product.product_id,user_id:userId,
    dimension_id:null,raw_score:score,confidence,coverage_percent,breakdown_json:rows,
    computed_at:new Date().toISOString(),model_version:MODEL_VERSION};
}
export function rankProducts(products,dimensions,weights,claims) {
  return [...products].sort((a,b)=>{
    const x=calculateMatch(a,dimensions,weights,claims),y=calculateMatch(b,dimensions,weights,claims);
    return (y.raw_score??-1)-(x.raw_score??-1) || y.coverage_percent-x.coverage_percent || a.name.localeCompare(b.name);
  });
}
