import{c as m}from"./react-BLJMagXv.js";import{c as d,u as y,j as r}from"./I18nProvider-CJLfJKe0.js";import{a as x,g}from"./index-CoHWWz3_.js";import{u as k,B as h}from"./useMe-gJZm2ikp.js";import{u as v}from"./useSocial-D818yj56.js";/**
 * @license lucide-react v0.525.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const j=[["path",{d:"M2 21a8 8 0 0 1 13.292-6",key:"bjp14o"}],["circle",{cx:"10",cy:"8",r:"5",key:"o932ke"}],["path",{d:"m16 19 2 2 4-4",key:"1b14m6"}]],M=d("user-round-check",j);/**
 * @license lucide-react v0.525.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const w=[["path",{d:"M2 21a8 8 0 0 1 13.292-6",key:"bjp14o"}],["circle",{cx:"10",cy:"8",r:"5",key:"o932ke"}],["path",{d:"M19 16v6",key:"tddt3s"}],["path",{d:"M22 19h-6",key:"vcuq98"}]],b=d("user-round-plus",w),q=m(e=>({contextKey:null,slugs:[],loadMore:null,setContext:(n,o,t)=>e({contextKey:n,slugs:i(o.map(s=>s.slug)),loadMore:t}),appendItems:(n,o)=>e(t=>t.contextKey===n?{slugs:i([...t.slugs,...o.map(s=>s.slug)])}:{}),clear:()=>e({contextKey:null,slugs:[],loadMore:null})}));function B(e,n){const o=e.indexOf(n);return o===-1?{prev:null,next:null}:{prev:o>0?e[o-1]??null:null,next:o<e.length-1?e[o+1]??null:null}}function i(e){return[...new Set(e)]}function C({handle:e,following:n,size:o="sm"}){var c,a;const{t}=y(),{data:s}=k(),u=(s==null?void 0:s.handle)===e,p=x({queryKey:["profile",e],queryFn:()=>g().social.profile(e),enabled:n===void 0&&!u,staleTime:6e4}),l=n??((a=(c=p.data)==null?void 0:c.viewer)==null?void 0:a.following)??!1,{toggle:f}=v(e,l);return u?null:r.jsx(h,{variant:l?"soft":"solid",size:o,onClick:f,leftIcon:l?r.jsx(M,{className:"size-4","aria-hidden":!0}):r.jsx(b,{className:"size-4","aria-hidden":!0}),children:l?t.profile.following:t.profile.follow})}export{C as F,B as n,q as u};
