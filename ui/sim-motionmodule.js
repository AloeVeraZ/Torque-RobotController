(function(root,factory){const node=typeof module==='object'&&module.exports,value=factory(node?require('./sim-timed.js'):root.DeckTimed,node?require('./sim-export.js'):root.DeckSimExport,node?require('./sim-mechanisms.js'):root.DeckMechanisms);if(node)module.exports=value;else root.DeckSimMotionModule=value;})(typeof globalThis==='object'?globalThis:this,(Timed,Export,Mech)=>{
  'use strict';
  // MotionModule export: an autonomous.py for MotionModule's runtime (create_autonomous(module, drive)
  // returning an object with run(stop)). The route becomes the timed plan the simulator runs for
  // IMU-only setups: drive steps by power and time with IMU heading hold, IMU-settled turns, holds.
  // It follows MotionModule's own Mecanum autonomous example: its heading controllers, its confirmed
  // mixer (MecanumTestDrive) and IMU_TO_MIXER_SIGN = -1 for the reference robot.
  const DEG=180/Math.PI,wrap=d=>((d+180)%360+360)%360-180;
  const num=v=>{const s=String(Number(Number(v).toFixed(4)));return /[.e]/.test(s)?s:s+'.0';};
  const pyString=s=>JSON.stringify(String(s));
  // Text inside a docstring: backslashes doubled (C:\New would be a \N escape) and no closing triple quotes.
  const doc=s=>String(s).replace(/"""/g,'').replace(/\\/g,'\\\\');
  // The timed plan as MotionModule PLAN steps. Forward/strafe are fractions of DRIVE_SPEED; strafe is
  // positive to the right (MotionModule's convention); turns are degrees left of the start heading.
  // The Python call that runs a built-in action (the Mechanisms settings), or '' for the team's own.
  // The app loads this file before sim-mechanisms.js, so the mechanisms module is looked up when it is needed.
  const Mechs=()=>Mech||globalThis.DeckMechanisms;
  function builtIn(name,mech){if(/^\s*wait\s*$/i.test(String(name||'')))return 'step.last or step.duration <= 0';const M=Mechs(),k=mech&&M?M.action(name):null;if(!k)return '';const shooter=mech.shooter.type!=='none';
    if(k.kind==='intake'||shooter&&['spin','aim','shoot'].includes(k.kind))return `MECHANISMS.run(${pyString(k.kind)}, ${k.count||0}, step)`;
    if(k.kind==='ramp'&&mech.intakes.some(i=>i.kind==='ramp'))return `MECHANISMS.run("ramp", ${k.down?1:0}, step)`;
    if(k.kind==='turret'&&mech.shooters.some(s=>s.type==='turret')){const own=mech.shooters.map(s=>s.type==='turret'&&!s.sharesTurret),place=k.turret===null?null:own[k.turret]?own.slice(0,k.turret).filter(Boolean).length:-1;
      return place===-1?'':`MECHANISMS.run("turret", (${place===null?'None':place}, ${num(k.degrees)}), step)`;}
    return '';}
  function plan(route,timing,options={}){
    const compiled=Timed.compile(route,timing),start=route.heading||0,power=compiled.config.power,steps=[],aims={},movingSeconds={},aimAt=aimer(route,options.mechanisms,options.target,options.robot);let target=start/DEG,lastPower=null;
    for(const s of compiled.steps){
      if(s.kind==='disabled'){steps.push(['disabled']);break;}
      const stepPower=s.power??power;if(stepPower!==lastPower){steps.push(['power',stepPower]);lastPower=stepPower;}
      const divisor=Math.max(.000001,stepPower);
      // Turning while driving: each piece holds a field direction (from the IMU heading) while the
      // heading hold turns toward that piece's share of the turn, so a lagging turn does not steer it off.
      if(s.kind!=='turn'&&(s.forward||s.strafe)&&Number.isFinite(s.mid)){const fs=compiled.config.forwardSpeed,ss=compiled.config.strafeSpeed,vf=s.forward*fs,vl=s.strafe*ss,c=Math.cos(s.mid-start/DEG),n=Math.sin(s.mid-start/DEG);
        if(s.moving){const a=aimAt(s.segment,s.heading,s.movingCell);if(a!==undefined)aims[steps.length]=a;if(s.movingSeconds>0)movingSeconds[steps.length]=s.movingSeconds;}steps.push(['glide',+((vf*c-vl*n)/(fs*divisor)).toFixed(4),+((vf*n+vl*c)/(fs*divisor)).toFixed(4),+s.seconds.toFixed(3),+wrap(s.heading*DEG-start).toFixed(2),...(s.moving?[s.moving]:[])]);target=s.heading;continue;}
      if(s.kind!=='turn'&&(s.forward||s.strafe)&&Number.isFinite(s.heading)&&Math.abs(wrap((s.heading-target)*DEG))>1e-6){steps.push(['aim',+wrap(s.heading*DEG-start).toFixed(2)]);target=s.heading;}
      if(s.kind==='turn'){steps.push(['turn',+wrap(s.heading*DEG-start).toFixed(2)]);target=s.heading;}
      else if(!s.forward&&!s.strafe)steps.push(s.action?['action',s.action,+s.seconds.toFixed(3)]:['hold',+s.seconds.toFixed(3)]);
      else steps.push(['drive',+(s.forward/divisor).toFixed(4),+(-s.strafe/divisor).toFixed(4),+s.seconds.toFixed(3),...(s.moving?[s.moving]:[])]);
      if(s.moving&&s.movingSeconds>0)movingSeconds[steps.length-1]=s.movingSeconds;
      const last=steps.at(-1);if(!((steps.length-1) in aims)&&(last[0]==='action'||last[0]==='drive'&&last[4])){const a=aimAt(s.segment,Number.isFinite(s.heading)?s.heading:target,s.cell||s.movingCell);if(a!==undefined)aims[steps.length-1]=a;}
    }
    return {steps,power,config:compiled.config,aims,movingSeconds};
  }
  function autonomous(route,timing,options={}){
    const mech=options.mechanisms?.enabled?options.mechanisms:null,p=plan(route,timing,{mechanisms:mech,target:options.target,robot:options.robot}),name=doc(options.name||'Planned route');
    const steps=p.steps.map(s=>s[0]==='power'?`    ("power", ${num(s[1])}),`:s[0]==='disabled'?`    ("disabled",),`:s[0]==='drive'?`    ("drive", ${num(s[1])}, ${num(s[2])}, ${num(s[3])}${s[4]?`, ${pyString(s[4])}`:''}),`:s[0]==='turn'?`    ("turn", ${num(s[1])}),`:s[0]==='action'?`    ("action", ${pyString(s[1])}, ${num(s[2])}),`:s[0]==='aim'?`    ("aim", ${num(s[1])}),`:s[0]==='glide'?`    ("glide", ${num(s[1])}, ${num(s[2])}, ${num(s[3])}, ${num(s[4])}${s[5]?`, ${pyString(s[5])}`:''}),`:`    ("hold", ${num(s[1])}),`).join('\n'),list=Export.actions(route);
    return `"""${name}: autonomous exported by Deck Driver Station.

MotionModule calls create_autonomous(module, drive) once, then run(stop) each
time autonomous starts. Line the robot up on the planned starting pose first:
every turn in PLAN counts from the heading the robot faces when it is enabled.

The robot has no wheel encoders, so each drive step runs for a set time at a set
power while the IMU holds the heading. Calibrate "Forward/Strafe at full power"
in the simulator's Timed driving settings on your robot; slip, bumps and a
different battery change how far each step goes. There is no X/Y correction.

Steps:
  ("drive", forward, strafe, seconds)  forward/strafe are fractions of DRIVE_SPEED,
                                       strafe positive to the right
  ("turn", degrees)                    face this many degrees left of the start
  ("hold", seconds)                    stay put, correcting the heading
  ("action", name, seconds)            stay put and run an action (see below)
  ("aim", degrees)                     hold this heading (left of the start) from
                                       the next drive step on
  ("glide", x, y, seconds, degrees)    turning while driving: move along x/y (start
                                       frame, fractions of DRIVE_SPEED at forward
                                       speed) whatever the heading, while turning
                                       toward degrees left of the start
  A 5th drive value names the action run while driving (an action path).

Actions (intake, shooter...) are your code, in robot_actions.py next to this
file: the simulator export creates it once and never overwrites it. Each action
is called every loop while it runs and returns True when finished. At a pin the
robot pauses first, then runs the action: for its set time (step.duration; the
last call has step.last set), or until it returns True when no time is set. An
action path's action starts with the path and runs for its set time or until
the path ends, then gets one last call with step.last set so it can stop its
mechanism.
"""

import importlib.util
import math
import os
import time
from types import SimpleNamespace

from motion_module.heading import HeadingController, Settle, TurnPID, wrap180

PLAN = [
${steps}
]

# Each action named in the simulator, and the function it calls in robot_actions.py.
# Seconds each action path runs its action from the start of its path (PLAN index; missing: the whole path).
MOVING_SECONDS = {${Object.entries(p.movingSeconds).map(([k,v])=>`${k}: ${num(v)}`).join(', ')}}
# Turret angle (degrees left of the robot's front) for action steps, from the planned pose there
# (one per turret when two turrets aim from their own spots).
AIMS = {${Object.entries(p.aims).map(([k,v])=>`${k}: ${Array.isArray(v)?`(${v.map(num).join(', ')})`:num(v)}`).join(', ')}}

ACTIONS = {
${list.flatMap(a=>(a.names||[a.name]).map(name=>`    ${pyString(name)}: ${pyString(a.py)},  # ${a.uses.map(u=>Export.where(u)).join('; ').replace(/[\r\n]/g,' ')}`)).join('\n')}
}


def load_actions():
    """robot_actions.py next to this file, or None when it is missing."""
    here = globals().get("__file__")
    path = os.path.join(os.path.dirname(os.path.abspath(here)), "robot_actions.py") if here else None
    if not path or not os.path.exists(path):
        return None
    spec = importlib.util.spec_from_file_location("robot_actions", path)
    actions = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(actions)
    return actions

${list.map(a=>{const built=builtIn(a.name,mech);return built?`
def ${a.py}(step):
    """"${doc(a.name.replace(/"/g,"'"))}": run by the Mechanisms settings."""
    return ${built}
`:`
def ${a.py}(step):
    """Placeholder for "${doc(a.name.replace(/"/g,"'"))}" until robot_actions.py defines ${a.py}(step)."""
    return True
`;}).join('')}
# Actions the simulator's Mechanisms settings run; robot_actions.py cannot replace them.
BUILT_IN = {${list.filter(a=>builtIn(a.name,mech)).map(a=>pyString(a.py)).join(', ')}}
# Pins and paths with several steps, by the name the route runs them under: (together while driving, or one after
# another at the pin; each step's name and seconds, 0 for until it returns True, or the whole path while driving).
STEPS = {${Export.sequences(route).map(q=>`\n    ${pyString(q.name)}: (${q.together?'True':'False'}, (${q.steps.map(x=>`(${pyString(x.action)}, ${num(x.seconds||0)})`).join(', ')},)),`).join('')}${Export.sequences(route).length?'\n':''}}
MECHANISMS = None
${mech?mechanismsPython(mech):''}
# The reference robot's confirmed mixer turns clockwise for positive rotation,
# so heading feedback is converted to that convention here (as in MotionModule's
# Mecanum autonomous example).
IMU_TO_MIXER_SIGN = -1.0


class PlannedRoute:
    duration_seconds = ${num(Math.max(30,Math.ceil((p.steps.reduce((t,s)=>t+({turn:3,drive:s[3],hold:s[1],action:s[2]+5}[s[0]]||0),0))+5)))}

    DRIVE_SPEED = ${num(p.power)}       # wheel power limit while driving a step
    TURN_SPEED = 1.0          # actual motor power, not a multiplier
    APPROACH_SPEED = 0.6      # maximum power near each target
    CORRECTION_SPEED = 0.28   # lower power cap after overshoot, in either direction
    APPROACH_DEGREES = 25
    APPROACH_RATE = 200       # degrees/second at the start of the approach
    FINAL_APPROACH_RATE = 80  # taper to this as the remaining angle shrinks
    CORRECTION_RATE = 12.0    # stay this slow after overshoot, even if undershooting
    TURN_TIMEOUT = 20.0
    LOOP_SECONDS = 0.02       # 50 updates a second
    IMU_READY_TIMEOUT = 5.0
    HEADING_GAIN = ${num(p.config.headingP)}  # heading hold while driving, per radian of error
    STRAFE_RATIO = ${num(p.config.forwardSpeed/p.config.strafeSpeed)}  # forward speed / strafe speed at the same power

    def __init__(self, module, drive):
        self.module = module
        self.drive = drive
        self.sensors = getattr(drive, "sensors", None)
        self.heading = getattr(drive, "heading", None) or HeadingController()
        self.turn_heading = TurnPID(kp=0.065, kd=0.0035, derivative_seconds=0.01, max_power=self.TURN_SPEED,
                                    integral_power_limit=self.APPROACH_SPEED, settle_seconds=0.2)
        self.raw_move = getattr(drive, "move", drive.drive)
        self.target = 0.0
        self.start = 0.0
        self.progress = {"steps": len(PLAN), "step": None}
        self.actions = load_actions()
        self.moving = None  # the action path action running now
        self.moving_seconds = 0.0  # its set time from the start of its path (0: the whole path)
        self.aim = None  # turret angle for the action starting now (AIMS)
        global MECHANISMS
        MECHANISMS = ${mech?'Mechanisms(module)':'None'}
        setup = getattr(self.actions, "setup", None)
        if callable(setup):
            setup(module)

    def move(self, forward, strafe, rotate, speed=1.0):
        # Match the path ceiling for every mixed motor, including turn/heading correction.
        peak = abs(forward) + abs(strafe) + abs(rotate)
        factor = max(0.0, speed) / max(1.0, peak * max(0.0, speed) / max(0.000001, self.DRIVE_SPEED))
        self.raw_move(forward * factor, strafe * factor, rotate * factor, speed=1.0)

    def ready(self):
        return self.sensors is not None and self.sensors.heading() is not None

    def call_action(self, name, step):
        """One call of an action: robot_actions.py's function, else the placeholder. True when finished."""
        if name in STEPS:
            return self.call_steps(name, step)
        slot = ACTIONS.get(name)
        if not slot:
            return True
        function = globals()[slot] if slot in BUILT_IN else getattr(self.actions, slot, None) or globals()[slot]
        self.progress = {**self.progress, "action": name}
        return bool(function(step))

    def call_steps(self, name, step):
        """One call of a list of steps: at a pin one after another, while driving together. True when all are done."""
        together, parts = STEPS[name]
        if step.first or getattr(step, "steps", None) is None:
            step.steps = {"at": 0, "started": [None] * len(parts), "done": [False] * len(parts)}
        state = step.steps

        def one(i, elapsed, first):
            part, seconds = parts[i]
            over = seconds > 0 and elapsed >= seconds
            sub = SimpleNamespace(**{k: v for k, v in vars(step).items() if k != "steps"})
            sub.elapsed, sub.first, sub.last, sub.duration = elapsed, first, over or step.last, seconds
            return self.call_action(part, sub) or over

        if together:
            for i in range(len(parts)):
                if not state["done"][i]:
                    state["done"][i] = one(i, step.elapsed, step.first)
            return all(state["done"])
        while state["at"] < len(parts):
            i = state["at"]
            first = state["started"][i] is None
            if first:
                state["started"][i] = step.elapsed
            if not one(i, step.elapsed - state["started"][i], first):
                return False
            state["at"] += 1
        return True

    def drive_for(self, forward, strafe, seconds, stop, moving=None, coast=False):
        """Drive at a set power for a set time while holding the heading (running an action path's action).
        coast: the next step drives on, so the motors are not stopped in between."""
        if moving and (self.moving is None or self.moving["name"] != moving):
            self.moving = {"name": moving, "started": time.monotonic(), "done": False, "seconds": self.moving_seconds,
                           "step": SimpleNamespace(elapsed=0.0, first=True, last=False, moving=True, module=self.module, wait=0.0, duration=self.moving_seconds, aim=self.aim)}
        travelled, last = 0.0, time.monotonic()
        while travelled < seconds:
            if stop.is_set():
                return False
            heading = self.sensors.heading()
            if heading is None:
                return False
            if moving and not self.moving["done"]:
                step = self.moving["step"]
                step.elapsed = time.monotonic() - self.moving["started"]
                # A set time ends the action partway along the path; its last call stops it.
                step.last = self.moving["seconds"] > 0 and step.elapsed >= self.moving["seconds"]
                self.moving["done"] = self.call_action(moving, step) or step.last
                step.first = False
            error = math.radians(wrap180(self.target - heading))
            turn = max(-0.5, min(0.5, error * self.HEADING_GAIN))
            share = 1.0 / max(1.0, abs(forward) + abs(strafe) + abs(turn) / max(0.000001, self.DRIVE_SPEED))
            self.move(forward, strafe, turn / self.DRIVE_SPEED, speed=self.DRIVE_SPEED)
            time.sleep(max(0.0, min(self.LOOP_SECONDS, (seconds - travelled) / share)))
            now = time.monotonic()
            travelled += (now - last) * share
            last = now
        if not coast:
            self.drive.stop()
        return True

    def glide(self, x, y, seconds, aim, stop, moving=None, coast=False):
        """Turning while driving: hold a direction on the field from the IMU heading, turning toward aim.
        The mixer shares wheel power between turning and driving, so the step counts only the share of
        its time that went into driving: it lasts until the planned travel is done."""
        self.target = wrap180(self.start + aim)
        if moving and (self.moving is None or self.moving["name"] != moving):
            self.moving = {"name": moving, "started": time.monotonic(), "done": False, "seconds": self.moving_seconds,
                           "step": SimpleNamespace(elapsed=0.0, first=True, last=False, moving=True, module=self.module, wait=0.0, duration=self.moving_seconds, aim=self.aim)}
        travelled, last, share = 0.0, time.monotonic(), 1.0
        while travelled < seconds:
            if stop.is_set():
                return False
            heading = self.sensors.heading()
            if heading is None:
                return False
            if moving and not self.moving["done"]:
                step = self.moving["step"]
                step.elapsed = time.monotonic() - self.moving["started"]
                # A set time ends the action partway along the path; its last call stops it.
                step.last = self.moving["seconds"] > 0 and step.elapsed >= self.moving["seconds"]
                self.moving["done"] = self.call_action(moving, step) or step.last
                step.first = False
            h = math.radians(wrap180(heading - self.start))
            forward = x * math.cos(h) + y * math.sin(h)
            left = (-x * math.sin(h) + y * math.cos(h)) * self.STRAFE_RATIO
            scale = max(1.0, abs(forward), abs(left))
            error = math.radians(wrap180(self.target - heading))
            turn = max(-0.5, min(0.5, error * self.HEADING_GAIN))
            rotate = max(-1.0, min(1.0, turn / self.DRIVE_SPEED))
            drive = abs(forward / scale) + abs(left / scale)
            share = max(1.0, drive) / max(1.0, drive + abs(rotate))
            self.move(forward / scale, -left / scale, rotate, speed=self.DRIVE_SPEED)
            time.sleep(max(0.0, min(self.LOOP_SECONDS, (seconds - travelled) / share)))
            now = time.monotonic()
            travelled += (now - last) * share
            last = now
        if not coast:
            self.drive.stop()
        return True

    def end_moving(self):
        """The action path is over: one last call so its action can stop the mechanism."""
        if self.moving and not self.moving["done"]:
            step = self.moving["step"]
            step.elapsed = time.monotonic() - self.moving["started"]
            step.last = True
            self.call_action(self.moving["name"], step)
        self.moving = None

    def act(self, name, seconds, stop):
        """Stay put running an action: for seconds (its last call stops it), or until it finishes when 0."""
        started = time.monotonic()
        step = SimpleNamespace(elapsed=0.0, first=True, last=False, moving=False, module=self.module, wait=0.0, duration=seconds, aim=self.aim)
        while True:
            if stop.is_set():
                return False
            heading = self.sensors.heading()
            if heading is None:
                return False
            step.elapsed = time.monotonic() - started
            step.last = seconds > 0 and step.elapsed >= seconds
            done = self.call_action(name, step) or step.last
            step.first = False
            if done:
                break
            rate = getattr(self.sensors, "rate", None)
            turn = self.heading.power(self.target, heading, rate() if callable(rate) else None, in_place=True)
            self.move(0, 0, turn, speed=1.0)
            time.sleep(self.LOOP_SECONDS)
        self.drive.stop()
        return True

    def turn_to(self, target, stop):
        """Turn in place, correcting in either direction until stable within tolerance.
        The approach and overshoot correction follow MotionModule's Mecanum autonomous example."""
        self.target = wrap180(target)
        self.turn_heading.reset()
        settle = Settle(self.turn_heading)
        approaching = overshot = False
        approach_rate = self.APPROACH_RATE
        direction = previous_error = None
        deadline = time.monotonic() + self.TURN_TIMEOUT
        try:
            while time.monotonic() < deadline:
                if stop.is_set():
                    return False
                heading = self.sensors.heading()
                if heading is None or not math.isfinite(heading):
                    raise RuntimeError("IMU heading lost; autonomous stopped")
                now = time.monotonic()
                error = wrap180(self.target - heading)
                if direction is None:
                    direction = 1 if error >= 0 else -1
                crossed = (previous_error is not None
                           and previous_error * direction > 0 >= error * direction
                           and abs(error - previous_error) < 180)
                overshot = overshot or crossed
                previous_error = error
                approaching = approaching or abs(error) <= self.APPROACH_DEGREES
                limit = self.APPROACH_SPEED if approaching else self.TURN_SPEED
                rate_limit = None
                if approaching:
                    fraction = max(0.0, min(1.0, (abs(error) - self.turn_heading.tolerance)
                                            / (self.APPROACH_DEGREES - self.turn_heading.tolerance)))
                    approach_rate = min(approach_rate, self.FINAL_APPROACH_RATE
                                        + (self.APPROACH_RATE - self.FINAL_APPROACH_RATE) * fraction)
                    rate_limit = approach_rate
                if overshot:
                    limit = min(limit, self.CORRECTION_SPEED)
                    rate_limit = self.CORRECTION_RATE
                turn = self.turn_heading.update(self.target, heading, now, limit=limit, rate_limit=rate_limit)
                still = abs(self.turn_heading.rate) <= self.turn_heading.STOPPED_DPS
                if not still:
                    settle = Settle(self.turn_heading)
                on_target = abs(error) <= self.turn_heading.tolerance
                self.progress = {**self.progress, "target": round(self.target, 1), "heading": round(heading, 1), "error": round(error, 1),
                                 "turn_phase": "settling" if still and on_target else "correction" if overshot else "approach" if approaching else "cruise"}
                if still and settle.update(self.target, heading, now):
                    return True
                self.move(0, 0, turn, speed=1.0)
                time.sleep(self.LOOP_SECONDS)
            raise RuntimeError(f"Turn to {self.target:.1f} degrees did not settle in {self.TURN_TIMEOUT:g} s")
        finally:
            self.drive.stop()

    def hold(self, seconds, stop):
        """Stay still, nudging the heading back if the robot was bumped."""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if stop.is_set():
                return False
            heading = self.sensors.heading()
            if heading is None:
                return False
            rate = getattr(self.sensors, "rate", None)
            turn = self.heading.power(self.target, heading, rate() if callable(rate) else None, in_place=True)
            self.move(0, 0, turn, speed=1.0)
            time.sleep(self.LOOP_SECONDS)
        self.drive.stop()
        return True

    def run(self, stop):
        try:
            deadline = time.monotonic() + self.IMU_READY_TIMEOUT
            while not self.ready():
                if stop.is_set():
                    return
                if time.monotonic() >= deadline:
                    raise RuntimeError("Built-in IMU is not ready; autonomous stayed stopped.")
                stop.wait(self.LOOP_SECONDS)
            start = self.sensors.heading()
            self.start = start
            self.target = start
            for index, step in enumerate(PLAN):
                if stop.is_set():
                    return
                self.progress = {**self.progress, "step": index}
                self.aim = AIMS.get(index)
                kind = step[0]
                if kind == "disabled":
                    self.drive.stop()
                    self.progress = {**self.progress, "phase": "Zero motor power: stopped"}
                    while not stop.is_set():
                        stop.wait(self.LOOP_SECONDS)
                    return
                if kind == "power":
                    self.DRIVE_SPEED = step[1]
                    continue
                self.moving_seconds = MOVING_SECONDS.get(index, 0.0)
                if kind == "drive":
                    moving = step[4] if len(step) > 4 else None
                    after = next((s for s in PLAN[index + 1:] if s[0] not in ("aim", "power")), None)
                    done = self.drive_for(step[1], step[2], step[3], stop, moving, coast=bool(after) and after[0] in ("drive", "glide"))
                    # The action path goes on while the next drive step (after any turns) runs the same action.
                    following = next((s for s in PLAN[index + 1:] if s[0] not in ("turn", "aim", "power")), None)
                    if moving and not (following and following[0] in ("drive", "glide") and following[-1] == moving):
                        self.end_moving()
                elif kind == "glide":
                    moving = step[5] if len(step) > 5 else None
                    after = next((s for s in PLAN[index + 1:] if s[0] not in ("aim", "power")), None)
                    done = self.glide(step[1], step[2], step[3], step[4], stop, moving, coast=bool(after) and after[0] in ("drive", "glide"))
                    following = next((s for s in PLAN[index + 1:] if s[0] not in ("turn", "aim", "power")), None)
                    if moving and not (following and following[0] in ("drive", "glide") and following[-1] == moving):
                        self.end_moving()
                elif kind == "turn":
                    done = self.turn_to(start + step[1], stop)
                elif kind == "aim":
                    self.target = wrap180(start + step[1])
                    done = True
                elif kind == "hold":
                    done = self.hold(step[1], stop)
                elif kind == "action":
                    done = self.act(step[1], step[2], stop)
                else:
                    raise ValueError(f"Unknown autonomous step: {step!r}")
                if not done:
                    if not stop.is_set():
                        raise RuntimeError("IMU heading lost; autonomous stopped")
                    return
                self.progress = {**self.progress, "completed": index + 1}
        finally:
            self.drive.stop()
            self.end_moving()
            if MECHANISMS is not None:
                MECHANISMS.stop()
            finish = getattr(self.actions, "stop", None)
            if callable(finish):
                finish(self.module)


def create_autonomous(module, drive):
    """Required entry point. Return anything with run(stop)."""
    if not callable(getattr(drive, "move", None)) or getattr(drive, "sensors", None) is None:
        from types import SimpleNamespace
        from motion_module.mecanum import MecanumTestDrive

        mixer = MecanumTestDrive(module)
        imu = module.imu

        def heading_move(forward, strafe, rotate, speed=1.0):
            return mixer.drive(forward, strafe, IMU_TO_MIXER_SIGN * rotate, speed=speed)

        drive = SimpleNamespace(drive=heading_move, move=heading_move, stop=mixer.stop,
                                sensors=imu, heading=HeadingController())
    return PlannedRoute(module, drive)
`;
  }
  // robot_actions.py: the team's mechanism code, created once next to autonomous.py and never overwritten.
  function actionsFile(route,options={}){
    const mech=options.mechanisms?.enabled?options.mechanisms:null,list=Export.actions(route).filter(a=>!builtIn(a.name,mech)),name=doc(options.name||'Planned route');
    return `"""Your mechanism code for the autonomous actions of ${name}.

Deck Driver Station created this file once and never overwrites it. autonomous.py
calls the function named for each action every loop while that action runs; return
True when it has finished. At a pin the robot waits for the action and the pause;
on an action path it keeps driving, and the last call has step.last set.

step.elapsed   seconds since the action started
step.first     True on the first call
step.last      True on the final call of an action path (stop the mechanism now)
step.moving    True on an action path, False at a pin
step.module    the MotionModule object, for its outputs

When you add or rename an action in the simulator, its placeholder appears in the
exported autonomous.py: add a function with the same name here.
"""


def setup(module):
    """Called once when autonomous is created: set up your mechanisms here."""

${list.map(a=>`
def ${a.py}(step):
    """"${doc(a.name.replace(/"/g,"'"))}": ${doc(a.uses.map(u=>Export.where(u)+(u.note?` (${u.note.replace(/"/g,"'")})`:'')).join('; ').replace(/[\r\n]/g,' '))}."""
    # TODO: ${a.uses.some(u=>u.moving)?'start the mechanism when step.first, stop it when step.last.':'run the mechanism, return False until it is done.'}
    return True
`).join('')}

def stop(module):
    """Called when autonomous ends or is stopped: stop every mechanism."""
`;
  }
  // ---------------------------------------------------------------- mechanisms
  // MotionModule drives brushed motors without encoders, so flywheels run open loop (up to speed
  // SPIN_UP_SECONDS after they start) and a turret is a positional servo. Outputs are looked up by their
  // hardware.py names; outputs not named there fall back to free channels: the drive uses motor
  // channels 1-4, so mechanisms take 5-8 (intakes, then each shooter's indexer and flywheel); turret
  // servos start at 0 and continuous-servo indexers at 6.
  const MM_MOTORS=[5,6,7,8];
  // Each output the mechanisms use, and the channel it falls back to. mount -1: set in Deck to turn the other way, so
  // the code drives it with its power negated (the simulator reads it back the same way).
  function mechanismHardware(m){
    let motor=0,servo=0,crservo=6;const next=()=>MM_MOTORS[motor++]??null,out={},mount=on=>on?-1:1;
    // An intake roller on a motor takes the next free motor channel; on a continuous servo, a servo channel from 6.
    const roller=(device,reversed,part)=>device==='crservo'?{channel:crservo++,servo:true,mount:mount(reversed),part}:{channel:next(),servo:false,mount:mount(reversed),part};
    const rollers=m.intakes.flatMap((i,k)=>i.kind==='kicker'?[]:[roller(i.device,i.reversed,k),...(i.motor2?[roller(i.device,i.reversed2,k)]:[]),...(i.more||[]).filter(x=>x.device!=='servo').map(x=>roller(x.device,x.reversed,k))]);if(rollers.length)out.intakes=rollers;
    const kickers=m.intakes.filter(i=>i.kind==='kicker');if(kickers.length)out.kickers=kickers.map(i=>({servo:servo++,down:i.downPos*180,up:i.upPos*180}));
    const ramps=m.intakes.filter(i=>i.kind==='ramp');if(ramps.length)out.ramps=ramps.map(i=>({servo:servo++,down:i.downPos*180,up:i.upPos*180}));
    // MotionModule turrets are servos; with a servo turret set in Deck its center and range come from there.
    const center=m.turret.kind==='servo'?m.turret.servoCenter*180:90,perDegree=m.turret.kind==='servo'?180/m.turret.servoDegrees:1;
    if(m.shooters.length)out.shooters=m.shooters.map(s=>{
      const kind=s.indexerKind,indexer=kind==='crservo'?{channel:crservo++,servo:true,mount:mount(s.indexerReversed)}:Mechs().servoFeeder(kind)?{channel:servo++,positional:true,kind,feed:+(s.feedPos*180).toFixed(3),rest:+(s.restPos*180).toFixed(3)}:{channel:next(),servo:false,mount:mount(s.indexerReversed)};
      return {indexer,flywheels:[{channel:next(),mount:mount(s.reversed)},...(s.motor2?[{channel:next(),mount:mount(s.reversed2)}]:[])],...(s.type==='turret'&&!s.sharesTurret?{turret:{servo:servo++,center,perDegree,mount:mount(s.turretReversed)}}:{})};});
    return out;
  }
  // How many mechanism motors do not fit MotionModule's free channels (5-8).
  const motorsOver=m=>Math.max(0,m.intakes.reduce((n,i)=>n+(i.kind==='kicker'||i.device==='crservo'?0:i.motor2?2:1),0)+m.shooters.reduce((n,s)=>n+(s.motor2?2:1)+(s.indexerKind==='motor'?1:0),0)-MM_MOTORS.length);
  // Turret angle (degrees from the robot's front, counterclockwise) for each action step, from the
  // planned pose there: MotionModule has no X/Y sensing to aim from during the run.
  // Two turrets on their own motors each aim from their own spot: the angle is then a list, one per turret.
  function aimer(route,m,target,robot={}){
    if(!m?.enabled||!m.shooters.some(s=>s.type==='turret')||!target)return ()=>undefined;
    const turrets=m.shooters.filter(s=>s.type==='turret'&&!s.sharesTurret),clamp=d=>+Math.max(m.turret.min,Math.min(m.turret.max,d)).toFixed(1);
    // cell 'other': the hive cell that faces up after the first tip, mirrored across the pivot.
    return (segment,heading,cell)=>{const end=route.segments?.[segment]?.points?.at(-1);if(!end||!Number.isFinite(heading))return undefined;
      const t=cell==='other'?{x:target.x,y:144-target.y}:target;
      if(turrets.length>1)return turrets.map(s=>clamp(Mechs().bearingFrom(Mechs().mountOffset(s.mount,robot),{x:end.x,y:end.y,heading},t)));
      return clamp(((Math.atan2(t.y-end.y,t.x-end.x)-heading)*DEG%360+540)%360-180);};
  }
  function mechanismsPython(m){
    const hw=mechanismHardware(m),py=v=>v===null||v===undefined?'None':String(v),list=items=>items.length?`[\n${items.map(x=>`        ${x},`).join('\n')}\n    ]`:'[]';
    const turret=m.shooters.some(s=>s.type==='turret'),pusher=m.shooters.some(s=>s.indexerKind==='pusher');
    // Each roller's name in the order mechanismHardware gave it a channel.
    const rollerNames=m.intakes.flatMap(i=>i.kind==='kicker'?[]:[[i.motor,i.power],...(i.motor2?[[i.motor2,i.power]]:[])]);
    return `

class Mechanisms:
    """The mechanisms from the simulator's Mechanisms settings (regenerated on export).

    Outputs are found by their hardware.py names, or else on the channel next to each name. Motors
    here have no encoders, so a flywheel counts as up to speed SPIN_UP_SECONDS after it starts.
    A device set in Deck to turn the other way runs with its power negated. A turret is a positional
    servo: TURRET_SERVO_CENTER points it straight ahead, and each turret degree (counterclockwise,
    to the robot's left) moves the servo TURRET_SERVO_PER_DEGREE degrees.
    Timing, with no piece sensor: a piece takes up to TRANSFER_SECONDS from touching an intake to
    sitting in the shooter, and INDEX_SECONDS to move up after the one ahead of it is shot; a piece in
    the shooter fires as soon as the flywheel is up to speed and the turret is on target. Shooters
    spin up, aim and feed together. "Shoot N" waits TRANSFER_SECONDS after the last intake, then runs
    the feeders for N shots, FEED_CYCLE_SECONDS each${pusher?' (a servo pusher pushes for PUSH_SECONDS at the start of each)':''}.
    "Shoot" with no number shoots once for every storage slot (STORAGE).${motorsOver(m)?`
    MotionModule has four free motor channels (5-8) and these mechanisms need ${motorsOver(m)} more:
    name the extra outputs in hardware.py, or use continuous servos for the indexers.`:''}
    """

    # (hardware.py name, fallback channel, power, continuous servo?) for each intake roller: ${m.intakes.map(i=>i.sides.join(' + ')).join('; ')||'none'}. A negative power turns it the other way.
    INTAKES = ${list((hw.intakes||[]).map((r,k)=>`(${pyString(rollerNames[k][0])}, ${py(r.channel)}, ${num(rollerNames[k][1]*r.mount)}, ${r.servo?'True':'False'})`))}
    # (hardware.py name, fallback servo channel, angle down, angle up) for each kicker: it swings down while an Intake runs.
    KICKERS = ${list(m.intakes.filter(i=>i.kind==='kicker').map((i,k)=>`(${pyString(i.servo)}, ${hw.kickers[k].servo}, ${num(i.downPos*180)}, ${num(i.upPos*180)})`))}
    KICKER_UP_SECONDS = ${num(Mechs().liftSeconds(m))}
    # (hardware.py name, fallback servo channel, angle down, angle up) for each ramp: Ramp down and Ramp up move it and it
    # stays there; Intake runs only its rollers (in INTAKES). RAMP_DOWN_SECONDS / RAMP_UP_SECONDS: how long it takes.
    RAMPS = ${list(m.intakes.filter(i=>i.kind==='ramp').map((i,k)=>`(${pyString(i.servo)}, ${hw.ramps[k].servo}, ${num(i.downPos*180)}, ${num(i.upPos*180)})`))}
    RAMP_DOWN_SECONDS, RAMP_UP_SECONDS = ${num(Math.max(0,...m.intakes.filter(i=>i.kind==='ramp').map(i=>i.down)))}, ${num(Math.max(0,...m.intakes.filter(i=>i.kind==='ramp').map(i=>i.up)))}
    # Each shooter: its flywheel motors [(name, channel, direction)], its feeder (name, channel, kind, direction,
    # angle feeding, angle at rest) and its turret servo (name, channel, direction), or None when fixed (or on the first
    # shooter's turret). Feeder kinds: motor, crservo (continuous servo), pusher (pushes each piece in) and gate (opens).
    SHOOTERS = ${list(m.shooters.map((s,k)=>{const h=hw.shooters[k],x=h.indexer,names=[s.motor,s.motor2].filter(Boolean);
      return `([${h.flywheels.map((f,i)=>`(${pyString(names[i])}, ${py(f.channel)}, ${f.mount})`).join(', ')}], (${pyString(s.indexer)}, ${py(x.channel)}, "${s.indexerKind}", ${x.mount??1}, ${x.positional?`${num(x.feed)}, ${num(x.rest)}`:'None, None'}), ${h.turret?`(${pyString(s.turretMotor)}, ${h.turret.servo}, ${h.turret.mount})`:'None'})`;}))}
    INDEXER_POWER, SHOOTER_POWER = ${num(m.indexer.power)}, ${num(m.shooter.control==='power'?m.shooter.power:1)}
    TRANSFER_SECONDS, INDEX_SECONDS, FIRE_MARGIN_SECONDS = ${num(m.transfer.seconds)}, ${num(m.indexer.seconds)}, ${num(Mechs().FIRE_MARGIN)}
    FEED_CYCLE_SECONDS, LAST_SHOT_SECONDS, PUSH_SECONDS = ${num(pusher?Math.max(m.indexer.seconds,2*m.indexer.pushSeconds):m.indexer.seconds)}, ${num(Mechs().shootSeconds(m,1))}, ${num(m.indexer.pushSeconds)}
    SPIN_UP_SECONDS, STORAGE = ${num(m.shooter.spinUp)}, ${m.storage}
    TURRET_SERVO_CENTER, TURRET_SERVO_PER_DEGREE = ${num(m.turret.kind==='servo'?m.turret.servoCenter*180:90)}, ${num(m.turret.kind==='servo'?180/m.turret.servoDegrees:1)}
    TURRET_MIN, TURRET_MAX, TURRET_SPEED = ${num(m.turret.min)}, ${num(m.turret.max)}, ${num(m.turret.speed)}

    def __init__(self, module):
        def output(kind, name, channel):
            try:
                return getattr(module, kind)(name)
            except (ValueError, KeyError):
                return getattr(module, kind)(channel)
        self.intakes = [(output("servo" if servo else "motor", name, channel), power, servo) for name, channel, power, servo in self.INTAKES]
        self.kickers = [(output("servo", name, channel), down, up) for name, channel, down, up in self.KICKERS]
        for servo, down, up in self.kickers:
            servo.set_angle(up)
        self.ramps = [(output("servo", name, channel), down, up) for name, channel, down, up in self.RAMPS]
        for servo, down, up in self.ramps:
            servo.set_angle(up)
        self.flywheels, self.feeders, self.turrets = [], [], []
        for flywheels, (name, channel, kind, sign, feed, rest), turret in self.SHOOTERS:
            self.flywheels += [(output("motor", n, c), s) for n, c, s in flywheels]
            feeder = output("motor" if kind == "motor" else "servo", name, channel)
            if kind in ("pusher", "gate"):
                feeder.set_angle(rest)
            self.feeders.append((feeder, kind, sign, feed, rest))
            if turret is not None:
                self.turrets.append((output("servo", turret[0], turret[1]), turret[2]))
        self.spin_started = None
        self.feed_started, self.shot, self.last_intake = None, False, -1e9
        self.turret_angle, self.turret_ready_at = [0.0] * len(self.turrets), 0.0
        self.aim(0.0)

    def run(self, kind, count, step):
        """One call of a built-in action. True when it has finished. count: shots for Shoot N, 1 down or 0 up for a
        ramp, and (turret, degrees) for Turret to: turret None for every one, else its place among the turrets."""
        if kind == "intake":
            done = step.last or (not step.moving and step.duration <= 0)
            self.intake(not done)
            return done
        if kind == "ramp":
            self.ramp(count == 1)
            return step.moving or step.elapsed >= (self.RAMP_DOWN_SECONDS if count == 1 else self.RAMP_UP_SECONDS)
        if kind == "turret":
            which, degrees = count
            self.aim(degrees if which is None else [degrees if i == which else a for i, a in enumerate(self.turret_angle)])
            return step.moving or self.aimed()
        if not self.flywheels:
            return True
        if kind == "spin":
            self.spin(True)
            return True
        if kind == "aim":
            self.aim(step.aim)
            return step.last if step.moving else self.aimed()
        if kind == "shoot":
            return self.shoot(count, step)
        return True

    def intake(self, on):
        if on and (self.intakes or self.kickers):
            self.last_intake = time.monotonic()
        for roller, power, servo in self.intakes:
            if servo:
                roller.set_pulse_us(1500 + 500 * power if on else 1500)  # continuous servo: 1500 us stops it
            else:
                roller.set(power if on else 0)
        for servo, down, up in self.kickers:
            servo.set_angle(down if on else up)

    def ramp(self, down):
        """Ramps down (True) or up; they stay there until the next Ramp down or Ramp up."""
        for servo, angle_down, angle_up in self.ramps:
            servo.set_angle(angle_down if down else angle_up)

    def feed(self, on, t=0.0):
        """The feeders t seconds into a volley: rollers run and gates stay open while feeding; a pusher
        pushes for PUSH_SECONDS at the start of every FEED_CYCLE_SECONDS and is back at rest in between."""
        push = on and self.FEED_CYCLE_SECONDS > 0 and t % self.FEED_CYCLE_SECONDS < self.PUSH_SECONDS
        for feeder, kind, sign, feed, rest in self.feeders:
            if kind == "pusher":
                feeder.set_angle(feed if push else rest)
            elif kind == "gate":
                feeder.set_angle(feed if on else rest)
            elif kind == "crservo":
                feeder.set_pulse_us(1500 + 500 * sign if on else 1500)  # continuous servo: 1500 us stops it
            else:
                feeder.set(self.INDEXER_POWER * sign if on else 0)

    def spin(self, on):
        if on and self.spin_started is None:
            self.spin_started = time.monotonic()
        if not on:
            self.spin_started = None
        for flywheel, sign in self.flywheels:
            flywheel.set(self.SHOOTER_POWER * sign if on else 0)

    def ready(self):
        return self.spin_started is not None and time.monotonic() - self.spin_started >= self.SPIN_UP_SECONDS

    def aim(self, degrees):
        """Point every turret (fixed shooters are aimed by the route): one angle for all, or one per turret."""
        if degrees is None or not self.turrets:
            return
        angles = list(degrees) if isinstance(degrees, (list, tuple)) else [degrees] * len(self.turrets)
        angles = [max(self.TURRET_MIN, min(self.TURRET_MAX, a)) for a in (angles + angles[-1:] * len(self.turrets))[:len(self.turrets)]]
        if angles != self.turret_angle:
            self.turret_ready_at = time.monotonic() + max(abs(a - b) for a, b in zip(angles, self.turret_angle)) / self.TURRET_SPEED
            self.turret_angle = angles
        # A servo reaches 0 to 180 degrees; gear the turret (TURRET_SERVO_PER_DEGREE) to cover its range.
        for (turret, sign), angle in zip(self.turrets, angles):
            turret.set_angle(max(0.0, min(180.0, self.TURRET_SERVO_CENTER + sign * angle * self.TURRET_SERVO_PER_DEGREE)))

    def aimed(self):
        return time.monotonic() >= self.turret_ready_at

    def shoot(self, count, step):
        want = count if count > 0 else self.STORAGE
        if step.first:
            self.feed_started, self.shot = None, False
        if self.shot:
            return True
        self.spin(True)
        self.aim(step.aim)
        now = time.monotonic()
        # Start once spun up and on target, and pieces from the last intake have moved up.
        if self.feed_started is None and self.ready() and self.aimed() and now - self.last_intake >= self.TRANSFER_SECONDS + self.KICKER_UP_SECONDS:
            self.feed_started = now
        # Shooting for a set time keeps feeding until the last call; otherwise long enough for N shots.
        window = float("inf") if step.duration > 0 else (want - 1) * self.FEED_CYCLE_SECONDS + self.LAST_SHOT_SECONDS
        feeding = self.feed_started is not None and now - self.feed_started < window
        self.feed(feeding and not step.last, now - self.feed_started if self.feed_started is not None else 0.0)
        if self.feed_started is not None and not feeding:
            self.shot = True
        done = self.shot or step.last
        if done:
            self.feed(False)
            self.spin(False)
        return done

    def stop(self):
        self.intake(False)
        self.feed(False)
        self.spin(False)
`;
  }
  return {plan,autonomous,actionsFile,mechanismHardware,motorsOver};

});
