import {layoutPages} from './table-layout.js';
/** A real Office Open XML document, generated locally without network dependencies. */
const encoder = new TextEncoder();
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const esc = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const run = (value, bold = false) => `<w:r><w:rPr>${bold ? '<w:b/>' : ''}<w:lang w:val="zh-TW" w:eastAsia="zh-TW"/></w:rPr>${String(value ?? '').split('\n').map((line, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(line)}</w:t>`).join('')}</w:r>`;
const para = (value, align = 'left', bold = false) => `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="0" w:after="0" w:line="260" w:lineRule="auto"/></w:pPr>${run(value, bold)}</w:p>`;

const crcTable = Array.from({length: 256}, (_, n) => {
  for (let k = 0; k < 8; k++) n = (n & 1) ? 0xEDB88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (const b of data) crc = crcTable[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function record(size) {
  const data = new Uint8Array(size), view = new DataView(data.buffer);
  return {data, u16:(at, value) => view.setUint16(at, value, true), u32:(at, value) => view.setUint32(at, value, true)};
}
function zip(files) {
  const chunks = [], central = [];
  let offset = 0, centralSize = 0;
  const now = new Date(), year = Math.max(1980, now.getFullYear());
  const date = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >>> 1);
  for (const [path, input] of files) {
    const name = encoder.encode(path), data = typeof input === 'string' ? encoder.encode(input) : input;
    const crc = crc32(data), h = record(30);
    h.u32(0, 0x04034B50); h.u16(4, 20); h.u16(6, 0x800); h.u16(8, 0);
    h.u16(10, time); h.u16(12, date); h.u32(14, crc); h.u32(18, data.length); h.u32(22, data.length); h.u16(26, name.length);
    chunks.push(h.data, name, data);
    const c = record(46);
    c.u32(0, 0x02014B50); c.u16(4, 20); c.u16(6, 20); c.u16(8, 0x800); c.u16(10, 0);
    c.u16(12, time); c.u16(14, date); c.u32(16, crc); c.u32(20, data.length); c.u32(24, data.length); c.u16(28, name.length); c.u32(42, offset);
    central.push(c.data, name); centralSize += 46 + name.length;
    offset += 30 + name.length + data.length;
  }
  const end = record(22);
  end.u32(0, 0x06054B50); end.u16(8, files.length); end.u16(10, files.length); end.u32(12, centralSize); end.u32(16, offset);
  return new Blob([...chunks, ...central, end.data], {type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
function readImage(dataUrl) {
  const match = /^data:image\/(png|jpe?g);base64,([\s\S]+)$/i.exec(dataUrl || '');
  if (!match) throw new Error('照片格式不支援，請重新拍照後再匯出。');
  const raw = atob(match[2]), bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  return {bytes, ext:match[1].toLowerCase() === 'png' ? 'png' : 'jpg'};
}
function picture(rid, id, widthTwip, heightTwip, alt) {
  const cx = Math.round(widthTwip * 635), cy = Math.round(heightTwip * 635);
  return `<w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Image ${id}" descr="${esc(alt)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Image ${id}" descr="${esc(alt)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/**
 * columns: [{id,label,type}], rows: [{name,quantity,notes,photo:{dataUrl},values:{}}]
 * The header is rasterized by the app so arbitrary draggable text layout is preserved.
 * Inventory table text, quantities and notes remain editable in Word.
 */
export async function createDocx({title='財產清冊', subtitle='', rows=[], columns=[], headerPng=null, headerHeightPx=140, rowsPerPage=7, orientation='portrait'} = {}) {
  if (!Array.isArray(rows) || !Array.isArray(columns) || !columns.length) throw new Error('沒有可匯出的表格欄位。');
  const landscape = orientation === 'landscape';
  const layout = layoutPages({rows,columns,headerHeightPx:headerPng?headerHeightPx:76,rowsPerPage,orientation});
  const {pages,widths,pageW,pageH,margin,contentW,tableHeaderH}=layout;
  const headerH=headerPng?layout.headerH:1050;
  const files=[], relationships=[['rIdStyles','styles','styles.xml'], ['rIdFooter','footer','footer1.xml']];
  let imageId = 0;
  const addImage = (url, label) => {
    const {bytes,ext} = readImage(url), rid = `rIdImage${++imageId}`, path = `media/image${imageId}.${ext}`;
    files.push([`word/${path}`, bytes]); relationships.push([rid,'image',path]);
    return {rid, label};
  };
  const header = headerPng ? addImage(headerPng,title) : null;
  const photos = new Map();
  for (let i=0;i<rows.length;i++) if (rows[i]?.photo?.dataUrl) photos.set(i,addImage(rows[i].photo.dataUrl,rows[i].name || `財產照片 ${i+1}`));
  let drawingId=0;
  const headerBlock = () => header
    ? `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="140"/></w:pPr>${picture(header.rid, ++drawingId, contentW, headerH, title)}</w:p>`
    : `<w:p><w:pPr><w:pStyle w:val="Title"/><w:jc w:val="center"/><w:spacing w:after="180"/></w:pPr>${run(title,true)}</w:p>${subtitle ? para(subtitle,'center') : ''}`;
  const borders = ['top','left','bottom','right','insideH','insideV'].map(side=>`<w:${side} w:val="single" w:sz="6" w:color="9CAAA5"/>`).join('');
  const cell = (content,width,fill='FFFFFF') => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:fill="${fill}"/><w:vAlign w:val="center"/></w:tcPr>${content}</w:tc>`;
  const tableHeader = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/><w:trHeight w:val="${tableHeaderH-140}" w:hRule="atLeast"/></w:trPr>${columns.map((c,i)=>cell(para(c.label || c.id,'center',true),widths[i],'E9EFEB')).join('')}</w:tr>`;
  const rowXml = (row,index,height) => `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${Math.max(180,height-140)}" w:hRule="atLeast"/></w:trPr>${columns.map((c,i)=>{
    let content;
    if(c.id==='photo') {
      const photo=photos.get(index), size=Math.max(1,Math.min(height-260,widths[i]-180));
      content=photo ? `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0"/></w:pPr>${picture(photo.rid,++drawingId,size,size,photo.label)}</w:p>` : para('未拍照','center');
    } else {
      let value = c.id==='serial' ? index+1 : ['name','quantity','notes'].includes(c.id) ? row[c.id] : row.values?.[c.id];
      if(c.type==='checkbox') value=value ? '☑' : '☐';
      content=para(value ?? '',c.id==='serial'||c.id==='quantity'||c.type==='checkbox'?'center':'left');
    }
    return cell(content,widths[i]);
  }).join('')}</w:tr>`;
  const table = page => `<w:tbl><w:tblPr><w:tblW w:w="${contentW}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}</w:tblBorders><w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${tableHeader}${page.rows.map((row,i)=>rowXml(row,page.startIndex+i,page.heights[i])).join('')}</w:tbl>`;
  const chunks=[];
  for(let pageIndex=0;pageIndex<pages.length;pageIndex++) {
    if(pageIndex) chunks.push('<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>');
    chunks.push(headerBlock(),table(pages[pageIndex]));
  }
  const section = `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="${pageW}" w:h="${pageH}"${landscape?' w:orient="landscape"':''}/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="360" w:footer="380" w:gutter="0"/></w:sectPr>`;
  const namespaces = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
  files.push(['word/document.xml',`${XML}<w:document ${namespaces}><w:body>${chunks.join('')}${section}</w:body></w:document>`]);
  files.push(['word/styles.xml',`${XML}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft JhengHei"/><w:color w:val="000000"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="zh-TW" w:eastAsia="zh-TW"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="260" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="36"/></w:rPr></w:style></w:styles>`]);
  const field = name => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${name} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('1')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  files.push(['word/footer1.xml',`${XML}<w:ftr xmlns:w="${W}"><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0"/></w:pPr>${run('第 ')}${field('PAGE')}${run(' 頁，共 ')}${field('NUMPAGES')}${run(' 頁')}</w:p></w:ftr>`]);
  files.push(['word/_rels/document.xml.rels',`${XML}<Relationships xmlns="${REL}">${relationships.map(([id,type,target])=>`<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`).join('')}</Relationships>`]);
  files.push(['_rels/.rels',`${XML}<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`]);
  files.push(['docProps/core.xml',`${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>財產清冊</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`]);
  files.push(['[Content_Types].xml',`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`]);
  return zip(files);
}
