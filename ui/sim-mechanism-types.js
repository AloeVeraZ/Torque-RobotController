(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckMechanismTypes=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // What a moving part is: a claw, a lift, a turret, a hang hook... Mechanisms that show up on FTC robots (gm0's common
  // mechanisms: intakes, claws, transfers, linear motion and rigging, arms, linkages, turrets, dead wheels; the game
  // years' shooters, hoods, spindexers, buckets, hangs and launchers), on FRC robots (elevators, big pivots, wrists,
  // slapdown intakes, indexers, climbers, swerve) and on robots in general (articulated arms, SCARA, gantries, legs,
  // grippers, pan-tilt heads, steering, pneumatics). Sources are in docs/MECHANISM_RESEARCH.md.
  // A type is a starting point for a joint (DeckKinematics): how it moves, which way, its named positions, how fast,
  // the motor that usually drives it, and the words a CAD assembly named for it uses. Nothing here is required: a
  // joint's own settings always win, and the team can pick another type or change any setting.
  //   joint     revolute (pivots), continuous (spins), prismatic (slides)
  //   axis      the pivot or slide direction on the robot: side (left–right), up, forward (front–back)
  //   find      how the finder locates it in a CAD: hinge, slide, spin (round parts on an axle), yaw (a turntable),
  //             claw (its fingers), wheel (left to the drive wheel finder)
  //   positive  which way positive turns move it from its CAD pose: raise (arms, hooks) or lower (drop-down intakes)
  //   piece     it can be one CAD part (a gate, a hood); otherwise a single part named for it is one of its pieces
  //   family    types that nest as one mechanism: a "Viper slide" inside a "Lift" is part of the lift
  //   signal    the game signal it can follow when the game's mechanisms are on (rollers spin while intaking)
  const GROUPS=[['intake','Intakes and claws'],['inside','Moving pieces inside'],['lift','Lifts and slides'],['arm','Arms and linkages'],['score','Shooters and scoring'],
    ['endgame','Hanging and endgame'],['drive','Drivetrain and odometry'],['sense','Cameras and sensors'],['robot','Robot arms, legs and machines'],['custom','Your own']];
  // The usual actuator, as a DeckActuators model, and the gearing after its own gearbox.
  const servo=model=>({kind:'servo',model}),linear=model=>({kind:'linear',model}),crservo=model=>({kind:'crservo',model}),spool=d=>({kind:'spool',diameter:d}),belt=(a,b)=>({kind:'belt',driver:a,driven:b});
  const motor=(model,...transmission)=>({kind:'dcmotor',model,...(transmission.length?{transmission}:{})});
  const T=(id,group,name,joint,o)=>({id,group,name,joint,axis:'side',find:joint==='prismatic'?'slide':joint==='continuous'?'spin':'hinge',family:id,...o});
  // Named positions are in degrees for pivots and spins, inches for slides; speeds are degrees or inches a second.
  // Spinning parts keep their rpm for the game's signals and a "run" position (a few turns) for route actions.
  const LIST=[
    // ---- intakes and claws
    T('roller-intake','intake','Roller intake','continuous',{rpm:400,states:{stop:0,run:2160},speed:2400,signal:'roller',motor:motor('gobilda-5203-1150'),
      words:'\\bintake\\b|\\broller(?:s|\\s?bar)?\\b|sweeper|brush ?roll|gecko|compliant ?wheel|flex ?wheel|surgical ?tub(?:e|ing)|star ?wheel|active ?intake|\\bsucker\\b|\\bcollect(?:or|ing)\\b|harvest(?:er|ing)?|gatherer|\\bpick ?-?up\\b|under ?-?(?:the ?)?bumper(?: ?intake)?|\\butb\\b',
      blurb:'Spinning rollers, wheels or tubing that pull pieces in off the floor.'}),
    T('deploy-intake','intake','Drop-down intake','revolute',{states:{up:0,down:90},lower:0,upper:150,speed:240,positive:'lower',motor:servo('gobilda-torque'),
      words:'(?:slap|drop) ?-?down(?: ?intake)?|deploy(?:able|ing|er)?(?: ?intake)?|flip ?-?(?:out|down)(?: ?intake)?|intake ?(?:pivot|arm|deploy|lift|tilt|wrist|flip)|pivot(?:ing)? ?intake|over ?-?the ?-?bumper(?: ?intake)?|\\botb\\b(?: ?intake)?|(?:four|4) ?-?bar ?intake|(?:collector|harvester) ?(?:pivot|arm|deploy|lift|tilt|flip)|intake ?(?:height|drop)|stack ?(?:knocker|height|adjust(?:er)?)',
      blurb:'An intake that swings down to the floor to pick up and back up to hand over (slapdown, over the bumper).'}),
    T('claw','intake','Claw','revolute',{states:{open:0,closed:25},speed:360,find:'claw',motor:servo('gobilda-speed'),
      words:'\\bclaws?\\b|grabber|\\bgrab\\b|pincer|pinch(?:er)?|\\bclamp\\b|gripper|\\bgrip\\b|\\bjaws?\\b|end ?-?effector|grasp(?:er)?|\\btongs?\\b|\\bnipper\\b|\\bmandibles?\\b',
      blurb:'Fingers that close on a piece, usually on a servo. Its fingers are found by name (finger, jaw, pincer).'}),
    T('parallel-gripper','intake','Parallel gripper','prismatic',{axis:'side',states:{open:0,closed:1},lower:0,upper:2,speed:4,motor:servo('gobilda-speed'),
      words:'parallel ?(?:gripper|jaws?|claw)|linear ?(?:gripper|claw)|jaw ?gripper|two ?-?finger ?gripper',
      blurb:'Jaws that slide straight toward each other.'}),
    T('roller-claw','intake','Roller claw','continuous',{rpm:300,states:{stop:0,run:1800},speed:1800,signal:'roller',motor:crservo('gobilda-speed-cr'),
      words:'roller ?claw|active ?claw|intake ?claw|spinning ?claw|wheel(?:ed)? ?claw|roller ?grabber',
      blurb:'A claw with spinning wheels that pull a piece in and spit it out.'}),
    T('wrist','intake','Wrist','revolute',{states:{down:0,up:90},speed:360,positive:'raise',piece:true,motor:servo('axon-mini'),
      words:'\\bwrist(?: ?(?:pitch|tilt|pivot))?\\b|claw ?(?:pitch|tilt|pivot)',
      blurb:'Tilts a claw or intake at the end of an arm.'}),
    T('wrist-roll','intake','Wrist roll (twist)','revolute',{axis:'forward',states:{flat:0,turned:90},speed:360,family:'wrist-roll',motor:servo('gobilda-speed'),
      words:'wrist ?(?:roll|rotat(?:e|ion|or)|twist|spin|turn)|claw ?(?:roll|rotat(?:e|ion|or)|twist|spin)|rotat(?:ing|or) ?(?:claw|wrist)|\\btwister\\b|roll ?joint',
      blurb:'Turns a claw about its own length to line up with a piece.'}),
    T('diffy-wrist','intake','Differential wrist','revolute',{states:{down:0,up:90},speed:360,positive:'raise',family:'wrist',motor:servo('axon-mini'),
      words:'diff(?:erential|y) ?wrist|\\bdiffy\\b|bevel ?(?:gear ?)?wrist',
      blurb:'Two servos through bevel gears: turning them together tilts it, against each other rolls it. This part is the tilt; add a Wrist roll inside it for the roll.'}),
    T('bucket','intake','Bucket or dumper','revolute',{states:{hold:0,dump:120},speed:300,piece:true,motor:servo('gobilda-torque'),
      words:'bucket|\\bdump(?:er|ing)?\\b|basket|\\bscoop\\b|\\btray\\b|deposit(?:or)?|\\bbin\\b|(?:outtake|deposit|pixel|freight|scoring|dump(?:ing)?|cargo|sample|artifact|glyph|mineral|debris|ball) ?box(?:es)?|glyph ?(?:flipper|tray|platform)|flip ?(?:tray|plate|platform)',
      blurb:'Holds pieces and tips them out to score.'}),
    // ---- moving pieces inside the robot
    T('kicker','inside','Kicker or flicker','revolute',{states:{rest:0,kick:60},speed:720,piece:true,motor:servo('gobilda-speed'),
      words:'\\bkick(?:er|ing)?\\b|\\bflick(?:er)?\\b|\\bpush(?:er)?\\b|\\btapper\\b|\\bpaddle\\b|plunger|ejector|\\blever\\b|\\bpopper\\b|\\bshove(?:r)?\\b',
      blurb:'Swings or pushes a piece: into the shooter, out of the robot, off the intake.'}),
    T('transfer','inside','Transfer arm','revolute',{states:{intake:0,transfer:180},speed:360,motor:servo('axon-max'),
      words:'\\btransfer(?: ?(?:arm|flip|bucket))?\\b|\\bflipper\\b|pass ?-?through|hand ?-?off',
      blurb:'Flips a piece from the intake over to the scoring mechanism.'}),
    T('conveyor','inside','Conveyor or belt','continuous',{rpm:300,states:{stop:0,run:1800},speed:1800,signal:'feeder',motor:motor('gobilda-5203-1150'),
      words:'conveyor|(?:feed|intake|transfer|vertical|storage) ?belts?\\b|belt ?(?:feed|conveyor|system)|tread ?(?:intake|conveyor)|polycord|poly ?-?belt|(?:ball|particle|ring|artifact|pixel|debris) ?elevator|\\bserializer\\b|singulator|\\bagitator\\b',
      blurb:'Belts or tread that carry pieces through the robot.'}),
    T('spindexer','inside','Spindexer or carousel','continuous',{axis:'up',states:{slot1:0,slot2:120,slot3:240},speed:360,find:'yaw',motor:servo('gobilda-torque'),
      words:'spin ?-?dex(?:er)?|\\bcarousel\\b(?! ?(?:spinner|wheel))|revolver|rotary ?(?:index(?:er)?|magazine|sorter)|cylinder ?magazine',
      blurb:'A turning drum with a slot per piece that indexes them to the shooter.'}),
    T('gate','inside','Gate, door or flap','revolute',{states:{closed:0,open:90},speed:360,piece:true,motor:servo('gobilda-speed'),
      words:'\\bgate\\b|\\bdoor\\b|\\bflap\\b|\\blid\\b|stopper|blocker|\\bhatch\\b|shutter|pixel ?(?:lock|latch|holder|retainer|stop(?:per)?)',
      blurb:'Opens to let pieces through and closes to hold them.'}),
    T('feeder','inside','Feeder wheels','continuous',{rpm:600,states:{stop:0,run:3600},speed:3600,signal:'feeder',motor:motor('gobilda-5203-6000'),
      words:'\\bfeeder\\b|feed ?(?:wheel|roller)s?|index(?:er|ing)? ?(?:wheel|roller)s?|\\buptake\\b|kicker ?wheels?|transfer ?(?:wheel|roller)s?',
      blurb:'Wheels that push a piece into the shooter.'}),
    // ---- lifts and slides
    T('lift','lift','Lift or elevator','prismatic',{axis:'up',states:{down:0,up:24},lower:0,upper:30,speed:30,family:'slide',motor:motor('gobilda-5203-435',spool(1.4)),
      words:'\\blift\\b|elevator|vertical ?(?:slides?|lift|extension)|cascade|continuous ?rig(?:ging)?|\\bmast\\b|\\btower\\b|outtake ?slides?|linear ?lift|\\bhoist\\b',
      blurb:'Slides that carry a mechanism straight up, strung continuous or cascade.'}),
    T('linear-slide','lift','Linear slide (extension)','prismatic',{axis:'forward',states:{in:0,out:18},lower:0,upper:24,speed:40,family:'slide',motor:motor('gobilda-5203-435',spool(1.4)),
      words:'\\bslides?\\b|\\bextension\\b|\\bextend(?:o|er)\\b|telescop(?:e|ic|ing)|drawer ?slides?|misumi|\\bviper\\b|linear ?(?:rail|slide|extension|motion)|horizontal ?(?:slides?|extension|lift)|\\bext\\b|relic ?(?:arm|extension|extender|reach)|x ?-?rails?|\\bgo ?rail\\b',
      blurb:'Drawer, extrusion or bearing slides that reach out (an extendo), strung with a spool.'}),
    T('scissor-lift','lift','Scissor lift','prismatic',{axis:'up',states:{down:0,up:18},lower:0,upper:24,speed:10,family:'slide',motor:motor('gobilda-5203-312',{kind:'screw',lead:.315}),
      words:'scissor(?: ?(?:lift|jack|mechanism))?',blurb:'Crossed links that push straight up.'}),
    T('lead-screw','lift','Lead screw or linear actuator','prismatic',{axis:'forward',states:{in:0,out:6},lower:0,upper:12,speed:2,family:'slide',motor:motor('gobilda-5203-312',{kind:'screw',lead:.315}),
      words:'lead ?-?screw|linear ?actuator|actuonix|ball ?-?screw|power ?screw|threaded ?rod|acme ?(?:screw|rod)|linear ?servo|\\bjack ?screw\\b',
      blurb:'A turning screw that pushes a nut along it: slow, strong and holds without power.'}),
    T('rack-pinion','lift','Rack and pinion slide','prismatic',{axis:'forward',states:{in:0,out:10},lower:0,upper:16,speed:20,family:'slide',motor:motor('gobilda-5203-435',{kind:'rack',diameter:1}),
      words:'rack ?(?:and|&|n|-)? ?pinion(?: ?(?:slides?|extension|lift))?|rack ?(?:slide|extension|drive)',blurb:'A gear driving a toothed bar along its rails.'}),
    T('linkage-slide','lift','Linkage extension','prismatic',{axis:'forward',states:{in:0,out:12},lower:0,upper:18,speed:30,family:'slide',motor:servo('axon-max'),
      words:'linkage ?(?:slides?|extension|extendo|extend(?:er)?)|crank ?(?:slide|extension)|two ?-?bar ?linkage',
      blurb:'A servo-driven two-bar linkage that pushes slides out.'}),
    T('dr4b','lift','Double reverse four-bar','prismatic',{axis:'up',states:{down:0,up:16},lower:0,upper:24,speed:20,family:'slide',motor:motor('gobilda-5203-117'),
      words:'(?:double ?-?reverse(?: ?(?:four|4) ?-?bar)?|\\bdr ?4 ?b\\b|reverse ?(?:four|4) ?-?bar)(?: ?lift)?',
      blurb:'Two four-bars stacked so the top moves straight up. Drawn here as its straight-up motion.'}),
    // ---- arms and linkages
    T('arm','arm','Arm (pivot)','revolute',{states:{down:0,up:90},speed:120,positive:'raise',piece:true,motor:motor('gobilda-5203-117',belt(20,60)),
      words:'\\barms?\\b|^pivot$|big ?pivot|shoulder|\\bboom\\b|swing ?arm|scoring ?arm|outtake ?arm|upper ?arm|\\bcrane\\b|\\bjib\\b|(?:main|outtake|scoring|deposit|specimen) ?pivot',
      blurb:'A pivot that swings a mechanism up and over: a big pivot, a scoring arm.'}),
    T('pivot-extension','arm','Pivoting slide','revolute',{states:{down:0,up:90},speed:90,positive:'raise',family:'arm',then:'linear-slide',motor:motor('gobilda-5203-117',belt(20,60)),
      words:'pivot(?:ing)? ?(?:slides?|extension|lift)|(?:slides?|extension|lift) ?pivot|tilt(?:ing)? ?(?:slides?|lift)',
      blurb:'Slides on a pivot: the pivot aims them and the slides reach. The slides inside it ride on it.'}),
    T('elbow','arm','Elbow (second arm joint)','revolute',{states:{straight:0,bent:90},speed:120,positive:'raise',family:'elbow',piece:true,motor:servo('axon-max'),
      words:'\\belbow\\b|forearm|lower ?arm|second ?(?:arm|stage) ?(?:joint|pivot)',blurb:'The joint between the two halves of a two-jointed arm.'}),
    T('four-bar','arm','Four-bar linkage','revolute',{states:{down:0,up:90},speed:120,positive:'raise',family:'arm',motor:servo('gobilda-torque'),
      words:'(?:four|\\b4) ?-?bar|parallelogram|parallel ?(?:arm|linkage)|\\blinkage\\b',
      blurb:'Two parallel bars that keep the end level as it swings in an arc. Pin the coupler to close the loop.'}),
    T('v4b','arm','Virtual four-bar','revolute',{states:{down:0,up:180},speed:240,positive:'raise',family:'arm',motor:servo('axon-max'),
      words:'virtual ?(?:four|4) ?-?bar|\\bv ?-?4 ?-?b\\b|coax(?:ial)? ?(?:v ?-?4 ?-?b|virtual ?(?:four|4) ?-?bar|arm|pivot)',blurb:'An arm whose end stays level through a belt or chain, with more than 180° of travel.'}),
    // ---- shooters and scoring
    T('flywheel','score','Flywheel shooter','continuous',{rpm:3000,states:{stop:0,run:3600},speed:18000,signal:'flywheel',motor:motor('gobilda-5203-6000'),
      words:'fly ?-?wheel|\\bshoot(?:er|ing)?(?: ?wheel)?\\b|launch(?:er|ing)? ?wheel|\\bcannon\\b|blaster|\\blauncher\\b|rhino ?wheel',
      blurb:'A fast wheel that launches pieces.'}),
    T('hood','score','Adjustable hood','revolute',{states:{low:0,high:20},speed:120,piece:true,motor:servo('gobilda-speed'),
      words:'\\bhood\\b|shooter ?(?:angle|pitch)|launch ?angle|\\bdeflector\\b|adjustable ?ramp',blurb:'The curved plate over a flywheel; tilting it changes the launch angle.'}),
    T('turret','score','Turret','revolute',{axis:'up',states:{front:0,left:90,right:-90},lower:-180,upper:180,speed:240,find:'yaw',motor:motor('gobilda-5203-435',belt(20,100)),
      words:'turret|turn ?-?table|lazy ?susan|slew(?:ing)? ?(?:ring|bearing)|yaw ?(?:base|mount|plate)|rotat(?:ing|ion) ?base',
      blurb:'Turns a mechanism side to side to aim without turning the robot.'}),
    T('mini-turret','score','Mini turret (end effector yaw)','revolute',{axis:'up',states:{center:0,left:45,right:-45},speed:360,find:'yaw',family:'turret',motor:servo('axon-mini'),
      words:'mini ?-?turret|claw ?turret|end ?-?effector ?turret|wrist ?yaw|yaw ?joint',blurb:'A small servo turret at the end of an extension that turns the claw.'}),
    T('catapult','score','Catapult','revolute',{states:{cocked:0,fired:100},speed:900,motor:motor('gobilda-5203-312'),
      words:'catapult|trebuchet|launch ?arm|puncher|slingshot',blurb:'An arm that swings fast to throw a piece.'}),
    T('drone-launcher','score','Spring launcher (drone or plane)','revolute',{states:{locked:0,released:45},speed:720,piece:true,motor:servo('gobilda-speed'),
      words:'\\bdrone(?: ?launch(?:er)?)?\\b|(?:paper ?)?(?:air)?plane ?launch(?:er)?|spring ?launch(?:er)?|launch(?:er)? ?(?:latch|release|trigger|lock)|\\btrigger\\b|(?:paper ?)?air ?plane\\b|paper ?plane\\b|hook ?launch(?:er)?',
      blurb:'A latch that a servo releases to fire a spring or rubber band.'}),
    T('spinner','score','Spinner (carousel wheel)','continuous',{rpm:200,states:{stop:0,run:1800},speed:1200,motor:crservo('gobilda-speed-cr'),
      words:'(?:carousel|duck) ?spinner|\\bspinner\\b|carousel ?wheel|flag ?(?:raiser|spinner|crank|turner|wheel)|\\bduck(?: ?(?:wheel|mech(?:anism)?|delivery))?\\b|carousel ?(?:mech(?:anism)?|delivery|duck)',blurb:'A wheel pressed against a field element to turn it.'}),
    // ---- hanging and endgame
    T('hang-hook','endgame','Hang hook or climber','revolute',{states:{stowed:0,raised:90},speed:120,positive:'raise',piece:true,motor:motor('gobilda-5203-117'),
      words:'\\bhooks?\\b|\\bhang(?:er|ing)?\\b|climb(?:er|ing)?|ascen(?:t|d|der)|pull ?-?up|rung ?(?:grab|hook)|(?:lander|latch(?:ing)?) ?(?:hook|lift|arm|mech(?:anism)?)|lander ?latch|(?:rigging|truss|rung|churro) ?(?:hooks?|grab(?:ber)?)|\\bsuspen(?:d|der)\\b',
      blurb:'Hooks raised to a bar or rung, then pulled down to lift the robot.'}),
    T('winch','endgame','Winch or spool','continuous',{states:{out:0,in:1080},speed:360,motor:motor('gobilda-5203-117'),
      words:'\\bwinch\\b|\\bspools?\\b|\\breel\\b|capstan|tether',blurb:'Winds up a cable or strap to pull the robot up.'}),
    T('ratchet','endgame','Brake, lock or ratchet','revolute',{states:{free:0,locked:20},speed:360,piece:true,motor:servo('gobilda-speed'),
      words:'ratchet|\\bpawl\\b|\\bbrake\\b|\\block(?:ing)?\\b|\\blatch\\b|detent',blurb:'Locks a lift or hang in place so it holds without power.'}),
    // ---- drivetrain and odometry
    T('drive-wheel','drive','Drive wheel','continuous',{find:'wheel',signal:'wheel',
      words:'(?:drive|mecanum|omni|traction|tank) ?wheels?|\\bmecanum\\b|omni ?-?wheel|\\btire\\b|\\btyre\\b|\\btreads?\\b|tank ?tracks?|\\bcaterpillar\\b',blurb:'Rolls with the robot as it drives.'}),
    T('swerve-steer','drive','Swerve steering','continuous',{axis:'up',states:{forward:0,left:90},speed:720,find:'yaw',motor:crservo('axon-mini-cr'),
      words:'\\bswerve(?: ?module)?\\b|steer(?:ing)? ?(?:module|pod|servo|gear)|azimuth|module ?yaw|diff(?:erential|y) ?(?:swerve|module|pod)',blurb:'Turns a swerve module’s wheel to point it.'}),
    T('odometry-pod','drive','Odometry pod (dead wheel)','continuous',{find:'wheel',signal:'wheel',
      words:'odo(?:metry)? ?(?:pod|wheel)s?|dead ?-?wheels?|tracking ?wheels?|encoder ?wheels?|\\bodo(?:metry)?\\b|(?:encoder|tracking|odo) ?pods?',blurb:'An unpowered wheel with an encoder that measures how far the robot moved.'}),
    T('odo-retract','drive','Retracting odometry','revolute',{states:{down:0,up:30},speed:240,positive:'raise',motor:servo('gobilda-speed'),
      words:'odo(?:metry)? ?(?:lift|retract(?:or|ion)?|raise|lifter)|retract(?:able|ing)? ?odo(?:metry)?|pod ?lift|dead ?-?wheel ?(?:lift|retract(?:or|ion)?|raise)',blurb:'Lifts the odometry pods off the floor (to climb or cross a barrier).'}),
    // ---- cameras and sensors
    T('camera-mount','sense','Camera pan or tilt','revolute',{states:{level:0,down:20},speed:180,motor:servo('gobilda-speed'),
      words:'camera ?(?:mount ?)?(?:pan|tilt|servo|gimbal|pivot)|pan ?-?tilt|gimbal|webcam ?(?:pan|tilt)|sensor ?(?:arm|flip|pivot)',blurb:'Points a camera or sensor.'}),
    // ---- robot arms, legs and machines
    T('base-yaw','robot','Base or waist (arm)','revolute',{axis:'up',states:{front:0,left:90,right:-90},lower:-170,upper:170,speed:90,find:'yaw',family:'turret',motor:motor('gobilda-5203-60'),
      words:'\\bwaist\\b|base ?(?:yaw|rotat(?:e|ion|or)|joint|turn(?:er)?)|swivel(?: ?base)?|rotary ?base',blurb:'The first joint of an articulated arm, turning it about the vertical.'}),
    T('scara','robot','SCARA joint','revolute',{axis:'up',states:{home:0,reach:90},speed:180,find:'yaw',motor:{kind:'stepper'},
      words:'\\bscara(?: ?(?:arm|joint|link))?\\b',blurb:'A pivot with an upright axis, as in a SCARA arm’s links.'}),
    T('gantry','robot','Gantry or linear stage','prismatic',{axis:'forward',states:{home:0,end:12},lower:0,upper:24,speed:10,family:'slide',motor:{kind:'stepper',transmission:[belt(20,20),spool(.5)]},
      words:'\\bgantry\\b|cartesian|linear ?(?:stage|axis)|\\b[xyz] ?-?axis\\b',blurb:'A carriage driven along a rail by a belt or screw (one axis of a Cartesian robot).'}),
    T('hip','robot','Hip (leg)','revolute',{states:{stand:0,step:30},speed:180,motor:servo('gobilda-torque'),words:'\\bhips?\\b|\\bthigh\\b|\\bfemur\\b|\\bcoxa\\b',blurb:'Swings a leg.'}),
    T('knee','robot','Knee (leg)','revolute',{states:{straight:0,bent:60},speed:180,motor:servo('gobilda-torque'),words:'\\bknees?\\b|\\bshin\\b|\\btibia\\b',blurb:'Bends a leg.'}),
    T('ankle','robot','Ankle or foot','revolute',{states:{flat:0,tilt:20},speed:180,piece:true,motor:servo('gobilda-torque'),words:'\\bankles?\\b|\\bfoot\\b|\\bfeet\\b|\\btarsus\\b',blurb:'Tilts a foot.'}),
    T('neck','robot','Head pan or tilt (neck)','revolute',{axis:'up',states:{center:0,left:45,right:-45},speed:180,find:'yaw',motor:servo('gobilda-speed'),words:'\\bneck\\b|head ?(?:pan|tilt|yaw|turn)',blurb:'Turns a robot’s head.'}),
    T('finger','robot','Finger (robot hand)','revolute',{states:{open:0,closed:80},speed:240,piece:true,family:'claw',motor:servo('gobilda-speed'),words:'\\bfingers?\\b|\\bthumb\\b|knuckle|phalan(?:x|ges)',blurb:'One finger of a hand or gripper.'}),
    T('steering','robot','Steering (car-like)','revolute',{axis:'up',states:{straight:0,left:25,right:-25},lower:-35,upper:35,speed:180,find:'yaw',motor:servo('gobilda-torque'),
      words:'ackermann|steer(?:ing)? ?(?:knuckle|arm|rack|link(?:age)?)|kingpin|\\bsteering\\b',blurb:'Turns the front wheels of a car-like robot.'}),
    T('piston','robot','Pneumatic piston','prismatic',{axis:'forward',states:{in:0,out:4},lower:0,upper:4,speed:40,family:'slide',motor:{kind:'pneumatic',response:'pneumatic'},
      words:'pneumatic|\\bpiston\\b|air ?cylinder',blurb:'An air cylinder that pushes out and pulls in, resting at its ends. FTC robots may not use pneumatics (R801).'}),
    T('spindle','robot','Spinning tool (spindle or drill)','continuous',{axis:'forward',rpm:1000,states:{stop:0,run:3600},speed:6000,motor:{kind:'bldc'},
      words:'\\bspindle\\b|\\bdrill\\b|screwdriver|grinder|polisher|sander',blurb:'A tool that spins at the end of an arm.'}),
    T('propeller','robot','Propeller or thruster','continuous',{axis:'up',rpm:5000,states:{stop:0,run:3600},speed:12000,motor:{kind:'bldc'},
      words:'propell?er|thruster|\\brotor\\b|impeller',blurb:'Spins to push air or water (drones, underwater robots).'}),
    // ---- from other FTC seasons, FRC and other robots (docs/MECHANISM_RESEARCH.md): grabbers, hoppers, sorters,
    // tape measures, forks, cappers, droppers, knockers, guides, shifters
    T('passive-gripper','intake','Passive gripper (wedge or snap)','revolute',{states:{open:0,closed:20},speed:720,family:'claw',piece:true,motor:servo('gobilda-speed'),
      words:'passive ?(?:grabber|gripper|claw|grip|intake|hook)|spring ?-?loaded ?(?:claw|grabber|gripper|jaw)s?|\\bwedge ?(?:grip(?:per)?|grabber|intake)\\b|snap ?-?(?:grabber|grip|claw)|(?:ring|peg|clip) ?(?:grabber|hook)',
      blurb:'Fingers or a wedge that a spring snaps shut when the piece pushes in; a servo or the drivers pull it off to let go.'}),
    T('suction-gripper','intake','Suction cup or magnet gripper','prismatic',{axis:'forward',states:{release:0,grip:0.25},lower:0,upper:0.5,speed:2,piece:true,motor:linear('actuonix-l16-50'),
      words:'suction(?: ?(?:cups?|gripper|pads?|grip))?|vacuum ?(?:cups?|gripper|pads?|grip)|\\bvac ?cups?|electro ?-?magnet|magnet(?:ic)? ?(?:gripper|grabber|pick ?-?up)',
      blurb:'Holds a flat piece with a magnet, or with vacuum where the rules allow it (FTC does not, R801); the short stroke is the cup or magnet pressing on.'}),
    T('goal-grabber','intake','Goal or foundation grabber (tow hooks)','revolute',{states:{up:0,down:90},lower:0,upper:120,speed:300,positive:'lower',piece:true,motor:servo('gobilda-torque'),
      words:'foundation ?(?:hooks?|grabbers?|clips?|movers?|latch(?:es)?|grips?|arms?)?|goal ?(?:grabbers?|hooks?|clamps?|latch(?:es)?|grippers?|clips?|tow(?:er)?)|\\btow ?(?:hooks?|arms?)|\\bmover\\b|\\bdragger\\b',
      blurb:'Hooks that drop onto a goal or foundation so the robot can drag it.'}),
    T('hopper','inside','Hopper or magazine (tilting)','revolute',{states:{load:0,feed:25},speed:180,positive:'raise',piece:true,motor:servo('gobilda-torque'),
      words:'\\bhopper\\b|\\bmagazine\\b|(?:ring|ball|particle|artifact|pollen) ?(?:storage|holder|stack(?:er)?)',
      blurb:'Holds a few pieces and tilts up to line them up with the shooter.'}),
    T('diverter','inside','Sorter flap or diverter','revolute',{states:{pass:0,divert:40},speed:600,piece:true,motor:servo('gobilda-speed'),
      words:'divert(?:er|or|ing)?|colou?r ?sort(?:er|ing)?|sort(?:ing|er)? ?(?:flap|gate|paddle|arm|door)|\\bsorter\\b|reject(?:or|er)|(?:gold|silver|mineral|sample|artifact) ?sort(?:er|ing)?',
      blurb:'A flap that sends a piece one way or the other, often by colour.'}),
    T('ramp','inside','Tilting ramp or chute','revolute',{states:{down:0,up:30},speed:240,piece:true,motor:servo('gobilda-speed'),
      words:'\\bramp\\b|\\bchute\\b',
      blurb:'A ramp that pieces roll along; when it moves, a servo tips it.'}),
    T('geneva-indexer','inside','Geneva or cam indexer','continuous',{axis:'up',states:{slot1:0,slot2:90,slot3:180,slot4:270},speed:180,find:'yaw',motor:motor('gobilda-5203-312'),
      words:'\\bgeneva(?: ?(?:wheel|drive|indexer|mech(?:anism)?))?\\b|\\bcam ?(?:indexer|follower|drive)\\b|indexing ?table|rotary ?table',
      blurb:'Turns in steps: each turn of the drive wheel moves the output one slot and holds it still between.'}),
    T('tape-measure','lift','Tape measure','prismatic',{axis:'forward',states:{in:0,out:30},lower:0,upper:60,speed:20,family:'slide',motor:motor('gobilda-5203-1150',spool(1.75)),
      words:'tape ?-?measure|measuring ?tape|\\btape ?(?:extension|extender|reach|hang|lift|spool|mech(?:anism)?)\\b|\\bsteel ?tape\\b',
      blurb:'A steel tape pushed out of its case for a long, light reach: parking, capping, or a hook to hang from.'}),
    T('forklift','lift','Forks or buddy lift','prismatic',{axis:'up',states:{down:0,carry:4,up:30},lower:0,upper:36,speed:8,family:'slide',motor:motor('gobilda-5203-117',spool(1.4)),
      words:'fork ?-?lift|lift ?forks?|\\bforks\\b|\\btines?\\b|buddy ?-?(?:lift|climb|ramp|carry)|partner ?(?:lift|ramp|carry)|cap ?-?ball ?(?:lift|forks?|grabber|arm)?|(?:lift|carry) ?(?:bed|platform)',
      blurb:'Tines on a lift that slide under something big and raise it: a cap ball, a goal, an alliance partner.'}),
    T('self-lift','endgame','Stilts (lifts its own robot)','prismatic',{axis:'up',states:{stowed:0,raised:4},lower:0,upper:8,speed:4,positive:'lower',family:'slide',motor:motor('gobilda-5203-435',spool(1.4)),
      words:'\\bstilts?\\b|self ?-?lift(?:ing)?|lift(?:ing)? ?legs?|climb(?:ing)? ?legs?|\\bjack(?:s|ing)?\\b(?! ?screw)',
      blurb:'Feet that push down on the floor to raise the robot.'}),
    T('flip-out-arm','arm','Fold-out arm','revolute',{states:{stowed:0,out:90},speed:360,piece:true,motor:servo('gobilda-speed'),
      words:'fold ?-?(?:out|away)(?: ?arm)?|flip ?-?out ?(?:arm|bar)|swing ?-?out(?: ?arm)?|\\bwings?\\b|outrigger|zip ?-?line ?(?:trigger|arm|hitter|flipper|release)?s?|climber ?release|(?:side|auto) ?(?:arm|flipper)s?|deploy(?:able|ing)? ?arm|amp ?(?:bar|arm)|gate ?(?:opener|pusher|bumper|hitter|arm)|lever ?(?:arm|pusher|hitter)|all ?-?clear ?(?:arm|signal|flag)?',
      blurb:'A small arm a servo swings out to hit a lever or a field element, then folds back.'}),
    T('knocker-arm','arm','Knocker arm (jewel or sample)','revolute',{states:{up:0,down:90},speed:300,positive:'lower',piece:true,motor:servo('gobilda-speed'),
      words:'jewel ?(?:arm|knocker|hitter|whacker|mech(?:anism)?)?|\\bknock(?:er|ing)?(?: ?(?:arm|off|stick))?\\b|\\bwhacker\\b|\\bbopper\\b|sampl(?:ing|er) ?arm|mineral ?(?:knocker|hitter)|kick ?-?stand ?(?:knocker|arm|hitter)|\\bhitter\\b',
      blurb:'Drops beside a piece, then a tip servo swings to knock it off.'}),
    T('sweeper-arm','arm','Sweeper arm or plow','revolute',{axis:'up',states:{stowed:0,sweep:90},lower:-10,upper:120,speed:480,find:'yaw',piece:true,motor:servo('gobilda-speed'),
      words:'sweep(?:er|ing)? ?(?:arm|stick|paddle)|(?:sample|floor|side|auto) ?sweep(?:er)?|\\bplow\\b|\\bplough\\b|push(?:er)? ?(?:arm|plate|plow)|\\bbulldozer\\b|pixel ?plow',
      blurb:'A long servo arm that swings flat to push pieces across the floor.'}),
    T('cone-righter','arm','Righting arm (stands a tipped piece up)','revolute',{states:{up:0,down:100},speed:300,positive:'lower',motor:servo('gobilda-torque'),
      words:'(?:cone|piece|sample) ?(?:right(?:er|ing)|uprighter|flipper)|righting ?(?:arm|mech(?:anism)?|roller|wheel)?|\\bupright(?:er|ing)\\b|tip ?-?up ?(?:arm|bar|roller)',
      blurb:'Swings down onto a tipped piece and rolls it back upright.'}),
    T('pole-guide','score','Pole or junction guide','revolute',{states:{stowed:0,guide:90},speed:360,positive:'lower',piece:true,motor:servo('gobilda-speed'),
      words:'(?:pole|junction|chamber|backdrop|rung|basket|cone) ?(?:guide|aligner|alignment|locator|finder|centering)s?|\\baligner\\b|alignment ?(?:bar|guide|arm|fork|tool)|guide ?(?:arm|flap|fork|paddle)',
      blurb:'A V-shaped guide that flips down over a pole or bar so the piece lines up as it scores.'}),
    T('capper','score','Capping arm (capstone, TSE, beacon)','revolute',{states:{stowed:0,cap:160},speed:240,positive:'raise',piece:true,motor:servo('gobilda-torque'),
      words:'capp(?:er|ing)(?: ?(?:arm|mech(?:anism)?|tool))?|cap ?stone(?: ?(?:arm|holder|dropper|placer|release|mech(?:anism)?))?|\\bcap ?(?:arm|placer|holder|grabber|mech(?:anism)?)\\b|\\btse(?: ?(?:arm|holder|grabber|capper))?\\b|shipping ?element ?(?:arm|holder|grabber)|beacon ?(?:holder|placer|capper|cap|grabber)',
      blurb:'Holds the team\'s cap and swings it up and over onto the top of the stack.'}),
    T('dropper','score','Dropper (marker, purple pixel, preload)','revolute',{states:{hold:0,drop:90},speed:480,piece:true,motor:servo('gobilda-speed'),
      words:'\\bdropper\\b|\\bdrop ?arm\\b|marker ?(?:dropper|deploy(?:er)?|arm|holder|release|drop)|team ?marker|purple ?(?:pixel ?)?(?:dropper|arm|holder|placer|release)?|climber ?(?:dumper|depositor|dropper|arm|bucket|box|deliver(?:y|er))|pre ?-?load ?(?:holder|dropper|release|arm)|spike ?mark ?(?:arm|dropper)?',
      blurb:'Holds a preloaded piece and lets it fall in autonomous.'}),
    T('button-pusher','score','Button or beacon pusher','prismatic',{states:{in:0,out:1.5},lower:0,upper:3,speed:6,family:'slide',motor:linear('actuonix-l16-50'),
      words:'beacon ?(?:pusher|presser|hitter|poker|arm|button)s?|button ?(?:pusher|presser|poker|hitter|arm|masher)s?|\\bpresser\\b|\\bpoker\\b',
      blurb:'Pokes out to press a button on a field element.'}),
    T('shooter-pivot','score','Pivoting shooter','revolute',{states:{low:20,high:55},lower:0,upper:75,speed:120,positive:'raise',motor:motor('gobilda-5203-117',belt(20,60)),
      words:'shooter ?(?:pivot|tilt|arm)|launcher ?(?:pivot|tilt)|pivot(?:ing)? ?(?:shooter|launcher)',
      blurb:'Tilts the whole shooter to change the launch angle (a hood tilts only the plate).'}),
    T('pto-shifter','drive','Shifter or power take-off','revolute',{states:{drive:0,engaged:25},speed:600,piece:true,motor:servo('gobilda-speed'),
      words:'\\bpto\\b|power ?take ?-?off|(?:gear|dog|range) ?shift(?:er)?|\\bshifter\\b|dog ?(?:gear|clutch)|\\bclutch\\b|two ?-?speed',
      blurb:'A servo slides a dog gear so one motor drives something else: the wheels to a hang, or a lift to a shooter.'}),
    T('drop-wheels','drive','Drop-down wheels (traction switch)','revolute',{states:{up:0,down:15},speed:360,positive:'lower',motor:servo('gobilda-torque'),
      words:'butterfly(?: ?(?:drive|module))?|octo ?-?canum|drop ?-?(?:down ?)?(?:omni|traction)(?: ?wheels?)?|drop ?-?down ?wheels?|traction ?(?:switch|drop|swap|deploy)|wheel ?(?:drop(?:per)?|lift(?:er)?|deploy)',
      blurb:'Wheels that a servo drops below the drive wheels to switch from mecanum to traction.'}),
    T('delta-arm','robot','Delta arm (parallel robot)','revolute',{states:{up:0,down:60},lower:-20,upper:90,speed:360,motor:servo('gobilda-torque'),
      words:'\\bdelta(?: ?(?:arm|robot|link|leg|parallel))?\\b|parallel ?(?:robot|manipulator)|\\bkossel\\b',
      blurb:'One of the three driven arms of a delta robot; the forearms meet at the tool plate.'}),
    T('stewart-leg','robot','Stewart platform leg','prismatic',{axis:'up',states:{short:0,long:2},lower:0,upper:4,speed:2,family:'slide',motor:linear('actuonix-l16-50'),
      words:'stewart(?: ?-?gough)?(?: ?(?:platform|legs?|struts?|actuators?))?|\\bgough\\b|six ?-?dof ?platform',
      blurb:'One of six legs that change length to move and tilt the top plate.'}),
    // ---- your own
    T('custom-pivot','custom','Your own pivot','revolute',{states:{up:0,down:45},speed:90,piece:true,family:'custom-pivot',blurb:'Anything that swings between two positions on a servo or motor: a flap, a latch, a lever. You pick its parts on the model.'}),
    T('custom-slide','custom','Your own slide','prismatic',{axis:'forward',states:{in:0,out:6},lower:0,upper:12,speed:10,family:'custom-slide',blurb:'Anything that moves in and out along a rail or slide. You pick its parts on the model and how far it travels.'}),
    T('custom-spin','custom','Your own spinner','continuous',{states:{stop:0,run:1800},speed:600,family:'custom-spin',blurb:'Anything that keeps spinning on an axle: a wheel, a roller, a fan. You pick its parts on the model and its speed.'})];
  const TYPES=Object.fromEntries(LIST.map(t=>[t.id,t]));
  for(const t of LIST)if(t.words)t.re=new RegExp(t.words,'gi');
  // ---------------------------------------------------------------- reading a CAD name
  // Vendor catalogue parts ("48mm Gecko Wheel - 15A (GB)", "3614 Series Rhino Wheel (14mm Bore…)") are pieces of a
  // mechanism, not mechanisms; the team names its own assemblies.
  const VENDOR=/\b\d{4}-\d{2,4}\b|\((?:GB|AXON|SWYFT|ELC|REV|AM)\)|\bREX\b|\bbore\b|durometer|\b\d+(?:\.\d+)?\s?mm\b|\bseries\b|\bv\d+:\d+|__body|\bkit\b|\bpack\b/i;
  // Hardware named for the mechanism it belongs to ("Arm motor mount", "Claw servo", "4BAR HEX", "Turret gear") is a
  // piece of it, as is a servo's own arm ("Servo arm").
  const HARDWARE=/^[\s\-_:()]*(?:motors?|servos?|gear(?:box|s)?|pinions?|pulleys?|sprockets?|bearings?|bushings?|brackets?|mounts?|mounting|plates?|bars?\b|screws?|bolts?|nuts?|spacers?|standoffs?|shafts?|axles?|hex|channels?|extrusions?|tubes?|tubing|belts?|chains?|encoders?|sensors?|hubs?|horns?|cables?|wires?|strings?|springs?|blocks?|pins?|collars?|links?\b|inserts?|covers?|guards?|stops?\b|washers?|rods?\b|rails?\b|stages?\b|spools?\b|pads?\b|tips?\b|tensioners?|clips?\b|boxes?\b|wheels?\b|drives?\b|transmissions?|gearing|pivots?\b|hinges?\b)/i;
  const BEFORE=/(?:servo|motor)\s*$/i;
  const tidy=name=>String(name||'').replace(/\s*<\d+>$/,'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ').replace(/\s+/g,' ').trim();
  // The type a CAD name says, or null. The name's last mechanism word wins ("Intake slides" is a slide, "Claw wrist" a
  // wrist), a longer phrase over a shorter one ending at the same place ("Intake arm" is a drop-down intake, not an
  // arm). Vendor parts and hardware named after a mechanism say nothing. Returns {id, word}.
  function detect(name,{vendor=false}={}){
    const text=tidy(name);if(!text||!vendor&&VENDOR.test(String(name||'')))return null;let best=null;
    for(const t of LIST){if(!t.re)continue;t.re.lastIndex=0;for(const m of text.matchAll(t.re)){const word=m[0].trim();if(!word)continue;const end=m.index+m[0].length;
      if(HARDWARE.test(text.slice(end))||BEFORE.test(text.slice(0,m.index)))continue;const score=end*1000+word.length;if(!best||score>best.score)best={id:t.id,word,score};}}
    return best&&{id:best.id,word:best.word};
  }
  // The type of a joint: the one it was given, else one its game signal stands for.
  const BY_SIGNAL={turret:'turret',hood:'hood',flywheel:'flywheel',roller:'roller-intake',deploy:'deploy-intake',feeder:'feeder',wheel:'drive-wheel',steer:'swerve-steer'};
  function of(j){if(j?.kind&&TYPES[j.kind])return TYPES[j.kind];const s=j?.drive?.signal;return s&&BY_SIGNAL[s]?TYPES[BY_SIGNAL[s]]:null;}
  // ---------------------------------------------------------------- a joint of a type
  // The robot directions as CAD directions: rows are the CAD's forward, left and up (DeckRobotModel.rows).
  function direction(t,rows){const [F,L,U]=rows||[[1,0,0],[0,1,0],[0,0,1]];return (t.axis==='up'?U:t.axis==='forward'?F:L).slice();}
  // The settings a type gives a joint: how it moves, its positions and speed. Spinning parts follow the game's signal
  // when `bind` names one (the game's mechanisms are on); otherwise route actions move them, like every other type.
  function settings(id,{bind=null}={}){
    const t=TYPES[id]||TYPES['custom-pivot'],out={kind:t.id,type:t.joint,states:{...(t.states||{})},speed:t.speed??90};
    if(Number.isFinite(t.lower))out.lower=t.lower;if(Number.isFinite(t.upper))out.upper=t.upper;if(Number.isFinite(t.rpm))out.rpm=t.rpm;
    if(t.signal==='wheel')out.drive={signal:'wheel'};else if(bind)out.drive=bind;else out.drive={signal:'action'};
    if(out.drive.signal!=='action'){delete out.states;delete out.speed;}
    return out;
  }
  // A joint of a type with the given geometry; the rest from the type.
  function joint(id,{id:jid,name,origin=[0,0,0],axis,rows,parts=[],parent=null,bind=null,...rest}={}){
    const t=TYPES[id]||TYPES['custom-pivot'];return {id:jid,name:name||t.name,...settings(t.id,{bind}),parent,parts,origin,axis:axis||direction(t,rows),source:'user',...rest};
  }
  // Another type for a joint the team already has: its geometry (parts, pivot, parent) stays; how it moves, its
  // positions and speed come from the new type. A slide stays a slide's direction; a pivot keeps its axis.
  function retype(j,id,{rows,bind=null}={}){
    const t=TYPES[id];if(!t||j.kind===id)return j;const fresh=settings(id,{bind}),next={...j,...fresh};
    for(const k of ['lower','upper','rpm','launch','zero','roll','states','speed'])if(!(k in fresh))delete next[k];
    if(!j.parts?.length&&rows)next.axis=direction(t,rows);
    return next;
  }
  // The motor a type is usually driven by, for "Add its motor": its kind, gearing and how it moves.
  function motorFor(id){const m=TYPES[id]?.motor;if(!m)return {kind:'dcmotor'};return {kind:m.kind,...(m.model?{model:m.model}:{}),...(m.transmission?{transmission:m.transmission.map(s=>({...s}))}:{}),...(m.response?{response:m.response}:{})};}
  const grouped=()=>GROUPS.map(([id,name])=>({id,name,types:LIST.filter(t=>t.group===id)}));
  // A new part's name, for route actions ("Lift up", "Claw open", "Hood shoot"): what teams call it, else the type's
  // first words.
  const SHORT={'linear-slide':'Extendo',dr4b:'DR4B','four-bar':'Four-bar',v4b:'V4B',flywheel:'Flywheel',hood:'Hood','drone-launcher':'Launcher',feeder:'Feeder',
    'goal-grabber':'Goal grabber',ramp:'Ramp','geneva-indexer':'Indexer','pole-guide':'Pole guide','button-pusher':'Button pusher','base-yaw':'Waist',neck:'Neck','camera-mount':'Camera mount',
    spindle:'Spindle','suction-gripper':'Suction gripper','self-lift':'Stilts','odo-retract':'Odometry lift'};
  const short=t=>t.group==='custom'?'Moving part':SHORT[t.id]||t.name.split(/,| or |\s\(/)[0].trim();
  // Whether a name already says the type ("Hood · shooter 1" is a hood), so the panel need not.
  const says=(t,name)=>!!t&&(tidy(name).toLowerCase().includes(short(t).toLowerCase())||!!t.words&&new RegExp(t.words,'i').test(tidy(name)));
  // ---------------------------------------------------------------- a mechanism the team added, in a CAD
  // How much a CAD assembly's name sounds like a mechanism the team added ({kind, name}): 0 for nothing alike, about 1
  // for a likely match, 3 or more for its type's own words and its name. The name's mechanism word (detect) counts most:
  // the type itself, then one of its family ("Viper slides" for a Lift); a name that says another mechanism counts
  // against it. Then the words of the team's own name ("Extendo", "Left claw"), allowing plurals and one typo, and the
  // type's words anywhere in the name. Vendor parts and hardware named for it ("Lift motor") are pieces, not it.
  const FILLER=new Set(['assembly','assy','asm','sub','subassembly','final','new','copy','part','mech','mechanism','system','the','of','and','for','with','robot','main','v','mk','rev','version','gobilda','default']);
  const wordsOf=s=>tidy(s).toLowerCase().split(/[^a-z0-9]+/).filter(w=>w&&!FILLER.has(w)&&!/^\d+$/.test(w)&&!/^v\d+$/.test(w));
  // One typo (a letter changed, added, dropped or two swapped), or a plural or a longer form of the same word.
  function alike(a,b){if(a===b)return true;if(Math.min(a.length,b.length)>=4&&(a.startsWith(b)||b.startsWith(a))&&Math.abs(a.length-b.length)<=3)return true;
    if(Math.min(a.length,b.length)<5||Math.abs(a.length-b.length)>1)return false;let i=0;while(i<a.length&&a[i]===b[i])i++;
    return a.slice(i+1)===b.slice(i+1)||a.slice(i+1)===b.slice(i)||a.slice(i)===b.slice(i+1)||a[i]===b[i+1]&&a[i+1]===b[i]&&a.slice(i+2)===b.slice(i+2);}
  function likeness({kind,name}={},cadName){
    const t=TYPES[kind],text=tidy(cadName);if(!t||!text||VENDOR.test(String(cadName||'')))return 0;
    const said=detect(cadName),mine=wordsOf(name),theirs=wordsOf(cadName),words=()=>{if(!t.re)return false;t.re.lastIndex=0;const hit=t.re.test(text);t.re.lastIndex=0;return hit;};let s=0;
    // Another type's name counts against it, unless the name also has this type's own word ("Intake claw" for a claw).
    if(said)s+=said.id===kind?2:TYPES[said.id].family===t.family?1.25:words()?0:-1;
    if(mine.length&&theirs.length){let last=-1,hits=0;theirs.forEach((w,i)=>{if(mine.some(x=>alike(x,w))){hits++;last=i;}});
      if(hits){s+=1.25*hits/Math.max(mine.length,theirs.length)+(hits>=mine.length?.5:0);
        // "Lift motor", "Claw servo mount": hardware right after the team's name.
        if(!said&&HARDWARE.test(theirs.slice(last+1).join(' ')))s-=1.5;}}
    if(words())s+=.5;
    return +s.toFixed(3);
  }
  return {GROUPS,LIST,TYPES,detect,tidy,of,settings,joint,retype,motorFor,direction,grouped,short,says,likeness,alike,VENDOR,HARDWARE};
});
