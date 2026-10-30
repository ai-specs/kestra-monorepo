import assert from 'node:assert/strict'
import {randomBytes,createHash} from 'node:crypto'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {ApplicationGroupManagement} from './application-project-fixture.mjs'
import {classifyAccessControlDiagnostics} from './access-control-browser-diagnostics.mjs'

// All published locales remain required for static translations and host SDK audit.
export const accessControlSupportedLocales=Object.freeze(['en','de','es','fr','hi','it','ja','ko','pl','pt','pt_BR','ru','zh_CN'])
// Maintainer ruling 2026-10-30: full business browser coverage in English/Chinese.
export const accessControlLocales=Object.freeze(['en','zh_CN'])
export const accessControlThemes=Object.freeze(['light','dark','dark-2','system'])
export const accessControlWidths=Object.freeze([1280,768,390])
export const accessControlNativeSelectNoMatch=Object.freeze({
  en:'No matching data',de:'Nichts gefunden.',es:'No hay datos que coincidan',fr:'Aucune correspondance',
  hi:'कोई मैचिंग डेटा नहीं है',it:'Nessuna corrispondenza',ja:'データなし',ko:'검색된 데이터 없음',
  pl:'Brak dopasowań',pt:'Sem correspondência',pt_BR:'Sem resultados',ru:'Совпадений не найдено',zh_CN:'无匹配数据',
})
export const accessControlAndFilterText=Object.freeze({
  en:'This list requires all conditions to match (AND). Condition groups and OR are unavailable.',
  de:'Alle Bedingungen müssen zutreffen (AND). Bedingungsgruppen und OR sind nicht verfügbar.',
  es:'Deben cumplirse todas las condiciones (AND). Los grupos y OR no están disponibles.',
  fr:'Toutes les conditions doivent correspondre (AND). Les groupes et OR sont indisponibles.',
  hi:'सभी शर्तें पूरी होनी चाहिए (AND)। शर्त समूह और OR उपलब्ध नहीं हैं।',
  it:'Tutte le condizioni devono corrispondere (AND). Gruppi e OR non sono disponibili.',
  ja:'すべての条件を満たす必要があります（AND）。条件グループとORは使用できません。',
  ko:'모든 조건을 충족해야 합니다(AND). 조건 그룹과 OR는 사용할 수 없습니다.',
  pl:'Wszystkie warunki muszą być spełnione (AND). Grupy i OR są niedostępne.',
  pt:'Todas as condições devem corresponder (AND). Grupos e OR não estão disponíveis.',
  pt_BR:'Todas as condições devem corresponder (AND). Grupos e OR não estão disponíveis.',
  ru:'Все условия должны выполняться (AND). Группы и OR недоступны.',
  zh_CN:'此列表要求全部条件同时满足（AND），不支持条件组或OR。',
})
export const accessControlUiText=Object.freeze(Object.fromEntries([
  ['en','No records','Discard unsaved changes?','Access denied',"You don't have the required permissions to access this page.",'Login'],
  ['de','Keine Einträge','Ungespeicherte Änderungen verwerfen?','Zugriff verweigert','Du hast nicht die erforderlichen Berechtigungen für diese Seite.','Anmelden'],
  ['es','No hay registros','¿Descartar los cambios sin guardar?','Acceso denegado','No tienes los permisos necesarios para acceder a esta página.','Iniciar sesión'],
  ['fr','Aucun enregistrement','Abandonner les modifications non enregistrées ?','Accès refusé',"Vous n'avez pas les permissions suffisantes pour accéder à cette page.",'Connexion'],
  ['hi','कोई रिकॉर्ड नहीं','बिना सहेजे बदलाव छोड़ें?','पहुँच अस्वीकृत','इस पृष्ठ तक पहुँचने के लिए आपके पास आवश्यक अनुमतियाँ नहीं हैं।','लॉगिन'],
  ['it','Nessun record','Scartare le modifiche non salvate?','Accesso negato','Non hai i permessi necessari per accedere a questa pagina.','Accedi'],
  ['ja','データがありません','未保存の変更を破棄しますか？','アクセス拒否','このページにアクセスするための権限がありません。','ログイン'],
  ['ko','기록이 없습니다','저장하지 않은 변경 사항을 버리시겠습니까?','접근 거부됨','이 페이지에 접근할 권한이 없습니다.','로그인'],
  ['pl','Brak rekordów','Odrzucić niezapisane zmiany?','Dostęp zabroniony','Nie masz wymaganych uprawnień, aby uzyskać dostęp do tej strony.','Zaloguj się'],
  ['pt','Sem registos','Descartar alterações não guardadas?','Acesso negado','Você não tem as permissões necessárias para acessar esta página.','Login'],
  ['pt_BR','Nenhum registro','Descartar alterações não salvas?','Acesso negado','Você não tem as permissões necessárias para acessar esta página.','Login'],
  ['ru','Нет записей','Отменить несохранённые изменения?','Доступ запрещен','У вас нет необходимых прав для доступа к этой странице.','Войти'],
  ['zh_CN','暂无记录','丢弃未保存的更改？','访问被拒绝','你没有访问此页面所需的权限。','登录'],
].map(([locale,noRows,discardTitle,deniedTitle,deniedContent,login])=>[locale,Object.freeze({noRows,discardTitle,deniedTitle,deniedContent,login})])))
export const accessControlErrorText=Object.freeze(Object.fromEntries([
  ['en','The operation failed. Check the form and try again.','This record changed. Reload and review before saving.','Invalid username or password. Make sure your credentials are correct.'],
  ['de','Der Vorgang ist fehlgeschlagen. Prüfen Sie das Formular und versuchen Sie es erneut.','Dieser Datensatz wurde geändert. Vor dem Speichern neu laden und prüfen.','Ungültiger Benutzername oder ungültiges Passwort. Prüfe, ob deine Anmeldedaten korrekt sind.'],
  ['es','La operación falló. Revise el formulario e inténtelo de nuevo.','Este registro cambió. Recargue y revise antes de guardar.','Nombre de usuario o contraseña inválidos. Asegúrate de que tus credenciales sean correctas.'],
  ['fr','L’opération a échoué. Vérifiez le formulaire et réessayez.','Cet enregistrement a changé. Rechargez et vérifiez avant d’enregistrer.',"Nom d'utilisateur ou mot de passe invalide. Assurez-vous que vos identifiants sont corrects."],
  ['hi','कार्रवाई विफल हुई। फ़ॉर्म जाँचें और फिर कोशिश करें।','यह रिकॉर्ड बदल गया है। सहेजने से पहले पुनः लोड करके जाँचें।','अमान्य उपयोगकर्ता नाम या पासवर्ड। सुनिश्चित करें कि आपके प्रमाण-पत्र सही हैं।'],
  ['it','Operazione non riuscita. Controlla il modulo e riprova.','Questo record è cambiato. Ricarica e verifica prima di salvare.','Nome utente o password non validi. Assicurati che le tue credenziali siano corrette.'],
  ['ja','操作に失敗しました。フォームを確認して再試行してください。','このレコードは変更されました。保存前に再読込して確認してください。','ユーザー名またはパスワードが無効です。資格情報が正しいことを確認してください。'],
  ['ko','작업에 실패했습니다. 양식을 확인한 후 다시 시도하세요.','이 레코드가 변경되었습니다. 저장 전에 다시 불러와 검토하세요.','잘못된 사용자 이름 또는 비밀번호입니다. 자격 증명이 올바른지 확인하세요.'],
  ['pl','Operacja nie powiodła się. Sprawdź formularz i spróbuj ponownie.','Ten rekord się zmienił. Przed zapisem odśwież i sprawdź.','Nieprawidłowa nazwa użytkownika lub hasło. Upewnij się, że Twoje poświadczenia są poprawne.'],
  ['pt','A operação falhou. Verifique o formulário e tente novamente.','Este registo mudou. Recarregue e reveja antes de guardar.','Nome de usuário ou senha inválidos. Certifique-se de que suas credenciais estão corretas.'],
  ['pt_BR','A operação falhou. Confira o formulário e tente novamente.','Este registro mudou. Recarregue e revise antes de salvar.','Nome de usuário ou senha inválidos. Certifique-se de que suas credenciais estão corretas.'],
  ['ru','Операция не выполнена. Проверьте форму и повторите попытку.','Эта запись изменена. Перезагрузите и проверьте перед сохранением.','Неверное имя пользователя или пароль. Убедитесь, что ваши учетные данные верны.'],
  ['zh_CN','操作失败。请检查表单后重试。','记录已变化。请重新加载并核对后保存。','用户名或密码无效。请确保您的凭据正确。'],
].map(([locale,error,conflict,incorrectCredentials])=>[locale,Object.freeze({error,conflict,incorrectCredentials})])))
export const accessControlExternalRequirements=Object.freeze({
  'ui-503-retry-no-side-effects':['real-dependency-failure','draft-retained','no-automatic-post-retry','explicit-retry-after-recovery','database-queue-storage-unchanged'],
})
export function nativeStyleSettlementSample({selectors,shadow,observation}) {
  const host=document.querySelector('[data-test="extension-container"]'),root=shadow?host?.shadowRoot:document
  const state=window[observation]??={stable:0,previous:null,last:null}
  const fail=(reason,details={})=>{state.stable=0;state.last={reason,...details};return false}
  if(!root)return fail('root-not-mounted')
  if(document.fonts?.status==='loading')return fail('native-fonts-loading')
  const theme=node=>node.classList.contains('dark-2')?'dark-2':node.classList.contains('dark')?'dark':'light'
  if(shadow&&['light','dark','dark-2'].some(name=>host.classList.contains(name))&&theme(host)!==theme(document.documentElement))return fail('host-theme-context-not-updated',{hostTheme:theme(host),documentTheme:theme(document.documentElement)})
  const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(1,1):document.createElement('canvas'),colors=canvas.getContext('2d')
  const color=value=>{colors.fillStyle='#010203';colors.fillStyle=value;return colors.fillStyle}
  const samples=[]
  for(const selector of Object.values(selectors)) {
    const node=root.querySelector(selector)
    if(!node?.getClientRects().length)return fail('native-element-not-visible: '+selector)
    const nodes=new Set([node,...node.querySelectorAll('.kel-drawer,.el-drawer,.kel-dialog,.el-dialog')])
    for(let ancestor=node.parentElement??node.getRootNode()?.host;ancestor;ancestor=ancestor.parentElement??ancestor.getRootNode()?.host)nodes.add(ancestor)
    for(const current of nodes) {
      const animations=current.getAnimations?.({subtree:current===node})??[]
      if(animations.some(animation=>{const timing=animation.effect?.getComputedTiming();return timing?.endTime!==Infinity&&(animation.pending||['running','paused'].includes(animation.playState))}))return fail('native-finite-animation-or-transition-running: '+selector,{background:getComputedStyle(current).backgroundColor,drawerToken:getComputedStyle(current).getPropertyValue('--kel-drawer-bg-color'),dialogToken:getComputedStyle(current).getPropertyValue('--kel-dialog-bg-color')})
      if(current.matches('.kel-drawer,.el-drawer,.kel-dialog,.el-dialog')) {
        const style=getComputedStyle(current),kind=current.matches('.kel-drawer,.el-drawer')?'drawer':'dialog',namespace=current.classList.contains('kel-'+kind)?'kel':'el'
        const target=style.getPropertyValue('--'+namespace+'-'+kind+'-bg-color').trim()
        if(target&&CSS.supports('color',target)&&color(style.backgroundColor)!==color(target))return fail('native-background-has-not-reached-computed-token: '+selector,{background:style.backgroundColor,target,component:namespace+'-'+kind})
      }
    }
    const style=getComputedStyle(node),box=node.getBoundingClientRect()
    samples.push({selector,color:style.color,background:style.backgroundColor,border:style.borderColor,opacity:style.opacity,transform:style.transform,font:style.fontFamily,fontSize:style.fontSize,left:box.left,top:box.top,width:box.width,height:box.height})
  }
  const serialized=JSON.stringify(samples)
  state.stable=serialized===state.previous?state.stable+1:1;state.previous=serialized;state.last={samples,stable:state.stable,timeOrigin:performance.timeOrigin}
  return state.stable>=3
}
export async function waitForNativeStyleSettlement(page,selectors,{shadow=true}={}) {
  const observation='ui-native-styles-'+randomBytes(8).toString('hex')
  try {
    await page.waitForFunction(nativeStyleSettlementSample,{selectors,shadow,observation})
    return await page.evaluate(observation=>window[observation]?.last,observation)
  }catch(error) {
    error.nativeStyleSettlement=await page.evaluate(observation=>window[observation]?.last??null,observation).catch(()=>null)
    throw error
  }finally{await page.evaluate(observation=>{delete window[observation]},observation).catch(()=>{})}
}
const host='[data-test="extension-container"]'
const api='/api/v1/main/extensions/rbac'
export function discardConfirmationVisible() {
  const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot
  return [...root?.querySelectorAll('[data-test="discard-confirm"]')??[]].filter(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'&&!node.closest('[inert],[aria-hidden="true"]')).length===1
}
export function nativeDrawerHeaderPoint({shadow=true,action='close',readyOnly=false}={}) {
  try {
  if(!['close','expand'].includes(action))throw new Error('Unknown native drawer header action')
  const host=document.querySelector('[data-test="extension-container"]'),root=shadow?host?.shadowRoot:document
  const selector=action==='close'?'.kel-drawer__close-btn':'.kel-drawer__header button.is-link'
  const buttons=[...root?.querySelectorAll(selector)??[]].filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'&&n.getBoundingClientRect().width>0)
  if(buttons.length!==1)throw new Error('Exactly one visible native drawer header action is required')
  const button=buttons[0],r=button.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2
  if(button.disabled||button.getAttribute('aria-disabled')==='true'||button.closest('[inert]')||r.height<=0||x<0||x>=innerWidth||y<0||y>=innerHeight)throw new Error('Native drawer header action is disabled, inert or outside the viewport')
  if(shadow&&document.elementFromPoint(x,y)!==host)throw new Error('Native drawer header action is covered outside its owner')
  const hit=root.elementFromPoint(x,y)
  if(!hit||hit!==button&&!button.contains(hit))throw new Error('Native drawer header action is not the actual hit-test target')
  return {x,y,action,shadow,rect:{left:r.left,top:r.top,width:r.width,height:r.height}}
  }catch(error){if(readyOnly)return false;throw error}
}
export function nativeDrawerMeasurements({shadow=false,kind}={}) {
  const root=shadow?document.querySelector('[data-test="extension-container"]')?.shadowRoot:document
  const drawers=[...root?.querySelectorAll(kind?'[data-test="drawer-'+kind+'"]':'.kel-drawer')??[]].filter(n=>n.getClientRects().length&&n.getBoundingClientRect().width>0)
  if(drawers.length!==1)throw new Error('Exactly one visible native form drawer is required')
  const drawer=drawers[0],rect=node=>{const b=node.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}}
  const style=node=>{const s=getComputedStyle(node);return Object.fromEntries(['paddingTop','paddingRight','paddingBottom','paddingLeft','fontFamily','fontSize','fontWeight','color','backgroundColor'].map(k=>[k,s[k]]))}
  const header=drawer.querySelector('.kel-drawer__header'),body=drawer.querySelector('.kel-drawer__body'),footer=drawer.querySelector('.kel-drawer__footer'),expand=header?.querySelector('button.is-link'),close=header?.querySelector('.kel-drawer__close-btn')
  if(!header||!body||!footer||!expand||!close)throw new Error('Native header/body/footer/SVG action controls missing')
  const saveButton=footer.querySelector('button.kel-button--primary'),saveIcon=saveButton?.querySelector(':scope > .kel-icon'),saveLabel=saveButton?.querySelector(':scope > span')
  const save={nativeIcon:Boolean(saveIcon?.querySelector('svg path')),gap:saveIcon&&saveLabel?saveLabel.getBoundingClientRect().left-saveIcon.getBoundingClientRect().right:null,paths:[...saveIcon?.querySelectorAll('svg path')??[]].map(n=>n.getAttribute('d'))}
  return {viewport:{width:innerWidth,height:innerHeight},drawer:rect(drawer),header:{style:style(header),rect:rect(header)},body:{style:style(body),rect:rect(body)},footer:{style:style(footer),rect:rect(footer)},save,icons:{expand:[...expand.querySelectorAll('svg path')].map(n=>n.getAttribute('d')),close:[...close.querySelectorAll('svg path')].map(n=>n.getAttribute('d'))},buttons:{expand:rect(expand),close:rect(close)},nativeForm:Boolean(body.querySelector('.kel-form.ks-horizontal')),fields:[...body.querySelectorAll('input,textarea')].filter(n=>n.getClientRects().length).map(n=>({tag:n.tagName,rightGap:drawer.getBoundingClientRect().right-n.getBoundingClientRect().right}))}
}
export function cardHeadingMeasurements() {
  const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot
  return [...root?.querySelectorAll('[data-test="group-card"]')??[]].filter(n=>n.getClientRects().length).map(card=>{
    const heading=card.querySelector('.rbac-card-heading'),title=heading?.querySelector('.application-group-card-title'),name=heading?.querySelector('.application-group-card-id'),badge=heading?.querySelector('.builtin-indicator')
    if(!heading||!title||!name)throw new Error('Owned vertical card heading is missing')
    const a=title.getBoundingClientRect(),b=name.getBoundingClientRect(),c=badge?.getBoundingClientRect()
    return {id:card.getAttribute('data-group-id'),title:title.textContent.trim(),name:name.textContent.trim(),nameGap:b.top-a.bottom,badgeGap:c?c.top-b.bottom:null,vertical:getComputedStyle(heading).flexDirection==='column'}
  })
}
export function cardCountSpacingMeasurements() {
  const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot
  return [...root?.querySelectorAll('[data-test="group-card"] .rbac-card-counts button')??[]].filter(n=>n.getClientRects().length).map(button=>{
    const count=button.querySelector('b'),label=button.querySelector('.rbac-card-count-label')
    if(!count||!label)throw new Error('Owned count/label semantic wrapper missing')
    const text=[...label.childNodes].find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());if(!text)throw new Error('Accessible count unit text missing')
    const range=document.createRange();range.setStart(text,text.textContent.search(/\S/));range.setEnd(text,text.textContent.length)
    return {text:button.textContent.trim(),count:count.textContent.trim(),gap:range.getBoundingClientRect().left-count.getBoundingClientRect().right,token:parseFloat(getComputedStyle(label).columnGap),control:button.getAttribute('data-test')}
  })
}
export function mobileFilterViewportReady() {
  const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot
  const bar=root?.querySelector('.mobile-bar'),sheet=root?.querySelector('.mobile-sheet')
  if(!bar||!sheet||sheet.getAnimations().some(animation=>animation.playState==='running'))return false
  const a=bar.getBoundingClientRect(),b=sheet.getBoundingClientRect(),v=visualViewport
  const left=(v?.offsetLeft??0)+8,top=(v?.offsetTop??0)+8,right=(v?.offsetLeft??0)+(v?.width??innerWidth)-8,bottom=(v?.offsetTop??0)+(v?.height??innerHeight)-8
  if(b.height<=0||b.width<=0||b.left<left-2||b.right>right+2||b.top<top-2||b.bottom>bottom+2||parseFloat(getComputedStyle(sheet).maxHeight)<=0)return false
  const expectedWidth=Math.max(1,Math.min(a.width,right-left)),expectedLeft=Math.min(Math.max(a.left,left),right-expectedWidth)
  if(Math.abs(b.width-expectedWidth)>2||Math.abs(b.left-expectedLeft)>2)return false
  const desired=Math.min(sheet.scrollHeight,(v?.height??innerHeight)*.75,bottom-top)
  if(a.bottom>=top&&bottom-a.bottom-8>=desired)return Math.abs(b.top-a.bottom-8)<=3
  if(a.top<=bottom&&a.top-8-top>=desired)return Math.abs(b.top-Math.max(top,a.top-8-desired))<=3
  return true // Exact owned width and visible viewport clamp already checked above.
}
export function desktopFilterViewportReady() {
  const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot,panel=root?.querySelector('.adv-builder'),anchor=root?.querySelector('.customize-button')
  if(!panel||!anchor||panel.getAnimations().some(animation=>animation.playState==='running'))return false
  const a=anchor.getBoundingClientRect(),b=panel.getBoundingClientRect(),v=visualViewport
  const left=(v?.offsetLeft??0)+8,top=(v?.offsetTop??0)+8,right=(v?.offsetLeft??0)+(v?.width??innerWidth)-8,bottom=(v?.offsetTop??0)+(v?.height??innerHeight)-8
  if(b.height<=0||b.width<=0||b.top<top-2||b.bottom>bottom+2||b.left<left-2||b.right>right+2||parseFloat(getComputedStyle(panel).maxHeight)<=0)return false
  const expectedLeft=Math.min(Math.max(a.left,left),Math.max(left,right-b.width))
  if(Math.abs(b.left-expectedLeft)>2)return false
  const desired=Math.min(panel.scrollHeight,(v?.height??innerHeight)*.7,bottom-top)
  if(a.bottom>=top&&bottom-a.bottom-6>=desired)return Math.abs(b.top-a.bottom-6)<=3
  if(a.top<=bottom&&a.top-6-top>=desired)return Math.abs(b.top-Math.max(top,a.top-6-desired))<=3
  return true
}
export function desktopFilterBoundaryScroll(previous) {
  const anchor=document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('.customize-button')
  if(!anchor)throw new Error('Owned desktop filter trigger is absent')
  const ancestors=[]
  for(let node=anchor;node;node=node.parentElement??node.getRootNode()?.host??null)ancestors.push(node)
  if(previous) {
    const node=ancestors[previous.index]
    if(!node||node.tagName!==previous.tagName||node.id!==previous.id)throw new Error('Filter scroll owner changed before restoration')
    node.scrollTo({top:previous.top,left:previous.left,behavior:'instant'})
    return {restored:true}
  }
  const bottom=anchor.getBoundingClientRect().bottom,targetBottom=innerHeight-20
  for(const [index,node]of ancestors.entries()) {
    const style=getComputedStyle(node)
    if(node!==document.scrollingElement&&!/(auto|scroll)/.test(style.overflowY))continue
    const top=node.scrollTop+bottom-targetBottom,maximum=node.scrollHeight-node.clientHeight
    if(maximum<=0||top<0||top>maximum)continue
    const result={index,tagName:node.tagName,id:node.id,top:node.scrollTop,left:node.scrollLeft,targetBottom,stimulus:'explicit existing host-layout scroll; no style or business-state mutation'}
    node.scrollTo({top,left:node.scrollLeft,behavior:'instant'})
    return result
  }
  throw new Error('No existing host scroll owner can place the desktop filter at the viewport boundary')
}
const encoded=value=>'~'+Buffer.from(value).toString('base64url')
const selector=(name,attribute,value)=>'[data-test='+JSON.stringify(name)+']'+(attribute?'['+attribute+'='+JSON.stringify(value)+']':'')
const canonical=value=>Array.isArray(value)?value.map(canonical).sort((left,right)=>JSON.stringify(left).localeCompare(JSON.stringify(right))):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([left],[right])=>left.localeCompare(right)).map(([name,item])=>[name,canonical(item)])):value
const equal=(actual,expected,message)=>assert.deepEqual(canonical(actual),canonical(expected),message)
const compare=(left,right)=>{const a=Array.from(left,char=>char.codePointAt(0)),b=Array.from(right,char=>char.codePointAt(0));for(let index=0;index<Math.min(a.length,b.length);index++)if(a[index]!==b[index])return a[index]-b[index];return a.length-b.length}

export const accessControlInvalidQueries=Object.freeze([
  ['page-zero','page=0'],['page-negative','page=-1'],['page-fraction','page=1.5'],['page-duplicate','page=1&page=2'],
  ['size-zero','size=0'],['size-unsupported','size=17'],['size-duplicate','size=25&size=100'],
  ['permission-key-invalid','permissionKey=INVALID!'],['permission-key-duplicate','permissionKey=a&permissionKey=b'],
  ['scope-key-invalid','scopeKeys=INVALID!'],['scope-key-duplicate','scopeKeys=a&scopeKeys=a'],
  ['subject-empty','filterSubject='],['subject-duplicate','filterSubject=a&filterSubject=b'],
  ['filter-json','filter=%7B'],['filter-array','filter=%5B%5D'],
  ['filter-unknown-field','filter='+encodeURIComponent(JSON.stringify({field:'password',value:'forbidden'}))],
  ['filter-empty-name','filter='+encodeURIComponent(JSON.stringify({field:'name',value:''}))],
  ['filter-empty-scopes','filter='+encodeURIComponent(JSON.stringify({field:'scopeKeys',values:[]}))],
].map(([key,query])=>Object.freeze({id:'ui-invalid-query-'+key,query})))

export const accessControlAdditionalCases=Object.freeze([
  ['ui-group-retired-id-rejected','T1'],
  ...['next','previous','empty'].map(mode=>['ui-scope-delete-selection-'+mode,'T2']),
  ...['application','subject','typed-policy'].map(kind=>['ui-scope-reference-'+kind+'-refused','T2']),
  ['ui-filter-same-field-and','T4'],['ui-filter-name-case-sensitive','T4'],['ui-filter-clear-all','T4'],
  ['ui-filter-cross-group-clear','T4'],['ui-filter-cross-application-clear','T4'],['ui-filter-expired-subject-revalidated','T4'],
  ['ui-filter-valid-empty','T4'],['ui-pagination-last-row-delete','T4'],
  ...accessControlInvalidQueries.map(item=>[item.id,'T4']),
  ['ui-user-disable-preserves-grants','T5'],['ui-subject-delete-keeps-account','T5'],['ui-subject-candidate-exclusions','T5'],
  ['ui-user-delete-all-groups','T5'],['ui-user-delete-execution-retained','T5'],['ui-user-delete-audit-retained','T5'],
  ['ui-secret-csrf-rejected','T7'],['ui-secret-revoked-editor-rejected','T7'],['ui-secret-response-lost-once','T7'],
  ['ui-secret-copy-failure-retry','T7'],['ui-secret-unmount-clears-plaintext','T7'],
  ...['group','user','permission','subject'].flatMap(kind=>['backdrop','maximize','history-discard'].map(action=>['ui-drawer-'+kind+'-'+action,'T10'])),
  ...['group','scope','application'].map(kind=>['ui-inline-'+kind+'-tab-discard','T10']),
  ['ui-inline-sidebar-draft-discard','T10'],['ui-saving-drawer-interaction-lock','T10'],
  ['ui-delete-cancel-no-side-effects','T10'],['ui-delete-failure-no-side-effects','T10'],['ui-delete-focus-fallback','T10'],
  ...accessControlThemes.flatMap(theme=>accessControlLocales.flatMap(locale=>[
    ['ui-four-drawers-theme-language-'+theme+'-'+locale,'T11'],['ui-auth-theme-language-'+theme+'-'+locale,'T11'],
  ])),
].map(([id,gate])=>Object.freeze({id,gate})))

export const accessControlCoverage=Object.freeze([
  {old:['actual-content-projects','menu-access-management'],next:['ui-four-tabs-cards-counts','ui-group-create-edit-delete'],requirements:['N1','N2','N3','N6','T1']},
  {old:['actual-content-scopes','ui-scope-registration-no-runtime-grant'],next:['ui-scope-readonly-edit','ui-scope-create-delete-reference-guard'],requirements:['N7','N8','N9','T2']},
  {old:['actual-content-clients','ui-client-membership-approval'],next:['ui-application-register-remove','ui-permission-many-to-many'],requirements:['N10','N11','N12','N13','T3']},
  {old:['ui-role-grant-edit-refresh','ui-empty-grants-no-policy-change','ui-application-declaration-crud'],next:['ui-permission-typed-save-refresh','ui-permission-external-crud','ui-empty-grants-no-policy-change'],requirements:['N12','N13','N14','T3','T9']},
  {old:['actual-content-assignments','ui-subject-grant-revoke','ui-subject-revoke'],next:['ui-subject-grant-revoke','ui-subject-runtime-revoke'],requirements:['N15','N16','N19','T5','T9']},
  {old:['ui-412-conflict-no-policy-change','ui-loading-transition'],next:['ui-409-412-no-side-effects','ui-403-no-side-effects','ui-503-retry-no-side-effects','ui-loading-transition'],requirements:['N17','N19','T6','T9','T10']},
  {old:['ui-search-filter-pagination-*','ui-filter-*-equals','ui-filter-*-contains','ui-filter-*-and','ui-filter-*-or'],next:['ui-filter-any-and-deeplink','ui-pagination-total-snapshot','ui-sidebar-search-pagination'],requirements:['N16','T4']},
  {old:['ui-theme-language-*','ui-theme-colors-are-distinct','ui-narrow-and-keyboard-focus'],next:['ui-theme-language-*','ui-theme-colors-are-distinct','ui-four-drawers-focus-discard'],requirements:['N17','N18','T10','T11']},
  {old:['console-page-request-errors-have-explicit-sources','ui-zero-grant-logout-switch'],next:['console-page-request-errors-have-explicit-sources','ui-zero-grant-logout-switch'],requirements:['N19','T9','T11']},
  {old:[],next:['ui-account-temporary-password-lifecycle','ui-read-write-separation','ui-secret-one-time-rotation','ui-secret-maintenance'],requirements:['N4','N5','N11','N19','T5','T7','T8-UI-subset','T9-UI-subset']},
])

export const accessControlCaseIds=Object.freeze([
  'preconditions','production-ui-login-canonical-path','menu-access-management','ui-initial-english-preference',
  'ui-frozen-baseline-key-equality',
  'ui-four-tabs-cards-counts','ui-group-create-edit-delete','ui-scope-readonly-edit','ui-scope-create-delete-reference-guard',
  'ui-card-badges-and-built-in-guard','ui-navigation-six-links','ui-scope-key-name-conflict',
  'ui-application-register-remove','ui-permission-external-crud','ui-permission-many-to-many','ui-permission-typed-save-refresh',
  'ui-permission-summary-expand',
  'ui-empty-grants-no-policy-change','ui-subject-grant-revoke','ui-filter-any-and-deeplink','ui-pagination-total-snapshot',
  ...['projects-equals','projects-contains','projects-and','permissions-equals','permissions-contains','permissions-and','users-equals','subjects-equals'].map(name=>'ui-native-filter-'+name),
  'ui-native-filter-popup-geometry',
  'ui-card-search-pagination','ui-filter-native-deeplink-coexistence','ui-filter-native-history',
  'ui-sidebar-search-pagination','ui-four-drawers-focus-discard','ui-four-drawers-draft-discard','ui-409-412-no-side-effects','ui-loading-transition',
  'ui-account-temporary-password-lifecycle','ui-read-write-separation','ui-secret-one-time-rotation','ui-secret-maintenance',
  'ui-403-no-side-effects','ui-503-retry-no-side-effects',
  ...accessControlThemes.flatMap(theme=>accessControlLocales.map(locale=>'ui-theme-language-'+theme+'-'+locale)),
  ...accessControlAdditionalCases.map(item=>item.id),
  'ui-theme-colors-are-distinct','console-page-request-errors-have-explicit-sources',
])

export const accessControlUiGateInputs=Object.freeze({
  T1:['ui-frozen-baseline-key-equality','ui-four-tabs-cards-counts','ui-group-create-edit-delete','ui-card-badges-and-built-in-guard','ui-card-search-pagination',...accessControlAdditionalCases.filter(item=>item.gate==='T1').map(item=>item.id)],
  T2:['ui-scope-readonly-edit','ui-scope-create-delete-reference-guard','ui-scope-key-name-conflict',...accessControlAdditionalCases.filter(item=>item.gate==='T2').map(item=>item.id)],
  T3:['ui-application-register-remove','ui-permission-external-crud','ui-permission-many-to-many','ui-permission-typed-save-refresh','ui-permission-summary-expand','ui-empty-grants-no-policy-change','ui-permission-runtime-projection'],
  T4:['ui-navigation-six-links','ui-filter-any-and-deeplink','ui-pagination-total-snapshot',...accessControlCaseIds.filter(name=>name.startsWith('ui-native-filter-')),'ui-filter-native-deeplink-coexistence','ui-filter-native-history','ui-sidebar-search-pagination',...accessControlAdditionalCases.filter(item=>item.gate==='T4').map(item=>item.id)],
  T5:['ui-account-temporary-password-lifecycle','ui-subject-grant-revoke','ui-subject-runtime-revoke','ui-zero-grant-logout-switch',...accessControlAdditionalCases.filter(item=>item.gate==='T5').map(item=>item.id)],
  T6:[],
  T7:['ui-secret-one-time-rotation',...accessControlAdditionalCases.filter(item=>item.gate==='T7').map(item=>item.id)],
  T8:['ui-secret-maintenance'],
  T9:['ui-read-write-separation','ui-403-no-side-effects','ui-zero-grant-logout-switch'],
  T10:['ui-four-drawers-focus-discard','ui-four-drawers-draft-discard','ui-409-412-no-side-effects','ui-loading-transition','ui-403-no-side-effects','ui-503-retry-no-side-effects',...accessControlAdditionalCases.filter(item=>item.gate==='T10').map(item=>item.id)],
  T11:[...accessControlCaseIds.filter(name=>name.startsWith('ui-theme-language-')),'ui-native-filter-popup-geometry','ui-theme-colors-are-distinct','console-page-request-errors-have-explicit-sources',...accessControlAdditionalCases.filter(item=>item.gate==='T11').map(item=>item.id)],
  T12:[],
})

export function sanitizeUiEvidence(value,secrets=[]) {
  if(typeof value==='string') {
    let text=value
    for(const secret of secrets)if(typeof secret==='string'&&secret)text=text.replaceAll(secret,'[redacted]')
    return text.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-jwt]').replace(/Bearer\s+[^\s,;]+/gi,'Bearer [redacted]').replace(/((?:[?&#]|%3[fF]|%26)(?:from|code|state|access_token|id_token|refresh_token|password|client_secret)(?:=|%3[dD]))[^\s&#"'<>]*/gi,'$1[redacted]')
  }
  if(Array.isArray(value))return value.map(item=>sanitizeUiEvidence(item,secrets))
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,/^(?:interaction|nonce|csrf|code_verifier|password|temporaryPassword|clientSecret|client_secret|access_token|id_token|refresh_token|authorization)$/i.test(name)?'[redacted]':sanitizeUiEvidence(item,secrets)]))
  return value
}

export function permissionInput(permission) {
  const input={key:permission.key,name:permission.name,scopeKeys:[...permission.scopeKeys]}
  if(permission.implementationKind==='kestra-policy')return {...input,description:permission.description??'',enabled:permission.enabled,grants:permission.grants.map(grant=>grant.scope==='TENANT'&&grant.namespace===undefined?{...structuredClone(grant),namespace:null}:structuredClone(grant)),managementGrants:structuredClone(permission.managementGrants)}
  assert.equal(permission.implementationKind,'external-declaration')
  return {...input,details:permission.details??''}
}

export async function runAccessControlFrozenUi(page,base,{admin,applicationGroupId,currentApplicationClientId,expected},record) {
  assert.equal(typeof record,'function')
  const report={id:'ui-frozen-baseline-key-equality',completed:false,passed:false,status:'running',phase:'before-boundary-data',requests:[]}
  const diagnosticStart=new Set((await page.diagnostics()).events.map(event=>event.id))
  const persist=()=>record(sanitizeUiEvidence(structuredClone(report),[admin.password]))
  await persist()
  try {
    assert.equal(expected.scopes.length,19);assert.equal(expected.permissions.length,19);assert.equal(expected.users.length,22);assert.equal(expected.subjects.length,1)
    assert.deepEqual(expected.bootstrapMapping,{prototypeSubject:'admin',runtimeSubject:admin.subject,roleOnly:true},'prototype admin role must be explicitly mapped without merging directory identities')
    assert.equal(expected.userSubjectMapping.length,22)
    assert.equal(new Set(expected.userSubjectMapping.map(item=>item.runtimeSubject)).size,22)
    for(const item of expected.userSubjectMapping)assert.equal(item.runtimeSubject,item.prototypeSubject,'frozen directory subjects must retain their original usernames')
    equal(expected.users.map(user=>user.subject),expected.userSubjectMapping.map(item=>item.runtimeSubject))
    assert(expected.users.some(user=>user.subject==='admin')&&expected.users.some(user=>user.subject===admin.subject)&&admin.subject!=='admin','prototype admin and bootstrap manager must remain separate accounts')
    assert.equal(expected.groupMapping.runtimeId,applicationGroupId)
    assert(expected.users.every(user=>typeof user.name==='string'&&typeof user.email==='string'&&!['—','-'].includes(user.name)&&!['—','-'].includes(user.email)),'placeholder profile values must be normalized before production preparation')
    page.redactSecrets([admin.password])
    await page.goto(base+'/ui/access-denied')
    await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]'))||Boolean(document.querySelector('[data-testid="return-to-login"]')))
    if(!await page.evaluate(()=>Boolean(document.querySelector('input[name="username"]'))))await page.click('[data-testid="return-to-login"]')
    await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]')))
    await page.fill('input[name="username"]',admin.username);await page.fill('input[name="password"]',admin.password);await page.click('button[type="submit"]')
    await page.waitForFunction(()=>location.pathname==='/ui/main/dashboards'&&!document.querySelector('input[name="password"]'))
    const group='/application-groups/'+encodeURIComponent(applicationGroupId),app=group+'/applications/'+encoded(currentApplicationClientId)
    const read=async path=>{
      const diagnostics=await page.diagnostics(),source=diagnostics.documents.findLast(document=>document.frameId===diagnostics.topFrame);assert(source?.id)
      const result=await page.evaluate(async path=>{const response=await fetch(path,{credentials:'same-origin',headers:{Accept:'application/json'},redirect:'error'});return {status:response.status,body:await response.json()}},api+path)
      report.requests.push({method:'GET',path:api+path,status:result.status,documentId:source.id});await persist();assert.equal(result.status,200)
      return result.body
    }
    const beforeGroup=await read(group)
    const collections={scopes:await read(group+'/scopes?page=1&size=100'),permissions:await read(app+'/permissions?page=1&size=100'),users:await read('/users?page=1&size=100'),subjects:await read(group+'/scope-grants?page=1&size=100')}
    const fields={scopes:['key','name','description'],permissions:['key','name','scopeKeys'],users:['subject','name','email'],subjects:['issuer','subject','scopeKeys']}
    for(const [kind,collection]of Object.entries(collections)) {
      assert.equal(collection.total,expected[kind].length,'frozen '+kind+' total differs before boundary data')
      assert.equal(collection.items.length,collection.total,'frozen collection is incomplete')
      const select=item=>Object.fromEntries(fields[kind].map(field=>[field,item[field]??(kind==='users'&&['name','email'].includes(field)?'':undefined)]))
      equal(collection.items.map(select),expected[kind].map(select),'frozen '+kind+' differs by stable key/field')
    }
    const groupDto=await read(group);assert.equal(groupDto.revision,beforeGroup.revision,'frozen group changed across collection reads');equal(groupDto.counts,{scopes:19,applications:1,subjects:1},'frozen group counts are not a single initial snapshot')
    const pages=[]
    for(const [path,element,row,attribute,keys]of [[group.slice(1)+'/scopes','[data-test="scope-sidebar"]','scope-item','data-scope-key',expected.scopes.map(item=>item.key)],['users','[data-test="user-list"]','user-row','data-subject',expected.users.map(item=>item.subject)],[group.slice(1)+'/scope-grants','[data-test="subject-list"]','subject-row','data-subject',expected.subjects.map(item=>item.subject)],[app.slice(1),'[data-test="application-permissions"]','permission-row','data-permission-key',expected.permissions.map(item=>item.key)]]) {
      const requested='/ui/main/extensions/rbac/'+path
      const target=requested+(row==='scope-item'?'/'+encodeURIComponent([...keys].sort(compare)[0]):'')
      await page.goto(base+requested);await page.waitForFunction(({target,element})=>location.pathname===target&&Boolean(document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector(element))&&document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('main')?.getAttribute('aria-busy')==='false',{target,element})
      const actual=await page.evaluate(({row,attribute})=>[...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[data-test="'+row+'"]')].filter(node=>node.getClientRects().length).map(node=>node.getAttribute(attribute)),{row,attribute})
      equal(actual,keys.sort(compare),'frozen UI '+row+' differs from API/expected keys')
      pages.push({requestedPath:requested,path:target,ids:actual})
    }
    const events=(await page.diagnostics()).events.filter(event=>!diagnosticStart.has(event.id))
    report.diagnostics={events,expectedErrorIds:[]}
    assert(events.every(event=>event.id&&event.documentId&&event.url&&event.kind),'frozen diagnostics lack source identity')
    const denied=event=>event.kind==='http-error'&&event.method==='GET'&&[401,403].includes(event.status)&&[base+'/api/v1/configs',base+api+'/capabilities'].includes(event.url)&&typeof event.documentUrl==='string'&&new URL(event.documentUrl).pathname==='/ui/access-denied'
    const aborted=event=>event.kind==='request-failed'&&event.message==='net::ERR_ABORTED'&&(event.url.startsWith(base+'/ui/assets/')&&event.resourceType==='Script'||event.url.startsWith('https://api.kestra.io/v1/feeds?'))&&events.some(request=>request.kind==='request'&&request.requestId===event.requestId&&request.documentId===event.documentId&&request.url===event.url)&&events.some(next=>next.kind==='document-navigation'&&next.documentId!==event.documentId&&Math.abs(Date.parse(next.observedAt)-Date.parse(event.observedAt))<=1000)
    const expectedDiagnostic=event=>denied(event)||aborted(event)||event.kind==='console-error'&&event.requestId&&events.some(response=>denied(response)&&response.requestId===event.requestId&&response.documentId===event.documentId&&response.url===event.url)
    report.diagnostics.expectedErrorIds=events.filter(expectedDiagnostic).map(event=>event.id)
    const errors=events.filter(event=>['console-error','page-error','request-failed','http-error','diagnostic-integrity-error'].includes(event.kind)&&!expectedDiagnostic(event))
    assert.equal(errors.length,0,'frozen browser has unclassified source-attributed errors')
    Object.assign(report,{completed:true,passed:true,status:'passed',evidence:{source:'real-browser-before-boundary-data',bootstrapMapping:expected.bootstrapMapping,userSubjectMapping:expected.userSubjectMapping,groupMapping:expected.groupMapping,collections:Object.fromEntries(Object.entries(collections).map(([kind,value])=>[kind,{items:value.items.map(item=>Object.fromEntries(fields[kind].map(field=>[field,item[field]??'']))),total:value.total,directoryRevision:value.directoryRevision,parentRevision:value.parentRevision}])),counts:groupDto.counts,pages}})
  }catch(error){report.status='failed';report.error=String(error.message);if(typeof page.captureFailure==='function'){report.failureArtifact=await page.captureFailure(error,'frozen-baseline');if(error.artifactCaptureError)report.artifactCaptureError=error.artifactCaptureError}}
  finally{await persist()}
  return sanitizeUiEvidence(report,[admin.password])
}

export async function completeFirstPasswordChange(page,account,contract,onDenial=async()=>{}) {
  if(!account.passwordChangeRequired)return
  assert(contract&&typeof contract.path==='string'&&contract.path.startsWith('/'),'published first-password-change path and field selectors required from main agent')
  assert(contract.newPassword&&contract.confirmPassword&&contract.submit,'first-password-change field contract missing')
  await page.waitForFunction(path=>location.pathname===path,contract.path)
  const previous=new Set((await page.diagnostics()).events.map(event=>event.id))
  const denied=await page.evaluate(async()=>{const response=await fetch('/api/v1/main/flows/search?size=1',{credentials:'same-origin',redirect:'manual'});await response.body?.cancel();return response.status})
  assert([401,403].includes(denied),'temporary credential obtained normal business access before password change')
  const deniedUrl=new URL('/api/v1/main/flows/search?size=1',await page.evaluate(()=>location.origin)).href
  const deniedResponses=(await page.diagnostics()).events.filter(event=>!previous.has(event.id)&&event.kind==='http-error'&&event.url===deniedUrl&&event.method==='GET'&&event.status===denied)
  assert.equal(deniedResponses.length,1,'First-password refusal request identity must be unambiguous')
  await onDenial(denied,deniedResponses[0].requestId)
  const replacement=randomBytes(32).toString('base64url')+'Aa1!'
  page.redactSecrets([account.password,replacement])
  await page.fill(contract.newPassword,replacement);await page.fill(contract.confirmPassword,replacement);await page.click(contract.submit)
  await page.waitForFunction(path=>location.pathname!==path,contract.path)
  account.password=replacement;account.passwordChangeRequired=false
  await page.waitForFunction(()=>location.pathname==='/oidc/login'&&Boolean(document.querySelector('input[name="username"]')))
  await page.fill('input[name="username"]',account.username);await page.fill('input[name="password"]',account.password);await page.click('button[type="submit"]')
}

export async function runAccessControlV3Ui(page,base,fixture,record) {
  const report={version:3,completed:false,planned:[...accessControlCaseIds],coverage:accessControlCoverage,rows:[],requests:[],diagnostics:[],failure:null}
  report.ui=report.rows
  const secrets=[fixture?.admin?.password,fixture?.zeroAccount?.password]
  const persist=()=>record(sanitizeUiEvidence(structuredClone(report),secrets))
  const baselineEvents=new Set((await page.diagnostics()).events.map(event=>event.id))
  const group='application-groups/'+encodeURIComponent(fixture.applicationGroupId)
  const groupApi='/'+group
  const app=group+'/applications/'+encoded(fixture.currentApplicationClientId)
  const external=group+'/applications/'+encoded(fixture.clientId)
  const permissionApi='/'+app+'/permissions'
  const externalApi='/'+external+'/permissions'
  const snapshots=new Map(),restores=[]
  let currentCase='preconditions'
  async function source() {
    const state=await page.evaluate(()=>({path:location.pathname,url:location.origin+location.pathname,query:location.search,timeOrigin:performance.timeOrigin}))
    const diagnostics=await page.diagnostics(),document=diagnostics.documents?.findLast(item=>item.frameId===diagnostics.topFrame)
    assert(document?.id,'current browser document identity missing')
    return {...state,documentId:document.id}
  }
  async function run(name,operation) {
    currentCase=name
    const combination=name.match(/^ui-theme-language-(light|dark-2|dark|system)-(.+)$/)
    const row={name,case:combination?'theme-language':name,...(combination?{theme:combination[1],locale:combination[2]}:{}),passed:false,status:'running',evidence:{}}
    const managementOffset=fixture.targetRuntime?.management?.requests?.length??0
    report.rows.push(row);await persist()
    try {await page.setViewport({width:1280,height:900});row.source=await source();Object.assign(row.evidence,await operation());if(combination)Object.assign(row,{computedStyles:row.evidence.computedStyles,translation:row.evidence.translation,keyboardFocus:row.evidence.keyboardFocus,noHorizontalOverflow:row.evidence.noHorizontalOverflow});row.passed=true;row.status='passed'}
    catch(error){row.status=error.code==='acceptance_contract_missing'?'not_run':'failed';row.error=String(error.message);if(error.nativeStyleSettlement)row.evidence.nativeStyleSettlement=error.nativeStyleSettlement;report.failure??={case:name,message:row.error};if(typeof page.captureFailure==='function'){row.failureArtifact=await page.captureFailure(error,name);if(error.artifactCaptureError)row.artifactCaptureError=error.artifactCaptureError}if(['preconditions','production-ui-login-canonical-path','menu-access-management','ui-initial-english-preference'].includes(name))throw error}
    finally{if(!row.passed)try{await clearTransientUi();row.failureCleanup={passed:true}}catch(error){row.failureCleanup={passed:false,error:String(error.message)};row.status='failed'}row.requests=report.requests.filter(request=>request.case===name);row.managementRequests=fixture.targetRuntime?.management?.requests?.slice(managementOffset)??[];await persist()}
  }
  async function note(value) {Object.assign(report.rows.at(-1).evidence,value);await persist()}
  function requireMethods(object,names,label) {for(const name of names)if(typeof object?.[name]!=='function')throw Object.assign(new Error(label+'.'+name+' real capability required'),{code:'acceptance_contract_missing'})}
  let privateOperations=Promise.resolve()
  function privateRequest(path,method='GET',body,revision) {
    const operation=privateOperations.then(async()=>{const management=fixture.targetRuntime?.management;assert(management);await management.login();return management.request(api+path,method,body,revision)})
    privateOperations=operation.catch(()=>{})
    return operation
  }
  async function privateList(path) {
    const items=[];let total,revision
    for(let pageNumber=1;;pageNumber++) {
      const value=await privateRequest(path+'?page='+pageNumber+'&size=100')
      assert(Array.isArray(value.items)&&Number.isSafeInteger(value.total));total??=value.total;assert.equal(value.total,total)
      const current=value.directoryRevision??value.parentRevision;revision??=current;assert.equal(current,revision,'private preparation list snapshot drift')
      items.push(...value.items);assert(items.length<=total)
      if(items.length===total)return items
      assert(value.items.length,'private preparation pagination stalled')
    }
  }
  async function effectsBefore() {const before=await fixture.targetRuntime.effects.snapshot();await note({beforeEffects:{hash:before.hash,sources:before.sources}});return before}
  async function effectsUnchanged(before) {const after=await fixture.targetRuntime.effects.snapshot();await note({afterEffects:{hash:after.hash,sources:after.sources}});assert.equal(after.hash,before.hash,'operation changed business persistence, queues or storage');return after}
  async function cancelConfirmation(name='delete-confirm') {await page.click(selector(name)+' .kel-button:not(.kel-button--danger)');await page.waitForFunction(name=>![...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[data-test="'+name+'"]')].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'),name)}
  async function confirmDiscard() {await page.click('[data-test="discard-confirm"] .kel-button--danger');await page.waitForFunction(()=>![...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[data-test="discard-confirm"]')].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'&&!node.closest('[inert],[aria-hidden="true"]')))}
  async function clearTransientUi() {
    const filter=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot,shown=selector=>[...root?.querySelectorAll(selector)??[]].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');return {advanced:shown('.adv-builder'),mobile:shown('.mobile-sheet'),nested:shown('[role="option"]')}})
    if(filter.advanced||filter.mobile) {
      if(filter.nested)await page.press('body','Escape')
      if(filter.advanced)await page.click('.adv-header-close')
      else await page.press('body','Escape')
      await page.waitForFunction(()=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot;return ![...root?.querySelectorAll('.adv-builder,.mobile-sheet')??[]].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden')})
    }
    const visible=()=>page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot,shown=selector=>[...root?.querySelectorAll(selector)??[]].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'&&!node.closest('[inert],[aria-hidden="true"]'));return {oneTime:shown('[data-test="credential-once"],[data-test="temporary-password-once"]'),discard:shown('[data-test="discard-confirm"]'),deletion:shown('[data-test="delete-confirm"]'),drawer:shown('[data-test="drawer-group"],[data-test="drawer-user"],[data-test="drawer-permission"],[data-test="drawer-subject"]'),inline:shown('.rbac-inline-form')}})
    let current=await visible()
    if(current.oneTime){await page.click('[data-test="credential-once"] .kel-button--primary,[data-test="temporary-password-once"] .kel-button--primary');current=await visible()}
    if(current.deletion){await cancelConfirmation();current=await visible()}
    if(current.discard){await confirmDiscard();current=await visible()}
    if(current.drawer||current.inline) {
      if(current.drawer)await clickDrawerHeader();else await page.click('.rbac-inline-form .buttons button:last-child')
      await page.waitForFunction(()=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot,shown=selector=>[...root?.querySelectorAll(selector)??[]].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'&&!node.closest('[inert],[aria-hidden="true"]'));return shown('[data-test="discard-confirm"]')||!shown('[data-test="drawer-group"],[data-test="drawer-user"],[data-test="drawer-permission"],[data-test="drawer-subject"],.rbac-inline-form')})
      if((await visible()).discard)await confirmDiscard()
    }
  }
  async function ownedGroup(operation) {
    const id='ui-extra-'+randomBytes(7).toString('hex'),path='/application-groups/'+id
    await privateRequest('/application-groups','POST',{id,tenant:'main',displayName:'Isolated shared UI '+id,description:''})
    const cleanup=async()=>{
      let current
      try{current=await privateRequest(path)}catch(error){if(String(error.message).includes('management HTTP 404 GET'))return;throw error}
      for(const member of await privateList(path+'/applications')) {
        const memberPath=path+'/applications/'+encoded(member.clientId)
        for(const permission of await privateList(memberPath+'/permissions'))await privateRequest(memberPath+'/permissions/'+permission.key,'DELETE',undefined,permission.revision)
        const latest=await privateRequest(memberPath);await privateRequest(memberPath,'DELETE',undefined,latest.revision)
      }
      for(const grant of await privateList(path+'/scope-grants'))await privateRequest(path+'/scope-grants/detail?subject='+encodeURIComponent(grant.subject),'DELETE',undefined,grant.revision)
      for(const scope of await privateList(path+'/scopes'))await privateRequest(path+'/scopes/'+scope.key,'DELETE',undefined,scope.revision)
      current=await privateRequest(path);await privateRequest(path,'DELETE',undefined,current.revision)
    }
    restores.push({id:'cleanup-'+id,run:cleanup});await note({ownedGroup:id})
    try{return await operation({id,path,route:path.slice(1)})}finally{await cleanup()}
  }
  async function addScope(path,key) {const group=await privateRequest(path);await privateRequest(path+'/scopes','POST',{key,name:key,description:'Isolated shared UI scope'},group.revision);return privateRequest(path+'/scopes/'+key)}
  async function setGrant(path,account,scopeKeys) {
    const existing=(await privateList(path+'/scope-grants')).find(grant=>grant.subject===account.subject)
    const parent=existing??await privateRequest(path)
    return privateRequest(path+'/scope-grants'+(existing?'/detail?subject='+encodeURIComponent(account.subject):''),existing?'PUT':'POST',{issuer:base,subject:account.subject,scopeKeys},parent.revision)
  }
  async function preparedUser(prefix='ui-extra-user') {
    const username=prefix+'-'+randomBytes(6).toString('hex'),password=randomBytes(30).toString('base64url')+'Aa1!'
    const created=await privateRequest('/users','POST',{username,name:'Shared UI test account',email:username+'@acceptance.invalid'})
    assert.equal(created.subject,username);assert.equal(typeof created.temporaryPassword,'string')
    secrets.push(password,created.temporaryPassword);page.redactSecrets([password,created.temporaryPassword])
    const prepared=await new ProductionOAuthClient(base).changeTemporaryPassword(username,created.temporaryPassword,password)
    assert.equal(prepared.passwordChanged,true)
    const cleanup=async()=>{let user;try{user=await privateRequest('/users/detail?subject='+encodeURIComponent(username))}catch(error){if(String(error.message).includes('management HTTP 404 GET'))return;throw error}await privateRequest('/users/detail?subject='+encodeURIComponent(username),'DELETE',undefined,user.revision)}
    restores.push({id:'cleanup-'+username,run:cleanup});await note({preparedSubject:username,productionPasswordPreparation:prepared})
    return {username,subject:username,password,cleanup}
  }
  async function rawRequest(client,path,{method='GET',body,headers}={},expected=[200]) {
    const response=await client.request(path,{method,...(body===undefined?{}:{body}),...(headers?{headers}:{})})
    const operation={path,method,status:response.status};const row=report.rows.at(-1);(row.evidence.protocolRequests??=[]).push(operation);await persist()
    assert(expected.includes(response.status),method+' '+path+' returned '+response.status)
    return response.status===204?null:response.json().catch(()=>null)
  }
  const drawerPlans=()=>[
    {kind:'group',path:'application-groups',trigger:'.management-toolbar button',input:'[data-test="drawer-group"] .kel-form-item:first-of-type input'},
    {kind:'user',path:'users',trigger:'[data-test="user-create"]',input:'[data-test="drawer-user"] input[name="username"]'},
    {kind:'permission',path:app,trigger:'[data-test="permission-add"]',input:'[name="permission-name"]'},
    {kind:'subject',path:group+'/scope-grants',trigger:'[data-test="subject-add"]'},
  ]
  async function dirtyDrawer(plan,value,{navigate=true}={}) {
    if(navigate)await open(plan.path);await drawer(plan.kind,plan.trigger)
    if(plan.input)await page.fill(plan.input,value)
    else {await page.click('[data-test="drawer-subject"] .kel-form-item:first-of-type .kel-select__wrapper');await page.click('[role="option"]:text-is('+JSON.stringify(fixture.zeroAccount.subject)+')')}
  }
  async function drawerDraft(plan) {return page.evaluate(({kind,input,subject})=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot;return input?root.querySelector(input)?.value:root.querySelector('[data-test="drawer-'+kind+'"]')?.textContent.includes(subject)},{kind:plan.kind,input:plan.input,subject:fixture.zeroAccount.subject})}
  async function backdropPoint(kind) {
    await waitForNativeStyleSettlement(page,{drawer:'[data-test="drawer-'+kind+'"]'})
    return page.evaluate(kind=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,drawer=root.querySelector('[data-test="drawer-'+kind+'"]'),panel=drawer.closest('.kel-drawer,.el-drawer')??drawer,box=panel.getBoundingClientRect(),overlay=panel.closest('.kel-overlay,.el-overlay');if(!overlay)throw new Error('actual drawer overlay missing');const outer=overlay.getBoundingClientRect();for(const y of [innerHeight/2,innerHeight*0.7,innerHeight*0.3])for(const x of [Math.max(outer.left+8,(outer.left+box.left)/2),box.left-12]){if(x<outer.left||x>=box.left||y<outer.top||y>=outer.bottom)continue;const target=root.elementFromPoint(x,y);if(target&&!panel.contains(target)&&overlay.contains(target))return {x,y}}throw new Error('no real unobstructed backdrop point')},kind)
  }
  async function clickBackdrop(kind) {
    requireMethods(page,['clickAt'],'shared adapter')
    const point=await backdropPoint(kind)
    await page.clickAt(point);return point
  }
  async function clickDrawerHeader({shadow=true,action='close'}={}) {
    requireMethods(page,['clickAt'],'shared adapter')
    await page.waitForFunction(nativeDrawerHeaderPoint,{shadow,action,readyOnly:true})
    const point=await page.evaluate(nativeDrawerHeaderPoint,{shadow,action})
    await note({nativeDrawerHeaderPointer:point})
    await page.clickAt({x:point.x,y:point.y})
  }
  async function state() {return page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot;return {path:location.pathname,query:location.search,lang:root?.querySelector('[lang]')?.getAttribute('lang'),text:root?.textContent??'',busy:root?.querySelector('main')?.getAttribute('aria-busy')}})}
  async function dismissNativeInstallPrompt() {
    if(await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot;const modal=[...root?.querySelectorAll('[aria-modal="true"]')??[]].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');return !modal&&Boolean(document.querySelector('.pwa-install-prompt')?.getClientRects().length)})) {
      await page.click('.pwa-install-actions button:last-child')
      await page.waitForFunction(()=>!document.querySelector('.pwa-install-prompt'))
    }
  }
  async function canonicalPageUrl(path) {
    const url=new URL('/ui/main/extensions/rbac/'+path,base)
    const selection=url.pathname.match(/^\/ui\/main\/extensions\/rbac\/(application-groups\/[^/]+\/(scopes|applications))$/)
    if(selection) {
      const field=selection[2]==='scopes'?'key':'clientId'
      const items=await all('/'+selection[1])
      const first=items.map(item=>item[field]).sort()[0]
      if(first!==undefined)url.pathname+='/'+(field==='key'?encodeURIComponent(first):encoded(first))
    }
    return url
  }
  async function open(path,element='[data-test="access-control-root"]') {
    const url=new URL('/ui/main/extensions/rbac/'+path,base)
    const target=await canonicalPageUrl(path)
    await page.goto(url.href)
    const observation='ui-route-settlement-'+randomBytes(6).toString('hex')
    try {
      await page.waitForFunction(({path,query,element,observation})=>{
        const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot,main=root?.querySelector('main')
        const normalized=value=>{const parameters=new URLSearchParams(value);for(const [key,defaultValue]of [['page','1'],['size','25']])if(parameters.getAll(key).length===1&&parameters.get(key)===defaultValue)parameters.delete(key);return JSON.stringify([...parameters])}
        const rejectedEmptySubject=element==='[data-test="request-error"]'&&query==='?filterSubject='&&location.search===''&&Boolean(root?.querySelector('[data-test="request-error"] button'))&&!root.querySelector('[data-test="permission-row"]')
        if(location.pathname!==path||!rejectedEmptySubject&&normalized(location.search)!==normalized(query)||main?.getAttribute('aria-busy')!=='false'||!root.querySelector(element))return false
        const selected=path.match(/\/(scopes|applications)\/([^/]+)$/)
        if(selected) {
          const sidebar=root.querySelector('[data-test="'+(selected[1]==='scopes'?'scope':'application')+'-sidebar"]')
          if(sidebar) {
            const active=sidebar.querySelector('[aria-current="true"]')
            const actual=selected[1]==='scopes'?active?.getAttribute('data-scope-key'):active?.getAttribute('data-client-key')
            const expected=selected[1]==='scopes'?decodeURIComponent(selected[2]):new TextDecoder().decode(Uint8Array.from(atob(selected[2].slice(1).replaceAll('-','+').replaceAll('_','/')),char=>char.charCodeAt(0)))
            if(actual!==expected)return false
          }
        }
        const signature=main.textContent+'|'+root.querySelector(element).textContent
        const previous=window[observation];window[observation]={signature,count:previous?.signature===signature?previous.count+1:1}
        return window[observation].count>=3
      },{path:target.pathname,query:target.search,element,observation})
    }finally{await page.evaluate(observation=>{delete window[observation]},observation).catch(()=>{})}
    await dismissNativeInstallPrompt()
    return state()
  }
  async function request(path,method='GET',body,revision,expected=[200]) {
    const before=await source()
    const previous=new Set((await page.diagnostics()).events.map(event=>event.id))
    const response=await page.evaluate(async({path,method,body,revision})=>{const headers={Accept:'application/json'};if(body!==undefined)headers['Content-Type']='application/json';if(revision!==undefined)headers['If-Match']='"'+revision+'"';if(method!=='GET'){const csrf=document.querySelector('meta[name="csrf-token"]')?.content;if(!csrf)throw new Error('host CSRF token missing');headers['X-CSRF-TOKEN']=csrf}const result=await fetch(path,{method,headers,credentials:'same-origin',redirect:'error',...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:result.status,body:await result.json().catch(()=>null),cacheControl:result.headers.get('cache-control')}},{path:api+path,method,body,revision})
    assert.equal((await source()).timeOrigin,before.timeOrigin,'request changed source document')
    report.requests.push({case:currentCase,path:api+path,method,status:response.status,requestId:await browserResponseId(previous,before,api+path,method,response.status),source:before,expectedStatuses:expected})
    await persist();assert(expected.includes(response.status),method+' '+path+' returned '+response.status)
    return response
  }
  async function browserResponseId(previous,document,path,method,status) {
    const responses=(await page.diagnostics()).events.filter(event=>!previous.has(event.id)&&['http-response','http-error'].includes(event.kind)&&event.documentId===document.documentId&&event.url===base+path&&event.method===method&&event.status===status)
    assert.equal(responses.length,1,'Explicit browser request response identity must be unambiguous: '+method+' '+path)
    return responses[0].requestId
  }
  const read=async path=>(await request(path)).body
  async function all(path) {
    const items=[];let total,revision
    for(let pageNumber=1;;pageNumber++) {
      const value=await read(path+(path.includes('?')?'&':'?')+'page='+pageNumber+'&size=100')
      assert(Array.isArray(value.items)&&Number.isSafeInteger(value.total),'complete authorized collection required')
      const current=value.parentRevision??value.directoryRevision
      assert(Number.isSafeInteger(current)||path==='/users'&&pageNumber===1&&value.total<=100,'cross-page list snapshot revision missing')
      total??=value.total;revision??=current;assert.equal(value.total,total);assert.equal(current,revision,'list revision drift')
      items.push(...value.items);assert(items.length<=total)
      if(items.length===total)return items
      assert(value.items.length,'pagination stalled')
    }
  }
  async function clickSave(button,path,method='PUT',expected=[200]) {
    const previous=new Set((await page.diagnostics()).events.map(event=>event.id)),document=await source()
    const observation='ui-save-'+randomBytes(6).toString('hex')
    await page.evaluate(observation=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,state={busy:false,saving:false,closeDisabled:true,saveDisabled:true};const sample=()=>{const main=root.querySelector('main'),drawer=root.querySelector('[data-test^="drawer-"][aria-busy]');if(main?.getAttribute('aria-busy')==='true')state.busy=true;if(drawer?.getAttribute('aria-busy')==='true'){const close=drawer.querySelector('.kel-drawer__close-btn');state.saving=true;state.closeDisabled&&=!close||close.disabled===true;state.saveDisabled&&=root.querySelector('[data-test="drawer-save"]')?.disabled===true}};state.observer=new MutationObserver(records=>{if(records.some(record=>record.attributeName==='aria-busy'&&record.oldValue==='true'))state.busy=true;sample()});state.observer.observe(root,{subtree:true,attributes:true,attributeOldValue:true,childList:true});window[observation]=state},observation)
    if(await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot;const modal=[...root?.querySelectorAll('[aria-modal="true"]')??[]].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');return !modal&&Boolean(document.querySelector('.pwa-install-prompt')?.getClientRects().length)})) {
      await page.click('.pwa-install-actions button:last-child')
      await page.waitForFunction(()=>!document.querySelector('.pwa-install-prompt'))
    }
    await page.click(button)
    const deadline=Date.now()+30000
    let event
    while(Date.now()<deadline) {
      event=(await page.diagnostics()).events.find(item=>!previous.has(item.id)&&item.documentId===document.documentId&&['http-response','http-error'].includes(item.kind)&&item.url===base+api+path&&item.method===method)
      if(event)break
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    assert(event,'native UI action produced no exact HTTP response')
    report.requests.push({case:currentCase,path:api+path,method,status:event.status,requestId:event.requestId,source:document,expectedStatuses:expected})
    const observed=await page.evaluate(observation=>{const state=window[observation];state.observer.disconnect();delete window[observation];return {busy:state.busy,saving:state.saving,closeDisabled:state.closeDisabled,saveDisabled:state.saveDisabled}},observation)
    report.requests.at(-1).loading=observed
    await persist();assert(expected.includes(event.status),'native write failed HTTP '+event.status)
    assert(observed.busy,'native write never exposed a loading state')
    if(observed.saving)assert(observed.closeDisabled&&observed.saveDisabled,'saving drawer allowed close or duplicate submit')
    await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false'||location.pathname==='/ui/access-denied')
    report.requests.at(-1).postWriteView=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot;return {path:location.pathname,reauthenticationRequired:Boolean(root?.querySelector('[data-test="sign-in-again"]')),businessContentHidden:!root?.querySelector('[data-test="group-detail"],[data-test="permission-row"],[data-test="user-row"],[data-test="subject-row"]')}})
    return {status:event.status,requestId:event.requestId,documentId:event.documentId,loading:observed}
  }
  async function nativeActionResponse(button,path,method,expectedStatuses) {
    const before=new Set((await page.diagnostics()).events.map(event=>event.id)),document=await source()
    await page.click(button)
    return nativeResponse(path,method,expectedStatuses,before,document)
  }
  async function nativeResponse(path,method,expectedStatuses,before,document) {
    const deadline=Date.now()+30000;let event
    do{event=(await page.diagnostics()).events.find(item=>!before.has(item.id)&&item.documentId===document.documentId&&['http-response','http-error'].includes(item.kind)&&item.url===base+api+path&&item.method===method);if(event)break;await new Promise(resolve=>setTimeout(resolve,50))}while(Date.now()<deadline)
    assert(event,'native action produced no exact source-bound response')
    report.requests.push({case:currentCase,path:api+path,method,status:event.status,requestId:event.requestId,source:document,expectedStatuses});await persist();assert(expectedStatuses.includes(event.status),'native action returned '+event.status)
    return event
  }
  async function visibleRows(name,attribute) {return page.evaluate(({name,attribute})=>[...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[data-test="'+name+'"]')].filter(node=>node.getClientRects().length).map(node=>node.getAttribute(attribute)),{name,attribute})}
  async function readonly(element) {
    await page.waitForFunction(element=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot;return root?.querySelector('main')?.getAttribute('aria-busy')==='false'&&Boolean(root.querySelector(element)?.querySelector('h2,dl'))},element)
    assert(await page.evaluate(element=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector(element);return !root.querySelector('.rbac-inline-form')&&![...root.querySelectorAll('input,textarea,select,[contenteditable="true"]')].some(node=>!node.closest('.rbac-list')&&!node.disabled&&!node.readOnly)},element),'business detail must initially be read-only; list search/filter controls are independent')
  }
  async function preference(steps) {
    assert(Array.isArray(steps)&&steps.length,'host preference actions required')
    await page.goto(base+fixture.preferences.path)
    for(const step of steps){if(step.action==='click')await page.click(step.selector);else if(step.action==='fill')await page.fill(step.selector,step.value);else throw new Error('unsupported native preference action')}
  }
  async function openNativeAdvanced(shadow=true) {
    await dismissNativeInstallPrompt()
    await page.click('.customize-button')
    await page.waitForFunction(shadow=>{const root=shadow?document.querySelector('[data-test="extension-container"]').shadowRoot:document;return ['.adv-builder','.advanced-add'].some(selector=>[...root.querySelectorAll(selector)].some(node=>node.getClientRects().length))},shadow)
    const advancedVisible=await page.evaluate(shadow=>{const root=shadow?document.querySelector('[data-test="extension-container"]').shadowRoot:document;return [...root.querySelectorAll('.adv-builder')].some(node=>node.getClientRects().length)},shadow)
    if(!advancedVisible)await page.click('.advanced-add')
  }
  async function runNativeFilterPlan(steps) {
    for(const step of steps) {
      if(step.action==='open-advanced')await openNativeAdvanced()
      else if(step.action==='wait-query-value')await page.waitForFunction(value=>[...new URL(location.href).searchParams.values()].includes(value)&&document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false',step.value)
      else if(step.action==='click')await page.click(step.selector)
      else if(step.action==='fill') {
        await page.fill(step.selector,step.value)
        if(step.selector.includes('.cond-value-input')) {
          await page.waitForFunction(({selector,value})=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,input=root.querySelector(selector);return Boolean(input&&input.value===value&&root.activeElement===input&&root.querySelector('.adv-builder')?.getClientRects().length&&root.querySelector('main')?.getAttribute('aria-busy')==='false')},{selector:step.selector,value:step.value})
        }
      }
      else if(step.action==='assert-comparator') {
        const observed=await page.evaluate(selector=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,node=root.querySelector(selector);return {disabled:Boolean(node?.querySelector('.kel-select__wrapper.is-disabled')),label:node?.textContent.trim()}},step.selector)
        assert.equal(observed.disabled,true,'single supported comparator must remain native read-only')
        assert.equal(observed.label,step.value,'native comparator differs from required filter operation')
      }else throw new Error('unsupported native filter action: '+step.action)
    }
  }
  async function styles(selectors,shadow=true) {await waitForNativeStyleSettlement(page,selectors,{shadow});return page.evaluate(({selectors,shadow})=>{const root=shadow?document.querySelector('[data-test="extension-container"]').shadowRoot:document;return Object.fromEntries(Object.entries(selectors).map(([name,selector])=>{const node=root.querySelector(selector);if(!node||!node.getClientRects().length)throw new Error('visible style reference missing: '+name);const style=getComputedStyle(node);return [name,{fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,color:style.color,background:style.backgroundColor,padding:style.padding,radius:style.borderRadius,borderBottomStyle:style.borderBottomStyle,borderBottomWidth:style.borderBottomWidth}]}))},{selectors,shadow})}
  async function drawer(kind,trigger) {
    if(await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot;const modal=[...root?.querySelectorAll('[aria-modal="true"]')??[]].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');return !modal&&Boolean(document.querySelector('.pwa-install-prompt')?.getClientRects().length)})) {
      await page.click('.pwa-install-actions button:last-child')
      await page.waitForFunction(()=>!document.querySelector('.pwa-install-prompt'))
    }
    await page.click(trigger)
    await page.waitForFunction(kind=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-'+kind+'"]')),kind)
    await waitForNativeStyleSettlement(page,{drawer:'[data-test="drawer-'+kind+'"]'})
  }
  async function login(account=fixture.admin) {
    const startedAt=new Date().toISOString(),previous=new Set((await page.diagnostics()).events.map(event=>event.id))
    const activeIdentity=report.identityWindows?.findLast(window=>window.kind==='authenticated-session'&&!window.finishedAt)
    if(activeIdentity)activeIdentity.finishedAt=startedAt
    page.redactSecrets([account.password]);secrets.push(account.password)
    await page.goto(base+'/ui/access-denied')
    await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]'))||Boolean(document.querySelector('[data-testid="return-to-login"]')))
    if(!await page.evaluate(()=>Boolean(document.querySelector('input[name="username"]'))))await page.click('[data-testid="return-to-login"]')
    await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]'))&&Boolean(document.querySelector('input[name="password"]')))
    await page.fill('input[name="username"]',account.username);await page.fill('input[name="password"]',account.password);await page.click('button[type="submit"]')
    await completeFirstPasswordChange(page,account,fixture.firstPasswordChange,async(status,requestId)=>{report.requests.push({case:currentCase,path:'/api/v1/main/flows/search?size=1',method:'GET',status,requestId,source:await source(),expectedStatuses:[401,403]})})
    secrets.push(account.password)
    await page.waitForFunction(()=>!document.querySelector('input[name="password"]')&&['/ui/main/dashboards','/ui/access-denied'].includes(location.pathname))
    if(account.subject===fixture.admin.subject){const capabilities=await read('/capabilities');assert.equal(capabilities.subject,account.subject);assert.equal(capabilities.allowed,true);assert.equal(capabilities.runtimeApplicationClientId,fixture.currentApplicationClientId)}
    const identity={subjectHash:createHash('sha256').update(account.subject).digest('hex'),businessAdmin:account.subject===fixture.admin.subject}
    const loginEvents=(await page.diagnostics()).events.filter(event=>!previous.has(event.id))
    const authenticatedAt=loginEvents.findLast(event=>event.kind==='http-response'&&event.method==='POST'&&event.url===base+'/oidc/login'&&event.status===303)?.observedAt
    const logout=loginEvents.find(event=>event.kind==='http-response'&&event.url===base+'/oidc/logout'&&event.status===307)
    report.identityWindows??=[];report.identityWindows.push({id:'login-'+report.identityWindows.length,kind:'production-login',startedAt,finishedAt:new Date().toISOString(),authenticatedAt,logoutEventId:logout?.id,...identity,documentIds:[...new Set(loginEvents.map(event=>event.documentId))]})
    report.identityWindows.push({id:'session-'+report.identityWindows.length,kind:'authenticated-session',startedAt:new Date().toISOString(),initialDocumentId:(await source()).documentId,...identity})
    return source()
  }
  async function pickScopes(keys,kind='permission') {
    const control=selector('drawer-'+kind)+' [data-test="scope-picker"] .kel-select__wrapper'
    await page.click(control)
    const available=await page.evaluate(()=>[...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[role="option"]')].filter(node=>node.getClientRects().length).map(node=>({key:node.querySelector('code')?.textContent.trim(),selected:node.getAttribute('aria-selected')==='true'})))
    assert(available.length===fixture.records.scopes.length,'scope dropdown silently truncated real keys')
    for(const key of keys)assert(available.some(item=>item.key===key),'scope key absent from dropdown')
    for(const item of available)if(item.selected!==keys.includes(item.key))await page.click('[role="option"] code:text-is('+JSON.stringify(item.key)+')')
    await page.press(control,'Escape')
    await page.waitForFunction(()=>![...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[role="option"]')].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'))
    assert(await page.evaluate(kind=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-'+kind+'"]')?.getClientRects().length),kind),'closing scope select closed its parent drawer')
  }
  async function createPermission(path,collection,{key,name,scopeKeys,details=''}) {
    await open(path);await drawer('permission','[data-test="permission-add"]')
    await page.fill('[name="permission-key"]',key);await page.fill('[name="permission-name"]',name)
    await pickScopes(scopeKeys)
    if(path===external)await page.fill('[name="permission-details"]',details)
    await clickSave('[data-test="drawer-save"]',collection,'POST',[200])
    await login()
    const saved=await read(collection+'/'+key)
    assert.equal(saved.name,name);equal(saved.scopeKeys,scopeKeys)
    return saved
  }
  async function deletePermission(path,collection,key) {
    await open(path+'?permissionKey='+key);equal(await visibleRows('permission-row','data-permission-key'),[key])
    await page.click('[data-test="permission-delete"]')
    await clickSave('[data-test="delete-confirm"] .kel-button--danger',collection+'/'+key,'DELETE',[200])
    await login();await request(collection+'/'+key,'GET',undefined,undefined,[404])
  }
  async function oneTimeValue(kind) {
    const element=selector(kind==='password'?'temporary-password-once':'credential-once')+' .rbac-one-time-value'
    await page.waitForFunction(element=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector(element)?.textContent),element)
    const value=await page.evaluate(element=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector(element).textContent.trim(),element)
    page.redactSecrets([value]);secrets.push(value)
    assert(value.length>=16,'host-generated credential unexpectedly short')
    return value
  }
  async function closeDrawer(kind) {await page.focus('[data-test="drawer-'+kind+'"] .kel-drawer__close-btn');await page.press('[data-test="drawer-'+kind+'"] .kel-drawer__close-btn','Enter');await page.waitForFunction(kind=>!document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-'+kind+'"]'),kind)}
  async function toggleDrawerMaximize() {await page.focus('.rbac-editor-drawer .kel-drawer__header button.is-link');await page.press('.rbac-editor-drawer .kel-drawer__header button.is-link','Enter')}
  async function checkFocus(kind) {
    const drawerSelector=selector('drawer-'+kind)
    const focusable=drawerSelector+' .kel-drawer__close-btn'
    const focusableCount=await page.evaluate(selector=>[...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector(selector).querySelectorAll('button,input,textarea,select,a[href],[tabindex]')].filter(node=>node.getClientRects().length&&node.tabIndex>=0&&!node.matches(':disabled')&&!node.closest('[inert],[aria-hidden="true"]')).length,drawerSelector)
    assert(focusableCount>1)
    await page.focus(focusable)
    let wrapped=false
    for(let count=0;count<focusableCount+3;count++) {
      await page.pressFocused('Tab')
      assert(await page.evaluate(selector=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot;const active=root.activeElement;if(!root.querySelector(selector)?.contains(active))return false;const style=getComputedStyle(active),wrapper=active.closest('.kel-input__wrapper.is-focus,.kel-select__wrapper.is-focused'),focusStyle=wrapper&&getComputedStyle(wrapper);return style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>0||active.matches(':focus-visible')&&style.boxShadow!=='none'||Boolean(focusStyle&&focusStyle.boxShadow!=='none')},drawerSelector),'drawer keyboard focus escaped or is invisible')
      wrapped||=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot;return root.activeElement===root.querySelector('.rbac-editor-drawer .kel-drawer__close-btn')})
    }
    assert(wrapped,'native drawer Tab cycle never returned to its starting control')
    await page.focus(focusable);await page.pressFocused('Shift+Tab')
    assert(await page.evaluate(selector=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot;return root.querySelector(selector).contains(root.activeElement)},drawerSelector),'reverse Tab escaped native drawer')
    await page.pressFocused('Escape')
    await page.waitForFunction(selector=>!document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector(selector),drawerSelector)
    return {focusableCount,wrapped,reverseContained:true}
  }
  async function editPermission(permission,path=app) {
    await open(path+'?permissionKey='+encodeURIComponent(permission),'[data-test="application-permissions"]')
    equal(await visibleRows('permission-row','data-permission-key'),[permission],'exact permission filter')
    await drawer('permission','[data-test="permission-edit"]')
    assert(await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[name="permission-key"]').disabled),'permission key editable')
  }
  async function refreshReadonly(path,element) {await page.reload();await page.waitForFunction(({path,element})=>location.pathname===path&&document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector(element)&&document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('main')?.getAttribute('aria-busy')==='false',{path:'/ui/main/extensions/rbac/'+path,element});await readonly(element)}
  async function runAdditionalDirectoryCases() {
    await run('ui-group-retired-id-rejected',()=>ownedGroup(async({id,path,route})=>{
      await login();const before=await effectsBefore(),saved=await read(path);await note({beforeGroup:saved})
      await open(route,'[data-test="group-detail"]');await page.click('[data-test="group-detail"] .buttons button:last-child')
      await clickSave('[data-test="delete-confirm"] .kel-button--danger',path,'DELETE',[200]);await request(path,'GET',undefined,undefined,[404])
      await request('/application-groups','POST',{id,tenant:'main',displayName:'Retired identifier',description:''},undefined,[409])
      await request(path,'GET',undefined,undefined,[404]);await effectsUnchanged(before)
      return {retiredId:id,deletedViaUi:true,recreationRejected:true}
    }))
    for(const mode of ['next','previous','empty'])await run('ui-scope-delete-selection-'+mode,()=>ownedGroup(async({path,route})=>{
      const keys=mode==='empty'?['a']:['a','b','c']
      for(const key of keys)await addScope(path,key)
      const selected=mode==='previous'?'c':'a',expected=mode==='empty'?'':'b',before=await effectsBefore()
      await login();await open(route+'/scopes/'+selected,'[data-test="scope-detail"]')
      const deleteButton=await page.evaluate(selected=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,item=[...root.querySelectorAll('[data-test="scope-item"]')].find(node=>node.getAttribute('data-scope-key')===selected),button=item?.closest('li')?.querySelector('[data-test="scope-delete"]');if(!button)throw new Error('Selected scope delete absent');const parts=[];for(let node=button;node&&node.parentElement;node=node.parentElement)parts.unshift(node.tagName.toLowerCase()+':nth-child('+([...node.parentElement.children].indexOf(node)+1)+')');const selector=parts.join(' > ');if(root.querySelectorAll(selector).length!==1||root.querySelector(selector)!==button)throw new Error('Selected delete native path ambiguous');return selector},selected)
      await page.click(deleteButton)
      await clickSave('[data-test="delete-confirm"] .kel-button--danger',path+'/scopes/'+selected,'DELETE',[200])
      const target='/ui/main/extensions/rbac/'+route+'/scopes'+(expected?'/'+expected:'')
      await page.waitForFunction(target=>location.pathname===target&&document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false',target)
      const remaining=await all(path+'/scopes');await note({selected,expected,remaining,canonicalPath:(await source()).path})
      equal(remaining.map(item=>item.key),keys.filter(key=>key!==selected))
      await page.reload();await page.waitForFunction(target=>location.pathname===target&&document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false',target)
      const detail=await page.evaluate(()=>{const node=document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="scope-detail"]');return {key:node.querySelector('h2 code')?.textContent.trim()??'',text:node.textContent}})
      assert.equal(detail.key,expected);if(!expected)assert(detail.text.includes(accessControlUiText.en.noRows))
      await effectsUnchanged(before);return {selected,expected,refreshPersisted:true}
    }))
    for(const kind of ['application','subject','typed-policy'])await run('ui-scope-reference-'+kind+'-refused',async()=>{
      const key='ui-ref-'+randomBytes(5).toString('hex'),permissionKey='ui-ref-permission-'+randomBytes(5).toString('hex')
      await addScope(groupApi,key)
      let collection,originalGrant
      const cleanup=async()=>{
        if(kind==='subject'&&originalGrant)await setGrant(groupApi,{subject:fixture.subject},originalGrant.scopeKeys)
        else if(collection){const current=(await privateList(collection)).find(item=>item.key===permissionKey);if(current)await privateRequest(collection+'/'+permissionKey,'DELETE',undefined,current.revision)}
        const scope=(await privateList(groupApi+'/scopes')).find(item=>item.key===key);if(scope)await privateRequest(groupApi+'/scopes/'+key,'DELETE',undefined,scope.revision)
      }
      restores.push({id:'cleanup-reference-'+key,run:cleanup})
      try {
        let reference
        if(kind==='subject') {
          originalGrant=await privateRequest(groupApi+'/scope-grants/detail?subject='+encodeURIComponent(fixture.subject))
          await setGrant(groupApi,{subject:fixture.subject},[...originalGrant.scopeKeys,key]);reference='subject: '+fixture.subject
        }else {
          const applicationPath=kind==='application'?'/'+external:'/'+app,application=await privateRequest(applicationPath)
          collection=applicationPath+'/permissions'
          const input=kind==='application'?{key:permissionKey,name:'External scope reference',scopeKeys:[key],details:'No runtime authority'}:{...permissionInput((await privateList(permissionApi)).find(item=>item.grants.length)),key:permissionKey,name:'Actual typed scope reference',scopeKeys:[key]}
          await privateRequest(collection,'POST',input,application.revision);reference=(kind==='application'?fixture.clientId:fixture.currentApplicationClientId)+': '+permissionKey
        }
        await login();const before=await effectsBefore(),beforeScope=await read(groupApi+'/scopes/'+key);await note({reference,beforeScope})
        await open(group+'/scopes/'+key);await page.fill('[data-test="scope-sidebar"] input',key)
        await page.click('[data-test="scope-delete"]');await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="delete-confirm"]')))
        const blocked=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="delete-confirm"]');return {references:[...root.querySelectorAll('li code')].map(node=>node.textContent.trim()),destructive:Boolean(root.querySelector('.kel-button--danger'))}})
        await note({blocked});assert(blocked.references.includes(reference));assert.equal(blocked.destructive,false)
        await cancelConfirmation()
        const rejected=await request(groupApi+'/scopes/'+key,'DELETE',undefined,beforeScope.revision,[409]);await note({rejection:rejected.body})
        assert.equal(rejected.body?.code,'scope_in_use');assert(Array.isArray(rejected.body.references))
        const expectedReference=kind==='subject'?{kind:'subject',clientId:null,permissionKey:null,issuer:base,subject:fixture.subject}:{kind:'permission',clientId:kind==='application'?fixture.clientId:fixture.currentApplicationClientId,permissionKey,issuer:null,subject:null}
        assert(rejected.body.references.some(item=>Object.entries(expectedReference).every(([field,value])=>(item[field]??null)===value)),'production scope rejection omitted its typed reference DTO')
        equal(await read(groupApi+'/scopes/'+key),beforeScope);await effectsUnchanged(before)
        return {kind,reference,uiBlocked:true,productionDeleteStatus:409}
      }finally{await cleanup()}
    })
    for(const invalid of accessControlInvalidQueries)await run(invalid.id,async()=>{
      await login();const before=await effectsBefore(),permissions=await all(permissionApi)
      await open(app+'?'+invalid.query,'[data-test="request-error"]')
      await note({invalidQuery:invalid.query,observed:await source()})
      equal(await visibleRows('permission-row','data-permission-key'),[],'invalid query must not display unfiltered sensitive rows')
      assert(await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="request-error"] button'))),'invalid query has no actual clear entry')
      await page.click('[data-test="request-error"] button')
      await page.waitForFunction(()=>!document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="request-error"]'))
      const cleared=await source();assert.equal(cleared.path,'/ui/main/extensions/rbac/'+app);assert.equal(cleared.query,'')
      equal(await all(permissionApi),permissions);await effectsUnchanged(before)
      return {query:invalid.query,clearable:true,noPersistenceChange:true}
    })
    await run('ui-filter-same-field-and',async()=>{
      const permissions=await all(permissionApi);assert(permissions.length>1)
      const query=new URLSearchParams();for(const permission of permissions.slice(0,2))query.append('filter',JSON.stringify({field:'key',value:permission.key}))
      await open(app+'?'+query);equal(await visibleRows('permission-row','data-permission-key'),[])
      assert.equal(await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[data-test="filter-chip"]').length),2)
      await page.reload();await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false')
      equal(await visibleRows('permission-row','data-permission-key'),[])
      return {keys:permissions.slice(0,2).map(item=>item.key),semantics:'same-field AND',refresh:true}
    })
    await run('ui-filter-name-case-sensitive',async()=>{
      const permissions=await all(permissionApi),selected=permissions.find(item=>item.name!==item.name.toUpperCase());assert(selected)
      const observed=[]
      for(const name of [selected.name,selected.name.toUpperCase()]) {
        await open(app+'?'+new URLSearchParams({filter:JSON.stringify({field:'name',value:name}),size:'100'}))
        const expected=permissions.filter(item=>item.name.includes(name)).map(item=>item.key),actual=await visibleRows('permission-row','data-permission-key');equal(actual,expected)
        observed.push({name,ids:actual})
      }
      assert.notDeepEqual(observed[0].ids,observed[1].ids);return {observed}
    })
    await run('ui-filter-clear-all',async()=>{
      const permission=(await all(permissionApi))[0],query=new URLSearchParams({permissionKey:permission.key,filter:JSON.stringify({field:'name',value:permission.name}),size:'100'})
      await open(app+'?'+query);assert.equal(await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[data-test="filter-chip"]').length),2)
      await page.click('[data-test="application-permissions"] > .rbac-tags > button')
      await page.waitForFunction(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,p=new URL(location.href).searchParams;return root.querySelector('main')?.getAttribute('aria-busy')==='false'&&!root.querySelector('[data-test="filter-chip"]')&&['filter','scopeKeys','permissionKey','filterSubject','page'].every(key=>!p.has(key))})
      const final=await source(),search=new URLSearchParams(final.query);for(const key of ['filter','scopeKeys','permissionKey','filterSubject','page'])assert.equal(search.has(key),false)
      equal(await visibleRows('permission-row','data-permission-key'),(await all(permissionApi)).map(item=>item.key));return {final}
    })
    await run('ui-filter-valid-empty',async()=>{
      await open(app+'?permissionKey=missing-'+randomBytes(8).toString('hex'))
      equal(await visibleRows('permission-row','data-permission-key'),[])
      const observed=await state();assert(!await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="request-error"]'))));assert(observed.text.includes(accessControlUiText.en.noRows))
      return {empty:true,path:observed.path}
    })
    await run('ui-filter-cross-group-clear',async()=>{
      const other=fixture.records.projects.find(item=>item.id!==fixture.applicationGroupId),permission=(await all(permissionApi))[0];assert(other)
      await open(app+'?'+new URLSearchParams({permissionKey:permission.key,scopeKeys:fixture.scope,filter:JSON.stringify({field:'name',value:permission.name})}))
      await page.click('.rbac-detail-title button');await page.waitForFunction(()=>location.pathname==='/ui/main/extensions/rbac/application-groups')
      await page.fill('.ks-search input',other.id);await page.click(selector('group-card','data-group-id',other.id)+' .application-group-card-link')
      await page.waitForFunction(id=>location.pathname==='/ui/main/extensions/rbac/application-groups/'+id,other.id)
      const final=await source();assert.equal(final.query,'');await readonly('[data-test="group-detail"]');return {from:fixture.applicationGroupId,to:other.id,final}
    })
    await run('ui-filter-cross-application-clear',async()=>{
      const key='ui-cross-'+randomBytes(6).toString('hex'),application=await privateRequest('/'+app)
      await privateRequest(permissionApi,'POST',{key,name:'Only in source application',scopeKeys:[],description:'Filter isolation',enabled:true,grants:[],managementGrants:[]},application.revision)
      const cleanup=async()=>{const current=(await privateList(permissionApi)).find(item=>item.key===key);if(current)await privateRequest(permissionApi+'/'+key,'DELETE',undefined,current.revision)}
      restores.push({id:'cleanup-'+key,run:cleanup})
      try {
        await login();await open(app+'?permissionKey='+key);equal(await visibleRows('permission-row','data-permission-key'),[key])
        assert(!(await all(externalApi)).some(item=>item.key===key))
        await page.fill('[data-test="application-sidebar"] input',fixture.clientId);await page.click(selector('application-item','data-client-key',fixture.clientId))
        await page.waitForFunction(path=>location.pathname===path&&document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false','/ui/main/extensions/rbac/'+external)
        const final=await source();assert.equal(new URLSearchParams(final.query).has('permissionKey'),false)
        assert((await visibleRows('permission-row','data-permission-key')).length>0,'cross-application clear hid actual destination data')
        return {sourcePermissionKey:key,final}
      }finally{await cleanup()}
    })
    await run('ui-filter-expired-subject-revalidated',async()=>{
      const original=await privateRequest(groupApi+'/scope-grants/detail?subject='+encodeURIComponent(fixture.subject))
      const restore=()=>setGrant(groupApi,{subject:fixture.subject},original.scopeKeys);restores.push({id:'cleanup-expired-subject-filter',run:restore})
      try {
        await setGrant(groupApi,{subject:fixture.subject},[]);await login()
        const path='/ui/main/extensions/rbac/'+app;await page.goto(base+path+'?'+new URLSearchParams({filterSubject:fixture.subject,scopeKeys:fixture.scope}))
        await page.waitForFunction(({path,subject})=>location.pathname===path&&new URL(location.href).searchParams.get('filterSubject')===subject&&!new URL(location.href).searchParams.has('scopeKeys')&&document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false',{path,subject:fixture.subject})
        const actual=await source();await note({originalGrant:original,revokedGrant:await privateRequest(groupApi+'/scope-grants/detail?subject='+encodeURIComponent(fixture.subject)),actual})
        equal(await visibleRows('permission-row','data-permission-key'),[])
        equal(new URLSearchParams(actual.query).getAll('scopeKeys'),[],'expired scope must not remain an adopted active range')
        assert.equal(new URLSearchParams(actual.query).get('filterSubject'),fixture.subject,'empty subject intersection must retain its source instead of broadening the list')
        await page.reload()
        await page.waitForFunction(path=>location.pathname===path&&document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false',path)
        equal(await visibleRows('permission-row','data-permission-key'),[],'canonical empty-intersection URL broadened rows after reload')
        assert.equal(new URLSearchParams((await source()).query).get('filterSubject'),fixture.subject)
        return {subject:fixture.subject,revalidated:true,emptyIntersectionSourceRetained:true,reloadRemainsEmpty:true}
      }finally{await restore()}
    })
    await run('ui-pagination-last-row-delete',()=>ownedGroup(async({path,route})=>{
      const management=fixture.targetRuntime.management;await management.login()
      const registered=await rawRequest(management.client,'/oidc/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Shared UI pagination',redirect_uris:['http://127.0.0.1:19997/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code'],scope:'openid'})},[201])
      assert(registered.client_id&&!registered.client_secret)
      let parent=await privateRequest(path);await privateRequest(path+'/applications','POST',{clientId:registered.client_id,description:'',audiences:[]},parent.revision)
      const memberPath=path+'/applications/'+encoded(registered.client_id),collection=memberPath+'/permissions'
      const keys=Array.from({length:26},(_,index)=>'row-'+String(index).padStart(2,'0'))
      for(const key of keys){parent=await privateRequest(memberPath);await privateRequest(collection,'POST',{key,name:key,scopeKeys:[],details:''},parent.revision)}
      await login();await open(route+'/applications/'+encoded(registered.client_id)+'?page=2&size=25')
      equal(await visibleRows('permission-row','data-permission-key'),[keys.at(-1)])
      await page.click('[data-test="permission-delete"]');await clickSave('[data-test="delete-confirm"] .kel-button--danger',collection+'/'+keys.at(-1),'DELETE',[200])
      await page.waitForFunction(()=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot;return root?.querySelector('main')?.getAttribute('aria-busy')==='false'&&(new URL(location.href).searchParams.get('page')??'1')==='1'&&root.querySelectorAll('[data-test="permission-row"]').length===25})
      const actual=await source();await note({remaining:await all(collection),actual})
      assert.equal(new URLSearchParams(actual.query).get('page')??'1','1','deleting the last row must canonicalize the effective last page')
      equal(await visibleRows('permission-row','data-permission-key'),keys.slice(0,-1));return {deleted:keys.at(-1),remaining:25,final:actual}
    }))
  }
  async function runAdditionalAccountCases() {
    await run('ui-user-disable-preserves-grants',async()=>{
      const account=await preparedUser('ui-disabled')
      try {
        return await ownedGroup(async({path})=>{
          await addScope(path,'retained');await setGrant(path,account,['retained']);await setGrant(groupApi,account,[fixture.referenceScopeKey])
          const paths=[path,groupApi],beforeGrants=await Promise.all(paths.map(groupPath=>privateRequest(groupPath+'/scope-grants/detail?subject='+account.subject)))
          const oldClient=new ProductionOAuthClient(base);await oldClient.login(account.username,account.password)
          const businessPath='/api/v1/main/flows/search?'+new URLSearchParams({namespace:fixture.referenceNamespace,size:'1'})
          await rawRequest(oldClient,businessPath)
          await login();const before=await effectsBefore();await open('users?filterSubject='+account.subject)
          await page.click('[data-test="user-list"] .kel-table tbody tr .buttons button:nth-child(2)')
          await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false')
          const disabled=await privateRequest('/users/detail?subject='+account.subject);await note({disabled,beforeGrants});assert.equal(disabled.active,false)
          const afterGrants=await Promise.all(paths.map(groupPath=>privateRequest(groupPath+'/scope-grants/detail?subject='+account.subject)))
          const grantFields=value=>({issuer:value.issuer,subject:value.subject,scopeKeys:value.scopeKeys,revision:value.revision})
          equal(afterGrants.map(grantFields),beforeGrants.map(grantFields),'disable removed or rewrote retained grants')
          const start=performance.now(),samples=[]
          do {
            const response=await oldClient.request(businessPath);samples.push({elapsedMs:Math.ceil(performance.now()-start),status:response.status});await response.body?.cancel()
            if([401,403].includes(response.status))break
            assert.equal(response.status,200);await new Promise(resolve=>setTimeout(resolve,100))
          }while(performance.now()-start<60000)
          await note({revocationSamples:samples,afterGrants});assert([401,403].includes(samples.at(-1).status),'disabled account old session retained access after 60 seconds')
          await open('users?filterSubject='+account.subject);await page.click('[data-test="user-list"] .kel-table tbody tr .buttons button:nth-child(2)')
          await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false')
          assert.equal((await privateRequest('/users/detail?subject='+account.subject)).active,true)
          const fresh=new ProductionOAuthClient(base);await fresh.login(account.username,account.password);await rawRequest(fresh,businessPath)
          equal((await Promise.all(paths.map(groupPath=>privateRequest(groupPath+'/scope-grants/detail?subject='+account.subject)))).map(grantFields),beforeGrants.map(grantFields))
          await effectsUnchanged(before);return {subject:account.subject,groups:paths,disabledViaUi:true,enabledViaUi:true,oldSessionRevoked:true,freshLoginAllowed:true}
        })
      }finally{await account.cleanup()}
    })
    await run('ui-subject-delete-keeps-account',async()=>{
      const account=await preparedUser('ui-subject-delete')
      try {
        await setGrant(groupApi,account,[fixture.referenceScopeKey]);await login()
        const user=await privateRequest('/users/detail?subject='+account.subject),grant=await privateRequest(groupApi+'/scope-grants/detail?subject='+account.subject),before=await effectsBefore()
        await note({beforeUser:user,beforeGrant:grant});await open(group+'/scope-grants?filterSubject='+account.subject)
        equal(await visibleRows('subject-row','data-subject'),[account.subject])
        await page.click('[data-test="subject-list"] .kel-table tbody tr .buttons button:last-child')
        await clickSave('[data-test="delete-confirm"] .kel-button--danger',groupApi+'/scope-grants/detail?subject='+account.subject,'DELETE',[200])
        const retained=await privateRequest('/users/detail?subject='+account.subject);equal(retained,user,'subject deletion changed standard account')
        assert(!(await privateList(groupApi+'/scope-grants')).some(item=>item.subject===account.subject))
        const client=new ProductionOAuthClient(base);const loginResult=await client.login(account.username,account.password);assert.equal(loginResult.authenticated,true)
        const denied=await client.request('/api/v1/main/flows/search?size=1');await denied.body?.cancel();assert([401,403].includes(denied.status))
        await note({retainedUser:retained,accountLogin:loginResult,businessStatus:denied.status});await effectsUnchanged(before)
        return {subject:account.subject,standardAccountRetained:true,groupMembershipDeleted:true}
      }finally{await account.cleanup()}
    })
    await run('ui-subject-candidate-exclusions',async()=>{
      const inactive=await preparedUser('ui-inactive-candidate'),created=[]
      const cleanup=async()=>{for(const subject of created){let current;try{current=await privateRequest('/users/detail?subject='+subject)}catch(error){if(String(error.message).includes('management HTTP 404 GET'))continue;throw error}await privateRequest('/users/detail?subject='+subject,'DELETE',undefined,current.revision)}await inactive.cleanup()}
      restores.push({id:'cleanup-candidate-enumeration',run:cleanup})
      try {
        let user=await privateRequest('/users/detail?subject='+inactive.subject)
        await privateRequest('/users/state','PUT',{subject:inactive.subject,active:false},user.revision)
        for(let index=0;index<26;index++) {
          const username='ui-candidate-'+randomBytes(6).toString('hex')
          const receipt=await privateRequest('/users','POST',{username,name:'Candidate '+index,email:''})
          assert.equal(receipt.subject,username);created.push(username);secrets.push(receipt.temporaryPassword);page.redactSecrets([receipt.temporaryPassword]);delete receipt.temporaryPassword
        }
        const users=await privateList('/users'),grants=await privateList(groupApi+'/scope-grants'),expected=users.filter(item=>item.active&&!grants.some(grant=>grant.subject===item.subject)).map(item=>item.subject)
        assert(expected.length>25);await note({expectedCandidates:expected,excludedAssigned:fixture.subject,excludedInactive:inactive.subject})
        await login();await open(group+'/scope-grants');await drawer('subject','[data-test="subject-add"]')
        await page.click('[data-test="drawer-subject"] .kel-form-item:first-of-type .kel-select__wrapper')
        const actual=await page.evaluate(()=>[...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[role="option"]')].filter(node=>node.getClientRects().length&&node.getAttribute('aria-disabled')!=='true').map(node=>node.textContent.trim()))
        equal(actual,expected,'subject candidate enumeration omitted active users or leaked assigned/inactive accounts')
        const target=created.at(-1)
        await page.fill('[data-test="drawer-subject"] .kel-form-item:first-of-type input',target)
        await page.click('[role="option"]:text-is('+JSON.stringify(target)+')')
        assert((await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-subject"]').textContent)).includes(target))
        await clickDrawerHeader();await confirmDiscard()
        return {selectedAfterSearch:target,candidates:actual,excludedInactive:inactive.subject,excludedAlreadyAssigned:fixture.subject}
      }finally{await cleanup()}
    })
    await run('ui-user-delete-all-groups',async()=>{
      const account=await preparedUser('ui-all-groups-delete')
      try {return await ownedGroup(async first=>ownedGroup(async second=>{
        for(const current of [first,second]){await addScope(current.path,'assigned');await setGrant(current.path,account,['assigned'])}
        await setGrant(groupApi,account,[fixture.referenceScopeKey]);await login()
        const before=await effectsBefore(),beforeGrants=await Promise.all([groupApi,first.path,second.path].map(path=>privateRequest(path+'/scope-grants/detail?subject='+account.subject)))
        await note({beforeGrants});await open('users?filterSubject='+account.subject);equal(await visibleRows('user-row','data-subject'),[account.subject])
        await page.click('[data-test="user-delete"]');await clickSave('[data-test="delete-confirm"] .kel-button--danger','/users/detail?subject='+account.subject,'DELETE',[204])
        await login()
        await request('/users/detail?subject='+account.subject,'GET',undefined,undefined,[404])
        const groups=await privateList('/application-groups'),remaining=[]
        for(const current of groups)for(const grant of await privateList('/application-groups/'+current.id+'/scope-grants'))if(grant.subject===account.subject)remaining.push({groupId:current.id,grant})
        await note({checkedGroups:groups.map(item=>item.id),remaining});equal(remaining,[],'user deletion left cross-group memberships')
        await effectsUnchanged(before);return {subject:account.subject,deletedThroughUi:true,allGroupMembershipsRemoved:true}
      }))}finally{await account.cleanup()}
    })
    await run('ui-user-delete-execution-retained',async()=>{
      const observerScope=fixture.targetRuntime.planned.observerScope;assert(observerScope)
      const executionGrant=(await privateList(permissionApi)).filter(permission=>permission.enabled&&permission.scopeKeys.includes(observerScope)).flatMap(permission=>permission.grants).find(grant=>grant.scope==='NAMESPACE'&&grant.resource==='FLOW'&&grant.allIds&&grant.actions.includes('EXECUTE'))
      assert(executionGrant&&/^scope\.acceptance\.[a-z0-9_.-]+$/.test(executionGrant.namespace),'actual observer policy must authorize an owned history-test namespace')
      const account=await preparedUser('ui-history-delete'),management=fixture.targetRuntime.management
      const namespace=executionGrant.namespace,flowId='ui-user-history-'+randomBytes(5).toString('hex');let executionId
      let executionCleaned=false,flowCleaned=false
      const cleanup=async()=>{await management.login();if(executionId&&!executionCleaned){await rawRequest(management.client,'/api/v1/main/executions/'+executionId,{method:'DELETE'},[200,204,404]);executionCleaned=true}if(!flowCleaned){await rawRequest(management.client,'/api/v1/main/flows/'+namespace+'/'+flowId,{method:'DELETE'},[200,204,404]);flowCleaned=true}await account.cleanup()}
      restores.push({id:'cleanup-'+flowId,run:cleanup})
      try {
        await management.login()
        const source='id: '+flowId+'\nnamespace: '+namespace+'\ntasks:\n  - id: retained\n    type: io.kestra.plugin.core.log.Log\n    message: Shared UI account deletion history\n'
        await rawRequest(management.client,'/api/v1/main/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:source},[200,201])
        await setGrant(groupApi,account,[observerScope])
        const actor=new ProductionOAuthClient(base);await actor.login(account.username,account.password)
        const identity=await actor.verifiedUiIdentity({applicationGroupId:fixture.applicationGroupId,subject:account.subject,audience:fixture.currentApplicationClientId});assert(identity.applicationGroupScopes.includes(observerScope))
        const started=await rawRequest(actor,'/api/v1/main/executions/'+namespace+'/'+flowId,{method:'POST',body:new FormData()},[200,201]);assert(started.id);assert.equal(started.namespace,namespace);assert.equal(started.flowId,flowId);executionId=started.id
        let terminal;const deadline=Date.now()+60000
        do{terminal=await rawRequest(actor,'/api/v1/main/executions/'+executionId);if(terminal.state?.current==='SUCCESS')break;assert(!['FAILED','KILLED','CANCELLED'].includes(terminal.state?.current));await new Promise(resolve=>setTimeout(resolve,100))}while(Date.now()<deadline)
        assert.equal(terminal.state?.current,'SUCCESS');await note({execution:{id:executionId,namespace,flowId,state:terminal.state.current},executionActor:account.subject})
        await fixture.targetRuntime.effects.waitForStable();terminal=await rawRequest(actor,'/api/v1/main/executions/'+executionId);assert.equal(terminal.state?.current,'SUCCESS')
        await login();const before=await effectsBefore()
        await open('users?filterSubject='+account.subject);await page.click('[data-test="user-delete"]')
        await clickSave('[data-test="delete-confirm"] .kel-button--danger','/users/detail?subject='+account.subject,'DELETE',[204])
        await management.login();const retained=await rawRequest(management.client,'/api/v1/main/executions/'+executionId)
        equal(retained,terminal,'deleting the execution actor modified persisted execution history')
        await effectsUnchanged(before);return {subject:account.subject,executionId,executionRetained:true}
      }finally{await cleanup()}
    })
    await run('ui-user-delete-audit-retained',async()=>{
      requireMethods(fixture.targetRuntime,['userAuditEvidence'],'targetRuntime')
      const readAudit=fixture.targetRuntime.userAuditEvidence;requireMethods(readAudit,['forManagement'],'public audit reader')
      const account=await preparedUser('ui-audit-retained')
      const assertHistory=(original,current)=>{
        assert(original.records.length>0,'nonempty real pre-delete audit history required')
        assert.equal(current.status,200);assert.equal(current.readAllAuthorized,true)
        for(const event of original.records) {
          const retained=current.records.find(item=>item.id===event.id);assert(retained,'original audit event disappeared')
          assert.equal(retained.sha256,event.sha256,'original audit event changed');assert.equal(retained.targetSubject,account.subject);assert.equal(retained.actorSubject,fixture.admin.subject)
        }
      }
      try {return await ownedGroup(async first=>{
        let secondGroup,beforeFirst,beforeSecond,afterFirst,afterSecond
        await ownedGroup(async second=>{
          secondGroup=second
          for(const item of [first,second]){await addScope(item.path,'assigned');await setGrant(item.path,account,['assigned'])}
          await login();const beforeEffects=await effectsBefore()
          for(const active of [false,true]) {
            await open('users?filterSubject='+account.subject)
            await page.click('[data-test="user-list"] .kel-table tbody tr .buttons button:nth-child(2)')
            await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false')
            const actual=await privateRequest('/users/detail?subject='+account.subject);assert.equal(actual.active,active)
          }
          beforeFirst=await readAudit({subject:account.subject,groupId:first.id});beforeSecond=await readAudit({subject:account.subject,groupId:second.id})
          await note({auditBefore:{first:beforeFirst,second:beforeSecond}})
          for(const history of [beforeFirst,beforeSecond]) {
            assert.equal(history.source,'owned-production-plugin-audit-read');assert.equal(history.status,200);assert.equal(history.readAllAuthorized,true);assert(history.records.length>0)
            for(const operation of ['ACCOUNT_DEACTIVATE','ACCOUNT_ACTIVATE'])assert(history.records.some(event=>event.operation===operation&&event.targetSubject===account.subject&&event.actorSubject===fixture.admin.subject),'real UI state change did not create the required historical audit event')
          }
          await open('users?filterSubject='+account.subject);await page.click('[data-test="user-delete"]')
          await clickSave('[data-test="delete-confirm"] .kel-button--danger','/users/detail?subject='+account.subject,'DELETE',[204])
          await request('/users/detail?subject='+account.subject,'GET',undefined,undefined,[404])
          afterFirst=await readAudit({subject:account.subject,groupId:first.id});afterSecond=await readAudit({subject:account.subject,groupId:second.id})
          await note({auditAfter:{first:afterFirst,second:afterSecond}})
          for(const [original,current]of [[beforeFirst,afterFirst],[beforeSecond,afterSecond]]) {
            assertHistory(original,current)
            const oldIds=new Set(original.records.map(event=>event.id))
            assert(current.records.some(event=>!oldIds.has(event.id)&&event.operation==='ACCOUNT_DELETE'&&event.targetSubject===account.subject&&event.actorSubject===fixture.admin.subject),'new ACCOUNT_DELETE event missing; it cannot replace original history')
          }
          await effectsUnchanged(beforeEffects)
        })
        const retired=await readAudit({subject:account.subject,groupId:secondGroup.id});assertHistory(beforeSecond,retired)
        await note({retiredGroupAudit:retired})
        const readerAccount=fixture.accessAccounts?.['identity-read'];assert(readerAccount)
        const readOnly=readAudit.forManagement(new ApplicationGroupManagement(base,readerAccount))
        const readableFirst=await readOnly({subject:account.subject,groupId:first.id}),readableRetired=await readOnly({subject:account.subject,groupId:secondGroup.id})
        assertHistory(beforeFirst,readableFirst);assertHistory(beforeSecond,readableRetired)
        for(const current of [readableFirst,readableRetired]) {
          assert.equal(current.actorSubject,readerAccount.subject);assert.equal(current.authorizedTotal,retired.authorizedTotal)
          equal(current.authorizedItems.map(event=>({id:event.id,sha256:event.sha256})),retired.authorizedItems.map(event=>({id:event.id,sha256:event.sha256})),'issuer-wide IDENTITY.READ must see the same actual issuer history, including retired groups')
        }
        const denials=[]
        for(const actor of [fixture.accessAccounts['identity-manage'],fixture.accessAccounts['local-read'],fixture.zeroAccount]) {
          assert(actor);const restricted=readAudit.forManagement(new ApplicationGroupManagement(base,actor))
          const denied=await restricted({subject:account.subject,groupId:first.id})
          assert.equal(denied.actorSubject,actor.subject);assert.equal(denied.status,403);assert.equal(denied.readAllAuthorized,false);assert.equal(denied.authorizedTotal,null)
          denials.push(denied)
        }
        await note({identityRead:{first:readableFirst,retired:readableRetired},auditReadDenials:denials})
        return {subject:account.subject,originalActorSubject:fixture.admin.subject,groups:[first.id,secondGroup.id],nonemptyOriginalHistoryRetained:true,newDeleteSeparate:true,issuerWideReadAndTotalsVerified:true,retiredGroupRetained:true,manageOnlyAndNoReadRejected:true,executionIdNotRequired:true}
      })}finally{await account.cleanup()}
    })
  }
  async function runAdditionalInteractionCases() {
    for(const plan of drawerPlans()) {
      await run('ui-drawer-'+plan.kind+'-backdrop',async()=>{
        requireMethods(page,['clickAt'],'shared adapter')
        await page.setViewport({width:1280,height:900});const before=await effectsBefore(),draft='backdrop-'+randomBytes(5).toString('hex')
        await dirtyDrawer(plan,draft);const entered=await drawerDraft(plan),point=await clickBackdrop(plan.kind)
        await page.waitForFunction(discardConfirmationVisible)
        await cancelConfirmation('discard-confirm');assert.equal(await drawerDraft(plan),entered,'backdrop cancellation lost draft')
        await clickBackdrop(plan.kind);await confirmDiscard()
        await page.waitForFunction(kind=>!document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-'+kind+'"]'),plan.kind)
        await effectsUnchanged(before);return {kind:plan.kind,point,cancelRetainedDraft:true,confirmedDiscard:true}
      })
      await run('ui-drawer-'+plan.kind+'-maximize',async()=>{
        await page.setViewport({width:1280,height:900})
        await page.goto(base+fixture.references.kvPath);await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="kv-add"]')?.getClientRects().length))
        await page.click('[data-test="kv-add"]');await waitForNativeStyleSettlement(page,{drawer:'.kel-drawer.open'},{shadow:false})
        await page.focus('.kel-drawer.open .kel-drawer__header button.is-link');await page.press('.kel-drawer.open .kel-drawer__header button.is-link','Enter')
        await page.waitForFunction(()=>document.querySelector('.kel-drawer.open')?.classList.contains('full-screen'))
        await waitForNativeStyleSettlement(page,{drawer:'.kel-drawer.open'},{shadow:false})
        const nativeMaximized=await page.evaluate(()=>{const n=document.querySelector('.kel-drawer.open'),b=n.getBoundingClientRect();return {width:b.width,left:b.left,right:b.right,viewport:innerWidth}})
        await clickDrawerHeader({shadow:false});await page.waitForFunction(()=>!document.querySelector('.kel-drawer.open'))
        await open(plan.path);await drawer(plan.kind,plan.trigger)
        const geometry=()=>page.evaluate(kind=>{const box=document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-'+kind+'"]').getBoundingClientRect();return {width:box.width,left:box.left,right:box.right,viewport:innerWidth}},plan.kind)
        const initial=await geometry();assert(initial.width>0&&initial.width<=initial.viewport)
        await toggleDrawerMaximize();await page.waitForFunction(({kind,width})=>{const n=document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-'+kind+'"]');return n.classList.contains('full-screen')&&Math.abs(n.getBoundingClientRect().width-width)<=2},{kind:plan.kind,width:nativeMaximized.width})
        const maximized=await geometry();await toggleDrawerMaximize()
        await page.waitForFunction(({kind,width})=>Math.abs(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-'+kind+'"]').getBoundingClientRect().width-width)<=2,{kind:plan.kind,width:initial.width})
        const restored=await geometry();await closeDrawer(plan.kind);return {kind:plan.kind,initial,maximized,restored,nativeMaximized,source:'actual-native-drawer-geometry'}
      })
      await run('ui-drawer-'+plan.kind+'-history-discard',async()=>{
        await login()
        if(plan.kind==='group'){await open(group);await page.click('.rbac-detail-title button')}
        else if(plan.kind==='user') {
          await open('application-groups')
          const tabs=await page.evaluate(()=>[...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[role="tab"]')].map(node=>node.textContent.trim()));assert.equal(tabs.length,2)
          await page.click('[role="tab"]:text-is('+JSON.stringify(tabs[1])+')')
        }else {
          await open(group);await page.click('.rbac-statistics button:nth-child('+(plan.kind==='subject'?3:2)+')')
          if(plan.kind==='permission') {
            await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('[data-test="application-sidebar"]')))
            await page.fill('[data-test="application-sidebar"] input',fixture.currentApplicationClientId);await page.click(selector('application-item','data-client-key',fixture.currentApplicationClientId))
          }
        }
        await page.waitForFunction(path=>location.pathname===path&&document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false','/ui/main/extensions/rbac/'+plan.path)
        const before=await effectsBefore(),current=await source(),draft='history-'+randomBytes(5).toString('hex')
        await dirtyDrawer(plan,draft,{navigate:false});const entered=await drawerDraft(plan),mac=await page.evaluate(()=>/Mac/.test(navigator.platform))
        await page.history('back')
        await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('[data-test="discard-confirm"]')))
        await cancelConfirmation('discard-confirm');assert.equal((await source()).path,current.path);assert.equal(await drawerDraft(plan),entered)
        await page.history('back');await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('[data-test="discard-confirm"]')))
        await confirmDiscard();await page.waitForFunction(path=>location.pathname!==path,current.path)
        const destination=await source();await note({origin:current,destination});await effectsUnchanged(before)
        return {kind:plan.kind,cancelRetainedDraft:true,realBrowserHistory:true,discardNavigated:true}
      })
    }
    for(const kind of ['group','scope','application'])await run('ui-inline-'+kind+'-tab-discard',async()=>{
      await login()
      const path=kind==='group'?group:kind==='scope'?group+'/scopes/'+fixture.scope:app,detail='[data-test="'+(kind==='group'?'group':kind==='scope'?'scope':'application')+'-detail"]'
      await open(path);await page.click(kind==='group'?'[data-test="group-edit"]':detail+' > button')
      const input=detail+' textarea',value='inline-tab-'+randomBytes(5).toString('hex'),before=await effectsBefore()
      await page.fill(input,value)
      const tabs=await page.evaluate(()=>[...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[role="tab"]')].map(node=>({text:node.textContent.trim(),selected:node.getAttribute('aria-selected')==='true'})))
      const target=tabs.find(tab=>!tab.selected);assert(target)
      await page.click('[role="tab"]:text-is('+JSON.stringify(target.text)+')')
      await page.waitForFunction(discardConfirmationVisible)
      await cancelConfirmation('discard-confirm');assert.equal(await page.evaluate(input=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector(input)?.value,input),value)
      assert.equal((await source()).path,'/ui/main/extensions/rbac/'+path,'cancel changed the host route')
      const selected=await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim())
      assert.equal(selected,tabs.find(tab=>tab.selected)?.text,'cancel changed the native controlled active tab')
      await page.click('[role="tab"]:text-is('+JSON.stringify(target.text)+')');await confirmDiscard()
      await page.waitForFunction(path=>location.pathname!==path,'/ui/main/extensions/rbac/'+path)
      await effectsUnchanged(before);return {kind,targetTab:target.text,draftDiscarded:true}
    })
    await run('ui-inline-sidebar-draft-discard',async()=>{
      const scopes=await all(groupApi+'/scopes');assert(scopes.length>1);const current=scopes[0],other=scopes[1]
      const original=await read(groupApi+'/scopes/'+current.key);await note({beforeScope:original})
      await open(group+'/scopes/'+current.key);await page.click('[data-test="scope-detail"] > button')
      const value='sidebar-'+randomBytes(5).toString('hex'),before=await effectsBefore();await page.fill('[data-test="scope-detail"] textarea',value)
      await page.fill('[data-test="scope-sidebar"] input',other.key);await page.click(selector('scope-item','data-scope-key',other.key))
      await page.waitForFunction(discardConfirmationVisible)
      await cancelConfirmation('discard-confirm');assert.equal(await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="scope-detail"] textarea')?.value),value)
      await page.click(selector('scope-item','data-scope-key',other.key));await confirmDiscard()
      await page.waitForFunction(key=>location.pathname.endsWith('/scopes/'+key),other.key)
      equal(await read(groupApi+'/scopes/'+current.key),original);await effectsUnchanged(before);return {from:current.key,to:other.key,cancelPreservedDraft:true}
    })
    await run('ui-saving-drawer-interaction-lock',async()=>{
      const barrier=fixture.targetRuntime?.uiWriteBarrier;requireMethods(barrier,['acquire','waitForBlocked','release'],'targetRuntime.uiWriteBarrier');requireMethods(page,['clickAt'],'shared adapter')
      await login();await page.setViewport({width:1280,height:900})
      const permission=(await all(permissionApi)).find(item=>item.scopeKeys.includes(fixture.scope)),path=permissionApi+'/'+permission.key,original=permissionInput(permission)
      const restore=async()=>{const current=(await privateList(permissionApi)).find(item=>item.key===permission.key);await privateRequest(path,'PUT',original,current.revision)}
      restores.push({id:'cleanup-saving-interaction-permission',run:restore})
      await editPermission(permission.key);const draft='Saving interaction '+randomBytes(5).toString('hex');await page.fill('[name="permission-description"]',draft)
      await page.waitForFunction(()=>{const button=document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('[data-test="drawer-save"]');return button?.getClientRects().length&&!button.disabled})
      const point=await backdropPoint('permission')
      const origin=await source(),events=new Set((await page.diagnostics()).events.map(event=>event.id)),before=await effectsBefore()
      const lease=await barrier.acquire({path:api+path,method:'PUT'});assert(lease?.operationId)
      let blocked,locked,released,interactionFailure,responseFailure
      try {
        try {
          await page.click('[data-test="drawer-save"]')
          blocked=await barrier.waitForBlocked({operationId:lease.operationId})
          await page.pressFocused('Escape');await page.clickAt(point)
          locked=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,close=root.querySelector('.rbac-editor-drawer .kel-drawer__close-btn');return {path:location.pathname,timeOrigin:performance.timeOrigin,busy:root.querySelector('[data-test="drawer-permission"]')?.getAttribute('aria-busy'),closeDisabled:!close||close.disabled===true,saveDisabled:root.querySelector('[data-test="drawer-save"]')?.disabled,fieldsetDisabled:root.querySelector('[data-test="drawer-permission"] fieldset')?.disabled,discardOpen:[...root.querySelectorAll('[data-test="discard-confirm"]')].some(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden')}})
        }catch(error){interactionFailure=error}
        finally{released=await barrier.release({operationId:lease.operationId})}
        await note({barrier:lease,blocked,locked,released,backdropPoint:point})
        try{await nativeResponse(path,'PUT',[200],events,origin)}catch(error){responseFailure=error}
        if(interactionFailure)throw interactionFailure
        assert.equal(released?.released,true);assert.equal(released.expired,false,'owned write barrier exceeded its production-timeout-safe holding window')
        if(responseFailure)throw responseFailure
        assert.equal(blocked?.blocked,true);assert.equal(blocked.operationId,lease.operationId)
        assert.deepEqual(locked,{path:origin.path,timeOrigin:origin.timeOrigin,busy:'true',closeDisabled:true,saveDisabled:true,fieldsetDisabled:true,discardOpen:false})
        assert.equal((await page.diagnostics()).events.filter(event=>!events.has(event.id)&&event.kind==='request'&&event.url===base+api+path&&event.method==='PUT').length,1)
        const saved=await read(path);await note({savedPermission:permissionInput(saved)});assert.equal(saved.description,draft);assert(saved.revision>permission.revision)
        await effectsUnchanged(before);return {realWriteBlocked:true,escapeAndBackdropRejected:true,exactlyOneMutation:true,savedRevision:saved.revision}
      }finally{if(!released)await barrier.release({operationId:lease.operationId});await restore()}
    })
    for(const mode of ['cancel','failure','focus'])await run(mode==='focus'?'ui-delete-focus-fallback':'ui-delete-'+mode+'-no-side-effects',()=>ownedGroup(async({path,route})=>{
      const scope=await addScope(path,'delete-target');await login();const before=await effectsBefore()
      await open(route+'/scopes/'+scope.key)
      const focusReference='__rbacDeleteFocus'+randomBytes(12).toString('hex')
      if(mode==='focus')assert(await page.evaluate(key=>{
        const root=document.querySelector('[data-test="extension-container"]').shadowRoot
        const trigger=root.querySelector('[data-test="scope-delete"]'),fallback=root.querySelector('[data-focus-fallback]')??root.querySelector('[data-test="access-control-root"]')
        if(!trigger?.isConnected||!fallback?.isConnected||trigger===fallback)return false
        window[key]={trigger,fallback,root,timeOrigin:performance.timeOrigin}
        return true
      },focusReference),'delete focus test requires the real connected trigger and an explicit distinct fallback')
      await page.click('[data-test="scope-delete"]')
      await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="delete-confirm"]')))
      assert(await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="delete-confirm"]'),button=root.querySelector('.kel-button--danger');return Boolean(button?.textContent.trim())&&!button.disabled&&root.textContent.includes('delete-target')}),'delete confirmation lacks native destructive action or exact target')
      if(mode==='cancel'){await cancelConfirmation();equal(await read(path+'/scopes/'+scope.key),scope)}
      else if(mode==='failure') {
        await privateRequest(path+'/scopes/'+scope.key,'PUT',{key:scope.key,name:'Concurrent winner',description:scope.description},scope.revision)
        const winner=await privateRequest(path+'/scopes/'+scope.key);await note({concurrentWinner:winner})
        await clickSave('[data-test="delete-confirm"] .kel-button--danger',path+'/scopes/'+scope.key,'DELETE',[412])
        equal(await read(path+'/scopes/'+scope.key),winner);assert(await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="delete-confirm"] [data-test="request-error"]'))));await cancelConfirmation()
      }else {
        try {
          await clickSave('[data-test="delete-confirm"] .kel-button--danger',path+'/scopes/'+scope.key,'DELETE',[200])
          await page.waitForFunction(key=>{const saved=window[key];return Boolean(saved&&saved.timeOrigin===performance.timeOrigin&&!saved.trigger.isConnected)},focusReference)
          await page.waitForFunction(key=>{
            const saved=window[key]
            const confirmationVisible=[...saved.root.querySelectorAll('[data-test="delete-confirm"]')].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden')
            const fallback=saved.root.querySelector('[data-test="scope-sidebar"] [data-focus-fallback]')??saved.root.querySelector('[data-focus-fallback]')??saved.root.querySelector('[data-test="access-control-root"]')
            return Boolean(saved&&saved.timeOrigin===performance.timeOrigin&&!saved.trigger.isConnected&&fallback?.isConnected&&!confirmationVisible&&saved.root.activeElement===fallback)
          },focusReference)
        }finally {
          await note({deleteFocus:await page.evaluate(key=>{
            const saved=window[key]
            if(!saved)return {referenceMissing:true}
            const state={sameDocument:saved.timeOrigin===performance.timeOrigin,originalTriggerDisconnected:!saved.trigger.isConnected,fallbackConnected:saved.fallback.isConnected,focusOnOriginalFallback:saved.root.activeElement===saved.fallback,focusOnCurrentFallback:saved.root.activeElement===(saved.root.querySelector('[data-test="scope-sidebar"] [data-focus-fallback]')??saved.root.querySelector('[data-focus-fallback]')??saved.root.querySelector('[data-test="access-control-root"]')),confirmationVisible:[...saved.root.querySelectorAll('[data-test="delete-confirm"]')].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'),triggerDataTest:saved.trigger.getAttribute('data-test'),fallbackDataTest:saved.fallback.getAttribute('data-test')}
            delete window[key]
            return state
          },focusReference)})
        }
        assert(!(await all(path+'/scopes')).length)
      }
      await effectsUnchanged(before);return {mode,target:scope.key,verifiedPersistence:true}
    }))
  }
  async function withRotatedSecret(operation) {
    const controls=fixture.credentialControls??fixture.targetRuntime?.credentialControls
    requireMethods(controls,['verifySecret'],'credentialControls');requireMethods(page,['responseMetadata'],'shared adapter')
    assert(controls.clientId&&controls.clientId!==fixture.currentApplicationClientId)
    await login()
    const path=groupApi+'/applications/'+encoded(controls.clientId),before=await read(path+'/credentials')
    assert.equal(before.clientType,'confidential');assert.equal(before.rotationMode,'online')
    await open(group+'/applications/'+encoded(controls.clientId));const baseline=new Set((await page.diagnostics()).events.map(event=>event.id))
    await page.click('[data-test="credential-rotate"]');const secret=await oneTimeValue('secret')
    try {
      const response=(await page.diagnostics()).events.find(event=>!baseline.has(event.id)&&event.kind==='http-response'&&event.method==='POST'&&event.url===base+api+path+'/credentials/rotate');assert(response)
      const metadata=await page.responseMetadata({requestId:response.requestId,documentId:response.documentId,url:response.url})
      assert.equal(metadata.status,200);assert.equal(metadata.documentId,response.documentId);assert.equal(metadata.requestId,response.requestId);assert.equal(metadata.url,response.url);assert(/(?:^|,)\s*no-store\s*(?:,|$)/i.test(metadata.cacheControl))
      const protocol=await controls.verifySecret({clientId:controls.clientId,newSecret:secret})
      assert.equal(protocol.transport,'production-oidc');assert.equal(protocol.newSecretAccepted,true);assert.equal(protocol.oldSecretAccepted,false)
      await note({rotationMetadata:metadata,protocol})
      return await operation({secret,path,clientId:controls.clientId,before})
    }catch(error){if(typeof page.captureFailure==='function')await note({originalFailureArtifact:await page.captureFailure(error,currentCase+'-before-secret-cleanup')});throw error}
    finally {
      if(await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('[data-test="credential-once"]'))))await page.click('[data-test="credential-once"] .kel-button--primary')
    }
  }
  async function runAdditionalSecretCases() {
    await run('ui-secret-csrf-rejected',async()=>{
      const controls=fixture.credentialControls??fixture.targetRuntime?.credentialControls;assert(controls?.clientId)
      await login();const path=groupApi+'/applications/'+encoded(controls.clientId)+'/credentials',beforeCredentials=await read(path),before=await effectsBefore(),document=await source()
      assert.equal(beforeCredentials.clientType,'confidential');assert.equal(beforeCredentials.rotationMode,'online')
      const previous=new Set((await page.diagnostics()).events.map(event=>event.id))
      const rejected=await page.evaluate(async({path,revision})=>{const response=await fetch(path,{method:'POST',credentials:'same-origin',redirect:'error',headers:{Accept:'application/json','If-Match':'"'+revision+'"'}});if(response.status!==403){await response.body?.cancel();return {status:response.status}}const error=await response.json().catch(()=>null);return {status:response.status,code:error?.code}},{path:api+path+'/rotate',revision:beforeCredentials.credentialRevision})
      report.requests.push({case:currentCase,path:api+path+'/rotate',method:'POST',status:rejected.status,requestId:await browserResponseId(previous,document,api+path+'/rotate','POST',rejected.status),source:document,expectedStatuses:[403]});await note({beforeCredentials,csrfRejection:rejected})
      assert.equal(rejected.status,403);equal(await read(path),beforeCredentials,'CSRF rejection changed credential revision/hint');await effectsUnchanged(before)
      return {clientId:controls.clientId,missingCsrfRejected:true,credentialStateUnchanged:true}
    })
    await run('ui-secret-revoked-editor-rejected',async()=>{
      const controls=fixture.credentialControls??fixture.targetRuntime?.credentialControls,account=fixture.accessAccounts?.['identity-read'];assert(controls?.clientId&&account)
      const grantPath=groupApi+'/scope-grants/detail?subject='+encodeURIComponent(account.subject),original=await privateRequest(grantPath),administrator=await privateRequest(groupApi+'/scope-grants/detail?subject='+encodeURIComponent(fixture.admin.subject))
      const restore=()=>setGrant(groupApi,account,original.scopeKeys);restores.push({id:'cleanup-secret-revoked-editor',run:restore})
      try {
        await setGrant(groupApi,account,[...new Set([...original.scopeKeys,...administrator.scopeKeys])]);await login(account)
        const path=groupApi+'/applications/'+encoded(controls.clientId)+'/credentials',beforeCredentials=await read(path)
        await open(group+'/applications/'+encoded(controls.clientId));await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('[data-test="credential-rotate"]')))
        await restore();const before=await effectsBefore()
        const denied=await nativeActionResponse('[data-test="credential-rotate"]',path+'/rotate','POST',[403])
        await page.waitForFunction(()=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot;return Boolean(root?.querySelector('[data-test="request-error"]'))&&!root.querySelector('[data-test="credential-once"]')&&!root.querySelector('[data-test="credential-rotate"]')})
        const retained=await privateRequest(path);await note({beforeCredentials,afterCredentials:retained,revokedSubject:account.subject});equal(retained,beforeCredentials)
        await effectsUnchanged(before);await login();return {clientId:controls.clientId,revokedSubject:account.subject,status:denied.status,noSecretShown:true,credentialStateUnchanged:true}
      }finally{await restore()}
    })
    const lostResponseCase=async()=>{
      requireMethods(page,['dropNextResponse','waitForDroppedResponse','clearDroppedResponse'],'shared adapter')
      const controls=fixture.credentialControls??fixture.targetRuntime?.credentialControls;assert(controls?.clientId)
      await login();const path=groupApi+'/applications/'+encoded(controls.clientId)+'/credentials',beforeCredentials=await read(path),before=await effectsBefore()
      await open(group+'/applications/'+encoded(controls.clientId));const sourceDocument=await source(),baseline=new Set((await page.diagnostics()).events.map(event=>event.id))
      const operation=await page.dropNextResponse({url:base+api+path+'/rotate',method:'POST'});assert(operation?.operationId)
      try {
        await page.click('[data-test="credential-rotate"]')
        const dropped=await page.waitForDroppedResponse({operationId:operation.operationId})
        assert.equal(dropped.status,200);assert.equal(dropped.dropped,true);assert.equal(dropped.url,base+api+path+'/rotate');assert.equal(dropped.documentId,sourceDocument.documentId);assert(dropped.requestId);assert(['net::ERR_FAILED','net::ERR_CONNECTION_RESET'].includes(dropped.message))
        report.expectedTransportFailures??=[];report.expectedTransportFailures.push({case:currentCase,requestId:dropped.requestId,documentId:dropped.documentId,url:dropped.url,message:dropped.message})
        await note({lostResponse:{operationId:operation.operationId,requestId:dropped.requestId,documentId:dropped.documentId,url:dropped.url,status:dropped.status,message:dropped.message}})
        await page.waitForFunction(()=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot;return Boolean(root?.querySelector('[data-test="request-error"]'))&&!root.querySelector('[data-test="credential-once"]')})
        await page.clearDroppedResponse({operationId:operation.operationId})
        const afterCredentials=await read(path);assert.equal(afterCredentials.credentialRevision,beforeCredentials.credentialRevision+1);assert(!Object.hasOwn(afterCredentials,'clientSecret')&&!Object.hasOwn(afterCredentials,'client_secret'))
        const attempts=()=>page.diagnostics().then(value=>value.events.filter(event=>!baseline.has(event.id)&&event.kind==='request'&&event.url===base+api+path+'/rotate'&&event.method==='POST'))
        assert.equal((await attempts()).length,1,'lost response caused automatic secret reissuance')
        await page.reload();await open(group+'/applications/'+encoded(controls.clientId));equal(await read(path),afterCredentials)
        assert(!await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('[data-test="credential-once"]'))))
        assert.equal((await attempts()).length,1,'refresh replayed the failed rotation POST');await effectsUnchanged(before)
        return {clientId:controls.clientId,realResponseDropped:true,exactlyOneServerRotation:true,noAutomaticReissue:true,noPlaintextReplay:true,credentialRevision:afterCredentials.credentialRevision}
      }finally{await page.clearDroppedResponse({operationId:operation.operationId})}
    }
    await run('ui-secret-copy-failure-retry',async()=>{
      requireMethods(page,['setClipboardPermission','readClipboard'],'shared adapter')
      return withRotatedSecret(async({secret})=>{
        let previous
        try {
          await page.setClipboardPermission('granted');previous=await page.readClipboard();assert.equal(typeof previous,'string');page.redactSecrets([previous]);secrets.push(previous)
          await page.setClipboardPermission('denied');await page.click('[data-test="credential-once"] .kel-button:not(.kel-button--primary)')
          await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('[data-test="credential-once"] .error[role="alert"]')?.textContent.trim()==='Copy failed. Retry before closing this dialog.')
          assert((await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="credential-once"] .rbac-one-time-value').textContent))===secret,'copy failure changed the in-memory one-time value')
          await page.setClipboardPermission('granted');await page.click('[data-test="credential-once"] .kel-button:not(.kel-button--primary)')
          await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('[data-test="credential-once"] [role="status"]')?.textContent.trim()==='Copied')
          assert((await page.readClipboard())===secret,'native copy success status did not match actual clipboard value')
          assert(!await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="credential-once"] .error[role="alert"]'))))
          return {nativeClipboardFailure:true,nativeRetrySucceeded:true,clipboardValueVerifiedInMemory:true,plaintextNotReported:true}
        }finally{await page.setClipboardPermission('granted');if(previous!==undefined)await page.evaluate(value=>navigator.clipboard.writeText(value),previous)}
      })
    })
    await run('ui-secret-unmount-clears-plaintext',()=>withRotatedSecret(async({secret,path})=>{
      const original=await source();await page.goto(base+'/ui/main/extensions/rbac/'+group)
      await page.waitForFunction(path=>location.pathname===path&&document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false','/ui/main/extensions/rbac/'+group)
      const replaced=await source();assert.notEqual(replaced.documentId,original.documentId,'unmount test did not replace the document')
      await open(path.slice(1));await page.reload();await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false')
      const retained=await page.evaluate(secret=>{const roots=[document];let found=false;for(let index=0;index<roots.length;index++)for(const node of roots[index].querySelectorAll('*')){if(node.shadowRoot)roots.push(node.shadowRoot);if([...node.childNodes].some(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.includes(secret))||[...node.attributes].some(attribute=>attribute.value.includes(secret)))found=true}return {found,inStorage:[...Object.values(localStorage),...Object.values(sessionStorage)].some(value=>String(value).includes(secret)),dialog:Boolean(document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('[data-test="credential-once"]'))}},secret)
      await note({originalDocument:original.documentId,replacedDocument:replaced.documentId,retained})
      assert.equal(retained.found,false);assert.equal(retained.inStorage,false);assert.equal(retained.dialog,false)
      assert(!JSON.stringify(await read(path+'/credentials')).includes(secret));return {actualDocumentUnmount:true,noPlaintextReplay:true}
    }))
    await run('ui-secret-response-lost-once',lostResponseCase)
  }
  async function measurePanel(element,{shadow=true}={}) {
    await waitForNativeStyleSettlement(page,{panel:element},{shadow})
    const result=await page.evaluate(({element,shadow})=>{
      const root=shadow?document.querySelector('[data-test="extension-container"]').shadowRoot:document,node=root.querySelector(element);if(!node||!node.getClientRects().length)throw new Error('visible native panel missing')
      const rgb=color=>{const values=color.match(/[\d.]+/g)?.map(Number);if(!values||values.length<3)throw new Error('unsupported computed color');return values}
      const background=node=>{for(let current=node;current;current=current.parentElement??current.getRootNode()?.host){const color=getComputedStyle(current).backgroundColor,values=rgb(color);if((values[3]??1)>0.99)return color}return getComputedStyle(document.documentElement).getPropertyValue('--ks-bg-base').trim()}
      const luminance=color=>rgb(color).slice(0,3).map(value=>{value/=255;return value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4}).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0)
      const style=getComputedStyle(node),box=node.getBoundingClientRect(),text=node.querySelector('h1,h2,label,p')??node,textStyle=getComputedStyle(text),bg=background(text),levels=[luminance(textStyle.color),luminance(bg)].sort((left,right)=>right-left)
      const active=root.activeElement??document.activeElement,focus=active&&getComputedStyle(active),focusWrapper=active?.closest('.kel-input__wrapper.is-focus,.kel-select__wrapper.is-focused'),wrapperStyle=focusWrapper&&getComputedStyle(focusWrapper)
      return {element,viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,left:box.left,right:box.right,width:box.width,fontSize:parseFloat(textStyle.fontSize),color:textStyle.color,background:bg,panelBackground:style.backgroundColor,contrast:(levels[0]+0.05)/(levels[1]+0.05),focusVisible:Boolean(active?.matches(':focus-visible')&&(focus.outlineStyle!=='none'&&parseFloat(focus.outlineWidth)>0||focus.boxShadow!=='none'||wrapperStyle&&wrapperStyle.boxShadow!=='none')),focusInside:node.contains(active),text:text.textContent.trim()}
    },{element,shadow})
    await note({lastComputedPanel:result})
    assert(result.documentWidth<=result.viewport+2&&result.left>=-2&&result.right<=result.viewport+2,'native panel overflows viewport')
    assert(result.fontSize>=12&&result.contrast>=4.5,'localized text is too small or lacks contrast')
    return result
  }
  async function fourDrawerThemeCase(theme,locale) {
    await login();await page.setColorScheme('light');await preference(fixture.preferences.themes[theme]);await preference(fixture.preferences.locales[locale])
    const expected=accessControlUiText[locale],observed=[]
    for(const width of accessControlWidths) {
    await page.setViewport({width,height:900})
    assert.equal(fixture.references.kvPath,'/ui/main/kv','Published KV native drawer reference required')
    await note({activeNativeReference:{theme,locale,width,phase:'navigate-kv'}})
    await page.goto(base+fixture.references.kvPath)
    await page.waitForFunction(path=>location.pathname===path&&document.querySelector('[data-test="kv-add"]')?.getClientRects().length&&!document.querySelector('[data-test="kv-add"]').disabled,fixture.references.kvPath)
    await waitForNativeStyleSettlement(page,{trigger:'[data-test="kv-add"]'},{shadow:false})
    await note({activeNativeReference:{theme,locale,width,phase:'click-create'}})
    await page.click('[data-test="kv-add"]')
    await page.waitForFunction(()=>[...document.querySelectorAll('.kel-drawer.open')].filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'&&n.getBoundingClientRect().width>0).length===1)
    await waitForNativeStyleSettlement(page,{drawer:'.kel-drawer.open'},{shadow:false})
    const nativeReference=await page.evaluate(nativeDrawerMeasurements,{shadow:false})
    assert(nativeReference.icons.expand.length&&nativeReference.icons.close.length&&nativeReference.nativeForm,'Published reference must actually use native SVG/form')
    await clickDrawerHeader({shadow:false});await page.waitForFunction(()=>![...document.querySelectorAll('.kel-drawer')].some(n=>n.getBoundingClientRect().width>0))
    for(const plan of drawerPlans()) {
      await note({activeDrawer:{theme,locale,width,kind:plan.kind}})
      await page.setViewport({width,height:900});await open(plan.path);await drawer(plan.kind,plan.trigger)
      const before=await effectsBefore()
      try {
        const nativeParity=await page.evaluate(nativeDrawerMeasurements,{shadow:true,kind:plan.kind})
        for(const section of ['header','body','footer'])assert.deepEqual(nativeParity[section].style,nativeReference[section].style,'Native KV drawer '+section+' style differs')
        assert.deepEqual(nativeParity.icons,nativeReference.icons,'Native drawer SVG actions differ from published KV reference')
        assert(nativeParity.save.nativeIcon&&nativeReference.save.nativeIcon&&nativeParity.save.gap>0&&Math.abs(nativeParity.save.gap-nativeReference.save.gap)<=1,'Save must use the native icon prop and actual icon/label spacing')
        assert.deepEqual(nativeParity.save.paths,nativeReference.save.paths,'Save SVG differs from native KV')
        assert(nativeParity.nativeForm,'Editor did not reuse native horizontal form')
        assert(Math.abs(nativeParity.footer.rect.bottom-nativeParity.drawer.bottom)<=2,'Native drawer footer does not stay at its bottom')
        for(const action of ['expand','close'])for(const dimension of ['width','height'])assert(Math.abs(nativeParity.buttons[action][dimension]-nativeReference.buttons[action][dimension])<=2,'Native drawer action button dimensions differ')
        await note({nativeDrawerReference:nativeReference,lastNativeDrawerParity:{kind:plan.kind,width,...nativeParity}})
        const saveText=await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-save"]').textContent.trim());assert.equal(saveText,fixture.localeText[locale].save)
        await page.focus('.rbac-editor-drawer .kel-drawer__close-btn');await page.pressFocused('Tab')
        const native=await measurePanel(selector('drawer-'+plan.kind));assert(native.focusInside&&native.focusVisible,'native drawer keyboard focus is not visible/trapped')
        if(plan.input) {
          const requestStart=new Set((await page.diagnostics()).events.map(event=>event.id));await page.click('[data-test="drawer-save"]')
          assert(await page.evaluate(kind=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-'+kind+'"] input:invalid')),plan.kind),'empty required fields did not expose native validation')
          assert(!(await page.diagnostics()).events.some(event=>!requestStart.has(event.id)&&event.kind==='request'&&event.method==='POST'&&event.url.startsWith(base+api)),'native invalid form unexpectedly submitted')
          await page.fill(plan.input,'localized-draft-'+randomBytes(3).toString('hex'))
        }else {await page.click('[data-test="drawer-subject"] .kel-form-item:first-of-type .kel-select__wrapper');await page.click('[role="option"]:text-is('+JSON.stringify(fixture.zeroAccount.subject)+')')}
        const draft=await drawerDraft(plan)
        await clickDrawerHeader();await page.waitForFunction(discardConfirmationVisible)
        const actualTitle=await page.evaluate(()=>{const node=document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="discard-confirm"]');return node.querySelector('[role="heading"],h1,h2,.kel-dialog__title')?.textContent.trim()??node.textContent.trim()})
        assert(actualTitle.includes(expected.discardTitle),'discard confirmation translation differs')
        const confirmation=await measurePanel('[data-test="discard-confirm"]');await cancelConfirmation('discard-confirm');assert.equal(await drawerDraft(plan),draft)
        await clickDrawerHeader();await confirmDiscard()
        const collection=plan.kind==='group'?'/application-groups':plan.kind==='user'?'/users':plan.kind==='permission'?permissionApi:groupApi+'/scope-grants'
        const beforeContent=await all(collection)
        await drawer(plan.kind,plan.trigger)
        if(plan.kind==='group'){await page.fill('[data-test="drawer-group"] .kel-form-item:first-of-type input',fixture.applicationGroupId);await page.fill('[data-test="drawer-group"] .kel-form-item:nth-of-type(2) input','Rejected duplicate group')}
        else if(plan.kind==='user'){await page.fill('[data-test="drawer-user"] input[name="username"]',fixture.admin.username);await page.fill('[data-test="drawer-user"] input[name="name"]','Rejected duplicate user')}
        else if(plan.kind==='permission'){await page.fill('[name="permission-key"]',beforeContent[0].key);await page.fill('[name="permission-name"]','Rejected duplicate permission')}
        await clickSave('[data-test="drawer-save"]',collection,'POST',[plan.kind==='subject'?400:409])
        const errorText=await page.evaluate(kind=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-'+kind+'"] [data-test="request-error"]')?.textContent.trim(),plan.kind)
        assert.equal(errorText,accessControlErrorText[locale][plan.kind==='subject'?'error':'conflict'],'drawer actual error translation differs')
        equal(await all(collection),beforeContent,'rejected form changed persisted collection')
        const errorPanel=await measurePanel(selector('drawer-'+plan.kind)+' [data-test="request-error"]')
        await clearTransientUi();await effectsUnchanged(before)
        observed.push({kind:plan.kind,width,native,nativeParity,nativeReference,confirmation,saveText,discardTitle:actualTitle,errorText,errorPanel,failedSaveUnchanged:true})
        await note({theme,locale,drawers:observed})
      }finally{await clearTransientUi()}
    }
    }
    await page.reload();await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false')
    assert.equal((await state()).lang,locale.replaceAll('_','-'))
    return {theme,locale,drawers:observed,refreshed:true,nativeGeometry:true}
  }
  async function authThemeCase(theme,locale) {
    await login();await page.setColorScheme('light');await preference(fixture.preferences.themes[theme]);await preference(fixture.preferences.locales[locale])
    const expected=accessControlUiText[locale],observed=[],before=await effectsBefore()
    try {
      const denied=await login(fixture.zeroAccount);assert.equal(denied.path,'/ui/access-denied')
      for(const width of accessControlWidths) {
        await page.setViewport({width,height:900});await page.waitForFunction(expected=>document.querySelector('#access-denied-title')?.textContent.trim()===expected.deniedTitle&&document.querySelector('[data-testid="return-to-login"]')?.textContent.trim()===expected.login,expected)
        const text=await page.evaluate(()=>({title:document.querySelector('#access-denied-title').textContent.trim(),content:document.querySelector('.access-denied-page .description').textContent.trim(),login:document.querySelector('[data-testid="return-to-login"]').textContent.trim()}))
        equal(text,{title:expected.deniedTitle,content:expected.deniedContent,login:expected.login},'denial page actual translation differs')
        await page.focus('[data-testid="return-to-login"]');await page.press('[data-testid="return-to-login"]','Tab');await page.pressFocused('Shift+Tab')
        const panel=await measurePanel('.access-denied-page main',{shadow:false});assert(panel.focusVisible,'denial logout keyboard focus is invisible')
        observed.push({width,kind:'zero-authorization-denied',text,panel});await note({theme,locale,authPages:observed})
      }
      await page.reload();await page.waitForFunction(()=>Boolean(document.querySelector('#access-denied-title')));assert.equal(await page.evaluate(()=>document.querySelector('#access-denied-title').textContent.trim()),expected.deniedTitle)
      await page.click('[data-testid="return-to-login"]');await page.waitForFunction(()=>location.pathname==='/oidc/login'&&Boolean(document.querySelector('input[name="username"]')))
      await page.waitForFunction(({locale,login})=>document.documentElement.lang.replaceAll('_','-').toLowerCase()===locale.replaceAll('_','-').toLowerCase()&&document.querySelector('[data-i18n="setup.login"]')?.textContent.trim()===login,{locale,login:expected.login})
      const anonymousSource=await source(),previous=new Set((await page.diagnostics()).events.map(event=>event.id))
      const anonymous=await page.evaluate(async()=>{const response=await fetch('/api/v1/main/flows/search?size=1',{credentials:'same-origin',redirect:'manual'});await response.body?.cancel();return response.status})
      report.requests.push({case:currentCase,path:'/api/v1/main/flows/search?size=1',method:'GET',status:anonymous,requestId:await browserResponseId(previous,anonymousSource,'/api/v1/main/flows/search?size=1','GET',anonymous),source:anonymousSource,expectedStatuses:[401,403]});assert([401,403].includes(anonymous))
      for(const width of accessControlWidths) {
        await page.setViewport({width,height:900});await page.focus('input[name="username"]');await page.press('input[name="username"]','Tab')
        const panel=await measurePanel('body',{shadow:false});assert(panel.focusVisible,'anonymous login focus is invisible')
        const translation=await page.evaluate(()=>({lang:document.documentElement.lang,text:[...document.querySelectorAll('[data-i18n]')].filter(node=>node.getClientRects().length).map(node=>({key:node.getAttribute('data-i18n'),text:node.textContent.trim()})),theme:document.documentElement.classList.contains('dark-2')?'dark-2':document.documentElement.classList.contains('dark')?'dark':'light'}))
        assert.equal(translation.lang.replaceAll('_','-').toLowerCase(),locale.replaceAll('_','-').toLowerCase());assert(translation.text.length>0&&translation.text.every(item=>item.text&&item.text!==item.key),'anonymous login contains unresolved translation keys')
        assert.equal(translation.theme,theme==='system'?'light':theme)
        observed.push({width,kind:'anonymous-login-after-real-logout',panel,translation});await note({theme,locale,authPages:observed})
      }
      await page.goto(base+'/oidc/login?error=1')
      await page.waitForFunction(text=>document.querySelector('.error[role="alert"]')?.textContent.trim()===text,accessControlErrorText[locale].incorrectCredentials)
      const errorPanel=await measurePanel('.error[role="alert"]',{shadow:false}),authSource=await source()
      const assets=(await page.diagnostics()).events.filter(event=>event.documentId===authSource.documentId&&event.kind==='http-response'&&event.resourceType==='Script'&&event.url.startsWith(base+'/ui/assets/'))
      assert(assets.some(event=>event.url===base+'/ui/assets/oidc-login-i18n.js'),'anonymous login translation entry was not actually loaded')
      assert(assets.every(event=>[200,304].includes(event.status)),'anonymous language/script resource failed')
      observed.push({kind:'production-login-error-view',text:accessControlErrorText[locale].incorrectCredentials,errorPanel,resources:assets.map(event=>({requestId:event.requestId,documentId:event.documentId,url:event.url,status:event.status}))});await note({authPages:observed})
      if(theme==='system') {const light=await measurePanel('body',{shadow:false});await page.setColorScheme('dark');await page.waitForFunction(()=>document.documentElement.classList.contains('dark')||document.documentElement.classList.contains('dark-2'));const dark=await measurePanel('body',{shadow:false});assert.notEqual(dark.background,light.background);await page.setColorScheme('light')}
      await effectsUnchanged(before);return {theme,locale,authPages:observed,realLogout:true,anonymousBusinessDenied:true,refreshed:true}
    }finally{await login()}
  }
  async function dependencyUnavailableCase() {
    const controls=fixture.dependencyControls??fixture.targetRuntime?.dependencyControls
    if(typeof controls?.makeUnavailable!=='function'||typeof controls?.recover!=='function')throw Object.assign(new Error('owned production dependencyControls.makeUnavailable/recover required; browser request interception and returned passed assertions are not accepted'),{code:'acceptance_contract_missing'})
    const management=fixture.targetRuntime?.management,effects=fixture.targetRuntime?.effects;assert(management&&effects)
    await login()
    const permission=(await all(permissionApi)).find(item=>item.scopeKeys.includes(fixture.scope));assert(permission)
    const path=permissionApi+'/'+permission.key,original=permissionInput(permission)
    await editPermission(permission.key)
    const draft='Retained across service outage '+randomBytes(5).toString('hex')
    await page.fill('[name="permission-description"]',draft)
    const baselineEvents=new Set((await page.diagnostics()).events.map(event=>event.id)),requestOffset=report.requests.length
    const writes=async()=>{const events=(await page.diagnostics()).events;return events.filter(event=>!baselineEvents.has(event.id)&&event.kind==='request'&&event.url===base+api+path&&event.method==='PUT')}
    const operationId='ui-dependency-'+randomBytes(8).toString('hex')
    let outage,recovery,afterEffects,outageAttempted=false
    const beforeEffects=await effects.snapshot()
    try {
      outageAttempted=true
      outage=await controls.makeUnavailable({operationId,origin:base,path:api+path,method:'PUT'})
      assert.equal(outage?.source,'owned-production-dependency-control');assert.equal(outage.origin,base);assert.equal(outage.operationId,operationId);assert(outage.dependencyId&&outage.observedAt,'real dependency outage evidence required')
      const rejected=await clickSave('[data-test="drawer-save"]',path,'PUT',[503])
      await page.waitForFunction(()=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot;return Boolean(root?.querySelector('[data-test="drawer-permission"]'))&&Boolean(root.querySelector('[data-test="request-error"]'))})
      assert.equal(await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[name="permission-description"]').value),draft,'503 discarded unsaved draft')
      assert.equal((await writes()).length,1,'UI automatically retried failed mutation')
      recovery=await controls.recover({operationId:outage.operationId})
      assert.equal(recovery?.source,'owned-production-dependency-control');assert.equal(recovery.operationId,outage.operationId);assert.equal(recovery.recovered,true);assert(recovery.observedAt)
      afterEffects=await effects.snapshot();assert.equal(afterEffects.hash,beforeEffects.hash,'503 changed business persistence/queues/storage')
      await management.login()
      const unchanged=(await management.readPermissions(fixture.applicationGroupId)).items.find(item=>item.key===permission.key)
      equal(permissionInput(unchanged),original,'failed mutation persisted policy changes')
      assert.equal((await writes()).length,1,'dependency recovery automatically resubmitted mutation')
      assert.equal(await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[name="permission-description"]').value),draft,'dependency recovery lost draft')
      const retried=await clickSave('[data-test="drawer-save"]',path)
      const saved=await read(path);assert.equal(saved.description,draft);assert(saved.revision>permission.revision)
      assert.equal((await writes()).length,2,'explicit retry did not produce exactly one additional mutation')
      equal(saved.grants,permission.grants);equal(saved.managementGrants,permission.managementGrants);equal(saved.scopeKeys,permission.scopeKeys)
      return {source:'production-browser-and-owned-dependency-control',outage:{source:outage.source,operationId:outage.operationId,origin:outage.origin,dependencyId:outage.dependencyId,observedAt:outage.observedAt},recovery:{source:recovery.source,operationId:recovery.operationId,recovered:recovery.recovered,observedAt:recovery.observedAt},beforeEffects:{hash:beforeEffects.hash,sources:Object.keys(beforeEffects.sources??{})},afterEffects:{hash:afterEffects.hash,sources:Object.keys(afterEffects.sources??{})},draftRetained:true,automaticRetries:0,rejectedStatus:rejected.status,retryStatus:retried.status,savedRevision:saved.revision,requests:report.requests.slice(requestOffset).filter(request=>request.requestId)}
    }finally {
      if(outageAttempted)await controls.recover({operationId})
      await management.login()
      const current=(await management.readPermissions(fixture.applicationGroupId)).items.find(item=>item.key===permission.key)
      if(current&&JSON.stringify(permissionInput(current))!==JSON.stringify(original))await management.request(api+path,'PUT',original,current.revision)
    }
  }
  await persist()
  try {
    await run('preconditions',async()=>{for(const method of ['goto','reload','click','fill','press','focus','evaluate','waitForFunction','setViewport','setColorScheme','diagnostics','redactSecrets'])assert.equal(typeof page[method],'function',method+' adapter method missing');assert.equal(new URL(base).origin,base);assert(fixture.admin&&fixture.records&&fixture.scope&&fixture.referenceScopeKey);page.redactSecrets(secrets);return {sharedAdapter:true,serverMocks:false}})
    await run('production-ui-login-canonical-path',async()=>{
      const requestedPath='/ui/main/extensions/rbac/application-groups'
      await page.goto(base+requestedPath)
      if(!await page.evaluate(()=>Boolean(document.querySelector('input[name="username"]')))) {
        await page.goto(base+'/ui/access-denied')
        await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]'))||Boolean(document.querySelector('[data-testid="return-to-login"]')))
        if(!await page.evaluate(()=>Boolean(document.querySelector('input[name="username"]'))))await page.click('[data-testid="return-to-login"]')
      }
      await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]')))
      await page.fill('input[name="username"]',fixture.admin.username);await page.fill('input[name="password"]',fixture.admin.password);await page.click('button[type="submit"]')
      await page.waitForFunction(({landing,requested})=>!document.querySelector('input[name="password"]')&&(location.pathname===landing&&Boolean(document.querySelector('#side-menu'))||location.pathname===requested&&document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false'),{landing:fixture.loginFinalPath,requested:requestedPath})
      const capabilities=await read('/capabilities');assert.equal(capabilities.subject,fixture.admin.subject);assert.equal(capabilities.allowed,true);assert.equal(capabilities.runtimeApplicationClientId,fixture.currentApplicationClientId)
      return {requestedPath,source:await source(),subject:capabilities.subject,runtimeApplicationClientId:capabilities.runtimeApplicationClientId}
    })
    await run('menu-access-management',async()=>{
      await page.waitForFunction(()=>Boolean(document.querySelector('#side-menu'))&&[...document.querySelectorAll('a[href]')].some(node=>new URL(node.href).pathname==='/ui/main/extensions/rbac'))
      if(await page.evaluate(()=>document.querySelector('#side-menu')?.classList.contains('is-collapsed')===true)){await page.click('[data-testid="topnav-sidebar-toggle"]');await page.waitForFunction(()=>!document.querySelector('#side-menu')?.classList.contains('is-collapsed'))}
      const menu=await page.evaluate(()=>{const link=[...document.querySelectorAll('a[href]')].find(node=>new URL(node.href).pathname.startsWith('/ui/main/extensions/rbac'));if(!link)throw new Error('access-management menu entry missing');const control=link.closest('.ks-sidebar-section')?.querySelector('button[aria-expanded]');return {href:link.getAttribute('href'),collapsed:control?.getAttribute('aria-expanded')==='false',control:control?.textContent.trim()}})
      if(menu.collapsed){await page.click('button[aria-expanded="false"]:text-is('+JSON.stringify(menu.control)+')');await page.waitForFunction(href=>{const link=document.querySelector('a[href='+JSON.stringify(href)+']');return link?.getClientRects().length&&!link.closest('[inert],[aria-hidden="true"]')&&link.closest('.ks-sidebar-section')?.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')==='true'},menu.href)}
      await page.click('a[href='+JSON.stringify(menu.href)+']');await page.waitForFunction(path=>location.pathname===path&&document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main[data-test="access-control-root"]')?.getAttribute('aria-busy')==='false',new URL(menu.href,base).pathname);return {menu,source:await source()}
    })
    await run('ui-initial-english-preference',async()=>{await preference(fixture.preferences.locales.en);return {path:(await open('application-groups')).path}})
    await run('ui-frozen-baseline-key-equality',async()=>{
      const baseline=fixture.frozenUiBaseline
      if(!baseline?.completed||!baseline.passed||baseline.status!=='passed'||baseline.phase!=='before-boundary-data')throw Object.assign(new Error('separate real frozen UI baseline (19 scopes/19 permissions/22 users/1 subject) required before boundary-data preparation'),{code:'acceptance_contract_missing'})
      assert.equal(baseline.evidence?.source,'real-browser-before-boundary-data');assert.equal(baseline.evidence.bootstrapMapping.runtimeSubject,fixture.admin.subject)
      for(const [kind,total]of [['scopes',19],['permissions',19],['users',22],['subjects',1]]){const actual=baseline.evidence.collections[kind];assert.equal(actual.total,total);assert.equal(actual.items.length,total)}
      assert.equal(baseline.evidence.pages.length,4);return baseline.evidence
    })
    await run('ui-four-tabs-cards-counts',async()=>{
      const groups=await all('/application-groups'),expected=await read(groupApi)
      await open('application-groups','[data-test="group-card"]')
      const countSpacing=await page.evaluate(cardCountSpacingMeasurements)
      assert(countSpacing.length>=3&&countSpacing.every(row=>Number.isFinite(row.token)&&row.token>0&&row.gap>=row.token-1&&row.text.startsWith(row.count+' ')),'card counts and units require actual visible spacing and accessible text separation')
      const headingLayout=await page.evaluate(cardHeadingMeasurements)
      assert(headingLayout.length&&headingLayout.every(row=>row.vertical&&row.nameGap>0&&(row.badgeGap===null||row.badgeGap>0)),'card key/name/badge must be visibly separated vertically')
      const card=selector('group-card','data-group-id',fixture.applicationGroupId)
      assert((await visibleRows('group-card','data-group-id')).every(id=>groups.some(group=>group.id===id)))
      await page.click(card+' .application-group-card-link');await page.waitForFunction(path=>location.pathname===path,'/ui/main/extensions/rbac/'+group)
      const observed=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot;return {tabs:[...root.querySelectorAll('[role="tab"]')].filter(node=>node.getClientRects().length).map(node=>node.textContent.trim()),text:root.textContent}})
      assert.equal(observed.tabs.length,4,'group must have exactly four tabs')
      assert(!/approved|reconciliation|independent saves/i.test(observed.text),'retired business concepts remain')
      await readonly('[data-test="group-detail"]')
      assert(!await page.evaluate(()=>[...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[data-test="group-detail"] dt')].some(node=>/audience/i.test(node.textContent))),'group Audience must not exist')
      for(const [index,field]of ['scopes','applications','subjects'].entries()) {
        await open(group)
        const count=await page.evaluate(index=>Number(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('.rbac-statistics b')[index].textContent),index)
        assert.equal(count,expected.counts[field])
        const target=await canonicalPageUrl(group+'/'+(field==='subjects'?'scope-grants':field))
        await page.click('.rbac-statistics button:nth-child('+(index+1)+')')
        await page.waitForFunction(path=>location.pathname===path,target.pathname)
      }
      return {counts:expected.counts,tabs:observed.tabs,countSpacing,headingLayout}
    })
    await run('ui-group-create-edit-delete',async()=>{
      const id='ui-browser-group-'+randomBytes(5).toString('hex'),path='/application-groups/'+id
      await open('application-groups');await drawer('group','.management-toolbar button')
      await page.fill('[data-test="drawer-group"] .kel-form-item:nth-of-type(1) input',id)
      await page.fill('[data-test="drawer-group"] .kel-form-item:nth-of-type(2) input','Browser group display')
      await page.fill('[data-test="drawer-group"] textarea','Browser group initial description')
      const created=await clickSave('[data-test="drawer-save"]','/application-groups','POST',[200])
      let saved=await read(path);assert.equal(saved.description,'Browser group initial description');assert.equal(saved.displayName,'Browser group display');equal(saved.counts,{scopes:0,applications:0,subjects:0})
      await open('application-groups/'+id,'[data-test="group-detail"]');await readonly('[data-test="group-detail"]');await page.click('[data-test="group-edit"]')
      await page.fill('[data-test="group-detail"] textarea','Browser group persisted edit')
      await clickSave('[data-test="group-detail"] form button[type="submit"]',path)
      saved=await read(path);assert.equal(saved.description,'Browser group persisted edit')
      await refreshReadonly('application-groups/'+id,'[data-test="group-detail"]')
      await page.click('[data-test="group-detail"] .buttons button:last-child');await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="delete-confirm"]')))
      await clickSave('[data-test="delete-confirm"] .kel-button--danger',path,'DELETE',[200]);await request(path,'GET',undefined,undefined,[404])
      const retired=await request('/application-groups','POST',{id,tenant:'main',displayName:'Retired id must not return',description:''},undefined,[409])
      return {id,created,editRevision:saved.revision,deleted:true,retiredStatus:retired.status}
    })
    await run('ui-card-badges-and-built-in-guard',async()=>{
      const before=await read(groupApi),effects=await fixture.targetRuntime.effects.snapshot();assert.equal(before.builtIn,true,'installation group must be explicitly identified as built-in')
      const badges=[]
      for(const [field,tab]of [['scopes','scopes'],['applications','applications'],['subjects','scope-grants']]) {
        await open('application-groups');const badge=selector('group-card','data-group-id',fixture.applicationGroupId)+' '+selector('group-count-'+field)
        assert.equal(await page.evaluate(selector=>Number(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector(selector).querySelector('b').textContent),badge),before.counts[field])
        const target=await canonicalPageUrl(group+'/'+tab)
        await page.click(badge);await page.waitForFunction(path=>location.pathname===path,target.pathname)
        badges.push({field,count:before.counts[field],path:(await source()).path})
      }
      const denied=await request(groupApi,'DELETE',undefined,before.revision,[409])
      equal(await read(groupApi),before,'built-in delete changed directory');assert.equal((await fixture.targetRuntime.effects.snapshot()).hash,effects.hash,'built-in delete changed business persistence')
      return {badges,builtIn:true,deleteStatus:denied.status,noSideEffects:true}
    })
    await run('ui-scope-readonly-edit',async()=>{
      const path=groupApi+'/scopes/'+fixture.scope,before=await read(path)
      restores.push({id:'cleanup-restore-test-scope',run:async()=>{const current=await read(path);await request(path,'PUT',{key:before.key,name:before.name,description:before.description},current.revision,[200])}})
      await open(group+'/scopes/'+fixture.scope,'[data-test="scope-detail"]');await readonly('[data-test="scope-detail"]')
      await page.click('[data-test="scope-detail"] > button')
      const changed=before.description+' browser '+randomBytes(4).toString('hex')
      await page.fill('[data-test="scope-detail"] textarea',changed)
      await clickSave('[data-test="scope-save"]',path)
      const saved=await read(path);assert.equal(saved.description,changed);assert(saved.revision>before.revision)
      await refreshReadonly(group+'/scopes/'+fixture.scope,'[data-test="scope-detail"]')
      return {key:saved.key,revision:saved.revision,persisted:true}
    })
    await run('ui-scope-create-delete-reference-guard',async()=>{
      const baseline=await all(permissionApi),scopes=await all(groupApi+'/scopes'),id='ui-browser-scope-'+randomBytes(4).toString('hex')
      await open(group+'/scopes');await page.click('[data-test="scope-add"]')
      await page.fill('[data-test="scope-detail"] label:nth-of-type(1) input',id);await page.fill('[data-test="scope-detail"] label:nth-of-type(2) input','Browser scope '+id);await page.fill('[data-test="scope-detail"] textarea','No implicit runtime policy')
      await clickSave('[data-test="scope-save"]',groupApi+'/scopes','POST',[200])
      const saved=await read(groupApi+'/scopes/'+id);assert.equal(saved.name,'Browser scope '+id)
      equal(await all(permissionApi),baseline,'scope create granted runtime permissions')
      const application=await read('/'+app);assert(!application.supportedScopeKeys.includes(id),'scope create registered implicit support')
      const assignment=await read(groupApi+'/scope-grants/detail?subject='+encodeURIComponent(fixture.admin.subject));assert(!assignment.scopeKeys.includes(id),'scope create granted subject access')
      await open(group+'/scopes/'+id);await page.fill('[data-test="scope-sidebar"] input',id)
      await page.click('[data-test="scope-sidebar"] li .sidebar-delete');await clickSave('[data-test="delete-confirm"] .kel-button--danger',groupApi+'/scopes/'+id,'DELETE',[200])
      await request(groupApi+'/scopes/'+id,'GET',undefined,undefined,[404])
      const referenced=await read(groupApi+'/scopes/'+fixture.scope),beforeEffects=await fixture.targetRuntime.effects.snapshot()
      await open(group+'/scopes/'+fixture.scope);await page.fill('[data-test="scope-sidebar"] input',fixture.scope);await page.click('[data-test="scope-sidebar"] li .sidebar-delete')
      await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="delete-confirm"]')))
      assert(!await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="delete-confirm"] .kel-button--danger'))),'known referenced scope must not expose a destructive submit')
      const rejected=await request(groupApi+'/scopes/'+fixture.scope,'DELETE',undefined,referenced.revision,[409]);assert.equal(rejected.body?.code,'scope_in_use')
      const dialog=await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="delete-confirm"]').textContent)
      assert(dialog.includes(fixture.scope),'blocked deletion did not show reference target')
      equal(await read(groupApi+'/scopes/'+fixture.scope),referenced,'rejected delete changed scope');equal(await all(permissionApi),baseline,'rejected delete changed policies')
      assert.equal((await fixture.targetRuntime.effects.snapshot()).hash,beforeEffects.hash,'rejected scope delete changed business persistence')
      await cancelConfirmation()
      return {key:id,createdAndDeleted:true,referenceDenied:409,originalScopeCount:scopes.length,policyUnchanged:true}
    })
    await run('ui-scope-key-name-conflict',async()=>{
      const before=await all(groupApi+'/scopes'),selected=before.find(scope=>scope.key===fixture.scope),other=before.find(scope=>scope.key!==fixture.scope);assert(selected&&other)
      const path=groupApi+'/scopes/'+fixture.scope,effects=await fixture.targetRuntime.effects.snapshot()
      await open(group+'/scopes/'+fixture.scope);await page.click('[data-test="scope-detail"] > button')
      assert(await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="scope-detail"] label:first-of-type input').disabled),'editing a scope unlocked its stable key')
      await page.fill('[data-test="scope-detail"] label:nth-of-type(2) input',other.name)
      const conflict=await clickSave('[data-test="scope-save"]',path,'PUT',[409])
      equal(await all(groupApi+'/scopes'),before,'scope name conflict changed records');assert.equal((await fixture.targetRuntime.effects.snapshot()).hash,effects.hash)
      assert.equal(await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="scope-detail"] label:nth-of-type(2) input').value),other.name,'name conflict lost draft')
      await page.click('[data-test="scope-detail"] .rbac-inline-form .buttons button:last-child');await confirmDiscard()
      await login();return {scopeKey:selected.key,keyLocked:true,duplicateNameStatus:conflict.status,noSideEffects:true}
    })
    await run('ui-navigation-six-links',async()=>{
      const evidence=[],scopePath=group+'/scopes/'+fixture.scope,permissions=await all(externalApi),permission=permissions.find(item=>item.scopeKeys.includes(fixture.scope));assert(permission)
      await open(external);await page.click('[data-test="application-supported-scopes"] code:text-is('+JSON.stringify(fixture.scope)+')')
      await page.waitForFunction(path=>location.pathname===path,'/ui/main/extensions/rbac/'+scopePath);evidence.push({link:'application-support-to-scope',source:await source()})
      await page.waitForFunction(subject=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot;return root.querySelector('main')?.getAttribute('aria-busy')==='false'&&[...root.querySelectorAll('[data-test="scope-detail"] code')].some(node=>node.textContent.trim()===subject)},fixture.subject)
      await page.click('[data-test="scope-detail"] code:text-is('+JSON.stringify(fixture.subject)+')');await page.waitForFunction(subject=>location.pathname.endsWith('/scope-grants')&&new URL(location.href).searchParams.get('filterSubject')===subject,fixture.subject)
      await page.waitForFunction(subject=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot;return root.querySelector('main')?.getAttribute('aria-busy')==='false'&&[...root.querySelectorAll('[data-test="subject-row"]')].some(node=>node.getAttribute('data-subject')===subject)},fixture.subject)
      equal(await visibleRows('subject-row','data-subject'),[fixture.subject]);evidence.push({link:'scope-to-subject-filter',source:await source()})
      await page.click('[data-test="subject-row"]');await page.waitForFunction(subject=>location.pathname.endsWith('/users')&&new URL(location.href).searchParams.get('filterSubject')===subject,fixture.subject)
      await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('main')?.getAttribute('aria-busy')==='false')
      equal(await visibleRows('user-row','data-subject'),[fixture.subject]);evidence.push({link:'subject-to-standard-user',source:await source()})
      await open(group+'/scope-grants?filterSubject='+encodeURIComponent(fixture.subject))
      const involvedApplicationButton=await page.evaluate(({subject,clientId})=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,subjects=[...root.querySelectorAll('[data-test="subject-row"]')].filter(node=>node.getAttribute('data-subject')===subject);if(subjects.length!==1)throw new Error('Subject row absent or ambiguous');const row=subjects[0].closest('tr'),codes=[...row.querySelectorAll('.rbac-tags code')].filter(node=>node.textContent.trim()===clientId);if(codes.length!==1)throw new Error('Involved application absent or ambiguous in subject row');const button=codes[0].closest('button');if(!button)throw new Error('Involved application has no native button');const parts=[];for(let node=button;node&&node.parentElement;node=node.parentElement)parts.unshift(node.tagName.toLowerCase()+':nth-child('+([...node.parentElement.children].indexOf(node)+1)+')');const selector=parts.join(' > ');if(root.querySelectorAll(selector).length!==1||root.querySelector(selector)!==button)throw new Error('Actual involved application button path not unique');return selector},{subject:fixture.subject,clientId:fixture.clientId})
      await page.click(involvedApplicationButton)
      await page.waitForFunction(({path,subject})=>location.pathname===path&&new URL(location.href).searchParams.get('filterSubject')===subject,{path:'/ui/main/extensions/rbac/'+external,subject:fixture.subject})
      await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('main')?.getAttribute('aria-busy')==='false')
      const linked=await source();assert(new URLSearchParams(linked.query).getAll('scopeKeys').includes(fixture.scope));equal(await visibleRows('permission-row','data-permission-key'),permissions.filter(item=>item.scopeKeys.includes(fixture.scope)).map(item=>item.key).sort(compare));evidence.push({link:'subject-involved-application-filter',source:linked})
      await open(scopePath)
      const scopePermissionButton=await page.evaluate(({clientId,key})=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,rows=[...root.querySelectorAll('[data-test="scope-detail"] .rbac-tags')].filter(row=>[...row.querySelectorAll('code')].some(code=>code.textContent.trim()===clientId));if(rows.length!==1)throw new Error('Scope application relation absent or ambiguous');const codes=[...rows[0].querySelectorAll('code')].filter(code=>code.textContent.trim()===key);if(codes.length!==1)throw new Error('Scope permission relation absent or ambiguous in selected application');const button=codes[0].closest('button');if(!button)throw new Error('Scope permission relation has no native button');const parts=[];for(let node=button;node&&node.parentElement;node=node.parentElement)parts.unshift(node.tagName.toLowerCase()+':nth-child('+([...node.parentElement.children].indexOf(node)+1)+')');const selector=parts.join(' > ');if(root.querySelectorAll(selector).length!==1||root.querySelector(selector)!==button)throw new Error('Scope permission native button path is not unique');return selector},{clientId:fixture.clientId,key:permission.key})
      await page.click(scopePermissionButton)
      await page.waitForFunction(({path,key})=>location.pathname===path&&new URL(location.href).searchParams.get('permissionKey')===key,{path:'/ui/main/extensions/rbac/'+external,key:permission.key})
      await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('main')?.getAttribute('aria-busy')==='false')
      equal(await visibleRows('permission-row','data-permission-key'),[permission.key]);evidence.push({link:'scope-permission-deeplink',source:await source()})
      await open(external+'?permissionKey='+permission.key);await page.click('[data-test="application-permissions"] .rbac-tags code:text-is('+JSON.stringify(fixture.applicationGroupId+': '+fixture.scope)+')')
      await page.waitForFunction(path=>location.pathname===path,'/ui/main/extensions/rbac/'+scopePath);evidence.push({link:'permission-activation-to-scope',source:await source()})
      assert.equal(evidence.length,6);return evidence
    })
    await run('ui-application-register-remove',async()=>{
      assert(fixture.unassignedClientId,'production-registered unassigned client required')
      const clientId=fixture.unassignedClientId,path=groupApi+'/applications/'+encoded(clientId)
      const before=await all(permissionApi),beforeGrants=await all(groupApi+'/scope-grants')
      await open(group+'/applications');await page.click('[data-test="application-register"]')
      assert(!await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test^="drawer-"]'))),'application registration must not open fifth drawer')
      await page.fill('[data-test="application-detail"] input',clientId)
      await page.fill('[data-test="application-detail"] label:nth-of-type(2) textarea',base+'/api/v1/main/mcp/default')
      await page.fill('[data-test="application-detail"] label:last-of-type textarea','Browser registered application')
      await clickSave('[data-test="application-save"]',groupApi+'/applications','POST',[200]);await login()
      const saved=await read(path);assert.equal(saved.clientId,clientId);assert.equal(saved.description,'Browser registered application');equal(saved.supportedScopeKeys,[]);equal(await all(path+'/permissions'),[])
      assert(!Object.hasOwn(saved,'approved'),'approved leaked into new DTO')
      await open(group+'/applications/'+encoded(clientId));await readonly('[data-test="application-detail"]')
      const audience=await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="application-detail"]').textContent)
      assert(audience.includes(saved.audiences[0]),'application resource audience not displayed')
      await page.fill('[data-test="application-sidebar"] input',clientId);await page.click('[data-test="application-sidebar"] li .sidebar-delete')
      await clickSave('[data-test="delete-confirm"] .kel-button--danger',path,'DELETE',[200]);await login();await request(path,'GET',undefined,undefined,[404])
      equal(await all(permissionApi),before)
      const grantContent=items=>items.map(({authorizationVersion,...grant})=>grant)
      equal(grantContent(await all(groupApi+'/scope-grants')),grantContent(beforeGrants),'application removal revoked group-level grants')
      return {clientId,registeredEmptySupport:true,removed:true,subjectGrantsUnchanged:true}
    })
    await run('ui-permission-external-crud',async()=>{
      const before=await all(externalApi),baseline=await all(permissionApi)
      const permission=before.find(item=>item.scopeKeys.includes(fixture.scope));assert(permission)
      restores.push({id:'cleanup-restore-external-permission',run:async()=>{const current=await read(externalApi+'/'+permission.key);await request(externalApi+'/'+permission.key,'PUT',permissionInput(permission),current.revision,[200])}})
      await editPermission(permission.key,external)
      const name=permission.name+' browser revised',details='Plain text <script>not executable</script>'
      await page.fill('[name="permission-name"]',name);await page.fill('[name="permission-details"]',details)
      await clickSave('[data-test="drawer-save"]',externalApi+'/'+permission.key)
      const saved=await read(externalApi+'/'+permission.key);assert.equal(saved.name,name);assert.equal(saved.details,details)
      equal(await all(permissionApi),baseline,'external declaration changed current Kestra permissions')
      await page.reload();await open(external+'?permissionKey='+permission.key);assert((await state()).text.includes(name))
      return {key:permission.key,revision:saved.revision,kestraPolicyUnchanged:true}
    })
    await run('ui-permission-many-to-many',async()=>{
      const suffix=randomBytes(5).toString('hex'),first='ui-p1-'+suffix,second='ui-p2-'+suffix
      const scopes=fixture.records.scopes.filter(scope=>scope.key!==fixture.scope&&scope.key!==fixture.referenceScopeKey).slice(-2).map(scope=>scope.key)
      assert.equal(scopes.length,2)
      const before=await read('/'+external),baseline=await all(permissionApi)
      assert(scopes.every(scope=>!before.supportedScopeKeys.includes(scope)),'many-to-many test must introduce isolated supported scopes')
      await createPermission(external,externalApi,{key:first,name:'P1 ANY two scopes',scopeKeys:scopes,details:'External non-executable declaration'})
      await createPermission(external,externalApi,{key:second,name:'P2 shares second scope',scopeKeys:[scopes[1]],details:'Not an administrator grant'})
      const withBoth=await read('/'+external);equal(withBoth.supportedScopeKeys,[...new Set([...before.supportedScopeKeys,...scopes])])
      const groupBefore=await read(groupApi)
      await editPermission(first,external);await pickScopes([scopes[0]])
      await clickSave('[data-test="drawer-save"]',externalApi+'/'+first);await login()
      const unchanged=await read(groupApi);assert.equal(unchanged.authorizationVersion,groupBefore.authorizationVersion,'unchanged support union advanced epoch')
      equal((await read('/'+external)).supportedScopeKeys,withBoth.supportedScopeKeys,'another permission still references s2')
      await deletePermission(external,externalApi,second)
      const reduced=await read('/'+external);assert(!reduced.supportedScopeKeys.includes(scopes[1]));assert(reduced.supportedScopeKeys.includes(scopes[0]))
      assert((await read(groupApi)).authorizationVersion>unchanged.authorizationVersion,'last reference removal did not revoke supported scope')
      await editPermission(first,external);await pickScopes([]);await clickSave('[data-test="drawer-save"]',externalApi+'/'+first);await login()
      equal((await read(externalApi+'/'+first)).scopeKeys,[],'empty association was not persisted')
      equal((await read('/'+external)).supportedScopeKeys,before.supportedScopeKeys)
      await deletePermission(external,externalApi,first)
      equal(await all(permissionApi),baseline,'external declaration granted Kestra authority')
      return {first,second,scopeKeys:scopes,sharedReferencePreserved:true,lastReferenceRevoked:true,emptyAssociationPersisted:true,externalNotExecutable:true}
    })
    await run('ui-permission-typed-save-refresh',async()=>{
      const permissions=await all(permissionApi),permission=permissions.find(item=>item.scopeKeys.length===1&&item.scopeKeys[0]===fixture.scope);assert(permission,'prepared typed permission missing')
      const path=permissionApi+'/'+permission.key,original=permissionInput(permission)
      assert.notEqual(permission.description,fixture.edit.description,'typed save must change description')
      assert(permission.grants.length===1&&permission.grants[0].namespace!==fixture.edit.namespace,'typed save must change the actual resource grant, not just metadata')
      restores.push({id:'cleanup-restore-typed-permission',run:async()=>{const current=await read(path);await request(path,'PUT',original,current.revision,[200])}})
      await editPermission(permission.key)
      await page.fill('[name="permission-description"]',fixture.edit.description)
      await page.fill('[name="grant-namespace"]',fixture.edit.namespace)
      for(const action of ['READ','LIST','UPDATE']) {
        const element='[data-test="drawer-permission"] input[type="checkbox"][value='+JSON.stringify(action)+']',wanted=fixture.edit.actions.includes(action)
        const observed=await page.evaluate(element=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,input=root.querySelector(element),label=input?.closest('label');if(!input||!label)throw new Error('Native checkbox label missing');const parts=[];for(let node=label;node&&node.parentElement;node=node.parentElement)parts.unshift(node.tagName.toLowerCase()+':nth-child('+([...node.parentElement.children].indexOf(node)+1)+')');const path=parts.join(' > ');if(root.querySelectorAll(path).length!==1||root.querySelector(path)!==label)throw new Error('Native checkbox label is not unique');return {checked:input.checked,labelPath:path}},element)
        assert.equal(typeof observed.checked,'boolean')
        if(observed.checked!==wanted)await page.click(observed.labelPath)
        assert.equal(await page.evaluate(element=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector(element).checked,element),wanted)
      }
      await clickSave('[data-test="drawer-save"]',path)
      const saved=await read(path)
      assert.equal(saved.description,fixture.edit.description);assert(saved.revision>permission.revision)
      equal(saved.grants,[{...permission.grants[0],namespace:fixture.edit.namespace,actions:fixture.edit.actions}],'typed grant fields did not persist exactly')
      equal(saved.managementGrants,permission.managementGrants,'resource edit changed management authority')
      await page.reload();await editPermission(permission.key)
      assert.equal(await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[name="grant-namespace"]').value),fixture.edit.namespace)
      await closeDrawer('permission')
      return {key:saved.key,revision:saved.revision,grants:saved.grants,persistedAfterRefresh:true}
    })
    await run('ui-permission-summary-expand',async()=>{
      const permission=(await all(permissionApi)).find(permission=>permission.grants.length+permission.managementGrants.length>1);assert(permission,'multiple real typed grants required for summary expansion')
      const total=permission.grants.length+permission.managementGrants.length
      await open(app+'?permissionKey='+permission.key)
      const before=await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.rbac-permission-summary')?.textContent.trim());assert(before?.includes('+'+(total-1)),'collapsed summary must show one line and +N')
      await page.click('.rbac-permission-summary button')
      const expanded=await page.evaluate(()=>{const element=document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.rbac-permission-summary');return {lines:[...element.querySelectorAll('p')].map(node=>node.textContent.trim()),hasExpandButton:Boolean(element.querySelector('button'))}})
      assert.equal(expanded.lines.length,total);assert.equal(expanded.hasExpandButton,false,'+N remained after expansion')
      for(const grant of permission.grants)assert(expanded.lines.some(line=>line.includes(grant.resource)&&grant.actions.every(action=>line.includes(action))),'expanded summary omitted typed grant actions')
      for(const grant of permission.managementGrants)assert(expanded.lines.some(line=>line.includes(grant.domain)&&grant.actions.every(action=>line.includes(action))),'expanded summary omitted management actions')
      return {key:permission.key,total,expanded:expanded.lines,expandHintRemoved:true}
    })
    await run('ui-empty-grants-no-policy-change',async()=>{
      const before=await all(permissionApi),name='ui-empty-'+randomBytes(4).toString('hex')
      const created=await createPermission(app,permissionApi,{key:name,name:'Empty grants must not authorize',scopeKeys:[]})
      equal(created.grants,[]);equal(created.managementGrants,[]);equal(created.scopeKeys,[])
      for(const permission of before)equal((await all(permissionApi)).find(item=>item.key===permission.key),{...permission,parentRevision:created.parentRevision},'empty permission changed pre-existing grants')
      await deletePermission(app,permissionApi,name)
      return {key:name,grants:0,managementGrants:0,implicitSupport:false}
    })
    await run('ui-subject-grant-revoke',async()=>{
      const path=groupApi+'/scope-grants/detail?subject='+encodeURIComponent(fixture.subject),original=await read(path)
      restores.push({id:'cleanup-restore-assignment',run:async()=>{const current=await read(path);await request(path,'PUT',{issuer:original.issuer,subject:original.subject,scopeKeys:original.scopeKeys},current.revision,[200])}})
      assert(original.scopeKeys.includes(fixture.scope))
      await open(group+'/scope-grants?filterSubject='+encodeURIComponent(fixture.subject));equal(await visibleRows('subject-row','data-subject'),[fixture.subject])
      await drawer('subject','[data-test="subject-list"] .kel-table tbody tr .buttons button:first-child');await pickScopes([],'subject')
      await clickSave('[data-test="drawer-save"]',path);await login()
      const revoked=await read(path);equal(revoked.scopeKeys,[]);assert(revoked.revision>original.revision)
      await read('/users/detail?subject='+encodeURIComponent(fixture.subject))
      await open(group+'/scope-grants?filterSubject='+encodeURIComponent(fixture.subject));equal(await visibleRows('subject-row','data-subject'),[fixture.subject])
      await drawer('subject','[data-test="subject-list"] .kel-table tbody tr .buttons button:first-child');await pickScopes(original.scopeKeys,'subject');await clickSave('[data-test="drawer-save"]',path);await login()
      equal((await read(path)).scopeKeys,original.scopeKeys)
      return {subject:fixture.subject,zeroScopeSubjectRetained:true,accountRetained:true,revokedRevision:revoked.revision,restoredThroughUi:true}
    })
    await run('ui-filter-any-and-deeplink',async()=>{
      const permissions=await all(permissionApi),scopeKeys=[fixture.scope,fixture.referenceScopeKey]
      const query=new URLSearchParams();for(const scope of scopeKeys)query.append('scopeKeys',scope)
      query.set('size','100')
      await open(app+'?'+query,'[data-test="application-permissions"]')
      const expected=permissions.filter(item=>item.scopeKeys.some(scope=>scopeKeys.includes(scope))).map(item=>item.key).sort(compare)
      equal(await visibleRows('permission-row','data-permission-key'),expected,'scopeKeys must use ANY')
      assert(expected.length>1,'ANY test requires multiple different matches')
      const first=permissions.find(item=>item.key===expected[0]);query.set('permissionKey',first.key)
      await open(app+'?'+query);equal(await visibleRows('permission-row','data-permission-key'),[first.key],'different chips must use AND')
      await page.reload();await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false')
      equal(await visibleRows('permission-row','data-permission-key'),[first.key],'deep-link state lost on refresh')
      const scopeChipIndex=await page.evaluate(()=>[...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[data-test="filter-chip"]')].findIndex(node=>node.textContent.includes('scope ∈')));assert(scopeChipIndex>=0)
      await page.click('[data-test="filter-chip"]:nth-child('+(scopeChipIndex+1)+') button')
      await page.waitForFunction(()=>!new URL(location.href).searchParams.has('scopeKeys'))
      assert(!(await state()).query.includes('scopeKeys'),'single chip removal did not update URL')
      await open(app+'?permissionKey=does-not-exist');equal(await visibleRows('permission-row','data-permission-key'),[],'legal no-result query is not empty')
      await open(app+'?page=-1','[data-test="request-error"]');equal(await all(permissionApi),permissions,'invalid query wrote data')
      return {any:expected,and:[first.key],invalidQueryHasNoSideEffects:true}
    })
    await run('ui-native-filter-popup-geometry',async()=>{
      const observations=[],nativeReferences=[]
      const beforeFilterEffects=await effectsBefore()
      await page.setColorScheme('light')
      for(const theme of accessControlThemes) {
      await page.setViewport({width:1280,height:900})
      await preference(fixture.preferences.themes[theme])
      await page.goto(base+fixture.references.namespacesPath)
      await page.waitForFunction(()=>Boolean(document.querySelector('.customize-button')))
      await openNativeAdvanced(false)
      await page.waitForFunction(()=>{const node=document.querySelector('.adv-builder');if(!node)return false;const a=document.querySelector('.customize-button').getBoundingClientRect(),b=node.getBoundingClientRect();return Math.abs(b.top-a.bottom-6)<=3})
      const nativeReference=await page.evaluate(()=>{const node=document.querySelector('.adv-builder'),a=document.querySelector('.customize-button').getBoundingClientRect(),b=node.getBoundingClientRect(),style=getComputedStyle(node);return{path:location.pathname,trigger:{left:a.left,bottom:a.bottom},panel:{left:b.left,top:b.top,width:b.width},style:{fontFamily:style.fontFamily,fontSize:style.fontSize,background:style.backgroundColor,borderRadius:style.borderRadius}}})
      nativeReferences.push({theme,...nativeReference})
      await page.click('.adv-footer .adv-add:nth-child(1)')
      await page.waitForFunction(()=>document.querySelectorAll('.adv-row').length===1)
      await page.click('.adv-header-close')
      for(const [kind,path]of [['projects','application-groups'],['permissions',app],['users','users'],['subjects',group+'/scope-grants']]) {
        await open(path)
        for(let reopening=0;reopening<2;reopening++) {
          await openNativeAdvanced()
          await page.waitForFunction(desktopFilterViewportReady)
          await page.click('.adv-clear')
          await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('.adv-row').length===0)
          const before=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,node=root.querySelector('.adv-builder'),a=root.querySelector('.customize-button').getBoundingClientRect(),b=node.getBoundingClientRect(),style=getComputedStyle(node);return{trigger:{left:a.left,bottom:a.bottom},panel:{left:b.left,top:b.top,width:b.width},rows:root.querySelectorAll('.adv-row').length,style:{fontFamily:style.fontFamily,fontSize:style.fontSize,background:style.backgroundColor,borderRadius:style.borderRadius}}})
          equal(before.style,nativeReference.style,'extension native filter visual styles differ from the published host')
          const restriction=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,panel=root.querySelector('.adv-builder'),button=panel.querySelector('.adv-footer .adv-add:nth-child(2)'),note=button&&root.getElementById(button.getAttribute('aria-describedby'));return {disabled:button?.disabled,ariaDisabled:button?.getAttribute('aria-disabled'),description:note?.textContent.trim(),rows:panel.querySelectorAll('.adv-row').length}})
          assert.equal(restriction.disabled,true,'unsupported condition group must be visibly disabled')
          assert.equal(restriction.ariaDisabled,'true');assert(restriction.description,'disabled group requires localized AND explanation')
          await page.focus('.adv-footer .adv-add:nth-child(1)')
          await page.press('.adv-footer .adv-add:nth-child(1)','Tab')
          const groupFocus=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot;return root.activeElement===root.querySelector('.adv-footer .adv-add:nth-child(2)')})
          assert.equal(groupFocus,false,'disabled OR group must not receive keyboard focus')
          await page.click('.adv-footer .adv-add:nth-child(1)')
          await page.waitForFunction(count=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('.adv-row').length===count+1,before.rows)
          const field='.adv-body .adv-row:last-child .cond-field .kel-select__wrapper'
          await page.click(field)
          await page.waitForFunction(()=>[...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[role="option"]')].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'))
          const options=await page.evaluate(()=>[...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[role="option"]')].filter(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden').map(node=>node.textContent.trim()))
          assert(options.length>0,'native filter field dropdown did not open')
          await page.press('body','Escape')
          assert(await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.adv-builder')?.getClientRects().length)),'nested select Escape closed its parent filter')
          let boundary=null
          if(kind==='permissions'&&reopening===0) {
            const scroll=await page.evaluate(desktopFilterBoundaryScroll)
            try {
              await page.waitForFunction(()=>Math.abs(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.customize-button').getBoundingClientRect().bottom-(innerHeight-20))<=3)
              await page.waitForFunction(desktopFilterViewportReady)
              boundary=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,rect=node=>{const b=node.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}};return {anchor:rect(root.querySelector('.customize-button')),panel:rect(root.querySelector('.adv-builder')),viewport:{width:innerWidth,height:innerHeight}}})
              assert(boundary.panel.bottom<=boundary.anchor.top-3,'bottom desktop filter did not flip above its current trigger')
              await page.click('.adv-clear')
              await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('.adv-row').length===0)
              boundary.clearClicked=true
              await page.click('.adv-header-close')
              await page.waitForFunction(()=>!document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.adv-builder'))
              boundary.closeClicked=true;boundary.scroll=scroll
            }finally{await page.evaluate(desktopFilterBoundaryScroll,scroll)}
          }else {
            await page.click('.adv-header-close')
            await page.waitForFunction(()=>![...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('.adv-builder')].some(node=>node.getClientRects().length))
          }
          observations.push({theme,kind,reopening,...before,andRestriction:restriction,conditionAdded:true,fieldOptions:options,nestedEscapePreservedParent:true,...(boundary?{desktopBottomBoundary:boundary}:{})})
          await note({nativeFilterReferences:nativeReferences,nativeFilterObservations:observations})
        }
      }
      await page.setViewport({width:390,height:900})
      await page.goto(base+fixture.references.namespacesPath)
      await page.click('.mobile-toggle')
      await waitForNativeStyleSettlement(page,{panel:'.mobile-sheet'},{shadow:false})
      const nativeMobile=await page.evaluate(()=>{const node=document.querySelector('.mobile-sheet'),style=getComputedStyle(node);return {fontFamily:style.fontFamily,fontSize:style.fontSize,background:style.backgroundColor,borderRadius:style.borderRadius}})
      nativeReferences.push({theme,width:390,style:nativeMobile})
      await page.press('body','Escape')
      for(const [kind,path,row,attribute]of [['projects','application-groups','group-card','data-group-id'],['permissions',app,'permission-row','data-permission-key'],['users','users','user-row','data-subject'],['subjects',group+'/scope-grants','subject-row','data-subject']]) {
        await open(path)
        const beforeMobileRows=await visibleRows(row,attribute)
        await page.click('.mobile-toggle')
        await page.waitForFunction(mobileFilterViewportReady)
        await waitForNativeStyleSettlement(page,{panel:'.mobile-sheet'})
        const mobileBefore=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,node=root.querySelector('.mobile-sheet'),style=getComputedStyle(node);return {trigger:root.querySelector('.mobile-bar').getBoundingClientRect().toJSON(),panel:node.getBoundingClientRect().toJSON(),style:{fontFamily:style.fontFamily,fontSize:style.fontSize,background:style.backgroundColor,borderRadius:style.borderRadius}}})
        equal(mobileBefore.style,nativeMobile,'extension mobile filter styles differ from the published host')
        const mobileConfiguration=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,sheet=root.querySelector('.mobile-sheet'),shown=node=>Boolean(node&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'&&!node.closest('[hidden]'));const labels=[...sheet.querySelectorAll('.sheet-tabs label.kel-segmented__item')],find=text=>labels.filter(node=>node.querySelector('.kel-segmented__item-label')?.textContent.trim()===text),saved=find('My Filters saved'),all=find('All Filters'),save=sheet.querySelector('.sheet-footer-actions button:not(.sheet-apply)');if(saved.length!==1||all.length!==1)throw new Error('Native mobile tab labels absent or ambiguous');return {savedTabVisible:shown(saved[0]),saveVisible:shown(save),allTabVisible:shown(all[0]),applyVisible:shown(sheet.querySelector('.sheet-apply'))}})
        assert.equal(mobileConfiguration.savedTabVisible,false,'native mobile filter ignored savedFilters.shown=false')
        assert.equal(mobileConfiguration.saveVisible,false,'disabled saved-filter feature must not expose an unsupported Save entry')
        assert(mobileConfiguration.allTabVisible&&mobileConfiguration.applyVisible,'supported native filter actions were hidden')
        const record=fixture.records[kind==='subjects'?'assignments':kind][0],field=kind==='projects'?'id':kind==='permissions'?'key':'subject',value=record[field]
        const label=kind==='projects'?'Application group ID':kind==='permissions'?'Permission key':'subject'
        await page.click('.mobile-sheet .field-row-header:text-is('+JSON.stringify(label)+')')
        await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.field-row-body')))
        if(kind==='projects') {
          await page.click('.field-row-body .comparator-segment[aria-label="Equals"]')
          await page.waitForFunction(()=>!document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.field-row-body'))
          await page.click('.mobile-sheet .field-row-header:text-is('+JSON.stringify(label)+')')
          await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.field-row-body .comparator-segment[aria-label="Equals"]')?.getAttribute('aria-pressed')==='true')
          await page.fill('.field-row-body input[placeholder="Enter application group id"]',value)
        }
        else {await page.click('.field-row-body .kel-select__wrapper');await page.click('[role="option"]:text-is('+JSON.stringify(value)+')')}
        await page.waitForFunction(({field,value})=>[...new URL(location.href).searchParams.entries()].some(([key,current])=>key.includes(field)&&current===value),{field,value})
        const nested=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot;return [...root.querySelectorAll('[role="option"]')].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden')})
        if(nested) {
          const liveEditor=await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.field-row-body .kel-select__wrapper')))
          if(liveEditor)await page.press('.field-row-body .kel-select__wrapper','Escape')
          await page.waitForFunction(()=>![...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[role="option"]')].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'))
        }
        await page.click('.sheet-apply')
        await page.waitForFunction(()=>!document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.mobile-sheet'))
        await page.waitForFunction(({row,attribute,value})=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,rows=[...root.querySelectorAll('[data-test="'+row+'"]')].filter(node=>node.getClientRects().length);return root.querySelector('main')?.getAttribute('aria-busy')==='false'&&rows.length===1&&rows[0].getAttribute(attribute)===value},{row,attribute,value})
        equal(await visibleRows(row,attribute),[value],'mobile native filter returned the wrong saved result')
        await page.click('.mobile-toggle')
        await page.waitForFunction(mobileFilterViewportReady)
        assert(await page.evaluate(({field,value})=>[...new URL(location.href).searchParams.entries()].some(([key,current])=>key.includes(field)&&current===value),{field,value}),'reopening mobile filter lost its saved query')
        await page.click('.sheet-clear')
        await page.waitForFunction(field=>![...new URL(location.href).searchParams.keys()].some(key=>key.includes('filters['+field+']')),field)
        await page.waitForFunction(({row,attribute,expected})=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,actual=[...root.querySelectorAll('[data-test="'+row+'"]')].filter(node=>node.getClientRects().length).map(node=>node.getAttribute(attribute));return root.querySelector('main')?.getAttribute('aria-busy')==='false'&&JSON.stringify(actual)===JSON.stringify(expected)},{row,attribute,expected:beforeMobileRows})
        assert.deepEqual(await visibleRows(row,attribute),beforeMobileRows,'mobile Clear failed to restore authorized rows')
        // Explicit test stimulus: lose this owned native layer's required action.
        // Recovery itself must use real visible controls and the production SDK.
        await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,node=root.querySelector('.mobile-sheet .sheet-apply');if(!node)throw new Error('Owned mobile integrity stimulus target absent');node.remove()})
        await page.waitForFunction(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot;return !root.querySelector('.mobile-sheet')&&!root.querySelector('.mobile-toggle')&&Boolean(root.querySelector('[data-test="request-error"]')?.getClientRects().length)})
        await page.click('[data-test="request-error"] button')
        await page.waitForFunction(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot;return Boolean(root.querySelector('.mobile-toggle'))&&!root.querySelector('[data-test="request-error"]')})
        await page.click('.mobile-toggle')
        await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.mobile-sheet .sheet-apply')?.getClientRects().length))
        await page.click('.sheet-apply')
        await page.waitForFunction(()=>!document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.mobile-sheet'))
        assert.deepEqual(await visibleRows(row,attribute),beforeMobileRows,'native integrity recovery changed authorized rows')
        observations.push({theme,kind,width:390,...mobileBefore,mobileConfiguration,value,selectedResult:[value],reopenedAtTrigger:true,clearRestoredRows:beforeMobileRows,integrityRecovery:{stimulus:'test-only removal of this owned native Apply node',failedInstanceUnmounted:true,visibleClearClicked:true,freshNativeFilterOpenedAndApplied:true}})
        await note({nativeFilterReferences:nativeReferences,nativeFilterObservations:observations})
      }
      }
      await page.setViewport({width:1280,height:900})
      await preference(fixture.preferences.themes.light)
      await effectsUnchanged(beforeFilterEffects)
      return {nativeReferences,observations,locations:4,themes:4,desktopOpens:32,mobileOpens:48,source:'real-native-filter-clicks-and-geometry'}
    })
    for(const [kind,path,row,attribute]of [['projects','application-groups','group-card','data-group-id'],['permissions',app,'permission-row','data-permission-key'],['users','users','user-row','data-subject'],['subjects',group+'/scope-grants','subject-row','data-subject']])for(const [operator,plan]of Object.entries(fixture.filters[kind]))await run('ui-native-filter-'+kind+'-'+operator,async()=>{
      await open(path)
      await runNativeFilterPlan(plan.steps)
      await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('main')?.getAttribute('aria-busy')==='false')
      equal(await visibleRows(row,attribute),plan.expectedIds,'native KsFilter returned wrong authorized rows')
      const before=await source();assert(before.query,'native filter did not synchronize canonical URL')
      await page.reload();await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false')
      equal(await visibleRows(row,attribute),plan.expectedIds,'native filter lost state after refresh')
      return {kind,operator,ids:plan.expectedIds,source:before,nativeComponent:true,refreshed:true}
    })
    await run('ui-card-search-pagination',async()=>{
      const groups=await all('/application-groups');assert(groups.length>25)
      await open('application-groups');await page.fill('.ks-search input','')
      await openNativeAdvanced();await page.click('.adv-clear');await page.click('.adv-header-close')
      const observed=[]
      for(let number=1;number<=Math.ceil(groups.length/25);number++) {
        observed.push(...await visibleRows('group-card','data-group-id'))
        const total=await page.evaluate(()=>Number(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.kel-pagination__total')?.textContent.replace(/\D/g,'')))
        assert.equal(total,groups.length,'card Total is not the authorized pre-pagination count')
        if(number<Math.ceil(groups.length/25)) {
          const before=observed.at(-1);await page.click('.kel-pagination .btn-next')
          await page.waitForFunction(before=>![...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[data-test="group-card"]')].some(node=>node.getAttribute('data-group-id')===before),before)
        }
      }
      assert.deepEqual(observed,groups.map(item=>item.id).sort(compare),'cards pagination order differs or omitted/duplicated groups')
      const target=groups.at(-1).id;await page.fill('.ks-search input',target)
      await page.waitForFunction(target=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,rows=[...root.querySelectorAll('[data-test="group-card"]')];return root.querySelector('main')?.getAttribute('aria-busy')==='false'&&rows.length===1&&rows[0].getAttribute('data-group-id')===target},target)
      equal(await visibleRows('group-card','data-group-id'),[target],'card search did not reset page or match key')
      return {total:groups.length,pages:Math.ceil(groups.length/25),ids:observed,search:target}
    })
    await run('ui-filter-native-deeplink-coexistence',async()=>{
      const plan=fixture.filters.permissions.equals,target=fixture.records.permissions.find(item=>item.key===plan.expectedIds[0]);assert(target?.scopeKeys.length)
      await open(app+'?scopeKeys='+encodeURIComponent(target.scopeKeys[0]))
      await runNativeFilterPlan(plan.steps)
      equal(await visibleRows('permission-row','data-permission-key'),[target.key])
      const combined=await source();assert(new URLSearchParams(combined.query).getAll('scopeKeys').includes(target.scopeKeys[0]),'native chip erased deep-link scope filter')
      await page.click('[data-test="filter-chip"] button')
      await page.waitForFunction(()=>!new URL(location.href).searchParams.has('scopeKeys'))
      assert(!new URLSearchParams((await source()).query).has('scopeKeys'),'deleting deep-link chip did not clear its query')
      equal(await visibleRows('permission-row','data-permission-key'),[target.key],'deleting deep-link chip erased native filter')
      return {permissionKey:target.key,scopeKey:target.scopeKeys[0],combined,singleRemovalPreservesNative:true}
    })
    await run('ui-filter-native-history',async()=>{
      const permission=fixture.records.permissions.find(item=>item.scopeKeys.includes(fixture.scope));assert(permission)
      const query='?permissionKey='+encodeURIComponent(permission.key)+'&scopeKeys='+encodeURIComponent(fixture.scope)
      await open(app+query)
      await note({historyStage:'initial-filtered-page',expectedKey:permission.key})
      await page.waitForFunction(key=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,rows=[...root.querySelectorAll('[data-test="permission-row"]')];return root.querySelector('main')?.getAttribute('aria-busy')==='false'&&rows.length===1&&rows[0].getAttribute('data-permission-key')===key},permission.key)
      equal(await visibleRows('permission-row','data-permission-key'),[permission.key])
      await page.click('[data-test="application-supported-scopes"] code:text-is('+JSON.stringify(fixture.scope)+')')
      const target='/ui/main/extensions/rbac/'+group+'/scopes/'+fixture.scope
      await page.waitForFunction(path=>location.pathname===path&&document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false',target)
      const mac=await page.evaluate(()=>/Mac/.test(navigator.platform))
      await note({historyStage:'back-to-filtered-page'})
      await page.history('back')
      await page.waitForFunction(({path,key,scope})=>location.pathname===path&&new URL(location.href).searchParams.get('permissionKey')===key&&new URL(location.href).searchParams.getAll('scopeKeys').includes(scope)&&document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false',{path:'/ui/main/extensions/rbac/'+app,key:permission.key,scope:fixture.scope})
      await page.waitForFunction(key=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,rows=[...root.querySelectorAll('[data-test="permission-row"]')];return root.querySelector('main')?.getAttribute('aria-busy')==='false'&&rows.length===1&&rows[0].getAttribute('data-permission-key')===key},permission.key)
      equal(await visibleRows('permission-row','data-permission-key'),[permission.key]);const back=await source()
      await page.history('forward');await page.waitForFunction(path=>location.pathname===path,target)
      return {permissionKey:permission.key,back,forward:await source(),nativeKeyboardHistory:true}
    })
    await run('ui-pagination-total-snapshot',async()=>{
      const evidence=[]
      for(const [path,collection,row,attribute,field]of [[app,permissionApi,'permission-row','data-permission-key','key'],['users','/users','user-row','data-subject','subject'],[group+'/scope-grants',groupApi+'/scope-grants','subject-row','data-subject','subject']]) {
        const records=await all(collection);assert(records.length>25,'pagination requires >25 real records')
        const observed=[]
        await open(path+'?page=1&size=25','[data-test="list-total"]')
        for(let number=1;number<=Math.ceil(records.length/25);number++) {
          const expectedPage=records.map(item=>item[field]).sort(compare).slice((number-1)*25,number*25)
          await page.waitForFunction(({row,attribute,expected})=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,actual=[...root.querySelectorAll('[data-test="'+row+'"]')].filter(node=>node.getClientRects().length).map(node=>node.getAttribute(attribute));return root.querySelector('main')?.getAttribute('aria-busy')==='false'&&JSON.stringify(actual)===JSON.stringify(expected)},{row,attribute,expected:expectedPage})
          observed.push(...await visibleRows(row,attribute))
          const total=await page.evaluate(()=>Number(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="list-total"] .kel-pagination__total').textContent.replace(/\D/g,'')))
          assert.equal(total,records.length,'Total differs from authorized pre-pagination count')
          if(number<Math.ceil(records.length/25)) {await page.click('[data-test="list-total"] .btn-next');await page.waitForFunction(number=>new URL(location.href).searchParams.get('page')===String(number),number+1)}
        }
        assert.deepEqual(observed,records.map(item=>item[field]).sort(compare),'pagination order differs or omitted/duplicated authorized records')
        assert.equal(new Set(observed).size,observed.length)
        await page.click('[data-test="list-total"] .kel-select__wrapper')
        const options=await page.evaluate(()=>[...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[role="option"]')].filter(node=>node.getClientRects().length&&/^100(?:\D|$)/.test(node.textContent.trim())).map(node=>node.textContent.trim()))
        assert.equal(options.length,1,'page-size option 100 is missing or ambiguous');await page.click('[role="option"]:text-is('+JSON.stringify(options[0])+')')
        await page.waitForFunction(()=>{const query=new URL(location.href).searchParams;return query.get('size')==='100'&&(!query.has('page')||query.get('page')==='1')})
        assert.deepEqual(await visibleRows(row,attribute),records.map(item=>item[field]).sort(compare),'page size change failed to reset page or preserve machine-key order')
        evidence.push({path,total:records.length,pages:Math.ceil(records.length/25),sizeChangeReset:true})
      }
      return evidence
    })
    await run('ui-sidebar-search-pagination',async()=>{
      const evidence=[]
      for(const [kind,path,records,field,attribute]of [['scope',group+'/scopes',fixture.records.scopes,'key','data-scope-key'],['application',group+'/applications',fixture.records.clients,'clientId','data-client-key']]) {
        const actual=await all(kind==='scope'?groupApi+'/scopes':groupApi+'/applications')
        equal(actual.map(item=>item[field]),records.map(item=>item[field]),'sidebar expected snapshot differs from complete production directory; late additions must not be ignored')
        assert(records.length>25);await open(path,selector(kind+'-sidebar'))
        const allIds=[]
        for(let number=1;number<=Math.ceil(records.length/25);number++) {
          allIds.push(...await visibleRows(kind+'-item',attribute))
          if(number<Math.ceil(records.length/25)){const previous=allIds.at(-1);await page.click(selector(kind+'-sidebar')+' footer button:last-child');await page.waitForFunction(({kind,attribute,previous})=>![...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[data-test="'+kind+'-item"]')].some(node=>node.getAttribute(attribute)===previous),{kind,attribute,previous})}
        }
        assert.deepEqual(allIds,records.map(item=>item[field]).sort(compare),'sidebar pagination order differs or omitted/duplicated authorized keys')
        const target=records.at(-1)[field]
        await page.fill(selector(kind+'-sidebar')+' input',target)
        equal(await visibleRows(kind+'-item',attribute),[target],'sidebar search returned wrong keys')
        await page.click(selector(kind+'-item',attribute,target));await readonly(selector(kind==='scope'?'scope-detail':'application-detail'))
        evidence.push({kind,target,path:(await state()).path})
      }
      return evidence
    })
    await run('ui-four-drawers-focus-discard',async()=>{
      const evidence=[]
      for(const [kind,path,trigger]of [['group','application-groups','.management-toolbar button'],['user','users','[data-test="user-create"]'],['permission',app,'[data-test="permission-add"]'],['subject',group+'/scope-grants','[data-test="subject-add"]']]) {
        await open(path);await drawer(kind,trigger)
        const normal=await page.evaluate(kind=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-'+kind+'"]').getBoundingClientRect().width,kind)
        assert(normal>0&&normal<=await page.evaluate(()=>innerWidth),'native drawer exceeds its actual viewport')
        await toggleDrawerMaximize();await closeDrawer(kind)
        assert(await page.evaluate(trigger=>document.querySelector('[data-test="extension-container"]').shadowRoot.activeElement?.matches(trigger),trigger),'drawer did not restore trigger focus')
        await drawer(kind,trigger)
        const reset=await page.evaluate(kind=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-'+kind+'"]').getBoundingClientRect().width,kind)
        assert.equal(reset,normal,'maximize state leaked across opening')
        const focus=await checkFocus(kind)
        evidence.push({kind,normalWidth:normal,focusTrapped:true,escapeClosed:true,focusReturned:true,focus})
      }
      return evidence
    })
    await run('ui-four-drawers-draft-discard',async()=>{
      const evidence=[]
      for(const [kind,path,trigger,input]of [['group','application-groups','.management-toolbar button','[data-test="drawer-group"] .kel-form-item:first-of-type input'],['user','users','[data-test="user-create"]','[data-test="drawer-user"] input[name="username"]'],['permission',app,'[data-test="permission-add"]','[name="permission-name"]'],['subject',group+'/scope-grants','[data-test="subject-add"]',null]]) {
        await open(path);await drawer(kind,trigger)
        const draft='unsaved-browser-'+randomBytes(3).toString('hex')
        if(input)await page.fill(input,draft)
        else {await page.click('[data-test="drawer-subject"] .kel-form-item:first-of-type .kel-select__wrapper');await page.click('[role="option"]:text-is('+JSON.stringify(fixture.zeroAccount.subject)+')')}
        const before=await page.evaluate(kind=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-'+kind+'"]').textContent,kind)
        await page.focus(input??'.rbac-editor-drawer .kel-drawer__close-btn');await page.pressFocused('Escape')
        await page.waitForFunction(discardConfirmationVisible)
        await page.click('[data-test="discard-confirm"] .kel-button:not(.kel-button--danger)')
        assert(await page.evaluate(kind=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-'+kind+'"]')),kind),'cancel discard closed editor')
        if(input)assert.equal(await page.evaluate(input=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector(input).value,input),draft,'cancel discard lost entered draft')
        else assert((await page.evaluate(kind=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-'+kind+'"]').textContent,kind)).includes(fixture.zeroAccount.subject),'cancel discard lost selected subject')
        await clickDrawerHeader();await page.waitForFunction(discardConfirmationVisible)
        await page.click('[data-test="discard-confirm"] .kel-button--danger')
        await page.waitForFunction(kind=>!document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-'+kind+'"]'),kind)
        assert(await page.evaluate(trigger=>document.querySelector('[data-test="extension-container"]').shadowRoot.activeElement?.matches(trigger),trigger),'confirmed discard did not restore focus')
        await drawer(kind,trigger)
        if(input)assert.equal(await page.evaluate(input=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector(input).value,input),'','discarded draft returned on reopen')
        await closeDrawer(kind)
        evidence.push({kind,escapeRequestedConfirmation:true,cancelRetainedDraft:true,confirmedDiscardClearedDraft:true,focusReturned:true,observedDialogContent:Boolean(before)})
      }
      return evidence
    })
    await run('ui-409-412-no-side-effects',async()=>{
      const permissions=await all(permissionApi),permission=permissions.find(item=>item.scopeKeys.length===1&&item.scopeKeys[0]===fixture.scope)
      assert(permission);const path=permissionApi+'/'+permission.key,original=permissionInput(permission)
      restores.push({id:'cleanup-restore-cas-permission',run:async()=>{const current=await read(path);await request(path,'PUT',original,current.revision,[200])}})
      await editPermission(permission.key)
      const draftName=permission.name+' stale browser draft'
      await page.fill('[name="permission-name"]',draftName)
      const management=fixture.targetRuntime?.management;assert(management,'independent real management session required for CAS conflict')
      await management.login();await management.request(api+path,'PUT',{...original,description:'Concurrent accepted server edit'},permission.revision)
      const accepted=await read(path),beforeEffects=await fixture.targetRuntime.effects.snapshot()
      const stale=await clickSave('[data-test="drawer-save"]',path,'PUT',[412])
      assert.equal(await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[name="permission-name"]').value),draftName,'412 discarded browser draft')
      equal(await read(path),accepted,'412 overwrote concurrent data');assert.equal((await fixture.targetRuntime.effects.snapshot()).hash,beforeEffects.hash)
      assert(await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="conflict-refresh"]'))),'conflict has no explicit refresh')
      await page.click('[data-test="drawer-permission"] [data-test="conflict-refresh"]');await page.waitForFunction(discardConfirmationVisible)
      await page.click('[data-test="discard-confirm"] .kel-button--danger')
      await page.waitForFunction(()=>!document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-permission"]'))
      await open(app);await drawer('permission','[data-test="permission-add"]')
      await page.fill('[name="permission-key"]',permission.key);await page.fill('[name="permission-name"]','Duplicate must not replace')
      const duplicateBefore=await all(permissionApi)
      const duplicate=await clickSave('[data-test="drawer-save"]',permissionApi,'POST',[409])
      equal(await all(permissionApi),duplicateBefore,'409 changed permission catalog')
      assert.equal(await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[name="permission-name"]').value),'Duplicate must not replace','409 discarded draft')
      await login()
      return {stale,duplicate,persistedConcurrentRevision:accepted.revision,noBusinessSideEffects:true,refreshExplicit:true}
    })
    await run('ui-loading-transition',async()=>{
      const observed=report.requests.filter(request=>request.loading)
      assert(observed.length&&observed.some(request=>request.loading.saving),'no actual drawer save was observed')
      assert(observed.every(request=>request.loading.busy&&(!request.loading.saving||request.loading.closeDisabled&&request.loading.saveDisabled)))
      return observed.map(request=>({path:request.path,method:request.method,loading:request.loading}))
    })
    await run('ui-account-temporary-password-lifecycle',async()=>{
      const username='ui-created-'+randomBytes(5).toString('hex')
      await open('users');await drawer('user','[data-test="user-create"]')
      await page.fill('[data-test="drawer-user"] input[name="username"]',username)
      await page.fill('[data-test="drawer-user"] input[name="name"]','Browser created account')
      await page.fill('[data-test="drawer-user"] input[name="email"]',username+'@acceptance.invalid')
      await clickSave('[data-test="drawer-save"]','/users','POST',[201])
      const password=await oneTimeValue('password')
      const user=await read('/users/detail?subject='+encodeURIComponent(username))
      assert.equal(user.subject,username);assert.equal(user.name,'Browser created account');assert(!Object.hasOwn(user,'temporaryPassword'),'GET replayed one-time temporary password')
      await page.click('[data-test="temporary-password-once"] .kel-button--primary')
      assert(!await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.rbac-one-time-value')?.textContent.trim())),'closing did not clear plaintext')
      await open('users?filterSubject='+username);equal(await visibleRows('user-row','data-subject'),[username])
      await drawer('user','[data-test="user-list"] .kel-table tbody tr .buttons button:first-child')
      const changedName='Browser profile '+randomBytes(5).toString('hex'),changedEmail=username+'-edited@acceptance.invalid'
      await page.fill('[data-test="drawer-user"] input[name="name"]',changedName);await page.fill('[data-test="drawer-user"] input[name="email"]',changedEmail)
      await clickSave('[data-test="drawer-save"]','/users/profile')
      const updated=await read('/users/detail?subject='+encodeURIComponent(username))
      assert.equal(updated.name,changedName);assert.equal(updated.email,changedEmail);assert(updated.revision>user.revision)
      await page.reload();await open('users?filterSubject='+username)
      await drawer('user','[data-test="user-list"] .kel-table tbody tr .buttons button:first-child')
      equal(await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot;return {name:root.querySelector('[data-test="drawer-user"] input[name="name"]').value,email:root.querySelector('[data-test="drawer-user"] input[name="email"]').value}}),{name:changedName,email:changedEmail})
      await closeDrawer('user')
      const account={username,subject:username,password,passwordChangeRequired:true}
      const changed=await login(account);assert.equal(changed.path,'/ui/access-denied','new unassigned account unexpectedly acquired business authorization')
      await page.click('[data-testid="return-to-login"]');await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]')))
      await page.fill('input[name="username"]',account.username);await page.fill('input[name="password"]',account.password);await page.click('button[type="submit"]');await page.waitForFunction(()=>location.pathname==='/ui/access-denied'&&!document.querySelector('input[name="password"]'))
      await login();await open('users?filterSubject='+username);equal(await visibleRows('user-row','data-subject'),[username])
      await page.click('[data-test="user-delete"]');await clickSave('[data-test="delete-confirm"] .kel-button--danger','/users/detail?subject='+encodeURIComponent(username),'DELETE',[204])
      await request('/users/detail?subject='+encodeURIComponent(username),'GET',undefined,undefined,[404])
      assert(!(await all(groupApi+'/scope-grants')).some(grant=>grant.subject===username),'account delete left grant record')
      return {subject:username,temporaryCredentialShownOnce:true,profileSavedAndRefreshed:{name:changedName,email:changedEmail,revision:updated.revision},forcedPasswordChange:'real-browser',freshLoginAfterChange:true,zeroAuthorization:true,deletedThroughUi:true}
    })
    await run('ui-read-write-separation',async()=>{
      assert(fixture.accessAccounts,'isolated READ-only and MANAGE-only accounts required')
      const management=fixture.targetRuntime?.management,effects=fixture.targetRuntime?.effects;assert(management&&effects)
      await management.login();const baseline=await management.readPermissions(fixture.applicationGroupId),permission=baseline.items.find(item=>item.scopeKeys.includes(fixture.scope))
      const evidence=[]
      for(const kind of ['identity-read','identity-manage','local-read','local-manage']) {
        const account=fixture.accessAccounts[kind];assert(account)
        const loginState=await login(account),before=await effects.snapshot()
        const path=kind.startsWith('local')?app:group
        await page.goto(base+'/ui/main/extensions/rbac/'+path)
        await page.waitForFunction(()=>location.pathname==='/ui/access-denied'||document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false')
        const content=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot;return {path:location.pathname,text:root?.textContent??'',denied:location.pathname==='/ui/access-denied'||Boolean(root?.querySelector('[data-test="request-error"]')),editors:root?[...root.querySelectorAll('[data-test="group-edit"],[data-test="scope-add"],[data-test="application-register"],[data-test="permission-add"],[data-test="user-create"],[data-test="permission-edit"],[data-test="permission-delete"],[data-test="user-delete"],[data-test="subject-add"]')].filter(node=>node.getClientRects().length).length:0,rows:root?.querySelectorAll('[data-test="permission-row"],[data-test="user-row"],[data-test="group-card"],[data-test="scope-item"],[data-test="application-item"],[data-test="subject-row"]')?.length??0,overview:Boolean(root?.querySelector('[data-test="group-detail"] .rbac-details'))}})
        assert.equal(content.editors,0,'READ/MANAGE-only unexpectedly displayed a maintenance editor')
        if(kind.endsWith('manage')){assert.equal(content.rows,0,'MANAGE-only leaked directory/permission rows');assert.equal(content.overview,false,'MANAGE-only leaked group metadata');assert(content.denied,'MANAGE-only must fail closed, not silently render empty success')}
        if(kind==='identity-manage')for(const path of ['/users?page=1&size=25',groupApi,groupApi+'/scopes?page=1&size=25'])await request(path,'GET',undefined,undefined,[403])
        if(kind==='local-manage')await request(permissionApi+'?page=1&size=25','GET',undefined,undefined,[403])
        if(kind==='identity-read'){assert(content.overview&&!content.denied,'IDENTITY.READ could not load actual group detail');await readonly('[data-test="group-detail"]')}
        if(kind==='local-read'){assert(content.rows>0,'LOCAL_POLICY.READ could not reach typed permissions without IDENTITY.READ');assert(!content.text.includes(fixture.subject),'local-only page leaked identity directory')}
        if(kind.endsWith('read')) {
          const denied=await request(permissionApi+'/'+permission.key,'PUT',permissionInput(permission),permission.revision,[403])
          assert.equal(denied.status,403)
        }
        assert.equal((await effects.snapshot()).hash,before.hash,'READ-only rejected write changed business persistence/queues/storage')
        if(content.denied&&content.path!=='/ui/access-denied') {
          await page.click('[data-test="sign-in-again"]')
          await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]'))&&Boolean(document.querySelector('input[name="password"]')))
          const cleared=await request('/capabilities','GET',undefined,undefined,[401])
          assert.equal(cleared.status,401,'plugin change-account entry retained an authenticated session')
          content.logoutReachedProductionLogin=true
        }
        evidence.push({kind,subject:account.subject,loginPath:loginState.path,content,beforeHash:before.hash,afterHash:before.hash})
      }
      await login();await management.login();equal(await management.readPermissions(fixture.applicationGroupId),baseline,'READ/MANAGE-only checks changed actual policy')
      const combined=fixture.accessAccounts['local-read-manage'];assert(combined,'LOCAL_POLICY READ+MANAGE account without IDENTITY.READ required')
      await login(combined)
      await editPermission(permission.key)
      const changedName=permission.name+' local-only verified'
      await page.fill('[name="permission-name"]',changedName)
      await clickSave('[data-test="drawer-save"]',permissionApi+'/'+permission.key,'PUT',[200])
      const saved=await read(permissionApi+'/'+permission.key)
      assert.equal(saved.name,changedName);equal(permissionInput(saved),{...permissionInput(permission),name:changedName});assert(saved.revision>permission.revision)
      for(const path of [groupApi,groupApi+'/scopes?page=1&size=25','/users?page=1&size=25'])await request(path,'GET',undefined,undefined,[403])
      await page.reload();await open(app+'?permissionKey='+encodeURIComponent(permission.key),'[data-test="application-permissions"]')
      assert(await page.evaluate(name=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="application-permissions"]').textContent.includes(name),changedName),'local-only save did not survive refresh')
      const localKey='local-only-'+randomBytes(6).toString('hex')
      await drawer('permission','[data-test="permission-add"]')
      await page.fill('[name="permission-key"]',localKey);await page.fill('[name="permission-name"]','Local-only created permission')
      await page.fill('[data-test="scope-picker"] textarea',fixture.scope)
      await clickSave('[data-test="drawer-save"]',permissionApi,'POST',[200])
      const created=await read(permissionApi+'/'+localKey)
      equal(created.scopeKeys,[fixture.scope]);equal(created.grants,[]);equal(created.managementGrants,[])
      await open(app+'?permissionKey='+localKey,'[data-test="application-permissions"]')
      equal(await visibleRows('permission-row','data-permission-key'),[localKey])
      await page.click('[data-test="permission-delete"]')
      await clickSave('[data-test="delete-confirm"] .kel-button--danger',permissionApi+'/'+localKey,'DELETE',[200])
      await request(permissionApi+'/'+localKey,'GET',undefined,undefined,[404])
      await login();const restore=await read(permissionApi+'/'+permission.key)
      await request(permissionApi+'/'+permission.key,'PUT',permissionInput(permission),restore.revision,[200])
      evidence.push({kind:'local-read-manage',subject:combined.subject,realUiSave:true,refreshed:true,identityDirectoryDenied:true,scopeKeysUnchanged:true,createdAndDeletedThroughUi:true,knownKeyInputOnly:true})
      await login();await management.login()
      const restored=await management.readPermissions(fixture.applicationGroupId)
      assert.equal(restored.total,baseline.total)
      equal(restored.items.map(permissionInput),baseline.items.map(permissionInput),'UI privilege-separation checks changed actual policy content')
      assert(restored.parentRevision>baseline.parentRevision,'real metadata save did not advance parent revision')
      return {scope:'T9 UI subset only; REST/domain/full security matrix belongs to main report',accounts:evidence,policyUnchanged:true}
    })
    await run('ui-secret-one-time-rotation',async()=>{
      await login();const publicPath='/'+external+'/credentials',publicStatus=await read(publicPath)
      assert.equal(publicStatus.clientType,'public');assert.equal(publicStatus.rotationMode,'none')
      await open(external)
      assert(!await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="credential-rotate"]'))),'public client exposed rotation entry')
      const beforeEffects=await fixture.targetRuntime.effects.snapshot()
      const denied=await request(publicPath+'/rotate','POST',undefined,publicStatus.credentialRevision,[400]);assert.equal(denied.body?.code,'public_client_no_secret')
      equal(await read(publicPath),publicStatus);assert.equal((await fixture.targetRuntime.effects.snapshot()).hash,beforeEffects.hash)
      const controls=fixture.credentialControls??fixture.targetRuntime?.credentialControls
      if(!controls?.clientId||typeof controls.verifySecret!=='function'||typeof page.responseMetadata!=='function')throw Object.assign(new Error('T7 ordinary confidential client, production verifySecret and shared adapter responseMetadata required; public denial was executed'),{code:'acceptance_contract_missing'})
      requireMethods(fixture.targetRuntime,['userAuditEvidence'],'targetRuntime')
      const auditRead=fixture.targetRuntime.userAuditEvidence,auditBefore=await auditRead({subject:fixture.admin.subject,groupId:fixture.applicationGroupId})
      assert.equal(auditBefore.status,200);assert.equal(auditBefore.readAllAuthorized,true)
      const oldAuditIds=new Set(auditBefore.authorizedItems.map(event=>event.id));await note({credentialAuditBefore:auditBefore})
      const path=groupApi+'/applications/'+encoded(controls.clientId),credentials=await read(path+'/credentials')
      assert.equal(credentials.clientType,'confidential');assert.equal(credentials.rotationMode,'online')
      await open(group+'/applications/'+encoded(controls.clientId));const eventBaseline=new Set((await page.diagnostics()).events.map(event=>event.id));await page.click('[data-test="credential-rotate"]')
      const next=await oneTimeValue('secret')
      const rotationEvent=(await page.diagnostics()).events.find(event=>!eventBaseline.has(event.id)&&event.kind==='http-response'&&event.method==='POST'&&event.url===base+api+path+'/credentials/rotate')
      assert(rotationEvent,'native rotation response missing')
      const responseMetadata=await page.responseMetadata({requestId:rotationEvent.requestId,documentId:rotationEvent.documentId,url:rotationEvent.url})
      assert.equal(responseMetadata.requestId,rotationEvent.requestId);assert.equal(responseMetadata.documentId,rotationEvent.documentId);assert.equal(responseMetadata.url,rotationEvent.url);assert.equal(responseMetadata.status,rotationEvent.status);assert.equal(responseMetadata.status,200);assert(/(?:^|,)\s*no-store\s*(?:,|$)/i.test(responseMetadata.cacheControl),'one-time credential response lacks no-store')
      const status=await read(path+'/credentials');assert(status.credentialRevision>credentials.credentialRevision);assert(status.maskedHint&&status.maskedHint!==next)
      assert(status.maskedHint.includes(next.slice(0,3))&&status.maskedHint.includes(next.slice(-4)),'masked hint does not match generated secret head/tail')
      assert(!JSON.stringify(status).includes(next),'credential GET exposed plaintext')
      const verified=await controls.verifySecret({clientId:controls.clientId,newSecret:next})
      assert.equal(verified.transport,'production-oidc');assert.equal(verified.newSecretAccepted,true);assert.equal(verified.oldSecretAccepted,false)
      const auditAfter=await auditRead({subject:fixture.admin.subject,groupId:fixture.applicationGroupId})
      assert.equal(auditAfter.status,200);assert.equal(auditAfter.readAllAuthorized,true)
      const rotationAudit=auditAfter.authorizedItems.filter(event=>!oldAuditIds.has(event.id)&&event.operation==='CLIENT_SECRET_ROTATE'&&event.clientId===controls.clientId&&event.groupId===fixture.applicationGroupId)
      await note({credentialAuditAfter:auditAfter,rotationAudit});assert.equal(rotationAudit.length,1,'actual UI rotation must append exactly one public group audit event')
      assert.equal(rotationAudit[0].actorSubject,fixture.admin.subject);assert.equal(rotationAudit[0].targetSubject,null)
      await page.click('[data-test="credential-once"] .kel-button--primary')
      assert(!await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.rbac-one-time-value')?.textContent.trim())),'secret retained after close')
      await page.reload();await open(group+'/applications/'+encoded(controls.clientId))
      await page.waitForFunction(hint=>document.querySelector('[data-test="extension-container"]')?.shadowRoot?.textContent.includes(hint),status.maskedHint)
      assert((await state()).text.includes(status.maskedHint),'masked hint lost on refresh')
      const stale=await request(path+'/credentials/rotate','POST',undefined,credentials.credentialRevision,[412])
      equal(await read(path+'/credentials'),status,'stale rotation changed valid credentials')
      const auditRejected=await auditRead({subject:fixture.admin.subject,groupId:fixture.applicationGroupId})
      equal(auditRejected.authorizedItems.filter(event=>event.operation==='CLIENT_SECRET_ROTATE'&&event.clientId===controls.clientId),auditAfter.authorizedItems.filter(event=>event.operation==='CLIENT_SECRET_ROTATE'&&event.clientId===controls.clientId),'rejected stale request appended or modified successful rotation audit')
      const retention=await page.evaluate(secret=>{const roots=[document];let attributes=false,plaintext=false;for(let index=0;index<roots.length;index++)for(const node of roots[index].querySelectorAll('*')){if(node.shadowRoot)roots.push(node.shadowRoot);attributes||=[...node.attributes].some(attribute=>attribute.value.includes(secret));plaintext||=[...node.childNodes].some(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.includes(secret))}return {url:location.href.includes(secret),storage:[...Object.values(localStorage),...Object.values(sessionStorage)].some(value=>String(value).includes(secret)),attributes,plaintext,roots:roots.length}},next)
      assert(!retention.url&&!retention.storage&&!retention.attributes&&!retention.plaintext,'one-time secret escaped into URL/storage/attributes or remained in a shadow tree')
      return {publicDenied:denied.status,clientId:controls.clientId,credentialRevision:status.credentialRevision,maskedHint:status.maskedHint,oneTime:true,noPlaintextRetention:true,staleStatus:stale.status,protocol:verified,responseMetadata,rotationAudit}
    })
    await run('ui-secret-maintenance',async()=>{
      const path='/'+app+'/credentials',before=await read(path),effects=await fixture.targetRuntime.effects.snapshot()
      assert.equal(before.rotationMode,'deployment-maintenance')
      await open(app)
      assert(!await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="credential-rotate"]'))),'login client exposed online rotation')
      const refused=await request(path+'/rotate','POST',undefined,before.credentialRevision,[409]);assert.equal(refused.body?.code,'maintenance_required')
      equal(await read(path),before);assert.equal((await fixture.targetRuntime.effects.snapshot()).hash,effects.hash)
      assert(/CLI|maintenance|维护/.test((await state()).text),'login client has no maintenance guidance')
      return {scope:'T8 UI entry/online refusal subset only; maintenance CLI and actual login belong to main report',rotationMode:before.rotationMode,status:refused.status,unchanged:true}
    })
    await run('ui-403-no-side-effects',async()=>{
      const management=fixture.targetRuntime?.management,effects=fixture.targetRuntime?.effects,account=fixture.accessAccounts?.['identity-read']
      assert(management&&effects&&account,'owned management, business observer and isolated account required')
      const path=groupApi+'/scope-grants/detail?subject='+encodeURIComponent(account.subject)
      await management.login()
      const original=await management.request(api+path),administrator=await management.request(api+groupApi+'/scope-grants/detail?subject='+encodeURIComponent(fixture.admin.subject))
      const permissions=await management.readPermissions(fixture.applicationGroupId),permission=permissions.items.find(item=>item.scopeKeys.includes(fixture.scope));assert(permission)
      const permissionPath=permissionApi+'/'+permission.key,beforePermission=permissionInput(permission)
      const restore=async()=>{await management.login();const current=await management.request(api+path);if(JSON.stringify([...current.scopeKeys].sort())!==JSON.stringify([...original.scopeKeys].sort()))await management.request(api+path,'PUT',{issuer:original.issuer,subject:original.subject,scopeKeys:original.scopeKeys},current.revision)}
      restores.push({id:'cleanup-restore-revoked-editor-account',run:restore})
      await management.request(api+path,'PUT',{issuer:original.issuer,subject:original.subject,scopeKeys:[...new Set([...original.scopeKeys,...administrator.scopeKeys])]},original.revision)
      try {
        await login(account);await editPermission(permission.key)
        const draft='Rejected after revocation '+randomBytes(5).toString('hex')
        await page.fill('[name="permission-description"]',draft)
        await restore()
        const before=await effects.snapshot(),requestOffset=report.requests.length
        const rejected=await clickSave('[data-test="drawer-save"]',permissionPath,'PUT',[403])
        await page.waitForFunction(()=>{const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot;return Boolean(root?.querySelector('[data-test="request-error"]'))&&!root.querySelector('[data-test="drawer-permission"]')&&!root.querySelector('[data-test="permission-row"]')})
        assert(!((await state()).text.includes(draft)),'revoked editor retained sensitive draft')
        const after=await effects.snapshot();assert.equal(after.hash,before.hash,'403 UI save changed business persistence/queues/storage')
        await management.login()
        const stored=(await management.readPermissions(fixture.applicationGroupId)).items.find(item=>item.key===permission.key)
        equal(permissionInput(stored),beforePermission,'403 UI save changed typed permission')
        const replacement=await login();assert.equal(replacement.path,'/ui/main/dashboards')
        return {source:'production-browser-and-owned-dependency-control',subject:account.subject,replacementSubject:fixture.admin.subject,status:rejected.status,beforeEffects:{hash:before.hash,sources:Object.keys(before.sources??{})},afterEffects:{hash:after.hash,sources:Object.keys(after.sources??{})},requests:report.requests.slice(requestOffset).filter(request=>request.requestId),sensitiveDraftCleared:true,permissionUnchanged:true,realLogoutAndAccountSwitch:true}
      }finally{await restore()}
    })
    await run('ui-503-retry-no-side-effects',dependencyUnavailableCase)
    await runAdditionalDirectoryCases()
    await runAdditionalAccountCases()
    await runAdditionalInteractionCases()
    await runAdditionalSecretCases()
    for(const theme of accessControlThemes)for(const locale of accessControlLocales)await run('ui-theme-language-'+theme+'-'+locale,async()=>{
      await page.setColorScheme('light');await page.setViewport({width:1280,height:900})
      await preference(fixture.preferences.themes[theme]);await preference(fixture.preferences.locales[locale])
      const preferenceSelector=fixture.preferences.themes[theme].at(-1).selector
      await page.waitForFunction(selector=>document.querySelector(selector)?.getAttribute('aria-checked')==='true',preferenceSelector)
      assert.equal(await page.evaluate(selector=>document.querySelector(selector)?.getAttribute('aria-checked'),preferenceSelector),'true','selected host theme preference differs')
      const references={}
      for(const [name,path,selectors]of [['mcp',fixture.references.mcpPath,{tab:fixture.references.tab,button:fixture.references.button}],['namespaces',fixture.references.namespacesPath,{search:fixture.references.search}],['flows',fixture.references.flowsPath,{header:fixture.references.tableHeader,cell:fixture.references.tableCell}]]) {
        await page.goto(base+path);await page.waitForFunction(({path,selectors})=>location.pathname===path&&Object.values(selectors).every(selector=>document.querySelector(selector)?.getClientRects().length),{path,selectors});Object.assign(references,await styles(selectors,false))
      }
      await open(app+'?permissionKey='+encodeURIComponent(fixture.records.permissions.find(item=>item.scopeKeys.includes(fixture.scope)).key),'[data-test="application-permissions"]')
      const computed=await styles({tab:'[role="tab"][aria-selected="true"]',button:'[data-test="permission-add"]',search:'.ks-search input',header:'.kel-table th',cell:'.kel-table tbody td',main:'main'})
      for(const field of ['fontFamily','fontSize','fontWeight','padding','radius'])assert.equal(computed.tab[field],references.tab[field],'MCP tab '+field)
      for(const field of ['fontSize','radius'])assert.equal(computed.button[field],references.button[field],'MCP button '+field)
      assert.equal(computed.search.fontSize,references.search.fontSize,'Namespaces search typography')
      for(const field of ['fontSize','fontWeight'])assert.equal(computed.header[field],references.header[field],'Flows header '+field)
      for(const field of ['fontSize','borderBottomStyle','borderBottomWidth'])assert.equal(computed.cell[field],references.cell[field],'Flows row '+field)
      assert.notEqual(computed.cell.color,computed.cell.background);assert.notEqual(computed.header.color,computed.header.background)
      const translation=await state(),expected=fixture.localeText[locale]
      assert.equal(translation.lang,locale.replaceAll('_','-'),'actual language differs')
      assert(translation.text.includes(expected.clients)&&translation.text.includes(expected.scopes),'navigation translation differs')
      assert.equal(await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.ks-search input').placeholder),expected.search)
      await page.reload();await page.waitForFunction(()=>document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy')==='false');assert.equal((await state()).lang,translation.lang,'preference lost on refresh')
      await openNativeAdvanced()
      await page.waitForFunction(expected=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-and-filter-note]')?.textContent.trim()===expected,accessControlAndFilterText[locale])
      await waitForNativeStyleSettlement(page,{panel:'.adv-builder',note:'[data-and-filter-note]'})
      const filterLayout=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,panel=root.querySelector('.adv-builder'),note=panel.querySelector('[data-and-filter-note]'),footer=panel.querySelector('.adv-footer'),box=panel.getBoundingClientRect();return {width:innerWidth,panel:{left:box.left,right:box.right,width:box.width},scrollWidth:panel.scrollWidth,clientWidth:panel.clientWidth,noteText:note.textContent.trim(),noteInButtonRow:footer.contains(note),footerButtons:[...footer.querySelectorAll('button')].map(node=>({text:node.textContent.trim(),disabled:node.disabled,width:node.getBoundingClientRect().width})),disabledDescribedBy:[...footer.querySelectorAll('button:disabled')].map(node=>root.getElementById(node.getAttribute('aria-describedby'))===note)}})
      await note({filterLayout})
      assert.equal(filterLayout.noteText,accessControlAndFilterText[locale],'AND explanation translation differs')
      assert.equal(filterLayout.noteInButtonRow,false,'AND explanation must not compress the native filter button row')
      assert.equal(filterLayout.footerButtons.length,3,'native filter footer actions changed')
      assert(filterLayout.footerButtons.every(button=>button.width>0),'native filter action has no visible area')
      assert(filterLayout.disabledDescribedBy.length>0&&filterLayout.disabledDescribedBy.every(Boolean),'disabled OR action lost accessible explanation')
      assert(filterLayout.scrollWidth<=filterLayout.clientWidth+2&&filterLayout.panel.left>=0&&filterLayout.panel.right<=filterLayout.width+2,'localized native filter overflows')
      await page.click('.adv-header-close')
      const layouts=[]
      for(const width of accessControlWidths) {
        await page.setViewport({width,height:900});await drawer('permission','[data-test="permission-edit"]')
        assert.equal(await page.evaluate(()=>document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-save"]').textContent.trim()),expected.save,'save label translation differs')
        await page.focus('[name="permission-name"]');await page.press('[name="permission-name"]','Tab')
        const layout=await page.evaluate(()=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,active=root.activeElement,style=active&&getComputedStyle(active),wrapper=active?.closest('.kel-input__wrapper.is-focus,.kel-select__wrapper.is-focused'),focusStyle=wrapper&&getComputedStyle(wrapper),box=root.querySelector('[data-test="drawer-permission"]').getBoundingClientRect();return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,left:box.left,right:box.right,focusVisible:Boolean(active&&!active.disabled&&(style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>0||focusStyle&&focusStyle.boxShadow!=='none'))}})
        assert(layout.focusVisible,'keyboard focus invisible');assert(layout.documentWidth<=width+2&&layout.left>=-2&&layout.right<=width+2,'horizontal overflow')
        const scopeInput='[data-test="drawer-permission"] [data-test="scope-picker"] input[role="combobox"]'
        const selectedBeforeSearch=await page.evaluate(()=>[...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[data-test="drawer-permission"] [data-test="scope-picker"] .rbac-tags code')].map(n=>n.textContent))
        assert(selectedBeforeSearch.includes(fixture.scope),'the actual edited permission must retain its authorized scope before native search')
        await page.click(scopeInput)
        await page.fill(scopeInput,'no-matching-scope-'+randomBytes(8).toString('hex'))
        await page.waitForFunction(expected=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,visible=[...root.querySelectorAll('.kel-select-dropdown__empty')].filter(node=>node.getClientRects().length);return visible.length===1&&visible[0].textContent.trim()===expected},accessControlNativeSelectNoMatch[locale])
        layout.nativeSelectNoMatch=await page.evaluate(()=>[...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('.kel-select-dropdown__empty')].find(node=>node.getClientRects().length).textContent.trim())
        assert.equal(layout.nativeSelectNoMatch,accessControlNativeSelectNoMatch[locale],'native select did not follow the actual host language preference')
        await page.press(scopeInput,'Escape')
        const selectedAfterSearch=await page.evaluate(()=>[...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[data-test="drawer-permission"] [data-test="scope-picker"] .rbac-tags code')].map(n=>n.textContent))
        assert.deepEqual(selectedAfterSearch,selectedBeforeSearch,'search must not remove or change selected scope grants')
        layout.scopeSearchPreservedSelection={before:selectedBeforeSearch,after:selectedAfterSearch}
        assert(await page.evaluate(()=>Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="drawer-permission"]'))),'native select ESC incorrectly closed its parent drawer')
        layouts.push(layout);await closeDrawer('permission')
        for(const [path,element]of [['application-groups','[data-test="application-group-cards"]'],[group,'[data-test="group-detail"]'],[group+'/scopes/'+fixture.scope,'[data-test="scope-detail"]'],[group+'/scope-grants','[data-test="subject-list"]'],['users','[data-test="user-list"]']]) {
          await open(path,element)
          if(path==='application-groups') {
            const countSpacing=await page.evaluate(cardCountSpacingMeasurements)
            assert(countSpacing.length>=3&&countSpacing.every(row=>Number.isFinite(row.token)&&row.token>0&&row.gap>=row.token-1&&row.text.startsWith(row.count+' ')),'localized/narrow card count units visually joined')
            const headingLayout=await page.evaluate(cardHeadingMeasurements)
            assert(headingLayout.length&&headingLayout.every(row=>row.vertical&&row.nameGap>0&&(row.badgeGap===null||row.badgeGap>0)),'localized/narrow card heading labels joined')
            layouts.push({path,width,countSpacing,headingLayout})
          }
          const overflow=await page.evaluate(element=>{const root=document.querySelector('[data-test="extension-container"]').shadowRoot,box=root.querySelector(element).getBoundingClientRect();return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,left:box.left,right:box.right,text:root.querySelector(element).textContent.trim()}},element)
          assert(overflow.text&&overflow.documentWidth<=width+2&&overflow.left>=-2&&overflow.right<=width+2,'localized page overflow or missing stable content: '+path)
          layouts.push({path,...overflow})
        }
        await open(app+'?permissionKey='+encodeURIComponent(fixture.records.permissions.find(item=>item.scopeKeys.includes(fixture.scope)).key),'[data-test="application-permissions"]')
      }
      const resolvedTheme=()=>page.evaluate(()=>{const classes=document.documentElement.classList;return classes.contains('dark-2')?'dark-2':classes.contains('dark')?'dark':'light'})
      if(theme==='system') {
        assert.equal(await resolvedTheme(),'light','system preference did not start with OS light')
        const systemLight=await styles({main:'main'})
        await page.setColorScheme('dark');await page.waitForFunction(()=>document.documentElement.classList.contains('dark')||document.documentElement.classList.contains('dark-2'))
        const dark=await styles({main:'main'});assert.notEqual(dark.main.color,computed.main.color,'system theme ignored OS preference');await page.setColorScheme('light')
        await page.waitForFunction(()=>!document.documentElement.classList.contains('dark')&&!document.documentElement.classList.contains('dark-2'))
        equal(await styles({main:'main'}),systemLight,'system light colors did not restore')
      }else assert.equal(await resolvedTheme(),theme,'resolved host theme differs')
      if(locale==='en')snapshots.set(theme,computed)
      return {theme,locale,computedStyles:computed,translation,filterLayout,keyboardFocus:true,noHorizontalOverflow:true,layouts,references,refreshed:true}
    })
    for(const theme of accessControlThemes)for(const locale of accessControlLocales) {
      await run('ui-four-drawers-theme-language-'+theme+'-'+locale,()=>fourDrawerThemeCase(theme,locale))
      await run('ui-auth-theme-language-'+theme+'-'+locale,()=>authThemeCase(theme,locale))
    }
    await run('ui-theme-colors-are-distinct',async()=>{for(const [left,right]of [['light','dark'],['light','dark-2'],['dark','dark-2']])assert.notEqual(JSON.stringify(snapshots.get(left)),JSON.stringify(snapshots.get(right)),'theme colors collapsed');return Object.fromEntries(snapshots)})
  }catch(error){report.failure??={case:currentCase,message:String(error.message)}}
  finally {
    report.cleanup=[]
    for(const restore of restores.reverse())try{await login();await restore.run();report.cleanup.push({id:restore.id,passed:true,status:'passed'})}catch(error){report.cleanup.push({id:restore.id,passed:false,status:'failed',error:String(error.message)});report.failure??={case:restore.id,message:String(error.message)}}
    for(const name of accessControlCaseIds)if(!report.rows.some(row=>row.name===name)){
      const combination=name.match(/^ui-theme-language-(light|dark-2|dark|system)-(.+)$/)
      report.rows.push({name,case:combination?'theme-language':name,...(combination?{theme:combination[1],locale:combination[2]}:{}),passed:false,status:'not_run'})
    }
    currentCase='console-page-request-errors-have-explicit-sources'
    const row=report.rows.find(row=>row.name===currentCase)
    try {
      const diagnostics=await page.diagnostics(),events=diagnostics.events.filter(event=>!baselineEvents.has(event.id))
      for(const event of events)assert(event.id&&event.documentId&&event.url&&event.kind,'diagnostic source identity missing')
      for(const window of report.identityWindows??[])if(window.kind==='authenticated-session'){window.finishedAt??=new Date().toISOString();window.documentIds=[...new Set([window.initialDocumentId,...events.filter(event=>event.kind==='document-navigation'&&Date.parse(event.observedAt)>=Date.parse(window.startedAt)&&Date.parse(event.observedAt)<=Date.parse(window.finishedAt)).map(event=>event.documentId)])]}
      const {classifications,errors}=classifyAccessControlDiagnostics({events,base,requests:report.requests,expectedTransportFailures:report.expectedTransportFailures,identityWindows:report.identityWindows})
      report.diagnostics=events
      report.diagnosticClassifications=classifications
      assert.equal(errors.length,0,'unclassified source-attributed browser errors: '+JSON.stringify(errors))
      Object.assign(row,{passed:true,status:'passed',evidence:{events:events.length,expectedErrorIds:classifications.map(item=>item.id),classifications}})
    }catch(error){Object.assign(row,{passed:false,status:'failed',error:String(error.message)});report.failure??={case:currentCase,message:String(error.message)}}
    report.completed=!report.failure&&report.rows.length===accessControlCaseIds.length&&report.rows.every(row=>row.passed&&row.status==='passed')&&report.cleanup.every(row=>row.passed)
    await persist()
  }
  assert(report.completed,'v3 UI acceptance incomplete: '+sanitizeUiEvidence(report.failure?.message??'not_run checks remain',secrets))
  return sanitizeUiEvidence(report,secrets)
}
