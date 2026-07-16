import{c as _,r,j as a,M as J,b as Q}from"./I18nProvider-CJLfJKe0.js";import{G as D}from"./gamepad-2-DSa3_8g3.js";import{R as Z}from"./rotate-ccw-eY_8esBM.js";import{g as ee}from"./index-z0QEev9Y.js";import{j as te}from"./useSocial-Dqy2Da9G.js";/**
 * @license lucide-react v0.525.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const re=[["path",{d:"m5 12 7-7 7 7",key:"hav0vg"}],["path",{d:"M12 19V5",key:"x0mq9r"}]],je=_("arrow-up",re);/**
 * @license lucide-react v0.525.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const se=[["path",{d:"M10 8h.01",key:"1r9ogq"}],["path",{d:"M12 12h.01",key:"1mp3jc"}],["path",{d:"M14 8h.01",key:"1primd"}],["path",{d:"M16 12h.01",key:"1l6xoz"}],["path",{d:"M18 8h.01",key:"emo2bl"}],["path",{d:"M6 8h.01",key:"x9i8wu"}],["path",{d:"M7 16h10",key:"wp8him"}],["path",{d:"M8 12h.01",key:"czm47f"}],["rect",{width:"20",height:"16",x:"2",y:"4",rx:"2",key:"18n3k1"}]],ae=_("keyboard",se);/**
 * @license lucide-react v0.525.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ne=[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"m21 3-7 7",key:"1l2asr"}],["path",{d:"m3 21 7-7",key:"tjx5ai"}],["path",{d:"M9 21H3v-6",key:"wtvkvv"}]],ie=_("maximize-2",ne);/**
 * @license lucide-react v0.525.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const oe=[["path",{d:"m14 10 7-7",key:"oa77jy"}],["path",{d:"M20 10h-6V4",key:"mjg0md"}],["path",{d:"m3 21 7-7",key:"tjx5ai"}],["path",{d:"M4 14h6v6",key:"rmj7iw"}]],le=_("minimize-2",oe);/**
 * @license lucide-react v0.525.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ce=[["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",key:"4alrt4"}],["path",{d:"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",key:"v07s0e"}],["line",{x1:"10",x2:"10",y1:"11",y2:"17",key:"1uufr5"}],["line",{x1:"14",x2:"14",y1:"11",y2:"17",key:"xtxkd"}]],Ee=_("trash-2",ce),G=1,ue=["ready","console","score","error","pause","resume","capture","capture:result"],de=["log","info","warn","error"];function E(s){return typeof s=="object"&&s!==null&&!Array.isArray(s)}function fe(s){if(!E(s)||s.v!==G)return!1;const f=s.type;if(typeof f!="string"||!ue.includes(f))return!1;const e=s.payload;switch(f){case"ready":case"pause":case"resume":case"capture":return e===void 0||E(e);case"capture:result":return E(e)&&(e.dataUrl===null||typeof e.dataUrl=="string")&&(e.error===void 0||typeof e.error=="string");case"console":return E(e)&&typeof e.level=="string"&&de.includes(e.level)&&typeof e.message=="string"&&(e.stack===void 0||typeof e.stack=="string")&&(e.ts===void 0||typeof e.ts=="number");case"score":return E(e)&&typeof e.score=="number"&&Number.isFinite(e.score);case"error":return E(e)&&typeof e.message=="string"&&(e.stack===void 0||typeof e.stack=="string")}}function U(s){return fe(s)?s.payload===void 0?{...s,payload:{}}:s:null}function pe(s){try{return new URL(s).origin}catch{return null}}function V(s,f){if(s==="null")return!0;const e=pe(f);return e!==null&&s===e}function q(s){return{v:G,type:s,payload:{}}}function he(s,f,e={}){const{timeoutMs:d=4e3,target:u}=e,l=u??globalThis,c=s.contentWindow;return c?new Promise(m=>{let n=!1,y;const v=i=>{n||(n=!0,l.removeEventListener("message",w),clearTimeout(y),m(i))},w=i=>{if(!V(i.origin,f)||i.source!==c)return;const h=U(i.data);!h||h.type!=="capture:result"||v(h.payload.dataUrl)};l.addEventListener("message",w),y=setTimeout(()=>v(null),d),c.postMessage(q("capture"),"*")}):Promise.resolve(null)}function me(s,f){const d=r.useRef(s);d.current=s;const u=r.useRef(0),l=r.useRef(null),c=r.useRef(!1),m=r.useRef(null),n=r.useCallback(()=>{m.current!==null&&(clearTimeout(m.current),m.current=null)},[]),y=r.useCallback(()=>{var M;if(c.current)return;c.current=!0,n();const h=u.current+(l.current!==null?Date.now()-l.current:0);(M=d.current)==null||M.call(d,Math.max(5,Math.floor(h/1e3)))},[n,5]),v=r.useCallback(()=>{if(c.current||l.current!==null)return;l.current=Date.now();const h=Math.max(0,5*1e3-u.current);n(),m.current=setTimeout(y,h)},[n,y,5]),w=r.useCallback(()=>{l.current!==null&&(u.current+=Date.now()-l.current,l.current=null),n()},[n]),i=r.useCallback(()=>{n(),u.current=0,l.current=null,c.current=!1},[n]);return r.useEffect(()=>n,[n]),r.useMemo(()=>({start:v,pause:w,reset:i}),[v,w,i])}const ye=1e4,o={canvas:"#0A0A0F",surface:"#12121A",surfaceRaised:"#1A1A24",border:"#2A2A3A",text:"#F4F4F8",textMuted:"#A0A0B8",violet:"#8B5CF6",cyan:"#22D3EE"},z={iframe:{display:"block",width:"100%",height:"100%",border:"0",background:o.canvas},overlay:{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,background:o.canvas},hintPill:{position:"absolute",bottom:12,left:"50%",transform:"translateX(-50%)",display:"inline-flex",alignItems:"center",gap:8,padding:"6px 14px",borderRadius:999,border:`1px solid ${o.border}`,background:o.surface,color:o.textMuted,fontSize:13,pointerEvents:"none",whiteSpace:"nowrap"},fullscreenBtn:{position:"absolute",top:10,right:10,display:"inline-flex",alignItems:"center",justifyContent:"center",width:40,height:40,borderRadius:12,border:`1px solid ${o.border}`,background:o.surface,color:o.textMuted,cursor:"pointer"},reloadBtn:{display:"inline-flex",alignItems:"center",gap:8,padding:"10px 20px",borderRadius:14,border:"0",cursor:"pointer",color:"#0A0A0F",fontWeight:600,fontSize:14,background:`linear-gradient(135deg, ${o.violet} 0%, ${o.cyan} 100%)`}};function ge({versionUrl:s,cdnOrigin:f,title:e,onReady:d,onScore:u,onConsole:l,onError:c,onPlayedFor:m,onCaptureAvailable:n,autoFocus:y=!1,fill:v=!1,className:w}){const[i,h]=r.useState("loading"),[M,R]=r.useState(!1),[A,W]=r.useState(0),[H,K]=r.useState(!1),[j,C]=r.useState(!1),L=r.useRef(null),x=r.useRef(null),b=me(m),P=H||j,T=r.useCallback(t=>{var k;const p=(k=x.current)==null?void 0:k.contentWindow;p==null||p.postMessage(q(t),"*")},[]);r.useEffect(()=>{if(i!=="loading")return;const t=setTimeout(()=>h("timeout"),ye);return()=>clearTimeout(t)},[i,A]),r.useEffect(()=>{const t=p=>{var N,$,I,S,B;if(!V(p.origin,f))return;const k=(N=x.current)==null?void 0:N.contentWindow;if(!k||p.source!==k)return;const g=p.data;if(g&&g.source==="mawdoo3-game"&&typeof g.event=="string"){g.event==="game_ready"?(h("ready"),b.start(),d==null||d(),y&&(R(!0),($=x.current)==null||$.focus())):g.event==="game_over"&&typeof((I=g.data)==null?void 0:I.score)=="number"?u==null||u(g.data.score):g.event==="game_error"&&(c==null||c({message:String(((S=g.data)==null?void 0:S.message)??"Game error")}));return}const F=U(p.data);if(F)switch(F.type){case"ready":h("ready"),b.start(),d==null||d(),y&&(R(!0),(B=x.current)==null||B.focus());break;case"console":l==null||l(F.payload);break;case"score":u==null||u(F.payload.score);break;case"error":c==null||c(F.payload);break}};return window.addEventListener("message",t),()=>window.removeEventListener("message",t)},[y,f,l,c,d,u,b]),r.useEffect(()=>{const t=()=>{document.hidden?(T("pause"),b.pause()):(T("resume"),i==="ready"&&b.start())};return document.addEventListener("visibilitychange",t),()=>document.removeEventListener("visibilitychange",t)},[i,T,b]),r.useEffect(()=>{if(!M)return;const t=p=>{var k;p.key==="Escape"&&(R(!1),(k=x.current)==null||k.blur())};return window.addEventListener("keydown",t),()=>window.removeEventListener("keydown",t)},[M]),r.useEffect(()=>{const t=()=>K(document.fullscreenElement===L.current);return document.addEventListener("fullscreenchange",t),()=>document.removeEventListener("fullscreenchange",t)},[]),r.useEffect(()=>{if(!j)return;const t=p=>{p.key==="Escape"&&C(!1)};return window.addEventListener("keydown",t),()=>window.removeEventListener("keydown",t)},[j]);const X=r.useCallback(()=>{var t;R(!0),(t=x.current)==null||t.focus()},[]);r.useEffect(()=>{if(n){if(i!=="ready"){n(null);return}return n(()=>{const t=x.current;return t?he(t,f,{timeoutMs:2e3}):Promise.resolve(null)}),()=>n(null)}},[i,f,n]);const O=r.useCallback(()=>{h("loading"),R(!1),b.reset(),W(t=>t+1)},[b]),Y=r.useCallback(()=>{var p;const t=L.current;if(t){if(j){C(!1);return}if(document.fullscreenElement===t){(p=document.exitFullscreen)==null||p.call(document);return}typeof t.requestFullscreen=="function"?t.requestFullscreen().catch(()=>C(!0)):C(!0)}},[j]);return a.jsxs("div",{ref:L,className:J("fp-game-player",j&&"fp-game-player--fs",v&&"fp-game-player--fill",w),style:{fontFamily:"var(--font-sans, Inter, system-ui, sans-serif)",color:o.text},children:[a.jsx("style",{children:xe}),i!=="timeout"&&a.jsx("iframe",{ref:x,src:s,title:e??"Codply game",sandbox:"allow-scripts",allow:"fullscreen; pointer-lock",style:z.iframe,tabIndex:0},A),i==="loading"&&a.jsxs("div",{style:z.overlay,role:"status","aria-live":"polite","data-testid":"player-skeleton",children:[a.jsx(D,{size:40,color:o.violet,style:{animation:"fp-player-pulse 1.2s ease-out infinite"},"aria-hidden":!0}),a.jsx("p",{style:{margin:0,fontSize:14,color:o.textMuted},children:"Loading game…"}),a.jsx("div",{style:{width:160,height:6,borderRadius:999,background:o.surfaceRaised,overflow:"hidden"},"aria-hidden":!0,children:a.jsx("div",{style:{width:"40%",height:"100%",borderRadius:999,background:`linear-gradient(90deg, ${o.violet}, ${o.cyan})`,animation:"fp-player-slide 1.4s ease-out infinite"}})})]}),i==="timeout"&&a.jsxs("div",{style:z.overlay,role:"alert","data-testid":"player-error",children:[a.jsx(D,{size:40,color:o.textMuted,"aria-hidden":!0}),a.jsx("p",{style:{margin:0,fontWeight:600,fontSize:16},children:"This game is taking too long to load"}),a.jsx("p",{style:{margin:0,fontSize:14,color:o.textMuted},children:"It may be a hiccup on our side — a reload usually fixes it."}),a.jsxs("button",{type:"button",onClick:O,style:z.reloadBtn,children:[a.jsx(Z,{size:16,"aria-hidden":!0})," Reload"]})]}),i==="ready"&&!M&&a.jsx("button",{type:"button",onClick:X,"data-testid":"capture-overlay","aria-label":"Click to play — keyboard will be captured, press Escape to release",style:{position:"absolute",inset:0,background:"transparent",border:0,cursor:"pointer",padding:0}}),i==="ready"&&a.jsxs(a.Fragment,{children:[a.jsxs("div",{style:z.hintPill,className:"fp-gp-hint","data-testid":"capture-hint",children:[a.jsx(ae,{size:14,"aria-hidden":!0}),M?"Playing — press Esc to release controls":"Click to play"]}),a.jsx("button",{type:"button",onClick:Y,"aria-label":P?"Exit fullscreen":"Enter fullscreen","data-testid":"fullscreen-toggle",style:z.fullscreenBtn,children:P?a.jsx(le,{size:16,"aria-hidden":!0}):a.jsx(ie,{size:16,"aria-hidden":!0})})]})]})}const xe=`
.fp-game-player {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  max-height: 70vh;
  max-height: 70dvh;
  background: ${o.canvas};
  border: 1px solid ${o.border};
  border-radius: var(--fp-player-radius, 16px);
  overflow: hidden;
  touch-action: manipulation;
}
.fp-game-player:fullscreen {
  aspect-ratio: auto;
  width: 100%;
  height: 100%;
  max-height: none;
  border: 0;
  border-radius: 0;
}
.fp-game-player--fs {
  position: fixed;
  inset: 0;
  z-index: 70;
  width: auto;
  aspect-ratio: auto;
  height: 100vh;
  height: 100dvh;
  max-height: none;
  border: 0;
  border-radius: 0;
}
/* E42: fill the parent (the device-preview frame) edge-to-edge — the game
   occupies the whole phone/tablet viewport, no 16/10 letterbox, no white gap.
   The device frame supplies the bezel + rounding, so drop the player's own. */
.fp-game-player--fill {
  aspect-ratio: auto;
  width: 100%;
  height: 100%;
  max-height: none;
  border: 0;
  border-radius: 0;
}
@media (pointer: coarse) {
  .fp-gp-hint { display: none !important; }
}
@keyframes fp-player-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .55; transform: scale(.92); } }
@keyframes fp-player-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }
@media (prefers-reduced-motion: reduce) {
  .fp-game-player * { animation: none !important; }
}
`;function ze({gameId:s,playUrl:f,cdnOrigin:e,title:d,playSource:u,onConsole:l,onCaptureAvailable:c,fill:m=!1,className:n}){const y=r.useCallback(()=>{ee().games.play(s,te(),u).catch(()=>{})},[s,u]);return a.jsx("div",{className:Q(m&&"h-full w-full",n),children:a.jsx(ge,{versionUrl:f,cdnOrigin:e,title:d,onPlayedFor:y,onConsole:l,onCaptureAvailable:c,fill:m})})}export{je as A,ze as G,ie as M,Ee as T,pe as n};
