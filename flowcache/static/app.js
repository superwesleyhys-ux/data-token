"use strict";
const $ = (id) => document.getElementById(id);
let busy = false;
let lastReport = null;
const labels = {baseline:"Uncached baseline",cold:"First run",cached:"Run again",peer:"HTTP network reuse",edited:"Edit last paragraph",version:"Task version v2"};
const format = (n) => Number(n).toLocaleString("en-US",{maximumFractionDigits:2});
function status(text) { $("status").textContent = text; }
function size() { $("text-size").textContent = `${new TextEncoder().encode($("text").value).length.toLocaleString("en-US")} bytes`; }
async function sample() { const r = await fetch("/api/sample"); if (!r.ok) throw new Error("Unable to load the sample"); $("text").value=(await r.json()).text; size(); }
async function api(path, body) {
  const r = await fetch(path, {method:"POST",headers:{"Content-Type":"application/json","X-Flowcache":"1"},body:JSON.stringify(body)});
  const data = await r.json(); if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`); return data;
}
async function job(fn) {
  if (busy) return; busy=true;
  document.querySelectorAll("button,select,textarea").forEach(e=>e.disabled=true);
  status("Computing… Please wait.");
  try { await fn(); } catch(e) {status(`Run failed: ${e.message}`);}
  finally {busy=false;document.querySelectorAll("button,select,textarea").forEach(e=>e.disabled=false);}
}
function payload() {return {text:$("text").value,permutations:Number($("permutations").value)};}
function render(run) {
  const m=run.metrics;
  $("cpu").textContent=format(m.client_cpu_ms); $("wall").textContent=format(m.wall_ms);
  $("bytes").textContent=format(m.download_body_bytes/1024);$("nodes").textContent=m.computed_nodes;
  status(`${labels[run.scenario]} complete · Local ${m.local_hits} / Remote ${m.peer_hits} / Computed ${m.computed_nodes}`);
  const p=run.preparation_metrics; $("preparation").hidden=!p;
  if(p) $("preparation").textContent=`Preparation used an additional ${format(p.cohost_process_cpu_ms)} ms of CPU time and ${format(p.wall_ms)} ms of elapsed time. ${run.scenario==="peer"?"The source node computed results from an empty cache; the measurements below cover only this reuse by the receiver.":run.scenario==="edited"?"Appended to the last paragraph: this paragraph has changed; the budget will not increase.":"Prepared the v1 cache, then ran v2."}`;
  $("trace").replaceChildren();
  m.events.forEach(e=>{
    const li=document.createElement("li"),name=document.createElement("span"),key=document.createElement("code"),src=document.createElement("span"),dot=document.createElement("i");
    name.textContent=e.node;key.textContent=e.key;dot.className=`dot ${e.source}`;
    src.append(dot,document.createTextNode({local:"Local hit",peer:"Remote hit",compute:`Computed ${format(e.cpu_ms||0)} ms`}[e.source]));
    li.append(name,key,src);$("trace").append(li);
  });
  $("json").textContent=JSON.stringify(run,null,2);
}
document.querySelectorAll("[data-scenario]").forEach(b=>b.addEventListener("click",()=>job(async()=>render(await api("/api/run",{...payload(),scenario:b.dataset.scenario})))));
$("sample").addEventListener("click",()=>job(async()=>{await sample();status("Sample restored.");}));
$("text").addEventListener("input",size);
$("clear").addEventListener("click",()=>job(async()=>{await api("/api/clear",{});status("Local cache cleared.");}));
$("benchmark").addEventListener("click",()=>job(async()=>{
  const report=await api("/api/benchmark",payload());lastReport=report;
  const names={baseline:"Uncached baseline",cold_local:"Cold local fill",warm_local:"Local cache reuse",warm_peer:"HTTP remote reuse",edited:"Last paragraph edited (different input)"};
  $("comparison-body").replaceChildren();
  Object.entries(report.summary).forEach(([name,m])=>{
    const row=document.createElement("tr"),pct=m.cpu_reduction_vs_baseline_pct;
    const values=[names[name],format(m.cohost_process_cpu_ms),format(m.wall_ms),format(m.download_body_bytes/1024),pct===null?"Not directly comparable":`${pct>=0?"Decrease":"Increase"} ${format(Math.abs(pct))}%`];
    values.forEach(v=>{const td=document.createElement("td");td.textContent=v;row.append(td);});$("comparison-body").append(row);
  });
  $("comparison-empty").hidden=true;$("comparison-table").hidden=false;$("download").hidden=false;
  const breakeven=report.peer_priming_break_even_reuses;
  $("benchmark-note").textContent=`Consistency checks passed. Source priming CPU: ${format(report.peer_priming.cohost_process_cpu_ms)} ms. ${breakeven===null?"No CPU savings were measured for network reuse in this run.":`Based on these medians, approximately ${breakeven} subsequent reuses would amortize the source priming CPU cost.`} This excludes process startup, storage, electricity, and real WiFi differences. Negative savings are shown as measured.`;
  status("Full comparison complete. Results passed consistency checks.");
}));
$("download").addEventListener("click",()=>{if(!lastReport)return;const url=URL.createObjectURL(new Blob([JSON.stringify(lastReport,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="flowcache-benchmark.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
sample().catch(e=>status(e.message));
