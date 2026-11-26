// Small helpers for the About section's team cards. No DOM here, so tests can import them.

// "Nwakalor Ejike" -> "NE", "Abdul Nasir Muniru" -> "AM", "Rosa" -> "R"
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = words[0][0], last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Only https links become a LinkedIn icon; an empty or unsafe value hides it.
export function linkedinUrl(url) {
  const value = String(url || '').trim();
  return /^https:\/\/\S+$/i.test(value) ? value : null;
}
