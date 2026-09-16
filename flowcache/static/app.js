"use strict";
const $ = (id) => document.getElementById(id);
let busy = false;
let lastReport = null;
const labels = {baseline:"无缓存基线",cold:"首次计算",cached:"重复运行",peer:"HTTP 网络复用",edited:"修改末段",version:"任务版本 v2"};
const format = (n) => Number(n).toLocaleString("zh-CN",{maximumFractionDigits:2});
function status(text) { $("status").textContent = text; }
function size() { $("text-size").textContent = `${new TextEncoder().encode($("text").value).length.toLocaleString()} bytes`; }
async function sample() { const r = await fetch("/api/sample"); if (!r.ok) throw new Error("无法载入示例"); $("text").value=(await r.json()).text; size(); }
async function api(path, body) {
  const r = await fetch(path, {method:"POST",headers:{"Content-Type":"application/json","X-Flowcache":"1"},body:JSON.stringify(body)});
  const data = await r.json(); if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`); return data;
}
async function job(fn) {
  if (busy) return; busy=true;
  document.querySelectorAll("button,select,textarea").forEach(e=>e.disabled=true);
  status("计算中… 请稍候。");
  try { await fn(); } catch(e) {status(`运行失败：${e.message}`);}
  finally {busy=false;document.querySelectorAll("button,select,textarea").forEach(e=>e.disabled=false);}
}
function payload() {return {text:$("text").value,permutations:Number($("permutations").value)};}
function render(run) {
  const m=run.metrics;
  $("cpu").textContent=format(m.client_cpu_ms); $("wall").textContent=format(m.wall_ms);
  $("bytes").textContent=format(m.download_body_bytes/1024);$("nodes").textContent=m.computed_nodes;
  status(`${labels[run.scenario]}完成 · 本地 ${m.local_hits} / 远端 ${m.peer_hits} / 重算 ${m.computed_nodes}`);
  const p=run.preparation_metrics; $("preparation").hidden=!p;
  if(p) $("preparation").textContent=`准备阶段另外消耗 CPU ${format(p.cohost_process_cpu_ms)} ms，耗时 ${format(p.wall_ms)} ms。${run.scenario==="peer"?"源节点从空缓存生成结果；下方计量仅包含接收端这次复用。":run.scenario==="edited"?"已在末段追加：本段已修改，预算不增加。":"先准备 v1 缓存，再运行 v2。"}`;
  $("trace").replaceChildren();
  m.events.forEach(e=>{
    const li=document.createElement("li"),name=document.createElement("span"),key=document.createElement("code"),src=document.createElement("span"),dot=document.createElement("i");
    name.textContent=e.node;key.textContent=e.key;dot.className=`dot ${e.source}`;
    src.append(dot,document.createTextNode({local:"本地命中",peer:"远端命中",compute:`计算 ${format(e.cpu_ms||0)} ms`}[e.source]));
    li.append(name,key,src);$("trace").append(li);
  });
  $("json").textContent=JSON.stringify(run,null,2);
}
document.querySelectorAll("[data-scenario]").forEach(b=>b.addEventListener("click",()=>job(async()=>render(await api("/api/run",{...payload(),scenario:b.dataset.scenario})))));
$("sample").addEventListener("click",()=>job(async()=>{await sample();status("已恢复示例。");}));
$("text").addEventListener("input",size);
$("clear").addEventListener("click",()=>job(async()=>{await api("/api/clear",{});status("本地缓存已清空。");}));
$("benchmark").addEventListener("click",()=>job(async()=>{
  const report=await api("/api/benchmark",payload());lastReport=report;
  const names={baseline:"无缓存基线",cold_local:"首次本地填充",warm_local:"本地缓存复用",warm_peer:"HTTP 远端复用",edited:"修改末段（不同输入）"};
  $("comparison-body").replaceChildren();
  Object.entries(report.summary).forEach(([name,m])=>{
    const row=document.createElement("tr"),pct=m.cpu_reduction_vs_baseline_pct;
    const values=[names[name],format(m.cohost_process_cpu_ms),format(m.wall_ms),format(m.download_body_bytes/1024),pct===null?"不直接比较":`${pct>=0?"减少":"增加"} ${format(Math.abs(pct))}%`];
    values.forEach(v=>{const td=document.createElement("td");td.textContent=v;row.append(td);});$("comparison-body").append(row);
  });
  $("comparison-empty").hidden=true;$("comparison-table").hidden=false;$("download").hidden=false;
  const breakeven=report.peer_priming_break_even_reuses;
  $("benchmark-note").textContent=`一致性验证通过。源端首次生成 CPU：${format(report.peer_priming.cohost_process_cpu_ms)} ms。${breakeven===null?"本次网络复用没有测出 CPU 收益。":`按本次中位数估算，约 ${breakeven} 次后续复用可摊平源端首次生成的 CPU 成本。`} 这不包含进程启动、存储、电费及真实 WiFi 差异。负收益会照实显示。`;
  status("完整对照完成，结果已通过一致性验证。");
}));
$("download").addEventListener("click",()=>{if(!lastReport)return;const url=URL.createObjectURL(new Blob([JSON.stringify(lastReport,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="flowcache-benchmark.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
sample().catch(e=>status(e.message));
