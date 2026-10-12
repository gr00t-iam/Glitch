'use strict';
window.historyRaceDone = false;
void (async () => {
  const results = [];
  const assert = (condition, message) => {if (!condition) throw new Error(message);};
  const deferred = () => {let resolve, reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
  const A={id:'A',project_id:'PA',workspace:'C:/fixture/A',title:'Survivor A'};
  const B={id:'B',project_id:'PB',workspace:'C:/fixture/B',title:'Deleted B'};
  const PA={id:'PA',workspace:A.workspace}, PB={id:'PB',workspace:B.workspace};
  const runtime={running_session:null,approval:null,approvals:[],runs:[],active_sessions:[],capacity:1};
  const view={messages:[],events:[],chat_event_watermark:0};
  const snapshot=(deleted=false)=>({initialized:true,settings:state.settings,sessions:deleted?[A]:[A,B],projects:deleted?[PA]:[PA,PB],runtime,discord:{},voice:{}});
  refreshModels=async()=>{};
  updateVoice=()=>{};
  window.confirm=()=>true;
  const reset=()=>{
    state.ready=false;state.polling=false;state.initializing=false;state.initialized=true;state.historyBusy=false;
    state.session='A';state.sessions=[A,B];state.projects=[PA,PB];state.runtime=runtime;state.viewGeneration=(state.viewGeneration||0)+1;
    state.cursor=0;state.count=0;ticks=0;renderSessions();
  };
  const runPoll=()=>{state.ready=true;const promise=poll();state.ready=false;return promise;};
  const check=async(name,test)=>{reset();try{await test();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.message});}};

  await check('deferred voice selection and busy selection cannot restore deleted B',async()=>{
    const voice=deferred(), deletion=deferred();let voiceRequests=0;const polls=[];
    call=async(method,id)=>{
      if(method==='voice_select_session'){voiceRequests++;return voice.promise;}
      if(method==='delete_session')return deletion.promise;
      if(method==='bootstrap')return snapshot(true);
      if(method==='load_conversation'){if(id==='B')throw new Error('Conversation does not exist.');return view;}
      if(method==='voice_status')return {};
      if(method==='poll'){polls.push(id);if(id==='B')throw new Error('Conversation does not exist.');return {events:[],runtime,discord:{}};}
      throw new Error('Unexpected method: '+method);
    };
    const selecting=selectSession('B').catch(()=>{});
    const deleting=removeHistory('session','B');
    const blockedSelection=selectSession('B').catch(()=>{});
    deletion.resolve({ok:true,session:A});await deleting;
    voice.resolve({ok:true});await Promise.all([selecting,blockedSelection]);
    await runPoll();
    assert(state.session==='A','deleted B restored as selected session');
    assert(voiceRequests===1,'selection during mutation reached the bridge');
    assert(polls.every(id=>id==='A') && polls.length>0 && !state.polling,'poll trapped on deleted B');
    assert(!state.sessions.some(s=>s.id==='B') && !state.projects.some(p=>p.id==='PB'),'deleted membership restored');
  });

  await check('deferred periodic bootstrap cannot restore deleted session or project',async()=>{
    const stale=deferred(), entered=deferred();let bootstraps=0;
    call=async(method)=>{
      if(method==='bootstrap'){if(++bootstraps===1){entered.resolve();return stale.promise;}return snapshot(true);}
      if(method==='delete_session')return {ok:true,session:A};
      if(method==='voice_status')return {};
      if(method==='poll')return {events:[],runtime,discord:{}};
      throw new Error('Unexpected method: '+method);
    };
    ticks=9;const periodic=runPoll();await entered.promise;
    await removeHistory('session','B');stale.resolve(snapshot(false));await periodic;
    assert(!state.sessions.some(s=>s.id==='B'),'stale periodic bootstrap restored deleted B');
    assert(!state.projects.some(p=>p.id==='PB'),'stale periodic bootstrap restored deleted project');
    assert(state.session==='A' && !state.polling,'survivor poll did not recover');
  });

  await check('selection commits only after successful load and recovers load failure',async()=>{
    const loaded=deferred(), entered=deferred();const polls=[];
    call=async(method,id)=>{
      if(method==='voice_select_session')return {ok:true};
      if(method==='load_conversation'){entered.resolve();return loaded.promise;}
      if(method==='voice_status')return {};
      if(method==='poll'){polls.push(id);return {events:[],runtime,discord:{}};}
      throw new Error('Unexpected method: '+method);
    };
    const selection=selectSession('B').catch(()=>{});await entered.promise;
    const before=state.session;loaded.reject(new Error('Load failed'));await selection;await runPoll();
    assert(before==='A','selection committed before load succeeded');
    assert(state.session==='A' && polls[0]==='A' && !state.polling,'load failure abandoned survivor selection');
  });

  await check('deferred successful load is invalidated by deletion',async()=>{
    const loaded=deferred(), entered=deferred();
    call=async(method,id)=>{
      if(method==='voice_select_session')return {ok:true};
      if(method==='load_conversation'){if(id==='B'){entered.resolve();return loaded.promise;}return view;}
      if(method==='delete_session')return {ok:true,session:A};
      if(method==='bootstrap')return snapshot(true);
      throw new Error('Unexpected method: '+method);
    };
    const selection=selectSession('B').catch(()=>{});await entered.promise;
    await removeHistory('session','B');loaded.resolve(view);await selection;
    assert(state.session==='A' && !state.sessions.some(s=>s.id==='B'),'stale load committed deleted B');
  });
  window.historyRaceResult={passed:results.every(item=>item.passed),checks:results};
  window.historyRaceDone=true;
})();
