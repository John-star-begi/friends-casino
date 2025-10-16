// Shared token helpers
function getTokens(){ return Number(localStorage.getItem('tokens')||100); }
function setTokens(n){ localStorage.setItem('tokens', n); }
function changeTokens(x){
  let t = getTokens() + x;
  if (t < 0) t = 0;
  setTokens(t);
  const el = document.getElementById('tokens');
  if (el) el.textContent = t;
}
window.addEventListener('load', ()=> {
  const el = document.getElementById('tokens');
  if (el) el.textContent = getTokens();
});
