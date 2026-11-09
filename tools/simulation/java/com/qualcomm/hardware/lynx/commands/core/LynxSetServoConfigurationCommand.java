package com.qualcomm.hardware.lynx.commands.core;

import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.hardware.lynx.LynxNackException;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures. Not FIRST code.
public class LynxSetServoConfigurationCommand {
    public LynxSetServoConfigurationCommand(LynxModule module, int channel, int framePeriod) {}
    public void send() throws InterruptedException, LynxNackException {}
}
