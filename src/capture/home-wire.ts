import type{Interval}from'./events.ts';
import type{HomeSummary}from'./home-summary.ts';
export interface HomeWire {format:'home-periods-v1';summary:Omit<HomeSummary,'intervals'>;contexts:Array<Omit<Interval,'start'|'end'|'sourceEventIds'>>;periods:Array<[number,number,number]>;token:string;}
/** Shared contexts avoid transmitting/parsing the same metadata thousands of times. */
export function encodeHome(value:HomeSummary&{token:string}):HomeWire{
 const{intervals,token,...summary}=value,contexts:HomeWire['contexts']=[],periods:HomeWire['periods']=[],ids=new Map<string,number>();
 for(const{start,end,sourceEventIds,...context}of intervals){const key=JSON.stringify(context);let id=ids.get(key);if(id===undefined){id=contexts.length;contexts.push(context);ids.set(key,id);}periods.push([start,end,id]);}
 return{format:'home-periods-v1',summary,contexts,periods,token};
}
export function decodeHome(value:HomeWire):HomeSummary&{token:string}{
 if(value.format!=='home-periods-v1')throw Error('Unsupported Home response');
 return{...value.summary,intervals:value.periods.map(([start,end,id])=>{const context=value.contexts[id];if(!context||!Number.isFinite(start)||!Number.isFinite(end))throw Error('Invalid Home period');return{...context,start,end,sourceEventIds:[]};}),token:value.token};
}
