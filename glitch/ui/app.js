'use strict';
const $ = (id) => document.getElementById(id);
const state = {session: null, cursor: 0, settings: {}, sessions: [], pending: null, running: null, lastRun: null, count: 0, ready: false, polling: false, submitting: false};
let librarySignature = '', modelPhase = '', transferPhase = '';
function toast(text, error = false) {
  const node = document.createElement('div'); node.className = 'toast' + (error ? ' error' : ''); node.textContent = text;
  $('toasts').append(node); setTimeout(() => node.remove(), error ? 8000 : 5500);
}
async function call(method, ...args) {
  if (!state.ready) throw new Error('The desktop bridge is still starting.');
  try { return await window.pywebview.api[method](...args); }
  catch (error) { throw new Error(error.message || String(error)); }
}
function status(title, kind = '') {
  $('status').textContent = title;
  $('companion').className = 'companion' + (['local','tool','browser','computer'].includes(kind) ? ' busy' : kind === 'supervisor' ? ' busy cloud' : '');
}
function addMessage(role, content) {
  $('welcome')?.remove();
  const node = document.createElement('article'); node.className = 'message ' + role;
  const label = document.createElement('span'); label.className = 'role'; label.textContent = role === 'user' ? 'You' : 'Glitch';
  const text = document.createElement('div'); text.textContent = content; node.append(label, text); $('messages').append(node);
  $('messages').scrollTop = $('messages').scrollHeight;
}
function addEvent(event, live = false) {
  $('events').querySelector('.empty')?.remove();
  const node = document.createElement('details'); node.className = 'event ' + event.kind;
  const summary = document.createElement('summary'), marker = document.createElement('span'); marker.className = 'marker';
  marker.textContent = event.kind === 'error' ? '!' : event.kind === 'completed' || event.kind === 'result' ? '✓' : '·';
  const title = document.createElement('span'); title.textContent = event.title; summary.append(marker, title);
  const time = document.createElement('time'); time.textContent = new Date(event.created_at.replace(' ', 'T') + 'Z').toLocaleTimeString();
  if (event.payload.duration_ms !== undefined) time.textContent += ` · ${event.payload.duration_ms} ms`;
  const detail = document.createElement('pre'); detail.textContent = event.payload.text || event.payload.result?.diff || JSON.stringify(event.payload, null, 2);
  node.append(summary, time, detail); $('events').append(node);
  if (event.kind === 'output') node.open = true;
  if (event.kind === 'capture') {
    call('screenshot', event.payload.path).then(data => {const image = document.createElement('img'); image.src = 'data:image/png;base64,' + data; image.alt = 'Approved screenshot'; node.append(image); node.open = true;}).catch(e => toast(e.message, true));
  }
  state.count++; $('event-count').textContent = String(state.count);
  if (live) {
    if (event.kind === 'message') addMessage('assistant', event.payload.text);
    if (['started','local','supervisor','browser','computer','completed','stopped','paused'].includes(event.kind)) status(event.title, event.kind);
    if (['correction','anchor'].includes(event.kind)) {toast(event.title); status(event.title);}
    if (event.kind === 'error') toast(event.title, true);
  }
  while ($('events').children.length > 200) $('events').firstElementChild.remove();
  if (live) $('events').scrollTop = $('events').scrollHeight;
}
function renderSessions() {
  const workspaceName = path => {const parts=path.split(/[\\/]/);return parts.at(-2)==='workspaces'&&parts.at(-1).startsWith('Chat-')?'Chat workspace':parts.at(-1);};
  $('sessions').replaceChildren();
  state.sessions.forEach(session => {
    const node = document.createElement('button'); node.className = 'session' + (state.session === session.id ? ' active' : '');
    const title = document.createElement('strong'); title.textContent = session.title;
    const path = document.createElement('small'); path.textContent = workspaceName(session.workspace); node.append(title, path);
    node.title = session.workspace; node.onclick = () => selectSession(session.id).catch(e => toast(e.message, true)); $('sessions').append(node);
  });
  const active = state.sessions.find(s => s.id === state.session);
  $('project').textContent = active ? workspaceName(active.workspace) : 'Choose a project folder';
  $('project').title = active?.workspace || ''; $('workspace-path').textContent = active?.workspace || 'Choose where Glitch should work';
}
async function selectSession(identifier) {
  if (state.voiceGeneration) restoreDictation();
  state.drafts ??= {};
  if (state.session) state.drafts[state.session] = $('prompt').value;
  await call('voice_select_session', identifier);
  state.session = identifier; state.cursor = 0; state.count = 0;
  $('prompt').value = state.drafts[identifier] || '';
  const result = await call('load_conversation', identifier);
  if (state.session !== identifier) return;
  $('messages').replaceChildren(); $('events').replaceChildren(); $('event-count').textContent = '0';
  result.messages.forEach(m => addMessage(m.role, m.content));
  result.events.forEach(e => {addEvent(e); state.cursor = e.id;});
  // Drain archived timeline pages without replaying assistant messages into the loaded conversation.
  while (result.events.length === 300) {
    const page = await call('poll', identifier, state.cursor);
    if (state.session !== identifier) return;
    result.events = page.events; page.events.forEach(e => {addEvent(e); state.cursor = e.id;});
  }
  renderSessions();
}
function updateRuntime(runtime) {
  state.runtime = runtime;
  state.running = runtime.active_sessions ? (runtime.active_sessions.includes(state.session) ? state.session : null) : runtime.running_session;
  const busy = !!state.running || state.submitting;
  const full = runtime.active_sessions && runtime.active_sessions.length >= runtime.capacity;
  $('new-agent').disabled = !!full || !state.ready;
  $('stop').disabled = !state.running; $('send').disabled = busy || full || !state.ready;
  $('choose').disabled = state.submitting; $('new').disabled = state.submitting;
  $('prompt').disabled = busy || state.voicePhase === 'dictating';
  const runs = runtime.runs || [];
  $('stream-count').textContent = `${(runtime.active_sessions || (state.running ? [state.running] : [])).length} / ${runtime.capacity || 1}`;
  const visibleRuns = runs.filter(r=>runtime.active_sessions?.includes(r.session));
  visibleRuns.push(...runs.filter(r=>!runtime.active_sessions?.includes(r.session)).slice(-Math.max(0,8-visibleRuns.length)));
  const wanted = new Set(visibleRuns.map(r=>r.id));
  [...$('agent-deck').children].forEach(row=>{if(!wanted.has(row.dataset.run))row.remove();});
  visibleRuns.forEach(run => {
    let row = [...$('agent-deck').children].find(n=>n.dataset.run===run.id);
    if (!row) {
      row = document.createElement('div'); row.className = 'agent-run';row.dataset.run=run.id;
      const heading=document.createElement('strong'),detail=document.createElement('small');
      const open=document.createElement('button');open.textContent='Open';open.onclick=async()=>{try{const b=await call('bootstrap');state.sessions=b.sessions;await selectSession(run.session);}catch(e){toast(e.message,true);}};
      const stop=document.createElement('button');stop.textContent='Stop';stop.onclick=()=>call('stop',run.id).catch(e=>toast(e.message,true));
      row.append(heading,detail,open,stop);$('agent-deck').append(row);
    }
    row.children[0].textContent=run.role+(run.parent_id?' · Sub-agent':'');
    row.children[1].textContent=`${run.status} · ${run.last_action||run.task}`;row.children[1].title=run.task;
    row.children[3].disabled=!runtime.active_sessions?.includes(run.session);
  });
  const pending = runtime.approval;
  if (pending && state.pending?.id !== pending.id) {
    state.pending = pending; $('approval-title').textContent = pending.action;
    $('approval-payload').textContent = JSON.stringify(pending.payload, null, 2);
    if (!$('approval-dialog').open) $('approval-dialog').showModal();
    status('Glitch is waiting for your approval');
  } else if (!pending && state.pending) {state.pending = null; $('approval-dialog').close();}
}
function updateSettings(settings) {
  state.settings = settings; $('mode').textContent = settings.mode === 'hybrid' ? 'Hybrid supervision' : 'Local only';
  $('access-mode').textContent = settings.full_access ? 'Full Access' : 'Ask before actions';
  $('access-mode').classList.toggle('amber', !!settings.full_access);
  $('composer-access-label').textContent = settings.full_access ? 'Full access' : 'Ask before actions';
  $('composer-access').setAttribute('aria-pressed', String(!!settings.full_access));
  $('access-note').textContent = settings.full_access ? 'Full Access is on. Actions run without approval prompts.' : 'Private by default. Ask before actions is on.';
  $('model-label').textContent = settings.worker_model || 'No local model selected';
  $('status-detail').textContent = settings.mode === 'hybrid' ? 'Built-in local worker · Supervisor audits on errors, loops and milestones' : 'Built-in local reasoning · Cloud audits are off';
}
function populateSettings() {
  const s = state.settings;
  $('full-access').checked = !!s.full_access;
  $('parallel-streams').value = s.parallel_streams || 1;
  $('gpu-mode').value = s.gpu_mode || 'auto';
  $('wake-word-enabled').checked = !!s.wake_word_enabled;
  $('announce-completed').checked = !!s.announce_completed_tasks;
  $('speech-volume').value = s.speech_volume ?? 80; $('speech-rate').value = s.speech_rate ?? 0;
  $('speech-voice').value = s.speech_voice_id || '';
  for (const [id, key] of Object.entries({'setting-mode':'mode','worker-model':'worker_model','supervisor-url':'supervisor_url','supervisor-model':'supervisor_model','audit-interval':'audit_interval','max-steps':'max_steps','discord-user':'discord_user_id','discord-channel':'discord_channel_id','context-length':'context_length','cpu-threads':'cpu_threads','temperature':'temperature','vision-projector':'vision_projector','supervisor-auth':'supervisor_auth','supervisor-provider':'supervisor_provider','proxy-url':'proxy_url','proxy-login-url':'proxy_login_url','proxy-model':'proxy_model'})) $(id).value = s[key] ?? '';
  $('supervisor-key').value = ''; $('discord-token').value = ''; $('clear-key').checked = false; $('clear-discord').checked = false;
  $('supervisor-key').placeholder = s.key_saved ? 'Key saved securely — leave blank to keep' : 'Enter supervisor API key';
  $('discord-token').placeholder = s.discord_token_saved ? 'Token saved securely — leave blank to keep' : 'Enter Discord bot token';
  $('proxy-token').value = ''; $('clear-proxy').checked = false;
  $('proxy-token').placeholder = s.proxy_token_saved ? 'Bridge key saved securely — leave blank to keep' : 'Optional bridge access key';
  renderSupervisorMode();
  renderCache();
}
async function saveSettings() {
  const result = await call('save_settings', {
    mode:$('setting-mode').value, worker_model:$('worker-model').value,
    full_access:$('full-access').checked,
    parallel_streams:Number($('parallel-streams').value), wake_word_enabled:$('wake-word-enabled').checked,
    announce_completed_tasks:$('announce-completed').checked, speech_voice_id:$('speech-voice').value,
    speech_volume:Number($('speech-volume').value), speech_rate:Number($('speech-rate').value),
    context_length:Number($('context-length').value), cpu_threads:Number($('cpu-threads').value), gpu_mode:$('gpu-mode').value,
    temperature:Number($('temperature').value), vision_projector:$('vision-projector').value,
    supervisor_auth:$('supervisor-auth').value, supervisor_provider:$('supervisor-provider').value,
    proxy_url:$('proxy-url').value, proxy_login_url:$('proxy-login-url').value, proxy_model:$('proxy-model').value,
    proxy_token:$('proxy-token').value, clear_proxy_token:$('clear-proxy').checked,
    supervisor_url:$('supervisor-url').value, supervisor_model:$('supervisor-model').value,
    supervisor_key:$('supervisor-key').value, clear_key:$('clear-key').checked,
    audit_interval:Number($('audit-interval').value), max_steps:Number($('max-steps').value),
    discord_token:$('discord-token').value, discord_user_id:$('discord-user').value.trim(),
    discord_channel_id:$('discord-channel').value.trim(), clear_discord_token:$('clear-discord').checked,
  });
  updateSettings(result); populateSettings(); $('save-result').textContent = 'Saved locally';
}
async function choose() {
  const session = await call('choose_workspace'); if (!session) return;
  state.sessions.unshift(session); await selectSession(session.id); toast('Project selected');
}
$('choose').onclick = () => choose().catch(e => toast(e.message, true)); $('project').onclick = $('choose').onclick;
$('new').onclick = async () => {try {const session = await call('new_conversation', state.session); state.sessions.unshift(session); await selectSession(session.id); status('Glitch is ready');} catch(e){toast(e.message,true);}};
$('settings-open').onclick = () => {populateSettings(); $('settings-dialog').showModal();};
$('settings-close').onclick = () => {$('settings-dialog').close(); $('supervisor-key').value=''; $('discord-token').value='';};
$('settings-dialog').addEventListener('close', () => {$('supervisor-key').value=''; $('discord-token').value=''; $('proxy-token').value='';});
$('settings-form').onsubmit = async e => {e.preventDefault(); try {await saveSettings(); $('settings-dialog').close(); toast('Settings saved');} catch(error){toast(error.message,true);}};
document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => {
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b === button)));
  ['models','supervisor','discord','tools','voice'].forEach(name => $('settings-'+name).hidden = name !== button.dataset.tab);
});
function renderSupervisorMode() {
  const proxy = $('supervisor-auth').value === 'proxy';
  $('api-fields').hidden = proxy; $('proxy-fields').hidden = !proxy;
}
$('supervisor-auth').onchange = renderSupervisorMode;
$('supervisor-provider').onchange = () => {
  const endpoints = {openrouter:'https://openrouter.ai/api/v1',openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1'};
  const models = {openrouter:'anthropic/claude-sonnet-4.6',openai:'gpt-4.1',anthropic:'claude-sonnet-4-6'};
  const provider = $('supervisor-provider').value;
  if (endpoints[provider]) {$('supervisor-url').value=endpoints[provider];$('supervisor-model').value=models[provider];}
};
function renderLibrary(models, force=false) {
  const signature = JSON.stringify(models);
  if (!force && signature === librarySignature) return;
  const initialized = librarySignature !== '';
  librarySignature = signature;
  for (const [id, blank, key] of [['worker-model','Choose a local model','worker_model'],['vision-projector','Text / browser DOM only','vision_projector']]) {
    const selected = initialized ? $(id).value : state.settings[key] || '';
    $(id).replaceChildren(); const empty=document.createElement('option');empty.value='';empty.textContent=blank;$(id).append(empty);
    models.filter(model => id !== 'vision-projector' || model.name !== $('worker-model').value).forEach(model=>{const option=document.createElement('option');option.value=model.name;option.textContent=`${model.name} · ${(model.size/1024**3).toFixed(2)} GB`;$(id).append(option);});
    if (selected && !models.some(model=>model.name===selected)) {const unavailable=document.createElement('option');unavailable.value=selected;unavailable.textContent=selected+' (not in library)';$(id).append(unavailable);}
    $(id).value = id === 'vision-projector' && selected === $('worker-model').value ? '' : selected;
  }
}
async function refreshModels(force=false) {
  const result=await call('model_status'); renderLibrary(result.models,force);
  const transfer=result.transfer, inference=result.inference;
  $('transfer-status').textContent=transfer.message+(transfer.received?` · ${(transfer.received/1024**2).toFixed(1)} MB${transfer.total?` of ${(transfer.total/1024**2).toFixed(1)} MB`:''}`:'');
  if (transfer.total) $('model-progress').value=transfer.phase==='complete'?100:Math.min(99,100*transfer.received/transfer.total);
  else if (['downloading','verifying'].includes(transfer.phase)) $('model-progress').removeAttribute('value');
  else $('model-progress').value=0;
  const transferring=['downloading','verifying'].includes(transfer.phase);
  $('cancel-transfer').disabled=!transferring;$('download-model').disabled=transferring;$('import-model').disabled=transferring;
  $('inference-status').textContent=(inference.name?inference.name+' · ':'')+inference.message;
  $('load-model').disabled=!!state.running||['loading','generating'].includes(inference.phase);
  $('unload-model').disabled=!!state.running||inference.phase==='unloaded';$('delete-model').disabled=!!state.running;
  if (inference.phase !== modelPhase) {
    if (inference.phase==='loading') status('Glitch is loading your local model...', 'local');
    if (inference.phase==='generating') status('Glitch is processing locally...', 'local');
    if (inference.phase==='ready' && modelPhase==='loading') toast('Local model is ready');
    if (inference.phase==='error') toast(inference.message,true);
    modelPhase=inference.phase;
  }
  if (transfer.phase!==transferPhase) {
    if (transfer.phase==='complete') toast('Model saved to your local library');
    if (transfer.phase==='error') toast(transfer.message,true);
    transferPhase=transfer.phase;
  }
}
$('worker-model').onchange = () => {
  if (librarySignature) renderLibrary(JSON.parse(librarySignature), true);
};
function action(id, handler) {$(id).onclick=async()=>{const button=$(id);button.disabled=true;try{await handler();}catch(e){toast(e.message,true);}finally{button.disabled=false;}};}
action('discover',()=>refreshModels(true));
action('download-model',async()=>{await call('download_model',$('download-url').value.trim(),$('download-sha').value.trim());await refreshModels();});
action('import-model',async()=>{await call('import_model');await refreshModels();});
action('cancel-transfer',()=>call('cancel_model_transfer'));
action('load-model',async()=>{await saveSettings();await call('load_model');await refreshModels();});
action('unload-model',async()=>{await call('unload_model');await refreshModels();});
action('delete-model',async()=>{const name=$('worker-model').value;if(!name||!confirm(`Delete ${name} from this PC?`))return;await call('delete_model',name);await refreshModels(true);});
action('test-supervisor',async()=>{await saveSettings();$('supervisor-result').textContent='Testing connection...';try{const result=await call('test_supervisor');$('supervisor-result').textContent=result.message;$('supervisor-options').replaceChildren();result.models.forEach(name=>{const option=document.createElement('option');option.value=name;$('supervisor-options').append(option);});if(!$('proxy-model').value&&result.models.length&&$('supervisor-auth').value==='proxy')$('proxy-model').value=result.models[0];}catch(e){$('supervisor-result').textContent=e.message;throw e;}});
action('proxy-login',async()=>{await saveSettings();const result=await call('open_proxy_login');toast(result.message);});
$('connect-discord').onclick = async () => {try {await saveSettings();const result=await call('connect_discord');$('discord-detail').textContent=result.message;} catch(e){toast(e.message,true);}};
$('disconnect-discord').onclick = async () => {try {const result=await call('disconnect_discord');$('discord-detail').textContent=result.message;} catch(e){toast(e.message,true);}};
$('composer').onsubmit = async e => {e.preventDefault(); const prompt=$('prompt').value.trim(); if (!prompt || state.running || state.submitting) return;
  if (state.voicePhase === 'dictating') {toast('Stop dictation before sending your task.');return;}
  state.submitting=true; updateRuntime({running_session:state.running,approval:state.pending});
  try {
    if (!state.session) {const session=await call('new_conversation',null);state.sessions.unshift(session);await selectSession(session.id);}
    await call('send',state.session,prompt);addMessage('user',prompt);$('prompt').value='';state.running=state.session;
  } catch(error){toast(error.message,true);}
  finally {state.submitting=false;updateRuntime({running_session:state.running,approval:state.pending});}
};
$('prompt').addEventListener('keydown', e => {if (e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('composer').requestSubmit();}});
$('stop').onclick = () => call('stop',state.session).then(() => status('Stopping Glitch safely...')).catch(e => toast(e.message,true));
async function resolveApproval(answer) {try {await call('approve',state.pending.id,answer);$('approval-dialog').close();} catch(e){toast(e.message,true);}}
$('approve').onclick = () => resolveApproval(true); $('deny').onclick = () => resolveApproval(false);
$('approval-dialog').addEventListener('cancel', e => {e.preventDefault();resolveApproval(false);});
let ticks=0;
async function poll() {
  if (!state.ready || state.polling) return;
  state.polling=true; const identifier=state.session;
  try {
    await refreshModels();
    updateVoice(await call('voice_status'));
    if (identifier) {const result=await call('poll',identifier,state.cursor); if(identifier===state.session){result.events.forEach(event=>{addEvent(event,true);state.cursor=event.id;});updateRuntime(result.runtime);$('discord-state').textContent=result.discord.message || 'Discord is disconnected';$('discord-detail').textContent=result.discord.message || '';}}
    if (++ticks%10===0 || !identifier) {
      const result=await call('bootstrap');state.sessions=result.sessions;updateRuntime(result.runtime);renderSessions();
      if(!result.runtime.runs && result.runtime.running_session && result.runtime.running_session !== state.lastRun) {
        state.lastRun=result.runtime.running_session;
        if(state.session !== state.lastRun) await selectSession(state.lastRun);
      } else if(!state.session&&state.sessions.length) await selectSession(state.sessions[0].id);
      $('discord-state').textContent=result.discord.message || 'Discord is disconnected';
    }
  } catch(e) {status('Glitch connection interrupted. Retrying...');}
  finally {state.polling=false;}
}
window.addEventListener('pywebviewready', async () => {
  if (state.ready) return;
  state.ready=true;
  try {const result=await call('bootstrap');updateSettings(result.settings);await refreshModels(true);populateSettings();state.sessions=result.sessions;if(state.sessions.length)await selectSession(state.sessions[0].id);updateRuntime(result.runtime);$('discord-state').textContent=result.discord.message || 'Discord is disconnected';for(const warning of result.startup_warnings || [])toast(warning,true);}
  catch(e){toast(e.message,true);}
  setInterval(poll,600);
});

function renderCache() {
  const per = Number($('context-length').value), slots = Number($('parallel-streams').value);
  $('cache-allocation').textContent = `${slots} stream(s) share one ${per.toLocaleString()}-token pool and one loaded model. Increasing the stream count does not multiply the context allocation.`;
}
$('parallel-streams').onchange = renderCache; $('context-length').addEventListener('input',renderCache);
function restoreDictation() {
  if (state.voiceBase !== undefined) $('prompt').value = state.voiceBase;
  state.voiceGeneration = null; state.voiceBase = undefined;
  $('dictation-preview').hidden = true;
}
function updateVoice(voice) {
  const input = voice.input, output = voice.output;
  if (input.phase === 'dictating' && input.conversation_id && !state.session && !state.voiceSelecting) {
    state.voiceSelecting = true;
    call('bootstrap').then(async b => {state.sessions=b.sessions;await selectSession(input.conversation_id);}).catch(e=>toast(e.message,true)).finally(()=>{state.voiceSelecting=false;});
  }
  state.voicePhase = input.phase;
  const labels = {off:'Microphone off',listening:'Listening for Hey Glitch',dictating:'Dictating...',speaking:'Glitch is speaking'};
  $('voice-state').textContent = input.error || labels[input.phase] || 'Microphone off';
  $('microphone').setAttribute('aria-label', input.phase === 'dictating' ? 'Stop dictation' : 'Start dictation');
  $('microphone').title = input.phase === 'dictating' ? 'Stop dictation' : 'Start offline dictation';
  $('microphone').setAttribute('aria-pressed',String(input.phase === 'dictating'));
  $('stop-speaking').hidden = output.phase !== 'speaking';
  $('dictation-preview').hidden = input.phase !== 'dictating';
  if (input.conversation_id === state.session && input.generation_id) {
    if (input.phase === 'dictating' && state.voiceGeneration !== input.generation_id) {
      state.voiceGeneration = input.generation_id; state.voiceBase = $('prompt').value;
    }
    if (state.voiceGeneration === input.generation_id) {
      const prefix = state.voiceBase || '';
      const draft = prefix + (prefix && input.final ? ' ' : '') + (input.final || '');
      $('prompt').value = draft.slice(0,20000);
      $('dictation-text').textContent = input.interim || (input.final ? 'Continue speaking...' : 'Listening...');
      if (input.phase !== 'dictating') {state.voiceGeneration=null;state.voiceBase=undefined;}
    }
  }
  $('prompt').disabled = !!state.running || input.phase === 'dictating';
  const model = input.model || {};
  $('voice-setup-status').textContent = model.message || 'Set up offline voice to use your microphone';
  $('voice-progress').value = model.phase === 'ready' ? 100 : model.total ? Math.min(99,100*model.received/model.total) : 0;
  $('setup-voice').disabled = ['ready','downloading'].includes(model.phase);
  $('cancel-voice-setup').disabled = model.phase !== 'downloading';
  const signature = JSON.stringify(output.voices || []);
  if (state.voiceList !== signature) {
    state.voiceList = signature; const selected = $('speech-voice').value || state.settings.speech_voice_id || '';
    $('speech-voice').replaceChildren(new Option('Windows default voice',''));
    (output.voices || []).forEach(v => $('speech-voice').append(new Option(v.name,v.id)));
    $('speech-voice').value=selected;
  }
  if (output.error && output.error !== state.voiceError) {toast(output.error,true);state.voiceError=output.error;}
  if (input.error && input.error !== state.inputVoiceError) {toast(input.error,true);state.inputVoiceError=input.error;}
}
action('microphone',async()=>{
  if(state.voicePhase==='dictating'){await call('stop_dictation',state.voiceGeneration);return;}
  if(!state.session){const s=await call('new_conversation',null);state.sessions.unshift(s);await selectSession(s.id);}
  await call('start_dictation',state.session);updateVoice(await call('voice_status'));
});
action('cancel-dictation',async()=>{await call('cancel_dictation',state.voiceGeneration);restoreDictation();});
action('setup-voice',()=>call('setup_voice'));action('cancel-voice-setup',()=>call('cancel_voice_setup'));
action('mute-voice',async()=>{await call('mute_voice');restoreDictation();state.settings.wake_word_enabled=false;$('wake-word-enabled').checked=false;});
action('test-voice',async()=>{await saveSettings();await call('test_voice');});
action('stop-speaking',()=>call('stop_speaking'));action('settings-stop-speech',()=>call('stop_speaking'));
action('composer-access',async()=>{
  if (state.runtime?.active_sessions?.length || state.running) throw new Error('Stop active tasks before changing action permissions.');
  const enabling = !state.settings.full_access;
  if (enabling && !confirm('Enable Full Access? Glitch can use supported computer tools without asking for each action. Only enable this for tasks you trust.')) return;
  updateSettings(await call('save_settings',{full_access:enabling}));
  $('full-access').checked = enabling;
});
$('new-agent').onclick=()=>$('agent-dialog').showModal();
$('agent-close').onclick=()=>$('agent-dialog').close();
$('agent-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const r=await call('spawn_agent',state.session,$('agent-role').value.trim(),$('agent-task').value.trim());state.sessions.unshift(r.session);$('agent-dialog').close();$('agent-task').value='';toast('Agent started');await poll();}catch(error){toast(error.message,true);}finally{button.disabled=false;}};
