const state = { members: [], trainers: [], packages: [], schedules: [], weekOffset: 0, selectedMemberId: null };

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[s]));
const actionIcon = (name) => ({
  view: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4.3-.9L19 8.4a2.1 2.1 0 0 0-3-3L5.3 16.1 4 20Z"/></svg>',
  delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3"/></svg>'
}[name] || '');

async function api(url, options={}) {
  const res = await fetch(url, { headers: { 'Content-Type':'application/json', ...(options.headers||{}) }, ...options });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/api/auth/')) showLogin('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  if (!res.ok) throw new Error(data.message || 'Có lỗi xảy ra.');
  return data;
}

function showLogin(message='') {
  $('appShell').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');
  $('loginError').textContent = message;
  $('loginForm').elements.password.value = '';
  $('loginForm').elements.username.focus();
}

function showDashboard() {
  $('loginScreen').classList.add('hidden');
  $('appShell').classList.remove('hidden');
  $('loginError').textContent = '';
}

function toast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

function statusBadge(status) {
  const cls = status === 'Hết hạn' ? 'expired' : status === 'Tạm khóa' ? 'locked' : status === 'Tạm nghỉ' ? 'inactive' : '';
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

const pageContent = {
  overview: ['Tổng quan hoạt động', 'Cập nhật nhanh tình hình phòng tập của bạn.'],
  members: ['Quản lý hội viên', 'Theo dõi hồ sơ, quyền lợi và trạng thái hội viên.'],
  packages: ['Quản lý gói tập', 'Quản lý danh mục gói và quyền lợi của hội viên.'],
  trainers: ['Quản lý huấn luyện viên', 'Theo dõi hồ sơ HLV, chuyên môn và tình trạng làm việc.'],
  schedules: ['Quản lý lịch tập', 'Theo dõi lịch lớp và huấn luyện viên phụ trách theo tuần.']
};

function showPage(page) {
  if (!pageContent[page]) return;
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === page));
  document.querySelectorAll('.page-section').forEach(section => section.classList.toggle('hidden', section.id !== page));
  $('pageTitle').textContent = pageContent[page][0];
  $('pageDescription').textContent = pageContent[page][1];
}

function displayDate(value) {
  return value ? String(value).slice(0, 10) : '—';
}
function formatDate(value) {
  const date=displayDate(value);
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match?`${match[3]}/${match[2]}/${match[1]}`:date;
}

$('health').textContent='Đang kiểm tra...';
async function loadHealth(){
  try {
    const d = await api('/health');
    const healthy = d.database === 'connected';
    $('health').classList.toggle('is-healthy', healthy);
    $('health').textContent = healthy ? '● Hệ thống hoạt động' : '● Có lỗi';
  } catch {
    $('health').classList.remove('is-healthy');
    $('health').textContent='● Không kết nối được';
  }
}

async function loadAll(){
  [state.members,state.packages,state.trainers,state.schedules] = await Promise.all([
    api('/api/members'),api('/api/packages'),api('/api/trainers'),api('/api/schedules')
  ]);
  renderAll();
  const d=await api('/api/dashboard');
  $('statMembers').textContent=d.members.total||0; $('statActive').textContent=`${d.members.active||0} đang hoạt động`;
  $('statTrainers').textContent=d.trainers.total||0; $('statPackages').textContent=d.packages.total||0; $('statSchedules').textContent=d.schedules.total||0;
  renderOverviewPanels();
}

function renderAll(){ renderMembers(); renderPackages(); renderTrainers(); renderSchedules(); }

function renderOverviewPanels(){
  const memberCount=state.members.length;
  const distribution=$('overviewPackageDistribution');
  const packageCounts=new Map(state.packages.map(item=>[String(item.id),{name:item.name,count:0}]));
  state.members.forEach(member=>{
    const key=member.package_id==null?null:String(member.package_id);
    const existing=key&&packageCounts.get(key);
    if(existing) existing.count++;
    else if(member.package_name){
      const fallbackKey=`name:${member.package_name}`;
      const fallback=packageCounts.get(fallbackKey)||{name:member.package_name,count:0};
      fallback.count++;
      packageCounts.set(fallbackKey,fallback);
    }else{
      const unassigned=packageCounts.get('unassigned')||{name:'Chưa chọn gói tập',count:0};
      unassigned.count++;
      packageCounts.set('unassigned',unassigned);
    }
  });
  const distributionItems=[...packageCounts.values()]
    .filter(item=>item.count>0)
    .sort((a,b)=>b.count-a.count);
  const colors=['#3483f6','#20b98a','#8145e8','#f5a524'];
  if(!distributionItems.length){
    distribution.innerHTML='<p class="overview-empty">Chưa có dữ liệu hội viên.</p>';
  }else{
    const radius=42;
    const circumference=2*Math.PI*radius;
    let offset=0;
    const segments=distributionItems.map((item,index)=>{
      const length=circumference*item.count/memberCount;
      const color=colors[index%colors.length];
      const segment=`<circle cx="60" cy="60" r="${radius}" fill="none" stroke="${color}" stroke-width="19" stroke-dasharray="${length} ${circumference-length}" stroke-dashoffset="${-offset}"/>`;
      offset+=length;
      return segment;
    }).join('');
    const description=distributionItems.map(item=>`${item.name}: ${Math.round(item.count/memberCount*100)}%`).join(', ');
    distribution.innerHTML=`<div class="package-donut"><svg viewBox="0 0 120 120" role="img" aria-label="Phân bố ${memberCount} hội viên theo gói tập: ${esc(description)}"><circle cx="60" cy="60" r="${radius}" fill="none" stroke="#edf0f5" stroke-width="19"/>${segments}</svg><div class="package-donut-center"><strong>${memberCount}</strong><span>hội viên</span></div></div><ul class="package-legend">${distributionItems.map((item,index)=>`<li><span class="package-legend-name"><i style="--package-color:${colors[index%colors.length]}"></i>${esc(item.name)}</span><strong>${Math.round(item.count/memberCount*100)}%</strong></li>`).join('')}</ul>`;
  }

  const today=new Date();
  const todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const todaySchedules=state.schedules
    .filter(schedule=>displayDate(schedule.schedule_date)===todayKey)
    .sort((a,b)=>String(a.start_time).localeCompare(String(b.start_time)));
  $('overviewTodaySchedules').innerHTML=todaySchedules.length
    ?todaySchedules.map(schedule=>`<li><span><strong>${esc(String(schedule.start_time||'').slice(0,5))} - ${esc(String(schedule.end_time||'').slice(0,5))}</strong><small>${esc(schedule.trainer_name||schedule.class_type||'Lịch tập')}</small></span><strong>${esc(schedule.title)}</strong></li>`).join('')
    :'<li class="overview-empty">Hôm nay chưa có lịch tập.</li>';
}

function renderMembers(){
  const cards=$('memberCards');
  const query=$('memberSearch').value.trim().toLocaleLowerCase('vi');
  const status=$('memberStatus').value;
  const members=state.members.filter(m=>{
    const code=`HV${String(m.id).padStart(5,'0')}`;
    const matchesText=[m.full_name,m.phone,m.email,String(m.id),code].some(value=>String(value||'').toLocaleLowerCase('vi').includes(query));
    return matchesText&&(!status||m.status===status);
  });
  if(!members.length){
    cards.innerHTML=`<div class="panel empty">${state.members.length?'Không tìm thấy hội viên phù hợp.':'Chưa có hội viên. Hãy thêm hội viên đầu tiên.'}</div>`;
    $('memberCount').textContent='Hiển thị 0 hội viên';
    return;
  }
  cards.innerHTML=members.map(m=>`<article class="trainer-card member-card"><div class="trainer-card-top">${m.profile_photo?`<img class="trainer-avatar member-avatar" src="${esc(m.profile_photo)}" alt="Ảnh ${esc(m.full_name)}">`:`<span class="trainer-avatar member-avatar" aria-hidden="true">${esc(String(m.full_name||'?').trim().charAt(0).toLocaleUpperCase('vi'))}</span>`}<div><h3>${esc(m.full_name)}</h3><p>${esc(m.package_name||'Chưa chọn gói tập')}</p></div></div>${statusBadge(m.status)}<div class="actions"><button title="Xem chi tiết" aria-label="Xem chi tiết hội viên ${esc(m.full_name)}">${actionIcon('view')}<span>Xem chi tiết</span></button><button title="Sửa" aria-label="Sửa hội viên ${esc(m.full_name)}" onclick="openForm('members',${m.id})">${actionIcon('edit')}<span>Sửa</span></button><button class="delete" title="Xóa" aria-label="Xóa hội viên ${esc(m.full_name)}" onclick="removeItem('members',${m.id})">${actionIcon('delete')}<span>Xóa</span></button></div></article>`).join('');
  cards.querySelectorAll('.actions button[title="Xem chi tiết"]').forEach((button,index)=>button.addEventListener('click',()=>selectMember(members[index].id)));
  $('memberCount').textContent=`Hiển thị ${members.length} trong ${state.members.length} hội viên`;
}
function selectMember(id){
  renderMemberDetail(state.members.find(m=>m.id===id));
}
function renderMemberDetail(member){
  if(!member)return;
  const avatar=member.profile_photo?`<img class="member-detail-avatar" src="${esc(member.profile_photo)}" alt="Ảnh ${esc(member.full_name)}">`:`<span class="member-detail-avatar member-avatar" aria-hidden="true">${esc(String(member.full_name||'?').trim().charAt(0).toLocaleUpperCase('vi'))}</span>`;
  $('crudDialogTitle').textContent='Chi tiết hội viên';
  const details=[
    ['Mã hội viên',`HV${String(member.id).padStart(5,'0')}`],
    ['Họ và tên',member.full_name],
    ['Số điện thoại',member.phone],
    ['Email',member.email],
    ['Giới tính',member.gender],
    ['Gói tập',member.package_name||'Chưa chọn'],
    ['Ngày bắt đầu',formatDate(member.start_date)],
    ['Ngày hết hạn',formatDate(member.end_date)],
    ['Trạng thái',member.status]
  ];
  $('crudDialogContent').innerHTML=`<div class="member-detail-view"><div class="member-detail-heading">${avatar}<div><h3>${esc(member.full_name)}</h3><p>Thông tin hồ sơ hội viên</p></div></div><div class="member-detail-grid">${details.map(([label,value])=>`<div class="member-detail-field"><span>${esc(label)}</span><strong>${esc(value||'—')}</strong></div>`).join('')}</div></div>`;
  const dialog=$('crudDialog');
  if(dialog.open)dialog.close();
  dialog.showModal();
}
function renderTrainerDetail(trainer){
  if(!trainer)return;
  const avatar=trainer.profile_photo?`<img class="member-detail-avatar" src="${esc(trainer.profile_photo)}" alt="Ảnh ${esc(trainer.full_name)}">`:`<span class="member-detail-avatar member-avatar" aria-hidden="true">${esc(String(trainer.full_name||'?').trim().charAt(0).toLocaleUpperCase('vi'))}</span>`;
  const details=[
    ['Mã huấn luyện viên',`HLV${String(trainer.id).padStart(5,'0')}`],
    ['Họ và tên',trainer.full_name],
    ['Giới tính',trainer.gender],
    ['Chuyên môn',trainer.specialty],
    ['Số điện thoại',trainer.phone],
    ['Email',trainer.email],
    ['Trạng thái',trainer.status]
  ];
  $('crudDialogTitle').textContent='Chi tiết huấn luyện viên';
  $('crudDialogContent').innerHTML=`<div class="member-detail-view"><div class="member-detail-heading">${avatar}<div><h3>${esc(trainer.full_name)}</h3><p>Thông tin hồ sơ huấn luyện viên</p></div></div><div class="member-detail-grid">${details.map(([label,value])=>`<div class="member-detail-field"><span>${esc(label)}</span><strong>${esc(value||'—')}</strong></div>`).join('')}</div></div>`;
  const dialog=$('crudDialog');
  if(dialog.open)dialog.close();
  dialog.showModal();
}
function renderPackages(){
  const query=$('packageSearch').value.trim().toLocaleLowerCase('vi');
  const status=$('packageStatus').value;
  const packages=state.packages.filter(p=>{
    const matchesText=[p.name,p.description].some(value=>String(value||'').toLocaleLowerCase('vi').includes(query));
    return matchesText&&(!status||(p.status||'Đang bán')===status);
  });
  $('packageCards').innerHTML=packages.length?packages.map(p=>{const isAvailable=(p.status||'Đang bán')==='Đang bán';return `<article class="package-card ${isAvailable?'':'package-card-paused'}"><h3>${esc(p.name)}</h3><p class="package-meta">${Number(p.duration_months)||0} tháng</p><p class="package-price">${Number(p.price).toLocaleString('vi-VN')}đ</p><p class="package-description">${esc(p.description||'')}</p><div class="package-card-footer"><span class="package-state ${isAvailable?'':'package-state-paused'}">${esc(p.status||'Đang bán')}</span><div class="actions"><button title="Sửa gói tập ${esc(p.name)}" aria-label="Sửa gói tập ${esc(p.name)}" onclick="openForm('packages',${p.id})">${actionIcon('edit')}<span>Sửa</span></button><button class="delete" title="Xóa gói tập ${esc(p.name)}" aria-label="Xóa gói tập ${esc(p.name)}" onclick="removeItem('packages',${p.id})">${actionIcon('delete')}<span>Xóa</span></button></div></div></article>`}).join(''):state.packages.length?'<div class="panel empty">Không tìm thấy gói tập phù hợp.</div>':'<div class="panel empty">Chưa có gói tập. Hãy thêm gói đầu tiên.</div>';
}
function renderTrainers(){
  const query=$('trainerSearch').value.trim().toLocaleLowerCase('vi');
  const status=$('trainerStatus').value;
  const trainers=state.trainers.filter(t=>{
    const matchesText=[t.full_name,t.specialty,t.phone,t.email].some(value=>String(value||'').toLocaleLowerCase('vi').includes(query));
    return matchesText&&(!status||t.status===status);
  });
  $('trainerCards').innerHTML=trainers.length?trainers.map(t=>`<article class="trainer-card"><div class="trainer-card-top">${t.profile_photo?`<img class="trainer-avatar" src="${esc(t.profile_photo)}" alt="Ảnh ${esc(t.full_name)}">`:`<span class="trainer-avatar" aria-hidden="true">${esc(String(t.full_name||'?').trim().charAt(0).toLocaleUpperCase('vi'))}</span>`}<div><h3>${esc(t.full_name)}</h3><p>${esc(t.specialty||'Huấn luyện viên')}</p></div></div>${statusBadge(t.status)}<div class="actions"><button title="Xem chi tiết" aria-label="Xem chi tiết huấn luyện viên ${esc(t.full_name)}" onclick="renderTrainerDetail(state.trainers.find(item=>item.id===${t.id}))">${actionIcon('view')}<span>Xem chi tiết</span></button><button title="Sửa" aria-label="Sửa huấn luyện viên ${esc(t.full_name)}" onclick="openForm('trainers',${t.id})">${actionIcon('edit')}<span>Sửa</span></button><button class="delete" title="Xóa" aria-label="Xóa huấn luyện viên ${esc(t.full_name)}" onclick="removeItem('trainers',${t.id})">${actionIcon('delete')}<span>Xóa</span></button></div></article>`).join(''):state.trainers.length?'<div class="panel empty">Không tìm thấy huấn luyện viên phù hợp.</div>':'<div class="panel empty">Chưa có huấn luyện viên. Hãy thêm hồ sơ HLV.</div>';
  $('trainerCount').textContent=`Hiển thị ${trainers.length} trong ${state.trainers.length} huấn luyện viên`;
}
function renderSchedules(){
  const body=$('schedulesBody');
  if(!state.schedules.length) body.innerHTML='<tr><td colspan="9" class="empty">Chưa có dữ liệu</td></tr>';
  else body.innerHTML=state.schedules.map(s=>`<tr><td>${s.id}</td><td><strong>${esc(s.title)}</strong></td><td>${esc(s.class_type)}</td><td>${esc(formatDate(s.schedule_date))}</td><td>${esc(String(s.start_time).slice(0,5))} - ${esc(String(s.end_time).slice(0,5))}</td><td>${esc(s.room||'')}</td><td>${esc(s.trainer_name||'Chưa phân công')}</td><td>${s.max_members}</td><td class="actions"><button title="Sửa lịch tập ${esc(s.title)}" onclick="openForm('schedules',${s.id})">${actionIcon('edit')}<span>Sửa</span></button><button class="delete" title="Xóa lịch tập ${esc(s.title)}" onclick="removeItem('schedules',${s.id})">${actionIcon('delete')}<span>Xóa</span></button></td></tr>`).join('');
  renderWeeklySchedule();
}
function renderWeeklySchedule(){
  const root=$('weeklySchedule');
  const today=new Date();
  const monday=new Date(today.getFullYear(),today.getMonth(),today.getDate()-((today.getDay()+6)%7)+state.weekOffset*7);
  const days=Array.from({length:7},(_,index)=>new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+index));
  const dateKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const weekStart=dateKey(days[0]),weekEnd=dateKey(days[6]);
  const events=new Map();
  state.schedules.forEach(schedule=>{
    const date=displayDate(schedule.schedule_date);
    if(date<weekStart||date>weekEnd)return;
    const weekday=(new Date(`${date}T00:00:00`).getDay()+6)%7;
    const hour=Number(String(schedule.start_time||'08:00').slice(0,2));
    const slot=Math.max(8,Math.min(18,Math.floor(hour/2)*2));
    const key=`${weekday}-${slot}`;
    if(!events.has(key))events.set(key,[]);
    events.get(key).push(schedule);
  });
  const heading=days.map((date,index)=>`<div class="week-cell week-heading">${['Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6','Thứ 7','CN'][index]}<small>${date.getDate()}/${date.getMonth()+1}</small></div>`).join('');
  const rows=[8,10,12,14,16,18].map(hour=>{
    const cells=days.map((_,weekday)=>{
      const items=events.get(`${weekday}-${hour}`)||[];
      return `<div class="week-cell">${items.map(item=>`<span class="week-event"><strong>${esc(String(item.start_time||'').slice(0,5))} · ${esc(item.title)}</strong>${esc(item.trainer_name||item.class_type||'Lịch tập')}</span>`).join('')}</div>`;
    }).join('');
    return `<div class="week-cell week-time">${String(hour).padStart(2,'0')}:00</div>${cells}`;
  }).join('');
  root.innerHTML=`<div class="week-toolbar"><button type="button" data-week-shift="-1" aria-label="Tuần trước">‹</button><span>${days[0].toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit'})} – ${days[6].toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'})}</span><button type="button" data-week-shift="1" aria-label="Tuần sau">›</button></div><div class="week-grid"><div class="week-cell week-heading"></div>${heading}${rows}</div>`;
}

function formCommon(table,id,fieldsHtml){
  const dialog=$('crudDialog');
  const box=$('crudDialogContent');
  $('crudDialogTitle').textContent=`${id?'Chỉnh sửa':'Thêm'} ${tableLabels[table]}`;
  box.innerHTML=`<form onsubmit="submitForm(event,'${table}',${id||'null'})"><div class="form-grid">${fieldsHtml}</div><div class="form-actions"><button class="btn" type="submit">${id?'Lưu thay đổi':'Thêm mới'}</button><button class="btn light" type="button" onclick="closeCrudDialog()">Hủy</button></div></form>`;
  if(dialog.open) dialog.close();
  dialog.showModal();
  if(table==='trainers'||table==='members') setupProfilePhoto(box);
}
const tableLabels={members:'hội viên',packages:'gói tập',trainers:'huấn luyện viên',schedules:'lịch tập'};
function closeCrudDialog(){
  $('crudDialog').close();
}
function input(name,label,value='',type='text',required=false){return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''}></div>`}
function select(name,label,value,options){return `<div class="field"><label>${label}</label><select name="${name}">${options.map(o=>`<option value="${esc(o[0])}" ${String(o[0])===String(value??'')?'selected':''}>${esc(o[1])}</option>`).join('')}</select></div>`}

function openForm(table,id=null){
  if(table==='members'){
    const m=state.members.find(x=>x.id===id)||{}; const opts=[['','Chưa chọn'],...state.packages.map(p=>[p.id,p.name])];
    formCommon(table,id,profilePhotoField(m.profile_photo,'Ảnh hội viên')+input('full_name','Họ tên',m.full_name,'text',true)+input('phone','Điện thoại',m.phone,'text',true)+input('email','Email',m.email)+select('gender','Giới tính',m.gender,[['Nam','Nam'],['Nữ','Nữ'],['Khác','Khác']])+select('package_id','Gói tập',m.package_id,opts)+input('start_date','Ngày bắt đầu',m.start_date,'date')+input('end_date','Ngày kết thúc',m.end_date,'date')+select('status','Trạng thái',m.status,[['Hoạt động','Hoạt động'],['Hết hạn','Hết hạn'],['Tạm khóa','Tạm khóa']]));
  }
  if(table==='packages'){
    const p=state.packages.find(x=>x.id===id)||{};
    formCommon(table,id,input('name','Tên gói',p.name,'text',true)+input('duration_months','Thời hạn (tháng)',p.duration_months||1,'number',true)+input('price','Giá (VNĐ)',p.price||0,'number',true)+select('status','Trạng thái gói tập',p.status||'Đang bán',[['Đang bán','Đang bán'],['Dừng bán','Dừng bán']])+`<div class="field full"><label>Mô tả</label><input name="description" value="${esc(p.description||'')}"></div>`);
  }
  if(table==='trainers'){
    const t=state.trainers.find(x=>x.id===id)||{};
    formCommon(table,id,profilePhotoField(t.profile_photo,'Ảnh huấn luyện viên')+input('full_name','Họ tên',t.full_name,'text',true)+select('gender','Giới tính',t.gender,[['','Chưa chọn'],['Nam','Nam'],['Nữ','Nữ'],['Khác','Khác']])+input('specialty','Chuyên môn',t.specialty,'text',true)+select('status','Trạng thái',t.status,[['Đang làm việc','Đang làm việc'],['Tạm nghỉ','Tạm nghỉ']])+input('phone','Điện thoại',t.phone)+input('email','Email',t.email));
  }
  if(table==='schedules'){
    const s=state.schedules.find(x=>x.id===id)||{}; const opts=[['','Chưa phân công'],...state.trainers.map(t=>[t.id,t.full_name])];
    formCommon(table,id,input('title','Tên lớp',s.title,'text',true)+input('class_type','Loại lớp',s.class_type,'text',true)+input('schedule_date','Ngày',s.schedule_date,'date',true)+input('start_time','Giờ bắt đầu',String(s.start_time||'').slice(0,5),'time',true)+input('end_time','Giờ kết thúc',String(s.end_time||'').slice(0,5),'time',true)+input('room','Phòng',s.room)+select('trainer_id','Huấn luyện viên',s.trainer_id,opts)+input('max_members','Số người tối đa',s.max_members||20,'number',true));
  }
}

function profilePhotoField(photoValue,label){
  const photo=photoValue||'';
  return `<div class="field full"><label>${label}</label><div class="photo-uploader"><div class="photo-preview">${photo?`<img class="photo-preview-image" src="${esc(photo)}" alt="Ảnh xem trước">`:''}<span class="photo-placeholder ${photo?'hidden':''}" aria-hidden="true">Ảnh<br>hồ sơ</span><button class="photo-remove ${photo?'':'hidden'}" type="button" aria-label="Xóa ảnh">×</button></div><div class="photo-controls"><label class="btn secondary photo-select">Chọn ảnh<input class="photo-file" type="file" accept="image/png,image/jpeg,image/webp"></label><span class="photo-help">PNG, JPG hoặc WEBP · tối đa 1 MB</span></div><input name="profile_photo" type="hidden" value="${esc(photo)}"></div></div>`;
}

function setupProfilePhoto(box){
  const fileInput=box.querySelector('.photo-file');
  const imageInput=box.querySelector('[name="profile_photo"]');
  const preview=box.querySelector('.photo-preview');
  const removeButton=box.querySelector('.photo-remove');
  const placeholder=box.querySelector('.photo-placeholder');
  const showPhoto=src=>{
    let image=preview.querySelector('.photo-preview-image');
    if(!src){
      image?.remove();
      imageInput.value='';
      placeholder.classList.remove('hidden');
      removeButton.classList.add('hidden');
      fileInput.value='';
      return;
    }
    if(!image){
      image=document.createElement('img');
      image.className='photo-preview-image';
      image.alt='Ảnh xem trước';
      preview.prepend(image);
    }
    image.src=src;
    imageInput.value=src;
    placeholder.classList.add('hidden');
    removeButton.classList.remove('hidden');
  };
  fileInput.addEventListener('change',()=>{
    const file=fileInput.files[0];
    if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>1024*1024){
      toast('Chọn ảnh PNG, JPG hoặc WEBP có dung lượng tối đa 1 MB.');
      fileInput.value='';
      return;
    }
    const reader=new FileReader();
    reader.addEventListener('load',()=>{
      if(typeof reader.result==='string')showPhoto(reader.result);
    });
    reader.addEventListener('error',()=>toast('Không thể đọc ảnh. Vui lòng thử lại.'));
    reader.readAsDataURL(file);
  });
  removeButton.addEventListener('click',()=>showPhoto(''));
}

async function submitForm(event,table,id){
  event.preventDefault(); const data=Object.fromEntries(new FormData(event.target).entries());
  for(const k of Object.keys(data)) if(data[k]==='') data[k]=null;
  try{
    await api(`/api/${table}${id?'/' + id:''}`,{method:id?'PUT':'POST',body:JSON.stringify(data)});
    toast(id?'Đã cập nhật.':'Đã thêm dữ liệu.'); closeCrudDialog(); await loadAll();
  }catch(e){ toast(e.message); }
}

async function removeItem(table,id){
  $('crudDialogTitle').textContent='Xác nhận xóa';
  $('crudDialogContent').innerHTML=`<div class="delete-confirmation"><p>Bạn có chắc muốn xóa ${tableLabels[table]||'bản ghi'} này không?</p><p>Thao tác này không thể hoàn tác.</p><div class="form-actions"><button class="btn danger" type="button" onclick="confirmRemove('${table}',${id},this)">Xóa</button><button class="btn light" type="button" onclick="closeCrudDialog()">Hủy</button></div></div>`;
  const dialog=$('crudDialog');
  if(dialog.open) dialog.close();
  dialog.showModal();
}

async function confirmRemove(table,id,button){
  button.disabled=true;
  try{
    await api(`/api/${table}/${id}`,{method:'DELETE'});
    toast('Đã xóa.');
    closeCrudDialog();
    await loadAll();
  }catch(e){
    button.disabled=false;
    toast(e.message);
  }
}

async function refreshAll(){ try{ await loadAll(); await loadHealth(); toast('Đã làm mới dữ liệu.'); }catch(e){ toast(e.message); } }

document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>showPage(btn.dataset.page)));
document.querySelectorAll('[data-page-link]').forEach(button=>button.addEventListener('click',()=>showPage(button.dataset.pageLink)));
$('sidebar-brand').addEventListener('click',event=>{
  event.preventDefault();
  showPage('overview');
});
$('memberSearch').addEventListener('input',renderMembers);
$('memberStatus').addEventListener('change',renderMembers);
$('packageSearch').addEventListener('input',renderPackages);
$('packageStatus').addEventListener('change',renderPackages);
$('trainerSearch').addEventListener('input',renderTrainers);
$('trainerStatus').addEventListener('change',renderTrainers);
$('weeklySchedule').addEventListener('click',event=>{
  const button=event.target.closest('[data-week-shift]');
  if(!button)return;
  state.weekOffset+=Number(button.dataset.weekShift);
  renderWeeklySchedule();
});

$('loginForm').addEventListener('submit', async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const button=$('loginButton');
  const username=form.elements.username.value.trim();
  const password=form.elements.password.value;
  $('loginError').textContent='';
  button.disabled=true;
  button.firstChild.textContent='Đang đăng nhập... ';
  try{
    await api('/api/auth/login',{method:'POST',body:JSON.stringify({username,password})});
    showDashboard();
  }catch(error){
    $('loginError').textContent=error.message;
    button.disabled=false;
    button.firstChild.textContent='Đăng nhập ';
    return;
  }finally{
    form.elements.password.value='';
  }
  button.disabled=false;
  button.firstChild.textContent='Đăng nhập ';
  try{
    await loadAll();
    await loadHealth();
  }catch(error){
    toast(error.message);
  }
});

$('logoutButton').addEventListener('click',async()=>{
  try{
    await api('/api/auth/logout',{method:'POST'});
    showLogin();
  }catch(error){ toast(error.message); }
});

async function initialize(){
  let session;
  try{
    session=await api('/api/auth/session');
  }catch{
    showLogin('Không thể kết nối máy chủ. Vui lòng thử lại.');
    return;
  }
  if(!session.authenticated){ showLogin(); return; }
  showDashboard();
  try{
    await loadAll();
    await loadHealth();
  }catch(error){
    toast(error.message);
  }
}

initialize();
