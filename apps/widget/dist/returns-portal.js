(function(){var s=document.createElement('style');s.textContent="@import\"https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,200;0,6..72,300;0,6..72,400;1,6..72,200;1,6..72,300&family=Manrope:wght@300;400;500;600;700&display=swap\";:root{--srp-gold: #C5A059;--srp-ink: #131314;--srp-body: #2d3338;--srp-surface: #F9F9FB;--srp-warm: #f4f0eb;--srp-border: rgba(19, 19, 20, .08);--srp-border-strong: rgba(19, 19, 20, .15);--srp-text-muted: #71757a;--srp-font-heading: \"Newsreader\", Georgia, serif;--srp-font-body: \"Manrope\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif}.srp-wrap{max-width:640px;margin:0 auto;font-family:var(--srp-font-body);font-size:.85rem;font-weight:300;color:var(--srp-body);line-height:1.6;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}.srp-wrap *,.srp-wrap *:before,.srp-wrap *:after{box-sizing:border-box;margin:0;padding:0}.srp-header{text-align:center;margin-bottom:2.5rem}.srp-eyebrow{font-family:var(--srp-font-body);font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.25em;color:var(--srp-gold);margin-bottom:.6rem}.srp-title{font-family:var(--srp-font-heading);font-size:3.2rem;font-weight:200;color:var(--srp-ink);line-height:1.1;margin-bottom:.5rem;letter-spacing:-.01em}.srp-subtitle{font-family:var(--srp-font-body);font-size:.85rem;font-weight:300;color:var(--srp-text-muted)}.srp-progress{display:flex;align-items:center;justify-content:center;gap:0;margin-bottom:2.5rem}.srp-progress__step{display:flex;flex-direction:column;align-items:center;gap:6px;position:relative;z-index:1}.srp-progress__dot{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--srp-font-body);font-size:.75rem;font-weight:600;border:1.5px solid var(--srp-border-strong);background:transparent;color:var(--srp-text-muted);transition:all .3s ease}.srp-progress__step--active .srp-progress__dot{background:var(--srp-gold);border-color:var(--srp-gold);color:#fff}.srp-progress__step--done .srp-progress__dot{background:var(--srp-ink);border-color:var(--srp-ink);color:#fff}.srp-progress__dot svg{width:14px;height:14px}.srp-progress__label{font-family:var(--srp-font-body);font-size:.7rem;font-weight:500;color:var(--srp-text-muted);white-space:nowrap}.srp-progress__step--active .srp-progress__label{color:var(--srp-gold);font-weight:600}.srp-progress__step--done .srp-progress__label{color:var(--srp-ink)}.srp-progress__line{width:80px;height:1.5px;background:var(--srp-border-strong);margin:0 8px 22px;transition:background .3s ease}.srp-progress__line--done{background:var(--srp-gold)}.srp-divider{height:1px;background:var(--srp-border);margin-bottom:2rem}.srp-field{margin-bottom:1.25rem}.srp-label{display:block;font-family:var(--srp-font-body);font-size:.75rem;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:var(--srp-body);margin-bottom:.5rem}.srp-required{color:var(--srp-gold);margin-left:2px}.srp-input,.srp-select,.srp-textarea{width:100%;padding:.75rem 1rem;font-family:var(--srp-font-body);font-size:.85rem;font-weight:300;border:1px solid var(--srp-border);border-radius:0;background:#fff;color:var(--srp-ink);transition:border-color .2s;-webkit-appearance:none;-moz-appearance:none;appearance:none}.srp-input::placeholder,.srp-textarea::placeholder{color:var(--srp-text-muted);opacity:.6}.srp-input:focus,.srp-select:focus,.srp-textarea:focus{outline:none;border-color:var(--srp-gold)}.srp-textarea{resize:vertical;min-height:80px}.srp-select{background-image:url(\"data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%2371757a' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 1rem center;padding-right:2.5rem}.srp-row{display:flex;gap:1rem}.srp-row .srp-field{flex:1}@media(max-width:480px){.srp-row{flex-direction:column;gap:0}}.srp-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:.85rem 2rem;font-family:var(--srp-font-body);font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.12em;border:none;border-radius:0;cursor:pointer;transition:opacity .2s,transform .1s}.srp-btn:hover{opacity:.88}.srp-btn:active{transform:scale(.99)}.srp-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}.srp-btn--primary{background:var(--srp-gold);color:var(--srp-ink);width:100%}.srp-btn--dark{background:var(--srp-ink);color:var(--srp-surface);width:100%}.srp-btn--outline{background:transparent;color:var(--srp-ink);border:1px solid var(--srp-border-strong);width:100%}.srp-btn--outline:hover{border-color:var(--srp-ink)}.srp-policy{display:flex;align-items:flex-start;gap:10px;background:var(--srp-warm);padding:1rem 1.25rem;margin-top:1.5rem}.srp-policy__icon{flex-shrink:0;width:18px;height:18px;color:var(--srp-gold);margin-top:1px}.srp-policy__text{font-size:.8rem;font-weight:400;color:var(--srp-body);line-height:1.5}.srp-error{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:.75rem 1rem;border-radius:0;font-size:.82rem;margin-bottom:1.5rem}.srp-back{display:inline-flex;align-items:center;gap:4px;font-family:var(--srp-font-body);font-size:.8rem;font-weight:400;color:var(--srp-text-muted);cursor:pointer;margin-bottom:1.5rem;background:none;border:none;transition:color .15s;padding:0}.srp-back:hover{color:var(--srp-ink)}.srp-order-bar{display:flex;align-items:center;justify-content:space-between;background:var(--srp-warm);padding:.85rem 1.25rem;margin-bottom:1.75rem;font-size:.8rem}.srp-order-bar__left{font-weight:600;color:var(--srp-ink)}.srp-order-bar__right{color:var(--srp-text-muted);font-weight:400}.srp-section-label{font-family:var(--srp-font-body);font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.2em;color:var(--srp-gold);margin-bottom:1rem}.srp-items{display:flex;flex-direction:column;gap:0;margin-bottom:1.75rem}.srp-item{display:flex;gap:14px;padding:16px;border:1px solid var(--srp-border);margin-bottom:-1px;transition:border-color .2s;cursor:pointer}.srp-item--selected{border-color:var(--srp-gold);z-index:1;position:relative}.srp-item--ineligible{opacity:.5;cursor:default}.srp-item__check{flex-shrink:0;width:20px;height:20px;border:1.5px solid var(--srp-border-strong);border-radius:0;display:flex;align-items:center;justify-content:center;transition:all .15s;margin-top:2px}.srp-item--selected .srp-item__check{background:var(--srp-gold);border-color:var(--srp-gold)}.srp-item--ineligible .srp-item__check{cursor:not-allowed;opacity:.4}.srp-item__check svg{width:12px;height:12px;color:#fff}.srp-item__image{width:72px;height:72px;object-fit:cover;flex-shrink:0;background:var(--srp-surface);border:1px solid var(--srp-border)}.srp-item__image--placeholder{display:flex;align-items:center;justify-content:center;color:var(--srp-text-muted)}.srp-item__image--placeholder svg{width:24px;height:24px;opacity:.3}.srp-item__info{flex:1;min-width:0}.srp-item__row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.srp-item__title{font-family:var(--srp-font-heading);font-size:.95rem;font-weight:300;color:var(--srp-ink);line-height:1.3}.srp-item__price{font-family:var(--srp-font-body);font-size:.85rem;font-weight:500;color:var(--srp-ink);white-space:nowrap;flex-shrink:0}.srp-item__variant{font-size:.78rem;color:var(--srp-text-muted);margin-top:2px}.srp-item__meta{display:flex;gap:10px;font-size:.75rem;color:var(--srp-text-muted);margin-top:3px}.srp-item__ineligible-reason{font-size:.75rem;color:var(--srp-gold);font-weight:500;margin-top:6px}.srp-item-reason{margin-top:14px;padding-top:14px;border-top:1px solid var(--srp-border)}.srp-item-reason .srp-label{font-size:.7rem;margin-bottom:.4rem}.srp-item-reason .srp-select,.srp-item-reason .srp-textarea{margin-top:6px;font-size:.82rem}.srp-resolution-toggle{display:flex;gap:0;margin-bottom:12px}.srp-resolution-btn{flex:1;padding:8px 12px;font-family:var(--srp-font-body);font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;border:1px solid var(--srp-border-strong);background:transparent;color:var(--srp-text-muted);cursor:pointer;transition:all .15s;text-align:center}.srp-resolution-btn:first-child{border-right:none}.srp-resolution-btn--active{background:var(--srp-ink);border-color:var(--srp-ink);color:#fff}.srp-exchange-input{margin-top:8px}.srp-upload-area{margin-top:10px}.srp-upload-label{font-size:.72rem;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:var(--srp-body);margin-bottom:6px;display:block}.srp-upload-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;font-family:var(--srp-font-body);font-size:.78rem;font-weight:500;border:1px dashed var(--srp-border-strong);border-radius:0;background:transparent;color:var(--srp-text-muted);cursor:pointer;transition:border-color .15s,color .15s}.srp-upload-btn:hover{border-color:var(--srp-gold);color:var(--srp-gold)}.srp-upload-btn svg{width:14px;height:14px}.srp-upload-btn--uploading{opacity:.6;cursor:not-allowed}.srp-upload-previews{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.srp-upload-thumb{position:relative;width:56px;height:56px;overflow:hidden;border:1px solid var(--srp-border)}.srp-upload-thumb img{width:100%;height:100%;object-fit:cover}.srp-upload-thumb__remove{position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:#0009;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:10px;line-height:1;padding:0}.srp-upload-required{font-size:.72rem;color:var(--srp-gold);font-weight:500;margin-left:4px}.srp-summary-card{border:1px solid var(--srp-border);padding:1.25rem;margin-bottom:1.25rem}.srp-summary-card__label{font-family:var(--srp-font-body);font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.2em;color:var(--srp-gold);margin-bottom:1rem}.srp-summary-item{display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--srp-border);font-size:.85rem}.srp-summary-item:last-child{border-bottom:none;padding-bottom:0}.srp-summary-item:first-of-type{padding-top:0}.srp-summary-item__name{font-family:var(--srp-font-heading);font-weight:300;color:var(--srp-ink)}.srp-summary-item__badge{display:inline-block;font-family:var(--srp-font-body);font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding:2px 8px;margin-left:8px;border:1px solid var(--srp-border-strong);color:var(--srp-body)}.srp-summary-item__reason{font-size:.78rem;color:var(--srp-text-muted);margin-top:2px}.srp-summary-item__qty{font-size:.8rem;color:var(--srp-text-muted);flex-shrink:0}.srp-refund-card{background:var(--srp-warm);padding:1.25rem;margin-bottom:1.25rem}.srp-refund-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:.82rem}.srp-refund-row__label{color:var(--srp-text-muted);font-weight:400}.srp-refund-row__value{color:var(--srp-ink);font-weight:500}.srp-refund-row__value--large{font-family:var(--srp-font-heading);font-size:1.1rem;font-weight:300}.srp-refund-row__value--gold{color:var(--srp-gold);font-weight:600}.srp-notice{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--srp-border);padding:1rem 1.25rem;margin-bottom:1.75rem}.srp-notice__icon{flex-shrink:0;width:18px;height:18px;color:var(--srp-text-muted);margin-top:1px}.srp-notice__text{font-size:.78rem;color:var(--srp-text-muted);line-height:1.5}.srp-success{text-align:center;padding:3rem 2rem}.srp-success__icon-row{display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:2rem}.srp-success__icon-line{width:60px;height:1px;background:var(--srp-border)}.srp-success__icon{width:48px;height:48px;color:var(--srp-gold);flex-shrink:0}.srp-success__title{font-family:var(--srp-font-heading);font-size:2rem;font-weight:200;color:var(--srp-ink);margin-bottom:.6rem}.srp-success__subtitle{font-size:.85rem;font-weight:300;color:var(--srp-text-muted);margin-bottom:2rem;line-height:1.6}.srp-success__details{background:var(--srp-warm);padding:1.5rem;margin-bottom:2rem;text-align:left}.srp-success__detail-row{display:flex;justify-content:space-between;padding:6px 0;font-size:.82rem}.srp-success__detail-label{color:var(--srp-text-muted);font-weight:400}.srp-success__detail-value{color:var(--srp-ink);font-weight:600}.srp-success__buttons{display:flex;gap:12px}.srp-success__buttons .srp-btn{flex:1}@media(max-width:768px){.srp-title{font-size:2.2rem}.srp-eyebrow{font-size:.55rem}.srp-subtitle{font-size:.8rem}.srp-header,.srp-progress{margin-bottom:1.75rem}.srp-progress__dot{width:26px;height:26px;font-size:.65rem}.srp-progress__dot svg{width:11px;height:11px}.srp-progress__label{font-size:.6rem}.srp-progress__line{width:40px;margin-bottom:18px}.srp-item{padding:12px;gap:10px}.srp-item__image{width:52px;height:52px}.srp-item__title{font-size:.85rem}.srp-success{padding:2rem 1rem}.srp-success__title{font-size:1.6rem}.srp-success__buttons{flex-direction:column}.srp-refund-card,.srp-summary-card{padding:1rem}}\n";document.head.appendChild(s)})();(function(){"use strict";function X(){const d=document.querySelectorAll("script[src]");let y="",I="",b=!1;for(const n of d){const f=n;if(f.src.includes("returns-portal")){try{y=new URL(f.src).origin}catch{}I=f.getAttribute("data-brand")||"",b=f.hasAttribute("data-no-header");break}}return{backendUrl:y||"http://localhost:3001",brandSlug:I,noHeader:b}}function l(d){const y=document.createElement("span");return y.textContent=d,y.innerHTML}const Z=[{value:"defective",label:"Defective / Damaged"},{value:"wrong_item",label:"Wrong Item Received"},{value:"not_as_described",label:"Not as Described"},{value:"changed_mind",label:"Changed My Mind"},{value:"too_small",label:"Too Small"},{value:"too_large",label:"Too Large"},{value:"other",label:"Other"}];function x(d,y){window.__SRP_DEBUG&&window.parent!==window&&window.parent.postMessage({type:`srp:${d}`,data:y},"*")}const S={check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',checkCircle:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',upload:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',info:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',schedule:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',image:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'};function j(d,y,I,b,n,f){var M,H,V,W,G,J,K,Q;const E=(M=n==null?void 0:n.settings)!=null&&M.available_reasons?n.settings.available_reasons.map(o=>({value:o,label:n.settings.reason_labels[o]||o.replace(/_/g," ")})):Z,T=((H=n==null?void 0:n.settings)==null?void 0:H.portal_title)||"Start a Return",L=((V=n==null?void 0:n.settings)==null?void 0:V.portal_description)||"We make returns and exchanges simple. Enter your order details to get started.",q=b.buttonTextLookup||"Find My Order",F=b.buttonTextContinue||"Continue to Review",R=b.buttonTextSubmit||"Submit Return Request",z=b.stepLabels||["Find Order","Select Items","Confirm"],C=b.successTitle||"Return Request Submitted",ee=b.successMessage||"Your return request has been received.",se=b.successButtonText||"Continue Shopping",te=((W=n==null?void 0:n.settings)==null?void 0:W.return_window_days)||30,re=(((G=n==null?void 0:n.settings)==null?void 0:G.available_resolutions)||["refund","store_credit","exchange"]).includes("exchange"),A=((J=n==null?void 0:n.settings)==null?void 0:J.require_photos_for_reasons)||[],ne=((K=n==null?void 0:n.settings)==null?void 0:K.dimension_collection_enabled)??!1,ae=((Q=n==null?void 0:n.settings)==null?void 0:Q.collect_dimensions_for_reasons)||[];x("config_loaded",{settings:(n==null?void 0:n.settings)||null});const e={step:"lookup",loading:!1,error:null,orderNumber:"",email:"",order:null,items:[],selectedItems:new Map,uploadingFor:null,referenceId:null,resultStatus:null},U=I?`?brand=${I}`:"";function ie(){return e.step==="lookup"?T:e.step==="select_items"?"Select Items":e.step==="confirm"?"Review & Submit":""}function oe(){return e.step==="lookup"?L:e.step==="select_items"?"Choose the items you'd like to return or exchange.":e.step==="confirm"?"Please review your return details before submitting.":""}function le(){const o=[{num:1,label:z[0]||"Find Order",key:"lookup"},{num:2,label:z[1]||"Select Items",key:"select_items"},{num:3,label:z[2]||"Confirm",key:"confirm"}],u=["lookup","select_items","confirm","success"],h=u.indexOf(e.step);return`<div class="srp-progress">${o.map((v,m)=>{const r=h>u.indexOf(v.key),_=e.step===v.key,a=r?"srp-progress__step--done":_?"srp-progress__step--active":"",s=m<o.length-1?`<div class="srp-progress__line${r?" srp-progress__line--done":""}"></div>`:"",t=r?S.check:`${v.num}`;return`<div class="srp-progress__step ${a}">
        <div class="srp-progress__dot">${t}</div>
        <span class="srp-progress__label">${v.label}</span>
      </div>${s}`}).join("")}</div>`}function g(){if(e.step==="success"){ue();return}let o="";e.step==="lookup"?o=ce():e.step==="select_items"?o=de():e.step==="confirm"&&(o=pe());const u=f?"":`
        <div class="srp-header">
          <div class="srp-eyebrow">Returns & Exchanges</div>
          <h2 class="srp-title">${l(ie())}</h2>
          <p class="srp-subtitle">${l(oe())}</p>
        </div>`;d.innerHTML=`
      <div class="srp-wrap">
        ${u}
        ${le()}
        <div class="srp-divider"></div>
        ${e.error?`<div class="srp-error">${l(e.error)}</div>`:""}
        ${o}
      </div>`,me()}function ce(){return`
      <div class="srp-row">
        <div class="srp-field">
          <label class="srp-label">Order Number <span class="srp-required">*</span></label>
          <input class="srp-input" id="srp-order" placeholder="#1001" value="${l(e.orderNumber)}" />
        </div>
        <div class="srp-field">
          <label class="srp-label">Email Address <span class="srp-required">*</span></label>
          <input class="srp-input" id="srp-email" type="email" placeholder="you@email.com" value="${l(e.email)}" />
        </div>
      </div>
      <button class="srp-btn srp-btn--primary" id="srp-lookup" ${e.loading?"disabled":""}>
        ${e.loading?"Looking up order...":l(q)}
      </button>
      <div class="srp-policy">
        <div class="srp-policy__icon">${S.info}</div>
        <div class="srp-policy__text"><strong>${te}-Day Return Policy</strong> — Items must be in original condition with tags attached. Sale items and gift cards are final sale.</div>
      </div>`}function de(){const o=e.order,u=new Date(o.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),h=e.items.map(r=>{const _=e.selectedItems.has(r.id),a=e.selectedItems.get(r.id),s=r.eligible?_?"srp-item srp-item--selected":"srp-item":"srp-item srp-item--ineligible",t=_?S.check:"",c=r.image?`<img class="srp-item__image" src="${l(r.image)}" alt="${l(r.title)}" />`:`<div class="srp-item__image srp-item__image--placeholder">${S.image}</div>`;let i="";if(_&&a){const p=a.reason&&A.includes(a.reason);a.photoUrls.length>0;const k=e.uploadingFor===r.id,$=re?`
          <div class="srp-resolution-toggle">
            <button type="button" class="srp-resolution-btn ${a.resolutionType==="return"?"srp-resolution-btn--active":""}" data-resolution="${r.id}" data-type="return">Return</button>
            <button type="button" class="srp-resolution-btn ${a.resolutionType==="exchange"?"srp-resolution-btn--active":""}" data-resolution="${r.id}" data-type="exchange">Exchange</button>
          </div>
          ${a.resolutionType==="exchange"?`
            <input class="srp-input srp-exchange-input" data-exchange-variant="${r.id}" placeholder="Preferred size/color/variant for exchange" value="${l(a.exchangeVariant||"")}" />
          `:""}`:"",w=a.photoUrls.map((P,Y)=>`
          <div class="srp-upload-thumb">
            <img src="${l(P)}" alt="Upload ${Y+1}" />
            <button type="button" class="srp-upload-thumb__remove" data-remove-photo="${r.id}" data-photo-idx="${Y}">&times;</button>
          </div>`).join(""),D=`
          <div class="srp-upload-area">
            <span class="srp-upload-label">
              Photos${p?'<span class="srp-upload-required">(required for this reason)</span>':" (optional)"}
            </span>
            ${w?`<div class="srp-upload-previews">${w}</div>`:""}
            <button type="button" class="srp-upload-btn ${k?"srp-upload-btn--uploading":""}" data-upload-photo="${r.id}" ${k?"disabled":""}>
              ${S.upload}
              ${k?"Uploading...":"Upload Photo"}
            </button>
          </div>`,he=ne&&a.reason&&ae.includes(a.reason),O=a.packageDimensions||{length:"",width:"",height:"",weight:""},be=he?`
          <div class="srp-dimensions" style="margin-top:8px;padding:10px 12px;border-radius:6px;border:1px solid rgba(197,160,89,0.2);background:rgba(197,160,89,0.04);">
            <span class="srp-upload-label" style="display:block;margin-bottom:2px;">Package Dimensions <span class="srp-required">*</span></span>
            <span style="display:block;font-size:0.62rem;font-weight:300;color:rgba(45,51,56,0.5);margin-bottom:8px;">Used to generate a prepaid return label upon approval</span>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;">
              <div>
                <label style="display:block;font-size:10px;color:var(--srp-text-secondary,#666);margin-bottom:2px;">Length (in)</label>
                <input class="srp-input" type="number" step="0.1" min="0" data-dim-field="${r.id}" data-dim-key="length" value="${l(O.length)}" placeholder="0" style="padding:6px 8px;font-size:13px;" />
              </div>
              <div>
                <label style="display:block;font-size:10px;color:var(--srp-text-secondary,#666);margin-bottom:2px;">Width (in)</label>
                <input class="srp-input" type="number" step="0.1" min="0" data-dim-field="${r.id}" data-dim-key="width" value="${l(O.width)}" placeholder="0" style="padding:6px 8px;font-size:13px;" />
              </div>
              <div>
                <label style="display:block;font-size:10px;color:var(--srp-text-secondary,#666);margin-bottom:2px;">Height (in)</label>
                <input class="srp-input" type="number" step="0.1" min="0" data-dim-field="${r.id}" data-dim-key="height" value="${l(O.height)}" placeholder="0" style="padding:6px 8px;font-size:13px;" />
              </div>
              <div>
                <label style="display:block;font-size:10px;color:var(--srp-text-secondary,#666);margin-bottom:2px;">Weight (lbs)</label>
                <input class="srp-input" type="number" step="0.1" min="0" data-dim-field="${r.id}" data-dim-key="weight" value="${l(O.weight)}" placeholder="0" style="padding:6px 8px;font-size:13px;" />
              </div>
            </div>
          </div>`:"";i=`
          <div class="srp-item-reason">
            ${$}
            <label class="srp-label" style="margin-top:8px;">Reason <span class="srp-required">*</span></label>
            <select class="srp-select srp-reason-select" data-item-id="${r.id}">
              <option value="">Select a reason...</option>
              ${E.map(P=>`<option value="${P.value}" ${a.reason===P.value?"selected":""}>${P.label}</option>`).join("")}
            </select>
            <textarea class="srp-textarea" data-item-notes="${r.id}" placeholder="Additional details (optional)" rows="2">${l(a.notes||"")}</textarea>
            ${D}
            ${be}
          </div>`}return`
        <div class="${s}" data-item-toggle="${r.eligible?r.id:""}">
          <div class="srp-item__check">${t}</div>
          ${c}
          <div class="srp-item__info">
            <div class="srp-item__row">
              <div>
                <div class="srp-item__title">${l(r.title)}</div>
                ${r.variantTitle?`<div class="srp-item__variant">${l(r.variantTitle)}</div>`:""}
                <div class="srp-item__meta">
                  <span>Qty: ${r.quantity}</span>
                </div>
              </div>
              <div class="srp-item__price">${r.price}</div>
            </div>
            ${r.eligible?"":`<div class="srp-item__ineligible-reason">${l(r.eligibility_reason||"Not eligible for return")}</div>`}
            ${i}
          </div>
        </div>`}).join(""),v=e.selectedItems.size>0,m=Array.from(e.selectedItems.values()).every(r=>{var _;return!(!r.reason||A.includes(r.reason)&&r.photoUrls.length===0||r.resolutionType==="exchange"&&!((_=r.exchangeVariant)!=null&&_.trim()))});return`
      <button class="srp-back" id="srp-back-lookup">
        ← Back
      </button>
      <div class="srp-order-bar">
        <span class="srp-order-bar__left">Order ${l(o.name)}</span>
        <span class="srp-order-bar__right">${u} · ${l(o.fulfillmentStatus||"Processing")}</span>
      </div>
      <div class="srp-section-label">Select items to return or exchange</div>
      <div class="srp-items">${h}</div>
      <button class="srp-btn srp-btn--primary" id="srp-continue" ${!v||!m?"disabled":""}>
        ${l(F)}
      </button>`}function pe(){var a,s;const o=Array.from(e.selectedItems.values()),u=((a=n==null?void 0:n.settings)==null?void 0:a.restocking_fee_percent)??20,h=((s=n==null?void 0:n.settings)==null?void 0:s.restocking_fee_exempt_reasons)??["defective","wrong_item","not_as_described"];let v=0,m=0;for(const t of o){const c=e.items.find(k=>k.id===t.lineItemId);if(!c)continue;const i=parseFloat(c.price.replace(/[^0-9.]/g,""));if(isNaN(i))continue;const p=i*t.quantity;v+=p,h.includes(t.reason)||(m+=p*(u/100))}const r=v-m;return`
      <button class="srp-back" id="srp-back-items">
        ← Back
      </button>
      <div class="srp-summary-card">
        <div class="srp-summary-card__label">Return Summary</div>
        ${o.map(t=>{var $;const c=(($=E.find(w=>w.value===t.reason))==null?void 0:$.label)||t.reason,i=t.resolutionType==="exchange"?"Exchange":"Return",p=t.resolutionType==="exchange"&&t.exchangeVariant?` → ${l(t.exchangeVariant)}`:"",k=t.photoUrls.length>0?` · ${t.photoUrls.length} photo(s)`:"";return`
        <div class="srp-summary-item">
          <div>
            <div class="srp-summary-item__name">${l(t.title)}${t.variantTitle?` — ${l(t.variantTitle)}`:""}<span class="srp-summary-item__badge">${l(i)}</span></div>
            <div class="srp-summary-item__reason">${l(c)}${p}${t.notes?` — ${l(t.notes)}`:""}${k}</div>
          </div>
          <div class="srp-summary-item__qty">x${t.quantity}</div>
        </div>`}).join("")}
      </div>
      ${(()=>{const t=o.find(i=>i.packageDimensions&&(i.packageDimensions.length||i.packageDimensions.weight));if(!t||!t.packageDimensions)return"";const c=t.packageDimensions;return`
        <div style="border:1px solid rgba(19,19,20,0.06);padding:14px 18px;margin-bottom:16px;">
          <div style="font-size:0.65rem;font-weight:600;text-transform:uppercase;letter-spacing:0.2em;color:var(--srp-gold,#C5A059);margin-bottom:10px;">Package Dimensions</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;text-align:center;">
            <div style="background:var(--srp-surface,#F9F9FB);padding:8px 4px;">
              <div style="font-size:0.55rem;text-transform:uppercase;letter-spacing:0.08em;color:rgba(45,51,56,0.4);">Length</div>
              <div style="font-size:0.9rem;font-weight:500;color:var(--srp-ink,#131314);margin-top:2px;">${c.length}"</div>
            </div>
            <div style="background:var(--srp-surface,#F9F9FB);padding:8px 4px;">
              <div style="font-size:0.55rem;text-transform:uppercase;letter-spacing:0.08em;color:rgba(45,51,56,0.4);">Width</div>
              <div style="font-size:0.9rem;font-weight:500;color:var(--srp-ink,#131314);margin-top:2px;">${c.width}"</div>
            </div>
            <div style="background:var(--srp-surface,#F9F9FB);padding:8px 4px;">
              <div style="font-size:0.55rem;text-transform:uppercase;letter-spacing:0.08em;color:rgba(45,51,56,0.4);">Height</div>
              <div style="font-size:0.9rem;font-weight:500;color:var(--srp-ink,#131314);margin-top:2px;">${c.height}"</div>
            </div>
            <div style="background:var(--srp-surface,#F9F9FB);padding:8px 4px;">
              <div style="font-size:0.55rem;text-transform:uppercase;letter-spacing:0.08em;color:rgba(45,51,56,0.4);">Weight</div>
              <div style="font-size:0.9rem;font-weight:500;color:var(--srp-ink,#131314);margin-top:2px;">${c.weight} lbs</div>
            </div>
          </div>
          <div style="font-size:0.62rem;color:rgba(45,51,56,0.45);margin-top:8px;">These dimensions will be used to generate your prepaid return label upon approval.</div>
        </div>`})()}
      <div class="srp-refund-card">
        <div class="srp-refund-row">
          <span class="srp-refund-row__label">Item Total</span>
          <span class="srp-refund-row__value">$${v.toFixed(2)}</span>
        </div>
        ${m>0?`
        <div class="srp-refund-row">
          <span class="srp-refund-row__label">Restocking Fee (${u}%)</span>
          <span class="srp-refund-row__value" style="color:#dc2626;">−$${m.toFixed(2)}</span>
        </div>`:""}
        <div class="srp-refund-row">
          <span class="srp-refund-row__label">Estimated Refund</span>
          <span class="srp-refund-row__value srp-refund-row__value--large">$${r.toFixed(2)}</span>
        </div>
        <div class="srp-refund-row">
          <span class="srp-refund-row__label">Refund Method</span>
          <span class="srp-refund-row__value">Original payment method</span>
        </div>
        <div class="srp-refund-row">
          <span class="srp-refund-row__label">Return Shipping</span>
          <span class="srp-refund-row__value srp-refund-row__value--gold">Free</span>
        </div>
      </div>
      ${m>0?`
      <div class="srp-notice" style="border-color:rgba(197,160,89,0.2);">
        <div class="srp-notice__icon">${S.info}</div>
        <div class="srp-notice__text">A ${u}% restocking fee applies to items returned for reasons other than damage, defect, or wrong item received.</div>
      </div>`:""}
      <div class="srp-notice">
        <div class="srp-notice__icon">${S.schedule}</div>
        <div class="srp-notice__text">Refunds are typically processed within 5–10 business days after we receive your return.</div>
      </div>
      <button class="srp-btn srp-btn--dark" id="srp-submit" ${e.loading?"disabled":""}>
        ${e.loading?"Submitting...":l(R)}
      </button>`}function ue(){var s,t,c,i;const u=(e.referenceId||"").slice(0,8).toUpperCase(),h=e.resultStatus==="approved"?"Approved":e.resultStatus==="denied"?"Denied":"Under Review",v=((s=n==null?void 0:n.settings)==null?void 0:s.restocking_fee_percent)??20,m=((t=n==null?void 0:n.settings)==null?void 0:t.restocking_fee_exempt_reasons)??["defective","wrong_item","not_as_described"];let r=0,_=0;for(const p of Array.from(e.selectedItems.values())){const k=e.items.find(D=>D.id===p.lineItemId);if(!k)continue;const $=parseFloat(k.price.replace(/[^0-9.]/g,""));if(isNaN($))continue;const w=$*p.quantity;r+=w,m.includes(p.reason)||(_+=w*(v/100))}const a=r-_;d.innerHTML=`
      <div class="srp-wrap">
        <div class="srp-success">
          <div class="srp-success__icon-row">
            <div class="srp-success__icon-line"></div>
            <div class="srp-success__icon">${S.checkCircle}</div>
            <div class="srp-success__icon-line"></div>
          </div>
          <div class="srp-success__title">${l(C)}</div>
          <div class="srp-success__subtitle">
            ${l(ee)} We'll review your request and send next steps to <strong>${l(e.email)}</strong>. If approved, a prepaid return label will be included.
          </div>
          <div class="srp-success__details">
            <div class="srp-success__detail-row">
              <span class="srp-success__detail-label">Return ID</span>
              <span class="srp-success__detail-value">#${l(u)}</span>
            </div>
            <div class="srp-success__detail-row">
              <span class="srp-success__detail-label">Status</span>
              <span class="srp-success__detail-value">${l(h)}</span>
            </div>
            <div class="srp-success__detail-row">
              <span class="srp-success__detail-label">Refund Amount</span>
              <span class="srp-success__detail-value">$${a.toFixed(2)}</span>
            </div>
            <div class="srp-success__detail-row">
              <span class="srp-success__detail-label">Estimated Refund</span>
              <span class="srp-success__detail-value">5–10 business days</span>
            </div>
          </div>
          <div class="srp-success__buttons">
            <button class="srp-btn srp-btn--dark" id="srp-new">${l(se)}</button>
            <button class="srp-btn srp-btn--outline" id="srp-track">Track Return</button>
          </div>
        </div>
      </div>`,(c=d.querySelector("#srp-new"))==null||c.addEventListener("click",()=>{e.step="lookup",e.order=null,e.items=[],e.selectedItems=new Map,e.uploadingFor=null,e.orderNumber="",e.email="",e.referenceId=null,e.resultStatus=null,e.error=null,g()}),(i=d.querySelector("#srp-track"))==null||i.addEventListener("click",()=>{})}function me(){var v,m,r,_;const o=d.querySelector("#srp-lookup");o==null||o.addEventListener("click",B);const u=d.querySelector("#srp-order"),h=d.querySelector("#srp-email");u==null||u.addEventListener("input",()=>{e.orderNumber=u.value}),h==null||h.addEventListener("input",()=>{e.email=h.value}),[u,h].forEach(a=>{a==null||a.addEventListener("keydown",s=>{s.key==="Enter"&&B()})}),(v=d.querySelector("#srp-back-lookup"))==null||v.addEventListener("click",()=>{e.step="lookup",e.error=null,g()}),d.querySelectorAll("[data-item-toggle]").forEach(a=>{const s=a.dataset.itemToggle;s&&a.addEventListener("click",t=>{if(!t.target.closest(".srp-item-reason")){if(e.selectedItems.has(s))e.selectedItems.delete(s);else{const i=e.items.find(p=>p.id===s);i&&e.selectedItems.set(s,{lineItemId:s,title:i.title,variantTitle:i.variantTitle,quantity:i.quantity,reason:"",photoUrls:[],resolutionType:"return"})}g()}})}),d.querySelectorAll(".srp-reason-select").forEach(a=>{a.addEventListener("change",s=>{const t=s.target,c=t.dataset.itemId,i=e.selectedItems.get(c);i&&(i.reason=t.value,g())})}),d.querySelectorAll("[data-item-notes]").forEach(a=>{a.addEventListener("input",s=>{const t=s.target,c=t.dataset.itemNotes,i=e.selectedItems.get(c);i&&(i.notes=t.value)})}),d.querySelectorAll("[data-resolution]").forEach(a=>{a.addEventListener("click",s=>{s.stopPropagation();const t=s.currentTarget,c=t.dataset.resolution,i=t.dataset.type,p=e.selectedItems.get(c);p&&(p.resolutionType=i,i!=="exchange"&&(p.exchangeVariant=void 0),g())})}),d.querySelectorAll("[data-exchange-variant]").forEach(a=>{a.addEventListener("click",s=>s.stopPropagation()),a.addEventListener("input",s=>{const t=s.target,c=t.dataset.exchangeVariant,i=e.selectedItems.get(c);i&&(i.exchangeVariant=t.value,ve())})}),d.querySelectorAll("[data-upload-photo]").forEach(a=>{a.addEventListener("click",s=>{s.stopPropagation();const c=s.currentTarget.dataset.uploadPhoto,i=document.createElement("input");i.type="file",i.accept="image/jpeg,image/png,image/webp,image/gif",i.multiple=!0,i.onchange=async()=>{const p=i.files;if(!(!p||p.length===0)){e.uploadingFor=c,g();for(const k of Array.from(p))try{const $=await fetch(`${y}/api/returns/upload${U}`,{method:"POST",headers:{"Content-Type":k.type},body:k});if($.ok){const w=await $.json(),D=e.selectedItems.get(c);D&&w.url&&D.photoUrls.push(w.url)}}catch{}e.uploadingFor=null,g()}},i.click()})}),d.querySelectorAll("[data-remove-photo]").forEach(a=>{a.addEventListener("click",s=>{s.stopPropagation();const t=s.currentTarget,c=t.dataset.removePhoto,i=parseInt(t.dataset.photoIdx||"0",10),p=e.selectedItems.get(c);p&&(p.photoUrls.splice(i,1),g())})}),d.querySelectorAll("[data-dim-field]").forEach(a=>{a.addEventListener("click",s=>s.stopPropagation()),a.addEventListener("input",s=>{const t=s.target,c=t.dataset.dimField,i=t.dataset.dimKey,p=e.selectedItems.get(c);p&&(p.packageDimensions||(p.packageDimensions={length:"",width:"",height:"",weight:""}),p.packageDimensions[i]=t.value)})}),(m=d.querySelector("#srp-continue"))==null||m.addEventListener("click",()=>{if(!Array.from(e.selectedItems.values()).every(s=>{var t;return!(!s.reason||A.includes(s.reason)&&s.photoUrls.length===0||s.resolutionType==="exchange"&&!((t=s.exchangeVariant)!=null&&t.trim()))})){e.error="Please complete all required fields for each item.",g();return}e.step="confirm",e.error=null,x("step_change",{step:"confirm"}),g()}),(r=d.querySelector("#srp-back-items"))==null||r.addEventListener("click",()=>{e.step="select_items",e.error=null,g()}),(_=d.querySelector("#srp-submit"))==null||_.addEventListener("click",ge)}function ve(){const o=d.querySelector("#srp-continue");if(!o)return;const u=e.selectedItems.size>0,h=Array.from(e.selectedItems.values()).every(v=>{var m;return!(!v.reason||A.includes(v.reason)&&v.photoUrls.length===0||v.resolutionType==="exchange"&&!((m=v.exchangeVariant)!=null&&m.trim()))});o.disabled=!u||!h}async function B(){var h;const o=e.orderNumber.trim().replace(/^#/,""),u=e.email.trim();if(!o||!u){e.error="Please enter both your order number and email address.",g();return}if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)){e.error="Please enter a valid email address.",g();return}if(e.loading=!0,e.error=null,g(),window.__SRP_DEBUG){e.order={id:"gid://shopify/Order/mock-001",name:`#${o||"1042"}`,createdAt:new Date(Date.now()-7200*60*1e3).toISOString(),financialStatus:"PAID",fulfillmentStatus:"FULFILLED"},e.items=[{id:"mock-li-1",title:"Classic Crew-Neck Tee",variantTitle:"Black / M",quantity:1,price:"$34.99",image:"",eligible:!0},{id:"mock-li-2",title:"Slim Joggers",variantTitle:"Navy / L",quantity:1,price:"$64.99",image:"",eligible:!0},{id:"mock-li-3",title:"Limited Edition Cap",quantity:1,price:"$24.99",image:"",eligible:!1,eligibility_reason:"Final sale item — not eligible for return"}],e.selectedItems=new Map,e.step="select_items",e.loading=!1,x("order_loaded",{order_name:e.order.name,item_count:e.items.length,eligible_count:e.items.filter(v=>v.eligible).length,mock:!0}),x("step_change",{step:"select_items"}),g();return}try{const v=await fetch(`${y}/api/returns/lookup?order_number=${encodeURIComponent(o)}&email=${encodeURIComponent(u)}${U?"&"+U.slice(1):""}`);if(!v.ok){const r=await v.json().catch(()=>({error:"Order not found"}));e.error=r.error||"Order not found. Please check your order number and email.",e.loading=!1,g();return}const m=await v.json();e.order=m.order,e.items=m.items||[],e.selectedItems=new Map,e.step="select_items",e.loading=!1,x("order_loaded",{order_name:(h=m.order)==null?void 0:h.name,item_count:e.items.length,eligible_count:e.items.filter(r=>r.eligible).length}),x("step_change",{step:"select_items"}),e.items.length===0?(e.error="No items found in this order.",e.step="lookup"):e.items.some(r=>r.eligible)||(e.error="This order is not yet eligible for return. If your order hasn't shipped yet, you can reach out to our support team via the chat for assistance with changes or cancellations.",e.step="lookup"),g()}catch{e.error="Network error. Please check your connection and try again.",e.loading=!1,g()}}async function ge(){var _,a;if(e.loading=!0,e.error=null,g(),window.__SRP_DEBUG){const s="dbg-"+Math.random().toString(36).slice(2,10);e.referenceId=s,e.resultStatus="approved",e.step="success",e.loading=!1,x("submit_result",{status:"approved",ref_id:s,mock:!0,ai_recommendation:{decision:"approve",confidence:.92,reasoning:"Debug mock — auto-approved",suggested_resolution:"refund"}}),x("step_change",{step:"success"}),g();return}const o=Array.from(e.selectedItems.values()).map(s=>{var i;const t=e.items.find(p=>p.id===s.lineItemId),c=((i=t==null?void 0:t.price)==null?void 0:i.replace(/[^0-9.]/g,""))||"0";return{line_item_id:s.lineItemId,product_title:s.title,variant_title:s.variantTitle||null,product_image_url:(t==null?void 0:t.image)||null,quantity:s.quantity,price:parseFloat(c)||0,reason:s.reason,reason_details:s.notes||null,photo_urls:s.photoUrls.length>0?s.photoUrls:null,resolution_type:s.resolutionType==="exchange"?"exchange":null,exchange_variant:s.resolutionType==="exchange"&&s.exchangeVariant||null}}),u=o.some(s=>s.resolution_type==="exchange"),h=o.every(s=>s.resolution_type==="exchange"),m=Array.from(e.selectedItems.values()).find(s=>s.packageDimensions&&(s.packageDimensions.length||s.packageDimensions.width||s.packageDimensions.height||s.packageDimensions.weight)),r=m!=null&&m.packageDimensions?{length:parseFloat(m.packageDimensions.length)||0,width:parseFloat(m.packageDimensions.width)||0,height:parseFloat(m.packageDimensions.height)||0,weight:parseFloat(m.packageDimensions.weight)||0}:null;try{const s=await fetch(`${y}/api/returns/submit${U}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({order_id:e.order.id,order_number:e.order.name,customer_email:e.email.trim(),customer_name:null,resolution_type:h||u?"exchange":null,items:o,package_dimensions:r})}),t=await s.json();if(!s.ok){e.error=t.error||"Failed to submit return request. Please try again.",e.loading=!1,g();return}e.referenceId=((_=t.return_request)==null?void 0:_.id)||"",e.resultStatus=t.status||"pending_review",e.step="success",e.loading=!1,x("submit_result",{status:t.status,ref_id:e.referenceId,ai_recommendation:((a=t.return_request)==null?void 0:a.ai_recommendation)||null}),x("step_change",{step:"success"}),g()}catch{e.error="Network error. Please check your connection and try again.",e.loading=!1,g()}}g(),window.addEventListener("message",o=>{var u;if(((u=o.data)==null?void 0:u.type)==="srp:design_update"&&o.data.design){const h={...b,...o.data.design};Object.assign(b,h),g()}})}async function N(){const{backendUrl:d,brandSlug:y,noHeader:I}=X(),b=window.__SRP_CONFIG;let n={primaryColor:"#C5A059",backgroundColor:"#F9F9FB",borderRadius:"sharp",fontSize:"medium"},f=null;b&&(b.widgetDesign&&(n={...n,...b.widgetDesign}),b.portalConfig&&(f=b.portalConfig,f!=null&&f.design&&(n={...n,...f.design}))),x("step_change",{step:"lookup"});const E=document.getElementById("returns-portal")||(()=>{const T=document.createElement("div");return T.id="returns-portal",document.body.appendChild(T),T})();if(j(E,d,y,n,f,I),!b){const T=y?"?brand="+y:"";Promise.all([fetch(`${d}/api/widget/config${T}`).catch(()=>null),fetch(`${d}/api/returns/portal-config${T}`).catch(()=>null)]).then(async([L,q])=>{let F=!1;if(L!=null&&L.ok)try{const R=await L.json();R.design&&(Object.assign(n,R.design),F=!0)}catch{}if(q!=null&&q.ok)try{f=await q.json(),f!=null&&f.design&&(Object.assign(n,f.design),F=!0)}catch{}F&&(E.innerHTML="",j(E,d,y,n,f,I))}).catch(()=>{})}}window.init=N,document.readyState==="loading"?document.addEventListener("DOMContentLoaded",N):N()})();
