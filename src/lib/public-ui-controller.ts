export {};
function initialize(){
 document.querySelectorAll<HTMLImageElement>('[data-public-image]').forEach(img=>{if(img.dataset.ready)return;img.dataset.ready='1';const failed=()=>{const parent=img.parentElement;if(!parent)return;const label=document.createElement('span');label.textContent=document.documentElement.lang==='en'?'Cover unavailable':'封面無法載入';img.replaceWith(label);};img.addEventListener('error',failed,{once:true});if(img.complete&&!img.naturalWidth)failed();});
 const returnTo=new URL(location.href).searchParams.get('returnTo');
 if(returnTo){try{const url=new URL(returnTo,location.origin);if(url.origin===location.origin&&/^\/(?:en\/)?(?:games|collection)\/?$/.test(url.pathname)){const path=url.pathname.replace(/^\/en(?=\/)/,'');const localized=(document.documentElement.lang==='en'?'/en':'')+path;document.querySelectorAll<HTMLAnchorElement>('[data-detail-back]').forEach(a=>a.href=localized+url.search);}}catch{}}
}
initialize();document.addEventListener('astro:page-load',initialize);
