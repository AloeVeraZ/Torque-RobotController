# I2C devices on a Control Hub

Every I2C device FTC SDK 12.0 ships a driver for, and what Calibrate → Debug shows for it. It comes from the SDK's own driver source (`com.qualcomm.hardware.*`, RobotCore and Hardware 12.0.0), not from product pages. Addresses are 7-bit.

Debug shows two things for each one, and they come from different places:

- **Whether it is there.** The hub reads one byte from the address, and only a device that is there can acknowledge it: **Connected** or **Not answering: check its cable**. See [What is really plugged in](CALIBRATION.md#what-is-really-plugged-in).
- **What it reads.** The robot asks the driver for everything it offers. A reading only shows once the device answers, because a missing sensor's driver hands back zeros.

| Device | Configuration name | Address | What Debug shows |
|---|---|---|---|
| Control Hub IMU (BHI260AP) | `ControlHubImuBHI260AP` | 0x28, bus 0 | Yaw, pitch, roll, turn rate on X, Y and Z |
| Hub IMU (BNO055) | `LynxEmbeddedIMU` | 0x28, bus 0 | The same |
| REV 9-Axis IMU | `RevExternalImu` | 0x28 | The same |
| Adafruit BNO055 IMU | `AdafruitBNO055IMU` | 0x28 | The same |
| AndyMark 9-Axis IMU | `AndyMarkIMU` | 0x28 | The same |
| navX Micro | `KauaiLabsNavxMicro` | 0x32 | Yaw, pitch, roll, turn rate on X, Y and Z |
| Modern Robotics Gyro | `ModernRoboticsI2cGyro` | 0x10 | Yaw, pitch, roll, turn rate on X, Y and Z |
| goBILDA Pinpoint | `goBILDAPinpoint` | 0x31 | X, Y, heading, both encoders, speed on X and Y, turn rate, status, updates a second |
| SparkFun OTOS | `SparkFunOTOS` | 0x17 | X, Y, heading, speed and acceleration of each |
| OctoQuad | `OctoQuadFTC` | 0x30 | Position and speed of all 8 encoders |
| REV Color Sensor V3 | `RevColorSensorV3` | 0x52 | Red, green, blue, brightness (each 0 to 1), distance in cm |
| REV Color/Range Sensor | `LynxColorSensor` | 0x39 | The same |
| Adafruit RGB Color Sensor | `AdafruitColorSensor` | 0x29 | Red, green, blue, brightness |
| AndyMark Proximity & Color | `AndyMarkColor` | 0x39 | Red, green, blue, brightness, distance in cm |
| Modern Robotics Color Sensor | `ModernRoboticsI2cColorSensor` | 0x1E | Red, green, blue, brightness |
| REV 2m Distance Sensor | `REV_VL53L0X_RANGE_SENSOR` | 0x29 | Distance in cm |
| AndyMark 2m TOF Lidar | `AndyMarkTOF` | 0x29 | Distance in cm |
| Modern Robotics Range Sensor | `ModernRoboticsI2cRangeSensor` | 0x14 | Distance in cm |
| MaxBotix MaxSonar I2CXL | `MaxSonarI2CXL` | 0x70 | Distance in cm |
| Modern Robotics Compass | `ModernRoboticsI2cCompassSensor` | 0x12 | Direction, acceleration on X, Y and Z |
| Modern Robotics IR Seeker V3 | `ModernRoboticsI2cIrSeekerSensorV3` | 0x1C | Angle, strength, whether it sees a signal |
| DFRobot HuskyLens | `HuskyLens` | 0x32 | Objects and arrows it sees, and the first object's ID, place and size |
| SparkFun LED Stick | `QWIIC_LED_STICK` | 0x23 | An on and off switch: it only takes output |

Another I2C device has no driver in the SDK, so it needs one written for it. Debug can still say something answers at its address. A team's own driver is read by the same names, so one built on the SDK's sensor interfaces shows what those offer.

**What the SDK does not give.** The BHI260AP in a Control Hub also has an accelerometer, but the SDK's driver only gives orientation and turn rate, so Debug cannot show its acceleration.

**What has run on real hardware.** Only the BHI260AP, on one Control Hub. Everything else in this table has been read from its driver and run on the virtual hub at most, so a reading may need a fix the first time a real one is plugged in. A device answering at the right address is not proof it is the right type: three of these share 0x29.

Code: `readI2c` and `readOther` in `src/onbot/TorqueDebug.java`, and `I2C_LABELS` in `ui/sim-debug.js`.
