import{c as d,r as o}from"./I18nProvider-Ck0up_xu.js";import{a as h,g as y}from"./index-ZsPnwrK6.js";/**
 * @license lucide-react v0.525.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const E=[["path",{d:"m13.5 8.5-5 5",key:"1cs55j"}],["path",{d:"m8.5 8.5 5 5",key:"a8mexj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}],["path",{d:"m21 21-4.3-4.3",key:"1qie3q"}]],_=d("search-x",E),S="search",n=2,g=250;function q(t,r=6){const[e,i]=o.useState(()=>t.trim());o.useEffect(()=>{const m=setTimeout(()=>i(t.trim()),g);return()=>clearTimeout(m)},[t]);const c=t.trim(),a=e.length>=n,s=h({queryKey:[S,e,r],queryFn:()=>y().search.searchGames(e,r),enabled:a,staleTime:3e4}),u=c!==e&&c.length>=n;return{items:s.data??[],isLoading:u||a&&s.isLoading,isError:s.isError,query:e}}export{n as S,_ as a,q as u};
