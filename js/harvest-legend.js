(function(root){
 'use strict';
 const palettes={viridis_inverted:['#fde725','#7ad151','#22a884','#2a788e','#414487','#440154'],viridis:['#440154','#414487','#2a788e','#22a884','#7ad151','#fde725'],harvest:['#d73027','#fc8d59','#fee08b','#d9ef8b','#91cf60','#1a9850']};
 const labels=['0 a menos de 120 sc/ha','120 a menos de 130 sc/ha','130 a menos de 140 sc/ha','140 a menos de 160 sc/ha','160 a 180 sc/ha','Acima de 180 sc/ha'];
 const defaults=()=>({palette:'viridis_inverted',colors:[...palettes.viridis_inverted],labels:[...labels]});
 const valid=s=>s&&Array.isArray(s.colors)&&s.colors.length===6&&s.colors.every(c=>/^#[0-9a-f]{6}$/i.test(c))&&Array.isArray(s.labels)&&s.labels.length===6&&s.labels.every(v=>typeof v==='string'&&v.trim().length>0&&v.length<=100);
 let settings=defaults(),revision=0,control,card,editor,list,toggle,paletteInput,rows;const listeners=new Set();
 try{const saved=JSON.parse(root.localStorage.getItem('harvest-legend-v1'));if(valid(saved))settings=saved;}catch{}
 const category=value=>value<120?0:value<130?1:value<140?2:value<160?3:value<=180?4:5;
 function apply(next){if(!valid(next))throw new Error('Preencha os textos e escolha uma cor para cada faixa.');settings={palette:next.palette,colors:[...next.colors],labels:next.labels.map(v=>v.trim())};revision++;try{root.localStorage.setItem('harvest-legend-v1',JSON.stringify(settings));}catch{}render();listeners.forEach(fn=>fn());}
 function render(){if(!list)return;list.replaceChildren();settings.labels.forEach((label,i)=>{const row=document.createElement('li'),dot=document.createElement('i'),text=document.createElement('span');dot.style.background=settings.colors[i];text.textContent=label;row.append(dot,text);list.append(row);});card.querySelector('.harvest-legend-ramp').style.background='linear-gradient(to right,'+settings.colors.join(',')+')';}
 function fillEditor(){paletteInput.value=palettes[settings.palette]?settings.palette:'custom';rows.forEach((row,i)=>{row.color.value=settings.colors[i];row.label.value=settings.labels[i];});}
 function close(){editor.hidden=true;toggle.setAttribute('aria-expanded','false');card.classList.remove('is-editing');}
 function init(map){
  if(control)return;
  const Control=L.Control.extend({options:{position:'bottomright'},onAdd(){
   card=L.DomUtil.create('section','harvest-map-legend hidden');card.setAttribute('aria-label','Legenda da produtividade');
   card.innerHTML='<button type="button" class="harvest-legend-toggle" aria-expanded="false" aria-controls="harvest-legend-editor" aria-label="Editar legenda"><span><strong>Produtividade do milho</strong><small>sc/ha</small></span><i class="fa-solid fa-sliders" aria-hidden="true"></i></button><div class="harvest-legend-ramp"></div><ul class="harvest-classes"></ul><form id="harvest-legend-editor" class="harvest-legend-editor" hidden><label>Rampa de cores<select aria-label="Rampa de cores"><option value="viridis_inverted">Viridis invertida</option><option value="viridis">Viridis</option><option value="harvest">Vermelho a verde</option><option value="custom">Personalizada</option></select></label><p>Edite o texto e a cor de cada faixa.</p><div class="harvest-legend-rows"></div><p class="harvest-legend-error" role="alert"></p><div class="harvest-legend-actions"><button type="button" data-action="reset">Restaurar</button><button type="button" data-action="cancel">Cancelar</button><button type="submit">Aplicar</button></div></form>';
   toggle=card.querySelector('.harvest-legend-toggle');editor=card.querySelector('form');list=card.querySelector('ul');paletteInput=editor.querySelector('select');rows=[];
   const container=editor.querySelector('.harvest-legend-rows');
   labels.forEach((_,i)=>{const row=document.createElement('div'),color=document.createElement('input'),label=document.createElement('input');row.className='harvest-legend-row';color.type='color';color.setAttribute('aria-label','Cor da faixa '+(i+1));label.type='text';label.maxLength=100;label.required=true;label.setAttribute('aria-label','Texto da faixa '+(i+1));row.append(color,label);container.append(row);rows.push({color,label});color.oninput=()=>{paletteInput.value='custom';};});
   toggle.onclick=()=>{if(editor.hidden){fillEditor();editor.hidden=false;card.classList.add('is-editing');toggle.setAttribute('aria-expanded','true');paletteInput.focus();}else close();};
   paletteInput.onchange=()=>{const chosen=palettes[paletteInput.value];if(chosen)rows.forEach((row,i)=>{row.color.value=chosen[i];});};
   editor.onsubmit=e=>{e.preventDefault();try{apply({palette:paletteInput.value,colors:rows.map(r=>r.color.value),labels:rows.map(r=>r.label.value)});editor.querySelector('[role="alert"]').textContent='';close();toggle.focus();}catch(error){editor.querySelector('[role="alert"]').textContent=error.message;}};
   editor.querySelector('[data-action="cancel"]').onclick=()=>{close();toggle.focus();};editor.querySelector('[data-action="reset"]').onclick=()=>{apply(defaults());fillEditor();};
   card.addEventListener('keydown',e=>{if(e.key==='Escape'){close();toggle.focus();}});
   L.DomEvent.disableClickPropagation(card);L.DomEvent.disableScrollPropagation(card);render();return card;
  }});control=new Control().addTo(map);
 }
 root.HarvestStyle=Object.freeze({get:()=>({colors:[...settings.colors],labels:[...settings.labels],palette:settings.palette,revision}),category,color:v=>v==null?'#94a3b8':settings.colors[category(v)],apply,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);}});
 root.HarvestLegend=Object.freeze({init,show(visible){if(card){card.classList.toggle('hidden',!visible);if(!visible)close();}}});
})(window);
