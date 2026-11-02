# Torque and the FTC rules

Torque is for the bench and the pits. At inspection and in matches a team uses the FTC Driver Station app on a Driver Hub or Android device, and nothing in Torque replaces that.

This comes from the [2026-27 BIOBUZZ Competition Manual](https://ftc-resources.firstinspires.org/ftc/game/manual), version TU07 (29 October 2026), Team Updates 00 to 07, the [Inspection Checklist](https://ftc-resources.firstinspires.org/ftc/archive/2027/event/inspection-check) and the public [Q&A board](https://game-qa.firstinspires.org/boards/2027/FTC/QA). Check the manual again when a Team Update comes out: referees and inspectors have the final say (section 1.7.4). Items marked *reading* are our reading of a rule that does not name the situation, and have not been asked on the Q&A board.

## Competition mode

**Competition mode** in the three-dot menu is for the day of an event. It keeps Torque on the right side of R704:

- Torque will not drive or stream over Wi-Fi: Drive, Live debug and Camera refuse a robot on Wi-Fi and say why. USB-C still works.
- Sounds stay off.
- The header says Competition mode, so anyone can see it is on.

What it cannot do for you: disconnect the laptop before you queue, and use your Driver Hub for inspection and matches.

## Each feature

| Torque feature | Where it is allowed | Rule | What Torque does |
|---|---|---|---|
| Drive | Off-venue. In the pits over USB (*reading*). Never in a match or at inspection | R901, R902, R704.D, I301 | Drive says it is for practice. Competition mode refuses Wi-Fi |
| Live debug and Camera streaming | Off-venue. In the pits over USB (*reading*) | R704.D, Q&A QA26 | Competition mode refuses Wi-Fi |
| Saving configurations, putting code on the robot, ADB | The pits, by USB. No rule bans them, and the manual expects programming laptops | R704.C, T405.E | USB first everywhere |
| Torque Debug left on the robot | Allowed. Custom code is fine, and nothing covers a program that is left listed | R304, I303.D | Do not run it in a match: it streams and moves things on command |
| Auto-configure and Save | Anywhere they are used | R701.C, R702 | Configure warns on a second Expansion Hub. A Limelight's USB row says a 3G is prohibited |
| Motors and servos on a robot | At most 8 of each, added up over every configuration used at an event | R503 | Configure warns above 8 in the configuration it shows. It cannot add up the others for you |
| Sensors on I2C and analog | There is no list of allowed sensors. They must be powered by the hub, keep stock firmware, and stay off USB | R607, R613, R702, R707, Q&A QA22, QA25 | See [I2C devices](I2C-DEVICES.md) |
| Lasers | Class 1 and not visible. We have not checked the AndyMark TOF's class | R710 | Check its data sheet |
| HuskyLens | I2C only. A straight REV cable can damage it, and a HuskyLens 2 must have its Wi-Fi off | Q&A QA26 | Its USB row says so |
| Blinkin and LED stick | Flashing above 5 Hz invites scrutiny | R202.J, E108.G | Debug's switch only turns them on and off |
| SPARK Mini | Allowed, 2 motors each, on main battery power | R505, R608 | None |
| Servos | 8 W and 4 A. Lowering limits in software does not make a servo legal | R502, R504.C | Applies to the Axon programmer too |
| A Bluetooth game controller on a laptop | Not in the venue | E301, Q&A QA16 | Use a wired one |
| Sounds | Quiet, in the pits (*reading*) | R202.B, E111 | Competition mode turns them off |
| Generated autonomous and TeleOp code | Allowed | R304, G304.H, G305 | Not yet checked against G304.H's no motion after init rule |

**Worth asking.** No Q&A answers whether a USB-tethered tool that is not the Driver Station may be used in the pits. A Lead Coach can ask on the Q&A board. Until then, the pits row above is our reading, and what is sure is off-venue use.
