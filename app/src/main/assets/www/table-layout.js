/** Shared table geometry for editor preview and Word export. Dimensions returned by layoutPages are twips. */
const defaults = {serial:55,name:175,photo:112,quantity:88,notes:180};
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
export function defaultColumnWidth(column) { return defaults[column?.id] || 130; }
export function columnWidth(column) {
  const value=Number(column?.width);
  return clamp(Number.isFinite(value)&&value>0?value:defaultColumnWidth(column),column?.id==='photo'?72:48,600);
}
export function rowHeight(row) {
  const value=Number(row?.height);
  return clamp(Number.isFinite(value)&&value>0?value:104,64,320);
}
export function layoutPages({rows=[],columns=[],headerHeightPx=150,rowsPerPage=7,orientation='portrait'}={}) {
  const landscape=orientation==='landscape',pageW=landscape?16838:11906,pageH=landscape?11906:16838,margin=820;
  const contentW=pageW-margin*2,logicalWidth=Math.max(1,columns.reduce((sum,column)=>sum+columnWidth(column),0));
  const scale=contentW/logicalWidth;
  const widths=columns.map(column=>Math.floor(columnWidth(column)*scale));
  if(widths.length)widths[widths.length-1]+=contentW-widths.reduce((sum,width)=>sum+width,0);
  const headerH=Math.round(contentW*clamp(Number(headerHeightPx)||150,40,320)/760),tableHeaderH=570;
  // Header/table spacing, repeated table heading, ending paragraph, and page-number breathing room.
  const availableRowH=Math.max(320,pageH-margin*2-headerH-1500);
  const limit=clamp(Math.floor(Number(rowsPerPage)||7),1,20),pages=[];
  let page={rows:[],startIndex:0,heights:[]},used=0;
  for(let index=0;index<rows.length;index++){
    const height=clamp(Math.round(rowHeight(rows[index])*scale),320,availableRowH);
    if(page.rows.length&&(page.rows.length>=limit||used+height>availableRowH)){
      pages.push(page);page={rows:[],startIndex:index,heights:[]};used=0;
    }
    page.rows.push(rows[index]);page.heights.push(height);used+=height;
  }
  if(page.rows.length||!pages.length)pages.push(page);
  return {pages,widths,contentW,pageW,pageH,headerH,margin,scale,logicalWidth,availableRowH,tableHeaderH};
}
