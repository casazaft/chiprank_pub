'use strict';
const READ_ONLY = typeof document !== 'undefined' && document.documentElement?.dataset.mode === 'static';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors = {NVIDIA:'var(--nvidia)',AMD:'var(--amd)',Intel:'var(--intel)',Apple:'#afa9a2',Huawei:'#e27183',Cambricon:'#ac8ae8','Moore Threads':'#59bfbc'};
const vendorLabels = {Huawei:'华为 Huawei',Cambricon:'寒武纪 Cambricon','Moore Threads':'摩尔线程'};
const domesticVendors = new Set(['Huawei','Cambricon','Moore Threads']);
const MAX_COMPARE = 5;
const segments = {consumer:'消费级',workstation:'工作站级',server:'服务器级'};
const forms = {desktop:'桌面',mobile:'移动',pcie:'PCIe',sxm:'SXM',oam:'OAM',module:'模组',soc:'统一内存 SoC'};
const format = value => value == null ? '—' : new Intl.NumberFormat('en-US',{maximumFractionDigits:value < 1 ? 4 : 2}).format(value);
const formatCompute = value => value == null ? '—' : new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(value);
const shortName = gpu => gpu.name.replace(/^(NVIDIA|AMD|Intel|Apple|Huawei|Cambricon|Moore Threads|MetaX|Biren)\s+/i,'');
function memoryCaption(gpu) {
  return `${gpu.memory_capacity_kind==='up_to'?'最高支持 · ':''}${gpu.memory_type==='unified'?'统一内存 · CPU/GPU 共享':'独立显存'}`;
}
function matchesScope(gpu) {
  return state.scope==='all'||state.scope==='apple'&&gpu.vendor==='Apple'||state.scope==='china'&&gpu.market==='china'||state.scope==='unified'&&gpu.memory_type==='unified'||state.scope==='domestic'&&domesticVendors.has(gpu.vendor);
}
function selectScope(scope) {
  state.scope=scope;state.vendors=new Set(Object.keys(colors));state.segments=new Set(Object.keys(segments));state.architectures.clear();state.form='all';state.year='all';state.query='';state.missing=true;
}
const normalizedQuery = value => value.toLowerCase().replace(/[\s_+()-]+/g,'');
function dateLabel(gpu) {
  const raw=gpu.release_date||(gpu.release_year?String(gpu.release_year):'');
  if(!raw)return '未公开 / 未核验';
  const label=/^\d{4}$/.test(raw)?raw+' 年（仅年份）':raw.replace('-Q',' Q');
  return label+(gpu.release_date_kind==='announcement'?'（宣布）':'');
}
function priceLabel(gpu) {
  const price=gpu.launch_price;
  return price?`${price.currency} ${format(price.amount)}${price.basis==='starting_at'?' 起':''}`:'未公开 / 未核验';
}
const priceBasis = {MSRP:'建议零售价',SEP:'建议终端售价',RRP:'建议零售价',starting_at:'起售价'};
const priceBasisLabel = price => price?.basis==='starting_at'?'起售价':price?.basis||'';
const validValue = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
const basisLabels={reference:'规格参考值',official:'官方理论值',derived:'推算值',measured:'实测值'};
const isComputeMetric=key=>['general','matrix'].includes(state.metrics[key]?.group);
function legacyComputeEvidence(gpu,key) {
  if(!validValue(gpu.metrics?.[key]))return null;
  const source=gpu.sources?.find(s=>s.url===gpu.metric_sources?.[key]);
  const basis=gpu.derived_metrics?.includes(key)?'derived':source?.kind==='vendor'?'official':'reference';
  return {id:null,metric:key,value:gpu.metrics[key],basis,source_urls:gpu.metric_sources?.[key]?[gpu.metric_sources[key]]:[],legacy:true};
}
const computeSelectionOrder=['official','derived','reference','measured'];
const basisMarkers={official:'官',derived:'推',measured:'测',reference:'参'};
function computeEvidence(gpu,key) {
  const legacy=legacyComputeEvidence(gpu,key);
  const records=(gpu.compute_observations||[]).filter(o=>o.metric===key);
  if(legacy)records.push(legacy);
  records.sort((a,b)=>computeSelectionOrder.indexOf(a.basis)-computeSelectionOrder.indexOf(b.basis)
    ||(b.test_date||b.source_date||'').localeCompare(a.test_date||a.source_date||'')
    ||String(a.id||'').localeCompare(String(b.id||'')));
  return records[0]||null;
}
function basisMarkerHtml(basis,caption) {
  return `<sub class="compute-marker basis-${esc(basis)}" title="${esc(caption||basisLabels[basis])}" aria-label="${esc(caption||basisLabels[basis])}">${basisMarkers[basis]||'参'}</sub>`;
}
function evidenceCaption(gpu,key) {
  if(!isComputeMetric(key))return '';
  const o=computeEvidence(gpu,key);if(!o)return '';
  return basisLabels[o.basis]+(o.basis==='measured'?` · ${o.test_date?'测试 '+o.test_date:'测试日期未报告'}${o.source_date?' · 来源 '+o.source_date:''}`:'');
}
function evidenceBadge(gpu,key) {
  const caption=evidenceCaption(gpu,key);
  return caption?basisMarkerHtml(computeEvidence(gpu,key).basis,caption):'';
}
function computeSourceHtml(gpu,key) {
  const urls=isComputeMetric(key)?computeEvidence(gpu,key)?.source_urls:gpu.metric_sources?.[key]?[gpu.metric_sources[key]]:[];
  return (urls||[]).map(url=>`<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">[${gpu.sources.findIndex(s=>s.url===url)+1}] ↗</a>`).join(' ')||'—';
}
function computeHistoryHtml(gpu) {
  const records=gpu.compute_observations||[];
  if(!records.length)return '';
  const labels={device:'测试设备 / 配置',software:'系统与软件',workload:'运算与计时',shape:'规模',statistic:'统计方法',input_precision:'输入精度',accumulation_precision:'累加精度',clock:'时钟',power:'功耗 / 散热',validation:'正确性校验',hardware_path:'执行路径',raw_timestamp:'原始时间戳'};
  return `<section class="compute-history"><h3>算力证据 · ${records.length} 条</h3><p class="muted small">每条保留原始口径。实测日期未报告时保持未知；来源日期和核验日期不代替测试日期。外部实测未经本机复测。</p>${records.map(o=>`<details class="compute-record"><summary>${esc(state.metrics[o.metric]?.label||o.metric)} <b>${formatCompute(o.value)}${basisMarkerHtml(o.basis)} ${esc(state.metrics[o.metric]?.unit||'')}</b></summary><div class="compute-record-body"><p>${esc(o.method)}</p><dl><dt>测试日期</dt><dd>${esc(o.test_date||'未报告 / 不适用')}</dd><dt>来源发布日期</dt><dd>${esc(o.source_date||'未报告')}</dd><dt>本次核验日期</dt><dd>${esc(o.accessed_at)}</dd>${Object.entries(o.conditions).map(([k,v])=>`<dt>${esc(labels[k]||k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${o.suite?`<p><b>来源 / 方法组：</b>${esc(o.suite)}</p>`:''}${o.formula?`<p><b>推算依据：</b>${esc(o.formula)}</p>`:''}${o.date_note?`<p>${esc(o.date_note)}</p>`:''}${o.notes?`<p>${esc(o.notes)}</p>`:''}<div class="evidence-links">${o.source_urls.map((url,i)=>`<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">证据 ${i+1} ↗</a>`).join(' · ')}</div></div></details>`).join('')}</section>`;
}
function sortingMetrics() {
  return {...state.metrics,launch_price:{label:'发售价格',unit:state.priceCurrency,group:'price',field:'launch_price.amount'},jd_price_mean:{label:'京东检索均价',unit:'CNY',group:'price',field:'jd_prices[].mean'}};
}
const jdStatuses={ok:'已统计',no_results:'无搜索结果',no_valid_samples:'无符合口径样本',login_required:'需要登录',blocked:'访问受限'};
function jdSnapshot(gpu) {
  return [...(gpu.jd_prices||[])].filter(s=>state.jdDate==='latest'||s.search_date===state.jdDate).sort((a,b)=>b.searched_at.localeCompare(a.searched_at))[0]||null;
}
function jdCaption(snapshot) {
  if(!snapshot)return state.jdDate==='latest'?'尚未检索':'当日未检索';
  return `${snapshot.search_date} · ${snapshot.status==='ok'?`${snapshot.sample_count} 个样本${snapshot.sample_count===1?'（单样本）':''}`:jdStatuses[snapshot.status]||snapshot.status}`;
}
function metricValue(gpu,key) {
  if(key==='launch_price')return gpu.launch_price?.currency===state.priceCurrency?gpu.launch_price.amount:null;
  if(key==='jd_price_mean'){const s=jdSnapshot(gpu);return s?.status==='ok'?s.mean:null;}
  return isComputeMetric(key)?computeEvidence(gpu,key)?.value??null:gpu.metrics[key];
}
function sortValueHtml(gpu,key) {
  const value=metricValue(gpu,key);
  if(key==='memory_gb')return `${gpu.memory_capacity_kind==='up_to'&&validValue(value)?'≤ ':''}${format(value)}<small class="price-sort-caption">${esc(memoryCaption(gpu))}</small>`;
  if(key==='jd_price_mean')return `${format(value)}<small class="price-sort-caption">${esc(!jdSnapshot(gpu)&&['mobile','soc'].includes(gpu.form_factor)?'集成 / 移动方案 · 不以整机价格代替':jdCaption(jdSnapshot(gpu)))}</small>`;
  if(key!=='launch_price')return `${isComputeMetric(key)?formatCompute(value):format(value)}${evidenceBadge(gpu,key)}${factorBadge(gpu,key)}`;
  if(!validValue(value))return `—${gpu.launch_price?`<small class="price-sort-caption">仅有 ${esc(gpu.launch_price.currency)} 报价</small>`:''}`;
  return `${format(value)}${gpu.launch_price.basis==='starting_at'?' 起':''}<small class="price-sort-caption">${esc(gpu.launch_price.region)} · ${esc(priceBasisLabel(gpu.launch_price))}</small>`;
}
const sparseKey = key => key.replace('_dense_', '_sparse_');
function sparseFactor(gpu,key) {
  if (validValue(gpu?.sparsity_factors?.[key])) return gpu.sparsity_factors[key];
  const dense=gpu?.metrics?.[key],sparse=gpu?.metrics?.[sparseKey(key)];
  return key.includes('_dense_')&&validValue(dense)&&validValue(sparse)?sparse/dense:null;
}
function factorText(gpu,key) {
  if(gpu.sparsity_support?.[key]===false)return '无原生稀疏加速';
  const evidence=computeEvidence(gpu,key),factor=evidence&&!evidence.legacy?evidence.sparsity_factor:sparseFactor(gpu,key);
  if(factor==null)return evidence?.basis==='measured'?'稀疏倍率未测':'稀疏倍率未公开';
  const rounded=Math.abs(factor-Math.round(factor))<.01?Math.round(factor):Math.round(factor*1000)/1000;
  return Number.isInteger(factor)?`稀疏 ×${rounded}`:`稀疏 ≈${rounded} 倍`;
}
function factorBadge(gpu,key) {
  return state.metrics[key]?.group==='matrix'&&validValue(metricValue(gpu,key))?`<small class="sparse-factor">${factorText(gpu,key)}</small>`:'';
}
const safeUrl = value => {try {const u=new URL(value);return u.protocol==='https:'?u.href:'#';} catch{return '#';}};
const state = {gpus:[],metrics:{},vendors:new Set(Object.keys(colors)),scope:'all',segments:new Set(Object.keys(segments)),architectures:new Set(),metric:'fp32_tflops',sorts:[{key:'fp32_tflops',direction:'desc'}],priceCurrency:'USD',jdDate:'latest',form:'all',year:'all',query:'',missing:false,limit:30,view:'ranking',selected:new Set(),editing:null,draft:null};
let toastTimer;

async function loadCatalog() {
  if (globalThis.ChipRankLocal) return globalThis.ChipRankLocal.loadCatalog();
  const response = await fetch('./data/gpus.json', {cache:'no-store'});
  if (!response.ok) throw new Error(`请求失败 (${response.status})`);
  return response.json();
}
function toast(message) {
  $('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$('#toast').hidden=true,4000);
}
function persistFilters() {
  try {localStorage.setItem('gpu-atlas-filters',JSON.stringify({vendors:[...state.vendors],segments:[...state.segments],architectures:[...state.architectures],metric:state.metric,sorts:state.sorts,priceCurrency:state.priceCurrency,jdDate:state.jdDate,scope:state.scope,form:state.form,year:state.year,query:state.query,missing:state.missing,limit:state.limit}));} catch {}
}
function restoreFilters() {
  try {
    const saved=JSON.parse(localStorage.getItem('gpu-atlas-filters')||'null');
    if (!saved) return;
    for(const k of ['vendors','segments','architectures']) if(Array.isArray(saved[k])) state[k]=new Set(saved[k]);
    for(const k of ['metric','form','year','query','missing','limit']) if(saved[k]!==undefined) state[k]=saved[k];
    if(typeof saved.priceCurrency==='string'&&/^[A-Z]{3}$/.test(saved.priceCurrency))state.priceCurrency=saved.priceCurrency;
    if(saved.jdDate==='latest'||typeof saved.jdDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(saved.jdDate))state.jdDate=saved.jdDate;
    if(['all','china','unified','domestic','apple'].includes(saved.scope))state.scope=saved.scope;
    if(!Object.hasOwn(sortingMetrics(),state.metric)) state.metric='fp32_tflops';
    setSorts(saved.sorts);
  } catch {}
}
function setSorts(rules) {
  const used=new Set(),metrics=sortingMetrics();
  state.sorts=(Array.isArray(rules)?rules:[]).filter(rule=>{
    if(!rule||typeof rule.key!=='string'||!Object.hasOwn(metrics,rule.key)||rule.key.includes('_sparse_')||used.has(rule.key))return false;
    used.add(rule.key);return true;
  }).map(rule=>({key:rule.key,direction:rule.direction==='asc'?'asc':'desc'}));
  if(!state.sorts.length)state.sorts=[{key:Object.hasOwn(metrics,state.metric)?state.metric:'fp32_tflops',direction:'desc'}];
  state.metric=state.sorts[0].key;
}
function metricOptions(selected, disabled=[]) {
  return Object.entries({memory:'显存规格',general:'通用算力',matrix:'矩阵算力',price:'价格'}).map(([group,label])=>`<optgroup label="${label}">${Object.entries(sortingMetrics()).filter(([,m])=>m.group===group).map(([key,m])=>`<option value="${esc(key)}" ${key===selected?'selected':''} ${disabled.includes(key)?'disabled':''}>${esc(m.label)} (${esc(m.unit)})</option>`).join('')}</optgroup>`).join('');
}
function sortDescription() {
  return state.sorts.map((rule,i)=>`${i+1}. ${sortingMetrics()[rule.key]?.label||rule.key}${rule.key==='launch_price'?` (${state.priceCurrency})`:rule.key==='jd_price_mean'?` (${state.jdDate==='latest'?'各型号最新':state.jdDate})`:''} ${rule.direction==='asc'?'↑':'↓'}`).join(' → ');
}
function changeSortMetric(index, key) {
  if(!Object.hasOwn(sortingMetrics(),key))return;
  const existing=state.sorts.findIndex(rule=>rule.key===key);
  if(existing>=0)[state.sorts[index],state.sorts[existing]]=[state.sorts[existing],state.sorts[index]];
  else state.sorts[index]={...state.sorts[index],key};
  setSorts(state.sorts);
}
function moveSort(index, offset) {
  const next=index+offset;
  if(next<0||next>=state.sorts.length)return;
  [state.sorts[index],state.sorts[next]]=[state.sorts[next],state.sorts[index]];
  setSorts(state.sorts);
}
function renderSortControls() {
  $('#metric').value=state.metric;$('#sort-direction').value=state.sorts[0].direction;
  const hasPrice=state.sorts.some(rule=>rule.key==='launch_price');
  $('#price-sorting-settings').hidden=!hasPrice;
  $('#jd-sorting-settings').hidden=!state.sorts.some(rule=>rule.key==='jd_price_mean');
  const jdDates=[...new Set(state.gpus.flatMap(g=>(g.jd_prices||[]).map(s=>s.search_date)).concat(state.jdDate==='latest'?[]:[state.jdDate]))].sort().reverse();
  $('#jd-date').innerHTML='<option value="latest">各型号最近一次检索</option>'+jdDates.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');
  $('#jd-date').value=state.jdDate;
  const jdPool=filtered(),jdRecords=jdPool.map(jdSnapshot),jdCount=jdRecords.filter(s=>s?.status==='ok').length;
  const jdMobile=jdPool.filter(g=>['mobile','soc'].includes(g.form_factor)&&!jdSnapshot(g)).length;
  $('#jd-coverage').textContent=`当前筛选：${jdCount} 款有均价 · ${jdRecords.filter(s=>s&&s.status!=='ok').length} 款检索未获有效价格 · ${jdRecords.filter(s=>!s).length-jdMobile} 款尚无本期检索${jdMobile?` · ${jdMobile} 款移动 / 集成方案未采集单卡价格`:''}。均价基于抽样标价，点击型号查看价格汇总和历史。`;
  const currencies=[...new Set(['USD',state.priceCurrency,...state.gpus.map(g=>g.launch_price?.currency).filter(c=>typeof c==='string'&&/^[A-Z]{3}$/.test(c))])].sort();
  $('#price-currency').innerHTML=currencies.map(c=>`<option value="${esc(c)}" ${c===state.priceCurrency?'selected':''}>${esc(c)}</option>`).join('');
  $('#sort-rules').innerHTML=state.sorts.slice(1).map((rule,i)=>{
    const index=i+1, label=`第 ${index+1} 优先`;
    return `<div class="sort-rule"><label for="sort-metric-${index}">${label}</label><select id="sort-metric-${index}" data-sort-index="${index}" class="sort-metric">${metricOptions(rule.key,state.sorts.filter((_,n)=>n!==index).map(r=>r.key))}</select><select data-sort-index="${index}" class="sort-direction" aria-label="${label}排序方向"><option value="desc" ${rule.direction==='desc'?'selected':''}>↓ 从高到低</option><option value="asc" ${rule.direction==='asc'?'selected':''}>↑ 从低到高</option></select><div class="sort-actions"><button data-sort-move="${index}" data-offset="-1" aria-label="上移${label}" title="提高优先级">↑</button><button data-sort-move="${index}" data-offset="1" aria-label="下移${label}" title="降低优先级" ${index===state.sorts.length-1?'disabled':''}>↓</button><button data-sort-remove="${index}" aria-label="移除${label}" title="移除此指标">×</button></div></div>`;
  }).join('');
  $$('.sort-metric',$('#sort-rules')).forEach(el=>el.addEventListener('change',()=>{changeSortMetric(Number(el.dataset.sortIndex),el.value);render();}));
  $$('.sort-direction',$('#sort-rules')).forEach(el=>el.addEventListener('change',()=>{state.sorts[Number(el.dataset.sortIndex)].direction=el.value;render();}));
  $$('[data-sort-move]',$('#sort-rules')).forEach(el=>el.addEventListener('click',()=>{moveSort(Number(el.dataset.sortMove),Number(el.dataset.offset));render();}));
  $$('[data-sort-remove]',$('#sort-rules')).forEach(el=>el.addEventListener('click',()=>{state.sorts.splice(Number(el.dataset.sortRemove),1);render();}));
  $('#sort-summary').textContent=sortDescription();$('#clear-sorts').hidden=state.sorts.length===1;
  $('#add-sort').disabled=state.sorts.length>=Object.keys(sortingMetrics()).length;
}
function compareBySort(a,b,rules=state.sorts) {
  for(const {key,direction} of rules){
    const av=metricValue(a,key),bv=metricValue(b,key),aValid=validValue(av),bValid=validValue(bv);
    if(aValid!==bValid)return aValid?-1:1;
    if(aValid&&av!==bv)return direction==='asc'?av-bv:bv-av;
  }
  return 0;
}
function rankPositions(rows) {
  let rank=1;
  return rows.map((row,index)=>{
    if(index&&compareBySort(rows[index-1],row)!==0)rank=index+1;
    return validValue(metricValue(row,state.metric))?rank:'—';
  });
}
function filters() {
  for(const [id,keys,set,labels] of [['vendor-filters',Object.keys(colors),state.vendors,vendorLabels],['segment-filters',Object.keys(segments),state.segments,segments]]) {
    $('#'+id).innerHTML=keys.map(key=>`<label class="filter-row"><input type="checkbox" value="${esc(key)}" ${set.has(key)?'checked':''}>${id==='vendor-filters'?`<span class="vendor-dot" style="--vendor:${colors[key]}"></span>`:''}<span>${esc(labels?.[key]||key)}</span><span class="count">${state.gpus.filter(g=>id==='vendor-filters'?g.vendor===key:g.segment===key).length}</span></label>`).join('');
    $$('input',$('#'+id)).forEach(input=>input.addEventListener('change',()=>{input.checked?set.add(input.value):set.delete(input.value);render();}));
  }
  const architectures=[...new Set(state.gpus.map(g=>g.architecture))].sort();
  $('#arch-count').textContent=`/ ${architectures.length}`;
  $('#architecture-filters').innerHTML=architectures.map(a=>`<label class="filter-row"><input type="checkbox" value="${esc(a)}" ${state.architectures.has(a)?'checked':''}><span>${esc(a)}</span></label>`).join('');
  $$('input',$('#architecture-filters')).forEach(input=>input.addEventListener('change',()=>{input.checked?state.architectures.add(input.value):state.architectures.delete(input.value);render();}));
  $$('[data-scope]').forEach(el=>{el.classList.toggle('active',el.dataset.scope===state.scope);el.setAttribute('aria-pressed',String(el.dataset.scope===state.scope));});
  $('#filter-search').value=state.query;$('#form-filter').value=state.form;$('#show-missing').checked=state.missing;$('#row-limit').value=state.limit;$('#metric').value=state.metric;
  $('#year-filter').innerHTML='<option value="all">全部年份</option>'+[...new Set(state.gpus.map(g=>g.release_year).filter(Boolean))].sort((a,b)=>b-a).map(year=>`<option value="${year}">${year} 年</option>`).join('');
  $('#year-filter').value=state.year;
}
function filtered() {
  const query=normalizedQuery(state.query);
  return state.gpus.filter(g=>matchesScope(g)&&state.vendors.has(g.vendor)&&state.segments.has(g.segment)&&(!state.architectures.size||state.architectures.has(g.architecture))&&(state.form==='all'||g.form_factor===state.form)&&(state.year==='all'||String(g.release_year)===state.year)&&(!query||normalizedQuery(`${g.name} ${g.architecture} ${g.vendor} ${vendorLabels[g.vendor]||''}`).includes(query)));
}
function ranked() {
  return filtered().filter(g=>state.missing||validValue(metricValue(g,state.metric))).sort((a,b)=>compareBySort(a,b)||a.name.localeCompare(b.name));
}
function render() {
  persistFilters();
  renderSortControls();
  const pool=filtered(), all=ranked(), visible=state.limit?all.slice(0,state.limit):all, valid=pool.filter(g=>validValue(metricValue(g,state.metric))),metric=sortingMetrics()[state.metric];
  const leader=all.find(g=>validValue(metricValue(g,state.metric))),max=Math.max(0,...valid.map(g=>metricValue(g,state.metric)))||1;
  const ranks=rankPositions(all),secondary=state.sorts.slice(1);
  $('#stat-total').textContent=state.gpus.length;$('#stat-filtered').textContent=pool.length;$('#stat-valid').textContent=valid.length;
  $('#stat-vendors').textContent=`${new Set(pool.map(g=>g.vendor)).size} 个厂商 · ${new Set(pool.map(g=>g.architecture)).size} 种架构`;
  $('#stat-missing').textContent=`${pool.length-valid.length} 款${state.metric==='jd_price_mean'?'无本期京东均价':state.metric==='launch_price'?`无 ${state.priceCurrency} 发售价格`:'缺少主指标'}`;
  $('#stat-leader').textContent=leader?shortName(leader):'暂无数据';$('#stat-leader-value').innerHTML=leader?`${state.metric==='memory_gb'&&leader.memory_capacity_kind==='up_to'?'≤ ':''}${isComputeMetric(state.metric)?formatCompute(metricValue(leader,state.metric)):format(metricValue(leader,state.metric))}${evidenceBadge(leader,state.metric)} ${metric.unit}${state.metric==='memory_gb'?' · '+memoryCaption(leader):''}${state.metric==='launch_price'&&leader.launch_price.basis==='starting_at'?' 起':''}${state.metric==='jd_price_mean'?' · '+jdSnapshot(leader).search_date:''}${metric.group==='matrix'?' · '+factorText(leader,state.metric):''}`:'尝试其他指标或放宽筛选';
  $('#vendor-legend').innerHTML=[...new Set(pool.map(g=>g.vendor))].map(v=>`<span style="color:${colors[v]}">● ${esc(vendorLabels[v]||v)}</span>`).join('');
  $('#metric-column').textContent=metric.label;$('#unit-column').textContent=metric.unit;
  $('#metric-note').textContent=state.metric==='jd_price_mean'?'京东单卡样本普通标价均值 · CNY · 日期与样本数逐卡标注 · 成色核验范围见详情':state.metric==='launch_price'?`发售价格按 ${state.priceCurrency} 原币种比较 · 地区与 MSRP / 起售价等口径逐卡标注`:metric.group==='matrix'?`稠密矩阵 · 按显示值排序 · 下标标明口径，输入与累加精度见详情`:metric.group==='general'?`通用算术与矩阵乘法分别排名 · 按显示值排序，口径见下标`:'容量注明独立显存或 CPU/GPU 统一内存；最高支持量以 ≤ 标记 · 不含缓存带宽';
  $$('.sort-column',$('#ranking-table thead')).forEach(el=>el.remove());
  $('#ranking-table thead tr').insertAdjacentHTML('beforeend',secondary.map((rule,i)=>`<th class="sort-column">${i+2}. ${esc(sortingMetrics()[rule.key].label)} ${rule.direction==='asc'?'↑':'↓'}<small>${esc(sortingMetrics()[rule.key].unit)}</small></th>`).join(''));
  $('#ranking-table').classList.toggle('multi-sort',secondary.length>0);
  $('#gpu-rows').innerHTML=visible.length?visible.map((g,index)=>{
    const value=metricValue(g,state.metric),exists=validValue(value),rank=ranks[index];
    return `<tr style="--vendor:${colors[g.vendor]}"><td class="row-selection"><input type="checkbox" data-select="${esc(g.id)}" aria-label="选择 ${esc(g.name)} 参与对比" ${state.selected.has(g.id)?'checked':''}></td><td class="rank-number ${Number(rank)<=3?'top':''}">${typeof rank==='number'?String(rank).padStart(2,'0'):rank}</td><td><button class="gpu-name" data-detail="${esc(g.id)}">${esc(shortName(g))}</button><div class="gpu-meta"><span style="color:${colors[g.vendor]}">${esc(vendorLabels[g.vendor]||g.vendor)}</span><span class="sep">/</span><span>${esc(g.architecture)}</span>${g.form_factor==='mobile'?'<span>· 移动</span>':g.memory_type==='unified'?'<span>· 统一内存</span>':''}${g.market==='china'?'<span>· 中国特供</span>':''}${g.user_modified?'<span>· 本地修改</span>':''}</div></td><td class="class-cell"><span class="segment-tag">${segments[g.segment]}</span></td><td class="bar-cell">${exists?`<div class="bar-track"><div class="bar-fill" style="width:${Math.max(.2,value/max*100)}%"></div></div>`:'<span class="missing">未公开 / 未核验</span>'}</td><td class="value ${exists?'':'missing'}">${format(value)}${exists?factorBadge(g,state.metric):''}</td></tr>`;
  }).join(''):`<tr><td colspan="${8+secondary.length}" class="empty"><b>没有符合条件的 GPU</b>更换指标、重置筛选，或勾选“显示主指标缺失的 GPU”。</td></tr>`;
  $('#table-summary').textContent=`显示 ${visible.length} / ${all.length} 款 · ${state.sorts.length>1?`${state.sorts.length} 项指标依次排序`:metric.label} · 全部排序值相同则并列`;
  const displayedRows=$$('tr',$('#gpu-rows'));
  visible.forEach((gpu,index)=>{
    const row=displayedRows[index],dateCell=document.createElement('td'),priceCell=document.createElement('td');
    dateCell.className='launch-col date-cell';dateCell.textContent=dateLabel(gpu);
    priceCell.className='launch-col price-cell';priceCell.innerHTML=`${esc(priceLabel(gpu))}${gpu.launch_price?`<small>${esc(gpu.launch_price.region)} · ${esc(priceBasisLabel(gpu.launch_price))}</small>`:''}`;
    $('.class-cell',row).after(dateCell,priceCell);
    const meta=document.createElement('div');meta.className='gpu-release';meta.textContent=`${dateLabel(gpu)}${gpu.launch_price?' · '+priceLabel(gpu):''}`;
    $('.gpu-meta',row).after(meta);
    $('.value',row).innerHTML=sortValueHtml(gpu,state.metric);
    row.insertAdjacentHTML('beforeend',secondary.map(rule=>`<td class="sort-value ${validValue(metricValue(gpu,rule.key))?'':'missing'}">${sortValueHtml(gpu,rule.key)}</td>`).join(''));
  });
  $$('[data-detail]',$('#gpu-rows')).forEach(el=>el.addEventListener('click',()=>detail(el.dataset.detail)));
  $$('[data-select]',$('#gpu-rows')).forEach(el=>el.addEventListener('change',()=>{if(!setCompared(el.dataset.select,el.checked))el.checked=false;refreshComparison();}));
  const dates=state.gpus.flatMap(g=>g.sources.map(s=>s.accessed_at).filter(Boolean)).sort();
  $('#data-version').textContent=`规格采集 ${dates.at(-1)||'—'} · ${state.gpus.length} 型号`;
  $('#tpu-review-summary').textContent='规格来自厂商文档、第三方规格资料及公开研究。来源链接、日期和条件见各型号详情；缺失值表示未公开或未核实。';
  globalThis.ChipRankLocal?.renderCoverage();
  renderTray();
}
function renderTray() {
  $('#compare-tray').hidden=!state.selected.size;$('#compare-count').textContent=state.selected.size;
  $('#compare-names').innerHTML=comparisonChips();
  $('#compare-header-count').textContent=`${state.selected.size}/${MAX_COMPARE}`;
  $('#compare-button').disabled=!state.selected.size;
  document.body.classList.toggle('has-comparison',state.selected.size>0);
}
function detail(id) {
  const gpu=state.gpus.find(g=>g.id===id);if(!gpu)return;
  const sourceIndex=url=>gpu.sources.findIndex(s=>s.url===url)+1;
  $('#detail-content').innerHTML=`<div class="dialog-head"><div><span class="eyebrow">GPU SPECIFICATIONS</span><h2>${esc(gpu.name)}</h2></div><button class="icon-button" data-close aria-label="关闭">×</button></div><div class="detail-tags"><span class="segment-tag ${gpu.vendor.toLowerCase()}">${gpu.vendor}</span><span class="segment-tag">${esc(gpu.architecture)}</span><span class="segment-tag">${segments[gpu.segment]} · ${forms[gpu.form_factor]||esc(gpu.form_factor)}</span>${gpu.release_year?`<span class="segment-tag">${gpu.release_year}</span>`:''}</div><p class="muted small">数字下标标明所用口径：官＝官方理论，推＝推算，测＝实测，参＝第三方规格。完整条件与其他测量记录见“算力证据”。矩阵仅显示稠密值与稀疏倍率。</p><table class="detail-metrics"><thead><tr><th>指标</th><th>数值 / 口径</th><th>来源</th></tr></thead><tbody>${Object.entries(state.metrics).map(([key,m])=>`<tr><td>${m.label}</td><td class="metric-value">${isComputeMetric(key)?formatCompute(metricValue(gpu,key)):format(metricValue(gpu,key))}${metricValue(gpu,key)!=null?` ${evidenceBadge(gpu,key)} <small>${m.unit}</small>`:''}</td><td class="metric-source">${computeSourceHtml(gpu,key)}</td></tr>`).join('')}</tbody></table>${computeHistoryHtml(gpu)}<ul class="detail-notes">${(gpu.notes||[]).map(n=>`<li>${esc(n)}</li>`).join('')}</ul><div class="detail-sources">${gpu.sources.map((s,i)=>`<div><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">[${i+1}] ${esc(s.title||s.url)} ↗</a><br><small>${esc(s.kind==='techpowerup'?'TechPowerUp':s.kind==='vendor'?'厂商官方资料':s.kind==='partner'?'合作伙伴产品资料':s.kind==='research'?'研究论文 / 开源实测':'用户提供')} · ${esc(s.accessed_at||'未记录日期')}</small></div>`).join('')}</div><div class="dialog-footer"><span>${gpu.user_modified?'已保存本地修订':'内置数据快照'} · 缺失值不代表不支持</span></div>`;
  $$('[data-close]',$('#detail-dialog')).forEach(button=>button.addEventListener('click',()=>$('#detail-dialog').close()));
  const memoryInfo=document.createElement('p');memoryInfo.className='memory-scope';memoryInfo.textContent=memoryCaption(gpu)+(gpu.memory_note?'。'+gpu.memory_note:'')+(gpu.market==='china'?' · 中国特供版本':'');$('.detail-tags',$('#detail-content')).after(memoryInfo);
  const metricRows=$$('tbody tr',$('.detail-metrics',$('#detail-content')));
  const memoryIndex=Object.keys(state.metrics).indexOf('memory_gb');if(memoryIndex>=0)$('.metric-value',metricRows[memoryIndex]).innerHTML=`${gpu.memory_capacity_kind==='up_to'?'≤ ':''}${format(gpu.metrics.memory_gb)} <small>GB</small><small class="price-sort-caption">${esc(memoryCaption(gpu))}</small>`;
  const launchFacts=document.createElement('div');launchFacts.className='launch-facts';
  const releaseSource=gpu.field_sources?.release_date,priceSource=gpu.field_sources?.launch_price;
  const launchLink=url=>url?` <a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">来源 [${sourceIndex(url)}] ↗</a>`:'';
  launchFacts.innerHTML=`<div><span>发布日期${gpu.release_date_kind==='announcement'?' · 宣布':' · 发布 / 开售'}</span><strong>${esc(dateLabel(gpu))}</strong><small>${launchLink(releaseSource)}</small></div><div><span>发布售价</span><strong>${esc(priceLabel(gpu))}</strong><small>${gpu.launch_price?`${esc(gpu.launch_price.region)} · ${esc(priceBasis[gpu.launch_price.basis]||gpu.launch_price.basis)}${gpu.launch_price.basis==='starting_at'?'':` (${esc(gpu.launch_price.basis)})`}`:''}${launchLink(priceSource)}</small></div>`;
  $('.detail-tags',$('#detail-content')).after(launchFacts);
  const jdSection=document.createElement('section');jdSection.className='jd-detail';jdSection.innerHTML=jdHistoryHtml(gpu);launchFacts.after(jdSection);
  for(const note of gpu.launch_notes||[]){const li=document.createElement('li');li.textContent=note;$('.detail-notes',$('#detail-content')).append(li);}
  Object.keys(state.metrics).forEach((key,index)=>{if(state.metrics[key].group==='matrix'){
    const valueCell=$('.metric-value',metricRows[index]);valueCell.insertAdjacentHTML('beforeend',factorBadge(gpu,key));
    const sparseSource=gpu.sparsity_factor_sources?.[key]||gpu.metric_sources[sparseKey(key)];
    if(computeEvidence(gpu,key)?.legacy&&sparseSource&&sparseFactor(gpu,key)!=null)$('.metric-source',metricRows[index]).insertAdjacentHTML('beforeend',`<br><a href="${esc(safeUrl(sparseSource))}" target="_blank" rel="noopener noreferrer">倍率 [${sourceIndex(sparseSource)}] ↗</a>`);
  }});
  for(const [key,note] of Object.entries(gpu.metric_notes||{})) {
    if(!state.metrics[key]||!note)continue;
    const item=document.createElement('li');item.textContent=`${state.metrics[key].label}：${typeof note==='string'?note:JSON.stringify(note)}`;
    $('.detail-notes',$('#detail-content')).append(item);
  }
  globalThis.ChipRankLocal?.decorateDetail(gpu,jdSection);$('#detail-dialog').showModal();
}
function comparisonProducts() {
  return [...state.selected].map(id=>state.gpus.find(g=>g.id===id)).filter(Boolean).slice(0,MAX_COMPARE);
}
function persistComparison() {
  try {localStorage.setItem('gpu-atlas-comparison',JSON.stringify([...state.selected]));} catch {}
}
function restoreComparison() {
  try {
    const ids=JSON.parse(localStorage.getItem('gpu-atlas-comparison')||'[]');
    state.selected=new Set((Array.isArray(ids)?ids:[]).filter(id=>typeof id==='string'&&state.gpus.some(g=>g.id===id)));
    state.selected=new Set([...state.selected].slice(0,MAX_COMPARE));
  } catch {state.selected.clear();}
}
function setCompared(id,checked) {
  if(!state.gpus.some(g=>g.id===id))return false;
  if(checked&&!state.selected.has(id)&&state.selected.size>=MAX_COMPARE){toast(`最多同时比较 ${MAX_COMPARE} 款产品，请先移除一款`);return false;}
  checked?state.selected.add(id):state.selected.delete(id);persistComparison();return true;
}
function comparisonChips() {
  return comparisonProducts().map(g=>`<button class="compare-chip" data-compare-remove="${esc(g.id)}" aria-label="移除 ${esc(g.name)}" title="移除 ${esc(g.name)}">${esc(shortName(g))} <b aria-hidden="true">×</b></button>`).join('');
}
function comparisonCandidates(query) {
  const q=normalizedQuery(query);
  return state.gpus.filter(g=>normalizedQuery([g.name,g.vendor,vendorLabels[g.vendor]||'',g.architecture].join(' ')).includes(q));
}
function renderComparisonCandidates() {
  const candidates=comparisonCandidates($('#compare-search').value),full=state.selected.size>=MAX_COMPARE;
  $('#compare-results').innerHTML=candidates.map(g=>`<div class="compare-candidate"><div><b>${esc(g.name)}</b><small>${esc(g.architecture)} · ${esc(forms[g.form_factor]||g.form_factor)} · ${g.memory_capacity_kind==='up_to'?'≤ ':''}${format(g.metrics.memory_gb)} GB</small></div><button class="secondary" data-compare-add="${esc(g.id)}" aria-label="添加 ${esc(g.name)} 到比较" ${state.selected.has(g.id)||full?'disabled':''}>${state.selected.has(g.id)?'已选':full?'已满 5 款':'＋ 添加'}</button></div>`).join('')||'<p class="muted">没有匹配的已收录产品，请更换搜索词。</p>';
}
function comparisonLink(gpu,url) {
  if(!url)return '';
  const index=(gpu.sources||[]).findIndex(s=>s.url===url);
  return `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">来源${index>=0?' ['+(index+1)+']':''} ↗</a>`;
}
function comparisonMetricHtml(gpu,key) {
  const o=isComputeMetric(key)?computeEvidence(gpu,key):null,note=gpu.metric_notes?.[key];
  let links=computeSourceHtml(gpu,key);
  if(o?.legacy&&sparseFactor(gpu,key)!=null)links+=' '+comparisonLink(gpu,gpu.metric_sources?.[sparseKey(key)]);
  if(gpu.sparsity_support?.[key]===false)links+=' '+comparisonLink(gpu,gpu.field_sources?.sparsity_support);
  return `${sortValueHtml(gpu,key)}<small class="compare-source">${links}</small>${o&&!o.legacy?`<small class="compare-date">${o.test_date?'测试 '+esc(o.test_date)+' · ':''}核验 ${esc(o.accessed_at)}</small>`:''}${note?`<details class="compare-note"><summary>指标说明</summary>${esc(typeof note==='string'?note:JSON.stringify(note))}</details>`:''}`;
}
function comparisonTableHtml(gpus) {
  if(!gpus.length)return '<div class="empty"><b>选择产品，开始比较</b>可在上方搜索全部已收录产品，或在榜单左侧勾选。</div>';
  const group=label=>`<tr class="compare-group"><th colspan="${gpus.length+1}">${esc(label)}</th></tr>`;
  const row=(label,cell)=>`<tr><th scope="row">${esc(label)}</th>${gpus.map(g=>`<td>${cell(g)}</td>`).join('')}</tr>`;
  let body=group('基础信息')+row('芯片厂商',g=>esc(vendorLabels[g.vendor]||g.vendor))+row('架构',g=>esc(g.architecture))
    +row('产品类别',g=>esc(segments[g.segment]))+row('产品形态',g=>esc(forms[g.form_factor]||g.form_factor))
    +row('市场版本',g=>g.market==='china'?'中国特供':'一般 / 全球产品')
    +row('发布日期',g=>esc(dateLabel(g))+'<small class="compare-source">'+comparisonLink(g,g.field_sources?.release_date)+'</small>')
    +group('价格与日期')+row('发布售价（原币种）',g=>esc(priceLabel(g))+(g.launch_price?`<small class="price-sort-caption">${esc(g.launch_price.region)} · ${esc(priceBasis[g.launch_price.basis]||g.launch_price.basis)}</small>`:'')+`<small class="compare-source">${comparisonLink(g,g.field_sources?.launch_price)}</small>`)
    +row('京东检索均价 · CNY',g=>sortValueHtml(g,'jd_price_mean')+(jdSnapshot(g)?`<small class="compare-source">${comparisonLink(g,jdSnapshot(g).search_url)}</small>`:''));
  for(const [name,label] of Object.entries({memory:'显存 / 统一内存',general:'通用算力',matrix:'矩阵算力 · 稠密'})) {
    body+=group(label);
    if(name==='memory')body+=row('内存与整卡口径',g=>esc(memoryCaption(g))+(g.memory_note?'<p>'+esc(g.memory_note)+'</p>':''));
    for(const [key,m] of Object.entries(state.metrics).filter(([k,m])=>m.group===name&&!k.includes('_sparse_'))) {
      const max=Math.max(0,...gpus.map(g=>metricValue(g,key)||0));
      body+=`<tr data-compare-metric="${esc(key)}"><th scope="row">${esc(m.label)}<small>${esc(m.unit)}</small></th>${gpus.map(g=>`<td class="${gpus.length>1&&validValue(metricValue(g,key))&&metricValue(g,key)===max?'best':''}">${comparisonMetricHtml(g,key)}</td>`).join('')}</tr>`;
    }
  }
  body+=group('测试条件、历史与来源')
    +row('完整算力证据 / 测试条件',g=>(g.compute_observations||[]).length?`<details class="compare-note"><summary>查看 ${g.compute_observations.length} 条证据</summary>${computeHistoryHtml(g)}</details>`:'无独立算力观测；规格口径见指标说明及来源')
    +row('京东历史 / 商品样本',g=>(g.jd_prices||[]).length?`<details class="compare-note"><summary>查看 ${g.jd_prices.length} 次检索</summary>${jdHistoryHtml(g,false)}</details>`:'尚未检索')
    +row('规格与发布说明',g=>[...(g.notes||[]),...(g.launch_notes||[])].map(n=>'<p>'+esc(n)+'</p>').join('')||'—')
    +row('TechPowerUp 核验状态',g=>esc(({verified:'对应页面已核验',verified_variant:'容量变体已核验',related_model:'仅有相关型号',not_listed:'未找到独立条目'})[g.tpu_status]||'未完成逐页核验'))
    +row('全部资料来源 / 核验日期',g=>(g.sources||[]).map((s,i)=>`<p><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">[${i+1}] ${esc(s.title||s.url)} ↗</a><small>${esc(s.accessed_at||'核验日期未记录')}</small></p>`).join('')||'—');
  return `<div class="compare-table" tabindex="0" role="region" aria-label="全部参数对比表，可横向和纵向滚动"><table class="comparison-grid" style="--compare-columns:${gpus.length}"><caption class="sr-only">${gpus.length} 款产品全部参数对比</caption><thead><tr><th scope="col">参数 / 单位</th>${gpus.map(g=>`<th scope="col"><span style="color:${colors[g.vendor]}">${esc(vendorLabels[g.vendor]||g.vendor)}</span><br>${esc(shortName(g))}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function renderComparison() {
  $('#compare-selected').innerHTML=comparisonChips();
  $('#compare-status').textContent=`已选 ${state.selected.size} / ${MAX_COMPARE} 款${state.selected.size===MAX_COMPARE?' · 已达上限，可先移除再添加':state.selected.size<2?' · 再添加产品即可并排比较':' · 按添加顺序排列'}`;
  $('#compare-clear').disabled=!state.selected.size;
  const dates=[...new Set(comparisonProducts().flatMap(g=>(g.jd_prices||[]).map(s=>s.search_date)).concat(state.jdDate==='latest'?[]:[state.jdDate]))].sort().reverse();
  $('#compare-jd-date').innerHTML='<option value="latest">各产品最近一次检索</option>'+dates.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');
  $('#compare-jd-date').value=state.jdDate;
  renderComparisonCandidates();$('#compare-content').innerHTML=comparisonTableHtml(comparisonProducts());
}
function refreshComparison() {
  renderTray();$$('[data-select]',$('#gpu-rows')).forEach(el=>el.checked=state.selected.has(el.dataset.select));
  if($('#compare-dialog').open)renderComparison();
}
function clearComparison() {
  state.selected.clear();persistComparison();refreshComparison();
}
function compare() {
  $('#compare-search').value='';$('#compare-picker').open=state.selected.size<2;
  renderComparison();$('#compare-dialog').showModal();
}
function jdHistoryHtml(gpu, editable=!READ_ONLY) {
  if (!READ_ONLY && globalThis.ChipRankLocal) return globalThis.ChipRankLocal.jdHistoryHtml(gpu,editable);
  const history=[...(gpu.jd_prices||[])].sort((a,b)=>b.searched_at.localeCompare(a.searched_at));
  return `<div class="jd-heading"><h3>京东检索均价 · CNY</h3></div>${history.length?history.map((s,i)=>`<details class="jd-history" ${i===0?'open':''}><summary>${esc(s.searched_at.replace('T',' ').replace('+08:00',''))} · ${s.status==='ok'?`¥ ${format(s.mean)} · ${s.sample_count} 个样本${s.sample_count===1?'（单样本）':''}`:esc(jdStatuses[s.status]||s.status)}</summary><p class="muted">北京时间 · ${esc(s.region)}${s.status==='ok'?` · 范围 ¥ ${format(s.minimum)} – ${format(s.maximum)}`:''} · 已核对 ${s.reviewed_count} 项 / 排除 ${s.excluded_count} 项</p><p class="muted">${esc(s.method)}</p><p class="muted">${esc(s.notes)}</p></details>`).join(''):'<p class="muted">尚无价格统计。</p>'}`;
}
function exportData() {
  const data={schema_version:6,exported_at:new Date().toISOString(),metric:state.metric,sorts:state.sorts,compute_selection:{mode:'automatic',basis_priority:computeSelectionOrder,same_basis:'latest_test_or_source_date'},price_currency:state.priceCurrency,jd_search_date:state.jdDate,metrics:sortingMetrics(),gpus:ranked().map(gpu=>{
    const row=structuredClone(gpu);row.sparsity_factors={};row.sparsity_factor_sources={};
    row.ranking_values=Object.fromEntries(Object.keys(sortingMetrics()).map(key=>[key,metricValue(gpu,key)??null]));
    row.selected_compute_evidence=Object.fromEntries(Object.keys(state.metrics).filter(isComputeMetric).map(key=>[key,computeEvidence(gpu,key)]));
    for(const key of Object.keys(state.metrics)){
      if(state.metrics[key].group!=='matrix')continue;
      const evidence=computeEvidence(gpu,key),factor=evidence?.legacy?sparseFactor(gpu,key):evidence?.sparsity_factor;
      if(factor!=null){row.sparsity_factors[key]=factor;row.sparsity_factor_sources[key]=evidence.legacy?[gpu.metric_sources[key],gpu.sparsity_factor_sources?.[key]||gpu.metric_sources[sparseKey(key)]]:evidence.source_urls;}
    }
    for(const key of Object.keys(row.metrics))if(key.includes('_sparse_')){delete row.metrics[key];delete row.metric_sources[key];if(row.metric_notes)delete row.metric_notes[key];}
    if(row.tpu_verification)for(const field of ['metrics','differences'])for(const key of Object.keys(row.tpu_verification[field]||{}))if(key.includes('_sparse_'))delete row.tpu_verification[field][key];
    return row;
  })};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`算力天梯-${state.metric}-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`已导出 ${data.gpus.length} 款 GPU`);
}
function changeView(view) {
  state.view=view;$$('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  $('#main-content').hidden=view==='methodology';$('#methodology').hidden=view!=='methodology';$('#export-button').hidden=view==='methodology';
  $('#ranking-table').classList.toggle('db-mode',view==='database');
  $('#page-title').textContent=({ranking:'每一份算力，都有坐标。',database:'GPU 规格，一处汇集。',methodology:'让每一次比较，有据可依。'})[view];
  $('#page-subtitle').textContent=({ranking:'跨越架构与厂商，用相同指标比较 GPU。',database:READ_ONLY?'查看公开规格快照，核对数据来源与测试条件。':'查看完整规格、核对数据来源，也可以持续扩展你的数据库。',methodology:'理解数据来源、指标定义与边界，再读懂数字背后的差异。'})[view];
}
function showPublication(publication) {
  if (!READ_ONLY) return;
  $('.local-status').innerHTML='<i></i> 公开浏览版';
  $('#publication-info').hidden=false;
  const published=publication?.generated_at;
  $('#publication-date').textContent=published?`网站发布于 ${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short',hour12:false}).format(new Date(published))}（北京时间）`:'公开数据快照';
  $('#storage-notice').textContent='本页展示已发布的数据快照，支持筛选、排序、比较和 JSON 导出。筛选偏好与比较选择保存在当前浏览器；网站发布时间不代表规格核验或价格检索日期，来源日期与京东检索日期以各条记录为准。';
}
async function init() {
  try {
    const data=await loadCatalog();state.gpus=data.gpus;state.metrics=Object.fromEntries(Object.entries(data.metrics).filter(([,m])=>m.mode!=='sparse').map(([key,m])=>[key,{...m,label:m.label.replace(' · 稠密','')} ]));restoreFilters();restoreComparison();
    showPublication(data.publication);
    $('#metric').innerHTML=metricOptions(state.metric);
    globalThis.ChipRankLocal?.init();
    filters();render();
  } catch(e){$('#load-error').hidden=false;$('#load-error').textContent='数据加载失败：'+e.message;$('#gpu-rows').innerHTML=`<tr><td colspan="8" class="empty">${READ_ONLY?'请检查网络连接，然后刷新页面。':'请确认本地服务已启动，然后刷新页面。'}</td></tr>`;}
}
$('#metric').addEventListener('change',e=>{changeSortMetric(0,e.target.value);render();});
$('#sort-direction').addEventListener('change',e=>{state.sorts[0].direction=e.target.value;render();});
$('#add-sort').addEventListener('click',()=>{const key=Object.keys(sortingMetrics()).find(k=>!state.sorts.some(rule=>rule.key===k));if(!key)return;state.sorts.push({key,direction:'desc'});render();$(`#sort-metric-${state.sorts.length-1}`).focus();});
$('#price-currency').addEventListener('change',e=>{state.priceCurrency=e.target.value;$('#metric').innerHTML=metricOptions(state.metric);render();});
$('#jd-date').addEventListener('change',e=>{state.jdDate=e.target.value;render();});
$('#clear-sorts').addEventListener('click',()=>{state.sorts=state.sorts.slice(0,1);render();});
$('#filter-search').addEventListener('input',e=>{state.query=e.target.value;render();});
$$('[data-scope]').forEach(el=>el.addEventListener('click',()=>{selectScope(el.dataset.scope);filters();render();}));
$('#form-filter').addEventListener('change',e=>{state.form=e.target.value;render();});
$('#year-filter').addEventListener('change',e=>{state.year=e.target.value;render();});
$('#show-missing').addEventListener('change',e=>{state.missing=e.target.checked;render();});
$('#row-limit').addEventListener('change',e=>{state.limit=Number(e.target.value);render();});
$('#reset').addEventListener('click',()=>{state.vendors=new Set(Object.keys(colors));state.segments=new Set(Object.keys(segments));state.architectures=new Set();state.scope='all';state.form='all';state.year='all';state.query='';state.missing=false;filters();render();});
$('#clear-compare').addEventListener('click',clearComparison);
$('#compare-clear').addEventListener('click',clearComparison);
$('#open-compare').addEventListener('click',compare);
$('#compare-search').addEventListener('input',()=>{$('#compare-picker').open=true;renderComparisonCandidates();});
$('#compare-jd-date').addEventListener('change',e=>{state.jdDate=e.target.value;render();renderComparison();});
$('#compare-results').addEventListener('click',e=>{const button=e.target.closest('[data-compare-add]');if(!button)return;if(setCompared(button.dataset.compareAdd,true)){refreshComparison();$('#compare-search').focus();}});
for(const id of ['compare-names','compare-selected'])$('#'+id).addEventListener('click',e=>{const button=e.target.closest('[data-compare-remove]');if(button){setCompared(button.dataset.compareRemove,false);refreshComparison();}});
$('#compare-button').addEventListener('click',compare);
$('#export-button').addEventListener('click',exportData);
$$('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
$$('[data-view]').forEach(el=>el.addEventListener('click',()=>changeView(el.dataset.view)));
init();
