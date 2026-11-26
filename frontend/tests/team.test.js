import test from 'node:test';
import assert from 'node:assert/strict';
import team from '../src/data/team.json' with { type: 'json' };
import { initials, linkedinUrl } from '../src/services/teamService.js';

test('every team member has a name, a role and a photo path under /team/', () => {
  assert.equal(team.length, 5);
  for (const m of team) {
    assert.ok(m.name && m.name.trim(), 'name');
    assert.ok(m.role && m.role.trim(), `role for ${m.name}`);
    assert.match(m.photo, /^\/team\/.+\.(jpe?g|png|webp)$/i, `photo for ${m.name}`);
    assert.equal(typeof m.linkedin, 'string', `linkedin for ${m.name}`);
  }
});

test('team copy uses no em or en dashes', () => {
  for (const m of team) {
    assert.doesNotMatch(m.role, /[–—]/, `role for ${m.name}`);
  }
});

test('initials use the first and last word', () => {
  assert.equal(initials('Nwakalor Ejike'), 'NE');
  assert.equal(initials('Abdul Nasir Muniru'), 'AM');
  assert.equal(initials('rosa'), 'R');
  assert.equal(initials('  '), '');
});

test('every team member links to a LinkedIn profile', () => {
  for (const m of team) {
    assert.match(linkedinUrl(m.linkedin) || '', /^https:\/\/www\.linkedin\.com\/in\/[^/\s]+\/?$/, `linkedin for ${m.name}`);
  }
});

test('only https LinkedIn links are shown', () => {
  assert.equal(linkedinUrl(''), null);
  assert.equal(linkedinUrl('javascript:alert(1)'), null);
  assert.equal(linkedinUrl('http://www.linkedin.com/in/x'), null);
  assert.equal(linkedinUrl(' https://www.linkedin.com/in/x '), 'https://www.linkedin.com/in/x');
});
