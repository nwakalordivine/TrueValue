import {getSource,statusLabel,ownershipChain} from '../services/provenanceService.js';
export function scoreExplanation(product,result,companies,sources,certifications,productCertifications){
 const chain=ownershipChain(product.company_id,companies);
 const certs=productCertifications.filter(x=>x.product_id===product.product_id);
 return `<h3>${product.emoji} ${product.name}</h3>
 <p class="muted">Score ${result.raw_score??'N/A'}/100 · Evidence coverage ${result.coverage_percent}% · Confidence ${(result.confidence*100).toFixed(0)}% · Model ${result.model_version}</p>
 <p class="muted">Calculated at ${new Date(result.computed_at).toLocaleString()}. Confidence is a demo heuristic, not a statistical probability.</p>
 <h4>Company ownership chain</h4><p>${chain.map(c=>c.legal_name).join(' → ')||'Unknown'}: ${chain[0]?.ownership_status||'Unknown'}</p>
 <h4>Manufacture and packaging</h4><p>Manufactured: ${product.country_of_manufacture||'Unknown'} (demo data); components: ${product.country_of_origin_components.join(', ')||'Unknown'}.</p>
 <p>Materials: ${product.packaging.materials.join(', ')}. Regina recycling eligibility: ${product.packaging.recyclable_in_regina===null?'Unknown':String(product.packaging.recyclable_in_regina)}.</p>
 <h4>Certifications</h4><p>${certs.length?certs.map(x=>{
  const cert=certifications.find(c=>c.certification_id===x.certification_id);
  return `${cert?.name||x.certification_id}: ${statusLabel(x.status)}`;
 }).join(' · '):'None recorded'}</p>
 <h4>Assessment breakdown and provenance</h4>
 <div class="table-scroll"><table><thead><tr><th>Dimension</th><th>Score</th><th>Status</th><th>Source</th><th>Weight</th></tr></thead><tbody>
 ${result.breakdown_json.map(r=>`<tr><td>${r.dimension}</td><td>${r.raw_score??'Unknown'}</td><td><span class="status ${r.status.toLowerCase()}">${statusLabel(r.status)}</span></td><td>${getSource(r.source_id,sources)?.name||'No source'}</td><td>${r.weight}</td></tr>`).join('')}
 </tbody></table></div><p class="muted">No demo label represents real-world independent verification. Claimed assessments are provisional. Unknown criteria are excluded from the numeric match but reduce coverage.</p>`;
}
