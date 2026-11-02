package com.qualcomm.hardware.rev;

import com.qualcomm.robotcore.hardware.HardwareDevice;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures. Not FIRST code.
public abstract class RevBlinkinLedDriver implements HardwareDevice {
    public enum BlinkinPattern { WHITE, BLACK }
    public void setPattern(BlinkinPattern pattern) {}
}
