package com.qualcomm.hardware.lynx.commands.core;

import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.hardware.lynx.LynxNackException;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures. Not FIRST code.
public class LynxI2cReadStatusQueryCommand {
    public LynxI2cReadStatusQueryCommand(LynxModule module, int busZ, int cbExpected) {}
    public LynxI2cReadStatusQueryResponse sendReceive() throws InterruptedException, LynxNackException { return new LynxI2cReadStatusQueryResponse(); }
}
