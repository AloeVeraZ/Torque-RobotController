# Mechanism research notes

This file records the research behind the mechanism engine: what each kind of robot needs mathematically, how the engine represents it, which decisions came from which source, and what is tested. The design itself is in `MECHANISM_ENGINE.md`; the user guide is in `SIMULATION.md`. How each mechanism is calibrated on the real robot from its sensors (the gated flow, its sources and Live debug) is in [CALIBRATION.md](CALIBRATION.md).

## 1. What carries across every robot

Looked at kinematically, rather than by how they look, the robots below reduce to a few ideas. The engine keeps these ideas apart.

1. **A joint is relative motion between two rigid links.** Turret, elbow, ramp and roller are all one revolute joint. What the part is for (`drive`) is a separate label.
2. **A transmission maps actuator motion to joint motion.** ros2_control's simple, differential and four-bar transmissions are each a linear map, joint = A · actuator + offset (§3). Gear trains, belts, CoreXY, planetary sets and fixed tendons are the same kind of map. Cams, Geneva wheels and continuously rigged slides are one-input functions.
3. **Closed chains are constraints, not trees.** Four-bars, slider-cranks, delta robots and geared five-bars are a tree plus "this point equals that point". This is how MuJoCo (`connect`, `weld`), SDFormat (a joint whose child is already reached) and Onshape (closed mate loops) represent them.
4. **The command is not the response.** A servo told 90° is not at 90° yet. A motor under load runs slower than its free speed. A pneumatic cylinder cannot stop half way. The engine keeps what an actuator was told (`command`) apart from how it moves (`q`, `v`). Sensors read the response.
5. **Accuracy has three levels:** visual-only, kinematically constrained, and physics. The engine says which level a result comes from and does not invent dynamics from geometry.

## 2. Robot categories: what they need and how they are represented

Status key: **Tested** means checked against an independent answer in `tests/`. **Modelled** means representable and used, but with no dedicated reference test.

| Category | Kinematic essence | Representation | Status |
|---|---|---|---|
| FTC/FRC/VEX turret and flywheel | yaw revolute, spin continuous; hood pitch on the turret | continuous + nested revolute; flywheel speed from a motor model (spin-up τ = J·ωf/τs) | Tested (`sim-kinematics`, `sim-joints-engine`, `sim-mechanism-universal` motor test) |
| Pivoting intake / ramp | limited revolute, two named positions | revolute with `states`; game `deploy` signal or actions | Tested |
| Linear elevator (cascade) | stages each move the same amount on the one below | prismatic chain + cable couplings, ratio 1 (`rigging('cascade')`) | Tested |
| Linear elevator (continuous rigging) | top stage moves first, then each one below (gm0) | prismatic chain + `sequence` couplings from a total-travel joint (`rigging('continuous')`) | Tested |
| Swerve module | steering continuous, wheel spinning on the steered axle | nested continuous joints | Tested (`sim-kinematics-robots`) |
| Mecanum / omni / differential drive | wheel spin follows chassis velocity | `wheel` signal, `roll: mecanum/omni` | Modelled (drawn from chassis motion) |
| Six-axis arm | serial revolute chain | revolute chain; IK by damped least squares | Tested against Denavit–Hartenberg |
| SCARA | two vertical pivots, quill slide, wrist | revolute, revolute, prismatic, continuous | Tested (planar two-link geometry; also as an SDFormat file) |
| Cartesian gantry / CNC | three orthogonal slides | prismatic chain with limits | Tested |
| CoreXY gantry | x = (A+B)/2, y = (A−B)/2 belt travel | two-input `differential` couplings from motor joints | Tested |
| Delta (parallel) robot | three driven arms, ball-jointed forearms meeting at a platform | revolute + ball, two point loops | Tested (sphere intersection) |
| Four-bar / slider-crank | one-DOF closed chain | tree + point loop, homotopy so it stays on the branch it was built in | Tested (Freudenstein, slider-crank formula; also driven in a run, and imported from SDFormat and MJCF) |
| Geared five-bar | two cranks geared together, links meet | gear coupling inside the loop; couplings re-applied during solving | Tested |
| Robotic gripper | mirrored fingers | `mimic` coupling, ratio −1 | Tested |
| Pneumatic gripper / cylinder | rests only at its ends | actuator `response: 'pneumatic'` | Tested |
| Humanoid arm | ball shoulder, elbow, universal wrist | ball, revolute, universal; per-value limits | Tested (law of cosines) |
| Differential wrist | pitch = (a1+a2)/2n, roll = (a1−a2)/2n | two-input couplings from two motor joints | Tested (ros2_control's equations) |
| Quadruped leg | hip abduction, hip, knee | revolute chain | Tested (planar two-link geometry) |
| Underactuated / tendon finger | phalanges coupled by tendons | multi-input `tendon` coupling (MJCF fixed tendons) | Tested (2·pip − 3·dip = 0 from an MJCF file) |
| Lead screw | travel = lead × turns | `screw` joint, or a `screw` transmission stage | Tested |
| Cable spool lift | travel = π·d × turns | `cable` coupling or `spool` transmission stage | Tested |
| Gear train | ratios multiply, sign flips per external mesh | chained `gear` couplings | Tested |
| Planetary gearbox | Ns·ωs + Nr·ωr = (Ns+Nr)·ωc | `planetary()` coupling, any member as output | Tested (from pitch-line speeds) |
| Cam and follower | follower = f(cam angle), repeating every turn | `cam` coupling: table + period | Tested (eccentric disc, e·(1 − cos θ)) |
| Geneva / indexer | dwell, then a quarter turn per input turn | table + period; each period adds the table's rise | Tested (tan β = sin α / (√2 − cos α)) |
| Rack and pinion | travel = π·d/360 per degree | `rack` coupling or stage | Tested |
| Conveyors, rollers | continuous spin | continuous joint + speed command or signal | Modelled |
| Snake / cable-driven / soft robots | many coupled joints; continuum bending | long chains + multi-input couplings approximate them; true continuum mechanics is not modelled | Partly (see §6) |
| Aerial robots with actuators | floating base + small joints | floating joint + revolute | Modelled |

## 3. Software studied, and what was taken from each

- **URDF / ROS 2.** Joints as a tree (fixed, revolute, continuous, prismatic, planar, floating). `mimic` gives q = multiplier·q_other + offset. Imported in `sim-urdf.js`.
- **ros2_control transmission_interface.** A transmission is a linear actuator-to-joint map. From the headers (`simple_transmission.hpp`, `differential_transmission.hpp`, `four_bar_linkage_transmission.hpp`):
  - simple: x_j = x_a/n + x_off;
  - differential: x_j1 = (x_a1/n_a1 + x_a2/n_a2)/(2·n_j1) + x_off1, and the difference for x_j2;
  - four-bar transmission: x_j2 = (x_a2/n_a2 − x_a1/(n_j1·n_a1))/n_j2 + x_off2.

  These led to **multi-input linear couplings**: one coupling shape covers all three, plus CoreXY, planetary sets and tendons. https://github.com/ros-controls/ros2_control/tree/master/transmission_interface
- **SDFormat / Gazebo.** Read from the spec sources (`sdf/1.11/joint.sdf`, `pose.sdf`) and the pose-frame-semantics page.
  - A link's pose defaults to its model's frame, a joint's to its child link's frame, and `relative_to` names any frame in scope.
  - The axis is in the joint frame unless `expressed_in` says otherwise. 1.5–1.6 had `use_parent_model_frame` instead, and 1.4 used the model frame.
  - `screw_thread_pitch` is metres a turn, positive right-handed. The deprecated `thread_pitch` is radians a metre, positive left-handed.
  - `gearbox` enforces θ2 = −ratio·θ1 about a reference body.

  https://sdformat.org/tutorials/specification/pose_frame_semantics/, https://github.com/gazebosim/sdformat/tree/main/sdf
- **MuJoCo / MJCF.** Read from `XMLreference.rst` and the modelling chapter.
  - Compiler and frames:
    - `compiler/angle` defaults to degrees.
    - `eulerseq` defaults to `xyz`; lower case turns with the frame, upper case is fixed, and URDF rpy is `XYZ`.
    - `autolimits` infers `limited` from `range`.
    - `quat` is w x y z.
    - Joint `pos` is in the body frame.
    - Geom sizes are half-sizes, and `fromto` sets the length.
  - Rendering:
    - Geom groups 0–2 are visible by default.
    - A geom's rgba wins over its material when it differs from the default.
    - Mesh vertices are drawn relative to `refpos` and `refquat`; the compiler's own recentring is undone by the geom frame.
  - Constraints:
    - Joint equality: y − y0 = a0 + a1(x − x0) + … + a4(x − x0)⁴. This led to **polynomial couplings**.
    - `connect` takes an anchor in body1's frame, which led to **point loops**. `weld` is position and orientation, imported as three points.
    - A fixed tendon is a linear combination of joints, which led to **tendon couplings**.

  https://mujoco.readthedocs.io/en/stable/XMLreference.html, https://mujoco.readthedocs.io/en/stable/modeling.html
- **Drake.** `MultibodyPlant::AddCouplerConstraint(joint0, joint1, gear_ratio, offset)` is the same linear coupling. https://drake.mit.edu/doxygen_cxx/classdrake_1_1multibody_1_1_multibody_plant.html
- **OpenUSD / Isaac Sim.** Read from Pixar's `usdPhysics/schema.usda` and `usdGeom/schema.usda`, and from PhysX's `PxArticulationReducedCoordinate.h`.
  - Joints: UsdPhysics has revolute, prismatic, spherical, distance and fixed joints, on a generic D6 base. A joint's frame is `localPos0`/`localRot0` relative to body0 (an unset body is the world), and `physics:axis` is X, Y or Z of that frame.
  - Limits: revolute limits are degrees, prismatic limits scene units. A low limit above the high one locks the joint. A spherical cone limit runs from the axis toward the next axes.
  - Transforms: `xformOpOrder` lists ops outermost first, so [translate, rotateXYZ, scale] scales, then turns about X, Y and Z, then moves. `metersPerUnit` falls back to 0.01, and `upAxis` is Y or Z.
  - PhysX: a mimic joint enforces qA + gearRatio·qB + offset = 0, and PhysX adds gear and rack-and-pinion joints. Both confirm that gears and racks belong beside joints as relations, not as joint types.

  https://github.com/PixarAnimationStudios/OpenUSD/tree/release/pxr/usd/usdPhysics, https://github.com/NVIDIA-Omniverse/PhysX/blob/main/physx/include/PxArticulationReducedCoordinate.h
- **Onshape, SolidWorks, Fusion.** Mates map to the joint types: fastened, revolute, slider, cylindrical, pin slot, planar, ball. Mate relations (gear, rack and pinion, screw) map to couplings. STEP exports from these tools do not carry mates, so STEP joints are inferred and labelled as such.
- **WPILib DCMotor.** R = V/I_stall, Kv = ω_free/(V − R·I_free), Kt = τ_stall/I_stall, giving a linear torque–speed line scaled by voltage. This is the **motor response model**. https://github.wpilib.org/allwpilib/docs/release/cpp/_d_c_motor_8h_source.html
- **gm0 (FTC).** Continuous rigging extends the last stage first, then the next-to-last, and so on; cascade moves all stages together. https://gm0.org/en/latest/docs/common-mechanisms/linear-motion-guide/rigging.html
- **CoreXY.** Both motors turning the same way move the carriage along x, opposite ways along y. corexy.com describes this qualitatively. The engine's x = (A+B)/2, y = (A−B)/2 follows from the belt paths. https://corexy.com/theory.html
- **Mechanism types (`sim-mechanism-types.js`).** The catalogue of what a moving part can be came from:
  - gm0's common mechanisms: drivetrains, linear motion (drawer, extrusion and bearing slides, lead screws, rack and pinion, rigging), arms (single arm, pivot extension, multi-axis, arms for end effectors on servos), linkages (linkage slides, four bar, virtual four bar, double-reverse four bar, virtual DR4B), passive intakes and claws, active intakes, transfers, dead wheels, and full and mini turrets. https://gm0.org/en/latest/docs/common-mechanisms/index.html, https://gm0.org/en/latest/docs/common-mechanisms/linkages.html, https://gm0.org/en/latest/docs/common-mechanisms/arms.html, https://gm0.org/en/latest/docs/common-mechanisms/turrets/index.html
  - FRC teams' list of common systems: swerve, continuous and cascade elevators, telescoping tubes, big pivots, flywheel shooters with hoods, indexers (spindexers, hoppers), turrets, slapdown, four-bar and under-the-bumper intakes. https://www.chiefdelphi.com/t/basic-mechanical-devices-systems-to-know/502098; FIRST's extender lesson (elevators that lift, reach and climb). https://www.firstinspires.org/hubfs/lms/frc-guided-experience/m2/l4-extenders-lift-reach-climb-pdf.pdf
  - FTC game years: DECODE launchers (single or dual flywheel, servo flicker), gates bumped or opened by a servo arm, conveyors, carousels and hoppers, spindexers (https://www.studica.com/blog/?p=20817, https://www.chiefdelphi.com/t/emu-robotics-ftc/506276); hangs and ascents (hooks, winches, linear actuators); CENTERSTAGE drone launchers; Freight Frenzy carousel spinners and buckets.
  - General robotics: articulated arm joints (waist, shoulder, elbow, wrist roll, pitch and yaw; the first three place the tool, the wrist orients it), SCARA, delta, Cartesian and gantry robots (https://www.kuka.com/en-us/company/iimagazine/2022/from-delta-to-scara,-c-,-overview-of-industrial-robot-types, https://toolbox.igus.com/4185/types-of-industrial-robots), humanoid roll, pitch and yaw naming (NAO joint docs), legs, grippers, pan-tilt heads, car steering, pneumatic cylinders, spindles and thrusters.

## 4. Design decisions

| # | Decision | Why | Source |
|---|---|---|---|
| D1 | Couplings are `offset + f(first input) + Σ ratio·input`, with f a ratio (plus x²…x⁴ terms) or a table, optionally periodic. | One relation covers ros2_control's transmissions, MuJoCo polycoef and tendons, cams, Geneva wheels and continuous rigging. Robot-specific code is not needed. | ros2_control, MJCF |
| D2 | Actuator targets, named positions and speeds are in the joint's units. Transmission stages give the ratio. A motor model's datasheet figures (free speed, stall torque, count) are converted through it; load and inertia are entered at the joint. | Teams think "lift to 20 in at 15 in/s", not motor degrees. An ideal transmission conserves power, so τ_joint = τ_motor·ratio and ω_joint = ω_motor/ratio. | WPILib model, power balance |
| D3 | The driver sends only the joints it drives; `pose()` sets coupled joints and solves loop joints. | Sending every joint held loop joints at their rest values, so linkages never closed in runs or videos (found in this phase). | — |
| D4 | Motor model: the exact exponential solution of J·dω/dt = τs(u − ω/ωf) − τL over sub-steps. The default position gain closes an error at full speed in T = 4τ, which is critically damped. Velocity commands are closed loop with load feed-forward; effort is open loop. | Exact for held voltage, so the spin-up test can be strict. ζ = √(T/τ)/2 = 1 means no overshoot. | WPILib DCMotor |
| D5 | A pneumatic cylinder rests only at its ends and crosses at its set speed. | A plain solenoid-valve cylinder cannot hold mid-stroke. Speed under load depends on pressure and flow, which are not modelled, so this is labelled a kinematic approximation. | — |
| D6 | A closing joint from a file becomes a constraint: two points on its axis for a hinge (exactly a revolute constraint), three points for a weld, one point otherwise (noted). | Point coincidences are what the solver handles. Two points on an axis remove five DOF, exactly as a hinge does. | MJCF connect/weld, SDFormat graphs |
| D7 | Loop residuals are measured in inches whatever the CAD unit. Stored points keep 9 decimals. | Metre-scale files converged loosely, and 5-decimal storage moved loop points by 10 µm (both found in this phase). | — |
| D8 | A ball joint's cone limit is kept as the same limit on each of its three angles. | Per-angle stops are what the joint model holds. The approximation is stated in the import notes. | MJCF range on ball joints |
| D9 | Every format becomes one description (links, joints, loops, couplings, actuators, notes), then one path to the body and the joints. | New formats add a reader only. What cannot be read goes into `notes` rather than being guessed. | — |
| D10 | Timelines are worked out ahead for ideal actuators. They are ticked through the driver (1/240 s) when an action waits on a sensor or uses a motor model. Driver steps hand over on the tick they end. | Scrubbing and recordings must be deterministic. A wait or motor response cannot be computed ahead in closed form. | — |
| D11 | Joints in a loop from a file are left for the solver unless an actuator in the file drives them. | Which joint is the input of a linkage is not in the geometry. Guessing would drive the wrong one. | — |
| D12 | A mechanism type is a set of defaults on an ordinary joint (`kind`), not a new joint kind. A name's last mechanism word decides it; hardware and vendor names say nothing. | A claw, a hang hook and a wrist are all revolute joints with different positions, speeds and motors, so the engine needs nothing new, and the team can change any setting or the type. Team assembly names put the head noun last ("Intake slides", "Claw wrist"), while vendor parts and fasteners carry mechanism words they do not stand for ("Arm motor mount", "Gecko Wheel (GB)"). | gm0, Chief Delphi, the team's CAD |

## 5. Test coverage

Each line is a robot or mechanism, the test that checks it, and the independent reference.

1. FTC intake pivot and elevator: `sim-kinematics` (driver signals, actions) and `sim-mechanism-universal` (rigging). Reference: named positions, gm0 order.
2. FTC turret and flywheel: `sim-kinematics`, `sim-joints-engine`, and the motor model in `sim-mechanism-universal`. Reference: ωf(1 − e^(−t/τ)).
3. Swerve module: `sim-kinematics-robots`. Reference: axle direction and rolling direction.
4. Six-axis arm: `sim-kinematics-robots`. Reference: Denavit–Hartenberg forward kinematics.
5. SCARA: `sim-kinematics-robots` and `sim-robot-formats` (SDFormat file). Reference: planar two-link.
6. Cartesian gantry: `sim-kinematics-robots`, and CoreXY in `sim-mechanism-universal`. Reference: slides add; belt-path equations.
7. Four-bar: `sim-kinematics`, `sim-mechanism-universal` (in a run), `sim-robot-formats` (SDFormat and MJCF). Reference: circle intersection.
8. Slider-crank: `sim-kinematics`. Reference: x = r cos θ + √(l² − r² sin² θ).
9. Telescoping lift: `sim-kinematics-robots` and `sim-mechanism-universal`. Reference: cascade ×n; continuous order.
10. Gripper: `sim-kinematics-robots` (mimic), `sim-robot-formats` (MJCF equality), `sim-mechanism-universal` (pneumatic). Reference: symmetric jaws; ends only.
11. Humanoid arm: `sim-kinematics-robots`. Reference: law of cosines.
12. Quadruped leg: `sim-kinematics-robots`. Reference: planar two-link.
13. Lead screw: `sim-kinematics`, `sim-kinematics-robots`, and the transmission test in `sim-mechanism-universal`. Reference: lead × turns; encoder counts.
14. Cable pulley: `sim-kinematics-robots`. Reference: π·d per turn.
15. Gear-coupled: `sim-kinematics` (gear chain), planetary and the geared five-bar in `sim-mechanism-universal`, and the SDFormat gearbox. Reference: tooth ratios; Willis.
16. Delta robot: `sim-kinematics-robots`. Reference: three-sphere intersection.

Difficult cases covered:
- reversed axes (SCARA elbow, g2 gear, finger_r);
- non-zero joint origins everywhere;
- nested subassemblies (MJCF bodies, SDFormat frames);
- cyclic constraints (four-bars, geared five-bar, delta);
- missing metadata (notes for includes, unread meshes, muscles, flex);
- mixed units (radians and degrees, metres and inches, millimetre meshes);
- partial formats (Collada reported, tendon actuators reported).

## 6. Known limits

- **No rigid-body dynamics for CAD links.** Joints are kinematically constrained. The motor model is a one-DOF dynamic model at the actuator; it does not compute link inertia or gravity from CAD geometry, since a STEP mesh has no reliable mass. Loads and inertia are entered.
- **Springs, dampers and counterweights are not simulated as forces.** A spring-return part is modelled as a position actuator whose released position is where the spring holds it.
- **Inverse kinematics** reaches positions only (no orientation targets yet) and is not collision-aware.
- **Loops** are point coincidences (or a point on a line). A prismatic or screw joint that closes a loop in a file is kept as one point and noted.
  - The solver finds an assembly that closes. It stays on the branch the CAD was built in by following the inputs from the rest pose, or from the last pose for small moves.
  - Through a singular position (a linkage at toggle, a near-singular parallel layout), it may continue on another branch.
- **Formats not read:**
  - binary USD (.usdc, .usdz, binary .usd: save as .usda);
  - USD composition (references, payloads, variants);
  - UsdPhysics distance and D6 joints;
  - Collada meshes (collision shapes are drawn instead);
  - xacro (expand it first);
  - SDFormat `<include>` and MJCF `<include>`;
  - spatial tendons, muscles and flex.
- **Continuum (soft) robots and snake robots** are approximated by joint chains; continuum bending mechanics is not modelled.
- **STEP files carry no mates**, so their joints are inferred and always marked "Found" (see `MECHANISM_ENGINE.md`).

## 7. Iteration log (universal engine phase)

Iterations 1–6 are in `MECHANISM_ENGINE.md`. Iteration 6 there (the CAD shooter work) ran alongside iteration 7 here.

**Iteration 7.** Concept: transmissions and actuator responses across robot types (ros2_control, WPILib, gm0, MuJoCo). Gaps:
- couplings had one input and were linear only;
- actuators moved in their own units, ideally;
- no sensors or conditional steps;
- joints other than revolute and prismatic had no end stops;
- linkages did not close in runs.

Changes: D1–D5 and D10, sensors, wait and preset steps, per-value limits.

Tests: 16 new, each against an independent reference.

Found and fixed: step handover losing up to two ticks per step, so sequences drifted; an arriving ideal actuator reporting speed for one more tick.

**Iteration 8.** Concept: structured formats beyond URDF (SDFormat, MJCF). Gap: only URDF carried joints as data.

Changes: D6–D9 and D11, `sim-robot-formats.js`, bridge reading with mesh lookup.

Tests: SCARA (SDFormat 1.9), four-bar and gearbox (SDFormat 1.6), arm and four-bar with tendon finger (MJCF), orientation and unit details, the body nesting, reading from disk.

Found and fixed: loop damping tied to inch-scale CAD; 5-decimal storage of points; MJCF rgba precedence over materials.

**Iteration 9.** Concept: industrial arms need tool orientation, and linkages such as the Scotch yoke and the quick-return lever need a pin sliding in another link's slot. Performance matters too, since the 3D view poses the robot every frame.

Gaps:
- inverse kinematics reached positions only;
- loops held points together but not a point on a line;
- a moving four-bar cost 1.9 ms a pose, because every frame re-solved from the rest pose and every robot input stepped the homotopy, even a turret elsewhere on the robot.

Changes:
- `reach({aim})` adds direction targets; two directions fix the tool's orientation;
- loops take `along`, a pin in a slot;
- loop solving poses only the loops' own chains and steps only the inputs that reach them;
- it continues from the last pose when inputs moved less than one step, and returns the last answer when nothing changed.

Tests:
- a six-axis arm reaching a full pose, checked by Denavit–Hartenberg;
- the Scotch yoke (r·cos θ) and the slotted lever (atan2);
- frame-by-frame poses against rest-pose solving over two crank turns, worst difference under 10⁻⁴°.

Benchmarks (Electron's Node, this laptop), µs per pose:

| Mechanism | Before | After |
|---|---|---|
| One ramp | 5 | 4 |
| 30-joint chain | 51 | 45 |
| Four-bar, unchanged | 443 | 15 |
| Four-bar, moving | 1859 | 107 |
| Delta robot, moving | 1446 | 438 |

A driver tick with 30 actuators takes 14 µs; a ticked motor-model timeline takes 0.17 ms.

**Iteration 10.** Concept: OpenUSD, the format Isaac Sim and Omniverse robots come in. Gap: USD was the one structured robot format the brief names that could not be read.

Changes:
- a text USD (.usda) reader in `sim-robot-formats.js`: prims, transform ops, units and up axis, UsdPhysics joints, shapes and inline meshes, drives as actuators, PhysX mimic joints as couplings;
- the bridge turns binary USD away and says to save as .usda.

Tests:
- an Isaac-style arm checked against hand-worked kinematics (joint frames given on both bodies and checked against each other, an axis named in a turned joint frame, a mirrored finger);
- a Y-up stage in centimetres;
- locked limits;
- the body nesting;
- reading from disk.

Found and fixed: unread joint types (distance, D6) at first held their bodies together; they are now left out, so they cannot lock a linkage that moves.

**Iteration 11.** Concept: coordinated multi-joint motion, as industrial controllers do a joint move, plus Cartesian goals for arms, for pick-and-place and "move the arm to a pose".

Gap: actions could only command one actuator per step, and the arm's joints arrived at different times.

Changes:
- named `poses` and `pose`/`reach` steps;
- every mover's trapezoid is the slowest one's, time-scaled (speed × k, acceleration × k²) so all arrive together;
- a reach step solves inverse kinematics over the chain's movable joints from where the robot is.

Tests: a three-joint pose arriving together, with half-way positions; a reach checked by the law of cosines; a full pick-and-place built from presets, the driver following the timeline step by step.

Found and fixed (self-review):
- The ideal trapezoid's integrator moved at each tick's new speed and snapped to the target while still moving (at 18 °/s for a 120 °/s, 480 °/s² move). Fast moves finished up to 7 ticks early, and a time-scaled move peaked at two thirds of its speed.
- It now follows each phase exactly, switching inside a tick when a phase ends there. Ticked moves end on the first tick at or after the planned time, at full speed, landing exactly on the target.

**Iteration 12.** Concept: parallel manipulators beyond the delta robot (the Stewart–Gough platform; cable-driven parallel robots share its leg model), and cyclic behaviour such as legged gaits.

Gaps: the solver had not been checked on a 6-DOF parallel robot, and an action could not repeat.

Changes: actions take `repeat` (up to 100 cycles). Each cycle starts as the last ends, in the driver and in the timeline, with cycles marked.

Tests:
- a 6-6 Stewart platform whose leg lengths come from three target poses by closed-form inverse kinematics. The engine solves 18 unknowns back to each pose, within 10⁻⁵ in.
- a quadruped trotting three cycles from two poses.

Found (self-review): with legs paired base-pair to platform-pair (a near-singular layout), the solver closed the loops in a different assembly than the target. The usual crossed layout matches.

Limit (recorded in §6): the solver finds an assembly that closes, and stays on the built branch only along a path without singularities.

**Iteration 13.** Concept: a first-time user configures these from the panel, and the work is checked in the app, not only in tests.

Gaps:
- the Moving parts panel had no motors, gearing, poses, sensors or step kinds;
- SDFormat, MuJoCo and USD files could not be imported from the app;
- the action preview divided motor values by their ratio.

Changes:
- Motor and gearing (stages, response, datasheet figures, what the joint gets), Poses, Sensors, and step kinds (pose, wait for a sensor, pause, run an action) with Repeat;
- a motor added to a part keeps its positions and route actions;
- imports of the three formats, with what is not read in the message.

Checked in the app (Playwright on Electron, temporary data folder, empty field):
- imported the USD arm, MuJoCo arm, MuJoCo four-bar with tendon finger, and SDFormat SCARA, with the right joints, couplings, loops and actuators;
- posed the arm with Try it, added a motor through the panel; its readouts agreed with hand working (6000 rpm through 20:1 is 1800 °/s; 2.1 N·m stall; 942.9 °/s under a 1 N·m load);
- saved a pose from the preview, added an encoder, built an action from a pose step and a pause repeated twice. It played for 3.33 s, as worked by hand.

Found and fixed in the app:
- robot files were stretched to the previous robot's footprint, shearing turning links. Robot files with joints are now drawn at their true size, and the footprint follows within 4–48 in;
- a loop-solved rocker offered a motor;
- motor figures were rounded to two decimals (0.105 N·m showed as 0.1);
- gearing, pose and sensor rows and step controls stacked full width.

**Iteration 15** (alongside the intake work logged as iteration 14 in `MECHANISM_ENGINE.md`). Concept: what a moving part is (a claw, a lift, a hang hook), found from the names teams give their CAD assemblies, and chosen by hand when it is not.

Gaps:
- **+ Add** made a blank "Moving part" that the team had to set up from nothing;
- names were read only on the CAD's top-level assemblies, as either "hinged" or "slide", so an "Outtake › Lift › Arm › Claw" gave at most one joint, and nothing rode on anything;
- on another field an "Outtake" assembly was taken for a shooter, and its biggest round part for a flywheel.

Changes:
- `sim-mechanism-types.js`: 57 types in ten groups, each with its joint type, direction, positions, speed, limits, motor and name words; `detect` reads a name;
- the finder walks the whole tree: nested named assemblies become nested joints, claws get a joint per finger closing together, pivoting slides find their slides, swerve modules their wheels, spindexers and turrets their turntables; types set which way is up;
- the panel: **+ Add** opens the grouped, searchable list; each part has a **Mechanism** picker and says what usually drives it; **+ Motor** adds that motor; rows show the type when the name does not.

Checked:
- `tests/sim-mechanism-types.test.cjs`: 84 names (the team's own CAD names among them), every type through the route-action driver, retyping, and a robot with a claw on an arm on a lift, an extendo, a spindexer and a hang hook (positions, parents, closing fingers, raising arm, lifting carriage);
- the team's CAD in Node with the committed and the new finder: the same 22 parts, now with their types, and no new ones, since its "4BAR N" and "A arm" are copies of separate links;
- the app (Playwright on Electron, the team's setup in a temporary data folder): the list, the search, adding a claw, making it a lift, its motor, at 1400 and 420 px wide.

Found and fixed on the way: "Turret drive" and "Hook pivot" read as mechanisms (drive and pivot are now hardware after a mechanism word); a spinning type kept the old part's positions; the game's own turret and intake were found a second time by name.


## 8. One Mechanisms list: + Add mechanism, actuators and Configure from CAD (26 October)

The team asked for one **Mechanisms** list in place of Intakes and Shooters: **+ Add mechanism** opening mechanisms from every FTC season and robotics in general; each one saying whether a servo or a motor drives it, and a servo's lowest, highest and center positions; and **Configure from CAD** setting up what was added from the CAD's names. A second session was building route steps on the same files at the same time; the split was agreed by message (that session: route actions, the Runner, exports and the engine; this one: the Mechanisms page, the catalogue, actuators and the finder).

**Actuators (`ui/sim-actuators.js`).** What the robot code needs, with makers' figures:

- **Servos.** `Servo.setPosition(0–1)` sends 600–2400 µs by default (`PwmControl.PwmRange.usPulseLowerDefault/UpperDefault`). Servos are rated over 500–2500 µs, so a 300° goBILDA turns 270° from 0 to 1 unless the code calls `setPwmRange(new PwmRange(500, 2500))` or the configuration says Full Range Servo (SDK 10.3).
  - Travel across 500–2500 µs: goBILDA 2000 series 300° (5-turn 1800°); Axon MAX/MINI MK2 350°; REV Smart Robot Servo 270°; Hitec HS-485HB about 190° over 553–2425 µs.
  - Speeds and stall torques at 6 V: goBILDA Torque 0.20 s/60° and 21.6 kg·cm; Speed 0.09 s and 9.3; Super Speed 0.043 s and 4.7. Axon MAX 0.115 s and 34; MINI 0.09 s and 25; MICRO+ 0.075 s and 7.8. REV SRS 0.14 s and 13.5. A hub's own servo ports give 5 V, a little slower.
  - Continuous-rotation speed is worked out from the same figures (10 / (s per 60°) rpm).
  - Linear servos: Actuonix L16-R is retracted at 1.0 ms and out at 2.0 ms (63:1: 20 mm/s, 100 N); Hitec HLS12 covers 30 mm over 1050–1950 µs. With the default pulses an L16-R moves between positions 0.222 and 0.778.
- **Motors** (free rpm, encoder counts per output turn, stall N·m):
  - goBILDA 5203 at every ratio from 1:1 (6000, 28, 0.144) to 188:1 (30, 5281.1, 24.5).
  - REV HD Hex (6000, 28, 0.105) with UltraPlanetary cartridges, whose real ratios are 2.89, 3.61 and 5.23 ("20:1" is 317 rpm and 530 counts; "60:1" is 109.5 rpm and 1535.3 counts), or with the older 20:1 and 40:1 spur gearboxes.
  - REV Core Hex (125, 288, 3.2); TorqueNADO (100, 1440, 4.94); Studica Maverick (100, 1464, 5.0); NeveRest Classic 40 and Orbital 20 for older kits.
- **Rules (BIOBUZZ manual TU06):** R503 allows 8 motors (the drivetrain's included) and 8 servos (DECODE allowed 10). R502 allows any servo up to 8 W and 4 A at 6 V, and linear servos up to 1 A. R801 bans pneumatics and vacuum. The page counts the mechanisms' motors and servos against R503, and the Pneumatic piston and Suction gripper types say so.
- A servo's **center** is the position that holds its part where the CAD has it. Named positions are kept in the part's degrees or inches and shown as the position the code sends; changing the center keeps the positions found on the robot.
- A turning servo or motor that drives a slide through a linkage (no spool, rack or screw) covers the slide's travel in its whole sweep, or in half a turn for a motor. A new servo is centred so its part's positions sit in the middle of its sweep.

**Catalogue.** Twenty-three types were added from a season-by-season survey (Ring It Up to DECODE, plus BIOBUZZ), FRC and general robotics:

- passive and suction grippers, and goal and foundation grabbers;
- hoppers, sorter flaps and diverters, tilting ramps and Geneva indexers;
- tape measures, forks and buddy lifts, and stilts;
- fold-out arms, jewel and sample knockers, sweeper arms and plows, and cone righters;
- pole guides, cappers, droppers (marker, purple pixel), button pushers and pivoting shooters;
- PTO shifters and drop-down wheels;
- delta arms and Stewart legs.

Twenty existing word lists gained other seasons' names: collector, harvester, outtake or pixel box, relic arm, lander latch, pixel lock, deflector, duck wheel, treads and odometry. Names that read wrong before now read right: "Zip Line Trigger" was a drone launcher, "Beacon Pusher" a kicker, "Foundation Hooks" a hang hook and "Mineral Sorter" a spindexer. The type's default actuator is a model from the list above. New parts are named the way teams say it ("Extendo", "Hood", "V4B", "DR4B"), so a route action reads "Hood shoot".

**Configure from CAD.** `DeckMechanismTypes.likeness` scores a CAD name against a mechanism that was added:

- its type's word counts most: the type itself, then one of its family. A name that says another type counts against it, unless it also has this type's word ("Intake claw" for a claw).
- the team's own words count next. Plurals, longer forms and one typo all match.
- the type's words anywhere in the name add a little.
- vendor parts score nothing, and hardware right after the name ("Lift motor") counts against it.

`DeckDiscovery.discover({want})` then gives each mechanism the assembly most like it, one each, with assemblies before single parts. It finds the pivot, rails, axle, turntable or fingers as it does for names it reads itself, and marks the joint `for` and `matched`. The page keeps the team's mechanism (its id, name, type, actuator and positions) and takes the CAD's parts, pivot, parent and travel, unless the team had changed the positions or the CAD could not tell them apart. A mechanism the CAD's game finder found under another name (off BIOBUZZ, a turret inside "turret final") is taken by type and name as a second chance. `DeckMechanisms.adoptCad` does the same for the game's intakes and shooters: the CAD's intake of the same kind (else the next one) gives the intake its side, size and parts; the shooter of the same pieces gives the shooter its spot. Kinds, turret or fixed, motors and timing stay. CAD assemblies beyond the team's are listed, not added, and with none added the CAD's own are used. After a new CAD, every mechanism is looked for again.

**Checked:**

- `tests/sim-actuators.test.cjs`: servo travel under both pulse ranges, position and angle both ways, gearing and reversing, a lift's encoder counts and its run through the route-action driver, model changes, centring, linkage slides, every model's figures, and sanitising.
- `tests/sim-mechanism-configure.test.cjs`: the likeness rules; a CAD named "Horizontal Ext", "Grabby" and "Spinny boi" found as an extendo (its inner rails ride), a claw (one finger leads, the other follows) and a mini turret (on its plate); two claws matched to the closer names; the game's intakes and shooters merged.
- `tests/sim-mechanism-types.test.cjs`: 38 names from every season.
- In the app (Playwright on Electron, the team's lunala CAD):
  - On BIOBUZZ, Configure from CAD set Intake 1 to "intake v4" + "FRONT RAMP" and the two shooters to POLLEN V2 and NECTAR V2. It reported an added slide and claw as not in that CAD.
  - On an empty field, an added Turret, Hood and Roller intake took the CAD's Turret 1, Hood 1 and Roller 1, while Turret 2, Hood 2 and the ramp stayed as found.
  - A hood switched to an Axon MINI, with "shoot" typed as servo 0.6, saved 43.2°.

Found and fixed on the way:

- found joints moved by route actions were dropped when the team had one: the duplicate-signal check counted "action" as a game signal;
- found parts showed "Parts chosen";
- a matched hood took the CAD's blank 0°/0° positions.

**Sources:**

- FTC rules: https://ftc-resources.firstinspires.org/ftc/game/manual (BIOBUZZ TU06, 12.5–12.8), https://ftc-resources.firstinspires.org/ftc/event/inspection-reference, https://ftc-resources.firstinspires.org/ftc/archive/2026/game/manual (DECODE).
- SDK servos and motors: https://ftctechnh.github.io/ftc_app/doc/javadoc/constant-values.html, https://javadoc.io/static/org.firstinspires.ftc/RobotCore/10.3.0/com/qualcomm/robotcore/hardware/PwmControl.PwmRange.html, https://gm0.org/en/latest/docs/software/adv-control-system/sdk-servos.html, https://gm0.org/en/latest/docs/software/adv-control-system/sdk-motors.html.
- Servos: https://www.gobilda.com/2000-series-dual-mode-servo-25-2-torque/ (and -25-3, -25-4, 5-turn), https://www.gobilda.com/axon-max-servo-mk2/, https://www.gobilda.com/axon-mini-servo-mk2/, https://docs.axon-robotics.com/archive/micro, https://docs.revrobotics.com/rev-crossover-products/servo/srs, https://docs.revrobotics.com/rev-crossover-products/servo/smart-robot-servo-v2/srs-v2-specifications.
- Linear servos: https://cdn.robotshop.com/media/F/Fir/RB-Fir-111/pdf/ActuonixL16Datasheet.pdf, https://hitecrcd.com/hls12-3050-6v-linear-servo.
- Motors: goBILDA 5203 product pages (for example https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-13-7-1-ratio-24mm-length-8mm-rex-shaft-435-rpm-3-3-5v-encoder/), https://docs.revrobotics.com/duo-build/actuators/motors/hd-hex-motor, https://docs.revrobotics.com/rev-crossover-products/ultraplanetary/cartridge-details, https://docs.revrobotics.com/duo-build/motion/motors/core-hex-motor, https://docs.dev.studica.com/en/latest/docs/Actuators/maverick.html.
- Seasons: FIRST's one-page descriptions in https://github.com/abidingabi/ftc-history; REV kickoff concepts (https://docs.revrobotics.com/ftc-kickoff-concepts/); gm0 common mechanisms (https://gm0.org/en/latest/docs/common-mechanisms/index.html); team pages such as https://www.fwparkerrobotics.org/2017-18-relic-recovery.html, https://ironreignrobotics.org/2016-01-13-tapemeasure/ and https://www.ftc5290.com/robot/capping; Chief Delphi (https://www.chiefdelphi.com/t/basic-mechanical-devices-systems-to-know/502098).
