'use strict';
// Self Inspect, as the FTC Driver Station app does it (Inspection 12.0.0: InspectionState, InspectionActivity,
// RcInspectionActivity, DsInspectionActivity; AppUtil.appIsObsolete). The robot answers CMD_REQUEST_INSPECTION_REPORT with its
// InspectionState as JSON under short keys (mfr, mdl, os, sdk, chOs, chOsNum, dhOs, dhOsNum, fw, am, bt, wfEn, wfConn, loc, name,
// bat, rcIn, dsIn, aVmj, aVmn, aVpt, bldTs, pw, connectedToName). These are the same rows, labels and marks: ok is the green
// check, warn the orange triangle (allowed), bad the red mark (fails inspection: "No icons should be red").
(root=>{
  const RC_NAME=/^\d{1,5}(-[A-Z])?-RC$/,DS_NAME=/^\d{1,5}(-[A-Z])?-DS$/;
  // Minimums the app itself checks: Control Hub OS code 6 (1.1.2), Driver Hub OS code 21 (1.2.0), Android 6 (API 23).
  const CH_OS_MIN=6,DH_OS_MIN=21,SDK_MIN=23,BAD_FIRMWARE=['1.6.0','1.7.0','1.7.2','firmware version unavailable'];
  // An app is obsolete when it was built before August of this FTC season (from October on, this year; before, last year).
  function obsolete(buildTime,now=new Date()){
    const m=/^(\d{4})-(\d{2})/.exec(String(buildTime||''));const built=m?new Date(+m[1],+m[2]-1,1):new Date(1,0,1);
    const year=now.getMonth()>=9?now.getFullYear():now.getFullYear()-1;return built<new Date(year,7,1);
  }
  const version=r=>r&&r.aVmj!==undefined?`${r.aVmj}.${r.aVmn??0}.${r.aVpt??0}`:'';
  const teamOf=name=>String(name||'').split('-')[0];
  // The rows of a report. viewer: the Driver Station looking at it ({major, minor, name}). kind: 'rc' or 'ds'.
  function rows(r,{kind='rc',viewer={major:12,minor:0},now=new Date()}={}){
    const out=[],add=(label,value,mark=null,tone=null)=>out.push({label,value:String(value),mark,tone});
    const ch=!!r.chOs||r.chOsNum>0,dh=!!r.dhOs||r.dhOsNum>0,rev=ch||dh||/REV/i.test(r.mfr||'');
    add('Manufacturer',r.mfr||'Unknown');add('Model',r.mdl||'Unknown');
    if(ch)add('Control Hub OS Version',r.chOs||'Unknown',(r.chOsNum||0)>=CH_OS_MIN?'ok':'bad');
    else if(dh)add('Driver Hub OS Version',r.dhOs||'Unknown',(r.dhOsNum||0)>=DH_OS_MIN?'ok':'bad');
    add('Android Version',r.os||'Unknown',(r.sdk||0)>=SDK_MIN?'ok':'bad');
    if(kind==='rc'){const fw=String(r.fw||'N/A').split('\n').slice(0,2).map(l=>l.replace(/Expansion Hub/g,'EH').replace(/Control Hub/g,'CH'));
      add('Hub Firmware',fw.join('\n'),fw.join(' ')==='N/A'||BAD_FIRMWARE.some(b=>fw.join(' ').includes(b))?'bad':'ok');}
    if(Number.isFinite(r.bat))add('Battery Level',`${Math.round(r.bat*100)}%`,null,r.bat>.6?'good':'warn');
    if(!rev)add('Airplane Mode',r.am?'Enabled':'Disabled',r.am?'ok':'bad');
    add('Bluetooth',r.bt?'Enabled':'Disabled',r.bt?'bad':'ok');
    if((r.sdk||0)>=26)add('Location services',r.loc?'Enabled':'Disabled',r.loc?'ok':'bad');
    if(ch)add('RC Password',r.pw?'Default':'Not default',r.pw?'bad':'ok');
    add('Wi-Fi Enabled',r.wfEn?'Yes':'No',r.wfEn?'ok':'bad');
    add('Standard Wi-Fi Connected',r.wfConn?'Yes':'No',r.wfConn?'ok':'bad');
    if(kind==='rc')add('Robot Controller Name',r.name||'Unknown',RC_NAME.test(r.name||'')?'ok':'bad');
    else{add('Driver Station Name',r.name||'Unknown',DS_NAME.test(r.name||'')?'ok':'bad');
      if(r.connectedToName!==undefined)add('Robot Controller Name',r.connectedToName||'Not connected',r.connectedToName&&RC_NAME.test(r.connectedToName)&&teamOf(r.connectedToName)===teamOf(r.name)?'ok':'bad');}
    out.push({label:'Apps Installed',value:'',head:true});
    if(kind==='rc'){
      const old=r.rcIn&&obsolete(r.bldTs,now),behind=r.rcIn&&(r.aVmj||0)<viewer.major;
      add('Robot Controller',r.rcIn?version(r):'Not installed',!r.rcIn||old||behind?'warn':'ok');
      if(r.rcIn){const same=r.aVmj===viewer.major&&r.aVmn===viewer.minor;add('Matches DS version',same?'Yes':`No, the DS version is ${viewer.major}.${viewer.minor}`,same?'ok':'warn');}
      add('Driver Station',r.dsIn?'Installed':'Not installed',r.dsIn?'bad':'ok');
    }else{
      add('Robot Controller',r.rcIn?'Installed':'Not installed',r.rcIn?'bad':'ok');
      add('Driver Station',r.dsIn?version(r):'Not installed',!r.dsIn||obsolete(r.bldTs,now)?'warn':'ok');
    }
    for(const row of out)if(row.mark==='bad'||row.mark==='warn')row.fix=fixFor(row,kind);
    return out;
  }
  // What to change for each mark that is not green, with the rule behind it (2026-27 Competition Manual, TU09).
  const FIX={
    'Robot Controller Name':'Rename the robot to your team number and -RC, like 24038-RC (a spare can add a capital letter: 24038-B-RC). Program & Manage → Manage → Robot Controller name. Rule R705.',
    'Driver Station Name':'Rename the Driver Station to your team number and -DS, like 24038-DS, in the Driver Station app’s Settings. It must have the same team number as the robot. Rule R705.',
    'RC Password':'Change the Control Hub’s Wi-Fi password from the default: Program & Manage → Manage. Rule R711.A.',
    'Bluetooth':'Turn Bluetooth off. Rule R711.C.',
    'Wi-Fi Enabled':'Turn Wi-Fi on. Rule R711.C.',
    'Standard Wi-Fi Connected':'Connect the Driver Station to the robot’s Wi-Fi network.',
    'Hub Firmware':'Update the hub firmware to 1.8.2 with the REV Hardware Client.',
    'Control Hub OS Version':'Update the Control Hub OS with the REV Hardware Client (1.1.6 is current).',
    'Driver Hub OS Version':'Update the Driver Hub OS with the REV Hardware Client.',
    'Android Version':'This device’s Android is too old for FTC (Android 6 or newer).',
    'Airplane Mode':'Turn Airplane Mode on, then Wi-Fi back on. Rule R711.B.',
    'Location services':'Turn location services on.',
    'Matches DS version':'Allowed, but put the same version on both: update the older one (12.0 is this season’s).',
  };
  const fixFor=(row,kind)=>row.label==='Robot Controller'?(kind==='rc'?(row.value==='Not installed'?'The Robot Controller app is missing.':'Allowed, but update the Robot Controller app to this season’s version (12.0).'):'Uninstall the Robot Controller app from the Driver Station.')
    :row.label==='Driver Station'?(kind==='rc'?'Uninstall the Driver Station app from the Robot Controller.':'Allowed, but update the Driver Station app to this season’s version (12.0).'):FIX[row.label]||'';
  // Whether a report passes inspection: no red marks (orange is allowed).
  const passes=list=>!list.some(x=>x.mark==='bad');
  const api={rows,passes,obsolete,RC_NAME,DS_NAME};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckInspection=api;
})(typeof globalThis==='object'?globalThis:this);
