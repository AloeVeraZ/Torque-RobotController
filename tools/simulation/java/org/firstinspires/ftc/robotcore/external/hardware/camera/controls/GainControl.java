package org.firstinspires.ftc.robotcore.external.hardware.camera.controls;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures; Torque's own code. Not FIRST code.
public interface GainControl extends CameraControl {
    int getMinGain();
    int getMaxGain();
    int getGain();
    boolean setGain(int gain);
}
