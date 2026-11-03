package com.qualcomm.hardware.lynx.commands.core;

import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.hardware.lynx.LynxNackException;
import com.qualcomm.robotcore.hardware.I2cAddr;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures. Not FIRST code.
public class LynxI2cReadSingleByteCommand {
    public LynxI2cReadSingleByteCommand(LynxModule module, int busZ, I2cAddr i2cAddr) {}
    public void send() throws InterruptedException, LynxNackException {}
}
