package com.qualcomm.hardware.lynx.commands.core;

import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.hardware.lynx.LynxNackException;

// Virtual Control Hub stand-in for the FTC SDK 12.0 API. Same package, names and signatures. Not FIRST code.
public class LynxGetADCCommand {
    public enum Channel { USER0, USER1, USER2, USER3; public static Channel user(int port) { return values()[port]; } }
    public enum Mode { ENGINEERING, RAW }
    public LynxGetADCCommand(LynxModule module, Channel channel, Mode mode) {}
    public LynxGetADCResponse sendReceive() throws InterruptedException, LynxNackException { return new LynxGetADCResponse(); }
}
