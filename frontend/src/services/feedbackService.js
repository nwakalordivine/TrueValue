const KEY='truevalue-feedback-v2';
export function saveFeedback(record){
 let items=[];try{items=JSON.parse(localStorage.getItem(KEY)||'[]');}catch{}
 items.push({...record,status:'pending-review',created_at:new Date().toISOString()});
 localStorage.setItem(KEY,JSON.stringify(items));return items.length;
}
