const KEY='truevalue-user-v2';
export function loadUser(defaultUser, priorityWeights) {
  const defaults={...defaultUser,weights:Object.fromEntries(priorityWeights.map(p=>[p.dimension_id,p.weight]))};
  try {
    const saved=JSON.parse(localStorage.getItem(KEY)||'null');
    if(!saved) return defaults;
    return {...defaults,...saved,weights:{...defaults.weights,...saved.weights}};
  } catch {return defaults;}
}
export function saveUser(user){localStorage.setItem(KEY,JSON.stringify(user));}
