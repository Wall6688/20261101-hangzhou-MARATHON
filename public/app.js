const API = (window.MARATHON_API_URL || '').replace(/\/$/, '');
const raceDay = new Date('2026-11-01T07:00:00+08:00');
let workouts = [];
let selectedWeek = 'all';
const $ = (selector) => document.querySelector(selector);
const fmt = (value) => Number(value || 0).toFixed(1).replace('.0', '');
const todayKey = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());

function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2400); }
function typeClass(type) { return type === '比赛' ? 'race' : ''; }
function render() {
  const done = workouts.filter(w=>w.completed);
  const running = workouts.filter(w=>!['休息','力量'].includes(w.type));
  const actual = workouts.reduce((sum,w)=>sum+(w.actualKm||0),0);
  const planned = running.reduce((sum,w)=>sum+(w.plannedKm||0),0);
  $('#completion').textContent = `${Math.round(done.length / workouts.length * 100) || 0}%`;
  $('#done-count').textContent = `${done.length} / ${workouts.length} 日已打卡`;
  $('#mileage').textContent = `${fmt(actual)} / ${fmt(planned)}`;
  const current = workouts.find(w=>w.date===todayKey()) || workouts.find(w=>!w.completed) || workouts.at(-1);
  const weekRows = workouts.filter(w=>w.week===current?.week);
  $('#week-progress').textContent = `${weekRows.filter(w=>w.completed).length}/${weekRows.length}`;
  $('#week-label').textContent = current ? `第 ${current.week} 周训练进度` : '训练进度';
  renderToday(current); renderWeeklyStats(current?.week); renderTimeline();
}
function renderWeeklyStats(fallbackWeek) {
  const week = selectedWeek === 'all' ? fallbackWeek || workouts.find(w=>w.date===todayKey())?.week || 1 : Number(selectedWeek);
  const rows = workouts.filter(w=>w.week===week);
  if(!rows.length) return;
  const completed = rows.filter(w=>w.completed).length;
  const plannedKm = rows.reduce((sum,w)=>sum+(w.plannedKm||0),0);
  const actualKm = rows.reduce((sum,w)=>sum+(w.actualKm||0),0);
  const checkinRate = Math.round(completed/rows.length*100);
  const mileageRate = plannedKm ? Math.round(actualKm/plannedKm*100) : 0;
  const keyRows = rows.filter(w=>['质量课','MP专项','长距离'].includes(w.type));
  const keyDone = keyRows.filter(w=>w.completed).length;
  const types = [...new Set(rows.filter(w=>(w.plannedKm||0)>0).map(w=>w.type))];
  $('#weekly-title').textContent=`第 ${week} 周统计`;
  $('#weekly-range').textContent=`${rows[0].date.slice(5).replace('-',' / ')} — ${rows.at(-1).date.slice(5).replace('-',' / ')}`;
  $('#weekly-checkins').textContent=`${completed} / ${rows.length}`;
  $('#weekly-checkin-rate').textContent=`完成率 ${checkinRate}%`;
  $('#weekly-distance').textContent=`${fmt(actualKm)} km`;
  $('#weekly-distance-plan').textContent=`计划 ${fmt(plannedKm)} km`;
  $('#weekly-key').textContent=`${keyDone} / ${keyRows.length}`;
  $('#weekly-mileage-rate').textContent=`${mileageRate}%`;
  const bar=$('#weekly-mileage-bar'); bar.style.width=`${Math.min(100,mileageRate)}%`;
  bar.parentElement.setAttribute('aria-valuenow',String(Math.min(100,mileageRate)));
  $('#weekly-types').innerHTML=types.map(type=>{const typeRows=rows.filter(w=>w.type===type);const done=typeRows.filter(w=>w.completed).length;return `<span><b>${type}</b>${done}/${typeRows.length}</span>`}).join('');
}
function renderToday(w) {
  if(!w) return $('#today-card').innerHTML='<div class="empty">暂无训练计划</div>';
  $('#today-card').innerHTML=`<div class="today-head"><div><span class="eyebrow">${w.date===todayKey()?'TODAY':'NEXT SESSION'} · WEEK ${w.week}</span><h2>${w.type} · ${w.plannedKm ? `${fmt(w.plannedKm)}km` : '恢复日'}</h2></div><span class="tag">${w.completed?'已完成':'待打卡'}</span></div><p>${w.plan}</p><button class="button" data-checkin="${w.id}">${w.completed?'查看 / 修改记录':'完成训练并打卡'}</button>`;
}
function renderTimeline(){
  const list=selectedWeek==='all'?workouts:workouts.filter(w=>String(w.week)===selectedWeek);
  $('#timeline').innerHTML=list.map(w=>`<article class="workout ${w.completed?'done':''} ${typeClass(w.type)}"><div class="date"><strong>${w.date.slice(5).replace('-',' / ')}</strong><small>${w.weekday} · W${w.week}</small></div><div><div class="workout-title">${w.type}</div><p>${w.plan}</p></div><div class="km">${w.plannedKm?fmt(w.plannedKm)+' KM':'—'}</div><button class="check" data-checkin="${w.id}">${w.completed?'✓ 已打卡':'记录训练'}</button></article>`).join('');
}
function openCheckin(id){
  const w=workouts.find(x=>x.id===id); if(!w)return;
  $('#workout-id').value=id; $('#dialog-title').textContent=`${w.date.slice(5)} · ${w.type}`;
  $('#actual-km').value=w.actualKm??''; $('#duration').value=w.durationMinutes??''; $('#pace').value=w.pace||'';
  $('#heart-rate').value=w.heartRate??''; $('#rpe').value=w.rpe??''; $('#note').value=w.note||''; $('#completed').checked=w.completed;
  $('#checkin-dialog').showModal();
}
document.addEventListener('click',e=>{ const id=e.target.closest('[data-checkin]')?.dataset.checkin; if(id)openCheckin(id); const week=e.target.closest('[data-week]'); if(week){document.querySelectorAll('[data-week]').forEach(x=>x.classList.remove('active'));week.classList.add('active');selectedWeek=week.dataset.week;renderWeeklyStats();renderTimeline();}});
$('#checkin-form').addEventListener('submit',async e=>{
  e.preventDefault(); const button=$('#save-button'); button.disabled=true; button.textContent='保存中…';
  try{const id=$('#workout-id').value;const response=await fetch(`${API}/api/workouts/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({actualKm:$('#actual-km').value,durationMinutes:$('#duration').value,pace:$('#pace').value,heartRate:$('#heart-rate').value,rpe:$('#rpe').value,note:$('#note').value,completed:$('#completed').checked})});const data=await response.json();if(!response.ok)throw new Error(data.error||'保存失败');workouts=workouts.map(w=>w.id===id?data:w);render();$('#checkin-dialog').close();toast(data.syncStatus==='pending'?'已保存，等待同步 Notion':'已同步到 Notion');}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent='保存到 Notion';}
});
async function boot(){
  $('#countdown').textContent=`${Math.max(0,Math.ceil((raceDay-new Date())/86400000))} 天`;
  try{const response=await fetch(`${API}/api/workouts`);const data=await response.json();if(!response.ok)throw new Error(data.error||'读取失败');workouts=data;$('#week-buttons').innerHTML=[...new Set(workouts.map(w=>w.week))].map(w=>`<button data-week="${w}">W${w}</button>`).join('');render();}catch(error){$('#today-card').innerHTML=`<div class="empty"><strong>暂时无法读取训练数据库</strong><p>${error.message}</p><p>请确认后端地址与 NOTION_TOKEN 已配置。</p></div>`;}
}
boot();
