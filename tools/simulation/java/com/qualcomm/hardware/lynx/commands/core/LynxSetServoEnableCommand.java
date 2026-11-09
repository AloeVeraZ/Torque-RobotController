package com.qualcomm.hardware.lynx.commands.core;

import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.hardware.lynx.LynxNackException;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures. Not FIRST code.
public class LynxSetServoEnableCommand {
    public LynxSetServoEnableCommand(LynxModule module, int channel, boolean enable) {}
    public void send() throws InterruptedException, LynxNackException {}
}
