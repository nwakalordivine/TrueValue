// Team cards for the About section. Data: src/data/team.json. Photos: public/team/ (served at /team/).
import { esc } from './views.js';
import { icon } from './icons.js';
import { initials, linkedinUrl } from '../services/teamService.js';

function card(member) {
  const link = linkedinUrl(member.linkedin);
  return `<li class="team-card">
    <div class="team-photo">
      <span class="team-initials" aria-hidden="true">${esc(initials(member.name))}</span>
      ${member.photo ? `<img src="${esc(member.photo)}" alt="Portrait of ${esc(member.name)}" loading="lazy" width="320" height="320">` : ''}
    </div>
    <p class="team-name">${esc(member.name)}</p>
    <p class="team-role">${esc(member.role)}</p>
    ${link ? `<a class="icon-button team-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(member.name)} on LinkedIn">${icon('linkedin', 20)}</a>` : ''}
  </li>`;
}

export const teamCards = team => `<ul class="team-grid" role="list">${team.map(card).join('')}</ul>`;

// A photo that is missing or fails to load is removed, so the initials circle underneath shows instead of a broken image.
export function wireTeamPhotos(root) {
  root.querySelectorAll('.team-photo img').forEach(img => {
    const drop = () => img.remove();
    if (img.complete && img.naturalWidth === 0 && img.currentSrc) drop();
    else img.addEventListener('error', drop, { once: true });
  });
}
