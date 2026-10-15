export function statusLabel(status){return status==='Verified'?'Verified (demo only)':status==='Claimed'?'Claimed / not verified':status==='Disputed'?'Disputed':status==='Expired'?'Expired':'Unknown';}
export function getSource(sourceId,sources){return sources.find(s=>s.source_id===sourceId)||null;}
export function ownershipChain(companyId,companies){
 const chain=[],seen=new Set();let id=companyId;
 while(id&&!seen.has(id)){seen.add(id);const c=companies.find(x=>x.company_id===id);if(!c)break;chain.push(c);id=c.parent_company_id;}
 return chain;
}
