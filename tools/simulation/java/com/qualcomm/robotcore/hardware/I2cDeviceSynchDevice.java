package com.qualcomm.robotcore.hardware;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures. Not FIRST code.
public abstract class I2cDeviceSynchDevice<DEVICE_CLIENT> implements HardwareDevice {
    public synchronized boolean initialize() { return true; }
}
