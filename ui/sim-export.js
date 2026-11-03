(function(root,factory){const model=factory();if(typeof module==='object'&&module.exports)module.exports=model;else root.DeckSimExport=model;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Turns a planned route into files a robot project can use. Coordinates are the application field
  // frame, which the simulator shares: inches, bottom-left origin, +X right, +Y up, CCW heading.
  const n=v=>Number(v).toFixed(3).replace(/\.?0+$/,'')||'0';
  const finite=Number.isFinite,norm=d=>((d%360)+540)%360-180;
  const javaString=s=>'"'+String(s).replace(/[\\"]/g,c=>'\\'+c).replace(/[\u0000-\u001f]/g,'')+'"';
  const comment=s=>String(s||'').replace(/\*\//g,'* /').replace(/\\(?=u)/g,'\\ ').replace(/[\r\n]+/g,' ').trim();
  const endOf=s=>finite(s.endHeading)?s.endHeading:s.heading;
  // Which pin's path each segment belongs to (0-based): the planner marks it, older routes are matched.
  function pathIndex(route){const stops=route.stops||[];let k=0;return route.segments.map((s,i)=>{if(Number.isInteger(s.to))return s.to;while(k<stops.length-1&&stops[k].segment<i)k++;return k;});}
  // A leg is what the robot drives without stopping. Legs end at the last pin; at pins with a pause,
  // an action or a turn; where an action path starts or ends; and, on turning routes, where the next
  // segment needs a heading the robot does not have yet (it stops and turns in place first).
  // After leg i the robot settles, turns to legs[i].turn if set, pauses, then runs the pin's action.
  const many=steps=>Array.isArray(steps)&&steps.length>1?steps.map(x=>({action:x.action,seconds:finite(x.seconds)?x.seconds:null,cell:x.cell==='other'?1:0})):null;
  function legs(route){
    const segs=route.segments,stops=route.stops||[],turning=!!(route.nonholonomic||route.turns||segs.some(s=>finite(s.heading)));
    const to=pathIndex(route),pathOf=k=>stops[k]?.path||{},powerOf=k=>finite(pathOf(k).power)?Math.max(0,Math.min(1,pathOf(k).power)):null,acting=k=>pathOf(k).kind==='action',out=[];let from=0;
    segs.forEach((s,i)=>{
      const here=stops.map((p,k)=>({...p,k})).filter(p=>p.segment===i),next=segs[i+1];
      const wait=here.reduce((t,p)=>t+(finite(p.wait)?p.wait:0),0),acting_=here.find(p=>p.action),action=acting_?.action||'',actionSeconds=finite(acting_?.actionSeconds)?acting_.actionSeconds:null,cell=acting_?.cell==='other'?1:0,turn=[...here].reverse().find(p=>finite(p.turn))?.turn??null;
      const end=!next||wait>0||!!action||turn!==null||(turning&&Math.abs(norm(next.heading-endOf(s)))>1e-6)||(to[i+1]!==to[i]&&(acting(to[i])||acting(to[i+1])||powerOf(to[i])!==powerOf(to[i+1])));
      if(!end)return;
      const first=segs[from],path=pathOf(to[i]);
      // steps: the pin's steps, one after another (two or more; one step is the action itself). moving.steps: together.
      out.push({segments:segs.slice(from,i+1),pin:here.length?here.at(-1).k+1:0,path:to[i]+1,wait,action,actionSeconds,cell,steps:many(acting_?.steps),note:here.map(p=>p.note).filter(Boolean).join(' '),turn,
        power:powerOf(to[i]),heading:finite(first.heading)?first.heading:route.heading,endHeading:finite(endOf(s))?endOf(s):route.heading,
        moving:path.kind==='action'?{action:path.action||'',note:path.note||'',seconds:finite(path.actionSeconds)?path.actionSeconds:null,cell:path.cell==='other'?1:0,steps:many(path.steps)}:null,rotate:path.rotate==='spin'?`spins ${Math.abs(path.spins)} turn${Math.abs(path.spins)>1?'s':''} ${path.spins>0?'counter-clockwise':'clockwise'}`:path.rotate==='relative'?`turns by ${n(path.angle)}°`:path.rotate==='start'?'returns to the starting heading':path.rotate==='track'?`tracks target (${n(path.target?.x)}, ${n(path.target?.y)})`:path.rotate==='tangent'?'faces along the path':path.rotate==='reverse'?'faces backwards along the path':path.rotate==='turn'?`turns to ${n(path.heading)}°`:''});
      from=i+1;
    });
    return out;
  }
  // Action names become code identifiers: "Shoot ball" → shootBall (Java) and shoot_ball (Python).
  // The same name used at several pins or paths runs the same code.
  const JAVA_WORDS=new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield init stop run'.split(' '));
  const words=name=>String(name||'').normalize('NFKD').replace(/[^\w\s]/g,' ').replace(/_/g,' ').trim().split(/\s+/).filter(Boolean);
  // Letters outside A-Z (Chinese, Cyrillic, emoji...) cannot be part of a Java or Python name, so a slot keeps them as a
  // code-point suffix: two different non-Latin names never share a slot, and a name with no Latin letters still gets one.
  const foreign=name=>[...String(name||'').normalize('NFKD').replace(/\p{M}/gu,'')].filter(c=>c.codePointAt(0)>127&&/\S/u.test(c)).map(c=>c.codePointAt(0).toString(16)).join('').slice(0,24);
  function slot(name){const w=words(name),f=foreign(name);if(!w.length&&!f)return '';let id=w.length?w.map((x,i)=>i?x[0].toUpperCase()+x.slice(1).toLowerCase():x.toLowerCase()).join(''):'action';if(/^\d/.test(id))id='action'+id[0].toUpperCase()+id.slice(1);if(f)return id.slice(0,24)+'U'+f;return JAVA_WORDS.has(id)?id+'Action':id.slice(0,48);}
  function pySlot(name){const w=words(name),f=foreign(name);if(!w.length&&!f)return '';let id=w.length?w.map(x=>x.toLowerCase()).join('_'):'action';if(/^\d/.test(id))id='action_'+id;if(f)return id.slice(0,24)+'_u'+f;return ['and','as','assert','break','class','continue','def','del','elif','else','except','finally','for','from','global','if','import','in','is','lambda','nonlocal','not','or','pass','raise','return','try','while','with','yield','run','stop','init','setup','math','os','time','importlib','drive','turn','hold','aim','action','plan','load_actions','create_autonomous','wrap180'].includes(id)?id+'_action':id.slice(0,48);}
  // Every named action with where it runs, in route order.
  function actions(route){
    // Names that differ only in case or punctuation (Shoot, shoot) share a slot; every one of them is listed in names.
    const map=new Map(),add=(name,where)=>{const id=slot(name);if(!id)return;if(!map.has(id))map.set(id,{slot:id,py:pySlot(name),name,names:[],uses:[]});const a=map.get(id);if(!a.names.includes(name))a.names.push(name);a.uses.push(where);};
    const all=legs(route);
    // A list of steps gives each step its own slot; sequences() has the lists themselves.
    for(const [i,l] of all.entries()){
      if(l.moving?.action&&!all.slice(0,i).some(o=>o.path===l.path&&o.moving))for(const name of l.moving.steps?l.moving.steps.map(x=>x.action):[l.moving.action])add(name,{moving:true,path:l.path,note:l.moving.note,rotate:l.rotate});
      if(l.action)for(const name of l.steps?l.steps.map(x=>x.action):[l.action])add(name,{moving:false,pin:l.pin,wait:l.wait,note:l.note});
    }
    return [...map.values()];
  }
  // Every list of steps the route runs as one action, by the name its legs give it: {name, together (while driving)
  // or one after another (at a pin), steps: [{action, seconds (null: until done, or the whole path), cell}]}.
  function sequences(route){const map=new Map();
    for(const l of legs(route)){if(l.steps&&!map.has(l.action))map.set(l.action,{name:l.action,together:false,steps:l.steps});
      if(l.moving?.steps&&!map.has(l.moving.action))map.set(l.moving.action,{name:l.moving.action,together:true,steps:l.moving.steps});}
    return [...map.values()];}
  const where=u=>u.moving?`while driving the path to pin ${u.path}${u.rotate?` (the robot ${u.rotate})`:''}`:`stopped at pin ${u.pin}${u.wait>0?`, pause ${n(u.wait)} s`:''}`;
  function describe(l,i){
    const parts=[`Leg ${i+1}: ${l.moving?`ACTION PATH${l.moving.action?` "${comment(l.moving.action)}"`:''}`:'drive'} to ${l.pin?`pin ${l.pin}`:'a turn point'}`];
    if(l.rotate)parts.push(`the robot ${l.rotate} while driving`);if(l.moving?.note)parts.push(comment(l.moving.note));
    if(l.turn!==null)parts.push(`then turn to ${n(l.turn)}°`);if(l.wait>0)parts.push(`pause ${n(l.wait)} s`);if(l.action)parts.push(`run "${comment(l.action)}"${finite(l.actionSeconds)?` for ${n(l.actionSeconds)} s`:" until done"}`);if(l.note)parts.push(comment(l.note));
    return parts.join('; ')+'.';
  }
  function validName(className,packageName){
    if(!/^[A-Z][A-Za-z0-9_]{0,63}$/.test(className))throw Error('Class name must start with a capital letter and use letters, digits or _.');
    if(new Set(['DeckFollower','Pose','Point','Path','Paths','Interpolator','Config','Drivetrain','Localizer','MotionState','Velocity','DrivePowers','Constants','RobotDrive','RouteActions','RobotActions','LinearOpMode','HardwareMap','ElapsedTime']).has(className))throw Error('Class name conflicts with a generated controller type. Choose a route name such as PlannedRoute.');
    if(packageName&&!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(packageName))throw Error('Package must look like org.firstinspires.ftc.teamcode.');
    if(packageName?.split('.').some(p=>JAVA_WORDS.has(p)))throw Error('Package names cannot contain Java reserved words.');
  }
  function java(route,layout,options={}){
    const className=options.className||'PlannedRoute',packageName=options.packageName??'org.firstinspires.ftc.teamcode';validName(className,packageName);
    const parts=legs(route),zones=(layout.zones||[]).map(z=>options.polygon(z)),start=layout.start,rad=d=>`Math.toRadians(${n(d)})`;
    const heading=s=>s.tangent?`.heading(tangent(${s.reverse?'true':'false'}))`:s.target?`.heading(face(${n(s.target.x)}, ${n(s.target.y)}))`:finite(s.endHeading)?`.heading(turn(${n(s.heading)}, ${n(s.endHeading)}))`:finite(s.heading)?`.constant(${rad(s.heading)})`:'.constant(HEADING)';
    const segment=s=>(s.type==='line'?`Paths.line(v(${n(s.points[0].x)}, ${n(s.points[0].y)}), v(${n(s.points[1].x)}, ${n(s.points[1].y)}))`:`Paths.curve(${s.points.map(p=>`v(${n(p.x)}, ${n(p.y)})`).join(', ')})`)+heading(s);
    const leg=l=>l.segments.length===1?`            ${segment(l.segments[0])}`:`            Paths.path(\n${l.segments.map(s=>'                '+segment(s)).join(',\n')}\n            )`;
    const headings=key=>parts.map(l=>finite(l[key])?rad(l[key]):'HEADING').join(', ');
    return `${packageName?`package ${packageName};\n\n`:''}import deck.pathing.DeckFollower.Paths;
import deck.pathing.DeckFollower.Pose;
import deck.pathing.DeckFollower.Point;
import deck.pathing.DeckFollower.Path;
import deck.pathing.DeckFollower.Interpolator;

/**
 * Route planned in Torque: ${comment(layout.name||'route')} (${comment(layout.fieldName||layout.field)}).
 * Deck route controller API. Field frame: inches, origin bottom-left, +X right, +Y up, heading CCW.
 * Robot footprint: ${n(route.footprint.front)} in front, ${n(route.footprint.rear)} in rear, ${n(route.footprint.half)} in each side; clearance ${n(route.clearance)} in.
 * ${route.nonholonomic?'TANK: stop and turn to START_HEADING[i] BEFORE each leg; wait for the IMU to settle.':route.turns?'TURNS: where START_HEADING[i] differs from the heading the robot already has, stop and turn in place to it BEFORE following the leg.':'Holonomic: keep the starting heading throughout.'}
 *
 * For each leg i: face START_HEADING[i], follow legs()[i] while running MOVING_ACTIONS[i] (if any),
 * settle, turn to TURN_AFTER[i] (if not NaN), pause WAIT_SECONDS[i], then run ACTIONS[i] for ACTION_SECONDS[i].
${parts.map((l,i)=>` * ${describe(l,i)}`).join('\n')}
 * Generated file: change the route in the simulator and export again.
 */
public final class ${className} {
    private ${className}() {}

    public static final Pose START = new Pose(${n(start.x)}, ${n(start.y)}, Math.toRadians(${n(start.heading)}));
    public static final double HEADING = Math.toRadians(${n(route.heading)});

    /** Actual field dimensions, inches (custom fields are not rescaled). */
    public static final double FIELD_WIDTH = ${n(layout.width||144)};
    public static final double FIELD_HEIGHT = ${n(layout.height||144)};

    /** Pause at the pin after each leg, before its action, in seconds. */
    public static final double[] WAIT_SECONDS = {${parts.map(l=>n(l.wait)).join(', ')}};

    /** Motor power ceiling per leg, including setup defaults (0 disables that leg). */
    public static final double[] MOTOR_POWER = {${parts.map(l=>n(l.power??route.defaultPower??options.defaultPower??.8)).join(', ')}};

    /** The action run at the pin after each leg, as named in the simulator ("" for none). */
    public static final String[] ACTIONS = {${parts.map(l=>javaString(l.action)).join(', ')}};

    /** Which hive cell each pin action aims at: 0 the cell up at the start, 1 the other cell. */
    public static final int[] ACTION_CELL = {${parts.map(l=>l.cell||0).join(', ')}};

    /** How long each pin action runs, in seconds (0: until it reports done). */
    public static final double[] ACTION_SECONDS = {${parts.map(l=>n(l.actionSeconds||0)).join(', ')}};

    /** The action run WHILE driving each leg: action paths ("" for regular paths). */
    public static final String[] MOVING_ACTIONS = {${parts.map(l=>javaString(l.moving?.action||'')).join(', ')}};

    /** Which hive cell each action path's action aims at (0 start cell, 1 the other cell). */
    public static final int[] MOVING_CELL = {${parts.map(l=>l.moving?.cell||0).join(', ')}};

    /** How long each action path's action runs from the start of its path, in seconds (0: the whole path). */
    public static final double[] MOVING_SECONDS = {${parts.map(l=>n(l.moving?.seconds||0)).join(', ')}};

    /** Which pin's path each leg drives (1 = the path from the start to pin 1). */
    public static final int[] PATH = {${parts.map(l=>l.path).join(', ')}};

    /** The pin each leg ends at (0 = a turn point between pins). */
    public static final int[] PIN = {${parts.map(l=>l.pin).join(', ')}};

    /** Heading to face before each leg, radians. */
    public static final double[] START_HEADING = {${headings('heading')}};

    /** Heading to turn to in place after each leg, radians (NaN = no turn). */
    public static final double[] TURN_AFTER = {${parts.map(l=>l.turn===null?'Double.NaN':rad(l.turn)).join(', ')}};

    /** The route split into legs (see above). Leg i ends at pin ${parts.map(l=>l.pin||'-').join(', ')}. */
    public static Path[] legs() {
        return new Path[] {
${parts.map(leg).join(',\n')}
        };
    }

    /** No-go zones the route keeps clear of, as polygons {x, y} in inches. */
    public static final double[][][] NO_GO_ZONES = {${zones.length?'\n'+zones.map(p=>`        {${p.map(q=>`{${n(q.x)}, ${n(q.y)}}`).join(', ')}}`).join(',\n')+'\n    ':''}};

    private static Point v(double x, double y) {
        return Point.cartesian(x, y);
    }

    /** Face a fixed field target at every point of the actual curve. */
    private static Interpolator face(double x, double y) {
        return (curve, t) -> { Point p = curve.get(t); return Math.atan2(y - p.y(), x - p.x()); };
    }

    /** Face along the path (backwards: reverse), from the curve's direction at each point. */
    private static Interpolator tangent(boolean reverse) {
        return (curve, t) -> { Point a = curve.get(Math.max(0, t - 1e-4)), b = curve.get(Math.min(1, t + 1e-4)); return Math.atan2(b.y() - a.y(), b.x() - a.x()) + (reverse ? Math.PI : 0); };
    }

    /** Heading that turns steadily from one angle to another (degrees; may span whole spins) along a path. */
    private static Interpolator turn(double fromDegrees, double toDegrees) {
        double from = Math.toRadians(fromDegrees), by = Math.toRadians(toDegrees - fromDegrees), full = 2 * Math.PI;
        return (curve, t) -> ((from + by * t) % full + full) % full;
    }
}
`;
  }
  // Deck path-file JSON (.pp): a start point and lines with optional Bezier control points.
  const COLORS=['#2563eb','#16a34a','#d97706','#9333ea','#dc2626','#0891b2','#db2777','#65a30d'];
  // The Visualizer turns a linear heading the short way and spreads it by arc length; Deck's robot code turns by
  // the curve parameter and may turn the long way or spin. A turn of 179° or more, or a turn along a curve, is
  // written as piecewise linear pieces of at most 120° each, placed at the arc-length progress where the robot
  // reaches each angle, so the Visualizer shows the turn the robot makes.
  function linearHeading(s){
    const from=s.heading,turn=s.endHeading-s.heading,curve=s.type==='curve';
    if(!curve&&Math.abs(turn)<179)return {type:'linear',startDeg:+n(from),endDeg:+n(s.endHeading)};
    const k=Math.min(400,Math.max(Math.ceil(Math.abs(turn)/120),curve?12:1)),steps=k*16,length=[0];let prev=s.points[0];
    const at=t=>{let p=s.points.map(q=>({x:q.x,y:q.y}));while(p.length>1)p=p.slice(1).map((q,i)=>({x:p[i].x+(q.x-p[i].x)*t,y:p[i].y+(q.y-p[i].y)*t}));return p[0];};
    for(let i=1;i<=steps;i++){const q=at(i/steps);length.push(length[i-1]+Math.hypot(q.x-prev.x,q.y-prev.y));prev=q;}
    const total=length[steps]||1,progress=j=>j===k?1:+(length[j*16]/total).toFixed(5);
    return {type:'piecewise',piecewiseHeading:{segments:Array.from({length:k},(_,j)=>({startProgress:progress(j),endProgress:progress(j+1),interpolationType:'linear',parameters:{startDeg:+n(from+turn*j/k),endDeg:+n(from+turn*(j+1)/k)}}))}};
  }
  // The Pedro Visualizer's field runs from the inside of the perimeter wall (141.5 in). Deck's game fields keep the wall
  // inside a 144 in square, so a game field's .pp is shifted by the wall (options.bounds); deckOrigin records the shift.
  // A list of steps in a .pp line (Deck's own field): {action, seconds?, cell?}.
  const ppSteps=steps=>steps.map(x=>({action:x.action,...(finite(x.seconds)?{seconds:+n(x.seconds)}:{}),...(x.cell==='other'||x.cell===1?{cell:'other'}:{})}));
  function pp(route,layout,options={}){
    const o=layout.field&&layout.field!=='empty'&&options.bounds?{x:options.bounds.x0,y:options.bounds.y0}:{x:0,y:0},P=q=>({x:+n(q.x-o.x),y:+n(q.y-o.y)});
    const constant={heading:'constant',degrees:+n(route.heading)},parts=legs(route),endsLeg=new Map(),to=pathIndex(route),stops=route.stops||[];
    let index=-1;for(const l of parts){index+=l.segments.length;endsLeg.set(index,l);}
    const lines=route.segments.map((s,i)=>{const end=P(s.points.at(-1)),line={id:`line-${i+1}`,endPoint:{...end,...constant,degrees:+n(s.heading??route.heading)}};
      if(finite(s.endHeading))line.endPoint={...end,heading:'linear',startDeg:+n(s.heading),endDeg:+n(s.endHeading)};
      if(s.tangent){line.endPoint={...end,heading:'tangential',reverse:!!s.reverse};}
      if(s.target){line.endPoint.heading='target';line.targetTracking=P(s.target);}
      if(s.type==='curve')line.controlPoints=s.points.slice(1,-1).map(P);
      const path=stops[to[i]]?.path;line.motorPower=path?.power??route.defaultPower??.8;if(path?.kind==='action'){line.actionPath=true;if(path.action)line.actionName=path.action;if(path.steps?.length>1)line.deckMovingSteps=ppSteps(path.steps);}
      const l=endsLeg.get(i);if(l){if(l.turn!==null)line.turnAfterDegrees=+n(l.turn);if(l.wait>0)line.waitAfterMs=Math.round(l.wait*1000);if(l.action)line.waitAfterName=l.action;if(finite(l.actionSeconds))line.actionSeconds=+n(l.actionSeconds);if(l.steps)line.deckSteps=ppSteps(l.steps);}
      // The Visualizer's own fields: an atomic path, its heading as an object, a colour per Deck path.
      line.kind='atomic';line.color=COLORS[to[i]%COLORS.length];line.deckPath=to[i];if(s.custom)line.deckCurve='custom';if(!line.controlPoints)line.controlPoints=[];
      line.heading=s.tangent?{type:'tangential',reverse:!!s.reverse}:s.target?{type:'piecewise',piecewiseHeading:{segments:[{startProgress:0,endProgress:1,interpolationType:'facing-point',parameters:{point:P(s.target)}}]}}:finite(s.endHeading)?linearHeading(s):{type:'constant',degrees:+n(s.heading??route.heading)};
      return line;});
    const shapes=(layout.zones||[]).map((z,i)=>({id:z.id,name:`No-go zone ${i+1}`,vertices:options.polygon(z).map(P),color:'#dc2626',fillColor:'#ef444433'}));
    // Deck's own pins ride along, so opening the file in Deck again restores them exactly (unless the lines were edited).
    const deck=Array.isArray(options.pins)?{start:layout.start,pins:options.pins,zones:layout.zones||[],signature:signature(lines)}:undefined;
    return JSON.stringify({fileName:`${String(layout.name||'route')}.pp`,version:route.segments.some(s=>s.target)?'deck-sim-2':'deck-sim-1',stopAndTurn:!!(route.nonholonomic||route.turns),timestamp:options.timestamp||new Date().toISOString(),
      field:{type:layout.field||'empty',width:o.x?+n(options.bounds.x1-o.x):layout.width||144,height:o.y?+n(options.bounds.y1-o.y):layout.height||144},deckOrigin:{x:+n(o.x),y:+n(o.y)},startPoint:{...P(layout.start),headingDeg:+n(layout.start.heading),heading:'constant',degrees:+n(layout.start.heading)},lines,shapes,...(route.footprint?{settings:{rWidth:+n(2*route.footprint.half),rHeight:+n(route.footprint.front+route.footprint.rear)}}:{}),deck},null,2)+'\n';
  }
  // A fingerprint of the drawn lines: Deck's saved pins are only used while the lines still match it.
  function signature(lines){const s=JSON.stringify(lines.map(l=>[l.endPoint?.x,l.endPoint?.y,l.controlPoints,l.heading]));let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return h.toString(16);}
  // A path file (.pp) as Deck's start, pins and no-go zones. Deck's own unedited file comes back exactly. Otherwise each
  // Pedro Visualizer line becomes a pin and its path: control points become a custom curve (Deck keeps up to 3), the
  // heading object becomes the path's turning (tangential, constant, linear, facing a point), waits become pauses, and
  // what Deck can only approximate is listed in notes. Coordinates go back to Deck's frame (deckOrigin, or the wall of
  // a game field for a Visualizer file); on a game field the Visualizer's shapes are left out (Deck has the structures).
  const round3=v=>Math.round(v*1000)/1000,normDeg=d=>((d%360)+540)%360-180,shortestDeg=(a,b)=>{const d=normDeg(b-a);return d===-180?180:d;};
  function fromPP(text,{field='empty',bounds=null,robot=null}={}){
    let data;try{data=typeof text==='string'?JSON.parse(text):text;}catch{throw Error('That file is not a path file (.pp): it is not JSON.');}
    if(!data||typeof data!=='object'||!Array.isArray(data.lines))throw Error('That file is not a path file (.pp): it has no lines.');
    const copy=v=>JSON.parse(JSON.stringify(v));
    if(data.deck&&Array.isArray(data.deck.pins)&&data.deck.start&&data.deck.signature===signature(data.lines))return {start:copy(data.deck.start),pins:copy(data.deck.pins),zones:Array.isArray(data.deck.zones)?copy(data.deck.zones):[],notes:[],exact:true};
    const o=data.deckOrigin&&finite(+data.deckOrigin.x)&&finite(+data.deckOrigin.y)?{x:+data.deckOrigin.x,y:+data.deckOrigin.y}:field!=='empty'&&bounds?{x:bounds.x0,y:bounds.y0}:{x:0,y:0};
    const at=q=>q&&finite(+q.x)&&finite(+q.y)?{x:round3(+q.x+o.x),y:round3(+q.y+o.y)}:null,notes=[];
    const sp=data.startPoint||{},h0=[sp.headingDeg,sp.degrees,sp.startDeg].map(Number).find(Number.isFinite)??0,start={...(at(sp)||{x:72,y:72}),heading:normDeg(h0)};
    // Older files keep the heading on the end point as a string.
    const legacy=p=>{const e=p.endPoint||{};return e.heading==='tangential'?{type:'tangential',reverse:!!e.reverse}:e.heading==='linear'?{type:'linear',startDeg:+e.startDeg||0,endDeg:+e.endDeg||0}:e.heading==='target'&&p.targetTracking?{type:'piecewise',piecewiseHeading:{segments:[{interpolationType:'facing-point',parameters:{point:p.targetTracking}}]}}:{type:'constant',degrees:+e.degrees||0};};
    // Driving order: the sequence when there is one (its waits pause at the previous end point), else the list.
    const byId=new Map(data.lines.filter(l=>l&&l.id).map(l=>[l.id,l])),order=Array.isArray(data.sequence)&&data.sequence.some(s=>s?.kind==='path'&&byId.has(s.lineId))?data.sequence:data.lines.map(l=>({kind:'path',line:l}));
    const atoms=[];let prev={x:start.x,y:start.y};
    const length=(a,controls,b)=>{let len=0,q=a;for(const p of [...controls,b]){len+=Math.hypot(p.x-q.x,p.y-q.y);q=p;}return len;};
    const addPath=(p,group)=>{
      if(p?.kind==='compound'){const kids=[];const walk=x=>{for(const s of x.segments||[])s?.kind==='compound'?walk(s):s?.endPoint&&kids.push(s);};walk(p);
        let from=prev;const lens=kids.map(k=>{const e=at(k.endPoint)||from,len=length(from,(k.controlPoints||[]).map(at).filter(Boolean),e);from=e;return len;}),total=lens.reduce((a,b)=>a+b,0)||1;
        const h=p.heading;let done=0;kids.forEach((k,i)=>{let kh=h;if(h?.type==='linear'){const turn=shortestDeg(h.startDeg,h.endDeg),a=h.startDeg+turn*done/total,b=h.startDeg+turn*(done+lens[i])/total;kh={type:'linear',startDeg:a,endDeg:b};}done+=lens[i];
          addPath({...k,heading:kh||k.heading,waitBeforeMs:i===0?p.waitBeforeMs:k.waitBeforeMs,waitBeforeName:i===0?p.waitBeforeName:k.waitBeforeName,waitAfterMs:i===kids.length-1?p.waitAfterMs:k.waitAfterMs,waitAfterName:i===kids.length-1?p.waitAfterName:k.waitAfterName},p.name||'a group');});
        if(h?.type==='linear')notes.push(`${p.name||'A path group'}: one turn across its ${kids.length} segments, split by length.`);return;}
      if(!p?.endPoint)return;const end=at(p.endPoint);if(!end)throw Error(`Path ${atoms.length+1} in the file has no end point.`);
      atoms.push({line:p,end,from:prev,group});prev=end;};
    for(const item of order){
      if(item?.kind==='wait'){const ms=Math.max(0,+item.durationMs||0);if(!ms)continue;if(atoms.length){const a=atoms.at(-1);a.extraWait=(a.extraWait||0)+ms;if(item.name&&!a.extraName)a.extraName=item.name;}else notes.push(`A ${ms} ms wait before the first path was left out (Deck starts driving at once).`);continue;}
      addPath(item.line||byId.get(item.lineId));}
    if(!atoms.length)throw Error('The path file has no paths.');
    // One Deck pin per drawn line, except that consecutive lines of one Deck path (deckPath) form one pin again.
    const pins=[];let heading=start.heading;
    atoms.forEach((a,i)=>{const p=a.line,label=p.name||`Path ${i+1}`;
      const before=Math.max(0,+(p.waitBeforeMs??p.waitBefore?.durationMs)||0),beforeName=p.waitBeforeName||p.waitBefore?.name||'';
      if(before||beforeName){if(pins.length){const q=pins.at(-1);q.wait=+(((q.wait||0)+before/1000).toFixed(3));if(beforeName&&!q.action)q.action=beforeName;}else notes.push(`${label}: its wait before driving was left out (Deck starts driving at once).`);}
      let controls=(p.controlPoints||[]).map(at).filter(Boolean);
      if(controls.length>3){notes.push(`${label}: ${controls.length} control points; Deck keeps 3 (first, middle and last).`);controls=[controls[0],controls[Math.floor(controls.length/2)],controls.at(-1)];}
      if(Array.isArray(p.throughPoints)&&p.throughPoints.length)notes.push(`${label}: its ${p.throughPoints.length} through point${p.throughPoints.length>1?'s are':' is'} not used (Deck drives the curve from its control points).`);
      const path={};if(controls.length)path.controls=controls;else path.style='sharp';
      const h=p.heading&&typeof p.heading==='object'?p.heading:legacy(p),segs=h.type==='piecewise'?(h.piecewiseHeading?.segments||[]):[];
      if(h.type==='tangential')Object.assign(path,{rotate:h.reverse?'reverse':'tangent'});
      else if(h.type==='constant'){Object.assign(path,{rotate:'turn',heading:normDeg(+h.degrees||0)});if(Math.abs(shortestDeg(heading,+h.degrees||0))>1)notes.push(`${label}: holds ${round3(+h.degrees||0)}° from the start of the path; Deck turns to it while driving.`);}
      else if(h.type==='linear'){const turn=shortestDeg(+h.startDeg||0,+h.endDeg||0);Object.assign(path,{rotate:'turn',heading:normDeg(+h.endDeg||0)});if(Math.abs(shortestDeg(heading,+h.startDeg||0))>1)notes.push(`${label}: its turn starts at ${round3(+h.startDeg||0)}° but the robot arrives at ${round3(heading)}°; Deck turns from where the robot is.`);void turn;}
      else if(segs.length&&segs.every(s=>(s.interpolationType||'linear')==='linear')){const total=segs.reduce((sum,s)=>sum+shortestDeg(+s.parameters?.startDeg||0,+s.parameters?.endDeg||0),0),endDeg=+segs.at(-1).parameters?.endDeg||0;
        Object.assign(path,Math.abs(total)<179?{rotate:'turn',heading:normDeg(endDeg)}:{rotate:'relative',angle:round3(total)});}
      else if(segs.length===1&&segs[0].interpolationType==='facing-point'&&at(segs[0].parameters?.point))Object.assign(path,{rotate:'track',target:at(segs[0].parameters.point)});
      else if(segs.length){const last=segs.at(-1),t=last.interpolationType;notes.push(`${label}: a heading in ${segs.length} parts; Deck uses its last part.`);
        if(t==='facing-point'&&at(last.parameters?.point))Object.assign(path,{rotate:'track',target:at(last.parameters.point)});else if(t==='tangential')Object.assign(path,{rotate:last.reversed?'reverse':'tangent'});else if(t==='constant')Object.assign(path,{rotate:'turn',heading:normDeg(+last.parameters?.degrees||0)});else Object.assign(path,{rotate:'turn',heading:normDeg(+last.parameters?.endDeg||0)});}
      // Deck's own fields, when the file came from Deck.
      if(finite(+p.motorPower)&&p.motorPower!==null)path.power=Math.max(0,Math.min(1,+p.motorPower));if(p.actionPath){path.kind='action';if(Array.isArray(p.deckMovingSteps))path.steps=p.deckMovingSteps;else if(p.actionName)path.action=String(p.actionName).slice(0,40);}
      const pin={x:a.end.x,y:a.end.y,path};
      const after=Math.max(0,+(p.waitAfterMs??p.waitAfter?.durationMs)||0)+(a.extraWait||0),afterName=p.waitAfterName||p.waitAfter?.name||a.extraName||'';
      if(after)pin.wait=+(after/1000).toFixed(3);if(Array.isArray(p.deckSteps))pin.steps=p.deckSteps;else if(afterName)pin.action=String(afterName).slice(0,40);if(afterName&&finite(+p.actionSeconds)&&+p.actionSeconds>0)pin.actionSeconds=+p.actionSeconds;if(finite(+p.turnAfterDegrees)&&p.turnAfterDegrees!==null){pin.turn=normDeg(+p.turnAfterDegrees);pin.turnMode='absolute';}
      // Lines of one Deck path that Deck routed itself (corners and smoothing, not a hand-drawn curve) are one pin again;
      // Deck re-plans that path, as a spline when it was one.
      const routed=l=>l&&finite(l.deckPath)&&l.deckCurve!=='custom',last=pins.at(-1);
      const merge=last&&routed(p)&&routed(atoms[i-1]?.line)&&atoms[i-1].line.deckPath===p.deckPath&&!last.wait&&!last.action&&!finite(last.turn);
      if(routed(p)&&controls.length){delete path.controls;path.style='spline';}
      if(merge){Object.assign(last,{x:pin.x,y:pin.y,wait:pin.wait,action:pin.action,actionSeconds:pin.actionSeconds,turn:pin.turn,turnMode:pin.turnMode});if(path.style==='spline')last.path.style='spline';for(const k of Object.keys(last))if(last[k]===undefined)delete last[k];}else pins.push(pin);
      heading=path.rotate==='turn'?path.heading:path.rotate==='relative'?normDeg(heading+path.angle):path.rotate==='track'?Math.atan2(path.target.y-a.end.y,path.target.x-a.end.x)*180/Math.PI:path.rotate==='tangent'||path.rotate==='reverse'?(()=>{const q=controls.at(-1)||a.from;return Math.atan2(a.end.y-q.y,a.end.x-q.x)*180/Math.PI+(path.rotate==='reverse'?180:0);})():heading;
      if(finite(pin.turn))heading=pin.turn;});
    if(pins.length>32)throw Error(`The path file has ${pins.length} paths; Deck holds up to 32.`);
    let zones=[];const shapes=Array.isArray(data.shapes)?data.shapes:[];
    if(field!=='empty'&&shapes.length)notes.push(`${shapes.length} shape${shapes.length>1?'s':''} from the file ${shapes.length>1?'were':'was'} left out: Deck's field already has the game's structures.`);
    else zones=shapes.map((s,i)=>({s,points:(s.vertices||[]).map(at).filter(Boolean)})).filter(z=>z.points.length>=3&&z.points.length<=40).map((z,i)=>({id:`pp${i+1}`,type:'polygon',points:z.points}));
    // The Visualizer saves the robot size it drew for (Deck writes its collision footprint there); a different robot
    // may not clear the same paths.
    const drawn=[+data.settings?.rWidth,+data.settings?.rHeight];if(robot&&drawn.every(v=>finite(v)&&v>0)&&finite(robot.length)&&finite(robot.width)){const a=[...drawn].sort((x,y)=>x-y),b=[robot.length,robot.width].sort((x,y)=>x-y);if(Math.abs(a[0]-b[0])>.5||Math.abs(a[1]-b[1])>.5)notes.push(`The file was drawn for a ${round3(drawn[0])} × ${round3(drawn[1])} in robot; this one is ${round3(robot.length)} × ${round3(robot.width)} in, so check the clearances Deck reports.`);}
    return {start,pins,zones,notes,exact:false};
  }
  return {legs,java,pp,fromPP,validName,actions,sequences,slot,pySlot,where,describe,pathIndex};
});
