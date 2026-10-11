import type { ManualArticle } from './types'
const escape = (value:string) => value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!))
export function manualPrintHtml(article:ManualArticle, version:string, origin:string, assets:Record<string,string> = {}):string {
  const image=(src:string,alt:string)=>`<img src="${escape(assets[src] || new URL(src,origin).href)}" alt="${escape(alt)}">`
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>NodeAccess — ${escape(article.title)}</title><style>
    @page{size:A4;margin:17mm}*{box-sizing:border-box}body{font:11pt/1.55 Arial,sans-serif;color:#172b45;margin:0}header{font-size:9pt;color:#52657c;border-bottom:2px solid #176650;padding-bottom:12px;margin-bottom:20px}h1{font-size:27pt;line-height:1.2}h2{font-size:16pt;margin-top:26px;break-after:avoid}p,li{orphans:3;widows:3}li{margin:8px 0}img{max-width:100%;height:auto;display:block;margin:20px 0;break-inside:avoid}table{border-collapse:collapse;width:100%;font-size:10pt}td,th{padding:8px;border:1px solid #ccd6e2;text-align:left}tr{break-inside:avoid}a{color:#176650}footer{font-size:9pt;color:#52657c;margin-top:24px}
    </style></head><body><header>NODEACCESS / Manual · Versão ${escape(version)}</header><h1>${escape(article.title)}</h1><p>${escape(article.summary)}</p>${image(article.flow,article.summary)}${article.screenshot?image(article.screenshot,article.title):''}<article>${article.html}</article><footer>Revisão editorial: ${escape(article.reviewedAt)} · Ambiente demonstrativo; consulte as permissões e condições da sua instalação.</footer></body></html>`
}

export async function manualPrintAssets(article:ManualArticle):Promise<Record<string,string>> {
  const entries = await Promise.all([article.flow, article.screenshot].filter((src):src is string=>Boolean(src)).map(async src=>{
    const response = await fetch(src)
    if (!response.ok) throw new Error(`Manual image unavailable: ${response.status}`)
    const blob = await response.blob()
    const data = await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)})
    return [src,data] as const
  }))
  return Object.fromEntries(entries)
}
