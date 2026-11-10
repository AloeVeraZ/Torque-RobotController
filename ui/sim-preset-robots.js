(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckPresetRobots=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // The preset robots' CAD, joints, wiring and demo routes (Setup → Robot → Preset robot). Each is generated from FTC
  // parts with the Test robot's builders (ui/sim-test-robot.js) as STEP-import-style mesh records, so the app stores,
  // shows, discovers and rigs it like a team's own CAD, in every build. Original geometry modelled after the parts'
  // published sizes (approximate), MIT like the rest of Deck. DeckMechanisms.PRESETS holds their sizes, motors and
  // mechanisms; this file draws the robots to those sizes.
  // Frame: inches, x forward, y left, z up, the floor at z = 0; each chassis box is exactly its preset's length x width.
  const TR=globalThis.DeckTestRobot||(typeof require==='function'?require('./sim-test-robot.js'):null);
  const Mech=()=>globalThis.DeckMechanisms||(typeof require==='function'?require('./sim-mechanisms.js'):null);
  const Kin=()=>globalThis.DeckKinematics||(typeof require==='function'?require('./sim-kinematics.js'):null);
  const {C,lin,frame,pt,add,mul,RAD,X,Y,Z,EPS,WHEEL_R,MECANUM_HALF,box,obox,prism,lathe,cylinder,tube,band,disc,gear,part,holes,channel,motor,servo,mecanumWheel}=TR.kit;
  const K={...C,yellow:lin(0xf2c200),tire:lin(0x1f2022),blue:lin(0x2b6cd4),tube:lin(0xb8bec6),bumper:lin(0xc8282d)};
  const VERSION=1,CHASSIS='Chassis',ELECTRONICS='Electronics',DECK_Z=2.99,PLATE_Z=3.09,src='metadata';
  const CORNERS=[['FL',1,1],['FR',1,-1],['BL',-1,1],['BR',-1,-1]];
  // ---- shared parts --------------------------------------------------------------------------------------------------
  // goBILDA 1203 grid plate deck on the frame, its 14 mm holes on a 24 mm grid.
  function gridPlate(path,hx,hy){
    part(path,'Grid plate',C.alu,g=>box(g,[-hx,-hy,DECK_Z],[hx,hy,PLATE_Z]));
    const p=24/25.4,nx=Math.floor((2*hx-.6)/p)+1,ny=Math.floor((hy-.4)/p);
    part(path,'Hole pattern',C.hole,g=>{for(let r=-ny;r<=ny;r++)holes(g,frame([0,r*p,PLATE_Z+EPS],Z,X),nx,{small:Math.abs(r)<ny});});
  }
  // A REV Control Hub standing on edge (grey case, orange band, black port rows facing +y) and a REV Slim Battery, x0..x1
  // along the robot, the hub's case from y hy0 and the battery's from by0, both on z.
  function hubAndBattery(path,x0,x1,hy0,by0,z){
    const hy1=hy0+1.3,z1=z+4.05,by1=by0+1.4,hub=[...path,'Control Hub'],bat=[...path,'Battery'];
    part(hub,'REV Control Hub',K.hub,g=>box(g,[x0,hy0,z],[x1,hy1,z1-.22]));
    part(hub,'Orange band',K.orange,g=>{box(g,[x0,hy0,z1-.22],[x1,hy1,z1]);box(g,[x0-.01,hy0+.2,z+.6],[x0+.02,hy1-.2,z1-.4]);});
    part(hub,'Ports',K.black,g=>{for(const [a,b] of [[z+.35,z+.8],[z+1.05,z+1.5],[z+1.75,z+2.2]])box(g,[x0+.35,hy1,a],[x1-.35,hy1+.1,b]);box(g,[x0+.5,hy1,z+2.55],[x0+1.5,hy1+.08,z+3.2]);});
    part(hub,'Status LED',K.led,g=>box(g,[x1-.9,hy1,z+2.8],[x1-.6,hy1+.06,z+3.05]));
    part(bat,'REV Slim Battery',K.battery,g=>box(g,[x0,by0,z],[x1,by1,z+3]));
    part(bat,'Battery label',K.label,g=>box(g,[x0+.6,by0-EPS,z+.7],[x1-.6,by0,z+2.3]));
    part(bat,'Battery lead +',K.red,g=>cylinder(g,frame([x1,by0+.45,z+2.6],X,Y),.11,0,.9,8));
    part(bat,'Battery lead -',K.black,g=>cylinder(g,frame([x1,by0+.75,z+2.6],X,Y),.11,0,.9,8));
  }
  // A plain wheel with a rubber tyre: radius r, half width w, its axle along y at c; hub colour `hub`.
  function wheel(path,c,r,w,{hub=C.alu,spokes=5,label='Tire'}={}){
    const f=frame(c,Y,X);
    // The tyre's tread: a groove round its middle.
    part(path,label,K.tire,g=>lathe(g,f,[[r-.42,-w],[r-.05,-w],[r,-w+.08],[r,-.09],[r-.06,-.06],[r-.06,.06],[r,.09],[r,w-.08],[r-.05,w],[r-.42,w],[r-.42,-w]],{seg:36}));
    part(path,'Wheel hub',hub,g=>{tube(g,f,.2,r-.42,-w+.1,w-.1,30);});
    part(path,'Hole pattern',C.hole,g=>{for(const s of [1,-1])for(let k=0;k<spokes;k++){const a=k/spokes*2*Math.PI,m=(r-.42+.2)/2+.05;disc(g,frame(pt(f,m*Math.cos(a),m*Math.sin(a),s*(w-.1+EPS)),mul(Y,s),X),.22,10);}});
    part(path,'Hex bore',C.steel,g=>tube(g,f,.12,.2,-w,w,6));
  }
  // ---- Starter Mecanum: a goBILDA Strafer-style kit bot ----------------------------------------------------------------
  // U-channel frame, grid plate deck, four 104 mm mecanum wheels on Yellow Jackets, a Control Hub and battery: its
  // IMU and the drive motors' own encoders are the only sensors, as on a kit robot straight out of the box,, and a polycarbonate push plate. The side rails are 16.9 in (18 holes), inside the 17.56 in length.
  const MECANUM={id:'startermecanum',name:'Starter Mecanum',L:17.32,W:17.79};
  // goBILDA's own layout for two 4-Bar Odometry Pods (32 mm wheel) and a Pinpoint on this chassis, from its Pinpoint user guide: both pods in the rear cross channel, 168 mm behind the
  // robot's centre, the X (forward) pod 84 mm to the right and the Y (strafe) pod 84 mm to the left, the Pinpoint between them, sticker side up. at: where the channel's open side is.
  const ODO={x:-168/25.4,y:84/25.4,r:16/25.4};
  function odometryParts(path,at,deck){
    // forward: the pod tracks forward, so its wheel's axle lies across the robot; the strafe pod's lies along it.
    const pod=(name,y,forward)=>{const p=[...path,name],c=[ODO.x,y];
      part(p,'Odometry wheel',K.tire,g=>cylinder(g,frame([c[0],c[1],ODO.r],forward?Y:X,forward?X:Y),ODO.r,-.14,.14,24));
      part(p,'Wheel hub',K.yellow,g=>cylinder(g,frame([c[0],c[1],ODO.r],forward?Y:X,forward?X:Y),ODO.r*.55,-.16,.16,16));
      part(p,'4-Bar arms',K.black,g=>{box(g,[c[0]-.36,c[1]-.36,2*ODO.r+.02],[c[0]+.36,c[1]+.36,2*ODO.r+.14]);if(forward){box(g,[c[0]-.2,c[1]-.3,ODO.r-.1],[c[0]+.2,c[1]-.2,2*ODO.r+.02]);box(g,[c[0]-.2,c[1]+.2,ODO.r-.1],[c[0]+.2,c[1]+.3,2*ODO.r+.02]);}
        else{box(g,[c[0]-.3,c[1]-.2,ODO.r-.1],[c[0]-.2,c[1]+.2,2*ODO.r+.02]);box(g,[c[0]+.2,c[1]-.2,ODO.r-.1],[c[0]+.3,c[1]+.2,2*ODO.r+.02]);}});
      // Its body bolts inside the cross channel (it fits the channel's 43 mm inside).
      part(p,'4-Bar Odometry Pod',K.black,g=>box(g,[at-1.45,c[1]-.42,2*ODO.r+.1],[c[0]+.2,c[1]+.42,2.85]));};
    pod('Odometry pod X (forward)',-ODO.y,true);pod('Odometry pod Y (strafe)',ODO.y,false);
    const pin=[...path,'Pinpoint'],h=43/25.4/2;
    part(pin,'goBILDA Pinpoint',K.black,g=>box(g,[ODO.x-h,-h,deck],[ODO.x+h,h,deck+.42]));
    part(pin,'Pinpoint label',K.yellow,g=>box(g,[ODO.x-h+.2,-h+.5,deck+.42],[ODO.x+h-.2,h-.2,deck+.43]));
    part(pin,'Pinpoint ports',C.alu,g=>{for(const dy of [-.45,-.15,.15])box(g,[ODO.x-h+.25,dy-.1,deck+.42],[ODO.x-h+.6,dy+.1,deck+.45]);});
  }
  function starterMecanum(){
    const HX=MECANUM.L/2,HY=MECANUM.W/2,R=WHEEL_R,wy=HY-MECANUM_HALF,outY=wy-MECANUM_HALF-.365,railW=48/25.4,inY=outY-railW,end=HX-.012,WX=HX-2.9;
    for(const s of [1,-1]){const side=s>0?'left':'right';channel([CHASSIS,`U-Channel 1120 ${side}`],'U-Channel 1120 432mm','x',-8.45,8.45,s*outY,s);}
    // The front channel sits back by the push plate's thickness.
    channel([CHASSIS,'U-Channel 1120 front'],'U-Channel 1120 288mm','y',-inY,inY,HX-.14,1);channel([CHASSIS,'U-Channel 1120 back'],'U-Channel 1120 288mm','y',-inY,inY,-end,-1);
    gridPlate([CHASSIS,'Grid plate'],HX-.3,outY-railW/2-.3);
    for(const [k,sx,sy] of CORNERS){mecanumWheel([CHASSIS,'Mecanum wheel '+k],[sx*WX,sy*wy,R],sx,sy,outY);motor([CHASSIS,'Drive motor '+k],[sx*WX,sy*inY,R],[0,-sy,0],{shaft:outY-inY+.3});}
    // Push plate: clear polycarbonate across the front, below the deck so it pushes pieces on the floor.
    part([CHASSIS,'Push plate'],'Push plate',K.poly,g=>box(g,[HX-.125,-outY+.1,.55],[HX,outY-.1,4.2]));
    part([CHASSIS,'Push plate'],'Hole pattern',C.hole,g=>holes(g,frame([HX+EPS,0,3.6],X,Y),11,{small:false}));
    hubAndBattery([ELECTRONICS],-HX+.7,-HX+6.3,outY-railW/2-.25,-(outY-railW/2-.25)-1.4,PLATE_Z);
    odometryParts([ELECTRONICS],-end+48/25.4,PLATE_Z);
  }
  function mecanumJoints(name){const HX=MECANUM.L/2,HY=MECANUM.W/2,WX=HX-2.9,wy=HY-MECANUM_HALF;
    return CORNERS.map(([k,sx,sy])=>({id:'wheel'+k,name:'Mecanum wheel '+k,kind:'drive-wheel',type:'continuous',parts:[`${name}/${CHASSIS}/Mecanum wheel ${k}`],
      origin:[sx*WX,sy*wy,WHEEL_R],axis:[0,1,0],radius:+WHEEL_R.toFixed(4),roll:'mecanum',drive:{signal:'wheel'},source:src}));}
  // ---- A301 Swerve: NYC FIRST A301's square swerve base ---------------------------------------------------------------
  // A 1 in box-tube frame with a module under each corner: a fixed module plate and bearing, and below it the steering
  // yoke (ring gear, forks, axle) that turns about the module's centre with its 3 in wheel. The drive motor stands on the
  // plate above the wheel (coaxial) and an Axon steering servo's pinion turns the ring gear. Belly pan, Control Hub,
  // battery and a SparkFun OTOS in the middle.
  const SWERVE={id:'a301swerve',name:'A301 Swerve',L:17,W:17,module:5.9,r:1.5,width:.5};
  const PLATE={z0:4.45,z1:4.6},TUBE={z0:4.6,z1:5.6};
  function a301Swerve(){
    const H=SWERVE.L/2,M=SWERVE.module,R=SWERVE.r,w=SWERVE.width;
    // Frame: side tubes along x, front and back tubes between them.
    const tubeAlong=(path,lo,hi)=>{part(path,'Box tube 1x1',K.tube,g=>box(g,lo,hi));
      part(path,'Hole pattern',C.hole,g=>{const along=hi[0]-lo[0]>hi[1]-lo[1],n=Math.floor((along?hi[0]-lo[0]:hi[1]-lo[1])-.5);for(let k=0;k<n;k++){const t=(k-(n-1)/2);disc(g,frame(along?[t,(lo[1]+hi[1])/2,hi[2]+EPS]:[(lo[0]+hi[0])/2,t,hi[2]+EPS],Z,X),.1,8);}});};
    for(const s of [1,-1])tubeAlong([CHASSIS,`Frame tube ${s>0?'left':'right'}`],[-H,s>0?H-1:-H,TUBE.z0],[H,s>0?H:-H+1,TUBE.z1]);
    for(const s of [1,-1])tubeAlong([CHASSIS,`Frame tube ${s>0?'front':'back'}`],[s>0?H-1:-H,-H+1,TUBE.z0],[s>0?H:-H+1,H-1,TUBE.z1]);
    // Belly pan between the modules.
    part([CHASSIS,'Belly pan'],'Belly pan',K.poly,g=>{box(g,[-3.4,-H+1,PLATE.z1],[3.4,H-1,PLATE.z1+.1]);for(const s of [1,-1])box(g,s>0?[3.4,-3.4,PLATE.z1]:[-H+1,-3.4,PLATE.z1],s>0?[H-1,3.4,PLATE.z1+.1]:[-3.4,3.4,PLATE.z1+.1]);});
    for(const [k,sx,sy] of CORNERS){
      const c=[sx*M,sy*M],mod=[CHASSIS,'Swerve module '+k],up=frame([c[0],c[1],0],Z,X),steer=[...mod,'Steering'],in2=[-sx*Math.SQRT1_2,-sy*Math.SQRT1_2];
      part([...mod,'Module plate'],'Module plate',C.alu,g=>box(g,[c[0]-2.4,c[1]-2.4,PLATE.z0],[c[0]+2.4,c[1]+2.4,PLATE.z1]));
      part([...mod,'Module plate'],'Hole pattern',C.hole,g=>{for(const [dx,dy] of [[1.9,1.9],[1.9,-1.9],[-1.9,1.9],[-1.9,-1.9]])disc(g,frame([c[0]+dx,c[1]+dy,PLATE.z1+EPS],Z,X),.14,10);});
      part([...mod,'Module bearing'],'Module bearing',C.aluDark,g=>tube(g,up,1.55,1.85,3.9,PLATE.z0,40));
      // Steering: ring gear, yoke plate, two forks and the axle; the wheel in it.
      part(steer,'Ring gear 60T',C.gear,g=>gear(g,up,1.0,1.7,1.85,60,3.55,3.85));
      part(steer,'Yoke plate',K.black,g=>tube(g,up,.3,1.6,3.3,3.55,36));
      part(steer,'Forks',K.black,g=>{for(const s of [1,-1])prism(g,frame([c[0],c[1],0],Z,X),[[-1.05,s*(w+.12)],[1.05,s*(w+.12)],[1.05,s*(w+.24)],[-1.05,s*(w+.24)]],.7,3.3);});
      part(steer,'Axle',C.steel,g=>cylinder(g,frame([c[0],c[1],R],Y,X),.16,-w-.3,w+.3,6));
      wheel([...steer,'Wheel'],[c[0],c[1],R],R,w,{hub:K.blue,spokes:6,label:'Swerve wheel tire'});
      // Drive motor on the plate over the wheel, its belt down through the module (coaxial); steering servo inboard.
      motor([...mod,'Drive motor'],[c[0],c[1],PLATE.z1],Z,{label:'goBILDA 5203 Yellow Jacket 1150 rpm',shaft:.5});
      const sp=[c[0]+in2[0]*2.3,c[1]+in2[1]*2.3];servo([...mod,'Steering servo'],'Axon MINI+ steering servo',[sp[0],sp[1],PLATE.z1],[0,0,-1],[in2[0],in2[1],0]);
      part([...mod,'Steering servo'],'Steering pinion 20T',C.gear,g=>gear(g,frame([sp[0],sp[1],0],Z,X),.12,.42,.52,20,3.55,3.85));
      part([...mod,'Steering servo'],'Pinion shaft',C.steel,g=>cylinder(g,frame([sp[0],sp[1],0],Z,X),.12,3.85,PLATE.z1,6));
    }
    // OTOS under the belly pan at the centre, looking at the floor.
    part([CHASSIS,'SparkFun OTOS'],'SparkFun OTOS',K.red,g=>box(g,[-.5,-.5,PLATE.z0-.06],[.5,.5,PLATE.z0+.14]));
    part([CHASSIS,'SparkFun OTOS'],'OTOS standoffs',C.alu,g=>{for(const [dx,dy] of [[.38,.38],[-.38,.38],[.38,-.38],[-.38,-.38]])cylinder(g,frame([dx,dy,PLATE.z0+.14],Z),.06,0,PLATE.z1-PLATE.z0-.04,6);});
    hubAndBattery([ELECTRONICS],-2.8,2.8,1.1,-2.5,PLATE.z1+.1);
  }
  function swerveJoints(name){const M=SWERVE.module,R=SWERVE.r;
    return CORNERS.flatMap(([k,sx,sy])=>{const mod=`${name}/${CHASSIS}/Swerve module ${k}`;
      return [{id:'steer'+k,name:'Steering '+k,kind:'swerve-steer',type:'continuous',parts:[mod+'/Steering'],origin:[sx*M,sy*M,0],axis:[0,0,1],states:{forward:0,left:90},speed:720,drive:{signal:'steer'},source:src},
        {id:'wheel'+k,name:'Swerve wheel '+k,kind:'drive-wheel',type:'continuous',parent:'steer'+k,parts:[mod+'/Steering/Wheel'],origin:[sx*M,sy*M,R],axis:[0,1,0],radius:R,drive:{signal:'wheel'},source:src}];});}
  // ---- the presets ---------------------------------------------------------------------------------------------------
  // draw: its parts; joints: its moving parts (CAD frame = robot frame); heightIn: its CAD's height; sensors: where it
  // gets its position; wiring: Control Hub ports as on the robot; parts: its mechanisms' CAD assemblies; cad: the vendor
  // CAD the app shows in its place where the build has it (ui/assets/robots, personal local builds only).
  const ROBOTS={
    // It comes with odometry on (its pods and Pinpoint are on its CAD); a kit without them unticks it in Chassis and runs on its motor encoders and the hub's IMU.
    startermecanum:{...MECANUM,cad:'strafer',draw:starterMecanum,joints:mecanumJoints,heightIn:7.25,wheelDiameterMm:104,localization:'fused',imuSource:'device',
      wiring:{devices:{'robot.frontLeft':{model:'gobilda-5203-312',hub:'control',port:0},'robot.frontRight':{model:'gobilda-5203-312',hub:'control',port:1},
        'robot.backLeft':{model:'gobilda-5203-312',hub:'control',port:2},'robot.backRight':{model:'gobilda-5203-312',hub:'control',port:3},'robot.imu':{hub:'control',bus:0},'robot.pinpoint':{hub:'control',bus:1}}}},
    a301swerve:{...SWERVE,cad:'swechanum',draw:a301Swerve,joints:swerveJoints,heightIn:9.25,wheelDiameterMm:76,localization:'optical',imuSource:'device',
      wiring:{devices:{'robot.frontLeft':{model:'gobilda-5203-1150',hub:'control',port:0},'robot.frontRight':{model:'gobilda-5203-1150',hub:'control',port:1},
        'robot.backLeft':{model:'gobilda-5203-1150',hub:'control',port:2},'robot.backRight':{model:'gobilda-5203-1150',hub:'control',port:3},
        'robot.steerFrontLeft':{model:'axon-mini-cr',hub:'control',port:0},'robot.steerFrontRight':{model:'axon-mini-cr',hub:'control',port:1},
        'robot.steerBackLeft':{model:'axon-mini-cr',hub:'control',port:2},'robot.steerBackRight':{model:'axon-mini-cr',hub:'control',port:3},
        'robot.imu':{hub:'control',bus:0},'robot.otos':{hub:'control',bus:1}}}}};
  // ---- demo routes -------------------------------------------------------------------------------------------------
  // BIOBUZZ red autonomous routes that show what each robot does (Deck inches from the audience-left corner, headings
  // counter-clockwise from +x), validated headlessly in tests/sim-preset-robots.test.cjs: no zone touched, ending at the
  // last pin inside the 30 s period.
  const P=(x,y,action,note,path,extra={})=>({x,y,wait:extra.wait||0,action,...(extra.turn!==undefined?{turn:extra.turn,turnMode:'absolute'}:{}),...(extra.actionSeconds!==undefined?{actionSeconds:extra.actionSeconds}:{}),...(extra.cell?{cell:extra.cell}:{}),...(note?{note}:{}),path});
  const plain=note=>({style:'sharp',note});
  const ROUTES={
    // The kit push bot drives square, as teams first test one: forward off the wall, a 90° turn, straight up the field to
    // (24, 84), turned around, straight back down to (24, 48), then up to park in the loading zone. At the kit's real speed
    // (312 RPM wheels) on motor encoders alone it stops a little short of each end, more the further it has driven, so the legs are kept this long.
    startermecanum:{start:{x:10.11,y:27,heading:0},pins:[
      P(24,27,'','LEAVE: forward off the wall, then a 90° turn',plain('Drive forward'),{turn:90}),
      P(24,84,'','Up the field, then turned around',plain('Straight up the field'),{turn:-90}),
      P(24,48,'','Back down the field',plain('Straight back down')),
      P(21,107,'','PARK: partly in the red LOADING ZONE, facing it',plain('Up into the loading zone, pushing its pollen into the corner'),{turn:-180})]},
    // Swerve showing off: curves that spin the robot a whole turn while it drives, face the hive while it circles, spin
    // back the other way and face where it drives, then sweep the loading zone's pollen into the corner as it parks.
    a301swerve:{start:{x:9.83,y:27,heading:0},pins:[
      P(34,27,'','LEAVE: off the starting wall',plain('Off the wall')),
      P(62,28,'','',{style:'spline',note:'A full spin while it drives',rotate:'spin',spins:1}),
      P(30,54,'','',{style:'spline',note:'Facing the hive while it circles',rotate:'track',target:{x:72,y:72}}),
      P(32,86,'','',{style:'spline',note:'Spinning back the other way',rotate:'spin',spins:-1}),
      P(30,124,'','',{style:'spline',note:'Facing where it drives',rotate:'tangent'}),
      P(20.5,107,'','PARK: partly in the red LOADING ZONE, facing it',{style:'spline',note:'Into the loading zone, pushing its pollen into the corner'},{turn:-180})]}};
  // The demo route as a field of its own (the app gives it its id).
  function layout(id){const r=ROUTES[id];return {name:`${Mech().PRESETS[id].name} demo`,field:'biobuzz',alliance:'red',width:144,height:144,elements:true,start:{...r.start},zones:[],pins:JSON.parse(JSON.stringify(r.pins)),
    clearance:.25,style:'spline',rotate:false,route:null,tested:null};}
  const has=id=>Object.hasOwn(ROBOTS,id);
  // The preset whose CAD a stored model is (it keeps the robot's name), or null. No model (or a nameless one) is no preset.
  const ofModel=m=>m?.name?Object.keys(ROBOTS).find(id=>ROBOTS[id].name===m.name)||null:null;
  // Model metadata the app stores with it (meta() adds the id and the parts found in it).
  const model=id=>({name:ROBOTS[id].name,units:'in',front:'+x',top:'+z',source:'step',bodyChassis:true,entered:['mass','wheel','rpm']});
  // Every part, as the STEP import gives them: [{path, name, position, normal, index, color}].
  function meshes(id){const r=ROBOTS[id];if(!r)throw Error('Unknown preset robot.');const list=TR.build(r.name,r.draw);return r.post?r.post(list):list;}
  // The import result the app stores (what src/sim-model.cjs gives for a STEP file), from its pure functions.
  function result(id,SM){const m=meshes(id);return {kind:'step',name:ROBOTS[id].name,...SM.merge(m),tree:SM.tree(m),groups:SM.groups(m),names:SM.names(m)};}
  const kinematics=id=>{const r=ROBOTS[id];return {model:null,unit:1,joints:r.joints(r.name),...(r.actuators?{actuators:JSON.parse(JSON.stringify(r.actuators))}:{})};};
  const wiring=id=>JSON.parse(JSON.stringify(ROBOTS[id].wiring));
  // What a preset puts in the project besides DeckMechanisms.PRESETS' size and mechanisms: the rest of the robot (its
  // height, wheels and wiring), sensors, IMU, kinematics (kinematics.model is set once the app has stored the CAD), the
  // mechanisms' CAD parts and its demo route as a field of its own.
  function apply(id,project,C){
    const r=ROBOTS[id],p=Mech().PRESETS[id],out={...project};
    out.controller='ftc';out.robot=C.robot({...project.robot,...p.robot,heightIn:r.heightIn,wheelDiameterMm:r.wheelDiameterMm,appearance:'custom',wiring:wiring(id)},'ftc');
    out.sensors={...project.sensors,localization:r.localization};out.imuSource=r.imuSource;
    const m=Mech().presetMechanisms(id);if(r.parts)for(const list of ['intakes','shooters'])m[list]=m[list].map((x,n)=>r.parts[list][n]?{...x,parts:[r.parts[list][n]]}:x);
    out.mechanisms=m;out.kinematics=Kin().sanitize(kinematics(id));out.robotPreset=id;return out;
  }
  return {VERSION,ROBOTS,ROUTES,has,ofModel,model,meshes,result,kinematics,wiring,layout,apply};
});
